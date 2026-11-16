<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, AlertTriangle, Check } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useClinical } from '@/composables/useClinical'
import {
  useFtepRecommendations,
  type RecommenderRole,
  type RecommendationChoice,
} from '@/composables/useFtepRecommendations'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { activeTransitionFor, TRANSITIONS } from '@/constants/pipelineGates'
import { generateRecommendationPdf } from '@/lib/recommendationPdf'
import { useAuthStore } from '@/stores/auth'

/**
 * Advancement Recommendation — the "Final Release Recommendation
 * (Standalone)" paper form, in-portal. Each recommender completes it
 * independently; the in-charge (P2) credential needs two on file and
 * the rec_letters gate checks itself off at two. Submitting files the
 * signed PDF into the employee's documents (not employee-visible,
 * matching the paper workflow).
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { ready, canViewBoard, personById } = useClinical()
const recs = useFtepRecommendations()
const clindocs = useClinicalDocs()

const traineeId = computed(() => String(route.params.traineeId))
const trainee = computed(() => personById(traineeId.value))
const transition = computed(() =>
  trainee.value ? activeTransitionFor(trainee.value.record) : null,
)
const def = computed(() => (transition.value ? TRANSITIONS[transition.value] : null))
const toLabel = computed(() => def.value?.toLabel ?? '—')
const lettersRequired = computed(
  () => !!def.value?.gates.some((g) => g.key === 'rec_letters'),
)

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)
onMounted(() => void recs.load())

const onFile = computed(() =>
  transition.value ? recs.listFor(traineeId.value, transition.value) : [],
)
const mineOnFile = computed(() =>
  onFile.value.some((r) => r.recommenderId === auth.appUser?.id),
)

/* ── Form state ──────────────────────────────────────────────────── */
const role = ref<RecommenderRole>('fto')
const knowledge = ref<'' | 'yes' | 'no'>('')
const safeEthical = ref<'' | 'yes' | 'no'>('')
const comfortable = ref<'' | 'yes' | 'no'>('')
const choice = ref<'' | RecommendationChoice>('')
const basis = ref('')
const evalDate = ref(new Date().toISOString().slice(0, 10))
const signature = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (!knowledge.value || !safeEthical.value || !comfortable.value)
    out.push('Answer all three attestations')
  if (!choice.value) out.push('Pick a recommendation')
  if (!basis.value.trim())
    out.push('Describe the basis — specific, dated examples beat general impressions')
  if (!signature.value) out.push('Sign the recommendation')
  return out
})

async function onSubmit() {
  if (blockers.value.length || submitting.value || !trainee.value || !transition.value) return
  submitting.value = true
  submitError.value = null
  const res = await recs.submit({
    traineeId: traineeId.value,
    transition: transition.value,
    recommenderRole: role.value,
    knowledge: knowledge.value === 'yes',
    safeEthical: safeEthical.value === 'yes',
    comfortable: comfortable.value === 'yes',
    recommendation: choice.value as RecommendationChoice,
    basis: basis.value.trim(),
    signature: signature.value!,
    evalDate: evalDate.value,
  })
  if (!res.ok) {
    submitting.value = false
    submitError.value = res.error
    return
  }
  /* File the signed PDF into the employee's documents — best effort;
     the row above is the record either way. */
  try {
    const roleLabel =
      role.value === 'fto' ? 'Field Training Officer' : role.value === 'supervisor' ? 'Field Supervisor' : 'Clinical Development Officer'
    const pdf = await generateRecommendationPdf({
      traineeName: trainee.value.fullName,
      certLevel: trainee.value.record.certLevel ?? '—',
      toLabel: toLabel.value,
      transitionLabel: def.value?.label ?? 'Advancement',
      recommenderName: auth.appUser?.fullName ?? '—',
      recommenderRole: roleLabel,
      knowledge: knowledge.value === 'yes',
      safeEthical: safeEthical.value === 'yes',
      comfortable: comfortable.value === 'yes',
      recommendation: choice.value as RecommendationChoice,
      basis: basis.value,
      signature: signature.value,
      evalDate: evalDate.value,
    })
    const safe = trainee.value.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const blob = pdf.output('blob')
    await clindocs.upload({
      userId: traineeId.value,
      folder: 'generated',
      file: new File([blob], `Advancement_Recommendation_${safe}_${evalDate.value}.pdf`, {
        type: 'application/pdf',
      }),
      employeeVisible: false,
      note: `Advancement recommendation (${toLabel.value}) — ${auth.appUser?.fullName ?? ''}`,
    })
  } catch (e) {
    console.error('[rec] filing PDF failed:', e)
  }
  submitting.value = false
  router.push('/clinical/ftep')
}

function fmt(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
const CHOICE_LABELS: Record<RecommendationChoice, string> = {
  release: 'Release',
  extend: 'Extend training',
  separate: 'Separation',
}
</script>

<template>
  <div class="rc">
    <ClinicalNav :crumbs="[{ label: 'FTEP', to: '/clinical/ftep' }, `Recommendation — ${trainee?.fullName ?? '…'}`]" />

    <div v-if="!ready" class="rc__empty">Loading…</div>
    <div v-else-if="!trainee" class="rc__empty">No clinical file for this trainee.</div>
    <div v-else-if="!transition" class="rc__empty">No active credentialing step for this trainee.</div>

    <template v-else>
      <button type="button" class="rc__back" @click="router.push('/clinical/ftep')">
        <ArrowLeft :size="14" :stroke-width="2" />
        FTEP
      </button>

      <header class="rc__head">
        <h1 class="display rc__title">Advancement Recommendation — {{ trainee.fullName }}</h1>
        <div class="rc__sub">
          {{ def?.label }} · recommending for {{ toLabel }} · each recommender completes this
          independently<template v-if="lettersRequired"> · <b>{{ onFile.length }} of 2 on file</b></template>
        </div>
      </header>

      <div v-if="onFile.length" class="rc__card">
        <div class="rc__card-hd">Already on file for this step</div>
        <div class="rc__onfile">
          <div v-for="r in onFile" :key="r.id" class="rc__onfile-row">
            <Check :size="13" :stroke-width="2.5" />
            <span><b>{{ r.recommenderName ?? 'Recommender' }}</b> · {{ fmt(r.evalDate) }} · {{ CHOICE_LABELS[r.recommendation] }}</span>
          </div>
        </div>
      </div>
      <div v-if="mineOnFile" class="rc__note">
        <AlertTriangle :size="14" :stroke-width="2" />
        You already have a recommendation on file for this step — a second one from you won't
        count twice. The two letters must come from different recommenders.
      </div>

      <!-- Recommender -->
      <div class="rc__card">
        <div class="rc__card-hd">Recommender</div>
        <div class="rc__meta">
          <label>Name <input :value="auth.appUser?.fullName ?? ''" type="text" disabled /></label>
          <label>Acting as
            <select v-model="role">
              <option value="fto">Field Training Officer</option>
              <option value="supervisor">Field Supervisor</option>
              <option value="cdo">Clinical Development Officer</option>
            </select>
          </label>
          <label>Date <input v-model="evalDate" type="date" /></label>
        </div>
      </div>

      <!-- Attestations -->
      <div class="rc__card">
        <div class="rc__card-hd">Attestations</div>
        <div class="rc__atts">
          <div class="rc__att">
            <span class="rc__att-q">The trainee has demonstrated acceptable knowledge of Waller County EMS operational policies and clinical protocols.</span>
            <span class="rc__att-opts">
              <label><input v-model="knowledge" type="radio" value="yes" /> has</label>
              <label><input v-model="knowledge" type="radio" value="no" /> has not</label>
            </span>
          </div>
          <div class="rc__att">
            <span class="rc__att-q">The trainee operates in a safe, team-based, and ethical manner.</span>
            <span class="rc__att-opts">
              <label><input v-model="safeEthical" type="radio" value="yes" /> does</label>
              <label><input v-model="safeEthical" type="radio" value="no" /> does not</label>
            </span>
          </div>
          <div class="rc__att rc__att--boxed">
            <span class="rc__att-k">The only question that matters</span>
            <span class="rc__att-q">I would be comfortable with this provider responding to my own home and caring for a member of my family.</span>
            <span class="rc__att-opts">
              <label><input v-model="comfortable" type="radio" value="yes" /> would</label>
              <label><input v-model="comfortable" type="radio" value="no" /> would not</label>
            </span>
          </div>
        </div>
      </div>

      <!-- Recommendation -->
      <div class="rc__card">
        <div class="rc__card-hd">Recommendation</div>
        <div class="rc__choices">
          <label><input v-model="choice" type="radio" value="release" />
            Release as {{ toLabel }} — field duty, overtime, and special events within {{ toLabel }} authorizations</label>
          <label><input v-model="choice" type="radio" value="extend" />
            Extend training (phase and days specified on Phase Transition Record)</label>
          <label><input v-model="choice" type="radio" value="separate" />
            Recommend separation from the program</label>
        </div>
      </div>

      <!-- Basis -->
      <div class="rc__card">
        <div class="rc__card-hd">Basis for this recommendation</div>
        <div class="rc__basis">
          <p class="rc__coach">
            The DOR standard applies here: specific, dated examples beat general impressions.
            Address clinical judgment, protocol compliance, scene command, and readiness for
            {{ toLabel }} authorizations.
          </p>
          <textarea v-model="basis" rows="6"></textarea>
        </div>
      </div>

      <!-- Sign & submit -->
      <div class="rc__card">
        <div class="rc__card-hd">Signature — {{ auth.appUser?.fullName }}</div>
        <div class="rc__sign">
          <SignaturePad :height="100" @change="(v: string) => (signature = v || null)" />
        </div>
      </div>

      <div v-if="blockers.length" class="rc__blockers">
        <AlertTriangle :size="15" :stroke-width="2" />
        <ul><li v-for="b in blockers" :key="b">{{ b }}</li></ul>
      </div>
      <div v-if="submitError" class="rc__error">{{ submitError }}</div>
      <div class="rc__footer">
        <button type="button" class="rc__primary" :disabled="blockers.length > 0 || submitting" @click="onSubmit">
          <Check :size="14" :stroke-width="2.5" />
          {{ submitting ? 'Filing…' : 'File recommendation' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc { max-width: 760px; margin: 0 auto; padding: 24px 16px 90px; }
@media (min-width: 768px) { .rc { padding: 24px 32px 90px; } }
.rc__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }
.rc__back {
  display: inline-flex; align-items: center; gap: 6px; margin-bottom: 10px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none; border: none; padding: 0; cursor: pointer;
}
.rc__head { margin-bottom: 18px; }
.rc__title { font-size: 25px; line-height: 1.15; color: var(--color-ink); }
.rc__sub { margin-top: 5px; font-size: 12.5px; color: var(--color-muted); }
.rc__sub b { color: var(--color-ink); }

.rc__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; overflow: hidden; margin-bottom: 16px;
}
.rc__card-hd {
  padding: 13px 16px; border-bottom: 1px solid var(--color-line);
  font-size: 13px; font-weight: 700; color: var(--color-ink);
}
.rc__onfile { padding: 10px 16px; display: flex; flex-direction: column; gap: 6px; }
.rc__onfile-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--color-ink-soft); }
.rc__onfile-row svg { color: var(--color-success-500); flex-shrink: 0; }
.rc__note {
  display: flex; gap: 10px; align-items: flex-start;
  background: oklch(0.97 0.03 80); border: 1px solid oklch(0.86 0.06 80);
  border-radius: 12px; padding: 11px 14px; margin-bottom: 16px;
  font-size: 12.5px; color: oklch(0.42 0.09 75);
}
.rc__meta { display: flex; flex-wrap: wrap; gap: 12px 18px; padding: 14px 16px; }
.rc__meta label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11.5px; font-weight: 600; color: var(--color-muted);
}
.rc__meta input, .rc__meta select {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 8px; padding: 7px 10px;
  background: var(--color-surface); min-width: 130px;
}
.rc__meta input:disabled { color: var(--color-muted); background: var(--color-surface-soft); }

.rc__atts { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
.rc__att { display: flex; flex-direction: column; gap: 7px; }
.rc__att-q { font-size: 13px; line-height: 1.45; color: var(--color-ink); }
.rc__att-k {
  font-size: 10px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted);
}
.rc__att-opts { display: flex; gap: 18px; }
.rc__att-opts label {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 650; color: var(--color-ink-soft); cursor: pointer;
}
.rc__att-opts input { accent-color: var(--color-brand-600); }
.rc__att--boxed {
  background: var(--color-surface-soft); border-left: 3px solid var(--color-brand-800);
  border-radius: 8px; padding: 11px 13px;
}

.rc__choices { padding: 14px 16px; display: flex; flex-direction: column; gap: 11px; }
.rc__choices label {
  display: flex; align-items: flex-start; gap: 9px;
  font-size: 13px; line-height: 1.45; color: var(--color-ink); cursor: pointer;
}
.rc__choices input { margin-top: 2px; accent-color: var(--color-brand-600); }

.rc__basis { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 9px; }
.rc__coach { font-size: 11.5px; line-height: 1.5; color: var(--color-muted); }
.rc__basis textarea {
  font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 9px; padding: 9px 11px;
  background: var(--color-surface); resize: vertical;
}
.rc__basis textarea:focus { outline: none; border-color: var(--color-brand-600); }
.rc__sign { padding: 14px 16px; }

.rc__blockers {
  display: flex; gap: 10px; align-items: flex-start;
  background: oklch(0.97 0.03 80); border: 1px solid oklch(0.86 0.06 80);
  border-radius: 12px; padding: 12px 15px; margin-bottom: 14px;
  font-size: 12.5px; color: oklch(0.42 0.09 75);
}
.rc__blockers ul { margin: 0; padding-left: 16px; line-height: 1.7; }
.rc__error { font-size: 13px; color: oklch(0.5 0.16 30); margin-bottom: 12px; }
.rc__footer { display: flex; justify-content: flex-end; }
.rc__primary {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-sans); font-size: 13.5px; font-weight: 700;
  color: white; background: var(--color-brand-800);
  border: none; border-radius: 10px; padding: 11px 18px; cursor: pointer;
}
.rc__primary:hover:not(:disabled) { background: var(--color-brand-900); }
.rc__primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
