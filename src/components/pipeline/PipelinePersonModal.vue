<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import type { PipelinePerson, PipelinePhase, PipelineRequirement } from '@/types'
import {
  PHASE_TARGET_DAYS,
  TRANSITIONS,
  activeTransitionFor,
  badgeKeyFor,
  gateItemsFor,
  petitionItemsFor,
  phaseLabel,
  requirementStatus,
  jurisprudenceStatus,
  type GateItem,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'
import { useAuthStore } from '@/stores/auth'
import PipelineGateRow from './PipelineGateRow.vue'

/**
 * The editor's working surface for one person — gates, compliance, and
 * record fields in a single modal, opened straight from the board row
 * (Justin: inline editing was too cumbersome; check-offs need to be
 * fast and in one place).
 */

const props = defineProps<{
  person: PipelinePerson
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const auth = useAuthStore()
const {
  canEdit,
  gatesFor,
  setGate,
  clearGate,
  saveRecord,
  promote,
  requirements,
  completionsFor,
  addCompletion,
  removeCompletion,
} = usePipeline()

const record = computed(() => props.person.record)
const transition = computed(() => activeTransitionFor(record.value))
const def = computed(() => (transition.value ? TRANSITIONS[transition.value] : null))
const gateRows = computed(() => gatesFor(record.value.id))
const items = computed(() => gateItemsFor(record.value, gateRows.value))
const petitions = computed(() => petitionItemsFor(record.value, gateRows.value))
const allGatesDone = computed(
  () => items.value.length > 0 && items.value.every((i) => i.status === 'complete' || i.status === 'na'),
)

const busyError = ref<string | null>(null)

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/* ── Gates ─────────────────────────────────────────────────────────── */

async function cycleGate(item: GateItem) {
  if (!transition.value) return
  busyError.value = null
  try {
    if (item.kind === 'access') {
      /* Access items toggle the held/not-held record flag. */
      const key = item.key === 'op_iq' ? 'opIqAccess' : 'narcSafeAccess'
      await saveRecord({ userId: props.person.userId, [key]: item.status !== 'complete' })
      return
    }
    const next = item.status === 'complete' ? 'na' : item.status === 'na' ? 'pending' : 'complete'
    await setGate(record.value.id, transition.value, item.key, next, item.value)
  } catch (err) {
    busyError.value = (err as Error).message
  }
}

async function setGateValue(item: GateItem, value: string) {
  if (!transition.value) return
  const status = item.status === 'untracked' ? 'pending' : item.status === 'complete' || item.status === 'na' ? item.status : 'pending'
  try {
    await setGate(record.value.id, transition.value, item.key, status, value || null)
  } catch (err) {
    busyError.value = (err as Error).message
  }
}

async function togglePetition(p: GateItem) {
  if (!transition.value) return
  busyError.value = null
  try {
    if (p.status === 'complete') {
      await clearGate(record.value.id, transition.value, p.key)
    } else {
      await setGate(record.value.id, transition.value, p.key, 'complete', auth.appUser?.fullName ?? null)
    }
  } catch (err) {
    busyError.value = (err as Error).message
  }
}

const promoting = ref(false)
async function doPromote() {
  if (!record.value.workingPhase) return
  if (!confirm(`Promote ${props.person.fullName}: cleared ${phaseLabel(record.value.workingPhase)}?`)) return
  promoting.value = true
  try {
    await promote(props.person)
  } finally {
    promoting.value = false
  }
}

/* ── Compliance ────────────────────────────────────────────────────── */

const myCompletions = computed(() => completionsFor(props.person.userId))

/* Level-scoped requirements (ACLS/PALS = paramedic-only) only appear
   for the levels they apply to — unless the person has a completion
   on file anyway (staff who voluntarily track extra cards). */
const activeRequirements = computed(() =>
  requirements.value.filter((r) => {
    if (!r.active) return false
    if (r.requiredLevels.length === 0) return true
    const lvl = record.value.certLevel
    if (lvl && r.requiredLevels.includes(lvl)) return true
    return myCompletions.value.some((c) => c.requirementId === r.id)
  }),
)

function reqStatus(req: PipelineRequirement) {
  return requirementStatus(req, myCompletions.value, record.value)
}

const compDraft = reactive<Record<string, { completedAt: string; expiresAt: string }>>({})
const compOpen = ref<string | null>(null)

function toggleCompForm(reqId: string) {
  if (compOpen.value === reqId) {
    compOpen.value = null
    return
  }
  if (!compDraft[reqId]) {
    compDraft[reqId] = { completedAt: new Date().toISOString().slice(0, 10), expiresAt: '' }
  }
  compOpen.value = reqId
}

async function submitCompletion(req: PipelineRequirement) {
  const d = compDraft[req.id]
  if (!d) return
  busyError.value = null
  try {
    await addCompletion({
      requirementId: req.id,
      userId: props.person.userId,
      completedAt: d.completedAt,
      expiresAt: req.cycle === 'certification' ? d.expiresAt || null : null,
    })
    compOpen.value = null
  } catch (err) {
    busyError.value = (err as Error).message
  }
}

async function undoCompletion(id: string) {
  if (!confirm('Remove this completion record?')) return
  try {
    await removeCompletion(id)
  } catch (err) {
    busyError.value = (err as Error).message
  }
}

const juris = computed(() => jurisprudenceStatus(record.value))

/* ── Record section — collapsed + action-driven ────────────────────
   The raw field grid used to render for every employee; now it hides
   behind "Edit full record" and the common move — starting someone in
   a phase — is its own button with the target date pre-filled from
   the FTEP Program Guide's standard windows (Justin, 2026-08-24). */

const recordOpen = ref(false)
const enrollOpen = ref(false)

const ENROLL_PHASES: PipelinePhase[] = ['NEOP', 'FTR', 'P1', 'P2', 'P3']
const enroll = reactive({
  phase: '' as PipelinePhase | '',
  startedAt: new Date().toISOString().slice(0, 10),
  targetAt: '',
  targetTouched: false,
  busy: false,
})

function autoTarget(): void {
  if (enroll.targetTouched || !enroll.phase || !enroll.startedAt) return
  const days = PHASE_TARGET_DAYS[enroll.phase]
  if (!days) { enroll.targetAt = ''; return }
  const d = new Date(`${enroll.startedAt}T00:00:00`)
  d.setDate(d.getDate() + days)
  enroll.targetAt = d.toISOString().slice(0, 10)
}
watch(() => [enroll.phase, enroll.startedAt], autoTarget)

function openEnroll() {
  enroll.phase = ''
  enroll.startedAt = new Date().toISOString().slice(0, 10)
  enroll.targetAt = ''
  enroll.targetTouched = false
  enrollOpen.value = !enrollOpen.value
}

async function saveEnroll() {
  if (!enroll.phase || enroll.busy) return
  enroll.busy = true
  busyError.value = null
  try {
    await saveRecord({
      userId: props.person.userId,
      workingPhase: enroll.phase,
      workingStartedAt: enroll.startedAt || null,
      workingTargetAt: enroll.targetAt || null,
      pending: false,
    })
    /* Keep the raw form in step so opening it next doesn't show stale
       phase fields. */
    form.workingPhase = enroll.phase
    form.workingStartedAt = enroll.startedAt
    form.workingTargetAt = enroll.targetAt
    form.pending = false
    enrollOpen.value = false
  } catch (err) {
    busyError.value = (err as Error).message
  } finally {
    enroll.busy = false
  }
}

/* ── Record form ───────────────────────────────────────────────────── */

const PHASES: Array<PipelinePhase | ''> = ['', 'NEOP', 'FTR', 'P1', 'P2', 'P3', 'FinalRelease']
const saving = ref(false)

const form = reactive({
  clearedPhase: (record.value.clearedPhase ?? '') as PipelinePhase | '',
  workingPhase: (record.value.workingPhase ?? '') as PipelinePhase | '',
  workingStartedAt: record.value.workingStartedAt ?? '',
  workingTargetAt: record.value.workingTargetAt ?? '',
  level: record.value.level ?? '',
  ftoName: record.value.ftoName ?? '',
  pending: record.value.pending,
  pipActive: record.value.pipActive,
  pipReason: record.value.pipReason ?? '',
  inP3Process: record.value.inP3Process,
  inAemtUpgrade: record.value.inAemtUpgrade,
  legacyTrack: record.value.legacyTrack,
  isFto: record.value.isFto,
  txJurisprudenceAt: record.value.txJurisprudenceAt ?? '',
  bloodbornePathogenAt: record.value.bloodbornePathogenAt ?? '',
  estP2ReadyAt: record.value.estP2ReadyAt ?? '',
  coverageNote: record.value.coverageNote ?? '',
  blockerNote: record.value.blockerNote ?? '',
  notes: record.value.notes ?? '',
})

async function saveForm() {
  saving.value = true
  busyError.value = null
  try {
    await saveRecord({
      userId: props.person.userId,
      clearedPhase: form.clearedPhase || null,
      workingPhase: form.workingPhase || null,
      workingStartedAt: form.workingStartedAt || null,
      workingTargetAt: form.workingTargetAt || null,
      level: form.level.trim() || null,
      ftoName: form.ftoName.trim() || null,
      pending: form.pending,
      pipActive: form.pipActive,
      pipReason: form.pipReason.trim() || null,
      inP3Process: form.inP3Process,
      inAemtUpgrade: form.inAemtUpgrade,
      legacyTrack: form.legacyTrack,
      isFto: form.isFto,
      txJurisprudenceAt: form.txJurisprudenceAt || null,
      bloodbornePathogenAt: form.bloodbornePathogenAt || null,
      estP2ReadyAt: form.estP2ReadyAt || null,
      coverageNote: form.coverageNote.trim() || null,
      blockerNote: form.blockerNote.trim() || null,
      notes: form.notes.trim() || null,
    })
    emit('close')
  } catch (err) {
    busyError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="pm__overlay" @click.self="emit('close')">
    <div class="pm" role="dialog" aria-modal="true">
      <header class="pm__head">
        <div>
          <h3 class="display pm__name">{{ person.fullName }}</h3>
          <div class="pm__meta">
            <span class="pm__badge" :class="`pm__badge--${badgeKeyFor(record.level)}`">
              {{ record.level || record.certLevel || '—' }}
            </span>
            <span v-if="def">{{ def.label }}</span>
            <span v-else-if="record.clearedPhase">Cleared · {{ phaseLabel(record.clearedPhase) }}</span>
          </div>
        </div>
        <button type="button" class="pm__close" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
      </header>

      <div class="pm__body">
        <p v-if="busyError" class="pm__err">{{ busyError }}</p>

        <!-- Gates -->
        <section v-if="items.length" class="pm__section">
          <h4 class="pm__h">Credentialing gates <span v-if="def" class="pm__h-sub">{{ def.label }}</span></h4>
          <PipelineGateRow
            v-for="item in items"
            :key="item.key"
            :item="item"
            :editable="canEdit"
            @cycle="cycleGate(item)"
            @set-value="(v) => setGateValue(item, v)"
          />
          <div v-if="petitions.length" class="pm__pets">
            <button
              v-for="p in petitions"
              :key="p.key"
              type="button"
              class="pm__sig"
              :class="{ 'pm__sig--ok': p.status === 'complete' }"
              :disabled="!canEdit"
              @click="togglePetition(p)"
            >
              <span class="pm__sig-role">{{ p.label }}</span>
              <span class="pm__sig-state">{{ p.status === 'complete' ? `✓ ${p.value || 'Signed'}` : 'Tap to sign' }}</span>
            </button>
          </div>
          <button
            v-if="canEdit && allGatesDone && record.workingPhase"
            type="button"
            class="btn btn-primary pm__promote"
            :disabled="promoting"
            @click="doPromote"
          >
            {{ promoting ? 'Promoting…' : `Promote → cleared ${record.workingPhase}` }}
          </button>
        </section>

        <!-- Compliance -->
        <section class="pm__section">
          <h4 class="pm__h">Compliance &amp; certifications</h4>
          <div
            class="pm__req"
            :class="{ 'pm__req--due': juris.state === 'due' }"
          >
            <span class="pm__req-name">TX Jurisprudence <span class="pm__req-cycle">per licensure cycle</span></span>
            <span class="pm__req-latest">{{ fmt(record.txJurisprudenceAt) }}</span>
            <span
              class="pm__req-pill"
              :class="juris.state === 'due' ? 'pm__req-pill--due' : juris.state === 'required' ? 'pm__req-pill--tag' : 'pm__req-pill--ok'"
            >
              {{ juris.state === 'ok' ? 'Current cycle ✓'
                : juris.state === 'due' ? `Due — reassign in LMS${juris.requiredBefore ? ` before ${fmt(juris.requiredBefore)}` : ''}`
                : `Required before ${juris.requiredBefore ? fmt(juris.requiredBefore) : 'license renewal'}` }}
            </span>
          </div>
          <template v-for="req in activeRequirements" :key="req.id">
            <div class="pm__req" :class="{ 'pm__req--due': reqStatus(req).state === 'due' }">
              <span class="pm__req-name">
                {{ req.name }}
                <span class="pm__req-cycle">{{ { annual: 'annual', per_cert_cycle: 'per licensure cycle', certification: 'card', one_time: 'one-time' }[req.cycle] }}</span>
              </span>
              <span class="pm__req-latest">
                <template v-if="reqStatus(req).latest">
                  {{ fmt(reqStatus(req).latest!.completedAt) }}
                  <template v-if="reqStatus(req).latest!.expiresAt"> → exp {{ fmt(reqStatus(req).latest!.expiresAt) }}</template>
                  <button
                    v-if="canEdit"
                    type="button"
                    class="pm__req-undo"
                    title="Remove this completion"
                    @click="undoCompletion(reqStatus(req).latest!.id)"
                  >×</button>
                </template>
                <template v-else>—</template>
              </span>
              <span
                class="pm__req-pill"
                :class="{
                  'pm__req-pill--ok': reqStatus(req).state === 'ok',
                  'pm__req-pill--warn': reqStatus(req).state === 'expiring',
                  'pm__req-pill--due': reqStatus(req).state === 'due',
                  'pm__req-pill--tag': reqStatus(req).state === 'required',
                }"
              >
                {{ reqStatus(req).state === 'ok' ? '✓'
                  : reqStatus(req).state === 'expiring' ? `Expiring ${fmt(reqStatus(req).dueAt)}`
                  : reqStatus(req).state === 'required' ? `Required before ${reqStatus(req).dueAt ? fmt(reqStatus(req).dueAt) : 'license renewal'}`
                  : req.cycle === 'per_cert_cycle' && reqStatus(req).dueAt ? `Due before ${fmt(reqStatus(req).dueAt)}` : 'Due' }}
              </span>
              <button
                v-if="canEdit"
                type="button"
                class="pm__req-add"
                @click="toggleCompForm(req.id)"
              >
                {{ compOpen === req.id ? 'Cancel' : '+ Record' }}
              </button>
            </div>
            <div v-if="compOpen === req.id && canEdit && compDraft[req.id]" class="pm__req-form">
              <label>Completed <input v-model="compDraft[req.id].completedAt" type="date" /></label>
              <label v-if="req.cycle === 'certification'">Card expires <input v-model="compDraft[req.id].expiresAt" type="date" /></label>
              <button type="button" class="btn btn-primary" @click="submitCompletion(req)">Save</button>
            </div>
          </template>
        </section>

        <!-- Record -->
        <section class="pm__section">
          <h4 class="pm__h">Record</h4>

          <!-- Compact summary — the raw field grid stays collapsed -->
          <div class="pm__recsum">
            <span v-if="record.workingPhase" class="pm__recfact">
              <b>Working {{ record.workingPhase }}</b>
              <template v-if="record.workingStartedAt"> · started {{ fmt(record.workingStartedAt) }}</template>
              <template v-if="record.workingTargetAt"> · target {{ fmt(record.workingTargetAt) }}</template>
            </span>
            <span v-else class="pm__recfact">Not enrolled in a working phase</span>
            <span v-if="record.clearedPhase" class="pm__recfact">Cleared {{ record.clearedPhase }}</span>
            <span v-if="record.ftoName" class="pm__recfact">FTO {{ record.ftoName }}</span>
            <span v-if="record.legacyTrack" class="pm__recflag">Legacy track</span>
            <span v-if="record.inP3Process" class="pm__recflag">P3 / supervisor</span>
            <span v-if="record.inAemtUpgrade" class="pm__recflag">AEMT upgrade</span>
            <span v-if="record.pending" class="pm__recflag">Awaiting clearance</span>
            <span v-if="record.pipActive" class="pm__recflag pm__recflag--warn">PIP</span>
          </div>

          <div v-if="canEdit" class="pm__recactions">
            <button type="button" class="btn" :class="{ 'btn-primary': enrollOpen }" @click="openEnroll">
              {{ enrollOpen ? 'Cancel enrollment' : 'Enroll in new working phase' }}
            </button>
            <button type="button" class="btn" @click="recordOpen = !recordOpen">
              {{ recordOpen ? 'Hide full record' : 'Edit full record' }}
            </button>
          </div>

          <!-- Enroll flow: target date auto-fills from the FTEP
               Program Guide's standard windows, editable for
               extensions. -->
          <div v-if="enrollOpen && canEdit" class="pm__enroll">
            <label class="pm__field">
              <span>New working phase</span>
              <select v-model="enroll.phase">
                <option value="" disabled>Select…</option>
                <option v-for="p in ENROLL_PHASES" :key="p" :value="p">{{ phaseLabel(p) }}</option>
              </select>
            </label>
            <label class="pm__field"><span>Start date</span><input v-model="enroll.startedAt" type="date" /></label>
            <label class="pm__field">
              <span>Target date <em class="pm__auto">auto from program standard — edit for extensions</em></span>
              <input v-model="enroll.targetAt" type="date" @input="enroll.targetTouched = true" />
            </label>
            <button type="button" class="btn btn-primary" :disabled="!enroll.phase || enroll.busy" @click="saveEnroll">
              {{ enroll.busy ? 'Saving…' : 'Enroll' }}
            </button>
          </div>

          <div v-if="recordOpen" class="pm__grid">
            <label class="pm__field">
              <span>Cleared phase</span>
              <select v-model="form.clearedPhase"><option v-for="p in PHASES" :key="`c${p}`" :value="p">{{ p || '—' }}</option></select>
            </label>
            <label class="pm__field">
              <span>Working phase</span>
              <select v-model="form.workingPhase"><option v-for="p in PHASES" :key="`w${p}`" :value="p">{{ p || '—' }}</option></select>
            </label>
            <label class="pm__field"><span>Phase started</span><input v-model="form.workingStartedAt" type="date" /></label>
            <label class="pm__field"><span>Target date</span><input v-model="form.workingTargetAt" type="date" /></label>
            <label class="pm__field"><span>Credential level</span><input v-model="form.level" type="text" placeholder="P1C / P1 / P2 / FTO / ADV / EMT" /></label>
            <label class="pm__field"><span>Assigned FTO</span><input v-model="form.ftoName" type="text" /></label>
            <label class="pm__field"><span>TX jurisprudence</span><input v-model="form.txJurisprudenceAt" type="date" /></label>
            <label class="pm__field"><span>Bloodborne pathogens</span><input v-model="form.bloodbornePathogenAt" type="date" /></label>
            <label class="pm__field"><span>Est. P2-ready</span><input v-model="form.estP2ReadyAt" type="date" /></label>
          </div>
          <template v-if="recordOpen">
            <div class="pm__flags">
              <label><input v-model="form.legacyTrack" type="checkbox" /> Legacy P1→P2 program</label>
              <label><input v-model="form.pending" type="checkbox" /> Awaiting clearance</label>
              <label><input v-model="form.inP3Process" type="checkbox" /> P3 / supervisor track</label>
              <label><input v-model="form.inAemtUpgrade" type="checkbox" /> AEMT upgrade</label>
              <label><input v-model="form.isFto" type="checkbox" /> Is an FTO</label>
              <label><input v-model="form.pipActive" type="checkbox" /> PIP active</label>
            </div>
            <label v-if="form.pipActive" class="pm__field pm__field--wide"><span>PIP reason</span><input v-model="form.pipReason" type="text" /></label>
            <label class="pm__field pm__field--wide"><span>Coverage impact</span><input v-model="form.coverageNote" type="text" /></label>
            <label class="pm__field pm__field--wide"><span>Blocker</span><input v-model="form.blockerNote" type="text" /></label>
            <label class="pm__field pm__field--wide"><span>Notes</span><textarea v-model="form.notes" rows="2"></textarea></label>
          </template>
        </section>
      </div>

      <footer class="pm__foot">
        <button type="button" class="btn" @click="emit('close')">Close</button>
        <button v-if="recordOpen" type="button" class="btn btn-primary" :disabled="saving || !canEdit" @click="saveForm">
          {{ saving ? 'Saving…' : 'Save record' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pm__overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.2 0.04 250 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.pm {
  width: 100%;
  max-width: 720px;
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.pm__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--color-line);
}
.pm__name {
  font-size: 24px;
  color: var(--color-brand-800);
}
.pm__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.pm__badge {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: 999px;
}
.pm__badge--P1C { background: oklch(0.94 0.03 300); color: oklch(0.42 0.12 300); }
.pm__badge--P1 { background: oklch(0.94 0.03 240); color: oklch(0.4 0.1 240); }
.pm__badge--P2 { background: var(--color-success-50); color: var(--color-success-500); }
.pm__badge--FTO { background: var(--color-warning-50); color: oklch(0.5 0.12 75); }
.pm__badge--other { background: var(--color-surface-soft); color: var(--color-ink-soft); border: 1px solid var(--color-line); }
.pm__close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 4px;
}
.pm__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 22px 16px;
}
.pm__err {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--color-danger-500);
}
.pm__section {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-line-soft);
}
.pm__section:last-child {
  border-bottom: none;
}
.pm__h {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.pm__h-sub {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-accent-700);
}
.pm__pets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.pm__sig {
  border: 1.5px dashed var(--color-line);
  border-radius: 9px;
  padding: 8px 6px;
  text-align: center;
  background: var(--color-surface);
  cursor: pointer;
}
.pm__sig:disabled {
  cursor: default;
}
.pm__sig:not(:disabled):hover {
  border-color: var(--color-accent-600);
}
.pm__sig--ok {
  border-style: solid;
  border-color: var(--color-success-500);
  background: var(--color-success-50);
}
.pm__sig-role {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.pm__sig-state {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--color-muted-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pm__sig--ok .pm__sig-state {
  color: var(--color-success-500);
  font-weight: 600;
}
.pm__promote {
  margin-top: 12px;
  width: 100%;
}
.pm__req {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13px;
}
.pm__req-name {
  flex: 1;
  min-width: 0;
  color: var(--color-ink);
}
.pm__req-cycle {
  margin-left: 6px;
  font-size: 10.5px;
  color: var(--color-muted-soft);
}
.pm__req-latest {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
}
.pm__req-undo {
  margin-left: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-danger-500);
  font-size: 13px;
  padding: 0 2px;
}
.pm__req-pill {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.pm__req-pill--ok { background: var(--color-success-50); color: var(--color-success-500); }
.pm__req-pill--warn { background: var(--color-warning-50); color: oklch(0.5 0.12 75); }
.pm__req-pill--due { background: var(--color-danger-50); color: var(--color-danger-500); }
/* Deadline tag — informational, not an alarm. */
.pm__req-pill--tag { background: var(--color-surface-soft); color: var(--color-ink-soft); border: 1px solid var(--color-line); }
.pm__recsum {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.pm__recfact b { color: var(--color-ink); font-weight: 600; }
.pm__recflag {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
}
.pm__recflag--warn { background: var(--color-danger-50); border-color: transparent; color: var(--color-danger-500); }
.pm__recactions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.pm__enroll {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px 14px;
  align-items: end;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  background: var(--color-surface-soft);
}
.pm__auto {
  display: block;
  font-style: normal;
  font-weight: 400;
  font-size: 10px;
  color: var(--color-muted-soft);
}
.pm__grid { margin-top: 12px; }
.pm__req-add {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}
.pm__req-add:hover {
  text-decoration: underline;
}
.pm__req-form {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--color-line-soft);
}
.pm__req-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
}
.pm__req-form input {
  font-size: 13px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.pm__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px 14px;
}
.pm__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
}
.pm__field--wide {
  margin-top: 10px;
}
.pm__field input,
.pm__field select,
.pm__field textarea {
  font-size: 13px;
  font-weight: 400;
  padding: 7px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.pm__field input:focus,
.pm__field select:focus,
.pm__field textarea:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.pm__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--color-ink);
}
.pm__flags label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pm__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-soft);
}
</style>
