<template>
  <div class="admin-page">

    <div class="header">
      <button class="back-btn" @click="$router.push('/protocols')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        Protocols
      </button>
      <h1 class="page-title">Admin</h1>
      <p class="page-subtitle">Manage protocol content</p>
    </div>

    <div class="content">
      <div class="field">
        <label class="field-label">SELECT PROTOCOL</label>
        <select v-model="selectedProtocolId" class="field-select" @change="loadProtocol">
          <option value="">— Choose a protocol —</option>
          <option v-for="p in protocols" :key="p.id" :value="p.id">
            {{ p.number }} — {{ p.name }}
          </option>
        </select>
      </div>

      <div v-if="selectedProtocol" class="protocol-editor">

        <div class="section">
  <div class="section-title">CRITERIA</div>
  <div class="field">
    <label class="field-label">ADULT</label>
    <textarea v-model="form.criteria_adult" class="field-textarea" rows="2" placeholder="Adult criteria..."></textarea>
  </div>
  <div class="field">
    <label class="field-label">PEDIATRIC</label>
    <textarea v-model="form.criteria_pediatric" class="field-textarea" rows="2" placeholder="Pediatric criteria..."></textarea>
  </div>
  <div class="field">
    <label class="field-label">GENERAL NOTES</label>
    <textarea v-model="form.notes" class="field-textarea" rows="4" placeholder="General notes, context, or additional information... (supports markdown)"></textarea>
  </div>
</div>

        <div v-for="pt in patientTypes" :key="pt.id" class="section">
          <div class="section-title">{{ pt.label }} STEPS</div>

          <div v-for="tier in tiers" :key="tier.id" class="tier-block">
            <div class="tier-label">
              <span class="tier-badge" :class="tier.badgeClass">{{ tier.label }}</span>
            </div>

            <div class="steps-list">
              <div
                v-for="(step, i) in getSteps(pt.id, tier.id)"
                :key="i"
                class="step-row-block"
              >
                <div class="step-row">
                  <span v-if="typeof step === 'object' && step.type === 'warning'" class="step-warn-icon">!</span>
                  <span v-else class="step-num">{{ getStepNumber(getSteps(pt.id, tier.id), i) }}</span>
                  <textarea
  v-if="typeof step === 'object' && step.type === 'warning'"
  :value="step.text"
  @input="updateStepText(pt.id, tier.id, i, $event.target.value)"
  class="step-input warning-input warning-textarea"
  placeholder="Warning text... (use - for bullets, **bold**)"
  rows="3"
></textarea>
<input
  v-else
  :value="typeof step === 'string' ? step : step.text"
  @input="updateStepText(pt.id, tier.id, i, $event.target.value)"
  class="step-input"
  type="text"
  placeholder="Step text..."
/>
                  <button class="step-delete" @click="removeStep(pt.id, tier.id, i)">✕</button>
                </div>

                <div class="substeps-editor" v-if="typeof step === 'object' && step.type !== 'warning'">
                  <div
                    v-for="(sub, si) in (step.substeps || [])"
                    :key="si"
                    class="substep-row"
                  >
                    <input
                      :value="sub.condition"
                      @input="updateSubstep(pt.id, tier.id, i, si, 'condition', $event.target.value)"
                      class="substep-input cond"
                      type="text"
                      placeholder="Condition (e.g. < 70 kg)"
                    />
                    <input
                      :value="sub.text"
                      @input="updateSubstep(pt.id, tier.id, i, si, 'text', $event.target.value)"
                      class="substep-input"
                      type="text"
                      placeholder="Dose or instruction..."
                    />
                    <button class="step-delete" @click="removeSubstep(pt.id, tier.id, i, si)">✕</button>
                  </div>
                  <button class="add-substep-btn" @click="addSubstep(pt.id, tier.id, i)">+ Add condition</button>
                </div>

                <button
                  v-if="typeof step !== 'object' || step.type !== 'warning'"
                  class="toggle-substep-btn"
                  @click="toggleSubsteps(pt.id, tier.id, i)"
                >
                  {{ typeof step === 'object' ? 'Remove branching' : '+ Add branching' }}
                </button>

              </div>
            </div>

            <button class="add-step-btn" @click="addStep(pt.id, tier.id)">+ Add Step</button>
            <button class="add-step-btn warning-add" @click="addWarning(pt.id, tier.id)">+ Add Warning</button>

            <div class="field" style="margin-top: 10px;">
              <label class="field-label">MEDICAL CONTROL</label>
              <div class="steps-list">
                <div
                  v-for="(item, mi) in getMedControl(pt.id, tier.id)"
                  :key="mi"
                  class="step-row"
                >
                  <span class="step-num">{{ mi + 1 }}</span>
                  <input
                    :value="item"
                    @input="updateMedControlItem(pt.id, tier.id, mi, $event.target.value)"
                    class="step-input"
                    type="text"
                    placeholder="Medical control option..."
                  />
                  <button class="step-delete" @click="removeMedControlItem(pt.id, tier.id, mi)">✕</button>
                </div>
              </div>
              <button class="add-step-btn" @click="addMedControlItem(pt.id, tier.id)">+ Add med control item</button>
            </div>
          </div>
        </div>

        <button class="save-btn" @click="save" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save Protocol' }}
        </button>

        <div v-if="saveMessage" class="save-message" :class="saveMessageType">
          {{ saveMessage }}
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '@/lib/supabaseProtocols'

const protocols = ref([])
const selectedProtocolId = ref('')
const selectedProtocol = ref(null)
const saving = ref(false)
const saveMessage = ref('')
const saveMessageType = ref('success')

const patientTypes = [
  { id: 'adult', label: 'ADULT' },
  { id: 'pediatric', label: 'PEDIATRIC' },
]

const tiers = [
  { id: 'emt', label: 'ECA / EMT', badgeClass: 'badge-emt' },
  { id: 'aemt', label: 'AEMT', badgeClass: 'badge-aemt' },
  { id: 'paramedic', label: 'Paramedic', badgeClass: 'badge-para' },
]

const form = ref({
  criteria_adult: '',
  criteria_pediatric: '',
  notes: '',
  steps: {}
})

function stepKey(patientType, tier) {
  return `${patientType}_${tier}`
}

function getSteps(patientType, tier) {
  return form.value.steps[stepKey(patientType, tier)]?.steps || []
}

function getStepNumber(steps, index) {
  let count = 0
  for (let i = 0; i <= index; i++) {
    const s = steps[i]
    if (typeof s === 'string' || s.type !== 'warning') count++
  }
  return count
}

function getMedControl(patientType, tier) {
  const key = stepKey(patientType, tier)
  const mc = form.value.steps[key]?.medical_control
  if (!mc) return []
  if (Array.isArray(mc)) return mc
  if (typeof mc === 'string' && mc.trim() !== '') return [mc]
  return []
}

function updateStepText(patientType, tier, index, value) {
  const key = stepKey(patientType, tier)
  const step = form.value.steps[key].steps[index]
  if (typeof step === 'string') {
    form.value.steps[key].steps[index] = value
  } else {
    form.value.steps[key].steps[index] = { ...step, text: value }
  }
}

function toggleSubsteps(patientType, tier, index) {
  const key = stepKey(patientType, tier)
  const step = form.value.steps[key].steps[index]
  if (typeof step === 'string') {
    form.value.steps[key].steps[index] = { text: step, substeps: [] }
  } else {
    form.value.steps[key].steps[index] = step.text
  }
}

function addStep(patientType, tier) {
  const key = stepKey(patientType, tier)
  if (!form.value.steps[key]) form.value.steps[key] = { steps: [], medical_control: [] }
  form.value.steps[key].steps.push('')
}

function addWarning(patientType, tier) {
  const key = stepKey(patientType, tier)
  if (!form.value.steps[key]) form.value.steps[key] = { steps: [], medical_control: [] }
  form.value.steps[key].steps.push({ type: 'warning', text: '' })
}

function removeStep(patientType, tier, index) {
  const key = stepKey(patientType, tier)
  form.value.steps[key].steps.splice(index, 1)
}

function addSubstep(patientType, tier, index) {
  const key = stepKey(patientType, tier)
  const step = form.value.steps[key].steps[index]
  if (typeof step === 'object') {
    if (!step.substeps) step.substeps = []
    step.substeps.push({ condition: '', text: '' })
  }
}

function removeSubstep(patientType, tier, index, subIndex) {
  const key = stepKey(patientType, tier)
  form.value.steps[key].steps[index].substeps.splice(subIndex, 1)
}

function updateSubstep(patientType, tier, index, subIndex, field, value) {
  const key = stepKey(patientType, tier)
  form.value.steps[key].steps[index].substeps[subIndex][field] = value
}

function addMedControlItem(patientType, tier) {
  const key = stepKey(patientType, tier)
  if (!form.value.steps[key]) form.value.steps[key] = { steps: [], medical_control: [] }
  const mc = form.value.steps[key].medical_control
  if (Array.isArray(mc)) {
    mc.push('')
  } else {
    form.value.steps[key].medical_control = mc ? [mc, ''] : ['']
  }
}

function removeMedControlItem(patientType, tier, index) {
  const key = stepKey(patientType, tier)
  form.value.steps[key].medical_control.splice(index, 1)
}

function updateMedControlItem(patientType, tier, index, value) {
  const key = stepKey(patientType, tier)
  if (!Array.isArray(form.value.steps[key].medical_control)) {
    form.value.steps[key].medical_control = [value]
  } else {
    form.value.steps[key].medical_control[index] = value
  }
}

onMounted(async () => {
  const { data } = await supabase
    .from('protocols')
    .select('id, number, name')
    .order('number')
  if (data) protocols.value = data
})

async function loadProtocol() {
  if (!selectedProtocolId.value) return
  selectedProtocol.value = null
  form.value = { criteria_adult: '', criteria_pediatric: '', steps: {} }

  const { data: pData } = await supabase
    .from('protocols')
    .select('*')
    .eq('id', selectedProtocolId.value)
    .single()

  if (pData) {
    selectedProtocol.value = pData
    form.value.criteria_adult = pData.criteria_adult || ''
form.value.criteria_pediatric = pData.criteria_pediatric || ''
form.value.notes = pData.notes || ''
  }

  const { data: sData } = await supabase
    .from('protocol_steps')
    .select('*')
    .eq('protocol_id', selectedProtocolId.value)

  if (sData) {
    sData.forEach(s => {
      const key = stepKey(s.patient_type, s.tier)
      form.value.steps[key] = {
        steps: s.steps || [],
        medical_control: s.medical_control || []
      }
    })
  }
}

async function save() {
  saving.value = true
  saveMessage.value = ''

  await supabase
  .from('protocols')
  .update({
    criteria_adult: form.value.criteria_adult,
    criteria_pediatric: form.value.criteria_pediatric,
    notes: form.value.notes
  })
  .eq('id', selectedProtocolId.value)

  for (const pt of patientTypes) {
    for (const tier of tiers) {
      const key = stepKey(pt.id, tier.id)
      const data = form.value.steps[key] || { steps: [], medical_control: [] }

      const { error } = await supabase
        .from('protocol_steps')
        .upsert({
          protocol_id: selectedProtocolId.value,
          patient_type: pt.id,
          tier: tier.id,
          steps: data.steps.filter(s => typeof s === 'string' ? s.trim() !== '' : true),
          medical_control: data.medical_control
        }, {
          onConflict: 'protocol_id,patient_type,tier'
        })

      if (error) console.log('upsert error:', error)
    }
  }

  saving.value = false
  saveMessage.value = 'Protocol saved successfully!'
  saveMessageType.value = 'success'
  setTimeout(() => saveMessage.value = '', 3000)
}
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: var(--navy);
}

.header {
  background: var(--navy-mid);
  padding: 52px 20px 20px;
  border-bottom: 1px solid var(--border);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  color: var(--gold);
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  padding: 0;
}

.back-btn svg {
  width: 16px;
  height: 16px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--white);
  margin-bottom: 4px;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-muted);
}

.content {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
}

.field-select, .field-input {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 14px;
  color: var(--white);
  outline: none;
  font-family: 'Inter', sans-serif;
  width: 100%;
}

.field-textarea {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  font-size: 14px;
  color: var(--white);
  outline: none;
  font-family: 'Inter', sans-serif;
  width: 100%;
  resize: vertical;
}

.field-select:focus, .field-input:focus, .field-textarea:focus {
  border-color: var(--gold);
}

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
}

.tier-block {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tier-label {
  margin-bottom: 4px;
}

.tier-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 4px;
}

.badge-emt { background: rgba(99,153,34,0.2); color: #97c459; }
.badge-aemt { background: rgba(55,138,221,0.2); color: #85b7eb; }
.badge-para { background: rgba(186,117,23,0.2); color: #fac775; }

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-row-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.step-row-block:last-child {
  border-bottom: none;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-num {
  min-width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--navy-light);
  color: var(--gold);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-warn-icon {
  min-width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(220, 50, 50, 0.2);
  color: #ff6b6b;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-input {
  flex: 1;
  background: var(--navy-light);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--white);
  outline: none;
  font-family: 'Inter', sans-serif;
}

.step-input:focus {
  border-color: var(--gold);
}

.warning-input {
  border-color: rgba(220, 50, 50, 0.3);
  color: #ff8080;
}

.step-delete {
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 6px;
  flex-shrink: 0;
}

.step-delete:hover {
  color: #ff6b6b;
}

.substeps-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 30px;
  border-left: 2px solid rgba(201,168,76,0.3);
  margin-left: 10px;
}

.substep-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.substep-input {
  flex: 1;
  background: var(--navy);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--white);
  outline: none;
  font-family: 'Inter', sans-serif;
}

.substep-input.cond {
  max-width: 120px;
  color: var(--gold);
}

.substep-input:focus {
  border-color: var(--gold);
}

.add-substep-btn {
  background: none;
  border: 1px dashed rgba(201,168,76,0.3);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--gold-dim);
  align-self: flex-start;
  transition: border-color 0.15s, color 0.15s;
}

.add-substep-btn:hover {
  border-color: var(--gold);
  color: var(--gold);
}

.toggle-substep-btn {
  background: none;
  border: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 0 0 0 30px;
  text-align: left;
  transition: color 0.15s;
}

.toggle-substep-btn:hover {
  color: var(--gold);
}

.add-step-btn {
  background: none;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  width: 100%;
  transition: border-color 0.15s, color 0.15s;
}

.add-step-btn:hover {
  border-color: var(--gold);
  color: var(--gold);
}

.warning-add {
  border-color: rgba(220, 50, 50, 0.3);
  color: rgba(255, 100, 100, 0.6);
}

.warning-add:hover {
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.save-btn {
  background: var(--gold);
  color: var(--navy);
  border-radius: var(--radius);
  padding: 16px;
  font-size: 15px;
  font-weight: 700;
  width: 100%;
  transition: opacity 0.15s;
}

.save-btn:disabled {
  opacity: 0.6;
}

.save-message {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  padding: 10px;
  border-radius: var(--radius-sm);
}

.save-message.success {
  background: rgba(99,153,34,0.15);
  color: #97c459;
}

.save-message.error {
  background: rgba(255,107,107,0.15);
  color: #ff6b6b;
}
.warning-textarea {
  resize: vertical;
  font-family: 'Inter', sans-serif;
  line-height: 1.5;
  min-height: 70px;
}
</style>