<template>
  <div class="burn-calc">

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'diagram' }" @click="tab = 'diagram'">Rule of Nines</button>
      <button class="tab" :class="{ active: tab === 'calc' }" @click="tab = 'calc'">TBSA Calculator</button>
    </div>

    <!-- Rule of Nines Diagram -->
    <div v-if="tab === 'diagram'" class="diagram-section">
      <div class="pt-toggle" style="margin-bottom: 16px;">
        <button class="pt-btn" :class="{ active: diagType === 'adult' }" @click="diagType = 'adult'">Adult</button>
        <button class="pt-btn" :class="{ active: diagType === 'pediatric' }" @click="diagType = 'pediatric'">Pediatric</button>
      </div>

      <!-- Adult Diagram -->
      <div v-if="diagType === 'adult'">
        <svg viewBox="0 0 300 420" class="body-svg">
          <!-- Head -->
          <circle cx="150" cy="35" r="28" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1.5"/>
          <text x="150" y="39" text-anchor="middle" class="svg-pct">9%</text>

          <!-- Neck -->
          <rect x="138" y="63" width="24" height="14" rx="4" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>

          <!-- Torso -->
          <rect x="100" y="77" width="100" height="110" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1.5"/>
          <text x="150" y="120" text-anchor="middle" class="svg-pct">Anterior</text>
          <text x="150" y="138" text-anchor="middle" class="svg-pct">18%</text>
          <text x="150" y="158" text-anchor="middle" class="svg-label">Posterior 18%</text>

          <!-- Left Upper Arm -->
          <rect x="58" y="80" width="38" height="60" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="77" y="114" text-anchor="middle" class="svg-pct">4%</text>

          <!-- Right Upper Arm -->
          <rect x="204" y="80" width="38" height="60" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="223" y="114" text-anchor="middle" class="svg-pct">4%</text>

          <!-- Left Lower Arm -->
          <rect x="62" y="144" width="30" height="50" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="77" y="173" text-anchor="middle" class="svg-pct">3%</text>

          <!-- Right Lower Arm -->
          <rect x="208" y="144" width="30" height="50" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="223" y="173" text-anchor="middle" class="svg-pct">3%</text>

          <!-- Left Hand -->
          <ellipse cx="72" cy="207" rx="16" ry="11" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="72" y="211" text-anchor="middle" class="svg-pct">2.5%</text>

          <!-- Right Hand -->
          <ellipse cx="228" cy="207" rx="16" ry="11" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="228" y="211" text-anchor="middle" class="svg-pct">2.5%</text>

          <!-- Genitalia -->
          <ellipse cx="150" cy="193" rx="12" ry="9" fill="#2a4a6f" stroke="#c9a84c" stroke-width="1"/>
          <text x="150" y="197" text-anchor="middle" class="svg-pct">1%</text>

          <!-- Left Thigh -->
          <rect x="105" y="200" width="40" height="80" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="125" y="245" text-anchor="middle" class="svg-pct">9%</text>

          <!-- Right Thigh -->
          <rect x="155" y="200" width="40" height="80" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="175" y="245" text-anchor="middle" class="svg-pct">9%</text>

          <!-- Left Lower Leg -->
          <rect x="108" y="284" width="34" height="75" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="125" y="326" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Right Lower Leg -->
          <rect x="158" y="284" width="34" height="75" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="175" y="326" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Left Foot -->
          <ellipse cx="120" cy="368" rx="20" ry="10" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="120" y="372" text-anchor="middle" class="svg-pct">3.5%</text>

          <!-- Right Foot -->
          <ellipse cx="180" cy="368" rx="20" ry="10" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="180" y="372" text-anchor="middle" class="svg-pct">3.5%</text>
        </svg>
      </div>

      <!-- Pediatric Diagram -->
      <div v-if="diagType === 'pediatric'">
        <svg viewBox="0 0 300 420" class="body-svg">
          <!-- Head (larger for peds) -->
          <circle cx="150" cy="40" r="36" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1.5"/>
          <text x="150" y="44" text-anchor="middle" class="svg-pct">18%</text>

          <!-- Neck -->
          <rect x="140" y="76" width="20" height="12" rx="4" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>

          <!-- Torso -->
          <rect x="105" y="88" width="90" height="95" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1.5"/>
          <text x="150" y="128" text-anchor="middle" class="svg-pct">Anterior</text>
          <text x="150" y="146" text-anchor="middle" class="svg-pct">18%</text>
          <text x="150" y="164" text-anchor="middle" class="svg-label">Posterior 18%</text>

          <!-- Left Upper Arm -->
          <rect x="65" y="90" width="36" height="55" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="83" y="121" text-anchor="middle" class="svg-pct">4%</text>

          <!-- Right Upper Arm -->
          <rect x="199" y="90" width="36" height="55" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="217" y="121" text-anchor="middle" class="svg-pct">4%</text>

          <!-- Left Lower Arm -->
          <rect x="68" y="149" width="28" height="45" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="82" y="175" text-anchor="middle" class="svg-pct">3%</text>

          <!-- Right Lower Arm -->
          <rect x="204" y="149" width="28" height="45" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="218" y="175" text-anchor="middle" class="svg-pct">3%</text>

          <!-- Left Hand -->
          <ellipse cx="78" cy="203" rx="14" ry="10" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="78" y="207" text-anchor="middle" class="svg-pct">2.5%</text>

          <!-- Right Hand -->
          <ellipse cx="222" cy="203" rx="14" ry="10" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="222" y="207" text-anchor="middle" class="svg-pct">2.5%</text>

          <!-- Genitalia -->
          <ellipse cx="150" cy="187" rx="11" ry="8" fill="#2a4a6f" stroke="#c9a84c" stroke-width="1"/>
          <text x="150" y="191" text-anchor="middle" class="svg-pct">1%</text>

          <!-- Left Thigh -->
          <rect x="108" y="196" width="36" height="72" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="126" y="237" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Right Thigh -->
          <rect x="156" y="196" width="36" height="72" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="174" y="237" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Left Lower Leg -->
          <rect x="111" y="272" width="30" height="70" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="126" y="311" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Right Lower Leg -->
          <rect x="159" y="272" width="30" height="70" rx="6" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="174" y="311" text-anchor="middle" class="svg-pct">7%</text>

          <!-- Left Foot -->
          <ellipse cx="122" cy="351" rx="18" ry="9" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="122" y="355" text-anchor="middle" class="svg-pct">3.5%</text>

          <!-- Right Foot -->
          <ellipse cx="178" cy="351" rx="18" ry="9" fill="#1e3a5f" stroke="#c9a84c" stroke-width="1"/>
          <text x="178" y="355" text-anchor="middle" class="svg-pct">3.5%</text>
        </svg>
      </div>
    </div>

    <!-- TBSA Calculator -->
    <div v-if="tab === 'calc'" class="calc-section">

      <!-- Age input for fluid calc -->
      <div class="input-row">
        <div class="input-group">
          <label class="input-label">PATIENT AGE (years)</label>
          <input v-model.number="age" type="number" min="0" max="120" class="calc-input" placeholder="0" />
        </div>
        <div class="input-group">
          <label class="input-label">WEIGHT (kg)</label>
          <input v-model.number="weight" type="number" min="0" class="calc-input" placeholder="0" />
        </div>
      </div>

      <!-- Patient type toggle -->
      <div class="pt-toggle" style="margin-bottom: 12px;">
        <button class="pt-btn" :class="{ active: calcType === 'adult' }" @click="calcType = 'adult'">Adult</button>
        <button class="pt-btn" :class="{ active: calcType === 'pediatric' }" @click="calcType = 'pediatric'">Pediatric</button>
      </div>

      <!-- TBSA Total -->
      <div class="tbsa-total" :class="tbsaSeverityClass">
        <div class="tbsa-num">{{ totalTBSA }}%</div>
        <div class="tbsa-label">Total TBSA</div>
        <div class="tbsa-severity">{{ tbsaSeverity }}</div>
      </div>

      <!-- Fluid Rate -->
      <div v-if="age > 0" class="fluid-box">
        <div class="fluid-label">FLUID RATE</div>
        <div class="fluid-rate">{{ fluidRate }} mL/hr</div>
        <div class="fluid-note">{{ fluidNote }}</div>
      </div>

      <!-- Body regions -->
      <div class="regions-section">
        <div class="regions-title">SELECT BURNED AREAS</div>

        <div v-for="group in regionGroups(calcType)" :key="group.name" class="region-group">
          <div class="region-group-label">{{ group.name }}</div>
          <div
            v-for="region in group.regions"
            :key="region.id"
            class="region-row"
            :class="{ selected: selected.includes(region.id) }"
            @click="toggleRegion(region.id)"
          >
            <div class="region-check">
              <svg v-if="selected.includes(region.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px;height:12px;">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <span class="region-name">{{ region.name }}</span>
            <span class="region-pct">{{ region.pct }}%</span>
          </div>
        </div>
      </div>

      <button class="clear-btn" @click="clearAll">Clear All</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const tab = ref('diagram')
const diagType = ref('adult')
const calcType = ref('adult')
const selected = ref([])
const age = ref(null)
const weight = ref(null)

const adultRegions = [
  {
    name: 'HEAD & NECK',
    regions: [
      { id: 'head', name: 'Head', pct: 4.5 },
      { id: 'neck', name: 'Neck', pct: 4.5 },
    ]
  },
  {
    name: 'TRUNK',
    regions: [
      { id: 'ant-trunk', name: 'Anterior Trunk', pct: 18 },
      { id: 'post-trunk', name: 'Posterior Trunk', pct: 18 },
      { id: 'genitalia', name: 'Genitalia', pct: 1 },
    ]
  },
  {
    name: 'UPPER EXTREMITIES',
    regions: [
      { id: 'l-upper-arm', name: 'Left Upper Arm', pct: 2 },
      { id: 'r-upper-arm', name: 'Right Upper Arm', pct: 2 },
      { id: 'l-lower-arm', name: 'Left Lower Arm', pct: 1.5 },
      { id: 'r-lower-arm', name: 'Right Lower Arm', pct: 1.5 },
      { id: 'l-hand', name: 'Left Hand', pct: 1.25 },
      { id: 'r-hand', name: 'Right Hand', pct: 1.25 },
    ]
  },
  {
    name: 'LOWER EXTREMITIES',
    regions: [
      { id: 'l-thigh', name: 'Left Thigh', pct: 4.75 },
      { id: 'r-thigh', name: 'Right Thigh', pct: 4.75 },
      { id: 'l-leg', name: 'Left Lower Leg', pct: 3.5 },
      { id: 'r-leg', name: 'Right Lower Leg', pct: 3.5 },
      { id: 'l-foot', name: 'Left Foot', pct: 1.75 },
      { id: 'r-foot', name: 'Right Foot', pct: 1.75 },
    ]
  },
]

const pedRegions = [
  {
    name: 'HEAD & NECK',
    regions: [
      { id: 'head', name: 'Head', pct: 9 },
      { id: 'neck', name: 'Neck', pct: 9 },
    ]
  },
  {
    name: 'TRUNK',
    regions: [
      { id: 'ant-trunk', name: 'Anterior Trunk', pct: 18 },
      { id: 'post-trunk', name: 'Posterior Trunk', pct: 18 },
      { id: 'genitalia', name: 'Genitalia', pct: 1 },
    ]
  },
  {
    name: 'UPPER EXTREMITIES',
    regions: [
      { id: 'l-upper-arm', name: 'Left Upper Arm', pct: 2 },
      { id: 'r-upper-arm', name: 'Right Upper Arm', pct: 2 },
      { id: 'l-lower-arm', name: 'Left Lower Arm', pct: 1.5 },
      { id: 'r-lower-arm', name: 'Right Lower Arm', pct: 1.5 },
      { id: 'l-hand', name: 'Left Hand', pct: 1.25 },
      { id: 'r-hand', name: 'Right Hand', pct: 1.25 },
    ]
  },
  {
    name: 'LOWER EXTREMITIES',
    regions: [
      { id: 'l-thigh', name: 'Left Thigh', pct: 3.5 },
      { id: 'r-thigh', name: 'Right Thigh', pct: 3.5 },
      { id: 'l-leg', name: 'Left Lower Leg', pct: 3.5 },
      { id: 'r-leg', name: 'Right Lower Leg', pct: 3.5 },
      { id: 'l-foot', name: 'Left Foot', pct: 1.75 },
      { id: 'r-foot', name: 'Right Foot', pct: 1.75 },
    ]
  },
]

function regionGroups(type) {
  return type === 'adult' ? adultRegions : pedRegions
}

function toggleRegion(id) {
  const idx = selected.value.indexOf(id)
  if (idx === -1) selected.value.push(id)
  else selected.value.splice(idx, 1)
}

function clearAll() {
  selected.value = []
  age.value = null
  weight.value = null
}

const totalTBSA = computed(() => {
  const groups = regionGroups(calcType.value)
  let total = 0
  groups.forEach(g => {
    g.regions.forEach(r => {
      if (selected.value.includes(r.id)) total += r.pct
    })
  })
  return Math.round(total * 10) / 10
})

const tbsaSeverity = computed(() => {
  const t = totalTBSA.value
  if (t === 0) return 'Select burned areas below'
  if (t < 10) return 'Minor burn'
  if (t < 20) return 'Moderate burn'
  if (t < 40) return 'Major burn'
  return 'Critical burn — air medical consideration'
})

const tbsaSeverityClass = computed(() => {
  const t = totalTBSA.value
  if (t === 0) return ''
  if (t < 10) return 'severity-minor'
  if (t < 20) return 'severity-moderate'
  return 'severity-major'
})

const fluidRate = computed(() => {
  if (!age.value) return '--'
  if (age.value > 14) return 500
  if (age.value < 6) return 150
  return 250
})

const fluidNote = computed(() => {
  if (!age.value) return ''
  if (age.value > 14) return 'Age > 14 years — 500 mL/hr'
  if (age.value < 6) return 'Age < 6 years — 150 mL/hr'
  return 'Age 6–14 years — 250 mL/hr'
})
</script>

<style scoped>
.burn-calc {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.tabs {
  display: flex;
  gap: 3px;
  background: var(--navy);
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 16px;
}

.tab {
  flex: 1;
  padding: 8px 0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: none;
  color: rgba(255,255,255,0.4);
  transition: all 0.15s;
  border: none;
  cursor: pointer;
}

.tab.active {
  background: var(--gold);
  color: #0a1628;
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
  padding: 7px 0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: none;
  color: rgba(255,255,255,0.4);
  transition: all 0.15s;
  border: none;
  cursor: pointer;
}

.pt-btn.active {
  background: rgba(201,168,76,0.2);
  color: #c9a84c;
}

.body-svg {
  width: 100%;
  max-width: 240px;
  display: block;
  margin: 0 auto;
}

.svg-pct {
  fill: #c9a84c;
  font-size: 9px;
  font-weight: 700;
  font-family: 'Inter', sans-serif;
}

.svg-label {
  fill: rgba(255,255,255,0.5);
  font-size: 8px;
  font-family: 'Inter', sans-serif;
}

.calc-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #c9a84c;
}

.calc-input {
  background: #1e3a5f;
  border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 16px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
  width: 100%;
}

.calc-input:focus {
  border-color: #c9a84c;
}

.tbsa-total {
  background: #1e3a5f;
  border: 1px solid rgba(201,168,76,0.2);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  transition: background 0.2s, border-color 0.2s;
}

.tbsa-total.severity-minor {
  background: rgba(99,153,34,0.1);
  border-color: rgba(99,153,34,0.4);
}

.tbsa-total.severity-moderate {
  background: rgba(186,117,23,0.1);
  border-color: rgba(186,117,23,0.4);
}

.tbsa-total.severity-major {
  background: rgba(220,50,50,0.1);
  border-color: rgba(220,50,50,0.4);
}

.tbsa-num {
  font-size: 42px;
  font-weight: 700;
  color: #c9a84c;
  line-height: 1;
  margin-bottom: 4px;
}

.tbsa-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.4);
  margin-bottom: 6px;
}

.tbsa-severity {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
}

.fluid-box {
  background: rgba(55,138,221,0.1);
  border: 1px solid rgba(55,138,221,0.3);
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fluid-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #85b7eb;
}

.fluid-rate {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
}

.fluid-note {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
}

.regions-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.regions-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #c9a84c;
}

.region-group {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  overflow: hidden;
}

.region-group-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.4);
  padding: 7px 12px;
  background: #1e3a5f;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.region-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  cursor: pointer;
  transition: background 0.1s;
}

.region-row:last-child {
  border-bottom: none;
}

.region-row.selected {
  background: rgba(201,168,76,0.08);
}

.region-check {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid rgba(201,168,76,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.region-row.selected .region-check {
  background: #c9a84c;
  border-color: #c9a84c;
  color: #0a1628;
}

.region-name {
  flex: 1;
  font-size: 13px;
  color: #fff;
}

.region-pct {
  font-size: 12px;
  font-weight: 700;
  color: #c9a84c;
}

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
  transition: border-color 0.15s, color 0.15s;
}

.clear-btn:hover {
  border-color: rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.7);
}
</style>