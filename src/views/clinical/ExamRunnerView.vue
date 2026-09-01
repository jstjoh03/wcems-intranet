<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Check, Clock } from 'lucide-vue-next'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useExams, type ExamAnswers } from '@/composables/useExams'

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

const answers = ref<ExamAnswers>({})
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

function toggleMulti(no: number, letter: string) {
  const k = String(no)
  const cur = Array.isArray(answers.value[k]) ? [...(answers.value[k] as string[])] : []
  const i = cur.indexOf(letter)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(letter)
  if (cur.length) answers.value[k] = cur.sort()
  else delete answers.value[k]
}

function isPicked(no: number, letter: string): boolean {
  const v = answers.value[String(no)]
  return Array.isArray(v) ? v.includes(letter) : v === letter
}

const answeredCount = computed(
  () => Object.values(answers.value).filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length,
)
const totalCount = computed(() => definition.value?.questions.length ?? 0)

/* Question images (rhythm strips, reference charts) — signed URLs from
   the exam-assets bucket, loaded once the definition is visible. */
const imageUrls = ref<Record<string, string>>({})
watch(
  definition,
  async (d) => {
    if (!d) return
    for (const q of d.questions) {
      if (q.image && !imageUrls.value[q.image]) {
        const { data } = await supabase.storage
          .from('exam-assets')
          .createSignedUrl(`${d.slug}/${q.image}`, 7200)
        if (data?.signedUrl) imageUrls.value = { ...imageUrls.value, [q.image]: data.signedUrl }
      }
    }
  },
  { immediate: true },
)

/* ── One question at a time (standardized-testing format) ─────────── */
const questions = computed(() => definition.value?.questions ?? [])
const idx = ref(0)
const reviewing = ref(false)
const currentQ = computed(() => questions.value[idx.value] ?? null)

function isAnswered(no: number): boolean {
  const v = answers.value[String(no)]
  return Array.isArray(v) ? v.length > 0 : !!v
}

function goTo(i: number) {
  idx.value = Math.min(Math.max(i, 0), questions.value.length - 1)
  reviewing.value = false
  confirmSubmit.value = false
  window.scrollTo({ top: 0 })
}
function next() {
  if (idx.value >= questions.value.length - 1) {
    reviewing.value = true
    window.scrollTo({ top: 0 })
  } else {
    goTo(idx.value + 1)
  }
}
function prev() {
  if (reviewing.value) {
    reviewing.value = false
    return
  }
  goTo(idx.value - 1)
}

const unanswered = computed(() => questions.value.filter((q) => !isAnswered(q.no)))

function openReview() {
  reviewing.value = true
  window.scrollTo({ top: 0 })
}

/* Resuming mid-exam lands on the first unanswered question. */
let positioned = false
watch(
  [assignment, definition],
  ([a, d]) => {
    if (positioned || !a || !d || a.status !== 'in_progress') return
    positioned = true
    const first = d.questions.findIndex((q) => !isAnswered(q.no))
    idx.value = first >= 0 ? first : d.questions.length - 1
  },
  { immediate: true },
)

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

/* -- Missed-question review (post-submit) ---------------------------
   Server-computed via the exam_review RPC: the questions missed, the
   candidate's answer, and the protocol reference to study. The correct
   answer is never returned - the bank is reused for retests. */
interface ReviewItem {
  no: number
  section: string | null
  text: string
  options: Record<string, string>
  type?: 'single' | 'multi'
  image?: string | null
  your: string | string[] | null
  critical: boolean
  ref: string | null
}
const reviewItems = ref<ReviewItem[] | null>(null)
const reviewLoading = ref(false)
const reviewError = ref<string | null>(null)

async function loadReview() {
  if (reviewLoading.value || reviewItems.value) return
  reviewLoading.value = true
  reviewError.value = null
  const { data, error } = await supabase.rpc('exam_review', {
    p_assignment: assignmentId.value,
  })
  reviewLoading.value = false
  if (error) {
    reviewError.value = error.message
    return
  }
  reviewItems.value = (data ?? []) as ReviewItem[]
}

function isYourAnswer(item: ReviewItem, letter: string): boolean {
  return Array.isArray(item.your) ? item.your.includes(letter) : item.your === letter
}
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
          Clean pass — the protocol requirement on your credentialing checklist has been checked off
          automatically, and a completion certificate will be added to your employee documents.
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

      <!-- Missed-question review -->
      <div class="ex__review-missed">
        <button
          v-if="reviewItems === null"
          type="button"
          class="ex__reviewbtn"
          :disabled="reviewLoading"
          @click="loadReview"
        >
          {{ reviewLoading ? 'Loading…' : 'Review the questions you missed' }}
        </button>
        <div v-if="reviewError" class="ex__error">{{ reviewError }}</div>

        <template v-if="reviewItems !== null">
          <p v-if="reviewItems.length === 0" class="ex__rv-none">
            Nothing to review — every question was answered correctly.
          </p>
          <template v-else>
            <h2 class="display ex__rv-title">Missed questions ({{ reviewItems.length }})</h2>
            <p class="ex__rv-sub">
              Your answer is marked on each question, along with the protocol section to
              study. Correct answers aren't shown — review the referenced protocol and
              see the Clinical Department with questions.
            </p>
            <div v-for="item in reviewItems" :key="item.no" class="ex__rv-q">
              <div class="ex__rv-head">
                <b>Question {{ item.no }}</b>
                <span v-if="item.section" class="ex__rv-sec">{{ item.section }}</span>
                <span v-if="item.critical" class="ex__rv-crit">critical item</span>
              </div>
              <div class="ex__rv-text">{{ item.text }}</div>
              <img
                v-if="item.image && imageUrls[item.image]"
                :src="imageUrls[item.image]"
                class="ex__q-img"
                alt="Question reference image"
              />
              <div
                v-for="(text, letter) in item.options"
                :key="letter"
                class="ex__rv-opt"
                :class="{ 'ex__rv-opt--yours': isYourAnswer(item, letter) }"
              >
                <span class="ex__opt-letter">{{ letter }}</span>
                <span>{{ text }}</span>
                <span v-if="isYourAnswer(item, letter)" class="ex__rv-yours">your answer</span>
              </div>
              <div v-if="item.ref" class="ex__rv-ref">Study: {{ item.ref }}</div>
            </div>
          </template>
        </template>
      </div>
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

    <!-- Runner — one question per screen -->
    <template v-else-if="assignment.status === 'in_progress'">
      <div class="ex__bar">
        <div class="ex__bar-title">{{ definition.title }}</div>
        <span class="ex__bar-progress">
          <template v-if="!reviewing">Question {{ idx + 1 }} of {{ totalCount }} · </template>{{ answeredCount }} answered
        </span>
        <span class="ex__timer" :class="{ 'ex__timer--low': (remainingMs ?? 0) < 10 * 60_000 }">
          <Clock :size="13" :stroke-width="2" /> {{ remainingText }}
        </span>
        <span class="ex__savestate">{{ saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : '' }}</span>
        <button v-if="!reviewing" type="button" class="ex__bar-review" @click="openReview">
          Review &amp; submit
        </button>
      </div>

      <!-- Review & submit screen -->
      <div v-if="reviewing" class="ex__review">
        <h2 class="display ex__review-title">Review &amp; submit</h2>
        <p class="ex__review-sub">
          You've answered <b>{{ answeredCount }}</b> of <b>{{ totalCount }}</b> questions.
          <template v-if="unanswered.length"> Unanswered questions score as incorrect — click a number to return to it.</template>
        </p>
        <div v-if="unanswered.length" class="ex__review-missing">
          <button
            v-for="q in unanswered"
            :key="q.no"
            type="button"
            class="ex__navcell ex__navcell--open"
            @click="goTo(questions.indexOf(q))"
          >{{ q.no }}</button>
        </div>
        <div v-if="submitError" class="ex__error">{{ submitError }}</div>
        <div class="ex__footer ex__footer--review">
          <button type="button" class="ex__navbtn" @click="reviewing = false">
            <ArrowLeft :size="14" :stroke-width="2" /> Back to questions
          </button>
          <span v-if="confirmSubmit" class="ex__confirm">
            {{ totalCount - answeredCount }} unanswered — submit anyway?
          </span>
          <button type="button" class="ex__primary" :disabled="submitting" @click="doSubmit(false)">
            <Check :size="14" :stroke-width="2.5" />
            {{ submitting ? 'Submitting…' : confirmSubmit ? 'Yes, submit now' : 'Submit examination' }}
          </button>
        </div>
      </div>

      <!-- Single question -->
      <template v-else-if="currentQ">
        <div class="ex__q ex__q--single">
          <div v-if="currentQ.section" class="ex__section ex__section--inline">{{ currentQ.section }}</div>
          <div class="ex__q-text">
            <b>{{ currentQ.no }}.</b> {{ currentQ.text }}
            <span v-if="currentQ.type === 'multi'" class="ex__multi-hint">select all that apply</span>
          </div>
          <img
            v-if="currentQ.image && imageUrls[currentQ.image]"
            :src="imageUrls[currentQ.image]"
            class="ex__q-img"
            alt="Question reference image"
          />
          <template v-if="currentQ.type === 'multi'">
            <label
              v-for="(text, letter) in currentQ.options"
              :key="letter"
              class="ex__opt"
              :class="{ 'ex__opt--on': isPicked(currentQ.no, letter) }"
            >
              <input
                type="checkbox"
                :checked="isPicked(currentQ.no, letter)"
                @change="toggleMulti(currentQ.no, letter)"
              />
              <span class="ex__opt-letter">{{ letter }}</span>
              <span>{{ text }}</span>
            </label>
          </template>
          <template v-else>
            <label
              v-for="(text, letter) in currentQ.options"
              :key="letter"
              class="ex__opt"
              :class="{ 'ex__opt--on': answers[String(currentQ.no)] === letter }"
            >
              <input
                v-model="answers[String(currentQ.no)]"
                type="radio"
                :name="`q${currentQ.no}`"
                :value="letter"
              />
              <span class="ex__opt-letter">{{ letter }}</span>
              <span>{{ text }}</span>
            </label>
          </template>
        </div>

        <div class="ex__footer ex__footer--nav">
          <button type="button" class="ex__navbtn" :disabled="idx === 0" @click="prev">
            <ArrowLeft :size="14" :stroke-width="2" /> Previous
          </button>
          <button type="button" class="ex__navbtn ex__navbtn--primary" @click="next">
            {{ idx === totalCount - 1 ? 'Review answers' : 'Next' }}
            <ArrowRight v-if="idx < totalCount - 1" :size="14" :stroke-width="2" />
          </button>
        </div>

        <!-- Question navigator -->
        <div class="ex__navgrid" aria-label="Question navigator">
          <button
            v-for="(q, i) in questions"
            :key="q.no"
            type="button"
            class="ex__navcell"
            :class="{
              'ex__navcell--done': isAnswered(q.no),
              'ex__navcell--current': i === idx,
            }"
            :aria-label="`Question ${q.no}${isAnswered(q.no) ? ' (answered)' : ''}`"
            @click="goTo(i)"
          >{{ q.no }}</button>
        </div>
      </template>
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
.ex__section--inline { margin: 0 0 10px; }
.ex__q--single { padding: 20px 22px; }
.ex__q--single .ex__q-text { font-size: 15.5px; line-height: 1.6; }

.ex__footer--nav { justify-content: space-between; margin-top: 14px; }
.ex__navbtn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 18px; border-radius: 9px;
  border: 1px solid var(--color-line); background: var(--color-surface);
  font-family: var(--font-sans); font-size: 13px; font-weight: 600;
  color: var(--color-ink-soft); cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.ex__navbtn:hover:not(:disabled) { border-color: var(--color-muted-soft); color: var(--color-ink); }
.ex__navbtn:disabled { opacity: 0.4; cursor: default; }
.ex__navbtn--primary {
  min-width: 118px; justify-content: center;
  background: var(--color-brand-800); border-color: var(--color-brand-800); color: #fff;
}
.ex__navbtn--primary:hover:not(:disabled) { background: var(--color-brand-900, var(--color-brand-800)); color: #fff; }
.ex__bar-review {
  display: inline-flex; align-items: center;
  padding: 5px 11px; border-radius: 7px;
  border: 1px solid var(--color-line); background: transparent;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
  color: var(--color-ink-soft); cursor: pointer; white-space: nowrap;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.ex__bar-review:hover { border-color: var(--color-accent-strong, #a8842c); color: var(--color-ink); }

.ex__navgrid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px; margin-top: 20px;
  background: var(--color-surface); border: 1px solid var(--color-line-soft);
  border-radius: 12px; padding: 12px;
}
.ex__navcell {
  height: 32px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--color-line); background: var(--color-surface);
  font-family: var(--font-sans); font-size: 12px; font-weight: 600;
  color: var(--color-muted); font-variant-numeric: tabular-nums;
}
.ex__navcell:hover { border-color: var(--color-muted-soft); color: var(--color-ink); }
.ex__navcell--done {
  background: oklch(0.93 0.02 250); border-color: oklch(0.85 0.03 250);
  color: var(--color-brand-700);
}
.ex__navcell--current {
  border-color: var(--color-accent-600); color: var(--color-accent-700);
  box-shadow: 0 0 0 2px oklch(0.9 0.06 90 / 0.55);
}
.ex__navcell--open {
  background: oklch(0.96 0.05 60); border-color: oklch(0.85 0.08 60);
  color: oklch(0.48 0.13 45);
}

.ex__review {
  background: var(--color-surface); border: 1px solid var(--color-line-soft);
  border-radius: 12px; padding: 22px 24px;
}
.ex__review-title { font-size: 22px; color: var(--color-brand-800); }
.ex__review-sub { margin-top: 8px; font-size: 13.5px; line-height: 1.6; color: var(--color-ink-soft); }
.ex__review-missing {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px; margin-top: 14px;
}
.ex__review-missing .ex__navcell { height: 32px; }
.ex__footer--review { justify-content: flex-end; }
.ex__footer--review .ex__navbtn { margin-right: auto; }
.ex__footer--review .ex__primary { margin-top: 0; }
.ex__q {
  background: var(--color-surface); border: 1px solid var(--color-line-soft);
  border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
}
.ex__q-text { font-size: 14px; line-height: 1.55; color: var(--color-ink); margin-bottom: 10px; }
.ex__multi-hint {
  margin-left: 8px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--color-accent-700);
  background: oklch(0.95 0.06 90); padding: 2px 8px; border-radius: 999px; white-space: nowrap;
}
.ex__q-img {
  display: block; max-width: 100%; border: 1px solid var(--color-line);
  border-radius: 8px; margin: 0 0 12px; background: #fff;
}
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

/* -- Missed-question review ---------------------------------------- */
.ex__review-missed { max-width: 720px; margin: 26px auto 0; text-align: left; }
.ex__reviewbtn {
  display: block; margin: 0 auto;
  background: none; border: 1px solid var(--color-line); border-radius: 9px;
  padding: 9px 18px; font-family: var(--font-sans);
  font-size: 13px; font-weight: 600; color: var(--color-brand-600); cursor: pointer;
}
.ex__reviewbtn:hover:not(:disabled) { border-color: var(--color-accent-600); color: var(--color-brand-700); }
.ex__reviewbtn:disabled { opacity: 0.6; }
.ex__rv-none { text-align: center; font-size: 13px; color: var(--color-success-500); font-weight: 600; }
.ex__rv-title { font-size: 20px; color: var(--color-brand-800); margin-bottom: 6px; }
.ex__rv-sub { font-size: 12.5px; line-height: 1.6; color: var(--color-muted); margin-bottom: 14px; }
.ex__rv-q {
  background: var(--color-surface); border: 1px solid var(--color-line-soft);
  border-radius: 12px; padding: 14px 16px; margin-bottom: 10px;
}
.ex__rv-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; color: var(--color-ink); }
.ex__rv-sec { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-accent-700); }
.ex__rv-crit {
  font-size: 10px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;
  color: oklch(0.45 0.15 30); background: oklch(0.96 0.05 30);
  border-radius: 999px; padding: 2px 8px;
}
.ex__rv-text { font-size: 13.5px; line-height: 1.55; color: var(--color-ink); margin-bottom: 8px; }
.ex__rv-opt {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 6px 10px; border-radius: 8px; font-size: 13px; line-height: 1.5; color: var(--color-ink-soft);
}
.ex__rv-opt--yours { background: oklch(0.96 0.05 30); color: var(--color-ink); }
.ex__rv-yours {
  margin-left: auto; font-size: 10px; font-weight: 800; letter-spacing: 0.05em;
  text-transform: uppercase; color: oklch(0.48 0.14 30); white-space: nowrap;
}
.ex__rv-ref {
  margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--color-accent-700);
}
</style>
