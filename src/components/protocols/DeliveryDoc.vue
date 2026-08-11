<template>
  <div class="delivery-doc">

    <div class="tabs">
      <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>

    <!-- Delivery Info Tab -->
    <div v-if="activeTab === 'delivery'" class="tab-content">
<div class="new-patient-banner">
    <div class="new-patient-text">New patient? Clear all data before starting.</div>
    <button class="clear-patient-btn" @click="clearAll">Clear All</button>
  </div>
      <div class="section">
        <div class="section-title">TIME OF BIRTH</div>
        <div class="time-row">
          <input v-model="form.birthTime" type="time" step="1" class="time-input" />
          <input v-model="form.birthDate" type="date" class="date-input" />
          <button class="now-btn" @click="stampBirth">Now</button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">TIME PLACENTA DELIVERED</div>
        <div class="time-row">
          <input v-model="form.placentaTime" type="time" step="1" class="time-input" />
          <input v-model="form.placentaDate" type="date" class="date-input" />
          <button class="now-btn" @click="stampPlacenta">Now</button>
        </div>
      </div>
      <div v-if="form.birthTime && form.birthDate" class="section">
        <div class="section-title">APGAR STATUS</div>
        <div class="apgar-status-row">
          <div class="apgar-status-card" :class="{ 'status-due': apgar1Due && isPast(apgar1Due) }">
            <div class="status-label">APGAR 1 MIN</div>
            <div class="status-time">Due {{ apgar1Due }}</div>
            <div v-if="hasApgar1Scores" class="status-score" :class="apgarClass(apgar1Total)">
              {{ apgar1Total }}/10 — {{ apgarInterpretation(apgar1Total).split('—')[0].trim() }}
            </div>
            <div v-else class="status-pending">{{ isPast(apgar1Due) ? 'Ready to score' : 'Pending' }}</div>
          </div>
          <div class="apgar-status-card" :class="{ 'status-due': apgar5Due && isPast(apgar5Due) }">
            <div class="status-label">APGAR 5 MIN</div>
            <div class="status-time">Due {{ apgar5Due }}</div>
            <div v-if="hasApgar5Scores" class="status-score" :class="apgarClass(apgar5Total)">
              {{ apgar5Total }}/10 — {{ apgarInterpretation(apgar5Total).split('—')[0].trim() }}
            </div>
            <div v-else class="status-pending">{{ isPast(apgar5Due) ? 'Ready to score' : 'Pending' }}</div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">DELIVERY COMPLICATIONS</div>
        <div class="checklist">
          <div
            v-for="comp in complications"
            :key="comp.id"
            class="check-item"
            :class="{ checked: comp.checked }"
            @click="comp.checked = !comp.checked"
          >
            <div class="check-box" :class="{ checked: comp.checked }">
              <svg v-if="comp.checked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:11px;height:11px;"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <span class="check-label">{{ comp.label }}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">NOTES</div>
        <textarea v-model="form.notes" class="notes-input" rows="3" placeholder="Additional delivery notes..."></textarea>
      </div>

    </div>

    <!-- APGAR Tab -->
    <div v-if="activeTab === 'apgar'" class="tab-content">

      <div class="apgar-timers">
  <div class="timer-card" :class="{ complete: apgar1Due && isPast(apgar1Due) }">
    <div class="timer-label">1 MIN APGAR DUE</div>
    <div class="timer-display">{{ apgar1Due || '—' }}</div>
    <div v-if="!apgar1Due" class="timer-hint">Enter birth time on Delivery tab</div>
    <div v-else-if="isPast(apgar1Due)" class="timer-done">✓ Score now</div>
    <div v-else class="timer-hint">Pending</div>
  </div>
  <div class="timer-card" :class="{ complete: apgar5Due && isPast(apgar5Due) }">
    <div class="timer-label">5 MIN APGAR DUE</div>
    <div class="timer-display">{{ apgar5Due || '—' }}</div>
    <div v-if="!apgar5Due" class="timer-hint">Enter birth time on Delivery tab</div>
    <div v-else-if="isPast(apgar5Due)" class="timer-done">✓ Score now</div>
    <div v-else class="timer-hint">Pending</div>
  </div>
</div>

      <!-- APGAR 1 min -->
      <div class="apgar-section">
        <div class="apgar-header">
          <span class="apgar-title">APGAR — 1 MINUTE</span>
          <span class="apgar-score" :class="apgarClass(apgar1Total)">{{ apgar1Total }}/10</span>
        </div>
        <div class="apgar-interpretation" :class="apgarClass(apgar1Total)">{{ apgarInterpretation(apgar1Total) }}</div>

        <div v-for="item in apgarItems" :key="'1-'+item.id" class="apgar-item">
          <div class="apgar-item-title">{{ item.title }}</div>
          <div class="apgar-scores">
            <div
              v-for="score in [0,1,2]"
              :key="score"
              class="apgar-score-btn"
              :class="{ selected: apgar1[item.id] === score }"
              @click="apgar1[item.id] = score"
            >
              <div class="score-num">{{ score }}</div>
              <div class="score-desc">{{ item.scores[score] }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- APGAR 5 min -->
      <div class="apgar-section">
        <div class="apgar-header">
          <span class="apgar-title">APGAR — 5 MINUTES</span>
          <span class="apgar-score" :class="apgarClass(apgar5Total)">{{ apgar5Total }}/10</span>
        </div>
        <div class="apgar-interpretation" :class="apgarClass(apgar5Total)">{{ apgarInterpretation(apgar5Total) }}</div>

        <div v-for="item in apgarItems" :key="'5-'+item.id" class="apgar-item">
          <div class="apgar-item-title">{{ item.title }}</div>
          <div class="apgar-scores">
            <div
              v-for="score in [0,1,2]"
              :key="score"
              class="apgar-score-btn"
              :class="{ selected: apgar5[item.id] === score }"
              @click="apgar5[item.id] = score"
            >
              <div class="score-num">{{ score }}</div>
              <div class="score-desc">{{ item.scores[score] }}</div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Export button always visible -->
    <button class="export-btn" @click="exportPDF">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export Delivery Report
    </button>

  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { contractionStore } from '@/stores/protocols/contractionStore'
import { deliveryStore } from '@/stores/protocols/deliveryStore'

const activeTab = ref('delivery')

const tabs = [
  { id: 'delivery', label: 'Delivery Info' },
  { id: 'apgar', label: 'APGAR' },
]

const { form, complications, apgar1, apgar5 } = deliveryStore

function stampBirth() {
  const now = new Date()
  form.birthTime = now.toTimeString().slice(0, 8)
  form.birthDate = now.toISOString().slice(0, 10)
}

function stampPlacenta() {
  const now = new Date()
  form.placentaTime = now.toTimeString().slice(0, 8)
  form.placentaDate = now.toISOString().slice(0, 10)
}

const apgar1Due = computed(() => {
  if (!form.birthTime || !form.birthDate) return null
  const birth = new Date(`${form.birthDate}T${form.birthTime}`)
  const due = new Date(birth.getTime() + 60000)
  return due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

const apgar5Due = computed(() => {
  if (!form.birthTime || !form.birthDate) return null
  const birth = new Date(`${form.birthDate}T${form.birthTime}`)
  const due = new Date(birth.getTime() + 300000)
  return due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})

function isPast(timeStr) {
  if (!timeStr || !form.birthDate || !form.birthTime) return false
  const birth = new Date(`${form.birthDate}T${form.birthTime}`)
  const now = new Date()
  const elapsed = now - birth
  if (timeStr === apgar1Due.value) return elapsed >= 60000
  if (timeStr === apgar5Due.value) return elapsed >= 300000
  return false
}    

// APGAR
const apgarItems = [
  { id: 'appearance', title: 'Appearance (Color)', scores: ['Blue/pale all over', 'Blue extremities, pink body', 'Pink all over'] },
  { id: 'pulse', title: 'Pulse (Heart Rate)', scores: ['Absent', '<100 bpm', '≥100 bpm'] },
  { id: 'grimace', title: 'Grimace (Reflex)', scores: ['No response', 'Grimace only', 'Cry, cough, or sneeze'] },
  { id: 'activity', title: 'Activity (Muscle Tone)', scores: ['Limp', 'Some flexion', 'Active motion'] },
  { id: 'respiration', title: 'Respiration', scores: ['Absent', 'Weak/irregular', 'Strong cry'] },
]

const apgar1Total = computed(() => Object.values(apgar1).reduce((sum, v) => sum + (v ?? 0), 0))
const apgar5Total = computed(() => Object.values(apgar5).reduce((sum, v) => sum + (v ?? 0), 0))
const hasApgar1Scores = computed(() => Object.values(apgar1).some(v => v !== null))
const hasApgar5Scores = computed(() => Object.values(apgar5).some(v => v !== null))

function apgarClass(score) {
  if (score <= 3) return 'apgar-critical'
  if (score <= 6) return 'apgar-moderate'
  return 'apgar-normal'
}

function apgarInterpretation(score) {
  if (Object.values(apgar1).every(v => v === null)) return 'Score each category below'
  if (score <= 3) return 'Severely depressed — immediate resuscitation needed'
  if (score <= 6) return 'Moderately depressed — stimulation and oxygen'
  return 'Normal — routine care'
}

function exportPDF() {
  const checkedComps = complications.filter(c => c.checked).map(c => c.label)
  const contractions = contractionStore.contractions.value

  const apgarRow = (label, scores) => apgarItems.map(item => `
    <tr>
      <td>${item.title}</td>
      <td style="text-align:center;">${scores[item.id] ?? '—'}</td>
    </tr>
  `).join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Delivery Report — WCEMS</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #000; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 20px; margin-bottom: 2px; }
        h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 2px solid #000; padding-bottom: 4px; }
        .meta { font-size: 12px; color: #555; margin-bottom: 20px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .info-item { border: 1px solid #ccc; border-radius: 4px; padding: 8px 12px; }
        .info-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; }
        .info-value { font-size: 15px; font-weight: bold; margin-top: 2px; }
        .complications { margin-bottom: 16px; }
        .comp-tag { display: inline-block; background: #ffeeee; border: 1px solid #ffaaaa; border-radius: 4px; padding: 3px 8px; font-size: 12px; margin: 3px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
        th { background: #f0f0f0; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; }
        td { padding: 8px 10px; border-bottom: 1px solid #eee; }
        .score-total { font-size: 16px; font-weight: bold; padding: 10px; text-align: center; border-radius: 6px; margin: 8px 0; }
        .score-normal { background: #eeffee; }
        .score-moderate { background: #fff8ee; }
        .score-critical { background: #ffeeee; }
        .notes-box { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px; font-size: 13px; color: #333; min-height: 60px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Delivery Report</h1>
      <div class="meta">Waller County EMS &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</div>

      <h2>Delivery Information</h2>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Time of Birth</div>
          <div class="info-value">${form.birthTime || '—'} ${form.birthDate || ''}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Time Placenta Delivered</div>
          <div class="info-value">${form.placentaTime || '—'} ${form.placentaDate || ''}</div>
        </div>
      </div>
      <div class="section" v-if="form.birthTime && form.birthDate">
  <div class="section-title">APGAR STATUS</div>
  <div class="apgar-status-row">
    <div class="apgar-status-card" :class="{ 'status-due': apgar1Due && isPast(apgar1Due) }">
      <div class="status-label">APGAR 1 MIN</div>
      <div class="status-time">Due {{ apgar1Due }}</div>
      <div v-if="hasApgar1Scores" class="status-score" :class="apgarClass(apgar1Total)">
        {{ apgar1Total }}/10 — {{ apgarInterpretation(apgar1Total).split('—')[0].trim() }}
      </div>
      <div v-else class="status-pending">
        {{ isPast(apgar1Due) ? 'Ready to score' : 'Pending' }}
      </div>
    </div>
    <div class="apgar-status-card" :class="{ 'status-due': apgar5Due && isPast(apgar5Due) }">
      <div class="status-label">APGAR 5 MIN</div>
      <div class="status-time">Due {{ apgar5Due }}</div>
      <div v-if="hasApgar5Scores" class="status-score" :class="apgarClass(apgar5Total)">
        {{ apgar5Total }}/10 — {{ apgarInterpretation(apgar5Total).split('—')[0].trim() }}
      </div>
      <div v-else class="status-pending">
        {{ isPast(apgar5Due) ? 'Ready to score' : 'Pending' }}
      </div>
    </div>
  </div>
</div>
      ${checkedComps.length > 0 ? `
        <h2>Delivery Complications</h2>
        <div class="complications">
          ${checkedComps.map(c => `<span class="comp-tag">${c}</span>`).join('')}
        </div>
      ` : ''}

      <h2>APGAR Scores</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div>
          <div class="score-total ${apgar1Total.value <= 3 ? 'score-critical' : apgar1Total.value <= 6 ? 'score-moderate' : 'score-normal'}">
            1 Minute APGAR: ${apgar1Total.value}/10
          </div>
          <table>
            <tr><th>Category</th><th style="text-align:center;">Score</th></tr>
            ${apgarRow('1 min', apgar1)}
          </table>
        </div>
        <div>
          <div class="score-total ${apgar5Total.value <= 3 ? 'score-critical' : apgar5Total.value <= 6 ? 'score-moderate' : 'score-normal'}">
            5 Minute APGAR: ${apgar5Total.value}/10
          </div>
          <table>
            <tr><th>Category</th><th style="text-align:center;">Score</th></tr>
            ${apgarRow('5 min', apgar5)}
          </table>
        </div>
      </div>

      ${contractions.length > 0 ? `
        <h2>Contraction Log (${contractions.length} contractions)</h2>
        <table>
          <tr><th>#</th><th>Start Time</th><th>End Time</th><th>Duration</th></tr>
          ${contractions.map((c, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${new Date(c.start).toLocaleTimeString()}</td>
              <td>${c.end ? new Date(c.end).toLocaleTimeString() : '—'}</td>
              <td>${c.end ? Math.round((c.end - c.start) / 1000) + 's' : '—'}</td>
            </tr>
          `).join('')}
        </table>
      ` : ''}

      ${form.notes ? `
        <h2>Notes</h2>
        <div class="notes-box">${form.notes}</div>
      ` : ''}

    </body>
    </html>
  `

  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
}

function clearAll() {
  form.birthTime = ''
  form.birthDate = ''
  form.placentaTime = ''
  form.placentaDate = ''
  form.notes = ''
  complications.forEach(c => c.checked = false)
  Object.keys(apgar1).forEach(k => apgar1[k] = null)
  Object.keys(apgar5).forEach(k => apgar5[k] = null)
}
</script>

<style scoped>
.delivery-doc { display: flex; flex-direction: column; gap: 12px; }

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

.tab-content { display: flex; flex-direction: column; gap: 12px; }

.section {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #c9a84c;
}

.time-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.time-input {
  flex: 1;
  background: #0a1628;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
}

.date-input {
  flex: 1;
  background: #0a1628;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
}

.now-btn {
  background: rgba(201,168,76,0.15);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #c9a84c;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.now-btn:hover { background: rgba(201,168,76,0.25); }

.checklist { display: flex; flex-direction: column; gap: 4px; }

.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  cursor: pointer;
  transition: background 0.1s;
}

.check-item.checked { background: rgba(201,168,76,0.08); }

.check-box {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid rgba(201,168,76,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #0a1628;
  transition: all 0.15s;
}

.check-box.checked { background: #c9a84c; border-color: #c9a84c; }

.check-label { font-size: 13px; color: #fff; }

.notes-input {
  background: #0a1628;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  color: #fff;
  outline: none;
  font-family: 'Inter', sans-serif;
  resize: vertical;
  width: 100%;
}

.notes-input:focus { border-color: #c9a84c; }

.apgar-timers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.timer-card {
  background: #132240;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
  transition: all 0.2s;
}

.timer-card.active { border-color: rgba(220,50,50,0.4); background: rgba(220,50,50,0.08); }
.timer-card.complete { border-color: rgba(99,153,34,0.4); background: rgba(99,153,34,0.08); }

.timer-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.4);
  margin-bottom: 6px;
}

.timer-display {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
}

.timer-card.active .timer-display { color: #ff8080; }
.timer-card.complete .timer-display { color: #97c459; }

.timer-start-btn {
  background: rgba(201,168,76,0.15);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #c9a84c;
  cursor: pointer;
  width: 100%;
}

.timer-done {
  font-size: 11px;
  font-weight: 700;
  color: #97c459;
}

.apgar-section {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.apgar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.apgar-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.5);
}

.apgar-score {
  font-size: 20px;
  font-weight: 700;
}

.apgar-normal { color: #97c459; }
.apgar-moderate { color: #fac775; }
.apgar-critical { color: #ff8080; }

.apgar-interpretation {
  font-size: 11px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
}

.apgar-normal.apgar-interpretation { color: #97c459; background: rgba(99,153,34,0.1); }
.apgar-moderate.apgar-interpretation { color: #fac775; background: rgba(186,117,23,0.1); }
.apgar-critical.apgar-interpretation { color: #ff8080; background: rgba(220,50,50,0.1); }

.apgar-item { display: flex; flex-direction: column; gap: 6px; }

.apgar-item-title {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

.apgar-scores {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.apgar-score-btn {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 6px 4px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
}

.apgar-score-btn.selected {
  background: rgba(201,168,76,0.2);
  border-color: rgba(201,168,76,0.5);
}

.score-num {
  font-size: 16px;
  font-weight: 700;
  color: #c9a84c;
  margin-bottom: 3px;
}

.score-desc {
  font-size: 9px;
  color: rgba(255,255,255,0.5);
  line-height: 1.3;
}

.apgar-score-btn.selected .score-desc { color: rgba(255,255,255,0.8); }

.export-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(201,168,76,0.1);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #c9a84c;
  width: 100%;
  cursor: pointer;
  transition: all 0.15s;
}

.export-btn:hover { background: rgba(201,168,76,0.2); }
.apgar-status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.apgar-status-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s;
}

.apgar-status-card.status-due {
  border-color: rgba(201,168,76,0.4);
  background: rgba(201,168,76,0.06);
}

.status-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.4);
}

.status-time {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.status-score {
  font-size: 12px;
  font-weight: 600;
  margin-top: 2px;
}

.apgar-normal.status-score { color: #97c459; }
.apgar-moderate.status-score { color: #fac775; }
.apgar-critical.status-score { color: #ff8080; }

.status-pending {
  font-size: 11px;
  color: rgba(255,255,255,0.3);
}
.new-patient-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(220,50,50,0.08);
  border: 1px solid rgba(220,50,50,0.3);
  border-radius: 8px;
}

.new-patient-text { font-size: 12px; color: rgba(255,255,255,0.6); }

.clear-patient-btn {
  background: rgba(220,50,50,0.2);
  border: 1px solid rgba(220,50,50,0.4);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #ff8080;
  cursor: pointer;
  white-space: nowrap;
}
</style>