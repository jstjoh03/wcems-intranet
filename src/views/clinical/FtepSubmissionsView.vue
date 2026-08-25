<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Download, FileText, Check, AlertTriangle } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import { FTO_EVAL_AREAS, FTO_EVAL_NARRATIVES, type FtoEvalPayload } from '@/constants/ftepForms'
import type { FtepReport } from '@/types'

/**
 * FTEP submissions — the Jotform-style inbox: every submitted DOR and
 * ICR in one chronological table (submission date · who submitted ·
 * who it's for), each row opening the same PDF as everywhere else.
 * Built for the clinical department (Heather's Jotform workflow);
 * editors only.
 */

const router = useRouter()
const { ready, canEdit, canViewBoard, personById, clinicalPeople } = useClinical()
const ftep = useFtep()

watch(
  [ready, canEdit, canViewBoard],
  ([r, edit, board]) => {
    if (r && !edit) router.replace(board ? '/clinical/ftep' : '/clinical-development')
  },
  { immediate: true },
)

const query = ref('')
const kindFilter = ref<'all' | 'dor' | 'icr'>('all')

/* ── Jotform review queue — EVERY incoming call evaluation pends here
   (Justin, 2026-08-25): he and Heather accept it into the employee's
   file (choosing whether it counts toward the 10) or reject it with a
   documented reason. Rejected rows are kept as the decision record. */
const auth = useAuthStore()
interface InboxRow {
  id: string
  submission_id: string | null
  employee_name: string | null
  evaluator_name: string | null
  employee_id: string | null
  evaluator_id: string | null
  eval_date: string | null
  reason: string
  raw: Record<string, unknown> | null
  created_at: string
}
const inbox = ref<InboxRow[]>([])

async function loadInbox() {
  if (auth.usingDevStub) return
  const { data } = await supabase
    .from('jotform_inbox')
    .select('id, submission_id, employee_name, evaluator_name, employee_id, evaluator_id, eval_date, reason, raw, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  inbox.value = (data ?? []) as InboxRow[]
}
onMounted(loadInbox)

/* Per-row review state */
const queueOpen = ref<string | null>(null)
const queueCounts = ref(true)
const queueEmployee = ref('')
const queueDate = ref('')
const queueReject = ref('')
const queueBusy = ref(false)
const queueError = ref<string | null>(null)

function openQueueRow(row: InboxRow) {
  if (queueOpen.value === row.id) {
    queueOpen.value = null
    return
  }
  queueOpen.value = row.id
  queueCounts.value = true
  queueEmployee.value = row.employee_id ?? ''
  queueDate.value = row.eval_date ?? new Date().toISOString().slice(0, 10)
  queueReject.value = ''
  queueError.value = null
}

/** Human-readable view of the Jotform answers for the decision. */
function prettyRaw(raw: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!raw) return []
  const SKIP = /^(slug|path|event_id|jsexecutiontracker|buildDate|uploadServerUrl|eventObserver|validatedNewRequiredFieldIDs|timeToSubmit|q\d+_signature|temp_upload|file)/i
  const out: { label: string; value: string }[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (SKIP.test(key)) continue
    const label = key
      .replace(/^q\d+_/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase())
    let v: string
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>
      if ('first' in o || 'last' in o) v = `${o.first ?? ''} ${o.last ?? ''}`.trim()
      else v = Object.entries(o).map(([k2, v2]) => `${k2}: ${String(v2)}`).join(' · ')
    } else {
      v = String(value ?? '').trim()
    }
    if (v) out.push({ label, value: v })
  }
  return out
}

function rawField(raw: Record<string, unknown> | null, needle: string): string | null {
  if (!raw) return null
  for (const [key, value] of Object.entries(raw)) {
    if (key.toLowerCase().includes(needle) && typeof value === 'string' && value.trim())
      return value.trim()
  }
  return null
}

async function acceptQueueRow(row: InboxRow) {
  if (queueBusy.value) return
  const employeeId = queueEmployee.value
  if (!employeeId) {
    queueError.value = 'Pick the employee this evaluation is for.'
    return
  }
  queueBusy.value = true
  queueError.value = null
  const noteBits = [
    `Jotform #${row.submission_id ?? 'n/a'}`,
    rawField(row.raw, 'incident') ? `incident ${rawField(row.raw, 'incident')}` : null,
    rawField(row.raw, 'complaint'),
  ].filter(Boolean)
  const { data: rep, error: repErr } = await supabase
    .from('ftep_reports')
    .insert({
      kind: 'icr',
      trainee_id: employeeId,
      evaluator_id: row.evaluator_id ?? auth.appUser?.id,
      status: 'submitted',
      eval_date: queueDate.value || new Date().toISOString().slice(0, 10),
      submitted_at: new Date().toISOString(),
      payload: {
        countsToward10: queueCounts.value,
        legacyManual: true,
        jotformId: row.submission_id ?? undefined,
        note: noteBits.join(' · '),
        triageNote: queueCounts.value ? undefined : 'accepted to file but excluded from the 10',
      },
    })
    .select('id')
    .single()
  if (repErr) {
    queueBusy.value = false
    queueError.value = repErr.message
    return
  }
  await supabase
    .from('jotform_inbox')
    .update({
      status: 'accepted',
      employee_id: employeeId,
      decided_by: auth.appUser?.id ?? null,
      decided_at: new Date().toISOString(),
      report_id: rep.id,
    })
    .eq('id', row.id)
  queueBusy.value = false
  queueOpen.value = null
  inbox.value = inbox.value.filter((r) => r.id !== row.id)
}

async function rejectQueueRow(row: InboxRow) {
  if (queueBusy.value || !queueReject.value.trim()) return
  queueBusy.value = true
  queueError.value = null
  const { error } = await supabase
    .from('jotform_inbox')
    .update({
      status: 'rejected',
      decided_by: auth.appUser?.id ?? null,
      decided_at: new Date().toISOString(),
      decision_reason: queueReject.value.trim(),
    })
    .eq('id', row.id)
  queueBusy.value = false
  if (error) {
    queueError.value = error.message
    return
  }
  queueOpen.value = null
  inbox.value = inbox.value.filter((r) => r.id !== row.id)
}

/* ── Trainee Evaluations of FTOs — CDO-only reading room ──────────── */
interface FtoEvalRow {
  id: string
  trainee_id: string
  fto_name: string
  phase: string | null
  payload: FtoEvalPayload
  reviewed_at: string | null
  created_at: string
}
const ftoEvals = ref<FtoEvalRow[]>([])
const ftoEvalOpen = ref<string | null>(null)

async function loadFtoEvals() {
  if (auth.usingDevStub) return
  const { data } = await supabase
    .from('ftep_fto_evals')
    .select('id, trainee_id, fto_name, phase, payload, reviewed_at, created_at')
    .order('created_at', { ascending: false })
  ftoEvals.value = (data ?? []) as FtoEvalRow[]
}
onMounted(loadFtoEvals)

function ftoEvalAvg(e: FtoEvalRow): string {
  const scores = Object.values(e.payload.ratings ?? {})
    .map((r) => r.score)
    .filter((s): s is number => typeof s === 'number')
  if (!scores.length) return '—'
  return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
}

async function markFtoEvalReviewed(e: FtoEvalRow) {
  const { error } = await supabase
    .from('ftep_fto_evals')
    .update({ reviewed_by: auth.appUser?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', e.id)
  if (!error) await loadFtoEvals()
}

function nameOf(userId: string): string {
  return personById(userId)?.fullName ?? 'Staff'
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return ftep.reports.value
    .filter((r) => r.status === 'submitted')
    .filter((r) => kindFilter.value === 'all' || r.kind === kindFilter.value)
    .filter(
      (r) =>
        !q ||
        nameOf(r.traineeId).toLowerCase().includes(q) ||
        nameOf(r.evaluatorId).toLowerCase().includes(q),
    )
    .sort((a, b) => (b.submittedAt ?? b.evalDate).localeCompare(a.submittedAt ?? a.evalDate))
})

const counts = computed(() => {
  const submitted = ftep.reports.value.filter((r) => r.status === 'submitted')
  return {
    all: submitted.length,
    dor: submitted.filter((r) => r.kind === 'dor').length,
    icr: submitted.filter((r) => r.kind === 'icr').length,
  }
})

function fmtSubmitted(r: FtepReport): string {
  const iso = r.submittedAt
  if (!iso) return new Date(`${r.evalDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* ── ICR triage ────────────────────────────────────────────────────
   Some submitted ICRs don't meet the ALS criteria to count toward the
   required 10 — exclude them here with a documented reason. The x/10
   counters everywhere recompute automatically. */
const triageOpen = ref<string | null>(null)
const triageReason = ref('')
const triageBusy = ref(false)
const triageError = ref<string | null>(null)

function openTriage(r: FtepReport) {
  triageOpen.value = triageOpen.value === r.id ? null : r.id
  triageReason.value = r.payload.triageNote ?? ''
  triageError.value = null
}

async function excludeIcr() {
  if (!triageOpen.value || triageBusy.value || !triageReason.value.trim()) return
  triageBusy.value = true
  triageError.value = null
  const res = await ftep.setIcrCounts(triageOpen.value, false, triageReason.value)
  triageBusy.value = false
  if (!res.ok) { triageError.value = res.error; return }
  triageOpen.value = null
}

async function includeIcr(r: FtepReport) {
  if (triageBusy.value) return
  triageBusy.value = true
  await ftep.setIcrCounts(r.id, true)
  triageBusy.value = false
  triageOpen.value = null
}

const pdfBusy = ref<string | null>(null)
async function openPdf(r: FtepReport, mode: 'view' | 'download') {
  if (pdfBusy.value || r.payload.legacyManual) return
  pdfBusy.value = r.id
  try {
    const doc = await generateFtepReportPdf({
      report: r,
      traineeName: nameOf(r.traineeId),
      evaluatorName: nameOf(r.evaluatorId),
    })
    if (mode === 'view') {
      window.open(doc.output('bloburl'), '_blank', 'noopener')
    } else {
      const safe = nameOf(r.traineeId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
      doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
    }
  } finally {
    pdfBusy.value = null
  }
}
</script>

<template>
  <div class="fs">
    <ClinicalNav :crumbs="['Submissions']" />

    <header class="fs__head">
      <div>
        <h1 class="display fs__title">FTEP Submissions</h1>
        <div class="fs__sub">Every submitted DOR and ICR, newest first — tap a row to open the PDF</div>
      </div>
    </header>

    <div v-if="!ready || !ftep.ready.value" class="fs__empty">Loading…</div>

    <template v-else>
      <div v-if="inbox.length" class="fs__inbox">
        <div class="fs__inbox-hd">
          <AlertTriangle :size="14" :stroke-width="2" />
          Jotform review queue — {{ inbox.length }} call evaluation{{ inbox.length === 1 ? '' : 's' }} awaiting a decision
        </div>
        <template v-for="row in inbox" :key="row.id">
          <button type="button" class="fs__inbox-row fs__inbox-row--btn" @click="openQueueRow(row)">
            <span class="fs__inbox-who">{{ row.employee_name ?? '—' }}</span>
            <span class="fs__inbox-reason">{{ row.reason }}<template v-if="row.evaluator_name"> · by {{ row.evaluator_name }}</template></span>
            <span class="fs__inbox-when">{{ new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}</span>
            <span class="fs__inbox-open">{{ queueOpen === row.id ? 'Close' : 'Review' }}</span>
          </button>
          <div v-if="queueOpen === row.id" class="fs__queue-detail">
            <div class="fs__queue-fields">
              <div v-for="f in prettyRaw(row.raw)" :key="f.label" class="fs__queue-field">
                <b>{{ f.label }}</b><span>{{ f.value }}</span>
              </div>
            </div>
            <div class="fs__queue-decide">
              <label class="fs__queue-lbl">
                For employee
                <select v-model="queueEmployee">
                  <option value="" disabled>Select…</option>
                  <option v-for="p in clinicalPeople" :key="p.userId" :value="p.userId">{{ p.fullName }}</option>
                </select>
              </label>
              <label class="fs__queue-lbl">
                Call date
                <input v-model="queueDate" type="date" />
              </label>
              <label class="fs__queue-check">
                <input v-model="queueCounts" type="checkbox" />
                Counts toward the required 10 call evaluations
              </label>
              <button type="button" class="fs__triage-btn fs__triage-btn--accept" :disabled="queueBusy" @click="acceptQueueRow(row)">
                Accept into file
              </button>
              <span class="fs__queue-or">or</span>
              <input
                v-model="queueReject"
                type="text"
                class="fs__queue-rejectwhy"
                maxlength="200"
                placeholder="Reason not to include (required to reject)"
              />
              <button type="button" class="fs__triage-btn fs__triage-btn--danger" :disabled="queueBusy || !queueReject.trim()" @click="rejectQueueRow(row)">
                Reject
              </button>
              <span v-if="queueError" class="fs__triage-err">{{ queueError }}</span>
            </div>
          </div>
        </template>
        <div class="fs__inbox-hint">Accepting files it as a call evaluation on the employee's record; rejecting keeps the submission and your reason as the decision record.</div>
      </div>

      <div class="fs__bar">
        <button
          v-for="k in (['all', 'dor', 'icr'] as const)"
          :key="k"
          type="button"
          class="fs__kind"
          :class="{ 'fs__kind--on': kindFilter === k }"
          @click="kindFilter = k"
        >{{ k === 'all' ? 'All' : k.toUpperCase() }} <span class="fs__kind-n">{{ counts[k] }}</span></button>
        <input
          v-model="query"
          type="search"
          class="fs__search"
          placeholder="Search trainee or evaluator…"
        />
      </div>

      <div class="fs__table">
        <template v-for="r in rows" :key="r.id">
          <button
            type="button"
            class="fs__row"
            :class="{ 'fs__row--static': !!r.payload.legacyManual }"
            :title="r.payload.legacyManual ? 'Recorded from Jotform — original in Documents' : 'Open the report PDF'"
            @click="openPdf(r, 'view')"
          >
            <span class="fs__kindchip" :class="`fs__kindchip--${r.kind}`">{{ r.kind.toUpperCase() }}</span>
            <span class="fs__who">{{ nameOf(r.traineeId) }}</span>
            <span class="fs__by">by {{ nameOf(r.evaluatorId) }}</span>
            <span class="fs__meta">
              <template v-if="r.payload.legacyManual">call eval (Jotform)</template>
              <template v-else>
                <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
                <b v-if="r.payload.nrtFlagged" class="fs__nrt">NRT · </b>call {{ new Date(`${r.evalDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
              </template>
              <span v-if="r.reviewedAt" class="fs__reviewed"><Check :size="11" :stroke-width="2.5" /> reviewed</span>
              <span
                v-if="!r.traineeSignature && !r.payload.legacyManual"
                class="fs__unsigned"
                title="Submitted with the trainee signature deferred — they're prompted on My Progress"
              >awaiting trainee signature</span>
            </span>
            <span
              v-if="r.kind === 'icr'"
              class="fs__count"
              :class="r.payload.countsToward10 ? 'fs__count--yes' : 'fs__count--no'"
              role="button"
              :title="r.payload.countsToward10
                ? 'Counts toward the required 10 — click to exclude with a reason'
                : `Excluded from the 10${r.payload.triageNote ? ` — ${r.payload.triageNote}` : ''} — click to manage`"
              @click.stop="openTriage(r)"
            >{{ r.payload.countsToward10 ? 'counts' : 'excluded' }}</span>
            <span class="fs__when">{{ fmtSubmitted(r) }}</span>
            <span
              v-if="!r.payload.legacyManual"
              class="fs__dl"
              role="button"
              title="Download PDF"
              @click.stop="openPdf(r, 'download')"
            ><Download :size="13" :stroke-width="2" /></span>
            <span v-else class="fs__dl fs__dl--none"><FileText :size="13" :stroke-width="2" /></span>
          </button>
          <div v-if="triageOpen === r.id" class="fs__triage">
            <template v-if="r.payload.countsToward10">
              <span class="fs__triage-l">Exclude this ICR from the required 10 — document why:</span>
              <input
                v-model="triageReason"
                type="text"
                maxlength="200"
                placeholder="e.g. BLS-level call — does not meet ALS ICR criteria"
                @keydown.enter="excludeIcr"
              />
              <button type="button" class="fs__triage-btn fs__triage-btn--danger" :disabled="triageBusy || !triageReason.trim()" @click="excludeIcr">
                Exclude
              </button>
            </template>
            <template v-else>
              <span class="fs__triage-l">
                Excluded from the 10<template v-if="r.payload.triageNote"> — “{{ r.payload.triageNote }}”</template>.
              </span>
              <button type="button" class="fs__triage-btn" :disabled="triageBusy" @click="includeIcr(r)">
                Count it again
              </button>
            </template>
            <button type="button" class="fs__triage-btn" @click="triageOpen = null">Close</button>
            <span v-if="triageError" class="fs__triage-err">{{ triageError }}</span>
          </div>
        </template>
        <div v-if="rows.length === 0" class="fs__empty">No submissions match.</div>
      </div>

      <!-- Trainee Evaluations of FTOs — CDO-only; the FTO never sees these -->
      <div class="fs__sectitle">
        Trainee evaluations of FTOs
        <span class="fs__sectitle-hint">clinical-only · share with FTOs in aggregate, without attribution</span>
      </div>
      <div class="fs__table">
        <template v-for="e in ftoEvals" :key="e.id">
          <button type="button" class="fs__row" @click="ftoEvalOpen = ftoEvalOpen === e.id ? null : e.id">
            <span class="fs__kindchip fs__kindchip--eval">EVAL</span>
            <span class="fs__who">FTO {{ e.fto_name }}</span>
            <span class="fs__by">by {{ nameOf(e.trainee_id) }}</span>
            <span class="fs__meta">
              avg {{ ftoEvalAvg(e) }}<template v-if="e.phase"> · {{ e.phase }}</template>
              <span v-if="e.reviewed_at" class="fs__reviewed"><Check :size="11" :stroke-width="2.5" /> reviewed</span>
            </span>
            <span class="fs__when">{{ new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
          </button>
          <div v-if="ftoEvalOpen === e.id" class="fs__evaldetail">
            <div v-for="a in FTO_EVAL_AREAS" :key="a.no" class="fs__evalrow">
              <span class="fs__evalscore">{{ e.payload.ratings?.[String(a.no)]?.score ?? '—' }}</span>
              <span class="fs__evallabel">{{ a.label }}</span>
              <span v-if="e.payload.ratings?.[String(a.no)]?.comment" class="fs__evalcomment">“{{ e.payload.ratings?.[String(a.no)]?.comment }}”</span>
            </div>
            <div v-for="n in FTO_EVAL_NARRATIVES" :key="n.key">
              <div v-if="e.payload.narratives?.[n.key]" class="fs__evalnarr">
                <b>{{ n.label }}</b>
                <p>{{ e.payload.narratives[n.key] }}</p>
              </div>
            </div>
            <button v-if="!e.reviewed_at" type="button" class="fs__triage-btn" @click="markFtoEvalReviewed(e)">
              Mark reviewed
            </button>
          </div>
        </template>
        <div v-if="ftoEvals.length === 0" class="fs__empty">No trainee evaluations submitted yet.</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fs {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .fs { padding: 24px 32px 80px; }
}
.fs__head {
  margin-bottom: 16px;
}
.fs__title {
  font-size: 26px;
  color: var(--color-brand-800);
}
.fs__sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.fs__empty {
  padding: 24px 0;
  font-size: 13px;
  color: var(--color-muted);
}
.fs__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.fs__kind {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}
.fs__kind--on {
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
  color: #fff;
}
.fs__kind-n {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
  margin-left: 2px;
}
.fs__search {
  flex: 1;
  min-width: 180px;
  max-width: 320px;
  margin-left: auto;
  padding: 7px 11px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__search:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.fs__table {
  border: 1px solid var(--color-line-soft);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-surface);
}
.fs__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}
.fs__row:last-child { border-bottom: none; }
.fs__row:nth-child(even) {
  background: color-mix(in oklab, var(--color-surface-soft) 45%, var(--color-surface));
}
.fs__row:hover:not(:disabled) { background: var(--color-surface-soft); }
.fs__row:disabled { cursor: default; }
.fs__kindchip {
  flex-shrink: 0;
  width: 38px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 3px 0;
  border-radius: 6px;
}
.fs__kindchip--dor { background: oklch(0.93 0.02 250); color: var(--color-brand-700); }
.fs__kindchip--icr { background: oklch(0.95 0.06 90); color: var(--color-accent-strong, #a8842c); }
.fs__who {
  flex: 0 0 160px;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fs__by {
  flex: 0 0 150px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fs__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-ink-soft);
  white-space: nowrap;
  overflow: hidden;
}
.fs__nrt { color: var(--color-danger-500); }
.fs__reviewed {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-success-500);
}
.fs__when {
  flex-shrink: 0;
  width: 138px;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-accent-strong, #a8842c);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fs__dl {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--color-muted);
}
.fs__dl:hover { background: var(--color-line-soft); color: var(--color-ink); }
.fs__dl--none { color: var(--color-muted-soft); }
.fs__row--static { cursor: default; }
.fs__unsigned {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
  white-space: nowrap;
}
.fs__count {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.fs__count--yes { background: var(--color-success-50); color: var(--color-success-500); }
.fs__count--yes:hover { background: oklch(0.9 0.06 150); }
.fs__count--no { background: var(--color-danger-50); color: var(--color-danger-500); }
.fs__triage {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  font-size: 12.5px;
}
.fs__triage-l { color: var(--color-ink-soft); }
.fs__triage input {
  flex: 1;
  min-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__triage-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
}
.fs__triage-btn--danger {
  background: var(--color-danger-500);
  border-color: var(--color-danger-500);
  color: #fff;
}
.fs__triage-btn:disabled { opacity: 0.55; cursor: default; }
.fs__triage-err { flex-basis: 100%; font-size: 12px; color: var(--color-danger-500); }
.fs__inbox {
  margin-bottom: 14px;
  border: 1px solid oklch(0.85 0.07 90);
  border-radius: 12px;
  background: var(--color-warning-50);
  padding: 12px 16px;
}
.fs__inbox-hd {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 700;
  color: oklch(0.42 0.1 75);
  margin-bottom: 6px;
}
.fs__inbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 12.5px;
  border-bottom: 1px solid oklch(0.88 0.05 90);
}
.fs__inbox-row:last-of-type { border-bottom: none; }
.fs__inbox-who { font-weight: 600; color: var(--color-ink); flex-shrink: 0; }
.fs__inbox-reason { color: var(--color-ink-soft); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs__inbox-when { margin-left: auto; flex-shrink: 0; font-size: 11px; color: var(--color-muted); }
.fs__inbox-dismiss {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
}
.fs__inbox-dismiss:hover { text-decoration: underline; }
.fs__inbox-hint { margin-top: 6px; font-size: 11px; color: oklch(0.45 0.08 75); }
.fs__inbox-row--btn {
  width: 100%;
  background: none;
  border-left: none;
  border-right: none;
  border-top: none;
  cursor: pointer;
  text-align: left;
}
.fs__inbox-row--btn:hover { background: oklch(0.95 0.05 90); }
.fs__inbox-open {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-brand-600);
}
.fs__queue-detail {
  background: var(--color-surface);
  border: 1px solid oklch(0.88 0.05 90);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 6px 0 10px;
}
.fs__queue-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 6px 18px;
  margin-bottom: 12px;
}
.fs__queue-field {
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.fs__queue-field b { color: var(--color-muted); font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
.fs__queue-field span { color: var(--color-ink); line-height: 1.45; white-space: pre-wrap; }
.fs__queue-decide {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  padding-top: 10px;
  border-top: 1px solid var(--color-line-soft);
}
.fs__queue-lbl {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-muted);
}
.fs__queue-lbl select,
.fs__queue-lbl input {
  font-size: 12.5px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__queue-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--color-ink);
  padding-bottom: 7px;
}
.fs__queue-or { font-size: 11.5px; color: var(--color-muted-soft); padding-bottom: 9px; }
.fs__queue-rejectwhy {
  flex: 1;
  min-width: 220px;
  font-size: 12.5px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__triage-btn--accept {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: #fff;
}
.fs__sectitle {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 22px 0 8px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.fs__sectitle-hint {
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-muted-soft);
}
.fs__kindchip--eval { background: oklch(0.94 0.03 300); color: oklch(0.42 0.12 300); }
.fs__evaldetail {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
}
.fs__evalrow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 3px 0;
  font-size: 12.5px;
}
.fs__evalscore {
  flex-shrink: 0;
  width: 22px;
  text-align: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-brand-700);
}
.fs__evallabel { color: var(--color-ink); font-weight: 600; }
.fs__evalcomment { color: var(--color-muted); font-style: italic; }
.fs__evalnarr {
  margin-top: 8px;
  font-size: 12.5px;
}
.fs__evalnarr b { color: var(--color-ink); }
.fs__evalnarr p { margin: 2px 0 0; color: var(--color-ink-soft); line-height: 1.55; white-space: pre-wrap; }
.fs__evaldetail .fs__triage-btn { margin-top: 10px; }
@media (max-width: 640px) {
  .fs__by { display: none; }
  .fs__who { flex-basis: 110px; }
  .fs__when { width: 92px; }
}
</style>
