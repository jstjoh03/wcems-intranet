<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Check } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  FTO_EVAL_AREAS,
  FTO_EVAL_NARRATIVES,
  FTO_EVAL_SCALE_NOTE,
  FTO_EVAL_HOW_USED,
  type FtoEvalPayload,
} from '@/constants/ftepForms'

/**
 * Trainee Evaluation of FTO — the trainee's form, completed at each
 * phase transition and submitted to the Clinical Development Officer.
 * The evaluated FTO never sees it (RLS: clinical editors + the
 * submitting trainee only). Transcribed 1:1 from the v1.0 paper form.
 */

const router = useRouter()
const auth = useAuthStore()

const ftoName = ref('')
const phase = ref('')
const ratings = reactive<Record<string, { score?: number; comment?: string }>>({})
const narratives = reactive<Record<string, string>>({})
const signature = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const done = ref(false)

/* Prefill the FTO from the trainee's own pipeline record when known. */
onMounted(async () => {
  if (auth.usingDevStub || !auth.appUser?.id) return
  const { data } = await supabase
    .from('pipeline_records')
    .select('fto_name')
    .eq('user_id', auth.appUser.id)
    .maybeSingle()
  if (data?.fto_name && !ftoName.value) ftoName.value = data.fto_name
})

function setScore(no: number, score: number) {
  const k = String(no)
  const cur = ratings[k]
  if (cur && cur.score === score) delete ratings[k]
  else ratings[k] = { ...(cur ?? {}), score }
}

const ratedCount = computed(
  () => FTO_EVAL_AREAS.filter((a) => ratings[String(a.no)]?.score).length,
)

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (!ftoName.value.trim()) out.push('Name the FTO being evaluated')
  if (ratedCount.value < FTO_EVAL_AREAS.length)
    out.push(`${FTO_EVAL_AREAS.length - ratedCount.value} areas not yet rated`)
  return out
})

async function submit() {
  if (blockers.value.length || submitting.value || !auth.appUser?.id) return
  submitting.value = true
  submitError.value = null
  const payload: FtoEvalPayload = {
    ratings: Object.fromEntries(
      FTO_EVAL_AREAS.filter((a) => ratings[String(a.no)]?.score).map((a) => [
        String(a.no),
        { ...ratings[String(a.no)], label: a.label },
      ]),
    ),
    narratives: Object.fromEntries(
      FTO_EVAL_NARRATIVES.filter((n) => narratives[n.key]?.trim()).map((n) => [
        n.key,
        narratives[n.key].trim(),
      ]),
    ),
  }
  const { error } = await supabase.from('ftep_fto_evals').insert({
    trainee_id: auth.appUser.id,
    fto_name: ftoName.value.trim(),
    phase: phase.value.trim() || null,
    payload,
    signature: signature.value,
  })
  submitting.value = false
  if (error) {
    submitError.value = error.message
    return
  }
  done.value = true
}
</script>

<template>
  <div class="fe">
    <button type="button" class="fe__back" @click="router.push('/clinical-development')">
      <ArrowLeft :size="14" :stroke-width="2" />
      My Progress
    </button>

    <div v-if="done" class="fe__done">
      <Check :size="22" :stroke-width="2.5" />
      <h1 class="display">Submitted to the Clinical Department</h1>
      <p>
        Thank you — your evaluation went directly to the Clinical Development Officer. Feedback
        reaches FTOs in aggregate and without attribution wherever possible.
      </p>
      <button type="button" class="fe__primary" @click="router.push('/clinical-development')">
        Back to My Progress
      </button>
    </div>

    <template v-else>
      <header class="fe__head">
        <div class="fe__eyebrow">Field Training &amp; Evaluation Program</div>
        <h1 class="display fe__title">Trainee Evaluation of FTO</h1>
        <p class="fe__sub">
          Completed at each phase transition · submitted to the Clinical Development Officer —
          <b>not to the FTO</b>
        </p>
      </header>

      <div class="fe__card">
        <div class="fe__meta">
          <label>FTO being evaluated <input v-model="ftoName" type="text" maxlength="80" /></label>
          <label>Phase completed / dates <input v-model="phase" type="text" maxlength="120" placeholder="e.g. Phase 3 — Partner Phase, Aug 10–22" /></label>
        </div>
      </div>

      <p class="fe__scale">{{ FTO_EVAL_SCALE_NOTE }}</p>

      <div class="fe__card">
        <div v-for="a in FTO_EVAL_AREAS" :key="a.no" class="fe__area">
          <div class="fe__area-txt">
            <span class="fe__area-label">{{ a.no }} · {{ a.label }}</span>
            <span class="fe__area-hint">{{ a.hint }}</span>
          </div>
          <div class="fe__pips">
            <button
              v-for="s in [1, 2, 3, 4, 5]"
              :key="s"
              type="button"
              class="fe__pip"
              :class="{ 'fe__pip--on': ratings[String(a.no)]?.score === s }"
              @click="setScore(a.no, s)"
            >{{ s }}</button>
          </div>
          <input
            v-if="(ratings[String(a.no)]?.score ?? 5) <= 2 || ratings[String(a.no)]?.comment"
            v-model="ratings[String(a.no)]!.comment"
            type="text"
            class="fe__comment"
            maxlength="300"
            placeholder="Comment (optional — most useful for scores of 1 or 2)"
          />
        </div>
      </div>

      <div class="fe__card">
        <div class="fe__card-hd">Narrative</div>
        <label v-for="n in FTO_EVAL_NARRATIVES" :key="n.key" class="fe__narr">
          <span>{{ n.label }}</span>
          <textarea v-model="narratives[n.key]" rows="3"></textarea>
        </label>
      </div>

      <div class="fe__how">
        <b>How this is used.</b> {{ FTO_EVAL_HOW_USED }}
      </div>

      <div class="fe__card">
        <div class="fe__card-hd">Signature <span class="fe__optional">optional — the form may be submitted unsigned</span></div>
        <div class="fe__pad">
          <SignaturePad :height="100" @change="(v: string) => (signature = v || null)" />
        </div>
      </div>

      <div v-if="blockers.length" class="fe__blockers">
        <ul><li v-for="b in blockers" :key="b">{{ b }}</li></ul>
      </div>
      <div v-if="submitError" class="fe__error">{{ submitError }}</div>

      <div class="fe__footer">
        <button type="button" class="fe__primary" :disabled="blockers.length > 0 || submitting" @click="submit">
          <Check :size="14" :stroke-width="2.5" />
          {{ submitting ? 'Submitting…' : 'Submit to the Clinical Department' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fe { max-width: 760px; margin: 0 auto; padding: 24px 16px 90px; }
@media (min-width: 768px) { .fe { padding: 24px 32px 90px; } }
.fe__back {
  display: inline-flex; align-items: center; gap: 6px; margin-bottom: 12px;
  font-size: 12.5px; font-weight: 600; color: var(--color-ink-soft);
  background: none; border: none; padding: 0; cursor: pointer;
}
.fe__back:hover { color: var(--color-ink); }
.fe__eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--color-accent-700);
}
.fe__title { font-size: 26px; color: var(--color-brand-800); margin-top: 2px; }
.fe__sub { margin-top: 4px; font-size: 13px; color: var(--color-ink-soft); }
.fe__sub b { color: var(--color-ink); }
.fe__head { margin-bottom: 16px; }
.fe__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; margin-bottom: 14px; overflow: hidden;
}
.fe__card-hd {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--color-line);
  font-size: 13px; font-weight: 700; color: var(--color-ink);
}
.fe__optional {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--color-muted-soft);
}
.fe__meta { display: grid; gap: 12px; padding: 14px 16px; }
@media (min-width: 640px) { .fe__meta { grid-template-columns: 1fr 1fr; } }
.fe__meta label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11px; font-weight: 600; color: var(--color-muted);
}
.fe__meta input {
  font-size: 13.5px; font-weight: 400; padding: 8px 10px;
  border: 1px solid var(--color-line); border-radius: 9px;
  background: var(--color-surface); color: var(--color-ink);
}
.fe__scale { font-size: 11.5px; line-height: 1.5; color: var(--color-muted); margin-bottom: 12px; }
.fe__area {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px;
  padding: 11px 16px; border-bottom: 1px solid var(--color-line-soft);
}
.fe__area:last-child { border-bottom: none; }
.fe__area-txt { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 1px; }
.fe__area-label { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.fe__area-hint { font-size: 11px; line-height: 1.4; color: var(--color-muted); }
.fe__pips { display: flex; gap: 5px; }
.fe__pip {
  width: 34px; height: 32px; border-radius: 8px;
  border: 1px solid var(--color-line); background: var(--color-surface);
  font-size: 13px; font-weight: 600; color: var(--color-ink-soft); cursor: pointer;
}
.fe__pip--on { background: var(--color-brand-800); border-color: var(--color-brand-800); color: #fff; }
.fe__comment {
  flex-basis: 100%; font-size: 12.5px; padding: 7px 10px;
  border: 1px solid var(--color-line); border-radius: 8px;
  background: var(--color-surface-soft); color: var(--color-ink);
}
.fe__narr {
  display: flex; flex-direction: column; gap: 5px;
  padding: 11px 16px; border-bottom: 1px solid var(--color-line-soft);
  font-size: 12.5px; font-weight: 600; color: var(--color-ink);
}
.fe__narr:last-child { border-bottom: none; }
.fe__narr textarea {
  font-size: 13px; font-weight: 400; padding: 8px 10px;
  border: 1px solid var(--color-line); border-radius: 9px; resize: vertical;
  background: var(--color-surface); color: var(--color-ink);
}
.fe__how {
  font-size: 12px; line-height: 1.6; color: var(--color-ink-soft);
  background: var(--color-surface-soft); border-left: 3px solid var(--color-accent-600);
  border-radius: 0 10px 10px 0; padding: 12px 14px; margin-bottom: 14px;
}
.fe__pad { padding: 14px 16px; }
.fe__blockers {
  font-size: 12.5px; color: oklch(0.5 0.12 75);
  background: var(--color-warning-50); border-radius: 10px;
  padding: 10px 14px 10px 28px; margin-bottom: 12px;
}
.fe__error { font-size: 12.5px; color: var(--color-danger-500); margin-bottom: 12px; }
.fe__footer { display: flex; justify-content: flex-end; }
.fe__primary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; border-radius: 10px; border: none;
  background: var(--color-brand-800); color: #fff;
  font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.fe__primary:disabled { opacity: 0.55; cursor: default; }
.fe__done {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  padding: 32px 0; color: var(--color-ink-soft); font-size: 13.5px; line-height: 1.6;
}
.fe__done svg { color: var(--color-success-500); }
.fe__done h1 { font-size: 24px; color: var(--color-brand-800); }
</style>
