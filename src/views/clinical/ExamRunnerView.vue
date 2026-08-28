<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, Clock } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useExams } from '@/composables/useExams'

/**
 * Protocol exam runner — the candidate's page. Starts only after the
 * proctor releases the assignment; a countdown runs from the server
 * start stamp and auto-submits at time; answers autosave so a dropped
 * connection can't lose work. Grading happens server-side — correct
 * answers never reach this page.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const exams = useExams()

const assignmentId = computed(() => String(route.params.id))
const assignment = computed(() => exams.assignmentById(assignmentId.value))
const definition = computed(() =>
  assignment.value ? exams.definitionById(assignment.value.examId) : null,
)

const answers = ref<Record<string, string>>({})
let hydrated = false
watch(
  assignment,
  (a) => {
    if (a && !hydrated) {
      answers.value = { ...a.answers }
      hydrated = true
    }
  },
  { immediate: true },
)

const answeredCount = computed(() => Object.keys(answers.value).length)
const totalCount = computed(() => definition.value?.questions.length ?? 0)

/* Group questions by section for headers. */
const sections = computed(() => {
  const out: { title: string | null; questions: NonNullable<typeof definition.value>['questions'] }[] = []
  for (const q of definition.value?.questions ?? []) {
    const last = out[out.length - 1]
    if (last && last.title === (q.section ?? null)) last.questions.push(q)
    else out.push({ title: q.section ?? null, questions: [q] })
  }
  return out
})

/* ── Timer ─────────────────────────────────────────────────────────── */
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(tick))

const deadline = computed(() => {
  const a = assignment.value
  const d = definition.value
  if (!a?.startedAt || !d) return null
  return new Date(a.startedAt).getTime() + d.timeLimitMinutes * 60_000
})
const remainingMs = computed(() => (deadline.value ? Math.max(0, deadline.value - now.value) : null))
const remainingText = computed(() => {
  if (remainingMs.value === null) return ''
  const total = Math.floor(remainingMs.value / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
})

/* Time expires → submit whatever is saved. */
watch(remainingMs, (ms) => {
  if (ms === 0 && assignment.value?.status === 'in_progress' && !submitting.value) {
    void doSubmit(true)
  }
})

/* ── Autosave ──────────────────────────────────────────────────────── */
let saveTimer: ReturnType<typeof setTimeout> | null = null
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
watch(
  answers,
  () => {
    if (assignment.value?.status !== 'in_progress') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      saveState.value = 'saving'
      await exams.saveAnswers(assignmentId.value, answers.value)
      saveState.value = 'saved'
    }, 2000)
  },
  { deep: true },
)
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

/* ── Begin / submit ────────────────────────────────────────────────── */
const starting = ref(false)
const startError = ref<string | null>(null)
async function begin() {
  if (starting.value) return
  starting.value = true
  startError.value = null
  const res = await exams.start(assignmentId.value)
  starting.value = false
  if (!res.ok) startError.value = res.error ?? 'Could not start.'
}

const submitting = ref(false)
const submitError = ref<string | null>(null)
const confirmSubmit = ref(false)
const result = ref<{ scorePct: number; passed: boolean; passingPct?: number; criticalMissed: number[] } | null>(null)

async function doSubmit(auto = false) {
  if (submitting.value) return
  if (!auto && answeredCount.value < totalCount.value && !confirmSubmit.value) {
    confirmSubmit.value = true
    return
  }
  submitting.value = true
  submitError.value = null
  const res = await exams.submit(assignmentId.value, answers.value)
  submitting.value = false
  confirmSubmit.value = false
  if (!res.ok) {
    submitError.value = res.error ?? 'Submit failed.'
    return
  }
  result.value = {
    scorePct: res.scorePct!,
    passed: res.passed!,
    passingPct: res.passingPct,
    criticalMissed: res.criticalMissed ?? [],
  }
  window.scrollTo({ top: 0 })
}

const shownResult = computed(() => {
  if (result.value) return result.value
  const a = assignment.value
  if (a?.status === 'submitted' && a.scorePct !== null) {
    return {
      scorePct: a.scorePct,
      passed: !!a.passed,
      passingPct: definition.value?.passingPct,
      criticalMissed: a.criticalMissed ?? [],
    }
  }
  return null
})

const mine = computed(() => assignment.value?.userId === auth.appUser?.id)
</script>

<template>
  <div class="ex">
    <button type="button" class="ex__back" @click="router.push('/clinical-development')">
      <ArrowLeft :size="14" :stroke-width="2" />
      My Progress
    </button>

    <div v-if="!exams.ready.value" class="ex__empty">Loading…</div>
    <div v-else-if="!assignment || !mine" class="ex__empty">No exam assignment found for you here.</div>
    <div v-else-if="!definition" class="ex__empty">The exam could not be loaded — tell your proctor.</div>

    <!-- Result -->
    <div v-else-if="shownResult" class="ex__result">
      <div class="ex__result-score" :class="shownResult.passed ? 'ex__result-score--pass' : 'ex__result-score--fail'">
        {{ shownResult.scorePct.toFixed(1) }}%
      </div>
      <h1 class="display ex__result-title">
        {{ shownResult.passed ? 'Passed' : 'Not passed' }} — {{ definition.title }}
      </h1>
      <p class="ex__result-sub">
        Passing standard: {{ shownResult.passingPct ?? definition.passingPct }}%.
        <template v-if="shownResult.passed && shownResult.criticalMissed.length === 0">
          Clean pass — the protocol requirement on your credentialing checklist has been checked off automatically.
        </template>
        <template v-else-if="shownResult.criticalMissed.length > 0">
          {{ shownResult.criticalMissed.length }} flagged medication-dose item{{ shownResult.criticalMissed.length === 1 ? ' was' : 's were' }} missed —
          per policy this requires remediation and a targeted retest of that content area{{ shownResult.passed ? ', even with a passing overall score' : '' }}.
          The Clinical Department will follow up.
        </template>
        <template v-else>
          The Clinical Department will follow up on next steps.
        </template>
      </p>
      <button type="button" class="ex__primary" @click="router.push('/clinical-development')">Back to My Progress</button>
    </div>

    <!-- Waiting / intro -->
    <div v-else-if="assignment.status === 'assigned'" class="ex__gate">
      <h1 class="display ex__title">{{ definition.title }}</h1>
      <p class="ex__sub">Your proctor will release this examination when you're seated and ready. This page will unlock automatically.</p>
    </div>

    <div v-else-if="assignment.status === 'released'" class="ex__gate">
      <h1 class="display ex__title">{{ definition.title }}</h1>
      <div class="ex__meta">
        {{ definition.questions.length }} questions · {{ definition.timeLimitMinutes }} minutes ·
        passing {{ definition.passingPct }}%
      </div>
      <p v-if="definition.instructions" class="ex__instructions">{{ definition.instructions }}</p>
      <p class="ex__sub">The clock starts when you begin and cannot be paused. Your answers save automatically as you work.</p>
      <div v-if="startError" class="ex__error">{{ startError }}</div>
      <button type="button" class="ex__primary" :disabled="starting" @click="begin">
        {{ starting ? 'Starting…' : 'Begin examination' }}
      </button>
    </div>

    <!-- Runner -->
    <template v-else-if="assignment.status === 'in_progress'">
      <div class="ex__bar">
        <div class="ex__bar-title">{{ definition.title }}</div>
        <span class="ex__bar-progress">{{ answeredCount }} / {{ totalCount }} answered</span>
        <span class="ex__timer" :class="{ 'ex__timer--low': (remainingMs ?? 0) < 10 * 60_000 }">
          <Clock :size="13" :stroke-width="2" /> {{ remainingText }}
        </span>
        <span class="ex__savestate">{{ saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : '' }}</span>
      </div>

      <template v-for="sec in sections" :key="sec.title ?? 'x'">
        <div v-if="sec.title" class="ex__section">{{ sec.title }}</div>
        <div v-for="q in sec.questions" :key="q.no" class="ex__q">
          <div class="ex__q-text"><b>{{ q.no }}.</b> {{ q.text }}</div>
          <label
            v-for="(text, letter) in q.options"
            :key="letter"
            class="ex__opt"
            :class="{ 'ex__opt--on': answers[String(q.no)] === letter }"
          >
            <input
              v-model="answers[String(q.no)]"
              type="radio"
              :name="`q${q.no}`"
              :value="letter"
            />
            <span class="ex__opt-letter">{{ letter }}</span>
            <span>{{ text }}</span>
          </label>
        </div>
      </template>

      <div v-if="submitError" class="ex__error">{{ submitError }}</div>
      <div class="ex__footer">
        <span v-if="confirmSubmit" class="ex__confirm">
          {{ totalCount - answeredCount }} unanswered — unanswered questions score as incorrect. Submit anyway?
        </span>
        <button type="button" class="ex__primary" :disabled="submitting" @click="doSubmit(false)">
          <Check :size="14" :stroke-width="2.5" />
          {{ submitting ? 'Submitting…' : confirmSubmit ? 'Yes, submit now' : 'Submit examination' }}
        </button>
        <button v-if="confirmSubmit" type="button" class="ex__ghost" @click="confirmSubmit = false">Keep working</button>
      </div>
    </template>

    <div v-else class="ex__empty">This assignment is {{ assignment.status }}.</div>
  </div>
</template>

<style scoped>
.ex { max-width: 820px; margin: 0 auto; padding: 24px 16px 100px; }
@media (min-width: 768px) { .ex { padding: 24px 32px 100px; } }
.ex__back {
  display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px;
  font-size: 12.5px; font-weight: 600; color: var(--color-ink-soft);
  background: none; border: none; padding: 0; cursor: pointer;
}
.ex__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }
.ex__title { font-size: 26px; color: var(--color-brand-800); }
.ex__sub { margin-top: 8px; font-size: 13.5px; line-height: 1.6; color: var(--color-ink-soft); }
.ex__meta { margin-top: 6px; font-size: 12.5px; font-weight: 600; color: var(--color-accent-700); }
.ex__instructions {
  margin-top: 12px; font-size: 13px; line-height: 1.65; color: var(--color-ink-soft);
  background: var(--color-surface-soft); border-left: 3px solid var(--color-accent-600);
  border-radius: 0 10px 10px 0; padding: 12px 14px;
}
.ex__gate { padding: 12px 0; }
.ex__primary {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 16px;
  padding: 11px 20px; border-radius: 10px; border: none;
  background: var(--color-brand-800); color: #fff;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.ex__primary:disabled { opacity: 0.55; cursor: default; }
.ex__ghost {
  margin-top: 16px; margin-left: 10px; padding: 11px 16px; border-radius: 10px;
  border: 1px solid var(--color-line); background: var(--color-surface);
  font-size: 13px; font-weight: 600; color: var(--color-ink); cursor: pointer;
}
.ex__error { margin-top: 12px; font-size: 12.5px; color: var(--color-danger-500); }

.ex__bar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 14px;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 12px; padding: 10px 16px; margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}
.ex__bar-title { font-family: var(--font-display); font-size: 15px; color: var(--color-brand-800); }
.ex__bar-progress { margin-left: auto; font-size: 12px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.ex__timer {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; font-weight: 700; color: var(--color-ink); font-variant-numeric: tabular-nums;
}
.ex__timer--low { color: var(--color-danger-500); }
.ex__savestate { font-size: 11px; color: var(--color-muted-soft); width: 48px; }

.ex__section {
  margin: 22px 0 10px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-accent-700);
}
.ex__q {
  background: var(--color-surface); border: 1px solid var(--color-line-soft);
  border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
}
.ex__q-text { font-size: 14px; line-height: 1.55; color: var(--color-ink); margin-bottom: 10px; }
.ex__opt {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 10px; border-radius: 9px; cursor: pointer;
  font-size: 13.5px; line-height: 1.5; color: var(--color-ink-soft);
}
.ex__opt:hover { background: var(--color-surface-soft); }
.ex__opt--on { background: oklch(0.93 0.02 250); color: var(--color-ink); }
.ex__opt input { margin-top: 3px; }
.ex__opt-letter { font-weight: 700; color: var(--color-brand-700); }

.ex__footer {
  display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px;
  margin-top: 20px;
}
.ex__confirm { font-size: 12.5px; color: oklch(0.5 0.12 75); }

.ex__result { text-align: center; padding: 40px 0; }
.ex__result-score {
  font-family: var(--font-display); font-size: 56px; font-variant-numeric: tabular-nums;
}
.ex__result-score--pass { color: var(--color-success-500); }
.ex__result-score--fail { color: var(--color-danger-500); }
.ex__result-title { font-size: 24px; color: var(--color-brand-800); margin-top: 6px; }
.ex__result-sub { max-width: 560px; margin: 12px auto 0; font-size: 13.5px; line-height: 1.65; color: var(--color-ink-soft); }
</style>
