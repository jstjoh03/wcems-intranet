<template>
  <div class="tracker">

    <!-- Live timer during contraction -->
    <div v-if="isActive" class="live-timer">
      <div class="live-label">CONTRACTION IN PROGRESS</div>
      <div class="live-seconds">{{ liveSeconds }}s</div>
    </div>

    <!-- Summary -->
    <div class="summary-grid" v-if="contractions.length > 0">
      <div class="summary-card">
        <div class="summary-label">LAST DURATION</div>
        <div class="summary-value">{{ lastDuration }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">FREQUENCY</div>
        <div class="summary-value">{{ lastFrequency }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">AVG DURATION</div>
        <div class="summary-value">{{ avgDuration }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">CONTRACTIONS</div>
        <div class="summary-value">{{ contractions.length }}</div>
      </div>
    </div>

    <!-- Clinical indicator -->
    <div v-if="contractions.length >= 2" class="clinical-indicator" :class="clinicalPattern.class">
      <div class="clinical-icon">{{ clinicalPattern.icon }}</div>
      <div>
        <div class="clinical-title">{{ clinicalPattern.title }}</div>
        <div class="clinical-sub">{{ clinicalPattern.sub }}</div>
      </div>
    </div>

    <!-- Main button -->
    <button
      class="main-btn"
      :class="{ active: isActive }"
      @click="toggleContraction"
    >
      <div class="btn-icon">
        <svg v-if="!isActive" viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;">
          <circle cx="12" cy="12" r="10"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" style="width:32px;height:32px;">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg>
      </div>
      <div class="btn-label">{{ isActive ? 'TAP TO END CONTRACTION' : 'TAP TO START CONTRACTION' }}</div>
    </button>

    <!-- Log -->
    <div v-if="contractions.length > 0" class="log-section">
      <div class="log-title">CONTRACTION LOG</div>
      <div class="log-table">
        <div class="log-header">
          <span>#</span>
          <span>Start</span>
          <span>Duration</span>
          <span>Frequency</span>
        </div>
        <div
          v-for="(c, i) in [...contractions].reverse()"
          :key="i"
          class="log-row"
          :class="{ 'active-row': i === 0 && isActive.value }"
        >
          <span class="log-num">{{ contractions.length - i }}</span>
          <span>{{ formatTime(c.start) }}</span>
          <span>{{ c.end ? formatDuration(c.end - c.start) : '—' }}</span>
          <span>{{ i === contractions.length - 1 ? '—' : formatDuration(c.start - contractions[contractions.length - i - 2].start) }}</span>
        </div>
      </div>
    </div>
    <button v-if="contractions.length > 0" class="export-btn" @click="exportPDF">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
  Export Log as PDF
</button>
    <button v-if="contractions.length > 0" class="clear-btn" @click="clearAll">Clear All</button>

  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { contractionStore } from '@/stores/protocols/contractionStore'

const { contractions, isActive, currentStart } = contractionStore

let timer = null
const liveSeconds = ref(0)

function toggleContraction() {
  const now = Date.now()
  if (!isActive.value) {
    currentStart.value = now
    isActive.value = true
    liveSeconds.value = 0
    timer = setInterval(() => {
      liveSeconds.value = Math.floor((Date.now() - currentStart.value) / 1000)
    }, 1000)
  } else {
    clearInterval(timer)
    contractions.value.push({ start: currentStart.value, end: now })
    isActive.value = false
    liveSeconds.value = 0
    currentStart.value = null
  }
}

function clearAll() {
  clearInterval(timer)
  contractions.value = []
  isActive.value = false
  liveSeconds.value = 0
  currentStart.value = null
}

onUnmounted(() => clearInterval(timer))

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function exportPDF() {
  const c = contractions.value
  if (c.length === 0) return

  const rows = [...c].reverse().map((contraction, i) => {
    const originalIndex = c.length - 1 - i
    const duration = contraction.end ? formatDuration(contraction.end - contraction.start) : '—'
    const frequency = originalIndex === 0 ? '—' : formatDuration(contraction.start - c[originalIndex - 1].start)
    return `
      <tr>
        <td>${c.length - i}</td>
        <td>${formatTime(contraction.start)}</td>
        <td>${contraction.end ? formatTime(contraction.end) : '—'}</td>
        <td>${duration}</td>
        <td>${frequency}</td>
      </tr>
    `
  }).join('')

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Contraction Log — WCEMS</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #000; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #555; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .summary-card { border: 1px solid #ccc; border-radius: 6px; padding: 10px; }
        .summary-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
        .summary-value { font-size: 18px; font-weight: bold; }
        .pattern { padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; }
        .pattern-active { background: #fff0f0; border: 1px solid #ffaaaa; }
        .pattern-early { background: #fff8e8; border: 1px solid #ffd080; }
        .pattern-irregular { background: #f5f5f5; border: 1px solid #ccc; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f0f0f0; padding: 8px 10px; text-align: left; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
        td { padding: 8px 10px; border-bottom: 1px solid #eee; }
        tr:last-child td { border-bottom: none; }
        @media print { body { padding: 0; } }

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

.export-btn:hover {
  background: rgba(201,168,76,0.2);
  border-color: rgba(201,168,76,0.5);
}
      </style>
    </head>
    <body>
      <h1>Contraction Log</h1>
      <div class="meta">
        Waller County EMS &nbsp;|&nbsp;
        Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp;
        Total contractions: ${c.length}
      </div>

      <div class="summary">
        <div class="summary-card">
          <div class="summary-label">Last Duration</div>
          <div class="summary-value">${lastDuration.value}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Last Frequency</div>
          <div class="summary-value">${lastFrequency.value}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Avg Duration</div>
          <div class="summary-value">${avgDuration.value}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Total</div>
          <div class="summary-value">${c.length}</div>
        </div>
      </div>

      ${contractions.value.length >= 2 ? `
        <div class="pattern ${clinicalPattern.value.class}">
          <strong>${clinicalPattern.value.title}</strong> — ${clinicalPattern.value.sub}
        </div>
      ` : ''}

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Start Time</th>
            <th>End Time</th>
            <th>Duration</th>
            <th>Frequency</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </body>
    </html>
  `

  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 500)
}

const lastDuration = computed(() => {
  const c = contractions.value
  if (c.length === 0) return '—'
  const last = c[c.length - 1]
  if (!last.end) return '—'
  return formatDuration(last.end - last.start)
})

const lastFrequency = computed(() => {
  const c = contractions.value
  if (c.length < 2) return '—'
  const diff = c[c.length - 1].start - c[c.length - 2].start
  return formatDuration(diff)
})

const avgDuration = computed(() => {
  const c = contractions.value.filter(x => x.end)
  if (c.length === 0) return '—'
  const avg = c.reduce((sum, x) => sum + (x.end - x.start), 0) / c.length
  return formatDuration(avg)
})

const avgFrequencyMs = computed(() => {
  const c = contractions.value
  if (c.length < 2) return null
  const diffs = []
  for (let i = 1; i < c.length; i++) diffs.push(c[i].start - c[i - 1].start)
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
})

const avgDurationMs = computed(() => {
  const c = contractions.value.filter(x => x.end)
  if (c.length === 0) return null
  return c.reduce((sum, x) => sum + (x.end - x.start), 0) / c.length
})

const clinicalPattern = computed(() => {
  const freq = avgFrequencyMs.value
  const dur = avgDurationMs.value
  if (!freq || !dur) return { title: '', sub: '', icon: '', class: '' }

  const freqMin = freq / 60000
  const durSec = dur / 1000

  if (durSec >= 60 && freqMin <= 5) {
    return {
      title: 'Active Labor Pattern',
      sub: `Avg ${Math.round(durSec)}s duration · every ${freqMin.toFixed(1)} min`,
      icon: '!',
      class: 'pattern-active'
    }
  }
  if (durSec >= 30 && freqMin <= 10) {
    return {
      title: 'Early Labor Pattern',
      sub: `Avg ${Math.round(durSec)}s duration · every ${freqMin.toFixed(1)} min`,
      icon: '○',
      class: 'pattern-early'
    }
  }
  return {
    title: 'Irregular Pattern',
    sub: `Avg ${Math.round(durSec)}s duration · every ${freqMin.toFixed(1)} min`,
    icon: '○',
    class: 'pattern-irregular'
  }
})
</script>

<style scoped>
.tracker { display: flex; flex-direction: column; gap: 12px; }

.live-timer {
  text-align: center;
  padding: 14px;
  background: rgba(220,50,50,0.12);
  border: 1px solid rgba(220,50,50,0.4);
  border-radius: 10px;
}

.live-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #ff8080;
  margin-bottom: 4px;
}

.live-seconds {
  font-size: 42px;
  font-weight: 700;
  color: #ff8080;
  line-height: 1;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.summary-card {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 8px;
  padding: 10px 12px;
}

.summary-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255,255,255,0.4);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 18px;
  font-weight: 700;
  color: #c9a84c;
}

.clinical-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid;
}

.pattern-active { background: rgba(220,50,50,0.1); border-color: rgba(220,50,50,0.4); }
.pattern-early { background: rgba(186,117,23,0.1); border-color: rgba(186,117,23,0.4); }
.pattern-irregular { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }

.clinical-icon {
  font-size: 18px;
  font-weight: 700;
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.08);
  color: #fff;
  flex-shrink: 0;
}

.pattern-active .clinical-icon { background: rgba(220,50,50,0.3); color: #ff8080; }
.pattern-early .clinical-icon { background: rgba(186,117,23,0.3); color: #fac775; }

.clinical-title { font-size: 13px; font-weight: 700; color: #fff; }
.pattern-active .clinical-title { color: #ff8080; }
.pattern-early .clinical-title { color: #fac775; }
.clinical-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }

.main-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  border-radius: 16px;
  background: rgba(99,153,34,0.15);
  border: 2px solid rgba(99,153,34,0.5);
  color: #97c459;
  cursor: pointer;
  transition: all 0.15s;
  width: 100%;
}

.main-btn.active {
  background: rgba(220,50,50,0.15);
  border-color: rgba(220,50,50,0.5);
  color: #ff8080;
}

.btn-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.log-section { display: flex; flex-direction: column; gap: 8px; }

.log-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.4);
}

.log-table {
  background: #132240;
  border: 1px solid rgba(201,168,76,0.15);
  border-radius: 10px;
  overflow: hidden;
}

.log-header {
  display: grid;
  grid-template-columns: 24px 1fr 70px 70px;
  gap: 8px;
  padding: 8px 12px;
  background: #1e3a5f;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.4);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.log-row {
  display: grid;
  grid-template-columns: 24px 1fr 70px 70px;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  font-size: 11px;
  color: #fff;
  transition: background 0.1s;
}

.log-row:last-child { border-bottom: none; }
.active-row { background: rgba(220,50,50,0.06); }

.log-num {
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
  transition: all 0.15s;
}

.clear-btn:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.7); }
</style>