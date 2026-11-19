<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ChevronLeft, ChevronRight, Search, FileDown, Pencil, X } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import {
  useTrainingReports,
  monthLabel,
  shiftMonth,
  type MonthReport,
  type ReportRow,
  type ArchiveItem,
} from '@/composables/useTrainingReports'
import { generateTrainingReportPdf } from '@/lib/trainingReportPdf'

/**
 * Monthly Training & Education Report — the board packet, assembled
 * instead of retyped. Sessions and attendance flow in on their own;
 * 1-on-1s and outside courses are added by hand; filing freezes the
 * month and shelves the PDF in the archive below. Sortren register:
 * hairline-joined table, no card chrome, quiet hovers.
 */

/* No route-level role gate (same stance as /clinical/pip): RLS on the
   report tables decides — a non-editor gets empty data, and ClinicalNav
   doesn't surface this page to them. */
const reports = useTrainingReports()

const month = ref(reports.currentMonth)
const report = ref<MonthReport | null>(null)
const busy = ref(false)
const err = ref<string | null>(null)

async function load() {
  busy.value = true
  err.value = null
  try {
    report.value = await reports.loadMonth(month.value)
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
watch(month, load)
onMounted(() => {
  void load()
  void loadArchive()
})

const filed = computed(() => report.value?.status === 'filed')
const isCurrent = computed(() => month.value === reports.currentMonth)

function fmtDay(iso: string): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function cnt(n: number | null): string {
  return n === null ? '—' : String(n)
}

/* ── Add / edit one row (manual course, or override on an auto row) ── */
const formOpen = ref(false)
const fId = ref<string | undefined>(undefined)
const fSession = ref<string | null>(null) // set = override of this auto row
const fTitle = ref('')
const fDate = ref('')
const fInPerson = ref<string>('')
const fVirtual = ref<string>('')
const fNotes = ref('')
const fBusy = ref(false)
const fErr = ref<string | null>(null)

function openAdd() {
  fId.value = undefined
  fSession.value = null
  fTitle.value = ''
  fDate.value = ''
  fInPerson.value = ''
  fVirtual.value = ''
  fNotes.value = ''
  fErr.value = null
  formOpen.value = true
}
function openEdit(row: ReportRow) {
  fId.value = row.entryId
  fSession.value = row.sessionId ?? null
  fTitle.value = row.title
  fDate.value = row.on
  fInPerson.value = row.inPerson === null ? '' : String(row.inPerson)
  fVirtual.value = row.virtual === null ? '' : String(row.virtual)
  fNotes.value = row.notes
  fErr.value = null
  formOpen.value = true
}
function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}
async function saveForm() {
  if (fBusy.value) return
  if (!fSession.value && (!fTitle.value.trim() || !fDate.value)) {
    fErr.value = 'A hand-added course needs a date and a name.'
    return
  }
  fBusy.value = true
  fErr.value = null
  try {
    await reports.saveEntry(month.value, {
      id: fId.value,
      sessionId: fSession.value,
      happenedOn: fSession.value ? null : fDate.value,
      title: fSession.value ? '' : fTitle.value.trim(),
      inPerson: num(fInPerson.value),
      virtual: num(fVirtual.value),
      notes: fNotes.value.trim(),
    })
    formOpen.value = false
    await load()
  } catch (e) {
    fErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    fBusy.value = false
  }
}
const removeArm = ref(false)
async function removeForm() {
  if (!fId.value || fBusy.value) return
  if (!removeArm.value) {
    removeArm.value = true
    setTimeout(() => (removeArm.value = false), 4000)
    return
  }
  fBusy.value = true
  try {
    await reports.removeEntry(fId.value)
    formOpen.value = false
    await load()
  } catch (e) {
    fErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    fBusy.value = false
    removeArm.value = false
  }
}

/* ── PDF + filing ──────────────────────────────────────────────────── */
async function openPdf() {
  if (!report.value) return
  const pdf = await generateTrainingReportPdf({
    monthLabel: monthLabel(month.value),
    rows: report.value.rows,
    summary: report.value.summary,
    filedByName: report.value.filedByName,
    filedAt: report.value.filedAt,
  })
  window.open(pdf.output('bloburl'), '_blank')
}
const fileArm = ref(false)
async function fileMonthNow() {
  if (!report.value || busy.value) return
  if (!fileArm.value) {
    fileArm.value = true
    setTimeout(() => (fileArm.value = false), 4000)
    return
  }
  fileArm.value = false
  busy.value = true
  try {
    await reports.fileMonth(month.value, report.value.rows)
    await Promise.all([load(), loadArchive()])
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}
async function reopenNow() {
  if (busy.value) return
  busy.value = true
  try {
    await reports.reopenMonth(month.value)
    await Promise.all([load(), loadArchive()])
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}

/* ── Archive + search ─────────────────────────────────────────────── */
const archive = ref<ArchiveItem[]>([])
const query = ref('')
const hits = ref<{ month: string; row: ReportRow }[]>([])
let searchSeq = 0

async function loadArchive() {
  try {
    archive.value = await reports.loadArchive()
  } catch {
    /* archive stays empty — the builder is still usable */
  }
}
watch(query, async (q) => {
  const seq = ++searchSeq
  if (!q.trim()) {
    hits.value = []
    return
  }
  const res = await reports.searchArchive(q)
  if (seq === searchSeq) hits.value = res
})
async function openArchived(m: string) {
  month.value = m
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
async function archivePdf(m: string) {
  const rep = await reports.loadMonth(m)
  const pdf = await generateTrainingReportPdf({
    monthLabel: monthLabel(m),
    rows: rep.rows,
    summary: rep.summary,
    filedByName: rep.filedByName,
    filedAt: rep.filedAt,
  })
  window.open(pdf.output('bloburl'), '_blank')
}
</script>

<template>
  <div class="tr">
    <ClinicalNav :crumbs="['Reports']" />

    <header class="tr__head">
      <h1 class="tr__title display">Training &amp; Education Report</h1>
      <p class="tr__sub">
        The board packet, assembled from the training record — sessions and attendance flow in on
        their own; add 1-on-1s and outside courses by hand, then file the month.
      </p>
    </header>

    <!-- Month register -->
    <div class="tr__bar">
      <div class="tr__monthnav" role="group" aria-label="Month">
        <button type="button" class="tr__step" aria-label="Previous month" @click="month = shiftMonth(month, -1)">
          <ChevronLeft :size="15" />
        </button>
        <span class="tr__month">{{ monthLabel(month) }}</span>
        <button
          type="button"
          class="tr__step"
          aria-label="Next month"
          :disabled="isCurrent"
          @click="month = shiftMonth(month, 1)"
        >
          <ChevronRight :size="15" />
        </button>
      </div>
      <span v-if="report" class="tr__status" :class="{ 'tr__status--filed': filed }">
        {{ filed ? 'FILED' : 'BUILDING' }}
      </span>
      <span v-if="filed && report" class="tr__filedby">
        {{ fmtWhen(report.filedAt) }}<template v-if="report.filedByName"> · {{ report.filedByName }}</template>
      </span>
      <div class="tr__baractions">
        <button type="button" class="tr__btn" :disabled="!report" @click="openPdf">
          <FileDown :size="14" /> PDF
        </button>
        <button v-if="!filed" type="button" class="tr__btn tr__btn--primary" :disabled="!report || busy" @click="fileMonthNow">
          {{ fileArm ? 'Tap again to file' : 'File month' }}
        </button>
        <button v-else type="button" class="tr__btn" :disabled="busy" @click="reopenNow">Reopen</button>
      </div>
    </div>

    <div v-if="err" class="tr__err">{{ err }}</div>

    <!-- The month, hairline-joined -->
    <div class="tr__tablewrap">
      <table class="tr__table">
        <thead>
          <tr>
            <th class="tr__th">Date</th>
            <th class="tr__th">Training</th>
            <th class="tr__th tr__th--n">In-person</th>
            <th class="tr__th tr__th--n">Virtual</th>
            <th class="tr__th tr__th--n">Total</th>
            <th class="tr__th">Notes</th>
            <th class="tr__th tr__th--n">Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in report?.rows ?? []" :key="row.key">
            <td class="tr__td tr__td--nowrap">{{ fmtDay(row.on) }}</td>
            <td class="tr__td tr__td--name">
              <button v-if="!filed" type="button" class="tr__namefix" :title="row.source === 'auto' ? 'Add a note or correct the counts' : 'Edit this course'" @click="openEdit(row)">
                {{ row.title }}<Pencil :size="10" class="tr__pen" />
              </button>
              <template v-else>{{ row.title }}</template>
            </td>
            <td class="tr__td tr__td--n">{{ cnt(row.inPerson) }}</td>
            <td class="tr__td tr__td--n">{{ cnt(row.virtual) }}</td>
            <td class="tr__td tr__td--n tr__td--total">{{ row.total === null ? 'None' : row.total }}</td>
            <td class="tr__td tr__td--notes">{{ row.notes }}</td>
            <td class="tr__td tr__td--n">
              <span class="tr__src" :class="{ 'tr__src--manual': row.source === 'manual' }">
                {{ row.source === 'auto' ? 'AUTO' : 'MANUAL' }}
              </span>
            </td>
          </tr>
          <tr v-if="report && report.rows.length === 0 && !busy">
            <td class="tr__td tr__td--empty" colspan="7">No trainings recorded for {{ monthLabel(month) }} yet.</td>
          </tr>
          <tr v-if="busy">
            <td class="tr__td tr__td--empty" colspan="7">Loading…</td>
          </tr>
        </tbody>
        <tfoot v-if="report">
          <tr>
            <td class="tr__tf tr__tf--label" colspan="2">Month summary — {{ report.summary.trainings }} training{{ report.summary.trainings === 1 ? '' : 's' }} held</td>
            <td class="tr__tf tr__tf--n">{{ report.summary.inPerson }}</td>
            <td class="tr__tf tr__tf--n">{{ report.summary.virtual }}</td>
            <td class="tr__tf tr__tf--n tr__tf--total">{{ report.summary.total }}</td>
            <td class="tr__tf" colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div v-if="!filed" class="tr__addrow">
      <button type="button" class="tr__add" @click="openAdd">+ Add a course by hand</button>
      <span class="tr__addhint">1-on-1s, outside-hosted classes — anything the training app never saw</span>
    </div>
    <div v-else class="tr__addrow">
      <span class="tr__addhint">This month is filed — the report above is frozen. Reopen it to make changes.</span>
    </div>

    <!-- Inline editor -->
    <div v-if="formOpen" class="tr__form">
      <div class="tr__form-head">
        <span class="tr__form-title">
          {{ fSession ? 'Auto row — note & count corrections' : fId ? 'Edit course' : 'Add course' }}
        </span>
        <button type="button" class="tr__step" aria-label="Close" @click="formOpen = false"><X :size="14" /></button>
      </div>
      <div class="tr__form-grid">
        <label v-if="!fSession" class="tr__fld">
          <span>Date</span>
          <input v-model="fDate" type="date" />
        </label>
        <label v-if="!fSession" class="tr__fld tr__fld--wide">
          <span>Training</span>
          <input v-model="fTitle" type="text" placeholder="e.g. 1-on-1 IV Training" />
        </label>
        <div v-else class="tr__fld tr__fld--wide">
          <span>Training</span>
          <div class="tr__fixed">{{ fTitle }} <em>(from the training app)</em></div>
        </div>
        <label class="tr__fld tr__fld--num">
          <span>In-person</span>
          <input v-model="fInPerson" type="number" min="0" :placeholder="fSession ? 'auto' : '—'" />
        </label>
        <label class="tr__fld tr__fld--num">
          <span>Virtual</span>
          <input v-model="fVirtual" type="number" min="0" :placeholder="fSession ? 'auto' : '—'" />
        </label>
        <label class="tr__fld tr__fld--wide">
          <span>Notes</span>
          <input v-model="fNotes" type="text" placeholder="Shows on the board report" />
        </label>
      </div>
      <p v-if="fSession" class="tr__form-hint">
        Leave a count blank to keep the attendance-derived number; enter one to override it.
      </p>
      <div v-if="fErr" class="tr__err">{{ fErr }}</div>
      <div class="tr__form-actions">
        <button type="button" class="tr__btn tr__btn--primary" :disabled="fBusy" @click="saveForm">
          {{ fBusy ? 'Saving…' : 'Save' }}
        </button>
        <button
          v-if="fId"
          type="button"
          class="tr__btn tr__btn--danger"
          :disabled="fBusy"
          @click="removeForm"
        >
          {{ removeArm ? 'Tap again to remove' : fSession ? 'Remove corrections' : 'Remove course' }}
        </button>
      </div>
    </div>

    <!-- Archive -->
    <section class="tr__archive">
      <div class="tr__arch-head">
        <h2 class="tr__arch-title">Archive</h2>
        <div class="tr__search">
          <Search :size="13" />
          <input v-model="query" type="text" placeholder="Search inside reports — class, note, keyword" />
        </div>
      </div>

      <div v-if="query.trim()" class="tr__hits">
        <div v-for="(h, i) in hits" :key="i" class="tr__hit">
          <button type="button" class="tr__hit-open" @click="openArchived(h.month)">
            <span class="tr__hit-title">{{ h.row.title }}</span>
            <span class="tr__hit-meta">{{ monthLabel(h.month) }} · {{ h.row.total === null ? 'count n/a' : `${h.row.total} attended` }}</span>
          </button>
        </div>
        <div v-if="hits.length === 0" class="tr__arch-empty">No filed report mentions “{{ query.trim() }}”.</div>
      </div>

      <div v-else class="tr__arch-list">
        <div v-for="it in archive" :key="it.month" class="tr__arch-row">
          <button type="button" class="tr__arch-open" @click="openArchived(it.month)">
            <span class="tr__arch-month">{{ monthLabel(it.month) }}</span>
            <span class="tr__arch-meta">
              {{ it.trainings }} training{{ it.trainings === 1 ? '' : 's' }} · {{ it.total }} attended
              <template v-if="it.filedAt"> · filed {{ fmtWhen(it.filedAt) }}<template v-if="it.filedByName"> by {{ it.filedByName }}</template></template>
            </span>
          </button>
          <span class="tr__status" :class="{ 'tr__status--filed': it.status === 'filed' }">
            {{ it.status === 'filed' ? 'FILED' : 'BUILDING' }}
          </span>
          <button type="button" class="tr__btn" @click="archivePdf(it.month)"><FileDown :size="13" /> PDF</button>
        </div>
        <div v-if="archive.length === 0" class="tr__arch-empty">
          Nothing filed yet — file a month above and it shelves itself here.
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Sortren register: hairline-joined surfaces, no card chrome, no
   rounding beyond 2px, quiet 120ms hovers, uppercase micro-labels. */
.tr {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .tr { padding: 24px 32px 80px; }
}
.tr__head { margin-bottom: 18px; }
.tr__title { font-size: 32px; line-height: 1.1; color: var(--color-ink); }
.tr__sub { margin-top: 5px; font-size: 13px; color: var(--color-muted); max-width: 640px; }

.tr__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  border-top: 1px solid var(--color-line-soft);
  border-bottom: 1px solid var(--color-line-soft);
  padding: 10px 0;
  margin-bottom: 0;
}
.tr__monthnav { display: flex; align-items: center; gap: 2px; }
.tr__month {
  min-width: 150px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-ink);
}
.tr__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  transition: color 120ms, border-color 120ms;
}
.tr__step:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-line); }
.tr__step:disabled { opacity: 0.35; cursor: default; }

.tr__status {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  padding: 3px 9px;
}
.tr__status--filed { color: var(--color-success-600, #1b6e4b); border-color: currentColor; }
.tr__filedby { font-size: 12px; color: var(--color-muted); }
.tr__baractions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }

.tr__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 2px;
  padding: 7px 13px;
  cursor: pointer;
  transition: color 120ms, border-color 120ms, background-color 120ms;
}
.tr__btn:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-ink); }
.tr__btn:disabled { opacity: 0.45; cursor: default; }
.tr__btn--primary { background: var(--color-ink); border-color: var(--color-ink); color: var(--color-surface); }
.tr__btn--primary:hover:not(:disabled) { color: var(--color-surface); opacity: 0.9; }
.tr__btn--danger:hover:not(:disabled) { color: #b3261e; border-color: #b3261e; }

.tr__err { margin: 10px 0; font-size: 12.5px; color: #b3261e; }

/* Hairline-joined table — one calm surface, no per-cell fills. */
.tr__tablewrap { overflow-x: auto; }
.tr__table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  background: var(--color-surface);
}
.tr__th {
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 10px 10px;
  border-bottom: 1px solid var(--color-line);
}
.tr__th--n { text-align: right; }
.tr__td {
  font-size: 13px;
  color: var(--color-ink-soft);
  padding: 9px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: top;
}
.tr__td--nowrap { white-space: nowrap; }
.tr__td--n { text-align: right; font-variant-numeric: tabular-nums; }
.tr__td--total { font-weight: 700; color: var(--color-ink); }
.tr__td--name { font-weight: 600; color: var(--color-ink); }
.tr__td--notes { color: var(--color-muted); max-width: 280px; }
.tr__td--empty { text-align: center; color: var(--color-muted); padding: 28px 10px; }
.tr__namefix {
  font: inherit;
  font-weight: 600;
  color: var(--color-ink);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.tr__pen { margin-left: 5px; opacity: 0; transition: opacity 120ms; vertical-align: 1px; }
.tr__namefix:hover .tr__pen { opacity: 0.7; }
.tr__src {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--color-muted);
}
.tr__src--manual { color: var(--color-accent-strong, #a8842c); }

.tr__tf {
  font-size: 12px;
  padding: 11px 10px;
  border-top: 1px solid var(--color-ink);
  color: var(--color-ink-soft);
}
.tr__tf--label { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10.5px; }
.tr__tf--n { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.tr__tf--total { color: var(--color-ink); font-size: 14px; }

.tr__addrow { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 12px 0; }
.tr__add {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  border-bottom: 1px solid var(--color-line);
  transition: border-color 120ms;
}
.tr__add:hover { border-color: var(--color-ink); }
.tr__addhint { font-size: 12px; color: var(--color-muted); }

/* Inline editor — a hairline inset, not a modal. */
.tr__form {
  border: 1px solid var(--color-line);
  border-left: 2px solid var(--color-ink);
  padding: 14px 16px;
  margin: 4px 0 18px;
  background: var(--color-surface);
}
.tr__form-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tr__form-title {
  flex: 1;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
}
.tr__form-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.tr__fld { display: flex; flex-direction: column; gap: 4px; flex: 1 1 130px; }
.tr__fld--wide { flex: 3 1 240px; }
.tr__fld--num { flex: 0 1 110px; }
.tr__fld span { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted); }
.tr__fld input {
  font: inherit;
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 2px;
  padding: 8px 10px;
  outline: none;
  transition: border-color 120ms;
}
.tr__fld input:focus { border-color: var(--color-ink); }
.tr__fixed { font-size: 13px; color: var(--color-ink); padding: 8px 0; }
.tr__fixed em { color: var(--color-muted); font-style: normal; font-size: 11.5px; }
.tr__form-hint { margin: 8px 0 0; font-size: 11.5px; color: var(--color-muted); }
.tr__form-actions { display: flex; gap: 8px; margin-top: 12px; }

/* Archive */
.tr__archive { margin-top: 36px; }
.tr__arch-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 4px; }
.tr__arch-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
  margin: 0;
}
.tr__search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--color-line);
  border-radius: 2px;
  background: var(--color-surface);
  padding: 0 10px;
  color: var(--color-muted);
}
.tr__search input {
  border: none;
  outline: none;
  background: none;
  font: inherit;
  font-size: 12.5px;
  color: var(--color-ink);
  padding: 8px 0;
  width: 280px;
  max-width: 56vw;
}
.tr__arch-list, .tr__hits { border-top: 1px solid var(--color-line); }
.tr__arch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--color-line-soft);
}
.tr__arch-open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font: inherit;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.tr__arch-month { font-size: 13.5px; font-weight: 700; color: var(--color-ink); }
.tr__arch-open:hover .tr__arch-month { text-decoration: underline; }
.tr__arch-meta { font-size: 12px; color: var(--color-muted); }
.tr__arch-empty { padding: 22px 2px; font-size: 12.5px; color: var(--color-muted); border-bottom: 1px solid var(--color-line-soft); }
.tr__hit { border-bottom: 1px solid var(--color-line-soft); }
.tr__hit-open {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  font: inherit;
  background: none;
  border: none;
  padding: 10px 2px;
  text-align: left;
  cursor: pointer;
}
.tr__hit-title { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.tr__hit-open:hover .tr__hit-title { text-decoration: underline; }
.tr__hit-meta { font-size: 12px; color: var(--color-muted); }
</style>
