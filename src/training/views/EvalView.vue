<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import PublicShell from '@/training/components/PublicShell.vue'
import { invokeEdge } from '@/training/lib/supabase'
import type { PublicSession, CourseTemplate } from '@/training/types'
import {
  buildQuestions,
  buildInstructorList,
  buildSubmissionPayload,
  courseTypeFromName,
  LIKERT5_LABELS,
  RATING6_OPTIONS,
  type EvalQuestion,
} from '@/training/lib/ahaEval'
import {
  buildLectureQuestions,
  buildLectureSubmissionPayload,
} from '@/training/lib/lectureEval'

const route = useRoute()
const state = ref<'loading' | 'error' | 'eval' | 'success'>('loading')
const errMsg = ref('Evaluation unavailable')
const session = ref<PublicSession | null>(null)
const courseType = ref<CourseTemplate>('BLS')
const questions = ref<EvalQuestion[]>([])
const answers = reactive<Record<string, string>>({})
const idx = ref(0)
const busy = ref(false)

function fmtDate(d: string) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

const instructors = computed(() =>
  session.value ? buildInstructorList(session.value) : [],
)
const q = computed(() => questions.value[idx.value])
const progress = computed(() =>
  questions.value.length
    ? ((idx.value + 1) / questions.value.length) * 100
    : 0,
)
const isLast = computed(() => idx.value === questions.value.length - 1)
const courseName = computed(() => {
  const s = session.value
  if (!s) return ''
  return s.sessionType === 'Lecture'
    ? s.lectureTitle || s.title
    : s.cardCourseName || s.title
})

onMounted(load)

async function load() {
  state.value = 'loading'
  const token =
    (route.query.token as string) || (route.query.t as string) || ''
  if (!token) {
    errMsg.value = 'No evaluation token provided'
    state.value = 'error'
    return
  }
  try {
    const data = await invokeEdge<PublicSession & { tokenKind: string }>(
      'training-public',
      { action: 'getSessionByToken', token },
    )
    session.value = data
    if (data.evalStatus !== 'Open') {
      errMsg.value = 'Evaluations are not open for this session'
      state.value = 'error'
      return
    }
    // Lectures get a short generic CE eval; AHA card classes get the
    // full 2025 card-class question set keyed off the discipline name.
    if (data.sessionType === 'Lecture') {
      courseType.value = 'BLS' // sentinel — payload uses CourseType=LECTURE
      questions.value = buildLectureQuestions(instructors.value)
    } else {
      courseType.value = courseTypeFromName(data.cardCourseName || data.title)
      questions.value = buildQuestions(courseType.value, instructors.value)
    }
    // Pre-store instructor names so they ride along in the payload.
    questions.value.forEach((qq) => {
      if (qq.instructorName && qq.instructorIndex) {
        answers[`Q6_Instructor${qq.instructorIndex}_Name`] = qq.instructorName
      }
    })
    state.value = 'eval'
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : 'Invalid evaluation link'
    state.value = 'error'
  }
}

function next() {
  const cur = q.value
  if (cur.type === 'info') {
    if (!answers.StudentName || !answers.StudentEmail) {
      alert('Please enter your name and email')
      return
    }
  } else if (cur.required && !answers[cur.id]) {
    alert('Please answer this question before continuing')
    return
  }
  if (isLast.value) {
    void submit()
  } else {
    idx.value++
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}
function prev() {
  if (idx.value > 0) {
    idx.value--
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

async function submit() {
  busy.value = true
  try {
    const isLecture = session.value!.sessionType === 'Lecture'
    const payload = isLecture
      ? buildLectureSubmissionPayload(
          session.value!.sessionId,
          session.value!.title,
          session.value!.dshsContentArea,
          { ...answers },
        )
      : buildSubmissionPayload(
          session.value!.sessionId,
          session.value!.title,
          courseType.value,
          { ...answers },
        )
    await invokeEdge('training-public', { action: 'submitEval', ...payload })
    state.value = 'success'
  } catch {
    alert('Error submitting evaluation. Please try again.')
    busy.value = false
  }
}
</script>

<template>
  <PublicShell subtitle="Course Evaluation">
    <div v-if="state === 'loading'" class="card pad center">
      <div class="spinner" />
      <p>Loading evaluation…</p>
    </div>

    <div v-else-if="state === 'error'" class="card pad center">
      <h3 class="bad">Unable to Load</h3>
      <p class="muted">{{ errMsg }}</p>
    </div>

    <div v-else-if="state === 'success'" class="card pad center">
      <h3 class="good">Thank You!</h3>
      <p class="muted">Your evaluation has been submitted successfully.</p>
    </div>

    <template v-else>
      <div class="card pad info">
        <div class="s-title">{{ courseName }}</div>
        <div class="meta">
          <div><b>Date:</b> {{ fmtDate(session!.classDate) }}</div>
          <div v-if="instructors.length">
            <b>Instructor{{ instructors.length > 1 ? 's' : '' }}:</b>
            {{ instructors.map((i) => i.name).join(', ') }}
          </div>
          <div v-if="session!.sessionType === 'Lecture'">
            <b>{{ session!.dshsContentArea ? 'DSHS Content Area:' : 'Course Type:' }}</b>
            {{ session!.dshsContentArea || 'CE Lecture' }}
          </div>
          <div v-else><b>Course Type:</b> {{ courseType }}</div>
        </div>
      </div>

      <div class="card pad">
        <div class="bar"><div class="fill" :style="{ width: progress + '%' }" /></div>
        <div class="ptext">
          Question {{ idx + 1 }} of {{ questions.length }}
        </div>

        <div class="qcard">
          <template v-if="q.type === 'info'">
            <div class="qnum">{{ q.number }}</div>
            <div class="qtext">Please enter your information</div>
            <label
              >Your Name <i>*</i>
              <input v-model="answers.StudentName" type="text" />
            </label>
            <label
              >Your Email <i>*</i>
              <input v-model="answers.StudentEmail" type="email" />
            </label>
          </template>

          <template v-else-if="q.type === 'header'">
            <div class="qnum">Question {{ q.number }}</div>
            <div class="qtext">{{ q.text }}</div>
            <div class="qsub">Please rate each objective on the following pages</div>
          </template>

          <template v-else-if="q.type === 'likert5'">
            <div class="qnum">Question {{ q.number }}</div>
            <div class="qtext">{{ q.text }}</div>
            <div class="likert">
              <label
                v-for="v in ['5', '4', '3', '2', '1']"
                :key="v"
                class="lk"
                :class="{ sel: answers[q.id] === v }"
              >
                <input
                  v-model="answers[q.id]"
                  type="radio"
                  :value="v"
                />
                <span class="lk-n">{{ v }}</span>
                <span class="lk-l">{{ LIKERT5_LABELS[v] }}</span>
              </label>
            </div>
          </template>

          <template v-else-if="q.type === 'yesno'">
            <div class="qnum">Question {{ q.number }}</div>
            <div class="qtext">{{ q.text }}</div>
            <div class="yesno">
              <label
                v-for="v in ['Yes', 'No']"
                :key="v"
                class="yn"
                :class="{ sel: answers[q.id] === v }"
              >
                <input v-model="answers[q.id]" type="radio" :value="v" />
                {{ v }}
              </label>
            </div>
          </template>

          <template v-else-if="q.type === 'rating6'">
            <div class="qnum">Question {{ q.number }}</div>
            <div class="qtext">{{ q.text }}</div>
            <div class="rating">
              <label
                v-for="v in RATING6_OPTIONS"
                :key="v"
                class="rt"
                :class="{ sel: answers[q.id] === v }"
              >
                <input v-model="answers[q.id]" type="radio" :value="v" />
                {{ v }}
              </label>
            </div>
          </template>

          <template v-else-if="q.type === 'textarea'">
            <div class="qnum">Question {{ q.number }}</div>
            <div class="qtext">{{ q.text }}</div>
            <textarea
              v-model="answers[q.id]"
              rows="5"
              placeholder="Enter your response…"
            />
          </template>
        </div>

        <div class="nav">
          <button
            class="btn btn-secondary"
            :disabled="idx === 0"
            @click="prev"
          >
            ← Back
          </button>
          <button class="btn btn-primary" :disabled="busy" @click="next">
            {{ isLast ? (busy ? 'Submitting…' : 'Submit Evaluation') : 'Next →' }}
          </button>
        </div>
      </div>
    </template>
  </PublicShell>
</template>

<style scoped>
.pad {
  padding: 22px;
}
.center {
  text-align: center;
  padding: 30px 0;
}
.muted {
  color: var(--color-muted);
}
.bad {
  color: var(--color-danger-500);
}
.good {
  color: var(--color-success-500);
}
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--color-line);
  border-top-color: var(--color-brand-600);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.info {
  margin-bottom: 14px;
}
.s-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 10px;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--color-muted);
}
.meta b {
  color: var(--color-ink);
}
.bar {
  height: 6px;
  background: var(--color-line);
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-brand-600), var(--color-brand-400));
  transition: width 0.3s;
}
.ptext {
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  margin: 10px 0 18px;
  font-weight: 500;
}
.qcard {
  margin-bottom: 22px;
}
.qnum {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-brand-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.qtext {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 18px;
}
.qsub {
  font-size: 14px;
  color: var(--color-muted);
  font-style: italic;
}
label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
}
label i {
  color: var(--color-danger-500);
  font-style: normal;
}
input[type='text'],
input[type='email'],
textarea {
  width: 100%;
  margin-top: 8px;
  padding: 13px 14px;
  border-radius: 10px;
  border: 1.5px solid var(--color-line);
  background: var(--color-surface);
  font-size: 16px;
  font-weight: 400;
  color: var(--color-ink);
  font-family: inherit;
}
textarea {
  resize: vertical;
}
.likert {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.lk {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px 4px;
  min-height: 92px;
  border: 2px solid var(--color-line);
  border-radius: 12px;
  cursor: pointer;
  text-align: center;
  margin: 0;
}
.lk input {
  display: none;
}
.lk-n {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-muted);
}
.lk-l {
  font-size: 10px;
  color: var(--color-muted);
  margin-top: 6px;
  line-height: 1.25;
}
.lk.sel {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
}
.lk.sel .lk-n,
.lk.sel .lk-l {
  color: #fff;
}
.yesno {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.yn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  border: 2px solid var(--color-line);
  border-radius: 12px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.yn input {
  display: none;
}
.yn.sel {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
  color: #fff;
}
.rating {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.rt {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 10px;
  min-height: 58px;
  border: 2px solid var(--color-line);
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  margin: 0;
}
.rt input {
  display: none;
}
.rt.sel {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
  color: #fff;
}
.nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.nav .btn {
  padding: 15px;
}
@media (max-width: 480px) {
  .rating {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
