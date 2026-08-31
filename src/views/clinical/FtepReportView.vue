<script setup lang="ts">
import { ref, computed, reactive, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, AlertTriangle, Check, Save } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import {
  sectionsFor,
  allCategories,
  ratingAverage,
  missingComments,
  DOR_SCALE_NOTE,
  ICR_SCALE_NOTE,
  TIER_PHASE_OPTIONS,
  UNIT_OPTIONS,
  type FtepKind,
  type FtepRating,
  type FtepPayload,
} from '@/constants/ftepForms'
import { useAuthStore } from '@/stores/auth'

/**
 * The DOR / ICR runner — one form page per report, straight from the
 * v1.0 paper forms. Server-side drafts: the form autosaves as the
 * evaluator works and can be resumed from any device; Review & sign
 * captures both signatures and files the report into the trainee's
 * record.
 *
 * Rubric enforcement: every category needs a value (1–5 or N.O.),
 * any rating below 3 requires a behavioral comment, any 1 requires
 * the documented-situation narrative (DOR), and NRT flags notify the
 * CDO via the unreviewed-reports queue.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { ready, canViewBoard, personById, ftepTrackFor } = useClinical()
const ftep = useFtep()

const kind = computed<FtepKind>(() => (route.params.kind === 'icr' ? 'icr' : 'dor'))
const traineeId = computed(() => String(route.params.traineeId))
const trainee = computed(() => personById(traineeId.value))
const isDor = computed(() => kind.value === 'dor')
const title = computed(() => (isDor.value ? 'Daily Observation Report' : 'Individual Call Report'))
/** "P1C" from "P1C · Phase 2 — Clinical Integration". */
const tierShort = computed(() => meta.tierPhase.split('·')[0]?.trim() || null)
const titleFor = computed(() => {
  if (!trainee.value) return title.value
  return `${title.value} — ${trainee.value.fullName}${tierShort.value ? `, ${tierShort.value}` : ''}`
})

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)

/* ── Form state ──────────────────────────────────────────────────── */
const reportId = ref<string | null>(null)
const evalDate = ref(new Date().toISOString().slice(0, 10))
const meta = reactive({
  tierPhase: '',
  unit: '',
  trainingDayNo: '',
  evaluatorRole: 'fto' as 'fto' | 'supervisor' | 'clinical',
  incidentNo: '',
  chiefComplaint: '',
  callLevel: 'als' as 'bls' | 'als' | 'als_p2',
  countsToward10: true,
})
const shift = reactive({ dispatched: '', attended: '', icrs: '', contacts: '', scenarios: '' })
const narratives = reactive({ best: '', least: '', situation: '', remedial: '', remedialMinutes: '', goal: '' })
const explanation = ref('')
const callNotes = ref('')
const ratings = reactive<Record<string, FtepRating>>({})
const commentOpen = reactive<Record<string, boolean>>({})

let hydrated = false
function hydrateFromDraft() {
  if (hydrated) return
  const d = ftep.myDraft(traineeId.value, kind.value)
  if (!d) { hydrated = true; return }
  hydrated = true
  reportId.value = d.id
  evalDate.value = d.evalDate
  const p = d.payload
  meta.tierPhase = p.tierPhase ?? ''
  meta.unit = p.unit ?? ''
  meta.trainingDayNo = p.trainingDayNo ?? ''
  meta.evaluatorRole = p.evaluatorRole ?? 'fto'
  meta.incidentNo = p.incidentNo ?? ''
  meta.chiefComplaint = p.chiefComplaint ?? ''
  meta.callLevel = p.callLevel ?? 'als'
  meta.countsToward10 = p.countsToward10 ?? true
  Object.assign(shift, p.shift ?? {})
  Object.assign(narratives, p.narratives ?? {})
  explanation.value = p.explanation ?? ''
  callNotes.value = p.callNotes ?? ''
  for (const [k, v] of Object.entries(p.ratings ?? {})) {
    ratings[k] = { ...v }
    if (v.comment) commentOpen[k] = true
  }
}
watch([() => ftep.ready.value, trainee], ([r]) => { if (r && trainee.value) hydrateFromDraft() }, { immediate: true })

function buildPayload(): FtepPayload {
  const base: FtepPayload = {
    tierPhase: meta.tierPhase || undefined,
    unit: meta.unit || undefined,
    ratings: JSON.parse(JSON.stringify(ratings)),
  }
  if (isDor.value) {
    base.trainingDayNo = meta.trainingDayNo || undefined
    base.shift = { ...shift }
    base.narratives = { ...narratives }
  } else {
    base.evaluatorRole = meta.evaluatorRole
    base.incidentNo = meta.incidentNo || undefined
    base.chiefComplaint = meta.chiefComplaint || undefined
    base.callLevel = meta.callLevel
    base.countsToward10 = meta.countsToward10
    base.explanation = explanation.value || undefined
    base.callNotes = callNotes.value.trim() || undefined
    /* Legacy-track trainees file portal ICRs too (as of 2026-08-31) —
       stamp the rung so each credentialing step keeps its own 10. */
    const track = trainee.value ? ftepTrackFor(trainee.value) : null
    if (track?.key === 'legacy' && track.legacyPhase) base.legacyPhase = track.legacyPhase
  }
  return base
}

/* ── Autosave (server-side drafts) ───────────────────────────────── */
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let dirtySinceSave = false

async function persistDraft(): Promise<boolean> {
  if (!trainee.value) return false
  saveState.value = 'saving'
  const res = await ftep.saveDraft({
    id: reportId.value ?? undefined,
    kind: kind.value,
    traineeId: trainee.value.userId,
    evalDate: evalDate.value,
    payload: buildPayload(),
  })
  if (!res.ok) { saveState.value = 'error'; return false }
  reportId.value = res.id
  saveState.value = 'saved'
  dirtySinceSave = false
  return true
}

function queueAutosave() {
  dirtySinceSave = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void persistDraft() }, 2000)
}
watch([meta, shift, narratives, explanation, callNotes, ratings, evalDate], queueAutosave, { deep: true })
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (dirtySinceSave && reportId.value) void persistDraft()
})

async function saveAndExit() {
  await persistDraft()
  router.push('/clinical/ftep')
}

/* ── Rating interactions ─────────────────────────────────────────── */
function setScore(no: number, score: number | 'NO') {
  const k = String(no)
  const cur = ratings[k]
  if (cur && cur.score === score) delete ratings[k]
  else ratings[k] = { ...(cur ?? {}), score }
  if (ratings[k] && typeof ratings[k].score === 'number' && (ratings[k].score as number) < 3)
    commentOpen[k] = true
}
function toggleNrt(no: number) {
  const k = String(no)
  if (!ratings[k]) return
  ratings[k].nrt = !ratings[k].nrt
}

const cats = computed(() => allCategories(kind.value))
const ratedCount = computed(() => cats.value.filter((c) => ratings[String(c.no)]).length)
const average = computed(() => ratingAverage(ratings))
const nrtFlagged = computed(() => Object.values(ratings).some((r) => r.nrt))
const hasOne = computed(() => Object.values(ratings).some((r) => r.score === 1))
/** Any category scored below 3 — gates the ICR explanation card. */
const hasBelowThree = computed(() =>
  Object.values(ratings).some((r) => typeof r.score === 'number' && r.score < 3),
)
const commentGaps = computed(() => missingComments(kind.value, ratings))

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (ratedCount.value < cats.value.length)
    out.push(`${cats.value.length - ratedCount.value} categories not yet rated (use N.O. when not observed)`)
  if (commentGaps.value.length)
    out.push(`Comment required for category ${commentGaps.value.join(', ')} (rating below 3)`)
  if (isDor.value && hasOne.value && !narratives.situation.trim())
    out.push('Documented situation required — a category is rated 1')
  if (!isDor.value && commentGaps.value.length === 0 && hasOne.value && !explanation.value.trim())
    out.push('Explanation required — a category is rated 1')
  return out
})

/* ── Sign & submit ───────────────────────────────────────────────── */
const signing = ref(false)
const traineeSig = ref<string | null>(null)
const evaluatorSig = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

/* Dual signatures at review is the standard. The exception (Justin,
   2026-08-24): a 48-hr trainee asleep when the day-1 FTO leaves at
   0600 — the FTO submits signed alone and the trainee is prompted on
   My Progress to review & sign (view-only). */
const deferTrainee = ref(false)

const canSubmit = computed(
  () => !!evaluatorSig.value && (!!traineeSig.value || deferTrainee.value) && !submitting.value,
)

async function onSubmit() {
  if (!canSubmit.value || !trainee.value) return
  submitting.value = true
  submitError.value = null
  /* Make sure a draft row exists, then stamp labels/average and submit. */
  if (!reportId.value) {
    const created = await persistDraft()
    if (!created) { submitting.value = false; submitError.value = 'Could not save the report.'; return }
  }
  const payload = buildPayload()
  for (const c of cats.value) {
    const r = payload.ratings?.[String(c.no)]
    if (r) r.label = c.label
  }
  payload.average = average.value ?? undefined
  payload.nrtFlagged = nrtFlagged.value || undefined
  const res = await ftep.submitReport({
    id: reportId.value!,
    evalDate: evalDate.value,
    payload,
    traineeSignature: traineeSig.value ?? null,
    evaluatorSignature: evaluatorSig.value!,
  })
  submitting.value = false
  if (!res.ok) { submitError.value = res.error; return }
  router.push('/clinical/ftep')
}

function fmtSaveState(): string {
  switch (saveState.value) {
    case 'saving': return 'Saving…'
    case 'saved': return 'Draft saved'
    case 'error': return 'Save failed — retrying on next change'
    default: return 'Autosaves as you work'
  }
}
</script>

<template>
  <div class="fr">
    <ClinicalNav :crumbs="[{ label: 'FTEP', to: '/clinical/ftep' }, `${isDor ? 'DOR' : 'ICR'} — ${trainee?.fullName ?? '…'}`]" />

    <div v-if="!ready" class="fr__empty">Loading…</div>
    <div v-else-if="!trainee" class="fr__empty">No clinical file for this trainee.</div>

    <template v-else>
      <div class="fr__topline">
        <button type="button" class="fr__back" @click="router.push('/clinical/ftep')">
          <ArrowLeft :size="14" :stroke-width="2" />
          FTEP
        </button>
        <span class="fr__savestate" :class="`fr__savestate--${saveState}`">{{ fmtSaveState() }}</span>
      </div>

      <header class="fr__head">
        <div>
          <h1 class="display fr__title">{{ titleFor }}</h1>
          <div class="fr__sub">
            {{ trainee.record.certLevel }}
            <template v-if="meta.tierPhase"> · {{ meta.tierPhase }}</template>
            <template v-if="isDor"> · one per training day · reviewed with the trainee before end of shift</template>
            <template v-else> · one per evaluated call · reviewed with the trainee</template>
          </div>
        </div>
        <div class="fr__head-actions">
          <button type="button" class="fr__ghost" @click="saveAndExit">
            <Save :size="14" :stroke-width="2" />
            Save draft — finish later
          </button>
          <button type="button" class="fr__primary" :disabled="blockers.length > 0" @click="signing = true">
            Review &amp; sign
          </button>
        </div>
      </header>

      <!-- Meta -->
      <div class="fr__card">
        <div class="fr__card-hd">{{ isDor ? 'Shift data' : 'Call data' }}</div>
        <div class="fr__meta">
          <label>Date <input v-model="evalDate" type="date" /></label>
          <label>Tier &amp; phase
            <select v-model="meta.tierPhase">
              <option value="" disabled>Select…</option>
              <option v-for="t in TIER_PHASE_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>
          </label>
          <label>Unit
            <select v-model="meta.unit">
              <option value="" disabled>Select…</option>
              <option v-for="u in UNIT_OPTIONS" :key="u" :value="u">{{ u }}</option>
            </select>
          </label>
          <template v-if="isDor">
            <label>Training day # of phase <input v-model="meta.trainingDayNo" type="text" inputmode="numeric" placeholder="#" /></label>
            <label>Number of calls dispatched <input v-model="shift.dispatched" type="text" inputmode="numeric" placeholder="#" /></label>
            <label>Number attended by trainee <input v-model="shift.attended" type="text" inputmode="numeric" placeholder="#" /></label>
            <label>Number of ICRs completed <input v-model="shift.icrs" type="text" inputmode="numeric" placeholder="#" /></label>
            <label>Number of P2-required contacts <input v-model="shift.contacts" type="text" inputmode="numeric" placeholder="#" /></label>
            <label>Number of scenarios substituted <input v-model="shift.scenarios" type="text" inputmode="numeric" placeholder="#" /></label>
          </template>
          <template v-else>
            <label>Incident # <input v-model="meta.incidentNo" type="text" /></label>
            <label class="fr__wide">Chief complaint / call type <input v-model="meta.chiefComplaint" type="text" /></label>
            <label>Evaluator role
              <select v-model="meta.evaluatorRole">
                <option value="fto">FTO</option>
                <option value="supervisor">Supervisor</option>
                <option value="clinical">Clinical</option>
              </select>
            </label>
            <label>Call level
              <select v-model="meta.callLevel">
                <option value="bls">BLS</option>
                <option value="als">ALS</option>
                <option value="als_p2">ALS — P2-required</option>
              </select>
            </label>
            <label class="fr__check">
              <input v-model="meta.countsToward10" type="checkbox" />
              Counts toward the 10 required scored ALS call evaluations
            </label>
          </template>
        </div>
      </div>

      <!-- Ratings -->
      <div class="fr__card">
        <div class="fr__card-hd">
          Ratings
          <span class="fr__progress">{{ ratedCount }} / {{ cats.length }} rated<template v-if="average !== null"> · avg {{ average.toFixed(2) }}</template></span>
        </div>
        <p class="fr__scale">{{ isDor ? DOR_SCALE_NOTE : ICR_SCALE_NOTE }}</p>
        <template v-for="section in sectionsFor(kind)" :key="section.title">
          <div class="fr__section">{{ section.title }}</div>
          <div v-for="cat in section.categories" :key="cat.no" class="fr__row">
            <div class="fr__row-top">
              <span class="fr__label">{{ cat.no }} · {{ cat.label }}</span>
              <span class="fr__pips">
                <button
                  v-for="s in [1, 2, 3, 4, 5]"
                  :key="s"
                  type="button"
                  class="fr__pip"
                  :class="{ 'fr__pip--on': ratings[String(cat.no)]?.score === s, 'fr__pip--bad': ratings[String(cat.no)]?.score === s && s < 3 }"
                  @click="setScore(cat.no, s)"
                >{{ s }}</button>
                <button
                  type="button"
                  class="fr__pip fr__pip--no"
                  :class="{ 'fr__pip--on': ratings[String(cat.no)]?.score === 'NO' }"
                  @click="setScore(cat.no, 'NO')"
                >N.O.</button>
                <button
                  v-if="isDor"
                  type="button"
                  class="fr__nrt"
                  :class="{ 'fr__nrt--on': ratings[String(cat.no)]?.nrt }"
                  title="Not responding to training — flags the CDO"
                  @click="toggleNrt(cat.no)"
                >NRT</button>
              </span>
            </div>
            <div
              v-if="ratings[String(cat.no)] && typeof ratings[String(cat.no)].score === 'number' && (ratings[String(cat.no)].score as number) < 3"
              class="fr__comment-req"
            >
              <AlertTriangle :size="13" :stroke-width="2" />
              Rating below 3 — describe the specific behavior, the call, and the standard expected.
            </div>
            <textarea
              v-if="commentOpen[String(cat.no)] || (ratings[String(cat.no)] && typeof ratings[String(cat.no)].score === 'number' && (ratings[String(cat.no)].score as number) < 3)"
              v-model="ratings[String(cat.no)].comment"
              class="fr__comment"
              rows="2"
              :placeholder="`Comment for category ${cat.no}`"
            ></textarea>
          </div>
        </template>
      </div>

      <!-- Narratives -->
      <div v-if="isDor" class="fr__card">
        <div class="fr__card-hd">Narrative</div>
        <div class="fr__narratives">
          <label>Most acceptable performance today — cite category # and describe the behavior
            <textarea v-model="narratives.best" rows="3"></textarea>
          </label>
          <label>Least acceptable performance today — cite category # and describe the behavior
            <textarea v-model="narratives.least" rows="3"></textarea>
          </label>
          <label :class="{ 'fr__required': hasOne }">
            Documented situation — required for any rating of 1
            <textarea v-model="narratives.situation" rows="3"></textarea>
          </label>
          <div class="fr__remedial">
            <label style="flex:1">Remedial training delivered today (scenario substitutions, teach-backs, protocol review)
              <textarea v-model="narratives.remedial" rows="2"></textarea>
            </label>
            <label class="fr__minutes">Minutes <input v-model="narratives.remedialMinutes" type="text" inputmode="numeric" /></label>
          </div>
          <label>Goal for the next training day (carried forward to the next DOR)
            <textarea v-model="narratives.goal" rows="2"></textarea>
          </label>
        </div>
      </div>
      <div v-else-if="hasBelowThree" class="fr__card">
        <div class="fr__card-hd">Explanation — required for any category below 3</div>
        <div class="fr__narratives">
          <textarea v-model="explanation" rows="4" placeholder="Cite the category number, what happened on the call, and the standard expected."></textarea>
        </div>
      </div>

      <!-- ICR: optional free narrative about the call -->
      <div v-if="!isDor" class="fr__card">
        <div class="fr__card-hd">Additional call notes <span class="fr__optional">optional</span></div>
        <div class="fr__narratives">
          <textarea v-model="callNotes" rows="4" placeholder="Anything relevant to the call — context, teaching points, follow-up items."></textarea>
        </div>
      </div>

      <!-- Blockers + footer -->
      <div v-if="blockers.length" class="fr__blockers">
        <AlertTriangle :size="15" :stroke-width="2" />
        <ul><li v-for="b in blockers" :key="b">{{ b }}</li></ul>
      </div>
      <div class="fr__footer">
        <button type="button" class="fr__ghost" @click="saveAndExit">
          <Save :size="14" :stroke-width="2" />
          Save draft — finish later
        </button>
        <button type="button" class="fr__primary" :disabled="blockers.length > 0" @click="signing = true">
          Review &amp; sign
        </button>
      </div>

      <!-- Sign overlay -->
      <div v-if="signing" class="fr__overlay" @click.self="signing = false">
        <div class="fr__sign">
          <h2 class="display fr__sign-title">{{ titleFor }} — sign &amp; submit</h2>
          <p class="fr__sign-sum">
            {{ trainee.fullName }} · {{ evalDate }} ·
            <template v-if="average !== null">shift average {{ average.toFixed(2) }}</template>
            <template v-if="nrtFlagged"> · <b class="fr__nrtflag">NRT flagged — the CDO will be notified</b></template>
          </p>
          <p class="fr__attest">
            {{ isDor
              ? 'This DOR was reviewed with the trainee, who had the opportunity to respond. Both signatures attest the ratings and narrative reflect today’s performance.'
              : 'This ICR was reviewed with the trainee. Both signatures attest the ratings reflect performance on this call.' }}
          </p>
          <div class="fr__pads">
            <div v-if="!deferTrainee"><div class="fr__pad-label">Trainee — {{ trainee.fullName }}</div>
              <SignaturePad :height="100" @change="(v: string) => (traineeSig = v || null)" /></div>
            <div v-else class="fr__defer-note">
              <b>Trainee signature deferred.</b>
              {{ trainee.fullName.split(' ')[0] }} will see a "needs your signature" prompt on
              My Progress and can review the finished report and sign there — they can't edit it.
            </div>
            <div><div class="fr__pad-label">Evaluator — {{ auth.appUser?.fullName }}</div>
              <SignaturePad :height="100" @change="(v: string) => (evaluatorSig = v || null)" /></div>
          </div>
          <label v-if="!traineeSig" class="fr__defer">
            <input v-model="deferTrainee" type="checkbox" />
            Trainee unavailable to sign right now (e.g. asleep at shift change) — submit with my
            signature and prompt them to review &amp; sign later
          </label>
          <div v-if="submitError" class="fr__error">{{ submitError }}</div>
          <div class="fr__sign-actions">
            <button type="button" class="fr__ghost" @click="signing = false">Back to form</button>
            <button type="button" class="fr__primary" :disabled="!canSubmit" @click="onSubmit">
              <Check :size="14" :stroke-width="2.5" />
              {{ submitting ? 'Submitting…' : 'Submit report' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fr { max-width: 880px; margin: 0 auto; padding: 24px 16px 90px; }
@media (min-width: 768px) { .fr { padding: 24px 32px 90px; } }
.fr__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }
.fr__topline { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.fr__back {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none; border: none; padding: 0; cursor: pointer;
}
.fr__savestate { font-size: 11.5px; color: var(--color-muted); }
.fr__savestate--saved { color: oklch(0.45 0.12 150); }
.fr__savestate--error { color: oklch(0.5 0.16 30); }
.fr__head { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
.fr__title { font-size: 27px; line-height: 1.1; color: var(--color-ink); }
.fr__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
.fr__head-actions { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }

.fr__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; overflow: hidden; margin-bottom: 16px;
}
.fr__optional {
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--color-muted-soft);
}
.fr__card-hd {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 16px; border-bottom: 1px solid var(--color-line);
  font-size: 13px; font-weight: 700; color: var(--color-ink);
}
.fr__progress { margin-left: auto; font-size: 11.5px; font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.fr__scale { padding: 10px 16px 0; font-size: 11px; line-height: 1.5; color: var(--color-muted); }

.fr__meta { display: flex; flex-wrap: wrap; gap: 12px 18px; padding: 14px 16px; }
.fr__meta label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11.5px; font-weight: 600; color: var(--color-muted);
}
.fr__meta input, .fr__meta select {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 8px; padding: 7px 10px;
  background: var(--color-surface); min-width: 110px;
}
.fr__meta input:focus, .fr__meta select:focus { outline: none; border-color: var(--color-brand-600); }
.fr__wide { flex: 1; min-width: 220px; }
.fr__check { flex-direction: row !important; align-items: center; gap: 8px !important; font-size: 12.5px !important; color: var(--color-ink-soft) !important; }
.fr__check input { min-width: 0; accent-color: var(--color-brand-600); }

.fr__section {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); padding: 14px 16px 6px; border-bottom: 1px solid var(--color-line-soft, #eee);
}
.fr__row { padding: 9px 16px; border-bottom: 1px solid var(--color-surface-soft); }
.fr__row-top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fr__label { flex: 1; min-width: 200px; font-size: 13px; line-height: 1.35; color: var(--color-ink); }
.fr__pips { display: flex; gap: 5px; align-items: center; }
.fr__pip {
  width: 34px; height: 32px; border: 1.5px solid var(--color-line); border-radius: 8px;
  background: var(--color-surface); color: var(--color-muted);
  font-family: var(--font-sans); font-weight: 700; font-size: 12.5px;
  cursor: pointer; transition: all 100ms var(--ease-out); font-variant-numeric: tabular-nums;
}
.fr__pip:hover { border-color: var(--color-accent-strong, #a8842c); }
.fr__pip--on { background: var(--color-brand-950); border-color: var(--color-brand-950); color: var(--color-accent-on-dark, #e8cb72); }
.fr__pip--on.fr__pip--bad { background: oklch(0.5 0.16 30); border-color: oklch(0.5 0.16 30); color: white; }
.fr__pip--no { width: auto; padding: 0 9px; font-size: 10.5px; }
.fr__nrt {
  height: 32px; padding: 0 8px; margin-left: 4px;
  border: 1.5px dashed var(--color-line); border-radius: 8px;
  background: none; color: var(--color-muted);
  font-family: var(--font-sans); font-weight: 800; font-size: 9.5px; letter-spacing: 0.05em;
  cursor: pointer;
}
.fr__nrt--on { border-style: solid; border-color: oklch(0.5 0.16 30); background: oklch(0.95 0.04 30); color: oklch(0.45 0.15 30); }
.fr__comment-req {
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
  background: oklch(0.96 0.03 30); border: 1px solid oklch(0.88 0.05 30);
  color: oklch(0.45 0.15 30); border-radius: 8px; padding: 7px 11px;
  font-size: 11.5px; font-weight: 600;
}
.fr__comment {
  width: 100%; margin-top: 8px;
  font-family: var(--font-sans); font-size: 12.5px; line-height: 1.45; color: var(--color-ink);
  background: var(--color-surface-soft); border: 1.5px solid var(--color-line);
  border-radius: 8px; padding: 8px 10px; resize: vertical;
}
.fr__comment:focus { outline: none; border-color: var(--color-brand-600); }

.fr__narratives { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; }
.fr__narratives label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-ink-soft); }
.fr__narratives textarea {
  font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 9px; padding: 9px 11px;
  background: var(--color-surface); resize: vertical;
}
.fr__narratives textarea:focus { outline: none; border-color: var(--color-brand-600); }
.fr__required { color: oklch(0.45 0.15 30); }
.fr__required textarea { border-color: oklch(0.75 0.08 30); }
.fr__remedial { display: flex; gap: 14px; align-items: flex-start; }
.fr__minutes { width: 80px; flex-shrink: 0; }
.fr__minutes input {
  font-family: var(--font-sans); font-size: 13px; border: 1.5px solid var(--color-line);
  border-radius: 8px; padding: 7px 10px; width: 100%;
}

.fr__blockers {
  display: flex; gap: 10px; align-items: flex-start;
  background: oklch(0.97 0.03 80); border: 1px solid oklch(0.86 0.06 80);
  border-radius: 12px; padding: 12px 15px; margin-bottom: 14px;
  font-size: 12.5px; color: oklch(0.42 0.09 75);
}
.fr__blockers ul { margin: 0; padding-left: 16px; line-height: 1.7; }
.fr__footer { display: flex; justify-content: flex-end; gap: 10px; }

.fr__ghost {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 600;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 10px; padding: 10px 15px; cursor: pointer;
}
.fr__ghost:hover { border-color: var(--color-accent-strong, #a8842c); color: var(--color-ink); }
.fr__primary {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-sans); font-size: 13.5px; font-weight: 700;
  color: white; background: var(--color-brand-800);
  border: none; border-radius: 10px; padding: 11px 18px; cursor: pointer;
}
.fr__primary:hover:not(:disabled) { background: var(--color-brand-900); }
.fr__primary:disabled { opacity: 0.45; cursor: not-allowed; }

.fr__overlay {
  position: fixed; inset: 0; background: oklch(0.2 0.03 260 / 0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 90;
}
.fr__sign {
  width: 100%; max-width: 640px; max-height: 92vh; overflow-y: auto;
  background: var(--color-surface); border-radius: 16px; padding: 22px;
  display: flex; flex-direction: column; gap: 12px;
}
.fr__sign-title { font-size: 21px; color: var(--color-ink); }
.fr__sign-sum { font-size: 13px; color: var(--color-ink-soft); }
.fr__nrtflag { color: oklch(0.45 0.15 30); }
.fr__attest {
  font-size: 11.5px; line-height: 1.5; color: var(--color-ink-soft);
  background: var(--color-surface-soft); border: 1px solid var(--color-line);
  border-radius: 8px; padding: 8px 10px;
}
.fr__pads { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 560px) { .fr__pads { grid-template-columns: 1fr 1fr; } }
.fr__pad-label { font-size: 11.5px; font-weight: 700; color: var(--color-muted); margin-bottom: 4px; }
.fr__error { font-size: 13px; color: oklch(0.5 0.16 30); }
.fr__sign-actions { display: flex; justify-content: flex-end; gap: 10px; }
.fr__defer {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-ink-soft);
  padding: 4px 0 8px;
}
.fr__defer input { margin-top: 2px; }
.fr__defer-note {
  align-self: center;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px dashed var(--color-line);
  border-radius: 9px;
  padding: 10px 12px;
}
.fr__defer-note b { color: var(--color-ink); }
</style>
