<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ClipboardList } from 'lucide-vue-next'
import type { PipelinePerson, RequirementCycle } from '@/types'
import {
  activeTransitionFor,
  jurisprudenceStatus,
  openGapCount,
  requirementStatus,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'
import { supabase } from '@/lib/supabase'

/**
 * The CDO's to-do panel: everything that needs scheduling, reassigning,
 * or follow-up, computed live from the pipeline — LMS reassignments
 * (jurisprudence + per-cycle items), expiring licenses and card
 * classes, overdue phase targets, and people ready to advance. Each
 * item names the person and the action so the day starts here instead
 * of in six systems. Also hosts the requirement-catalog manager.
 */

const props = defineProps<{
  people: PipelinePerson[]
}>()

const emit = defineEmits<{
  (e: 'open', person: PipelinePerson): void
}>()

const {
  canEdit,
  gatesFor,
  requirements,
  completionsFor,
  addRequirement,
  setRequirementActive,
  refresh,
} = usePipeline()

const today = new Date()
const day = 86_400_000

function licDays(p: PipelinePerson): number | null {
  const exp = p.record.txLicenseExpiresAt
  if (!exp) return null
  return Math.ceil((new Date(`${exp}T00:00:00`).getTime() - today.getTime()) / day)
}

/* Uniform table row (Justin, 2026-08-24 — the free-text bullet wall
   read as chaos): every entry is person · item · short status · date,
   so the whole panel renders as aligned columns like "Coming up". */
interface ActionItem {
  person: PipelinePerson
  /** What it's about — "HEART Training", "BLS Provider", "TX license". */
  item: string
  /** Short status phrase — "required before", "expires", "no card on file". */
  status: string
  /** ISO date for the right-hand column, when one applies. */
  when: string | null
  severity: 'due' | 'warn' | 'info'
}

interface ActionGroup {
  key: string
  title: string
  hint: string
  items: ActionItem[]
}

const byWhen = (a: ActionItem, b: ActionItem) =>
  (a.when ?? '9999').localeCompare(b.when ?? '9999') ||
  a.person.fullName.localeCompare(b.person.fullName)

const groups = computed<ActionGroup[]>(() => {
  const active = props.people.filter((p) => !p.record.pending)

  /* Only people inside the 6-month due window land here — an
     out-of-cycle completion earlier in the license just carries a
     "required before <expiry>" tag on the file instead. */
  const juris: ActionItem[] = active
    .map((p) => ({ p, js: jurisprudenceStatus(p.record, today) }))
    .filter((x) => x.js.state === 'due')
    .map(({ p, js }) => ({
      person: p,
      item: 'TX Jurisprudence',
      status: js.requiredBefore ? 'required before' : 'not on file this cycle',
      when: js.requiredBefore,
      severity: 'due' as const,
    }))

  /* Requirement engine: annual + per-cycle items → the LMS bucket;
     card classes (certification) → the cards bucket. Items with NO
     completion on file stay quiet until data lands (Paycom import /
     first LMS entries) — flagging all ~75 people at once is noise.
     Per-cycle items are the exception: they go due (even with nothing
     on file) once the 6-month license window opens, and stay quiet
     as a tag before that. */
  const lmsItems: ActionItem[] = []
  const cardItems: ActionItem[] = []
  for (const req of requirements.value.filter((r) => r.active)) {
    const bucket = req.cycle === 'certification' ? cardItems : lmsItems
    for (const p of active) {
      /* Level-scoped requirements only nag the levels they apply to —
         an AEMT's lapsed ACLS card is not agency business. */
      if (
        req.requiredLevels.length > 0 &&
        (!p.record.certLevel || !req.requiredLevels.includes(p.record.certLevel))
      )
        continue
      const st = requirementStatus(req, completionsFor(p.userId), p.record, today)
      if (req.cycle === 'per_cert_cycle') {
        /* Tracked-only per-cycle items (no required levels) stay quiet
           for people with nothing on file. */
        if (req.requiredLevels.length === 0 && !st.latest) continue
        if (st.state === 'due')
          bucket.push({ person: p, item: req.name, status: 'required before', when: st.dueAt, severity: 'due' })
        continue
      }
      if (!st.latest) continue
      if (st.state === 'due') {
        bucket.push({ person: p, item: req.name, status: 'expired', when: st.dueAt, severity: 'due' })
      } else if (st.state === 'expiring') {
        bucket.push({ person: p, item: req.name, status: 'expires', when: st.dueAt, severity: 'warn' })
      }
    }
  }

  /* Required CARD classes with NOTHING on file — the level decides
     what's required (EMTs: BLS/HandTevy/EVOC; medics add ACLS/PALS).
     Expired cards are already covered by the buckets above; this
     catches the people who never uploaded the cert to Paycom at all.
     Per-cycle items are excluded — they get the deadline-tag
     treatment, not a missing-card alarm. */
  const missing: ActionItem[] = []
  for (const req of requirements.value.filter((r) => r.active && r.cycle === 'certification' && r.requiredLevels.length > 0)) {
    for (const p of active) {
      const lvl = p.record.certLevel
      if (!lvl || !req.requiredLevels.includes(lvl)) continue
      const st = requirementStatus(req, completionsFor(p.userId), p.record, today)
      if (!st.latest) {
        missing.push({ person: p, item: req.name, status: 'no card on file', when: null, severity: 'due' })
      }
    }
  }
  missing.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName) || a.item.localeCompare(b.item))

  const lic: ActionItem[] = active
    .map((p) => ({ p, d: licDays(p) }))
    .filter((x): x is { p: PipelinePerson; d: number } => x.d !== null && x.d <= 90)
    .sort((a, b) => a.d - b.d)
    .map(({ p, d }) => ({
      person: p,
      item: 'TX license',
      status: d < 0 ? `EXPIRED ${-d}d ago` : `expires in ${d}d`,
      when: p.record.txLicenseExpiresAt,
      severity: d < 0 ? ('due' as const) : ('warn' as const),
    }))

  const overdue: ActionItem[] = active
    .filter((p) => {
      const t = p.record.workingTargetAt
      return p.record.workingPhase && t && new Date(`${t}T00:00:00`).getTime() < today.getTime()
    })
    .map((p) => ({
      person: p,
      item: `Phase target (${p.record.workingPhase})`,
      status: 'passed — follow up',
      when: p.record.workingTargetAt,
      severity: 'warn' as const,
    }))
    .sort(byWhen)

  const ready: ActionItem[] = active
    .filter((p) => activeTransitionFor(p.record) && openGapCount(p.record, gatesFor(p.record.id)) === 0)
    .map((p) => ({
      person: p,
      item: 'All gates complete',
      status: 'schedule board / advancement',
      when: null,
      severity: 'info' as const,
    }))

  return [
    { key: 'lms', title: 'Reassign in LMS', hint: 'jurisprudence & recurring trainings', items: [...juris, ...lmsItems].sort(byWhen) },
    { key: 'missing', title: 'Missing required certs', hint: 'no card on file for their level', items: missing },
    { key: 'cards', title: 'Card classes', hint: 'expiring or lapsed', items: cardItems.sort(byWhen) },
    { key: 'lic', title: 'Licenses', hint: '≤ 90 days or expired', items: lic },
    { key: 'follow', title: 'Follow-ups', hint: 'phase targets passed', items: overdue },
    { key: 'ready', title: 'Ready to advance', hint: 'schedule boards', items: ready },
  ].filter((g) => g.items.length > 0)
})

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const totalCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

const collapsed = ref(false)
const expandedGroups = reactive<Record<string, boolean>>({})
const VISIBLE = 6

/* ── Requirement catalog manager ───────────────────────────────────── */

const showManage = ref(false)
const newReq = reactive({ name: '', cycle: 'annual' as RequirementCycle, busy: false })

async function submitRequirement() {
  if (!newReq.name.trim()) return
  newReq.busy = true
  try {
    await addRequirement(newReq.name.trim(), newReq.cycle)
    newReq.name = ''
  } finally {
    newReq.busy = false
  }
}

/* ── Report imports (Paycom cards / EMS1 jurisprudence+BBP) ────────
   Upload the raw .xlsx; the cert-import edge function parses, matches
   names, and returns a report. Preview = dry run; Apply writes. */

type ImportMode = 'paycom' | 'ems1'
const showImports = ref(false)
const importFiles = reactive<Record<ImportMode, File | null>>({ paycom: null, ems1: null })
const importBusy = ref(false)
const importError = ref<string | null>(null)
const importReport = ref<{ mode: ImportMode; apply: boolean; data: Record<string, unknown> } | null>(null)

function onImportFile(mode: ImportMode, e: Event) {
  const input = e.target as HTMLInputElement
  importFiles[mode] = input.files?.[0] ?? null
  importReport.value = null
  importError.value = null
}

async function runImport(mode: ImportMode, apply: boolean) {
  const file = importFiles[mode]
  if (!file || importBusy.value) return
  importBusy.value = true
  importError.value = null
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) throw new Error('Not signed in.')
    const base = import.meta.env.VITE_SUPABASE_URL as string
    const res = await fetch(
      `${base}/functions/v1/cert-import?mode=${mode}&apply=${apply}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: file },
    )
    const data = await res.json()
    if (!data.ok) throw new Error(String(data.error ?? 'Import failed'))
    importReport.value = { mode, apply, data }
    if (apply) await refresh()
  } catch (e) {
    importError.value = (e as Error).message
  } finally {
    importBusy.value = false
  }
}

/** Flatten the report into readable lines, skipping empty lists. */
const reportLines = computed<string[]>(() => {
  const r = importReport.value
  if (!r) return []
  const d = r.data
  const out: string[] = []
  if (r.mode === 'paycom') {
    out.push(`${d.toImport} card completions ${r.apply ? 'imported' : 'ready to import'}`)
    for (const [k, v] of Object.entries((d.perRequirement as Record<string, number>) ?? {})) {
      out.push(`  · ${k}: ${v}`)
    }
  } else {
    out.push(`${d.toUpdate} jurisprudence/BBP dates ${r.apply ? 'written' : 'ready to write'}`)
  }
  const lists: [string, string[]][] = [
    ['Unmatched people', (d.unmatchedPeople as string[]) ?? []],
    ['DSHS — verify manually', (d.dshsManualVerify as string[]) ?? []],
    ['DSHS mismatches', (d.dshsMismatch as string[]) ?? []],
  ]
  for (const [label, items] of lists) {
    if (items.length) {
      out.push(`${label}:`)
      for (const it of items) out.push(`  · ${it}`)
    }
  }
  return out
})
</script>

<template>
  <section class="ac">
    <div class="ac__head" role="button" tabindex="0" @click="collapsed = !collapsed" @keydown.enter="collapsed = !collapsed">
      <ClipboardList :size="17" :stroke-width="2" class="ac__icon" />
      <span class="ac__title">Action Center</span>
      <span class="ac__count" :class="{ 'ac__count--zero': totalCount === 0 }">{{ totalCount }}</span>
      <span class="ac__spacer"></span>
      <button
        v-if="canEdit && !collapsed"
        type="button"
        class="ac__manage"
        @click.stop="showImports = !showImports"
      >{{ showImports ? 'Done' : 'Import reports' }}</button>
      <button
        v-if="canEdit && !collapsed"
        type="button"
        class="ac__manage"
        @click.stop="showManage = !showManage"
      >{{ showManage ? 'Done' : 'Manage tracked items' }}</button>
      <span class="ac__chev">{{ collapsed ? '▸' : '▾' }}</span>
    </div>

    <div v-if="!collapsed" class="ac__body">
      <!-- Requirement catalog manager -->
      <div v-if="showManage && canEdit" class="ac__catalog">
        <div v-for="req in requirements" :key="req.id" class="ac__cat-row" :class="{ 'ac__cat-row--off': !req.active }">
          <span class="ac__cat-name">{{ req.name }}</span>
          <span class="ac__cat-cycle">{{ { annual: 'annual', per_cert_cycle: 'per cycle', certification: 'card', one_time: 'one-time' }[req.cycle] }}</span>
          <button type="button" class="ac__cat-toggle" @click="setRequirementActive(req.id, !req.active)">
            {{ req.active ? 'Archive' : 'Restore' }}
          </button>
        </div>
        <div class="ac__cat-add">
          <input v-model="newReq.name" type="text" placeholder="New tracked item (e.g. Active Shooter)" @keydown.enter="submitRequirement" />
          <select v-model="newReq.cycle">
            <option value="annual">Annual</option>
            <option value="per_cert_cycle">Per licensure cycle</option>
            <option value="certification">Card (own expiry)</option>
            <option value="one_time">One-time</option>
          </select>
          <button type="button" class="btn" :disabled="newReq.busy || !newReq.name.trim()" @click="submitRequirement">Add</button>
        </div>
      </div>

      <!-- Report imports -->
      <div v-if="showImports && canEdit" class="ac__imports">
        <div class="ac__imp-row">
          <div class="ac__imp-copy">
            <strong>Paycom certifications export</strong>
            <span>Card classes → completions. Expirations snap to end of month; DSHS rows are compared, never written.</span>
          </div>
          <input type="file" accept=".xlsx" @change="onImportFile('paycom', $event)" />
          <div class="ac__imp-btns">
            <button type="button" class="btn" :disabled="!importFiles.paycom || importBusy" @click="runImport('paycom', false)">Preview</button>
            <button type="button" class="btn btn--primary" :disabled="!importFiles.paycom || importBusy" @click="runImport('paycom', true)">Import</button>
          </div>
        </div>
        <div class="ac__imp-row">
          <div class="ac__imp-copy">
            <strong>EMS1 jurisprudence / BBP report</strong>
            <span>Passed courses → jurisprudence and bloodborne pathogen dates. Real dates are never overwritten with older ones.</span>
          </div>
          <input type="file" accept=".xlsx" @change="onImportFile('ems1', $event)" />
          <div class="ac__imp-btns">
            <button type="button" class="btn" :disabled="!importFiles.ems1 || importBusy" @click="runImport('ems1', false)">Preview</button>
            <button type="button" class="btn btn--primary" :disabled="!importFiles.ems1 || importBusy" @click="runImport('ems1', true)">Import</button>
          </div>
        </div>
        <div v-if="importBusy" class="ac__imp-status">Working…</div>
        <div v-if="importError" class="ac__imp-error">{{ importError }}</div>
        <pre v-if="reportLines.length" class="ac__imp-report">{{ reportLines.join('\n') }}</pre>
      </div>

      <p v-if="totalCount === 0" class="ac__empty">Nothing needs your attention — all caught up.</p>

      <div v-else class="ac__groups">
        <div v-for="g in groups" :key="g.key" class="ac__group">
          <h4 class="ac__g-title">{{ g.title }} <span class="ac__g-n">{{ g.items.length }}</span> <span class="ac__g-hint">{{ g.hint }}</span></h4>
          <div class="ac__table">
            <button
              v-for="(item, idx) in expandedGroups[g.key] ? g.items : g.items.slice(0, VISIBLE)"
              :key="`${g.key}-${item.person.userId}-${idx}`"
              type="button"
              class="ac__row"
              @click="emit('open', item.person)"
            >
              <span class="ac__dot" :class="`ac__dot--${item.severity}`"></span>
              <span class="ac__who">{{ item.person.fullName }}</span>
              <span class="ac__what">{{ item.item }} <em class="ac__status">{{ item.status }}</em></span>
              <span class="ac__when" :class="{ 'ac__when--none': !item.when }">{{ fmtWhen(item.when) }}</span>
            </button>
          </div>
          <button
            v-if="g.items.length > VISIBLE"
            type="button"
            class="ac__more"
            @click="expandedGroups[g.key] = !expandedGroups[g.key]"
          >
            {{ expandedGroups[g.key] ? 'Show less' : `+ ${g.items.length - VISIBLE} more` }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ac {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.ac__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 13px 18px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}
.ac__icon {
  color: var(--color-accent-700);
}
.ac__title {
  font-family: var(--font-display);
  font-size: 17px;
  color: var(--color-brand-800);
}
.ac__count {
  font-size: 11px;
  font-weight: 700;
  min-width: 22px;
  text-align: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.ac__count--zero {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.ac__spacer {
  flex: 1;
}
.ac__manage {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
}
.ac__manage:hover {
  text-decoration: underline;
}
.ac__chev {
  font-size: 11px;
  color: var(--color-muted-soft);
}
.ac__body {
  padding: 0 18px 16px;
}
.ac__empty {
  font-size: 12.5px;
  color: var(--color-success-500);
  padding: 4px 0 2px;
}
/* Sections stack full-width so every row's columns align — the old
   two-column masonry read as chaos. */
.ac__groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ac__g-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.ac__g-n {
  color: var(--color-accent-700);
}
.ac__g-hint {
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-muted-soft);
  margin-left: 4px;
}
.ac__table {
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  overflow: hidden;
}
.ac__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}
.ac__row:last-child {
  border-bottom: none;
}
.ac__row:nth-child(even) {
  background: color-mix(in oklab, var(--color-surface-soft) 45%, var(--color-surface));
}
.ac__row:hover {
  background: var(--color-surface-soft);
}
.ac__dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
}
.ac__dot--due { background: var(--color-danger-500); }
.ac__dot--warn { background: oklch(0.68 0.14 75); }
.ac__dot--info { background: var(--color-success-500); }
.ac__who {
  flex: 0 0 150px;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac__what {
  flex: 1;
  min-width: 0;
  color: var(--color-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac__status {
  font-style: normal;
  color: var(--color-muted-soft);
  margin-left: 4px;
}
.ac__when {
  flex-shrink: 0;
  width: 92px;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-accent-strong, #a8842c);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ac__when--none {
  color: var(--color-muted-soft);
  font-weight: 500;
}
@media (max-width: 560px) {
  .ac__who { flex-basis: 108px; }
  .ac__when { width: 74px; }
}
.ac__more {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
}
.ac__imports {
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 14px;
  background: var(--color-surface-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ac__imp-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.ac__imp-copy {
  flex: 1;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ac__imp-copy strong {
  font-size: 12.5px;
  color: var(--color-ink);
}
.ac__imp-copy span {
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-muted);
}
.ac__imp-row input[type='file'] {
  font-size: 11.5px;
  max-width: 210px;
}
.ac__imp-btns {
  display: flex;
  gap: 6px;
}
.ac__imp-btns .btn--primary {
  background: var(--color-brand-800);
  color: white;
  border-color: var(--color-brand-800);
}
.ac__imp-status {
  font-size: 12px;
  color: var(--color-muted);
}
.ac__imp-error {
  font-size: 12px;
  color: oklch(0.5 0.16 30);
}
.ac__imp-report {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
}

.ac__catalog {
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  background: var(--color-surface-soft);
}
.ac__cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 12.5px;
  border-bottom: 1px solid var(--color-line-soft);
}
.ac__cat-row--off .ac__cat-name {
  color: var(--color-muted-soft);
  text-decoration: line-through;
}
.ac__cat-name {
  flex: 1;
  color: var(--color-ink);
}
.ac__cat-cycle {
  font-size: 10.5px;
  color: var(--color-muted-soft);
}
.ac__cat-toggle {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
}
.ac__cat-add {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.ac__cat-add input {
  flex: 1;
  font-size: 12.5px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.ac__cat-add select {
  font-size: 12.5px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
</style>
