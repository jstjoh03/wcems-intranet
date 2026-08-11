<template>
  <div class="stemi-ref">

    <!-- Tabs -->
    <div class="tabs">
      <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab 1: Heart Diagram -->
    <div v-if="activeTab === 'heart'" class="tab-content">
      <div class="heart-wrap">
        <img src="/Heart.svg" class="heart-img" alt="Anatomical heart diagram" />
        <div class="wall-label inferior">INFERIOR<br><span>II, III, aVF</span></div>
        <div class="wall-label lateral-left">LATERAL<br><span>I, aVL, V5, V6</span></div>
        <div class="wall-label anterior">ANTERIOR<br><span>V3, V4</span></div>
        <div class="wall-label septal">SEPTAL<br><span>V1, V2</span></div>
      </div>
      <div class="legend">
        <div class="leg-item" v-for="wall in walls" :key="wall.name">
          <div class="leg-dot" :style="{ background: wall.color }"></div>
          <div>
            <div class="leg-name">{{ wall.name }}</div>
            <div class="leg-leads">{{ wall.leads }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 12-Lead Grid -->
<div v-if="activeTab === 'grid'" class="tab-content">
  <img src="/12 Lead Ref.svg" class="heart-img" alt="12-Lead reference diagram" />
</div>

    <!-- Tab 3: STEMI Calculator -->
    <div v-if="activeTab === 'stemi'" class="tab-content">

      <!-- Sex + Age inputs -->
      <div class="patient-row">
        <div class="sex-toggle">
          <button class="sex-btn" :class="{ active: sex === 'M' }" @click="sex = 'M'">Male</button>
          <button class="sex-btn" :class="{ active: sex === 'F' }" @click="sex = 'F'">Female</button>
        </div>
        <div class="age-input-wrap">
          <label class="input-label">AGE</label>
          <input v-model.number="age" type="number" min="0" max="120" class="age-input" placeholder="yrs" />
        </div>
      </div>

      <!-- Threshold guide -->
      <div v-if="sex && age" class="threshold-guide">
        <div class="tg-label">THRESHOLDS FOR THIS PATIENT</div>
        <div class="tg-row"><span class="tg-leads">V1–V3</span><span class="tg-val">≥ {{ v1v3Threshold }}mm STE</span></div>
        <div class="tg-row"><span class="tg-leads">All other leads</span><span class="tg-val">≥ 1.0mm STE</span></div>
        <div class="tg-row"><span class="tg-leads">Posterior (V1–V3 STD)</span><span class="tg-val">≥ 0.5mm STD</span></div>
      </div>

      <!-- Result banner -->
      <div class="result-banner" :class="stemiResult.class">
        <div class="result-icon">{{ stemiResult.icon }}</div>
        <div>
          <div class="result-title">{{ stemiResult.title }}</div>
          <div class="result-sub">{{ stemiResult.sub }}</div>
        </div>
      </div>

      <!-- Lead inputs by group -->
      <div v-for="group in leadGroups" :key="group.name" class="lead-group">
        <div class="lead-group-header">
          <div class="lead-group-dot" :style="{ background: group.color }"></div>
          <span class="lead-group-name">{{ group.name }}</span>
          <span v-if="groupMet(group)" class="group-met-badge">CRITERIA MET</span>
        </div>
        <div class="lead-inputs">
          <div v-for="lead in group.leads" :key="lead.name" class="lead-input-row" :class="{ met: leadMet(lead) }">
            <span class="lead-name">{{ lead.name }}</span>
            <div class="lead-input-wrap">
              <input
                v-model="measurements[lead.name]"
                type="number"
                step="0.1"
                min="-10"
                max="10"
                class="lead-input"
                :class="{ met: leadMet(lead), negative: isNegative(lead) }"
                placeholder="0.0"
              />
              <span class="lead-unit">mm</span>
            </div>
            <span class="lead-threshold">≥{{ getThreshold(lead) }}mm</span>
            <div class="lead-status">
              <svg v-if="leadMet(lead)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;color:#97c459;"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Posterior note -->
      <div class="note">For posterior STEMI, enter ST depression values (negative numbers) in V1–V3. ≥0.5mm STD in ≥2 leads = posterior STEMI equivalent.</div>

      <div class="criteria-note">Per 2018 Fourth Universal Definition of MI · 2025 ACC/AHA/ACEP/NAEMSP/SCAI ACS Guidelines</div>

      <button class="clear-btn" @click="clearCalc">Clear All</button>
    </div>

    <!-- Tab 4: Sgarbossa -->
<div v-if="activeTab === 'sgarbossa'" class="tab-content">

  <div class="pt-toggle">
    <button class="pt-btn" :class="{ active: sgarbossaMode === 'original' }" @click="sgarbossaMode = 'original'">Original</button>
    <button class="pt-btn" :class="{ active: sgarbossaMode === 'modified' }" @click="sgarbossaMode = 'modified'">Modified (Smith)</button>
  </div>

  <div class="result-banner" :class="sgarbossaResult.class">
    <div class="result-icon">{{ sgarbossaResult.icon }}</div>
    <div>
      <div class="result-title">{{ sgarbossaResult.title }}</div>
      <div class="result-sub">{{ sgarbossaResult.sub }}</div>
    </div>
  </div>

  <div class="criteria-note" v-if="sgarbossaMode === 'original'">Sgarbossa et al., NEJM 1996 · Score ≥3 = STEMI likely · Use in LBBB or paced rhythm</div>
  <div class="criteria-note" v-else>Smith et al., Ann Emerg Med 2012 · Any criterion = STEMI likely · Use in LBBB or paced rhythm</div>

  <!-- Criterion 1 -->
  <div class="sg-criterion">
    <div class="sg-criterion-header">
      <div class="sg-num" :class="{ met: sgC1Met }">{{ sgarbossaMode === 'original' ? '5 pts' : 'C1' }}</div>
      <div class="sg-criterion-title">ST elevation in a lead where the QRS points UP</div>
    </div>
    <div class="sg-criterion-detail">Enter the amount of ST elevation measured in that lead</div>
    <div class="sg-input-row">
      <input v-model.number="sg.c1" type="number" step="0.1" min="0" class="lead-input" :class="{ met: sgC1Met }" placeholder="0.0" />
      <span class="lead-unit">mm</span>
      <span class="sg-threshold">≥ 1.0mm = positive</span>
      <span v-if="sgC1Met" class="sg-met-badge">MET</span>
    </div>
  </div>

  <!-- Criterion 2 -->
  <div class="sg-criterion">
    <div class="sg-criterion-header">
      <div class="sg-num" :class="{ met: sgC2Met }">{{ sgarbossaMode === 'original' ? '3 pts' : 'C2' }}</div>
      <div class="sg-criterion-title">ST depression in V1, V2, or V3</div>
    </div>
    <div class="sg-criterion-detail">Enter the amount of ST depression (as a positive number)</div>
    <div class="sg-input-row">
      <input v-model.number="sg.c2" type="number" step="0.1" min="0" class="lead-input" :class="{ met: sgC2Met }" placeholder="0.0" />
      <span class="lead-unit">mm</span>
      <span class="sg-threshold">≥ 1.0mm = positive</span>
      <span v-if="sgC2Met" class="sg-met-badge">MET</span>
    </div>
  </div>

  <!-- Criterion 3 Original -->
  <div v-if="sgarbossaMode === 'original'" class="sg-criterion">
    <div class="sg-criterion-header">
      <div class="sg-num" :class="{ met: sgC3OrigMet }">2 pts</div>
      <div class="sg-criterion-title">ST elevation in a lead where the QRS points DOWN</div>
    </div>
    <div class="sg-criterion-detail">Enter how tall the ST rise is in that lead</div>
    <div class="sg-input-row">
      <input v-model.number="sg.c3orig" type="number" step="0.1" min="0" class="lead-input" :class="{ met: sgC3OrigMet }" placeholder="0.0" />
      <span class="lead-unit">mm</span>
      <span class="sg-threshold">≥ 5.0mm = positive</span>
      <span v-if="sgC3OrigMet" class="sg-met-badge">MET</span>
    </div>
  </div>

  <!-- Criterion 3 Modified -->
  <div v-if="sgarbossaMode === 'modified'" class="sg-criterion">
    <div class="sg-criterion-header">
      <div class="sg-num" :class="{ met: sgC3ModMet }">C3</div>
      <div class="sg-criterion-title">ST elevation in a lead where the QRS points DOWN</div>
    </div>
    <div class="sg-criterion-detail">Enter the ST rise AND the depth of the deepest part of the QRS below the baseline (S wave)</div>
    <div class="sg-input-row">
      <div class="sg-ratio-inputs">
        <div class="sg-ratio-field">
          <label class="input-label">ST RISE (mm)</label>
          <input v-model.number="sg.c3ste" type="number" step="0.1" min="0" class="lead-input" :class="{ met: sgC3ModMet }" placeholder="0.0" />
        </div>
        <div class="sg-ratio-divider">÷</div>
        <div class="sg-ratio-field">
          <label class="input-label">S WAVE DEPTH (mm)</label>
          <input v-model.number="sg.c3s" type="number" step="0.1" min="0" class="lead-input" placeholder="0.0" />
        </div>
        <div class="sg-ratio-divider">=</div>
        <div class="sg-ratio-field">
          <label class="input-label">ST/S RATIO</label>
          <div class="sg-ratio-result" :class="{ met: sgC3ModMet }">{{ stSRatio }}</div>
        </div>
      </div>
    </div>
    <div v-if="sgC3ModMet" class="sg-ratio-note">Ratio ≤ −0.25 — criterion MET</div>
    <div v-else-if="stSRatioNum !== null" class="sg-ratio-note neutral">Ratio {{ stSRatio }} — threshold is ≤ −0.25</div>
    <span v-if="sgC3ModMet" class="sg-met-badge" style="align-self:flex-start;">MET</span>
  </div>

  <!-- Score (original only) -->
  <div v-if="sgarbossaMode === 'original'" class="score-total">
    Score: <span :class="originalScore >= 3 ? 'score-positive' : 'score-neutral'">{{ originalScore }} / 10</span>
  </div>

  <button class="clear-btn" @click="clearSgarbossa">Clear All</button>
</div>

  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'

const activeTab = ref('heart')
const sgarbossaMode = ref('original')
const sex = ref('')
const age = ref(null)
const measurements = reactive({})

const tabs = [
  { id: 'heart', label: 'Heart' },
  { id: 'grid', label: '12-Lead' },
  { id: 'stemi', label: 'STEMI' },
  { id: 'sgarbossa', label: 'Sgarbossa' },
]

const walls = [
  { name: 'Inferior', leads: 'II, III, aVF → RCA', color: '#97c459' },
  { name: 'Lateral', leads: 'I, aVL, V5, V6 → Circumflex', color: '#85b7eb' },
  { name: 'Anterior', leads: 'V3, V4 → LAD', color: '#ff8080' },
  { name: 'Septal', leads: 'V1, V2 → LAD', color: '#fac775' },
]

const leadGrid = [
  { name: 'I', wall: 'Lateral', wallClass: 'lat' },
  { name: 'aVR', wall: '—', wallClass: 'avr' },
  { name: 'V1', wall: 'Septal', wallClass: 'sep' },
  { name: 'V4', wall: 'Anterior', wallClass: 'ant' },
  { name: 'II', wall: 'Inferior', wallClass: 'inf' },
  { name: 'aVL', wall: 'Lateral', wallClass: 'lat' },
  { name: 'V2', wall: 'Septal', wallClass: 'sep' },
  { name: 'V5', wall: 'Lateral', wallClass: 'lat' },
  { name: 'III', wall: 'Inferior', wallClass: 'inf' },
  { name: 'aVF', wall: 'Inferior', wallClass: 'inf' },
  { name: 'V3', wall: 'Anterior', wallClass: 'ant' },
  { name: 'V6', wall: 'Lateral', wallClass: 'lat' },
]

const leadGroups = [
  {
    name: 'Inferior',
    color: '#97c459',
    leads: [
      { name: 'II', type: 'limb' },
      { name: 'III', type: 'limb' },
      { name: 'aVF', type: 'limb' },
    ]
  },
  {
    name: 'Lateral',
    color: '#85b7eb',
    leads: [
      { name: 'I', type: 'limb' },
      { name: 'aVL', type: 'limb' },
      { name: 'V5', type: 'precordial' },
      { name: 'V6', type: 'precordial' },
    ]
  },
  {
    name: 'Anterior / Septal',
    color: '#fac775',
    leads: [
      { name: 'V1', type: 'v1v3' },
      { name: 'V2', type: 'v1v3' },
      { name: 'V3', type: 'v1v3' },
      { name: 'V4', type: 'precordial' },
    ]
  },
  {
    name: 'High Lateral',
    color: '#85b7eb',
    leads: [
      { name: 'I', type: 'limb' },
      { name: 'aVL', type: 'limb' },
    ]
  },
]

const v1v3Threshold = computed(() => {
  if (!sex.value || !age.value) return '—'
  if (sex.value === 'F') return 1.5
  if (age.value < 40) return 2.5
  return 2.0
})

function getThreshold(lead) {
  if (lead.type === 'v1v3') return v1v3Threshold.value === '—' ? '?' : v1v3Threshold.value
  if (lead.type === 'posterior') return 0.5
  return 1.0
}

function isNegative(lead) {
  const val = parseFloat(measurements[lead.name])
  return !isNaN(val) && val < 0
}

function leadMet(lead) {
  const val = parseFloat(measurements[lead.name])
  if (isNaN(val)) return false
  if (lead.type === 'posterior') return val <= -0.5
  const threshold = lead.type === 'v1v3' ? (v1v3Threshold.value === '—' ? 999 : v1v3Threshold.value) : 1.0
  return val >= threshold
}

function groupMet(group) {
  const metLeads = group.leads.filter(l => leadMet(l))
  if (metLeads.length < 2) return false
  if (group.name === 'Lateral') {
    const highLat = ['I', 'aVL'].filter(n => metLeads.some(l => l.name === n))
    const lowLat = ['V5', 'V6'].filter(n => metLeads.some(l => l.name === n))
    return highLat.length >= 2 || lowLat.length >= 2
  }
  return metLeads.length >= 2
}

function posteriorMet() {
  const v1 = parseFloat(measurements['V1'])
  const v2 = parseFloat(measurements['V2'])
  const v3 = parseFloat(measurements['V3'])
  const vals = [v1, v2, v3].filter(v => !isNaN(v))
  return vals.filter(v => v <= -0.5).length >= 2
}

const stemiResult = computed(() => {
  if (!sex.value || !age.value) {
    return { title: 'Enter patient sex and age', sub: 'Required to calculate thresholds', icon: '○', class: 'result-neutral' }
  }
  const anyMet = leadGroups.some(g => groupMet(g)) || posteriorMet()
  if (anyMet) {
    const walls = leadGroups.filter(g => groupMet(g)).map(g => g.name)
    if (posteriorMet()) walls.push('Posterior')
    return {
      title: 'STEMI CRITERIA MET',
      sub: walls.join(' · ') + ' — Activate cath lab',
      icon: '!',
      class: 'result-positive'
    }
  }
  const anyEntered = Object.values(measurements).some(v => v !== '' && v !== undefined && !isNaN(parseFloat(v)))
  if (!anyEntered) return { title: 'Enter ST measurements', sub: 'Type mm values for each lead', icon: '○', class: 'result-neutral' }
  return { title: 'STEMI CRITERIA NOT MET', sub: 'Based on entered measurements', icon: '✓', class: 'result-negative' }
})

// Sgarbossa
const sg = reactive({ c1: null, c2: null, c3orig: null, c3ste: null, c3s: null })

const sgC1Met = computed(() => sg.c1 !== null && sg.c1 >= 1.0)
const sgC2Met = computed(() => sg.c2 !== null && sg.c2 >= 1.0)
const sgC3OrigMet = computed(() => sg.c3orig !== null && sg.c3orig >= 5.0)

const stSRatioNum = computed(() => {
  if (!sg.c3ste || !sg.c3s || sg.c3s === 0) return null
  return -(sg.c3ste / sg.c3s)
})

const stSRatio = computed(() => {
  if (stSRatioNum.value === null) return '—'
  return stSRatioNum.value.toFixed(2)
})

const sgC3ModMet = computed(() => stSRatioNum.value !== null && stSRatioNum.value <= -0.25)

const originalScore = computed(() => {
  let score = 0
  if (sgC1Met.value) score += 5
  if (sgC2Met.value) score += 3
  if (sgC3OrigMet.value) score += 2
  return score
})

const sgarbossaResult = computed(() => {
  if (sgarbossaMode.value === 'original') {
    if (originalScore.value === 0) return { title: 'Enter measurements below', sub: 'Score ≥3 = STEMI likely', icon: '○', class: 'result-neutral' }
    if (originalScore.value >= 3) return { title: 'STEMI LIKELY', sub: `Score ${originalScore.value}/10 — Activate cath lab`, icon: '!', class: 'result-positive' }
    return { title: 'STEMI UNLIKELY', sub: `Score ${originalScore.value}/10 — Below threshold of 3`, icon: '✓', class: 'result-negative' }
  } else {
    const anyMet = sgC1Met.value || sgC2Met.value || sgC3ModMet.value
    const anyEntered = sg.c1 !== null || sg.c2 !== null || sg.c3ste !== null
    if (!anyEntered) return { title: 'Enter measurements below', sub: 'Any criterion = STEMI likely', icon: '○', class: 'result-neutral' }
    if (anyMet) return { title: 'STEMI LIKELY', sub: 'Modified criterion met — Activate cath lab', icon: '!', class: 'result-positive' }
    return { title: 'No criteria met', sub: 'Continue evaluation', icon: '✓', class: 'result-negative' }
  }
})

function clearCalc() {
  sex.value = ''
  age.value = null
  Object.keys(measurements).forEach(k => delete measurements[k])
}

function clearSgarbossa() {
  sg.c1 = null
  sg.c2 = null
  sg.c3orig = null
  sg.c3ste = null
  sg.c3s = null
}
</script>

<style scoped>
.stemi-ref { display: flex; flex-direction: column; gap: 12px; }

.tabs {
  display: flex;
  background: #060e1c;
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}

.tab {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: none;
  color: rgba(255,255,255,0.4);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.tab.active { background: #c9a84c; color: #0a1628; }

.tab-content { display: flex; flex-direction: column; gap: 10px; }

.heart-wrap {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.heart-img { width: 100%; display: block; border-radius: 10px; }

.wall-label {
  position: absolute;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 7px;
  border-radius: 4px;
  line-height: 1.4;
  text-align: center;
}

.wall-label span { font-weight: 400; font-size: 8px; letter-spacing: 0; }
.inferior { bottom: 8%; left: 50%; transform: translateX(-50%); background: rgba(80,140,40,0.9); color: #fff; }
.lateral-left { top: 40%; left: 2%; background: rgba(30,100,180,0.9); color: #fff; }
.anterior { top: 8%; left: 50%; transform: translateX(-50%); background: rgba(190,50,50,0.9); color: #fff; }
.septal { top: 40%; right: 2%; background: rgba(160,100,10,0.9); color: #fff; }

.legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.leg-item { display: flex; align-items: center; gap: 8px; }
.leg-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.leg-name { font-size: 11px; font-weight: 600; color: #fff; }
.leg-leads { font-size: 9px; color: rgba(255,255,255,0.5); }

.grid-label { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: rgba(255,255,255,0.4); }

.ecg-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.ecg-cell { border-radius: 6px; padding: 7px 5px; text-align: center; }
.ecg-lead { font-size: 12px; font-weight: 700; color: #fff; }
.ecg-wall { font-size: 8px; font-weight: 600; margin-top: 2px; }
.inf { background: rgba(99,153,34,0.25); } .inf .ecg-wall { color: #97c459; }
.lat { background: rgba(55,138,221,0.25); } .lat .ecg-wall { color: #85b7eb; }
.sep { background: rgba(186,117,23,0.25); } .sep .ecg-wall { color: #fac775; }
.ant { background: rgba(210,80,80,0.25); } .ant .ecg-wall { color: #ff8080; }
.avr { background: rgba(255,255,255,0.06); } .avr .ecg-wall { color: rgba(255,255,255,0.3); }

.note {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  line-height: 1.5;
  padding: 8px 10px;
  background: rgba(255,255,255,0.04);
  border-radius: 8px;
  border-left: 2px solid rgba(201,168,76,0.4);
}

.patient-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.sex-toggle {
  display: flex;
  background: #060e1c;
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
  flex: 1;
}

.sex-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: none;
  color: rgba(255,255,255,0.4);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.sex-btn.active { background: #c9a84c; color: #0a1628; }

.age-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #c9a84c;
}

.age-input {
  background: #1e3a5f;
  border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 15px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
  width: 70px;
  text-align: center;
}

.age-input:focus { border-color: #c9a84c; }

.threshold-guide {
  background: rgba(201,168,76,0.06);
  border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tg-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #c9a84c;
  margin-bottom: 4px;
}

.tg-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tg-leads { font-size: 11px; color: rgba(255,255,255,0.6); }
.tg-val { font-size: 11px; font-weight: 600; color: #fff; }

.result-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid;
}

.result-neutral { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
.result-positive { background: rgba(220,50,50,0.12); border-color: rgba(220,50,50,0.4); }
.result-negative { background: rgba(99,153,34,0.12); border-color: rgba(99,153,34,0.4); }

.result-icon {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.1);
  flex-shrink: 0;
}

.result-positive .result-icon { background: rgba(220,50,50,0.3); color: #ff8080; }
.result-negative .result-icon { background: rgba(99,153,34,0.3); color: #97c459; }
.result-title { font-size: 13px; font-weight: 700; color: #fff; }
.result-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }
.result-positive .result-title { color: #ff8080; }
.result-negative .result-title { color: #97c459; }

.lead-group {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  overflow: hidden;
}

.lead-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #1e3a5f;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.lead-group-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.lead-group-name { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: rgba(255,255,255,0.7); flex: 1; }

.group-met-badge {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: rgba(220,50,50,0.25);
  color: #ff8080;
  padding: 2px 6px;
  border-radius: 4px;
}

.lead-inputs { display: flex; flex-direction: column; }

.lead-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.1s;
}

.lead-input-row:last-child { border-bottom: none; }
.lead-input-row.met { background: rgba(220,50,50,0.06); }

.lead-name {
  font-size: 13px;
  font-weight: 700;
  color: #c9a84c;
  min-width: 36px;
}

.lead-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.lead-input {
  background: #0a1628;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 14px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
  width: 70px;
  text-align: center;
  transition: border-color 0.15s;
}

.lead-input:focus { border-color: #c9a84c; }
.lead-input.met { border-color: rgba(220,50,50,0.5); color: #ff8080; }
.lead-input.negative { color: #85b7eb; }

.lead-unit { font-size: 11px; color: rgba(255,255,255,0.4); }

.lead-threshold {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  min-width: 50px;
  text-align: right;
}

.lead-status { min-width: 16px; display: flex; align-items: center; justify-content: center; }

.criteria-note {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.04em;
  text-align: center;
}

.criteria-section {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  overflow: hidden;
}

.criterion-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  cursor: pointer;
  transition: background 0.1s;
}

.criterion-row:last-child { border-bottom: none; }
.criterion-row.checked { background: rgba(201,168,76,0.06); }

.check-box {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid rgba(201,168,76,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  transition: all 0.15s;
  color: #0a1628;
}

.check-box.checked { background: #c9a84c; border-color: #c9a84c; }

.criterion-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.criterion-text { font-size: 12px; color: #fff; line-height: 1.4; }
.criterion-detail { font-size: 10px; color: rgba(255,255,255,0.45); line-height: 1.4; }

.score-badge {
  display: inline-block;
  background: rgba(201,168,76,0.2);
  color: #c9a84c;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  align-self: flex-start;
  margin-top: 2px;
}

.score-total {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.6);
  border-top: 1px solid rgba(255,255,255,0.08);
  text-align: right;
}

.score-positive { color: #ff8080; font-size: 15px; }
.score-neutral { color: #c9a84c; font-size: 15px; }

.pt-toggle {
  display: flex;
  background: #060e1c;
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}

.pt-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: none;
  color: rgba(255,255,255,0.4);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.pt-btn.active { background: rgba(201,168,76,0.2); color: #c9a84c; }

.clear-btn {
  background: none;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 10px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.4);
  width: 100%;
  cursor: pointer;
  transition: all 0.15s;
}

.clear-btn:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.7); }
.sg-criterion {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sg-criterion-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sg-num {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.5);
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.15s;
}

.sg-num.met {
  background: rgba(220,50,50,0.2);
  color: #ff8080;
}

.sg-criterion-title {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
}

.sg-criterion-detail {
  font-size: 10px;
  color: rgba(255,255,255,0.45);
  line-height: 1.4;
}

.sg-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sg-threshold {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
}

.sg-met-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: rgba(220,50,50,0.25);
  color: #ff8080;
  padding: 2px 7px;
  border-radius: 4px;
}

.sg-ratio-inputs {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.sg-ratio-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sg-ratio-divider {
  font-size: 18px;
  color: rgba(255,255,255,0.3);
  padding-bottom: 6px;
}

.sg-ratio-result {
  background: #0a1628;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255,255,255,0.6);
  width: 70px;
  text-align: center;
  transition: all 0.15s;
}

.sg-ratio-result.met {
  border-color: rgba(220,50,50,0.5);
  color: #ff8080;
}

.sg-ratio-note {
  font-size: 10px;
  font-weight: 600;
  color: #ff8080;
}

.sg-ratio-note.neutral {
  color: rgba(255,255,255,0.4);
}
</style>