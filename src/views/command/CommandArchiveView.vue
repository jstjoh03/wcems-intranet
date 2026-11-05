<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Archive, FileText } from 'lucide-vue-next'
import CommandNav from '@/components/command/CommandNav.vue'
import { useAuthStore } from '@/stores/auth'
import { useCommand, type DailySummary, type SummarySide } from '@/composables/useCommand'

/**
 * Daily Summary archive — every submission, filterable and searchable:
 * side, shift, flags (downtime / ESD posts / >10-min en-routes) and
 * free text across supervisors and notes. Quarter-end ESD contract
 * reporting in one query instead of a month of PDFs.
 */

const auth = useAuthStore()
const cmd = useCommand()
onMounted(() => void cmd.load())

const q = ref('')
const sideF = ref<'all' | SummarySide>('all')
const shiftF = ref<'all' | 'A' | 'B' | 'C'>('all')
const fDowntime = ref(false)
const fEsd = ref(false)
const fLate = ref(false)
const openId = ref<string | null>(null)
const shown = ref(60)

function flags(s: DailySummary) {
  return {
    downtime: s.data.downtime?.first?.used ?? false,
    esd: (s.data.esd?.postedForUs?.answer || s.data.esd?.wePosted?.answer) ?? false,
    late: (s.data.esd?.lateCalls?.answer && (s.data.esd.lateCalls.rows?.length ?? 0) > 0) ?? false,
  }
}

function supNames(s: DailySummary): string {
  return (s.data.supervisors ?? [])
    .filter((x) => x.name?.trim())
    .map((x) => (x.from || x.until ? `${x.name} (${x.from ?? '?'}–${x.until ?? '?'})` : x.name))
    .join(', ')
}

function totalCalls(s: DailySummary): number {
  return Object.values(s.data.units ?? {}).reduce(
    (t, u) => t + (Number(u.calls?.post) || 0) + (Number(u.calls?.transport) || 0) + (Number(u.calls?.non) || 0),
    0,
  )
}

function haystack(s: DailySummary): string {
  const n = s.data.notes ?? { equipment: '', personnel: '', supplies: '', other: '' }
  const late = (s.data.esd?.lateCalls?.rows ?? []).map((r) => `${r.incident} ${r.reason}`).join(' ')
  const fleetNotes = Object.entries(s.data.fleet ?? {}).map(([v, f]) => `${v} ${f.notes}`).join(' ')
  return [
    s.shiftDate, s.side, s.shiftLetter, supNames(s),
    n.equipment, n.personnel, n.supplies, n.other,
    s.data.esd?.postedForUs?.agency, s.data.esd?.wePosted?.agency, late, fleetNotes,
    Object.keys(s.data.units ?? {}).join(' '),
  ].join(' ').toLowerCase()
}

const rows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  return cmd.summaries.value
    .filter((s) => s.status === 'submitted')
    .filter((s) => {
      if (sideF.value !== 'all' && s.side !== sideF.value) return false
      if (shiftF.value !== 'all' && s.shiftLetter !== shiftF.value) return false
      const f = flags(s)
      if (fDowntime.value && !f.downtime) return false
      if (fEsd.value && !f.esd) return false
      if (fLate.value && !f.late) return false
      if (needle && !haystack(s).includes(needle)) return false
      return true
    })
    .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate) || a.side.localeCompare(b.side))
})

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const SIDE_LABEL: Record<string, string> = { north: 'North', south: 'South', all: 'County-wide' }

const pdfBusy = ref<string | null>(null)
async function openPdf(s: DailySummary) {
  if (!s.pdfPath || pdfBusy.value) return
  pdfBusy.value = s.id
  const url = await cmd.pdfUrl(s.pdfPath)
  pdfBusy.value = null
  if (url) window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div class="ca">
    <header class="ca__head">
      <div class="flex items-center gap-2">
        <Archive :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display ca__title">Summary archive</h1>
      </div>
      <p class="ca__sub">Every Daily Summary on file — the ESD numbers for a quarter are one filter away.</p>
    </header>

    <div v-if="!auth.isSupervisor" class="ca__gate">Command staff only.</div>

    <template v-else>
      <CommandNav />

      <div class="ca__filters">
        <input v-model="q" type="search" class="ca__search" placeholder="Search supervisors, notes, incidents, units…" />
        <div class="ca__group">
          <span class="ca__lbl">Side</span>
          <button v-for="s in (['all', 'north', 'south'] as const)" :key="s" type="button" class="ca__chip" :class="{ 'ca__chip--on': sideF === s }" @click="sideF = s">
            {{ s === 'all' ? 'All' : SIDE_LABEL[s] }}
          </button>
        </div>
        <div class="ca__group">
          <span class="ca__lbl">Shift</span>
          <button v-for="l in (['all', 'A', 'B', 'C'] as const)" :key="l" type="button" class="ca__chip" :class="{ 'ca__chip--on': shiftF === l }" @click="shiftF = l">{{ l === 'all' ? 'All' : l }}</button>
        </div>
        <div class="ca__group">
          <span class="ca__lbl">Flagged</span>
          <button type="button" class="ca__chip" :class="{ 'ca__chip--on': fDowntime }" @click="fDowntime = !fDowntime">Downtime</button>
          <button type="button" class="ca__chip" :class="{ 'ca__chip--on': fEsd }" @click="fEsd = !fEsd">ESD posts</button>
          <button type="button" class="ca__chip" :class="{ 'ca__chip--on': fLate }" @click="fLate = !fLate">&gt;10-min en-route</button>
        </div>
      </div>

      <div v-if="!rows.length" class="ca__gate">No summaries match.</div>
      <div v-else class="ca__tablebox">
        <table class="ca__table">
          <thead>
            <tr><th>Shift date</th><th>Side</th><th>Shift</th><th>Supervisor</th><th class="ca__num">Calls</th><th class="ca__num">Audits</th><th>Flags</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="s in rows.slice(0, shown)" :key="s.id">
              <tr class="ca__row" @click="openId = openId === s.id ? null : s.id">
                <td><b>{{ fmtDate(s.shiftDate) }}</b></td>
                <td>{{ SIDE_LABEL[s.side] }}</td>
                <td>{{ s.shiftLetter ?? '—' }}</td>
                <td>{{ supNames(s) || '—' }}</td>
                <td class="ca__num">{{ totalCalls(s) }}</td>
                <td class="ca__num">{{ s.chartAudits ?? '—' }}</td>
                <td class="ca__flags">
                  <span v-if="flags(s).downtime" class="ca__flag ca__flag--warn">downtime</span>
                  <span v-if="flags(s).esd" class="ca__flag ca__flag--warn">ESD post</span>
                  <span v-if="flags(s).late" class="ca__flag ca__flag--bad">&gt;10 min</span>
                </td>
                <td>
                  <button v-if="s.pdfPath" type="button" class="ca__pdf" :disabled="pdfBusy === s.id" title="Open the letterhead PDF" @click.stop="openPdf(s)">
                    <FileText :size="13" :stroke-width="2" /> PDF
                  </button>
                </td>
              </tr>
              <tr v-if="openId === s.id" class="ca__detail">
                <td colspan="8">
                  <div class="ca__d-grid">
                    <div v-for="(u, code) in s.data.units" :key="code" class="ca__d-unit">
                      <b>{{ code }}</b>
                      <span>{{ u.am.ic || '—' }} / {{ u.am.at || '—' }}<template v-if="u.am.third"> / {{ u.am.third }}</template></span>
                      <span class="ca__d-calls">post {{ u.calls.post ?? 0 }} · txp {{ u.calls.transport ?? 0 }} · non {{ u.calls.non ?? 0 }}</span>
                    </div>
                  </div>
                  <div v-if="s.data.esd?.lateCalls?.rows?.length" class="ca__d-block">
                    <span class="ca__d-lbl">&gt;10-MIN EN-ROUTES</span>
                    <div v-for="(r, i) in s.data.esd.lateCalls.rows" :key="i">{{ r.incident || '—' }} — {{ r.reason || '—' }}</div>
                  </div>
                  <template v-for="(label, key) in { equipment: 'EQUIPMENT', personnel: 'PERSONNEL', supplies: 'SUPPLIES', other: 'OTHER' }" :key="key">
                    <div v-if="s.data.notes?.[key as 'equipment']" class="ca__d-block">
                      <span class="ca__d-lbl">{{ label }}</span>
                      <div>{{ s.data.notes[key as 'equipment'] }}</div>
                    </div>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p class="ca__count">
          {{ Math.min(shown, rows.length) }} of {{ rows.length }} shown
          <button v-if="rows.length > shown" type="button" class="ca__more" @click="shown += 60">Show more</button>
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ca { max-width: 1080px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .ca { padding: 36px 40px 80px; } }
.ca__head { margin-bottom: 10px; }
.ca__title { font-size: 26px; margin: 0; }
.ca__sub { margin: 2px 0 14px; font-size: 13px; color: var(--color-muted); }
.ca__gate { margin-top: 24px; padding: 28px; text-align: center; font-size: 13px; color: var(--color-muted); border: 1px dashed var(--color-line); border-radius: 12px; }

.ca__filters { display: flex; gap: 8px 18px; flex-wrap: wrap; align-items: center; background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 12px; padding: 11px 13px; }
.ca__search { flex: 1 1 220px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-bg, var(--color-surface-soft)); color: var(--color-ink); font: 13px inherit; font-family: inherit; padding: 7px 10px; }
.ca__group { display: flex; gap: 5px; align-items: center; }
.ca__lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; color: var(--color-muted); text-transform: uppercase; margin-right: 2px; }
.ca__chip { border: 1px solid var(--color-line); background: var(--color-surface); border-radius: 999px; font: 600 11.5px inherit; font-family: inherit; color: var(--color-ink-soft, var(--color-ink)); padding: 4px 11px; cursor: pointer; }
.ca__chip--on { background: var(--color-brand-600); border-color: var(--color-brand-600); color: #fff; }

.ca__tablebox { overflow-x: auto; margin-top: 12px; }
.ca__table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.ca__table th { text-align: left; font-size: 10px; letter-spacing: 0.1em; color: var(--color-muted); font-weight: 700; padding: 6px 8px; border-bottom: 1.5px solid var(--color-line); white-space: nowrap; }
.ca__table td { padding: 7px 8px; border-bottom: 1px solid var(--color-line); vertical-align: middle; }
.ca__num { font-variant-numeric: tabular-nums; text-align: right; }
.ca__row { cursor: pointer; }
.ca__row:hover td { background: var(--color-surface-soft); }
.ca__flags { display: flex; gap: 5px; flex-wrap: wrap; }
.ca__flag { font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.ca__flag::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: currentColor; }
.ca__flag--warn { color: oklch(0.5 0.12 70); }
.ca__flag--bad { color: oklch(0.5 0.17 25); }
.ca__pdf { display: inline-flex; align-items: center; gap: 4px; font: 600 11.5px inherit; font-family: inherit; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-surface); color: var(--color-ink); padding: 4px 9px; cursor: pointer; white-space: nowrap; }
.ca__pdf:hover { border-color: var(--color-brand-600); }

.ca__detail td { background: var(--color-surface); font-size: 12.5px; color: var(--color-ink-soft, var(--color-ink)); padding: 10px 14px 12px; }
.ca__d-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 18px; }
.ca__d-unit { display: flex; flex-direction: column; gap: 1px; padding: 4px 0; }
.ca__d-calls { font-size: 11px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.ca__d-block { margin-top: 9px; }
.ca__d-lbl { display: block; font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; color: var(--color-muted); }
.ca__count { font-size: 11.5px; color: var(--color-muted); display: flex; gap: 12px; align-items: center; }
.ca__more { background: none; border: 0; color: var(--color-brand-700, var(--color-brand-600)); font: 600 11.5px inherit; font-family: inherit; cursor: pointer; text-decoration: underline; }
</style>
