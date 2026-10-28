<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, Check, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import SignaturePad from '@/components/primitives/SignaturePad.vue'

/**
 * Rhythm identification — self check-off. The trainee works the strip
 * deck on their own login: identify every strip, sign, submit. Graded
 * server-side (skills_rhythm_submit) against the evaluator key; a
 * perfect deck records a signed skills_evaluations row under the
 * "Rhythm Identification (Self)" check-off, which shows on the board
 * like any station. Misses show strip numbers only — never answers.
 */

const router = useRouter()
const auth = useAuthStore()

const OPTIONS: { key: string; label: string }[] = [
  { key: 'nsr', label: 'Normal sinus rhythm' },
  { key: 'sinus_brady', label: 'Sinus bradycardia' },
  { key: 'sinus_tach', label: 'Sinus tachycardia' },
  { key: 'afib', label: 'Atrial fibrillation' },
  { key: 'aflutter', label: 'Atrial flutter' },
  { key: 'svt', label: 'SVT' },
  { key: 'vtach', label: 'Ventricular tachycardia' },
  { key: 'vfib', label: 'Ventricular fibrillation' },
  { key: 'first_degree_block', label: 'First-degree AV block' },
  { key: 'second_degree_1', label: 'Second-degree AV block — Type I' },
  { key: 'second_degree_2', label: 'Second-degree AV block — Type II' },
  { key: 'third_degree_block', label: 'Third-degree (complete) AV block' },
  { key: 'stemi', label: 'Sinus rhythm with acute STEMI' },
  { key: 'paced', label: 'Paced rhythm' },
  { key: 'asystole', label: 'Asystole' },
]

interface Strip {
  id: number
  image_path: string
}

const loading = ref(true)
const loadError = ref<string | null>(null)
const strips = ref<Strip[]>([])
const picks = ref<Record<number, string>>({})
const idx = ref(0)
const stage = ref<'quiz' | 'review' | 'done'>('quiz')
const signature = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const result = ref<{ passed: boolean; total: number; correct: number; missed: number[]; recorded: boolean } | null>(null)
const alreadyDone = ref(false)

const current = computed(() => strips.value[idx.value] ?? null)
const answeredCount = computed(() => strips.value.filter((s) => picks.value[s.id]).length)
const allAnswered = computed(() => strips.value.length > 0 && answeredCount.value === strips.value.length)

function labelFor(key: string | undefined): string {
  return OPTIONS.find((o) => o.key === key)?.label ?? '—'
}

onMounted(async () => {
  if (auth.usingDevStub) {
    strips.value = [
      { id: 1, image_path: '/skills/rhythms/strip-1.jpg' },
      { id: 2, image_path: '/skills/rhythms/strip-2.jpg' },
      { id: 3, image_path: '/skills/rhythms/strip-3.jpg' },
    ]
    loading.value = false
    return
  }
  const { data, error } = await supabase.rpc('skills_rhythm_quiz')
  if (error) {
    loadError.value = 'Could not load the strip deck. Pull up this page on the portal while signed in.'
  } else {
    strips.value = (data ?? []) as Strip[]
  }
  /* Already recorded? Show the completed state instead of a retake. */
  const uid = auth.appUser?.id
  if (uid) {
    const { data: co } = await supabase.from('skills_checkoffs').select('id').eq('key', 'rhythm_self').single()
    if (co) {
      const { data: ev } = await supabase
        .from('skills_evaluations')
        .select('id, eval_date')
        .eq('checkoff_id', co.id)
        .eq('candidate_id', uid)
        .maybeSingle()
      if (ev) alreadyDone.value = true
    }
  }
  loading.value = false
})

function pick(key: string) {
  if (!current.value) return
  picks.value = { ...picks.value, [current.value.id]: key }
  if (idx.value < strips.value.length - 1) idx.value += 1
  else stage.value = 'review'
}

async function submit() {
  if (!allAnswered.value || submitting.value) return
  submitError.value = null
  if (!signature.value) {
    submitError.value = 'Sign before submitting — the signature goes on your check-off record.'
    return
  }
  submitting.value = true
  if (auth.usingDevStub) {
    result.value = { passed: true, total: strips.value.length, correct: strips.value.length, missed: [], recorded: false }
    stage.value = 'done'
    submitting.value = false
    return
  }
  const answers: Record<string, string> = {}
  for (const s of strips.value) answers[String(s.id)] = picks.value[s.id]
  const { data, error } = await supabase.rpc('skills_rhythm_submit', {
    p_answers: answers,
    p_signature: signature.value,
  })
  submitting.value = false
  if (error) {
    submitError.value = error.message || 'Submit failed — try again.'
    return
  }
  result.value = data as typeof result.value
  stage.value = 'done'
}

function retake() {
  picks.value = {}
  idx.value = 0
  signature.value = null
  result.value = null
  submitError.value = null
  stage.value = 'quiz'
}
</script>

<template>
  <div class="rq">
    <header class="rq__header">
      <div class="rq__head-left">
        <Activity :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <div>
          <h1 class="display rq__title">Rhythm identification</h1>
          <div class="rq__meta">
            Self check-off · identify every strip, sign, submit · graded automatically
          </div>
        </div>
      </div>
      <button type="button" class="rq__btn" @click="router.push('/skills')">Skills Day</button>
    </header>

    <div v-if="loading" class="rq__empty">Loading the deck…</div>
    <div v-else-if="loadError" class="rq__empty">{{ loadError }}</div>
    <div v-else-if="!strips.length" class="rq__empty">No strips are loaded in the deck yet.</div>

    <template v-else>
      <div v-if="alreadyDone && stage !== 'done'" class="rq__banner">
        <Check :size="15" :stroke-width="2.4" />
        You've already completed this check-off — it's recorded on the board. Running it again is practice only.
      </div>

      <!-- Quiz -->
      <section v-if="stage === 'quiz'" class="rq__card">
        <div class="rq__progress">
          Strip {{ idx + 1 }} of {{ strips.length }}
          <span class="rq__progress-done">{{ answeredCount }} answered</span>
        </div>
        <img v-if="current" :src="current.image_path" class="rq__strip" alt="Rhythm strip" />
        <div class="rq__options">
          <button
            v-for="o in OPTIONS"
            :key="o.key"
            type="button"
            class="rq__opt"
            :class="{ 'rq__opt--on': current && picks[current.id] === o.key }"
            @click="pick(o.key)"
          >
            {{ o.label }}
          </button>
        </div>
        <div class="rq__nav">
          <button type="button" class="rq__btn" :disabled="idx === 0" @click="idx -= 1">
            <ChevronLeft :size="15" :stroke-width="2" /> Back
          </button>
          <button
            type="button"
            class="rq__btn"
            :disabled="idx >= strips.length - 1 && !allAnswered"
            @click="idx < strips.length - 1 ? (idx += 1) : (stage = 'review')"
          >
            {{ idx < strips.length - 1 ? 'Next' : 'Review' }} <ChevronRight :size="15" :stroke-width="2" />
          </button>
        </div>
      </section>

      <!-- Review + sign -->
      <section v-else-if="stage === 'review'" class="rq__card">
        <h2 class="rq__sub">Review your answers</h2>
        <div class="rq__review">
          <button
            v-for="(s, i) in strips"
            :key="s.id"
            type="button"
            class="rq__rev-row"
            @click="idx = i; stage = 'quiz'"
          >
            <span class="rq__rev-num">Strip {{ s.id }}</span>
            <span class="rq__rev-pick" :class="{ 'rq__rev-pick--none': !picks[s.id] }">
              {{ labelFor(picks[s.id]) }}
            </span>
          </button>
        </div>
        <div class="rq__signwrap">
          <div class="rq__sign-label">Trainee signature — goes on the recorded check-off</div>
          <SignaturePad :height="110" @change="(v: string) => (signature = v || null)" />
        </div>
        <p v-if="submitError" class="rq__error">{{ submitError }}</p>
        <div class="rq__nav">
          <button type="button" class="rq__btn" @click="stage = 'quiz'; idx = 0">
            <ChevronLeft :size="15" :stroke-width="2" /> Back to strips
          </button>
          <button
            type="button"
            class="rq__btn rq__btn--primary"
            :disabled="!allAnswered || submitting"
            @click="submit"
          >
            {{ submitting ? 'Grading…' : 'Submit for grading' }}
          </button>
        </div>
      </section>

      <!-- Result -->
      <section v-else-if="stage === 'done' && result" class="rq__card rq__card--center">
        <template v-if="result.passed">
          <div class="rq__big rq__big--pass"><Check :size="30" :stroke-width="2.6" /></div>
          <h2 class="rq__sub">All {{ result.total }} strips correct</h2>
          <p class="rq__done-note">
            {{ result.recorded ? 'Recorded — your check-off is signed and shows on the Skills Day board.' : 'Completed.' }}
          </p>
          <button type="button" class="rq__btn rq__btn--primary" @click="router.push('/skills')">
            Back to Skills Day
          </button>
        </template>
        <template v-else>
          <div class="rq__big rq__big--redo"><RotateCcw :size="28" :stroke-width="2.4" /></div>
          <h2 class="rq__sub">{{ result.correct }} of {{ result.total }} correct</h2>
          <p class="rq__done-note">
            Take another look at strip{{ result.missed.length === 1 ? '' : 's' }}
            {{ result.missed.join(', ') }} — then run the deck again. It records when every strip is right.
          </p>
          <button type="button" class="rq__btn rq__btn--primary" @click="retake">Try again</button>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rq {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}
.rq__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.rq__head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rq__title {
  margin: 0;
  font-size: 26px;
  color: var(--color-brand-700);
}
.rq__meta {
  font-size: 13px;
  color: var(--color-muted);
}
.rq__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border: 1px solid oklch(0.8 0.09 155);
  background: oklch(0.96 0.035 155);
  color: oklch(0.4 0.1 155);
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}
.rq__card {
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: var(--color-surface);
  padding: 18px;
}
.rq__card--center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  padding: 36px 20px;
}
.rq__progress {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-ink-soft);
  margin-bottom: 10px;
}
.rq__progress-done {
  color: var(--color-muted);
  font-weight: 600;
}
.rq__strip {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: #fff;
}
.rq__options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.rq__opt {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.rq__opt:hover {
  border-color: var(--color-brand-300);
}
.rq__opt--on {
  border-color: var(--color-brand-600);
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}
.rq__nav {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
}
.rq__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 15px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.rq__btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.rq__btn--primary {
  border-color: var(--color-brand-600);
  background: var(--color-brand-600);
  color: #fff;
}
.rq__sub {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 700;
  color: var(--color-ink);
}
.rq__review {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rq__rev-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface-soft);
  cursor: pointer;
  text-align: left;
}
.rq__rev-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink-soft);
}
.rq__rev-pick {
  font-size: 13px;
  color: var(--color-ink);
}
.rq__rev-pick--none {
  color: oklch(0.55 0.15 25);
  font-weight: 700;
}
.rq__signwrap {
  margin-top: 16px;
}
.rq__sign-label {
  font-size: 12px;
  font-weight: 650;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.rq__error {
  margin: 10px 0 0;
  font-size: 13px;
  color: oklch(0.5 0.17 25);
  font-weight: 600;
}
.rq__big {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rq__big--pass {
  background: oklch(0.93 0.06 155);
  color: oklch(0.42 0.1 155);
}
.rq__big--redo {
  background: oklch(0.96 0.05 90);
  color: oklch(0.5 0.11 70);
}
.rq__done-note {
  margin: 0;
  font-size: 14px;
  color: var(--color-muted);
  max-width: 44ch;
}
.rq__empty {
  padding: 56px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
</style>
