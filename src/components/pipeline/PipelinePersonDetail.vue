<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { PipelinePerson, PipelinePhase } from '@/types'
import {
  TRANSITIONS,
  activeTransitionFor,
  gateItemsFor,
  petitionItemsFor,
  phaseLabel,
  type GateItem,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'
import { useAuthStore } from '@/stores/auth'
import PipelineGateRow from './PipelineGateRow.vue'

/**
 * Expanded person panel — the two-panel layout from the approved
 * pipeline board: credentialing gates (with the petition signature
 * chain) beside compliance & credentials, plus coverage/blocker notes.
 * Editors additionally get gate check-off controls and an inline
 * record-edit form.
 */

const props = defineProps<{
  person: PipelinePerson
}>()

const { canEdit, gatesFor, setGate, clearGate, saveRecord, promote } = usePipeline()
const auth = useAuthStore()

const record = computed(() => props.person.record)
const transition = computed(() => activeTransitionFor(record.value))
const def = computed(() => (transition.value ? TRANSITIONS[transition.value] : null))
const gateRows = computed(() => gatesFor(record.value.id))
const items = computed(() => gateItemsFor(record.value, gateRows.value))
const petitions = computed(() => petitionItemsFor(record.value, gateRows.value))
const allGatesDone = computed(
  () => items.value.length > 0 && items.value.every((i) => i.status === 'complete' || i.status === 'na'),
)

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function cycleGate(item: GateItem) {
  if (!transition.value) return
  /* untracked/pending → complete → na → pending */
  const next = item.status === 'complete' ? 'na' : item.status === 'na' ? 'pending' : 'complete'
  await setGate(record.value.id, transition.value, item.key, next, item.value)
}

async function setGateValue(item: GateItem, value: string) {
  if (!transition.value) return
  const status = item.status === 'untracked' ? 'pending' : item.status
  await setGate(record.value.id, transition.value, item.key, status, value || null)
}

async function togglePetition(p: GateItem) {
  if (!transition.value || !canEdit.value) return
  if (p.status === 'complete') {
    await clearGate(record.value.id, transition.value, p.key)
  } else {
    await setGate(
      record.value.id,
      transition.value,
      p.key,
      'complete',
      auth.appUser?.fullName ?? null,
    )
  }
}

/* ── Inline record editor ─────────────────────────────────────────── */

const editing = ref(false)
const saving = ref(false)
const editError = ref<string | null>(null)

const PHASES: Array<PipelinePhase | ''> = ['', 'NEOP', 'FTR', 'P1', 'P2', 'P3', 'FinalRelease']

const form = reactive({
  clearedPhase: '' as PipelinePhase | '',
  workingPhase: '' as PipelinePhase | '',
  workingStartedAt: '',
  workingTargetAt: '',
  level: '',
  ftoName: '',
  pending: false,
  pipActive: false,
  pipReason: '',
  inP3Process: false,
  inAemtUpgrade: false,
  isFto: false,
  txJurisprudenceAt: '',
  bloodbornePathogenAt: '',
  opIqGrantedAt: '',
  narcSafeGrantedAt: '',
  estP2ReadyAt: '',
  coverageNote: '',
  blockerNote: '',
  notes: '',
})

function startEdit() {
  const r = record.value
  form.clearedPhase = r.clearedPhase ?? ''
  form.workingPhase = r.workingPhase ?? ''
  form.workingStartedAt = r.workingStartedAt ?? ''
  form.workingTargetAt = r.workingTargetAt ?? ''
  form.level = r.level ?? ''
  form.ftoName = r.ftoName ?? ''
  form.pending = r.pending
  form.pipActive = r.pipActive
  form.pipReason = r.pipReason ?? ''
  form.inP3Process = r.inP3Process
  form.inAemtUpgrade = r.inAemtUpgrade
  form.isFto = r.isFto
  form.txJurisprudenceAt = r.txJurisprudenceAt ?? ''
  form.bloodbornePathogenAt = r.bloodbornePathogenAt ?? ''
  form.opIqGrantedAt = r.opIqGrantedAt ?? ''
  form.narcSafeGrantedAt = r.narcSafeGrantedAt ?? ''
  form.estP2ReadyAt = r.estP2ReadyAt ?? ''
  form.coverageNote = r.coverageNote ?? ''
  form.blockerNote = r.blockerNote ?? ''
  form.notes = r.notes ?? ''
  editError.value = null
  editing.value = true
}

async function saveEdit() {
  saving.value = true
  editError.value = null
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
      isFto: form.isFto,
      txJurisprudenceAt: form.txJurisprudenceAt || null,
      bloodbornePathogenAt: form.bloodbornePathogenAt || null,
      opIqGrantedAt: form.opIqGrantedAt || null,
      narcSafeGrantedAt: form.narcSafeGrantedAt || null,
      estP2ReadyAt: form.estP2ReadyAt || null,
      coverageNote: form.coverageNote.trim() || null,
      blockerNote: form.blockerNote.trim() || null,
      notes: form.notes.trim() || null,
    })
    editing.value = false
  } catch (err) {
    editError.value = (err as Error).message
  } finally {
    saving.value = false
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
</script>

<template>
  <div class="pd">
    <div class="pd__panels">
      <!-- Credentialing gates -->
      <div class="pd__panel">
        <h4 class="pd__h">
          Credentialing gates
          <span v-if="def" class="pd__h-sub">{{ def.label }}</span>
        </h4>
        <template v-if="items.length">
          <PipelineGateRow
            v-for="item in items"
            :key="item.key"
            :item="item"
            :editable="canEdit && !!transition"
            @cycle="cycleGate(item)"
            @set-value="(v) => setGateValue(item, v)"
          />
          <div v-if="petitions.length" class="pd__pets">
            <button
              v-for="p in petitions"
              :key="p.key"
              type="button"
              class="pd__sig"
              :class="{ 'pd__sig--ok': p.status === 'complete', 'pd__sig--btn': canEdit }"
              :disabled="!canEdit"
              @click="togglePetition(p)"
            >
              <span class="pd__sig-role">{{ p.label }}</span>
              <span class="pd__sig-state">
                {{ p.status === 'complete' ? `✓ ${p.value || 'Signed'}` : '—' }}
              </span>
            </button>
          </div>
          <button
            v-if="canEdit && allGatesDone && record.workingPhase"
            type="button"
            class="btn btn-primary pd__promote"
            :disabled="promoting"
            @click="doPromote"
          >
            {{ promoting ? 'Promoting…' : `Promote → cleared ${record.workingPhase}` }}
          </button>
        </template>
        <p v-else class="pd__none">
          No active progression — {{ record.clearedPhase === 'FinalRelease' ? 'fully credentialed.' : 'not currently in a phase.' }}
        </p>
      </div>

      <!-- Compliance & credentials -->
      <div class="pd__panel">
        <h4 class="pd__h">
          Compliance &amp; credentials
          <button v-if="canEdit" type="button" class="pd__edit" @click="editing ? (editing = false) : startEdit()">
            {{ editing ? 'Close' : 'Edit record' }}
          </button>
        </h4>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.txLicenseExpiresAt }">{{ record.txLicenseExpiresAt ? '✓' : '·' }}</span><span class="pd__fk">TX license expires</span><span class="pd__fv">{{ fmt(record.txLicenseExpiresAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.txJurisprudenceAt }">{{ record.txJurisprudenceAt ? '✓' : '·' }}</span><span class="pd__fk">TX jurisprudence</span><span class="pd__fv">{{ fmt(record.txJurisprudenceAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.bloodbornePathogenAt }">{{ record.bloodbornePathogenAt ? '✓' : '·' }}</span><span class="pd__fk">Bloodborne pathogens</span><span class="pd__fv">{{ fmt(record.bloodbornePathogenAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.workingStartedAt }">{{ record.workingStartedAt ? '✓' : '·' }}</span><span class="pd__fk">Phase started</span><span class="pd__fv">{{ fmt(record.workingStartedAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.estP2ReadyAt }">{{ record.estP2ReadyAt ? '✓' : '·' }}</span><span class="pd__fk">Est. P2-ready</span><span class="pd__fv">{{ fmt(record.estP2ReadyAt) }}</span></div>
        <div v-if="record.txLicenseNumber" class="pd__fact"><span class="pd__ic pd__ic--ok">✓</span><span class="pd__fk">TX license #</span><span class="pd__fv">{{ record.txLicenseNumber }}</span></div>

        <div v-if="record.coverageNote" class="pd__note"><b>Coverage impact:</b> {{ record.coverageNote }}</div>
        <div v-if="record.blockerNote" class="pd__note pd__note--bad"><b>Blocker:</b> {{ record.blockerNote }}</div>
        <div v-if="record.pipActive && record.pipReason" class="pd__note pd__note--bad"><b>PIP:</b> {{ record.pipReason }}</div>
        <div v-if="record.notes" class="pd__note"><b>Notes:</b> {{ record.notes }}</div>
      </div>
    </div>

    <!-- Inline record editor (editors only) -->
    <form v-if="editing" class="pd__form" @submit.prevent="saveEdit">
      <div class="pd__grid">
        <label class="pd__field">
          <span>Cleared phase</span>
          <select v-model="form.clearedPhase">
            <option v-for="p in PHASES" :key="`c${p}`" :value="p">{{ p || '—' }}</option>
          </select>
        </label>
        <label class="pd__field">
          <span>Working phase</span>
          <select v-model="form.workingPhase">
            <option v-for="p in PHASES" :key="`w${p}`" :value="p">{{ p || '—' }}</option>
          </select>
        </label>
        <label class="pd__field"><span>Phase started</span><input v-model="form.workingStartedAt" type="date" /></label>
        <label class="pd__field"><span>Target date</span><input v-model="form.workingTargetAt" type="date" /></label>
        <label class="pd__field"><span>Credential level</span><input v-model="form.level" type="text" placeholder="P1C / P1 / P2 / FTO / ADV / EMT" /></label>
        <label class="pd__field"><span>Assigned FTO</span><input v-model="form.ftoName" type="text" /></label>
        <label class="pd__field"><span>TX jurisprudence</span><input v-model="form.txJurisprudenceAt" type="date" /></label>
        <label class="pd__field"><span>Bloodborne pathogens</span><input v-model="form.bloodbornePathogenAt" type="date" /></label>
        <label class="pd__field"><span>Operative IQ granted</span><input v-model="form.opIqGrantedAt" type="date" /></label>
        <label class="pd__field"><span>NarcSafe granted</span><input v-model="form.narcSafeGrantedAt" type="date" /></label>
        <label class="pd__field"><span>Est. P2-ready</span><input v-model="form.estP2ReadyAt" type="date" /></label>
      </div>
      <div class="pd__flags">
        <label><input v-model="form.pending" type="checkbox" /> Awaiting clearance</label>
        <label><input v-model="form.inP3Process" type="checkbox" /> P3 / FTO track</label>
        <label><input v-model="form.inAemtUpgrade" type="checkbox" /> AEMT upgrade</label>
        <label><input v-model="form.isFto" type="checkbox" /> Is an FTO</label>
        <label><input v-model="form.pipActive" type="checkbox" /> PIP active</label>
      </div>
      <label v-if="form.pipActive" class="pd__field pd__field--wide"><span>PIP reason</span><input v-model="form.pipReason" type="text" /></label>
      <label class="pd__field pd__field--wide"><span>Coverage impact</span><input v-model="form.coverageNote" type="text" /></label>
      <label class="pd__field pd__field--wide"><span>Blocker</span><input v-model="form.blockerNote" type="text" /></label>
      <label class="pd__field pd__field--wide"><span>Notes</span><textarea v-model="form.notes" rows="2"></textarea></label>
      <p v-if="editError" class="pd__err">{{ editError }}</p>
      <div class="pd__form-actions">
        <button type="button" class="btn" @click="editing = false">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save record' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.pd {
  padding: 16px 18px 18px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-line-soft);
}
.pd__panels {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
@media (min-width: 900px) {
  .pd__panels {
    grid-template-columns: 1.2fr 1fr;
  }
}
.pd__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-line-soft);
  border-radius: 12px;
  padding: 14px 16px;
}
.pd__h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.pd__h-sub {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-accent-700);
}
.pd__edit {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.pd__edit:hover {
  text-decoration: underline;
}
.pd__none {
  font-size: 12.5px;
  color: var(--color-muted-soft);
  padding: 6px 0;
}
.pd__pets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.pd__sig {
  border: 1.5px dashed var(--color-line);
  border-radius: 9px;
  padding: 8px 6px;
  text-align: center;
  background: var(--color-surface);
}
.pd__sig--btn {
  cursor: pointer;
}
.pd__sig--btn:hover {
  border-color: var(--color-accent-600);
}
.pd__sig--ok {
  border-style: solid;
  border-color: var(--color-success-500);
  background: var(--color-success-50);
}
.pd__sig-role {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.pd__sig-state {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--color-ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd__sig--ok .pd__sig-state {
  color: var(--color-success-500);
  font-weight: 600;
}
.pd__promote {
  margin-top: 12px;
  width: 100%;
}
.pd__fact {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13px;
}
.pd__fact:last-of-type {
  border-bottom: none;
}
.pd__ic {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  border: 1.5px solid var(--color-line);
  color: var(--color-muted);
}
.pd__ic--ok {
  background: var(--color-success-50);
  border-color: var(--color-success-500);
  color: var(--color-success-500);
}
.pd__fk {
  flex: 1;
  color: var(--color-ink);
}
.pd__fv {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}
.pd__note {
  margin-top: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--color-accent-600);
  background: var(--color-surface-soft);
  border-radius: 0 8px 8px 0;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.pd__note--bad {
  border-left-color: var(--color-danger-500);
}
.pd__form {
  margin-top: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 16px;
}
.pd__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px 14px;
}
.pd__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
}
.pd__field--wide {
  margin-top: 10px;
}
.pd__field input,
.pd__field select,
.pd__field textarea {
  font-size: 13px;
  font-weight: 400;
  padding: 7px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.pd__field input:focus,
.pd__field select:focus,
.pd__field textarea:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.pd__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--color-ink);
}
.pd__flags label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pd__err {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--color-danger-500);
}
.pd__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
</style>
