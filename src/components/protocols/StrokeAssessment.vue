<template>
  <div class="stroke-ref">

    <div class="tabs">
      <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>

    <!-- Cincinnati -->
    <div v-if="activeTab === 'cincinnati'" class="tab-content">

      <div class="result-banner" :class="cincinnatiResult.class">
        <div class="result-icon">{{ cincinnatiResult.icon }}</div>
        <div>
          <div class="result-title">{{ cincinnatiResult.title }}</div>
          <div class="result-sub">{{ cincinnatiResult.sub }}</div>
        </div>
      </div>

      <div class="criteria-note">Cincinnati Prehospital Stroke Scale · Kothari et al., Ann Emerg Med 1999<br>1 abnormal finding = 72% probability stroke · All 3 = >85% probability</div>

      <div v-for="item in cincinnatiItems" :key="item.id" class="assessment-card">
        <div class="assessment-header">
          <div class="assessment-num" :class="{ abnormal: item.result === 'abnormal', normal: item.result === 'normal' }">{{ item.id }}</div>
          <div class="assessment-title">{{ item.title }}</div>
        </div>
        <div class="assessment-instruction">{{ item.instruction }}</div>
        <div class="assessment-findings">
          <div class="finding-row">
            <div class="finding-label normal-label">Normal:</div>
            <div class="finding-text">{{ item.normal }}</div>
          </div>
          <div class="finding-row">
            <div class="finding-label abnormal-label">Abnormal:</div>
            <div class="finding-text">{{ item.abnormal }}</div>
          </div>
        </div>
        <div class="result-toggle">
          <button
            class="result-btn normal-btn"
            :class="{ active: item.result === 'normal' }"
            @click="item.result = 'normal'"
          >Normal</button>
          <button
            class="result-btn abnormal-btn"
            :class="{ active: item.result === 'abnormal' }"
            @click="item.result = 'abnormal'"
          >Abnormal</button>
          <button
            class="result-btn"
            :class="{ active: item.result === null }"
            @click="item.result = null"
          >Not tested</button>
        </div>
      </div>

      <button class="clear-btn" @click="clearCincinnati">Clear All</button>
    </div>

    <!-- VAN -->
    <div v-if="activeTab === 'van'" class="tab-content">

      <div class="result-banner" :class="vanResult.class">
        <div class="result-icon">{{ vanResult.icon }}</div>
        <div>
          <div class="result-title">{{ vanResult.title }}</div>
          <div class="result-sub">{{ vanResult.sub }}</div>
        </div>
      </div>

      <div class="criteria-note">VAN Assessment · Perry et al., J Neurointerv Surg 2017<br>Sensitivity 100% · Specificity 90% for LVO · Arm drift required before proceeding</div>

      <!-- Step 1: Arm Drift (required) -->
      <div class="assessment-card" :class="{ locked: false }">
        <div class="assessment-header">
          <div class="assessment-num" :class="{ abnormal: vanArmDrift === true, normal: vanArmDrift === false }">1</div>
          <div>
            <div class="assessment-title">Arm Drift <span class="required-badge">REQUIRED FIRST</span></div>
          </div>
        </div>
        <div class="assessment-instruction">Ask patient to close eyes and hold both arms out straight in front with palms up for 10 seconds.</div>
        <div class="assessment-findings">
          <div class="finding-row">
            <div class="finding-label normal-label">Normal:</div>
            <div class="finding-text">Both arms stay level</div>
          </div>
          <div class="finding-row">
            <div class="finding-label abnormal-label">Abnormal:</div>
            <div class="finding-text">One arm drifts down or doesn't raise</div>
          </div>
        </div>
        <div class="result-toggle">
          <button class="result-btn normal-btn" :class="{ active: vanArmDrift === false }" @click="vanArmDrift = false">Normal</button>
          <button class="result-btn abnormal-btn" :class="{ active: vanArmDrift === true }" @click="vanArmDrift = true">Abnormal</button>
          <button class="result-btn" :class="{ active: vanArmDrift === null }" @click="vanArmDrift = null">Not tested</button>
        </div>
      </div>

      <!-- Steps 2-4 locked until arm drift positive -->
      <div v-if="vanArmDrift !== true" class="van-locked-notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        Arm drift must be abnormal to proceed with VAN assessment
      </div>

      <template v-if="vanArmDrift === true">

        <!-- Step 2: Vision -->
        <div class="assessment-card">
          <div class="assessment-header">
            <div class="assessment-num" :class="{ abnormal: vanVision === true, normal: vanVision === false }">2</div>
            <div class="assessment-title">Vision (V)</div>
          </div>
          <div class="assessment-instruction">Ask patient to look straight ahead. Check for gaze deviation. Ask "how many fingers am I holding up?" in each visual field.</div>
          <div class="assessment-findings">
            <div class="finding-row">
              <div class="finding-label normal-label">Normal:</div>
              <div class="finding-text">Eyes midline, can count fingers in both fields</div>
            </div>
            <div class="finding-row">
              <div class="finding-label abnormal-label">Abnormal:</div>
              <div class="finding-text">Gaze deviation, visual field cut, or unable to count fingers</div>
            </div>
          </div>
          <div class="result-toggle">
            <button class="result-btn normal-btn" :class="{ active: vanVision === false }" @click="vanVision = false">Normal</button>
            <button class="result-btn abnormal-btn" :class="{ active: vanVision === true }" @click="vanVision = true">Abnormal</button>
            <button class="result-btn" :class="{ active: vanVision === null }" @click="vanVision = null">Not tested</button>
          </div>
        </div>

        <!-- Step 3: Aphasia -->
        <div class="assessment-card">
          <div class="assessment-header">
            <div class="assessment-num" :class="{ abnormal: vanAphasia === true, normal: vanAphasia === false }">3</div>
            <div class="assessment-title">Aphasia (A)</div>
          </div>
          <div class="assessment-instruction">Ask patient to name 3 common objects (pen, watch, phone). Then ask them to repeat "You can't teach an old dog new tricks."</div>
          <div class="assessment-findings">
            <div class="finding-row">
              <div class="finding-label normal-label">Normal:</div>
              <div class="finding-text">Names objects correctly and repeats phrase</div>
            </div>
            <div class="finding-row">
              <div class="finding-label abnormal-label">Abnormal:</div>
              <div class="finding-text">Cannot name objects or repeat phrase (not due to dysarthria alone)</div>
            </div>
          </div>
          <div class="result-toggle">
            <button class="result-btn normal-btn" :class="{ active: vanAphasia === false }" @click="vanAphasia = false">Normal</button>
            <button class="result-btn abnormal-btn" :class="{ active: vanAphasia === true }" @click="vanAphasia = true">Abnormal</button>
            <button class="result-btn" :class="{ active: vanAphasia === null }" @click="vanAphasia = null">Not tested</button>
          </div>
        </div>

        <!-- Step 4: Neglect -->
        <div class="assessment-card">
          <div class="assessment-header">
            <div class="assessment-num" :class="{ abnormal: vanNeglect === true, normal: vanNeglect === false }">4</div>
            <div class="assessment-title">Neglect (N)</div>
          </div>
          <div class="assessment-instruction">Hold both hands up simultaneously in patient's peripheral vision and ask "how many hands do you see?" Then touch both hands and ask "where am I touching you?"</div>
          <div class="assessment-findings">
            <div class="finding-row">
              <div class="finding-label normal-label">Normal:</div>
              <div class="finding-text">Identifies both hands and both touch locations</div>
            </div>
            <div class="finding-row">
              <div class="finding-label abnormal-label">Abnormal:</div>
              <div class="finding-text">Only sees/feels one side (extinction to double simultaneous stimulation)</div>
            </div>
          </div>
          <div class="result-toggle">
            <button class="result-btn normal-btn" :class="{ active: vanNeglect === false }" @click="vanNeglect = false">Normal</button>
            <button class="result-btn abnormal-btn" :class="{ active: vanNeglect === true }" @click="vanNeglect = true">Abnormal</button>
            <button class="result-btn" :class="{ active: vanNeglect === null }" @click="vanNeglect = null">Not tested</button>
          </div>
        </div>

      </template>

      <button class="clear-btn" @click="clearVAN">Clear All</button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'

const activeTab = ref('cincinnati')

const tabs = [
  { id: 'cincinnati', label: 'Cincinnati (CPSS)' },
  { id: 'van', label: 'VAN — LVO Screen' },
]

const cincinnatiItems = reactive([
  {
    id: 1,
    title: 'Facial Droop',
    instruction: 'Ask patient to smile or show teeth.',
    normal: 'Both sides of face move equally',
    abnormal: 'One side doesn\'t move as well — droops',
    result: null
  },
  {
    id: 2,
    title: 'Arm Drift',
    instruction: 'Ask patient to close eyes and hold both arms out straight with palms up for 10 seconds.',
    normal: 'Both arms move the same or both stay still',
    abnormal: 'One arm drifts down or doesn\'t move at all',
    result: null
  },
  {
    id: 3,
    title: 'Speech',
    instruction: 'Ask patient to say "You can\'t teach an old dog new tricks."',
    normal: 'Patient uses correct words with no slurring',
    abnormal: 'Slurred, uses wrong words, or cannot speak',
    result: null
  },
])

const abnormalCount = computed(() => cincinnatiItems.filter(i => i.result === 'abnormal').length)

const cincinnatiResult = computed(() => {
  const count = abnormalCount.value
  const anyTested = cincinnatiItems.some(i => i.result !== null)
  if (!anyTested) return { title: 'Assess each finding below', sub: 'Select Normal or Abnormal for each', icon: '○', class: 'result-neutral' }
  if (count === 0) return { title: 'STROKE UNLIKELY', sub: 'No abnormal findings — continue assessment', icon: '✓', class: 'result-negative' }
  if (count === 1) return { title: 'POSSIBLE STROKE', sub: '1 abnormal finding — 72% probability of stroke', icon: '!', class: 'result-warning' }
  if (count === 2) return { title: 'LIKELY STROKE', sub: '2 abnormal findings — activate stroke protocol', icon: '!', class: 'result-positive' }
  return { title: 'STROKE — HIGH PROBABILITY', sub: 'All 3 abnormal — >85% probability — activate stroke protocol', icon: '!', class: 'result-positive' }
})

const vanArmDrift = ref(null)
const vanVision = ref(null)
const vanAphasia = ref(null)
const vanNeglect = ref(null)

const corticalSigns = computed(() => {
  return [vanVision.value, vanAphasia.value, vanNeglect.value].filter(v => v === true).length
})

const vanResult = computed(() => {
  if (vanArmDrift.value === null) return { title: 'Begin with arm drift assessment', sub: 'Arm drift must be present to continue', icon: '○', class: 'result-neutral' }
  if (vanArmDrift.value === false) return { title: 'VAN NEGATIVE', sub: 'No arm drift — LVO unlikely', icon: '✓', class: 'result-negative' }
  if (corticalSigns.value === 0 && [vanVision.value, vanAphasia.value, vanNeglect.value].every(v => v === null)) {
    return { title: 'Arm drift present — continue assessment', sub: 'Assess vision, aphasia, and neglect', icon: '○', class: 'result-neutral' }
  }
  if (corticalSigns.value >= 1) {
    return { title: 'VAN POSITIVE — LVO SUSPECTED', sub: 'Arm drift + cortical sign — consider direct transport to stroke center', icon: '!', class: 'result-positive' }
  }
  return { title: 'VAN NEGATIVE', sub: 'Arm drift without cortical signs — LVO unlikely', icon: '✓', class: 'result-negative' }
})

function clearCincinnati() {
  cincinnatiItems.forEach(i => i.result = null)
}

function clearVAN() {
  vanArmDrift.value = null
  vanVision.value = null
  vanAphasia.value = null
  vanNeglect.value = null
}
</script>

<style scoped>
.stroke-ref { display: flex; flex-direction: column; gap: 12px; }

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
.result-warning { background: rgba(186,117,23,0.12); border-color: rgba(186,117,23,0.4); }

.result-icon {
  font-size: 18px;
  font-weight: 700;
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.1);
  color: #fff;
  flex-shrink: 0;
}

.result-positive .result-icon { background: rgba(220,50,50,0.3); color: #ff8080; }
.result-negative .result-icon { background: rgba(99,153,34,0.3); color: #97c459; }
.result-warning .result-icon { background: rgba(186,117,23,0.3); color: #fac775; }
.result-title { font-size: 13px; font-weight: 700; color: #fff; }
.result-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }
.result-positive .result-title { color: #ff8080; }
.result-negative .result-title { color: #97c459; }
.result-warning .result-title { color: #fac775; }

.criteria-note {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.04em;
  text-align: center;
  line-height: 1.6;
}

.assessment-card {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assessment-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.assessment-num {
  min-width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.5);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}

.assessment-num.abnormal { background: rgba(220,50,50,0.3); color: #ff8080; }
.assessment-num.normal { background: rgba(99,153,34,0.3); color: #97c459; }

.assessment-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
}

.required-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: rgba(201,168,76,0.2);
  color: #c9a84c;
  padding: 2px 6px;
  border-radius: 4px;
}

.assessment-instruction {
  font-size: 12px;
  color: rgba(255,255,255,0.7);
  line-height: 1.5;
  padding: 8px 10px;
  background: rgba(255,255,255,0.04);
  border-radius: 6px;
  border-left: 2px solid rgba(201,168,76,0.3);
}

.assessment-findings {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.finding-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.finding-label {
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  min-width: 65px;
  margin-top: 1px;
}

.normal-label { color: #97c459; }
.abnormal-label { color: #ff8080; }

.finding-text {
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  line-height: 1.4;
}

.result-toggle {
  display: flex;
  gap: 4px;
}

.result-btn {
  flex: 1;
  padding: 7px 4px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.4);
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.normal-btn.active { background: rgba(99,153,34,0.25); color: #97c459; border-color: rgba(99,153,34,0.4); }
.abnormal-btn.active { background: rgba(220,50,50,0.25); color: #ff8080; border-color: rgba(220,50,50,0.4); }
.result-btn.active:not(.normal-btn):not(.abnormal-btn) { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }

.van-locked-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.4);
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
  transition: all 0.15s;
}

.clear-btn:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.7); }
</style>