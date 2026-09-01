<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import PublicShell from '@/training/components/PublicShell.vue'
import { invokeEdge } from '@/training/lib/supabase'
import type { CertLevel } from '@/training/types'

interface PublicQuizQuestion {
  id: string
  prompt: string
  options: string[]
  sortOrder: number
}
interface PublicQuiz {
  id: string
  certLevel: CertLevel
  passingPct: number
  attemptsAllowed: number
  questions: PublicQuizQuestion[]
}
interface ReviewItem {
  prompt: string
  options: string[]
  yourAnswer: number | null
  correctIndex: number
  rationale: string
  isCorrect: boolean
}
interface QuizMeta {
  sessionId: string
  lectureTitle: string
  dshsContentArea: string
  hoursAwarded: string
  classDate: string | null
  quizStatus: 'Open' | 'Closed'
  availableCertLevels: CertLevel[]
  quiz?: PublicQuiz
  message?: string
}
interface SubmitResult {
  success: boolean
  scorePct: number
  passed: boolean
  passingPct: number
  correct: number
  total: number
  attemptsUsed: number
  attemptsAllowed: number
  attemptsLeft: number | null
  review: ReviewItem[]
}

const route = useRoute()
const state = ref<
  'loading' | 'error' | 'cert' | 'info' | 'quiz' | 'result' | 'closed'
>('loading')
const errMsg = ref('Unable to load the quiz.')
const meta = ref<QuizMeta | null>(null)
const quiz = ref<PublicQuiz | null>(null)
const certLevel = ref<CertLevel | ''>('')
const form = reactive({ name: '', email: '' })
const answers = ref<(number | null)[]>([])
const busy = ref(false)
const result = ref<SubmitResult | null>(null)
const tokenCache = ref('')

function fmtDate(d: string | null) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

const allAnswered = computed(
  () => quiz.value && answers.value.every((a) => a !== null),
)

onMounted(load)

async function load() {
  state.value = 'loading'
  const token = (route.query.t as string) || (route.query.token as string) || ''
  if (!token) {
    errMsg.value = 'No quiz link provided.'
    state.value = 'error'
    return
  }
  tokenCache.value = token
  try {
    const data = await invokeEdge<QuizMeta>('training-public', {
      action: 'getQuizByToken',
      token,
    })
    meta.value = data
    if (data.quizStatus !== 'Open') {
      state.value = 'closed'
      return
    }
    if (!data.availableCertLevels.length) {
      errMsg.value = 'No quizzes are configured for this session yet.'
      state.value = 'error'
      return
    }
    // If only one cert level has a quiz, auto-pick it.
    if (data.availableCertLevels.length === 1) {
      await selectCert(data.availableCertLevels[0])
      return
    }
    state.value = 'cert'
  } catch (e) {
    errMsg.value =
      e instanceof Error ? e.message : 'Could not load the quiz.'
    state.value = 'error'
  }
}

async function selectCert(cert: CertLevel) {
  certLevel.value = cert
  try {
    const data = await invokeEdge<QuizMeta>('training-public', {
      action: 'getQuizByToken',
      token: tokenCache.value,
      certLevel: cert,
    })
    meta.value = data
    if (!data.quiz) {
      errMsg.value = data.message || 'No quiz for that cert level.'
      state.value = 'error'
      return
    }
    quiz.value = data.quiz
    answers.value = data.quiz.questions.map(() => null)
    state.value = 'info'
  } catch (e) {
    errMsg.value =
      e instanceof Error ? e.message : 'Could not load the quiz.'
    state.value = 'error'
  }
}

function startQuiz() {
  if (!form.name.trim() || !form.email.trim()) {
    alert('Please enter your name and email.')
    return
  }
  state.value = 'quiz'
}

async function submit() {
  if (!quiz.value || !certLevel.value) return
  if (!allAnswered.value) {
    alert('Please answer every question.')
    return
  }
  busy.value = true
  try {
    const r = await invokeEdge<SubmitResult>('training-public', {
      action: 'submitQuiz',
      token: tokenCache.value,
      certLevel: certLevel.value,
      studentName: form.name.trim(),
      studentEmail: form.email.trim().toLowerCase(),
      answers: answers.value,
    })
    result.value = r
    state.value = 'result'
  } catch (e) {
    alert('Submit failed: ' + (e instanceof Error ? e.message : 'unknown'))
  } finally {
    busy.value = false
  }
}

function retake() {
  answers.value = quiz.value!.questions.map(() => null)
  result.value = null
  state.value = 'quiz'
}
function pickDifferentCert() {
  certLevel.value = ''
  quiz.value = null
  answers.value = []
  result.value = null
  state.value = 'cert'
}
</script>

<template>
  <PublicShell subtitle="Course Quiz">
    <div class="card body">
      <div v-if="state === 'loading'" class="center">
        <div class="spinner" />
        <p>Loading quiz…</p>
      </div>

      <div v-else-if="state === 'error'" class="center">
        <h3 class="bad">Quiz Unavailable</h3>
        <p class="muted">{{ errMsg }}</p>
      </div>

      <div v-else-if="state === 'closed'" class="center">
        <h3 class="bad">Quiz is Closed</h3>
        <p class="muted">
          The instructor hasn't opened this quiz yet, or it's already closed.
          Check with them in person.
        </p>
      </div>

      <!-- Cert level picker -->
      <template v-else-if="state === 'cert' && meta">
        <div class="s-title">{{ meta.lectureTitle }}</div>
        <div class="meta">
          <div>{{ fmtDate(meta.classDate) }}</div>
          <div v-if="meta.hoursAwarded">{{ meta.hoursAwarded }} Contact Hours</div>
          <div v-if="meta.dshsContentArea">{{ meta.dshsContentArea }}</div>
        </div>
        <div class="divider" />
        <h3>Pick your certification level</h3>
        <p class="muted">
          Your quiz questions are matched to your level of practice.
        </p>
        <div class="certgrid">
          <button
            v-if="meta.availableCertLevels.includes('Paramedic')"
            class="certbtn"
            @click="selectCert('Paramedic')"
          >
            <span class="certbtn__t">Paramedic</span>
            <span class="certbtn__d">Paramedic / NRP / TX-EMS-P</span>
          </button>
          <button
            v-if="meta.availableCertLevels.includes('EMT')"
            class="certbtn"
            @click="selectCert('EMT')"
          >
            <span class="certbtn__t">EMT / AEMT</span>
            <span class="certbtn__d">EMT-B, EMT-I, Advanced EMT</span>
          </button>
        </div>
      </template>

      <!-- Student info -->
      <template v-else-if="state === 'info' && quiz">
        <div class="s-title">{{ meta!.lectureTitle }}</div>
        <div class="meta">
          <div>{{ certLevel }} quiz · {{ quiz.questions.length }} questions</div>
          <div>Passing score: {{ quiz.passingPct }}%</div>
          <div>
            Attempts allowed:
            {{ quiz.attemptsAllowed === 0 ? 'Unlimited' : quiz.attemptsAllowed }}
          </div>
        </div>
        <div class="divider" />
        <label
          >Full Name <i>*</i>
          <input v-model="form.name" type="text" autocomplete="name" />
        </label>
        <label
          >Work Email <i>*</i>
          <input v-model="form.email" type="email" autocomplete="email" />
          <small>Must match the email you registered with.</small>
        </label>
        <button class="btn btn-primary full mt" @click="startQuiz">
          Start Quiz
        </button>
        <button class="btn full subtle" @click="pickDifferentCert">
          ← Pick a different cert level
        </button>
      </template>

      <!-- Questions -->
      <template v-else-if="state === 'quiz' && quiz">
        <div class="s-title quiz-title">{{ certLevel }} Quiz</div>
        <p class="muted small">
          {{ quiz.questions.length }} questions · pass at {{ quiz.passingPct }}%
        </p>
        <div class="divider" />
        <ol class="qlist">
          <li
            v-for="(q, idx) in quiz.questions"
            :key="q.id"
            class="qcard"
          >
            <div class="qprompt">{{ q.prompt }}</div>
            <div class="qopts">
              <label
                v-for="(opt, oIdx) in q.options"
                :key="oIdx"
                class="qopt"
                :class="{ 'qopt--picked': answers[idx] === oIdx }"
              >
                <input
                  type="radio"
                  :name="`q-${idx}`"
                  :value="oIdx"
                  :checked="answers[idx] === oIdx"
                  @change="answers[idx] = oIdx"
                />
                <span>{{ opt }}</span>
              </label>
            </div>
          </li>
        </ol>
        <button
          class="btn btn-primary full mt"
          :disabled="busy || !allAnswered"
          @click="submit"
        >
          {{ busy ? 'Submitting…' : 'Submit Quiz' }}
        </button>
        <p v-if="!allAnswered" class="muted small ctr">
          Answer every question to enable submit.
        </p>
      </template>

      <!-- Result -->
      <template v-else-if="state === 'result' && result">
        <div class="result-head">
          <h3 :class="result.passed ? 'good' : 'bad'">
            {{ result.passed ? 'Passed' : 'Did not pass' }}
          </h3>
          <div class="bigscore">{{ result.scorePct }}%</div>
          <p class="muted">
            {{ result.correct }} of {{ result.total }} correct ·
            Need {{ result.passingPct }}% to pass
          </p>
          <p class="muted small">
            Attempt {{ result.attemptsUsed }} of
            {{ result.attemptsAllowed === 0 ? '∞' : result.attemptsAllowed }}
          </p>
          <p v-if="result.passed" class="muted small ctr">
            You're cleared for CE credit. Once the instructor closes the
            quiz and awards CE Credits, you'll receive your certificate.
          </p>
          <p
            v-else-if="result.attemptsLeft === null || result.attemptsLeft > 0"
            class="muted small ctr"
          >
            Review your answers below — you can retake when ready.
          </p>
          <p v-else class="bad small ctr">
            You've used all your attempts. Your best score above is final.
          </p>
        </div>

        <div class="divider" />

        <ol class="review">
          <li
            v-for="(r, idx) in result.review"
            :key="idx"
            class="rcard"
            :class="r.isCorrect ? 'rcard--ok' : 'rcard--no'"
          >
            <div class="rcard__head">
              <span class="rcard__n">Q{{ idx + 1 }}</span>
              <span class="rcard__badge" :class="r.isCorrect ? 'good' : 'bad'">
                {{ r.isCorrect ? 'Correct' : 'Incorrect' }}
              </span>
            </div>
            <div class="rcard__prompt">{{ r.prompt }}</div>
            <ul class="ropts">
              <li
                v-for="(opt, oIdx) in r.options"
                :key="oIdx"
                class="ropt"
                :class="{
                  'ropt--correct': oIdx === r.correctIndex,
                  'ropt--your': oIdx === r.yourAnswer && oIdx !== r.correctIndex,
                  'ropt--yourcorrect': oIdx === r.yourAnswer && oIdx === r.correctIndex,
                }"
              >
                <span class="ropt__dot" />
                <span class="ropt__text">{{ opt }}</span>
                <span v-if="oIdx === r.correctIndex" class="ropt__tag good">✓ Correct</span>
                <span
                  v-else-if="oIdx === r.yourAnswer"
                  class="ropt__tag bad"
                >Your answer</span>
              </li>
            </ul>
            <div v-if="r.rationale" class="rcard__rationale">
              <span class="rcard__rationale-h">Rationale</span>
              <p>{{ r.rationale }}</p>
            </div>
          </li>
        </ol>

        <button
          v-if="!result.passed && (result.attemptsLeft === null || result.attemptsLeft > 0)"
          class="btn btn-primary full mt"
          @click="retake"
        >
          Retake Quiz
          <span v-if="result.attemptsLeft !== null">
            · {{ result.attemptsLeft }} attempt{{ result.attemptsLeft === 1 ? '' : 's' }} left
          </span>
        </button>
      </template>
    </div>
  </PublicShell>
</template>

<style scoped>
.body {
  padding: 24px;
}
.center {
  text-align: center;
  padding: 22px 0;
}
.muted {
  color: var(--color-muted);
  font-size: 14px;
}
.muted.small {
  font-size: 12.5px;
}
.muted.small.ctr {
  text-align: center;
  margin-top: 8px;
}
.bad {
  color: var(--color-danger-500);
}
.good {
  color: var(--color-success-500);
}
.bigscore {
  font-family: var(--font-display);
  font-size: 64px;
  line-height: 1;
  margin: 14px 0 6px;
  color: var(--color-ink);
}
.spinner {
  width: 34px;
  height: 34px;
  border: 3px solid var(--color-line);
  border-top-color: var(--color-brand-600);
  border-radius: 50%;
  margin: 0 auto 14px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.s-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 10px;
}
.quiz-title {
  text-align: center;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--color-ink-soft);
}
.divider {
  height: 1px;
  background: var(--color-line);
  margin: 18px 0;
}
h3 {
  margin: 0 0 6px;
  font-size: 16px;
}
label {
  display: block;
  font-size: 13px;
  color: var(--color-muted);
  margin-bottom: 14px;
}
label i {
  color: var(--color-danger-500);
  font-style: normal;
}
input[type='text'],
input[type='email'] {
  width: 100%;
  margin-top: 6px;
  padding: 13px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 16px;
  color: var(--color-ink);
  font-family: inherit;
}
small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
}
.full {
  width: 100%;
}
.mt {
  margin-top: 16px;
}
.subtle {
  margin-top: 8px;
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
}
.subtle:hover {
  color: var(--color-ink);
}

/* Cert picker grid */
.certgrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 14px;
}
@media (min-width: 480px) {
  .certgrid {
    grid-template-columns: 1fr 1fr;
  }
}
.certbtn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 16px;
  border: 1.5px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: all 140ms;
}
.certbtn:hover {
  border-color: var(--color-brand-500);
  background: var(--color-brand-50);
}
.certbtn__t {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
}
.certbtn__d {
  font-size: 12.5px;
  color: var(--color-muted);
}

/* Questions */
.qlist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.qcard {
  padding: 14px 16px;
  border: 1px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-surface);
}
.qprompt {
  font-size: 15px;
  color: var(--color-ink);
  margin-bottom: 12px;
  line-height: 1.45;
}
.qopts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qopt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 0;
  color: var(--color-ink);
  font-size: 14px;
  transition: all 120ms;
}
.qopt input[type='radio'] {
  margin: 0;
  width: 18px;
  height: 18px;
  accent-color: var(--color-brand-600);
  flex-shrink: 0;
}
.qopt--picked {
  border-color: var(--color-brand-500);
  background: var(--color-brand-50);
}

/* ── Result review ──────────────────────────────────────────────── */
.result-head {
  text-align: center;
  padding-bottom: 4px;
}
.review {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rcard {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--color-surface);
}
.rcard--ok {
  border-color: var(--color-success-200, oklch(0.85 0.08 152));
  background: var(--color-success-50);
}
.rcard--no {
  border-color: var(--color-danger-200, oklch(0.85 0.1 28));
  background: var(--color-danger-50, oklch(0.97 0.04 28));
}
.rcard__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.rcard__n {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.rcard__badge {
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--color-surface);
}
.rcard__badge.good {
  background: oklch(0.92 0.08 152);
  color: oklch(0.32 0.1 152);
}
.rcard__badge.bad {
  background: oklch(0.92 0.08 28);
  color: oklch(0.36 0.13 28);
}
.rcard__prompt {
  font-size: 15px;
  color: var(--color-ink);
  margin-bottom: 10px;
  line-height: 1.45;
}
.ropts {
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ropt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  font-size: 13.5px;
  color: var(--color-ink);
}
.ropt__dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 1.5px solid var(--color-muted-soft);
  flex-shrink: 0;
}
.ropt__text {
  flex: 1;
}
.ropt__tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.ropt__tag.good {
  background: oklch(0.92 0.08 152);
  color: oklch(0.32 0.1 152);
}
.ropt__tag.bad {
  background: oklch(0.92 0.08 28);
  color: oklch(0.36 0.13 28);
}
.ropt--correct {
  border-color: oklch(0.7 0.13 152);
  background: oklch(0.97 0.06 152);
}
.ropt--correct .ropt__dot {
  background: oklch(0.6 0.13 152);
  border-color: oklch(0.6 0.13 152);
}
.ropt--your {
  border-color: oklch(0.7 0.13 28);
}
.ropt--your .ropt__dot {
  background: oklch(0.6 0.13 28);
  border-color: oklch(0.6 0.13 28);
}
.ropt--yourcorrect .ropt__dot {
  background: oklch(0.55 0.15 152);
  border-color: oklch(0.55 0.15 152);
}
.rcard__rationale {
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--color-surface);
  border: 1px dashed var(--color-line);
  border-radius: 8px;
}
.rcard__rationale-h {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-600);
}
.rcard__rationale p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
</style>
