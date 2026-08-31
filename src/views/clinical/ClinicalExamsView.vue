<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Play, XCircle, ExternalLink, ClipboardCheck } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import { useClinical } from '@/composables/useClinical'
import { useExams, type ExamAssignment } from '@/composables/useExams'
import { useAuthStore } from '@/stores/auth'

/**
 * Protocol examinations manager (/clinical/exams, editors only) — the
 * one place to run the testing workflow: assign an exam to anyone,
 * release it when they're seated, watch status live, open your OWN
 * assignment (proctors trialing an exam included — this is how Justin
 * takes the test he assigned himself), and read results with critical
 * flags. Exam CONTENT stays out of the portal UI by design (imported
 * via the exam-import pipeline; answer keys never reach the client).
 */

const router = useRouter()
const auth = useAuthStore()
const { ready, canViewBoard, canEdit, clinicalPeople } = useClinical()
const exams = useExams()

watch(
  [ready, canViewBoard, canEdit],
  ([r, ok, editor]) => {
    if (r && !ok) router.replace('/clinical-development')
    else if (r && !editor) router.replace('/clinical/ftep')
  },
  { immediate: true },
)

function nameOf(userId: string): string {
  return clinicalPeople.value.find((p) => p.userId === userId)?.fullName ?? 'Staff'
}

const people = computed(() =>
  [...clinicalPeople.value].sort((a, b) => a.fullName.localeCompare(b.fullName)),
)

/* ── Assign ─────────────────────────────────────────────────────── */
const pickFor = ref<Record<string, string>>({})
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

async function assign(examId: string) {
  const userId = pickFor.value[examId]
  if (!userId || busy.value) return
  busy.value = examId
  error.value = null
  const res = await exams.assign(examId, userId)
  busy.value = null
  if (!res.ok) error.value = res.error ?? 'Assignment failed.'
  else pickFor.value = { ...pickFor.value, [examId]: '' }
}

/* ── Assignments ───────────────────────────────────────────────── */
const openAssignments = computed(() =>
  exams.assignments.value
    .filter((a) => a.status === 'assigned' || a.status === 'released' || a.status === 'in_progress')
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)),
)
const results = computed(() =>
  exams.assignments.value
    .filter((a) => a.status === 'submitted')
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '')),
)

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned — awaiting release',
  released: 'Released — ready to begin',
  in_progress: 'In progress',
}

function isMine(a: ExamAssignment): boolean {
  return a.userId === auth.appUser?.id
}

async function release(a: ExamAssignment) {
  if (busy.value) return
  busy.value = a.id
  error.value = null
  const res = await exams.release(a.id)
  busy.value = null
  if (!res.ok) error.value = res.error ?? 'Release failed.'
}

async function cancel(a: ExamAssignment) {
  if (busy.value) return
  if (!confirm(`Cancel this assignment for ${nameOf(a.userId)}?`)) return
  busy.value = a.id
  const res = await exams.cancel(a.id)
  busy.value = null
  if (!res.ok) error.value = res.error ?? 'Cancel failed.'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="ce">
    <ClinicalNav :crumbs="['Exams']" />

    <header class="ce__head">
      <div>
        <h1 class="display ce__title">Protocol examinations</h1>
        <div class="ce__sub">
          Assign → release when the candidate is seated → auto-graded on submit. A clean pass
          checks the protocol-test gate on their active transition automatically.
        </div>
      </div>
    </header>

    <div v-if="!ready || !exams.ready.value" class="ce__empty">Loading…</div>
    <template v-else>
      <div v-if="error" class="ce__error">{{ error }}</div>

      <!-- Exam catalog -->
      <div class="ce__sectitle">Exams</div>
      <div v-for="d in exams.activeDefinitions.value" :key="d.id" class="ce__exam">
        <div class="ce__exam-info">
          <div class="ce__exam-title">{{ d.title }}</div>
          <div class="ce__exam-meta">
            {{ d.questions.length }} questions · pass {{ d.passingPct }}% · {{ d.timeLimitMinutes }} min
          </div>
        </div>
        <div class="ce__assign">
          <select v-model="pickFor[d.id]" class="ce__select">
            <option value="" disabled selected>Assign to…</option>
            <option v-for="p in people" :key="p.userId" :value="p.userId">{{ p.fullName }}</option>
          </select>
          <button
            type="button"
            class="ce__btn ce__btn--primary"
            :disabled="!pickFor[d.id] || busy === d.id"
            @click="assign(d.id)"
          >
            {{ busy === d.id ? 'Assigning…' : 'Assign' }}
          </button>
        </div>
      </div>
      <div v-if="exams.activeDefinitions.value.length === 0" class="ce__quiet">
        No active exams — content is loaded through the exam-import pipeline.
      </div>

      <!-- Open assignments -->
      <div class="ce__sectitle">Open assignments</div>
      <div class="ce__card">
        <div v-for="a in openAssignments" :key="a.id" class="ce__row">
          <span class="ce__who">{{ nameOf(a.userId) }}<b v-if="isMine(a)" class="ce__you"> · you</b></span>
          <span class="ce__meta">
            {{ exams.definitionById(a.examId)?.title ?? 'Exam' }} · assigned {{ fmtDate(a.assignedAt) }}
          </span>
          <span class="ce__status" :class="`ce__status--${a.status}`">{{ STATUS_LABEL[a.status] }}</span>
          <span class="ce__actions">
            <button
              v-if="a.status === 'assigned'"
              type="button"
              class="ce__btn ce__btn--primary"
              :disabled="busy === a.id"
              @click="release(a)"
            >
              <Play :size="12" :stroke-width="2.5" /> Release
            </button>
            <button
              v-if="isMine(a) && (a.status === 'released' || a.status === 'in_progress')"
              type="button"
              class="ce__btn ce__btn--go"
              @click="router.push(`/exam/${a.id}`)"
            >
              <ExternalLink :size="12" :stroke-width="2" />
              {{ a.status === 'in_progress' ? 'Resume exam' : 'Open exam' }}
            </button>
            <button
              type="button"
              class="ce__btn ce__btn--danger"
              :disabled="busy === a.id"
              @click="cancel(a)"
            >
              <XCircle :size="12" :stroke-width="2" /> Cancel
            </button>
          </span>
        </div>
        <div v-if="openAssignments.length === 0" class="ce__quiet ce__quiet--pad">
          Nothing assigned right now.
        </div>
      </div>

      <!-- Results -->
      <div class="ce__sectitle">Results</div>
      <div class="ce__card">
        <div v-for="a in results" :key="a.id" class="ce__row">
          <span class="ce__who">{{ nameOf(a.userId) }}</span>
          <span class="ce__meta">
            {{ exams.definitionById(a.examId)?.title ?? 'Exam' }} · {{ fmtDate(a.submittedAt) }}
          </span>
          <span class="ce__score">{{ a.scorePct !== null ? `${a.scorePct}%` : '—' }}</span>
          <span
            class="ce__pass"
            :class="a.passed && !(a.criticalMissed?.length) ? 'ce__pass--ok' : 'ce__pass--no'"
          >
            <ClipboardCheck v-if="a.passed && !(a.criticalMissed?.length)" :size="12" :stroke-width="2.5" />
            {{ a.passed ? ((a.criticalMissed?.length) ? 'Pass — critical retest' : 'Pass') : 'Fail' }}
          </span>
          <span v-if="a.criticalMissed?.length" class="ce__crit">
            critical missed: Q{{ a.criticalMissed.join(', Q') }}
          </span>
        </div>
        <div v-if="results.length === 0" class="ce__quiet ce__quiet--pad">No submissions yet.</div>
      </div>

      <p class="ce__note">
        Candidates take released exams from <b>My Progress</b> on their dashboard; this page's
        "Open exam" button covers your own assignments (e.g. trialing a test before fielding it).
      </p>
    </template>
  </div>
</template>

<style scoped>
.ce { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .ce { padding: 24px 32px 80px; } }
.ce__head { margin-bottom: 16px; }
.ce__title { font-size: 28px; line-height: 1.1; color: var(--color-ink); }
.ce__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); max-width: 620px; line-height: 1.5; }
.ce__empty { padding: 28px 0; text-align: center; color: var(--color-muted); font-size: 13px; }
.ce__error {
  margin-bottom: 12px; padding: 9px 13px; border-radius: 9px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12.5px;
}
.ce__sectitle {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); margin: 22px 0 12px;
}
.ce__sectitle::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.ce__exam {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; padding: 14px 18px; margin-bottom: 10px;
}
.ce__exam-title { font-size: 15px; font-weight: 700; color: var(--color-ink); }
.ce__exam-meta { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
.ce__assign { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.ce__select {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 1px solid var(--color-line); border-radius: 9px; padding: 7px 10px;
  background: var(--color-surface); min-width: 190px;
}
.ce__select:focus { outline: none; border-color: var(--color-accent-600); }
.ce__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; overflow: hidden;
}
.ce__row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--color-surface-soft); font-size: 13px;
}
.ce__row:last-of-type { border-bottom: none; }
.ce__who { font-weight: 700; color: var(--color-ink); }
.ce__you { color: var(--color-accent-strong, #a8842c); font-size: 11px; }
.ce__meta { color: var(--color-muted); font-size: 12px; }
.ce__status {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em;
  border-radius: 999px; padding: 3px 10px;
}
.ce__status--assigned { background: var(--color-surface-soft); color: var(--color-muted); }
.ce__status--released { background: oklch(0.95 0.05 90); color: oklch(0.5 0.1 80); }
.ce__status--in_progress { background: oklch(0.93 0.02 250); color: var(--color-brand-700); }
.ce__actions { margin-left: auto; display: flex; gap: 8px; }
.ce__btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 6px 11px; cursor: pointer;
}
.ce__btn:disabled { opacity: 0.5; }
.ce__btn--primary { background: var(--color-brand-700); border-color: var(--color-brand-700); color: #fff; }
.ce__btn--primary:hover:not(:disabled) { background: var(--color-brand-800); }
.ce__btn--go { border-color: var(--color-accent-strong, #a8842c); color: var(--color-accent-strong, #a8842c); }
.ce__btn--danger { color: var(--color-danger-500); }
.ce__score { margin-left: auto; font-weight: 800; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.ce__pass {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 3px 10px;
}
.ce__pass--ok { background: var(--color-success-50); color: var(--color-success-500); }
.ce__pass--no { background: oklch(0.96 0.05 30); color: oklch(0.48 0.15 30); }
.ce__crit { flex-basis: 100%; font-size: 11px; color: oklch(0.48 0.13 45); }
.ce__quiet { font-size: 12.5px; color: var(--color-muted); }
.ce__quiet--pad { padding: 16px; }
.ce__note { margin-top: 16px; font-size: 12px; color: var(--color-muted); line-height: 1.5; }
</style>
