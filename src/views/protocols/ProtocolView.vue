<template>
  <div class="protocol-page">

    <div class="header">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        {{ isProcedure ? 'Procedures' : 'Protocols' }}
      </button>
      <div class="protocol-meta">
        <span class="protocol-number">{{ protocol.number }}</span>
        <span class="category-tag">{{ protocol.category }}</span>
      </div>
      <h1 class="protocol-title">{{ protocol.name }}</h1>

      <div v-if="!isProcedure" class="pt-toggle">
        <button class="pt-btn" :class="{ active: patientType === 'adult' }" @click="patientType = 'adult'">Adult</button>
        <button class="pt-btn" :class="{ active: patientType === 'pediatric' }" @click="patientType = 'pediatric'">Pediatric</button>
      </div>
    </div>

    <div v-if="!isProcedure" class="tier-tabs">
      <button
        v-for="tier in tiers"
        :key="tier.id"
        class="tier-tab"
        :class="{ active: activeTier === tier.id }"
        @click="activeTier = tier.id"
      >{{ tier.label }}</button>
    </div>

    <!-- Procedure content -->
    <div v-if="isProcedure" class="content" @click.capture="handleContentClick">
      <div v-if="protocol.notes" class="notes-box">
        <div class="notes-label">NOTES</div>
        <div class="notes-text" v-html="renderCriteria(protocol.notes)"></div>
      </div>

      <div class="procedure-content">
        <div class="procedure-body" v-html="renderMarkdown(protocol.content)"></div>
      </div>

      <button v-if="protocol.number === '1.06'" class="ref-btn" @click="openCapnographyPDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        View Capnography Waveform Chart
      </button>

      <button v-if="protocol.number === '1.12'" class="ref-btn" @click="openDNRPDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        View OOH-DNR Order Form
      </button>

      <button v-if="protocol.number === '1.24'" class="ref-btn" @click="openIntubationPDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        View Full Procedure with Reference Figures
      </button>

      <button v-if="protocol.number === '1.31'" class="ref-btn" @click="openMCIPDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        View START Adult Triage Flowchart
      </button>
    </div>

    <!-- Protocol content -->
    <div v-else class="content" @click.capture="handleContentClick">

      <div class="criteria-box">
        <div class="criteria-label">CRITERIA</div>
        <div class="criteria-text" v-html="renderCriteria(activeContent.criteria)"></div>
      </div>

      <div v-if="protocol.notes" class="notes-box">
        <div class="notes-label">NOTES</div>
        <div class="notes-text" v-html="renderCriteria(protocol.notes)"></div>
      </div>

      <!-- EMT section (shown on AEMT and Paramedic tabs) -->
      <div v-if="activeTier === 'aemt' || activeTier === 'paramedic'" class="section">
        <div class="sec-hdr" @click="emtOpen = !emtOpen">
          <span class="tier-badge badge-emt">ECA / EMT</span>
          <svg class="chevron" :class="{ open: emtOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
        <div v-if="emtOpen">
          <template v-for="(step, i) in getSteps('emt')" :key="'emt-'+i">
            <div v-if="typeof step === 'object' && step.type === 'warning'" class="warning-block">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="warning-icon">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span class="warning-block-text" v-html="renderMarkdown(step.text)"></span>
            </div>
            <div v-else class="step">
              <span class="step-num">{{ getStepNumber(getSteps('emt'), i) }}</span>
              <div class="step-body">
                <span class="step-text" v-html="renderStep(typeof step === 'string' ? step : step.text)"></span>
                <div v-if="step.substeps && step.substeps.length" class="substeps">
                  <div v-for="(sub, si) in step.substeps" :key="si" class="substep">
                    <div class="substep-cond">{{ sub.condition }}</div>
                    <div class="substep-text" v-html="renderStep(sub.text)"></div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- AEMT section (shown on Paramedic tab) -->
      <div v-if="activeTier === 'paramedic'" class="section">
        <div class="sec-hdr" @click="aemtOpen = !aemtOpen">
          <span class="tier-badge badge-aemt">AEMT</span>
          <svg class="chevron" :class="{ open: aemtOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
        <div v-if="aemtOpen">
          <template v-for="(step, i) in getSteps('aemt')" :key="'aemt-'+i">
            <div v-if="typeof step === 'object' && step.type === 'warning'" class="warning-block">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="warning-icon">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span class="warning-block-text" v-html="renderMarkdown(step.text)"></span>
            </div>
            <div v-else class="step">
              <span class="step-num">{{ getStepNumber(getSteps('aemt'), i) }}</span>
              <div class="step-body">
                <span class="step-text" v-html="renderStep(typeof step === 'string' ? step : step.text)"></span>
                <div v-if="step.substeps && step.substeps.length" class="substeps">
                  <div v-for="(sub, si) in step.substeps" :key="si" class="substep">
                    <div class="substep-cond">{{ sub.condition }}</div>
                    <div class="substep-text" v-html="renderStep(sub.text)"></div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Active tier steps -->
      <div class="section">
        <div class="sec-hdr">
          <span class="tier-badge" :class="activeBadgeClass">{{ activeTierLabel }}</span>
        </div>
        <template v-for="(step, i) in getSteps(activeTier)" :key="'active-'+i">
          <div v-if="typeof step === 'object' && step.type === 'warning'" class="warning-block">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="warning-icon">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span class="warning-block-text" v-html="renderMarkdown(step.text)"></span>
          </div>
          <div v-else class="step">
            <span class="step-num">{{ getStepNumber(getSteps(activeTier), i) }}</span>
            <div class="step-body">
              <span class="step-text" v-html="renderStep(typeof step === 'string' ? step : step.text)"></span>
              <div v-if="step.substeps && step.substeps.length" class="substeps">
                <div v-for="(sub, si) in step.substeps" :key="si" class="substep">
                  <div class="substep-cond">{{ sub.condition }}</div>
                  <div class="substep-text" v-html="renderStep(sub.text)"></div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Medical Control -->
      <div v-if="getMedicalControl(activeTier)?.length" class="mc-box">
        <div class="mc-label">MED CONTROL</div>
        <div class="mc-items">
          <div v-for="(item, i) in getMedicalControl(activeTier)" :key="i" class="mc-item">
            <span class="mc-dot"></span>
            <span class="mc-text">{{ item }}</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import ReferenceSheet from '@/components/protocols/ReferenceSheet.vue'
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabaseProtocols'
import BurnCalculator from '@/components/protocols/BurnCalculator.vue'
import STEMIReference from '@/components/protocols/STEMIReference.vue'
import { marked } from 'marked'
import StrokeAssessment from '@/components/protocols/StrokeAssessment.vue'
import ContractionTracker from '@/components/protocols/ContractionTracker.vue'
import DeliveryDoc from '@/components/protocols/DeliveryDoc.vue'
import NewbornAPGAR from '@/components/protocols/NewbornAPGAR.vue'

const route = useRoute()
const router = useRouter()
const patientType = ref('adult')
const activeTier = ref('emt')
const emtOpen = ref(true)
const aemtOpen = ref(true)
const loading = ref(true)
const protocol = ref({ number: '', name: '', category: '', criteria_adult: '', criteria_pediatric: '' })
const steps = ref([])
const activeSheet = ref(null)
const protocolMap = ref({})

const searchQuery = computed(() => route.query.q || '')

const tiers = [
  { id: 'emt', label: 'ECA / EMT' },
  { id: 'aemt', label: 'AEMT' },
  { id: 'paramedic', label: 'Paramedic' },
]

const drugNames = [
  'Calcium Chloride',
  'Dextrose 10%',
  'Dextrose 50%',
  'Dextrose 5%',
  'Dextrose 5% Water',
  'Epinephrine 1:1,000',
  'Epinephrine 1:10,000',
  'Epinephrine 1:100,000',
  'Epinephrine Racemic',
  'Lactated Ringers',
  'Magnesium Sulfate',
  'Normal Saline',
  'Nitro Bid 2%',
  'Nitro Tabs',
  'Oral Glucose',
  'Racemic Epinephrine',
  'Sodium Bicarbonate',
  'Tranexamic Acid',
  'Lidocaine Drip',
  'Acetaminophen',
  'Adenosine',
  'Albuterol',
  'Amiodarone',
  'Aspirin',
  'Atropine',
  'Atrovent',
  'Dexamethasone',
  'Diltiazem',
  'Diphenhydramine',
  'Dopamine',
  'Droperidol',
  'DuoNeb',
  'Norepinephrine',
  'Epinephrine',
  'Etomidate',
  'Fentanyl',
  'Ketamine',
  'Ketorolac',
  'Labetalol',
  'Lidocaine',
  'Lorazepam',
  'Midazolam',
  'Morphine',
  'Naloxone',
  'Nicardipine',
  'Nitroglycerin',
  'Ondansetron',
  'Rocuronium',
  'TXA',
  'Zofran',
]

function highlightDrugs(text) {
  if (!text) return ''
  let result = text

  drugNames.forEach(drug => {
    const escaped = drug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`(${escaped})`, 'gi'), '<em>$1</em>')
  })

  result = result.replace(
    /\b(IVF\s+bolus(?:es)?(?:\s+at)?\s+[\d.]+\s*(?:ml\/kg|mL\/kg|ml|mL|cc|L))/gi,
    '<em>$1</em>'
  )

  result = result.replace(
    /\b(bolus\s+[\d.]+\s*(?:ml\/kg|mL\/kg|ml|mL|cc|L))/gi,
    '<em>$1</em>'
  )

  result = result.replace(
    /\b([\d.]+\s*(?:ml\/kg|mL\/kg|ml|mL|cc|L)\s+bolus)/gi,
    '<em>$1</em>'
  )

  result = result.replace(
    /\b(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\s*(?:mcg|mg|ml|mL|g|units?|mEq|joules?|J)(?:\/(?:kg))?(?:\/(?:hr|hour|min|minute|minutes|hours))?)\b/gi,
    '<em>$1</em>'
  )

  return result
}

function getStepNumber(steps, index) {
  let count = 0
  for (let i = 0; i <= index; i++) {
    const s = steps[i]
    if (typeof s === 'string' || s.type !== 'warning') count++
  }
  return count
}

async function loadProtocol(id) {
  loading.value = true

  const { data: protocolData, error: protocolError } = await supabase
    .from('protocols')
    .select('*')
    .eq('id', id)
    .single()

  if (protocolError || !protocolData) {
    const cached = localStorage.getItem(`wcems_protocol_${id}`)
    if (cached) protocol.value = JSON.parse(cached)
  } else {
    protocol.value = protocolData
    localStorage.setItem(`wcems_protocol_${id}`, JSON.stringify(protocolData))
  }

  const { data: mapData, error: mapError } = await supabase
    .from('protocols')
    .select('id, number')

  if (mapError || !mapData) {
    const cached = localStorage.getItem('wcems_protocol_map')
    if (cached) {
      const arr = JSON.parse(cached)
      arr.forEach(p => { protocolMap.value[p.number] = p.id })
    }
  } else {
    protocolMap.value = {}
    mapData.forEach(p => { protocolMap.value[p.number] = p.id })
    localStorage.setItem('wcems_protocol_map', JSON.stringify(mapData))
  }

  const { data: stepsData, error: stepsError } = await supabase
    .from('protocol_steps')
    .select('*')
    .eq('protocol_id', id)

  if (stepsError || !stepsData) {
    const cached = localStorage.getItem(`wcems_steps_${id}`)
    if (cached) steps.value = JSON.parse(cached)
  } else {
    steps.value = stepsData
    localStorage.setItem(`wcems_steps_${id}`, JSON.stringify(stepsData))
  }

  loading.value = false

  if (searchQuery.value) {
    await nextTick()

    const q = searchQuery.value.toLowerCase()

    if (!protocol.value.criteria_adult?.toLowerCase().includes(q) &&
        protocol.value.criteria_pediatric?.toLowerCase().includes(q)) {
      patientType.value = 'pediatric'
    }

    const tierOrder = ['emt', 'aemt', 'paramedic']
    for (const tier of tierOrder) {
      const tierSteps = steps.value.find(
        s => s.patient_type === patientType.value && s.tier === tier
      )
      if (tierSteps && JSON.stringify(tierSteps.steps).toLowerCase().includes(q)) {
        activeTier.value = tier
        if (tier === 'aemt' || tier === 'paramedic') emtOpen.value = true
        if (tier === 'paramedic') aemtOpen.value = true
        break
      }
    }

    await nextTick()
    const highlight = document.querySelector('mark')
    if (highlight) {
      highlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}

onMounted(() => loadProtocol(route.params.id))

watch(() => route.params.id, (newId) => {
  if (newId) loadProtocol(newId)
})

const isProcedure = computed(() => protocol.value?.number?.startsWith('1.'))

const activeContent = computed(() => {
  const criteria = patientType.value === 'adult'
    ? protocol.value.criteria_adult
    : protocol.value.criteria_pediatric
  return { criteria }
})

function getSteps(tier) {
  const match = steps.value.find(
    s => s.patient_type === patientType.value && s.tier === tier
  )
  return match ? match.steps : []
}

function getMedicalControl(tier) {
  const match = steps.value.find(
    s => s.patient_type === patientType.value && s.tier === tier
  )
  if (!match?.medical_control) return []
  if (Array.isArray(match.medical_control)) return match.medical_control
  if (typeof match.medical_control === 'string' && match.medical_control.trim() !== '') return [match.medical_control]
  return []
}

const activeTierLabel = computed(() => {
  return tiers.find(t => t.id === activeTier.value)?.label
})

const activeBadgeClass = computed(() => ({
  'badge-emt': activeTier.value === 'emt',
  'badge-aemt': activeTier.value === 'aemt',
  'badge-para': activeTier.value === 'paramedic',
}))

function highlightSearch(text) {
  if (!searchQuery.value || !text) return text
  const regex = new RegExp(`(${searchQuery.value})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

function renderMarkdown(text) {
  if (!text) return ''
  marked.setOptions({ breaks: true })
  return highlightSearch(linkifyProtocols(marked.parse(highlightDrugs(text))))
}

function renderCriteria(text) {
  if (!text) return ''
  return highlightSearch(linkifyProtocols(marked.parse(text)))
}

function renderStep(text) {
  if (!text) return ''
  return highlightSearch(linkifyProtocols(highlightDrugs(text)))
}

function linkifyProtocols(text) {
  if (!text) return text
  return text.replace(/\b([12]\.\d{1,2})\b/g, (match, num) => {
    const linkedId = protocolMap.value[num]
    if (!linkedId) return match
    return `<a class="protocol-link" data-id="${linkedId}">${match}</a>`
  })
}

function handleContentClick(e) {
  const link = e.target.closest('.protocol-link')
  if (!link) return
  e.preventDefault()
  const id = link.dataset.id
  if (id) router.push(`/protocols/protocol/${id}`)
}

function goBack() {
  const tab = isProcedure.value ? 'procedures' : 'protocols'
  router.push({ path: '/protocols', query: { tab } })
}

function openCapnographyPDF() {
  window.open('/Capnography-image.pdf', '_blank')
}

function openDNRPDF() {
  window.open('/OOH-DNR.pdf', '_blank')
}

function openIntubationPDF() {
  window.open('/1.24-Intubation.pdf', '_blank')
}

function openMCIPDF() {
  window.open('/1.31-MCI.pdf', '_blank')
}
</script>

<style scoped>
.protocol-page {
  min-height: 100vh;
  background: var(--navy);
}

.header {
  background: var(--navy-mid);
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
  padding-bottom: 16px;
  padding-left: 20px;
  padding-right: 20px;
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

.protocol-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.protocol-number {
  font-size: 13px;
  font-weight: 700;
  color: var(--gold);
}

.category-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  background: var(--navy-light);
  padding: 3px 8px;
  border-radius: 20px;
}

.protocol-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--white);
  line-height: 1.2;
  margin-bottom: 14px;
}

.pt-toggle {
  display: flex;
  background: var(--navy);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}

.pt-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  background: none;
  color: var(--text-muted);
  transition: all 0.15s;
}

.pt-btn.active {
  background: var(--gold);
  color: var(--navy);
}

.tier-tabs {
  display: flex;
  background: var(--navy-mid);
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
}

.tier-tab {
  flex: 1;
  padding: 12px 0;
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.tier-tab.active {
  color: var(--gold);
  border-bottom-color: var(--gold);
}

.content {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.criteria-box {
  background: rgba(201, 168, 76, 0.08);
  border: 1px solid rgba(201, 168, 76, 0.25);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
}

.criteria-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--gold);
  margin-bottom: 4px;
}

.criteria-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.sec-hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--navy-light);
  cursor: pointer;
  justify-content: space-between;
}

.tier-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 7px;
  border-radius: 4px;
}

.badge-emt { background: rgba(99,153,34,0.2); color: #97c459; }
.badge-aemt { background: rgba(55,138,221,0.2); color: #85b7eb; }
.badge-para { background: rgba(186,117,23,0.2); color: #fac775; }

.chevron {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.chevron.open {
  transform: rotate(0deg);
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.step:last-child { border-bottom: none; }

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
  margin-top: 1px;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.step-text {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}

.step-text :deep(em) {
  color: var(--gold-light);
  font-style: normal;
  font-weight: 500;
}

.substeps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 2px;
  border-left: 2px solid rgba(201, 168, 76, 0.3);
  margin-left: 2px;
}

.substep {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.substep-cond {
  font-size: 10px;
  font-weight: 700;
  color: var(--gold);
  margin-top: 0;
  letter-spacing: 0.04em;
  min-width: 80px;
  max-width: 130px;
  line-height: 1.3;
  flex-shrink: 0;
  align-self: flex-start;
}

.substep-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  padding-top: 1px;
  flex: 1;
  align-self: flex-start;
}

.substep-text :deep(em) {
  color: var(--gold-light);
  font-style: normal;
  font-weight: 500;
}

.warning-block {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(220, 50, 50, 0.08);
  border-left: 3px solid rgba(220, 50, 50, 0.5);
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.warning-block:last-child {
  border-bottom: none;
}

.warning-icon {
  width: 16px;
  height: 16px;
  color: #ff6b6b;
  flex-shrink: 0;
  margin-top: 1px;
}

.warning-block-text {
  font-size: 13px;
  color: #ff8080;
  font-weight: 600;
  line-height: 1.45;
}

.mc-box {
  background: rgba(201,168,76,0.06);
  border: 1px solid rgba(201,168,76,0.2);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.mc-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--gold);
  white-space: nowrap;
  margin-top: 2px;
}

.mc-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mc-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.mc-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--gold);
  flex-shrink: 0;
  margin-top: 5px;
}

.mc-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.ref-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.ref-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--gold);
  border-bottom: 1px solid var(--border);
}

.ref-table td {
  padding: 10px 12px;
  color: var(--text-primary);
  border-bottom: 1px solid rgba(255,255,255,0.04);
  vertical-align: top;
}

.ref-table td:first-child {
  font-weight: 700;
  color: var(--gold);
  white-space: nowrap;
  width: 60px;
}

.ref-table tr:last-child td {
  border-bottom: none;
}
.ref-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--gold);
  width: 100%;
  transition: border-color 0.15s;
}

.ref-btn:hover {
  border-color: var(--gold);
}
.criteria-text :deep(p) {
  margin-bottom: 6px;
}

.criteria-text :deep(p:last-child) {
  margin-bottom: 0;
}

.criteria-text :deep(ul) {
  padding-left: 16px;
  margin: 4px 0;
}

.criteria-text :deep(li) {
  margin-bottom: 4px;
}

.criteria-text :deep(strong) {
  color: var(--white);
  font-weight: 600;
}
.ref-intro {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: rgba(201,168,76,0.06);
  border-left: 2px solid rgba(201,168,76,0.3);
  border-radius: 0;
}

.ref-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--gold);
  margin: 16px 0 8px;
}

.sludge-letter {
  font-weight: 700;
  color: var(--gold);
  font-size: 16px;
  width: 30px;
}
.ref-dose-block {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ref-dose-age {
  font-size: 13px;
  font-weight: 700;
  color: var(--gold);
  margin-bottom: 4px;
}

.ref-dose-row {
  font-size: 13px;
  color: var(--white);
  display: flex;
  gap: 6px;
}

.ref-dose-label {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 40px;
}

.ref-dose-note {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 6px;
}
.notes-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}

.notes-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.notes-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.notes-text :deep(p) { margin-bottom: 8px; }
.notes-text :deep(p:last-child) { margin-bottom: 0; }
.notes-text :deep(ul) { padding-left: 16px; margin: 4px 0; }
.notes-text :deep(li) { margin-bottom: 4px; }
.notes-text :deep(strong) { color: var(--white); font-weight: 600; }
.ht-grid {
  display: flex;
  gap: 0;
}

.ht-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ht-header {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--gold);
  padding: 8px 14px;
  background: var(--navy-light);
  border-bottom: 1px solid var(--border);
}

.ht-item {
  font-size: 13px;
  color: var(--white);
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.ht-item:last-child {
  border-bottom: none;
}

.ht-divider {
  width: 1px;
  background: var(--border);
}

/* ── Procedure Content ─────────────────────────── */
.procedure-content {
  padding: 0 16px 32px;
}

.procedure-body {
  color: rgba(255, 255, 255, 0.92);
  font-size: 15px;
  line-height: 1.7;
}

.procedure-body :deep(p) {
  margin: 0 0 14px;
}
.procedure-body :deep(p:last-child) {
  margin-bottom: 0;
}
.procedure-body :deep(h1) {
  font-size: 18px;
  font-weight: 700;
  color: var(--gold);
  margin: 24px 0 10px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.procedure-body :deep(h2) {
  font-size: 16px;
  font-weight: 700;
  color: var(--gold);
  margin: 20px 0 8px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.procedure-body :deep(h3) {
  font-size: 15px;
  font-weight: 600;
  color: var(--gold-light);
  margin: 16px 0 6px;
}
.procedure-body :deep(ul) {
  margin: 0 0 14px 0;
  padding-left: 20px;
  list-style: none;
}
.procedure-body :deep(ul li) {
  position: relative;
  padding-left: 14px;
  margin-bottom: 6px;
}
.procedure-body :deep(ul li::before) {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--gold);
  font-weight: 700;
}
.procedure-body :deep(ol) {
  margin: 0 0 14px 0;
  padding-left: 20px;
  list-style: none;
  counter-reset: ol-counter;
}
.procedure-body :deep(ol li) {
  position: relative;
  padding-left: 28px;
  margin-bottom: 8px;
  counter-increment: ol-counter;
}
.procedure-body :deep(ol li::before) {
  content: counter(ol-counter) '.';
  position: absolute;
  left: 0;
  color: var(--gold);
  font-weight: 600;
  min-width: 24px;
}
.procedure-body :deep(ul ul),
.procedure-body :deep(ol ol),
.procedure-body :deep(ol ul),
.procedure-body :deep(ul ol) {
  margin: 6px 0 6px 0;
}
.procedure-body :deep(ul ul li::before) {
  content: '–';
  color: var(--gold-light);
}
.procedure-body :deep(strong) {
  color: var(--gold-light);
  font-weight: 600;
}
.procedure-body :deep(em) {
  color: rgba(255, 255, 255, 0.75);
  font-style: italic;
}
.procedure-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(201, 168, 76, 0.25);
  margin: 20px 0;
}
.procedure-body :deep(blockquote) {
  margin: 12px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--gold);
  background: rgba(201, 168, 76, 0.08);
  border-radius: 0 6px 6px 0;
  color: rgba(255, 255, 255, 0.85);
  font-style: italic;
}
.procedure-body :deep(blockquote p) {
  margin: 0;
}
.procedure-body :deep(code) {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  background: rgba(201, 168, 76, 0.12);
  color: var(--gold-light);
  padding: 1px 5px;
  border-radius: 3px;
}
.procedure-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 20px;
  font-size: 14px;
}
.procedure-body :deep(th) {
  background: var(--navy-mid);
  color: var(--gold);
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--gold);
}
.procedure-body :deep(td) {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
  vertical-align: top;
}
.procedure-body :deep(tr:last-child td) {
  border-bottom: none;
}
.procedure-body :deep(tr:nth-child(even) td) {
  background: rgba(255, 255, 255, 0.03);
}
.protocol-link {
  color: var(--gold);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: rgba(201, 168, 76, 0.4);
  cursor: pointer;
}

:deep(.protocol-link) {
  color: var(--gold);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: rgba(201, 168, 76, 0.4);
  cursor: pointer;
}

:deep(mark) {
  background: rgba(201, 168, 76, 0.3);
  color: var(--gold-light);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 600;
}
</style>