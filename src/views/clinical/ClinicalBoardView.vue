<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClinical } from '@/composables/useClinical'
import { requirementStatus } from '@/constants/pipelineGates'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import type { PipelinePerson, PipelineRequirement } from '@/types'

/**
 * The compliance board — every clinical member × every tracked
 * credential in one sortable grid. Default order is severity-first
 * (worst rows on top); click any column header to sort by that item;
 * click a row to open the person's file.
 *
 * A Today card arrives here with ?focus= and the board shows THE ITEMS
 * behind that number — one dated row per problem, soonest first —
 * never the full grid to hunt through. "View: by certification" turns
 * the same data inside out for planning renewal classes: who renews
 * together, and the month a course should land in.
 */

const route = useRoute()
const router = useRouter()
const clinical = useClinical()
const { clinicalPeople, requirements, completionsFor, licDays } = clinical

/* ── per-cell status model ──────────────────────────────────────────── */

interface Cell {
  /** missing < expired < soon < window < ok < na — sort rank order. */
  state: 'missing' | 'expired' | 'soon' | 'window' | 'ok' | 'na'
  text: string
  tag: string | null
  days: number | null
}

const activeReqs = computed(() => requirements.value.filter((r) => r.active))

function fmtMonth(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function licenseCell(p: PipelinePerson): Cell {
  const exp = p.record.txLicenseExpiresAt
  if (!exp) return { state: 'missing', text: 'none', tag: 'required', days: null }
  const days = licDays(p) ?? 0
  if (days < 0) return { state: 'expired', text: fmtMonth(exp), tag: `expired ${-days}d`, days }
  if (days <= 90) return { state: 'soon', text: fmtMonth(exp), tag: `in ${days}d`, days }
  return { state: 'ok', text: fmtMonth(exp), tag: null, days }
}

function reqCell(p: PipelinePerson, req: PipelineRequirement): Cell {
  const comps = completionsFor(p.userId)
  const applies =
    req.requiredLevels.length === 0
      ? comps.some((c) => c.requirementId === req.id)
      : !!p.record.certLevel && req.requiredLevels.includes(p.record.certLevel)
  if (!applies) return { state: 'na', text: '—', tag: null, days: null }
  const st = requirementStatus(req, comps, p.record)
  const dayOf = (iso: string | null) =>
    iso ? Math.ceil((new Date(`${iso}T00:00:00`).getTime() - Date.now()) / 86_400_000) : null
  if (st.state === 'due') {
    if (!st.latest) {
      /* Pending (NEOP) hires aren't alarmed about missing cards. */
      if (p.record.pending) return { state: 'window', text: 'onboarding', tag: null, days: null }
      return { state: 'missing', text: 'none', tag: 'required', days: null }
    }
    const d = dayOf(st.dueAt)
    return { state: 'expired', text: st.dueAt ? fmtMonth(st.dueAt) : 'expired', tag: d !== null ? `expired ${-d}d` : 'expired', days: d }
  }
  if (st.state === 'expiring') {
    const d = dayOf(st.dueAt)
    return { state: 'soon', text: st.dueAt ? fmtMonth(st.dueAt) : 'soon', tag: d !== null ? `in ${d}d` : 'soon', days: d }
  }
  if (st.state === 'required') {
    return { state: 'window', text: 'this cycle', tag: st.dueAt ? `by ${fmtMonth(st.dueAt)}` : null, days: dayOf(st.dueAt) }
  }
  const when = st.dueAt ?? st.latest?.expiresAt ?? st.latest?.completedAt ?? null
  return { state: 'ok', text: when ? fmtMonth(when) : 'done', tag: null, days: dayOf(when) }
}

interface Row {
  person: PipelinePerson
  cells: Cell[] // [license, ...activeReqs order]
  issues: number
  soonest: number
}

const rows = computed<Row[]>(() =>
  clinicalPeople.value.map((p) => {
    const cells = [licenseCell(p), ...activeReqs.value.map((r) => reqCell(p, r))]
    const issues = cells.filter((c) => c.state === 'missing' || c.state === 'expired').length
    const soonest = Math.min(
      ...cells.map((c) => (c.days !== null && c.days >= 0 ? c.days : Infinity)),
    )
    return { person: p, cells, issues, soonest }
  }),
)

/* ── toolbar state ──────────────────────────────────────────────────── */

const search = ref('')
const level = ref('')
const mode = ref<'person' | 'cert'>('person')
const levels = computed(() =>
  [...new Set(clinicalPeople.value.map((p) => p.record.certLevel).filter((l): l is string => !!l))].sort(),
)

type Focus = '' | 'expired' | 'missing' | 'soon' | 'current'
const focus = ref<Focus>((['expired', 'missing', 'soon', 'current'].includes(String(route.query.focus)) ? String(route.query.focus) : '') as Focus)
const FOCUS_LABEL: Record<Exclude<Focus, ''>, string> = {
  expired: 'expired items',
  missing: 'missing required cards',
  soon: 'expiring within 90 days',
  current: 'fully current members',
}

function clearFocus(): void {
  focus.value = ''
  void router.replace({ query: {} })
}

/* ── sorting ────────────────────────────────────────────────────────── */

/** '' = severity default · 'name' · 'lic' · requirement id. */
const sortKey = ref('')
const sortDir = ref(1)

function setSort(key: string): void {
  if (sortKey.value === key) {
    if (sortDir.value === 1) sortDir.value = -1
    else {
      sortKey.value = ''
      sortDir.value = 1
    }
  } else {
    sortKey.value = key
    sortDir.value = 1
  }
}

const STATE_RANK: Record<Cell['state'], number> = { missing: 0, expired: 1, soon: 2, window: 3, ok: 4, na: 5 }

const visibleRows = computed<Row[]>(() => {
  let out = rows.value.filter(
    (r) =>
      (!search.value || r.person.fullName.toLowerCase().includes(search.value.toLowerCase())) &&
      (!level.value || r.person.record.certLevel === level.value),
  )
  out = [...out]
  if (!sortKey.value) {
    out.sort(
      (a, b) =>
        b.issues - a.issues ||
        (a.issues > 0 ? a.soonest - b.soonest : a.soonest - b.soonest) ||
        a.person.fullName.localeCompare(b.person.fullName),
    )
  } else if (sortKey.value === 'name') {
    out.sort((a, b) => sortDir.value * a.person.fullName.localeCompare(b.person.fullName))
  } else {
    const idx =
      sortKey.value === 'lic' ? 0 : activeReqs.value.findIndex((r) => r.id === sortKey.value) + 1
    out.sort((a, b) => {
      const ca = a.cells[idx]
      const cb = b.cells[idx]
      return (
        sortDir.value *
        (STATE_RANK[ca.state] - STATE_RANK[cb.state] ||
          (ca.days ?? 9e9) - (cb.days ?? 9e9) ||
          a.person.fullName.localeCompare(b.person.fullName))
      )
    })
  }
  return out
})

/** Per-column compliance % (expired/missing count against it). */
function columnPct(idx: number): number {
  let ok = 0
  let total = 0
  for (const r of rows.value) {
    const c = r.cells[idx]
    if (c.state === 'na') continue
    total++
    if (c.state !== 'missing' && c.state !== 'expired') ok++
  }
  return total ? Math.round((ok / total) * 100) : 100
}

/* ── the isolated slice behind a Today card ─────────────────────────── */

interface FocusItem {
  person: PipelinePerson
  item: string
  what: string
  state: 'missing' | 'expired' | 'soon'
  tag: string
  days: number
}

const focusItems = computed<FocusItem[]>(() => {
  if (!focus.value || focus.value === 'current') return []
  const out: FocusItem[] = []
  const names = ['TX License', ...activeReqs.value.map((r) => r.name)]
  for (const r of visibleRows.value.length ? visibleRows.value : rows.value) {
    r.cells.forEach((c, i) => {
      if (focus.value === 'expired' && c.state !== 'expired') return
      if (focus.value === 'missing' && c.state !== 'missing') return
      if (focus.value === 'soon' && c.state !== 'soon') return
      out.push({
        person: r.person,
        item: names[i],
        what:
          c.state === 'missing'
            ? 'no card on file — required'
            : c.state === 'expired'
              ? `expired ${c.text !== 'expired' ? c.text : ''}`.trim()
              : `expires ${c.text}`,
        state: c.state as FocusItem['state'],
        tag: c.tag ?? '',
        days: c.days ?? -9999,
      })
    })
  }
  return out.sort((a, b) => a.days - b.days)
})

const focusCurrent = computed<Row[]>(() =>
  focus.value === 'current' ? visibleRows.value.filter((r) => r.issues === 0 && r.soonest > 90) : [],
)

/* ── by-certification planning view ─────────────────────────────────── */

interface CertBand {
  name: string
  rows: FocusItem[]
  current: number
  nextOk: string | null
  clusterMonth: string | null
  clusterCount: number
}

const certBands = computed<CertBand[]>(() => {
  const names = ['TX License', ...activeReqs.value.map((r) => r.name)]
  const bands: CertBand[] = []
  names.forEach((name, idx) => {
    const problem: FocusItem[] = []
    let current = 0
    let nextOkDays = Infinity
    let nextOk: string | null = null
    for (const r of rows.value) {
      const c = r.cells[idx]
      if (c.state === 'na' || c.state === 'window') continue
      if (c.state === 'ok') {
        current++
        if (c.days !== null && c.days >= 0 && c.days < nextOkDays) {
          nextOkDays = c.days
          nextOk = c.text
        }
        continue
      }
      problem.push({
        person: r.person,
        item: name,
        what:
          c.state === 'missing'
            ? 'no card on file'
            : c.state === 'expired'
              ? `expired ${c.text !== 'expired' ? c.text : ''}`.trim()
              : `expires ${c.text}`,
        state: c.state as FocusItem['state'],
        tag: c.tag ?? '',
        days: c.days ?? -9999,
      })
    }
    if (problem.length === 0) return
    const byMonth = new Map<string, number>()
    for (const p of problem) {
      const m = p.what.replace(/^(expired|expires)\s*/, '')
      if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
    }
    const cluster = [...byMonth.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0] ?? null
    bands.push({
      name,
      rows: problem.sort((a, b) => a.days - b.days),
      current,
      nextOk,
      clusterMonth: cluster?.[0] ?? null,
      clusterCount: cluster?.[1] ?? 0,
    })
  })
  return bands
})

/* ── CSV export (mirrors the current filters) ───────────────────────── */

function exportCsv(): void {
  const names = ['Member', 'Level', 'Status', 'TX License', ...activeReqs.value.map((r) => r.name)]
  const lines = [names.map((n) => `"${n}"`).join(',')]
  for (const r of visibleRows.value) {
    const cells = r.cells.map((c) =>
      c.state === 'na' ? '' : `${c.text}${c.tag ? ` (${c.tag})` : ''}`,
    )
    lines.push(
      [
        `"${r.person.fullName}"`,
        `"${r.person.record.certLevel ?? ''}"`,
        `"${r.issues ? `${r.issues} issue${r.issues > 1 ? 's' : ''}` : 'current'}"`,
        ...cells.map((c) => `"${c}"`),
      ].join(','),
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `wcems-compliance-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function openFile(p: PipelinePerson): void {
  void router.push(`/clinical/people/${p.userId}`)
}
</script>

<template>
  <div class="cb">
    <ClinicalNav :crumbs="['Board']" />

    <header class="cb__head">
      <h1 class="cb__title display">Compliance board</h1>
      <p class="cb__sub">
        Every clinical member × every tracked credential. Click a column header to sort, a row
        to open the file. Statuses compute from the dates — nothing is hand-colored.
      </p>
    </header>

    <div class="cb__toolbar">
      <input v-model="search" type="search" class="cb__search" placeholder="Find a member…" />
      <select v-model="level" class="cb__select">
        <option value="">All levels</option>
        <option v-for="l in levels" :key="l" :value="l">{{ l }}</option>
      </select>
      <select v-model="mode" class="cb__select">
        <option value="person">View: by member</option>
        <option value="cert">View: by certification — plan renewals</option>
      </select>
      <span v-if="focus" class="cb__chip">
        Showing <b>{{ FOCUS_LABEL[focus] }}</b>
        <button type="button" class="cb__lnk" @click="clearFocus">show everyone</button>
      </span>
      <span class="cb__gap"></span>
      <button type="button" class="cb__lnk cb__lnk--mut" @click="exportCsv">Export CSV</button>
    </div>

    <!-- ── focused item list (from a Today card) ── -->
    <section v-if="focus && mode === 'person'" class="cb__panel">
      <template v-if="focus === 'current'">
        <div v-for="r in focusCurrent" :key="r.person.userId" class="cb__frl" @click="openFile(r.person)">
          <span class="cb__frl-who">{{ r.person.fullName }} <small>· {{ r.person.record.certLevel }}</small></span>
          <span class="cb__frl-what">everything tracked is current</span>
          <span class="cb__frl-st cb__ok">next in {{ r.soonest === Infinity ? '—' : r.soonest + 'd' }}</span>
        </div>
        <p v-if="focusCurrent.length === 0" class="cb__empty">No fully-current members under these filters.</p>
      </template>
      <template v-else>
        <div v-for="(f, i) in focusItems" :key="i" class="cb__frl" @click="openFile(f.person)">
          <span class="cb__frl-who">{{ f.person.fullName }} <small>· {{ f.person.record.certLevel }}</small></span>
          <span class="cb__frl-what"><b>{{ f.item }}</b> — {{ f.what }}</span>
          <span class="cb__frl-st" :class="f.state === 'soon' ? 'cb__warn' : 'cb__bad'">
            {{ f.tag || f.what }} · open file →
          </span>
        </div>
        <p v-if="focusItems.length === 0" class="cb__empty">Nothing in this slice right now.</p>
      </template>
    </section>

    <!-- ── the grid ── -->
    <section v-else-if="mode === 'person'" class="cb__gridbox">
      <table class="cb__gr">
        <thead>
          <tr>
            <th class="cb__sticky">
              <button type="button" class="cb__hbtn" @click="setSort('name')">
                Member<span v-if="sortKey === 'name'" class="cb__ar">{{ sortDir > 0 ? '▲' : '▼' }}</span>
              </button>
            </th>
            <th><span class="cb__hbtn" style="cursor: default">Status</span></th>
            <th>
              <button type="button" class="cb__hbtn" @click="setSort('lic')">
                TX License<span v-if="sortKey === 'lic'" class="cb__ar">{{ sortDir > 0 ? '▲' : '▼' }}</span>
              </button>
            </th>
            <th v-for="r in activeReqs" :key="r.id">
              <button type="button" class="cb__hbtn" @click="setSort(r.id)">
                {{ r.name }}<span v-if="sortKey === r.id" class="cb__ar">{{ sortDir > 0 ? '▲' : '▼' }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visibleRows" :key="r.person.userId" @click="openFile(r.person)">
            <td class="cb__sticky">
              <span class="cb__who">{{ r.person.fullName }} <small>· {{ r.person.record.certLevel }}</small>
                <span class="cb__who-sub">{{ r.person.shift ? r.person.shift + ' shift' : '' }}{{ r.person.station ? ' · ' + r.person.station : '' }}</span>
              </span>
            </td>
            <td class="cb__lead" :class="r.issues ? 'cb__bad' : 'cb__ok'">
              <span class="cb__dot" :class="r.issues ? 'cb__dot--bad' : 'cb__dot--ok'"></span>
              {{ r.issues ? `${r.issues} issue${r.issues > 1 ? 's' : ''}` : '✓' }}
            </td>
            <td
              v-for="(c, i) in r.cells"
              :key="i"
              class="cb__cell"
              :class="{
                'cb__cell--bad': c.state === 'missing' || c.state === 'expired',
                'cb__cell--warn': c.state === 'soon' || c.state === 'window',
                'cb__cell--na': c.state === 'na',
              }"
            >
              <template v-if="c.state === 'na'">—</template>
              <template v-else>
                <span
                  class="cb__dot"
                  :class="
                    c.state === 'missing' || c.state === 'expired'
                      ? 'cb__dot--bad'
                      : c.state === 'soon' || c.state === 'window'
                        ? 'cb__dot--warn'
                        : 'cb__dot--ok'
                  "
                ></span>
                {{ c.text }}
                <span v-if="c.tag" class="cb__tag">{{ c.tag }}</span>
              </template>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="cb__sticky">Compliance</td>
            <td></td>
            <td
              v-for="(_, i) in [null, ...activeReqs]"
              :key="i"
              :class="columnPct(i) < 100 ? 'cb__bad' : 'cb__ok'"
            >
              {{ columnPct(i) }}%
            </td>
          </tr>
        </tfoot>
      </table>
    </section>

    <!-- ── by-certification planning view ── -->
    <section v-else class="cb__certs">
      <div v-for="band in certBands" :key="band.name" class="cb__cert">
        <div class="cb__cert-hd">
          <span class="cb__cert-name display">{{ band.name }}</span>
          <span class="cb__cert-stats">
            {{ band.rows.filter((r) => r.state !== 'soon').length
              ? band.rows.filter((r) => r.state !== 'soon').length + ' expired/missing · '
              : '' }}{{ band.rows.filter((r) => r.state === 'soon').length }} due ≤90d
          </span>
          <span class="cb__cert-win">
            <template v-if="band.clusterMonth">Course window: {{ band.clusterMonth }} — {{ band.clusterCount }} renew together · </template>
            <RouterLink to="/training/manage" class="cb__cert-go">Plan a class in Training</RouterLink>
          </span>
        </div>
        <div class="cb__cert-bd">
          <div v-for="(f, i) in band.rows" :key="i" class="cb__frl" @click="openFile(f.person)">
            <span class="cb__frl-who">{{ f.person.fullName }} <small>· {{ f.person.record.certLevel }}</small></span>
            <span class="cb__frl-what">{{ f.what }}</span>
            <span class="cb__frl-st" :class="f.state === 'soon' ? 'cb__warn' : 'cb__bad'">{{ f.tag || f.what }}</span>
          </div>
          <p class="cb__cert-more">
            +{{ band.current }} current<template v-if="band.nextOk"> — earliest next renewal {{ band.nextOk }}</template>
          </p>
        </div>
      </div>
      <p v-if="certBands.length === 0" class="cb__empty">Every tracked item is current — nothing to plan.</p>
    </section>
  </div>
</template>

<style scoped>
.cb {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px 16px;
}
.cb__head {
  margin-bottom: 14px;
}
.cb__title {
  font-size: 28px;
  line-height: 1.1;
  color: var(--color-ink);
}
.cb__sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--color-muted);
  max-width: 70ch;
}
.cb__toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin: 0 0 10px;
}
.cb__search,
.cb__select {
  font-family: var(--font-sans);
  font-size: 12.5px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.cb__search {
  min-width: 200px;
}
.cb__chip {
  font-size: 12px;
  color: var(--color-ink-soft);
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
}
.cb__gap {
  flex: 1;
}
.cb__lnk {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 650;
  color: var(--color-brand-700, var(--color-brand-800));
  text-decoration: underline dotted var(--color-line);
  text-underline-offset: 3px;
  cursor: pointer;
}
.cb__lnk:hover {
  color: var(--color-ink);
}
.cb__lnk--mut {
  color: var(--color-muted);
}
.cb__empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 16px 4px;
}

/* grid */
.cb__gridbox {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  overflow: auto;
  max-height: 72vh;
  position: relative;
}
.cb__gr {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  min-width: 1080px;
  font-family: var(--font-sans);
}
.cb__gr thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-800));
  color: oklch(0.88 0.03 250);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0;
  text-align: left;
  border-bottom: 2px solid var(--color-accent-strong, #a8842c);
}
.cb__hbtn {
  display: block;
  width: 100%;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-align: left;
  padding: 9px 10px 8px;
  white-space: nowrap;
  cursor: pointer;
}
.cb__hbtn:hover {
  color: white;
}
.cb__ar {
  color: var(--color-accent, #d4b05e);
  font-size: 10px;
  margin-left: 3px;
}
.cb__gr thead th.cb__sticky {
  z-index: 5;
}
.cb__gr .cb__sticky {
  position: sticky;
  left: 0;
  background: var(--color-surface);
}
.cb__gr thead .cb__sticky {
  background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-800));
}
.cb__gr tbody td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft, var(--color-line));
  font-size: 12.5px;
  white-space: nowrap;
  background: var(--color-surface);
}
.cb__gr tbody tr {
  cursor: pointer;
}
.cb__gr tbody tr:hover td {
  background: var(--color-surface-soft);
}
.cb__gr td.cb__sticky {
  border-right: 1px solid var(--color-line);
  min-width: 190px;
  z-index: 2;
}
.cb__who {
  font-weight: 700;
  color: var(--color-ink);
  font-size: 12.5px;
}
.cb__who small {
  color: var(--color-muted);
  font-weight: 600;
}
.cb__who-sub {
  display: block;
  font-size: 10.5px;
  color: var(--color-muted);
  font-weight: 600;
}
.cb__lead {
  font-size: 12px;
  font-weight: 700;
}
.cb__cell {
  font-size: 12px;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
}
.cb__tag {
  display: block;
  font-size: 10px;
  font-weight: 700;
}
.cb__cell--bad,
.cb__cell--bad .cb__tag {
  color: oklch(0.5 0.17 25);
}
.cb__cell--warn,
.cb__cell--warn .cb__tag {
  color: oklch(0.5 0.12 70);
}
.cb__cell--na {
  color: var(--color-muted-soft, var(--color-muted));
}
.cb__gr tfoot td {
  position: sticky;
  bottom: 0;
  background: var(--color-surface-soft);
  border-top: 2px solid var(--color-line);
  font-size: 10.5px;
  color: var(--color-muted);
  padding: 7px 10px;
  font-weight: 700;
  white-space: nowrap;
}
.cb__bad {
  color: oklch(0.5 0.17 25);
}
.cb__warn {
  color: oklch(0.5 0.12 70);
}
.cb__ok {
  color: oklch(0.45 0.12 150);
}
.cb__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: 1px;
  background: oklch(0.85 0.006 255);
}
.cb__dot--bad {
  background: oklch(0.55 0.17 25);
}
.cb__dot--warn {
  background: oklch(0.65 0.12 70);
}
.cb__dot--ok {
  background: oklch(0.55 0.13 150);
}

/* focused list */
.cb__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 6px 16px 10px;
}
.cb__frl {
  display: grid;
  grid-template-columns: minmax(170px, 230px) 1fr auto;
  gap: 12px;
  align-items: baseline;
  padding: 10px 2px;
  border-bottom: 1px solid var(--color-line-soft, var(--color-line));
  cursor: pointer;
  font-family: var(--font-sans);
}
.cb__frl:hover {
  background: var(--color-surface-soft);
}
.cb__frl:last-of-type {
  border-bottom: none;
}
.cb__frl-who {
  font-weight: 700;
  font-size: 13px;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cb__frl-who small {
  font-weight: 600;
  color: var(--color-muted);
}
.cb__frl-what {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
}
.cb__frl-st {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  text-align: right;
}

/* by-certification bands */
.cb__certs {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cb__cert-hd {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-800));
  color: white;
  border-radius: 12px 12px 0 0;
  padding: 10px 14px;
  border-bottom: 2px solid var(--color-accent-strong, #a8842c);
}
.cb__cert-name {
  font-size: 17px;
}
.cb__cert-stats {
  font-size: 11px;
  color: oklch(0.8 0.035 250);
  font-weight: 650;
}
.cb__cert-win {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-accent, #d4b05e);
}
.cb__cert-go {
  color: white;
  text-decoration: underline dotted var(--color-accent, #d4b05e);
  text-underline-offset: 3px;
}
.cb__cert-bd {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-top: 0;
  border-radius: 0 0 12px 12px;
  padding: 2px 14px 10px;
}
.cb__cert-more {
  font-size: 11.5px;
  color: var(--color-muted);
  padding: 8px 0 2px;
}

@media (max-width: 640px) {
  .cb__frl {
    grid-template-columns: 1fr auto;
  }
  .cb__frl-what {
    grid-column: 1 / -1;
    order: 3;
  }
}
</style>
