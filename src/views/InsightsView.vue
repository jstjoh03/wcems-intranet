<script setup lang="ts">
import { computed, ref } from 'vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import callVolume from '@/data/call-volume.json'
import { BarChart3 } from 'lucide-vue-next'

type Tab = 'trend' | 'units' | 'zones'
const tab = ref<Tab>('trend')

const summaries = [...callVolume.summaries].sort(
  (a, b) => new Date(a.reportMonth).getTime() - new Date(b.reportMonth).getTime(),
)

const months = computed(() => summaries.map((s) => s.reportMonth))
const selectedMonth = ref(months.value[months.value.length - 1])

const summary = computed(
  () => summaries.find((s) => s.reportMonth === selectedMonth.value) ?? summaries[summaries.length - 1],
)

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()

const units = computed(() =>
  callVolume.units
    .filter((u) => u.reportMonth === selectedMonth.value && u.runs > 0)
    .sort((a, b) => b.runs - a.runs),
)
const zones = computed(() =>
  callVolume.zones
    .filter((z) => z.reportMonth === selectedMonth.value && z.calls > 0)
    .sort((a, b) => b.calls - a.calls),
)

const maxRuns = computed(() => Math.max(1, ...units.value.map((u) => u.runs)))

// Donut math
const donut = computed(() => {
  const CX = 70
  const CY = 70
  const R = 60
  const total = zones.value.reduce((s, z) => s + z.calls, 0)
  let angle = -Math.PI / 2
  const slices = zones.value.map((z, i) => {
    const a = (z.calls / total) * 2 * Math.PI
    const x1 = CX + R * Math.cos(angle)
    const y1 = CY + R * Math.sin(angle)
    angle += a
    const x2 = CX + R * Math.cos(angle)
    const y2 = CY + R * Math.sin(angle)
    const large = a > Math.PI ? 1 : 0
    const colors = [
      'var(--color-brand-700)', 'var(--color-brand-500)', 'var(--color-brand-400)', 'var(--color-brand-300)',
      'var(--color-accent-600)', 'var(--color-accent-500)', 'var(--color-accent-400)',
      'var(--color-success-500)', 'oklch(0.55 0.15 200)', 'oklch(0.6 0.12 230)',
      'var(--color-trauma-2)', 'var(--color-trauma-1)', 'oklch(0.55 0.15 320)', 'var(--color-muted)',
      'oklch(0.6 0.05 260)', 'oklch(0.5 0.04 260)',
    ]
    return {
      d: `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`,
      color: colors[i % colors.length],
      zone: z,
    }
  })
  return { slices, total }
})

// Trend line
const trend = computed(() => {
  if (summaries.length < 2) return null
  const W = 720
  const H = 160
  const PAD_X = 32
  const PAD_Y = 24
  const max = Math.max(...summaries.map((s) => s.totalCalls))
  const min = Math.min(...summaries.map((s) => s.totalCalls)) * 0.85
  const range = max - min || 1
  const pts = summaries.map((s, i) => ({
    x: PAD_X + (i / (summaries.length - 1)) * (W - PAD_X * 2),
    y: PAD_Y + (1 - (s.totalCalls - min) / range) * (H - PAD_Y * 2),
    label: shortMonth(s.reportMonth),
    calls: s.totalCalls,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${H - PAD_Y} L${pts[0].x},${H - PAD_Y} Z`
  return { W, H, PAD_Y, pts, linePath, areaPath }
})

function secsToMMSS(secs: number) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="insights">
    <header class="insights__header">
      <div class="flex items-center gap-2">
        <BarChart3 :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display insights__title">Call Volume</h1>
      </div>
      <p class="insights__sub">
        Monthly run totals, per-unit workload, and scene-zone breakdowns. Source: monthly run report
        from the agency.
      </p>
    </header>

    <!-- Month picker -->
    <div class="insights__month-row">
      <Eyebrow>Month</Eyebrow>
      <select v-model="selectedMonth" class="insights__month-select">
        <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
      </select>
    </div>

    <!-- Metric cards -->
    <div class="insights__metrics">
      <AppCard class="insights__metric">
        <div class="insights__metric-label">Total Calls</div>
        <div class="insights__metric-value display">{{ summary.totalCalls }}</div>
      </AppCard>
      <AppCard class="insights__metric">
        <div class="insights__metric-label">Patients</div>
        <div class="insights__metric-value display">{{ summary.totalPatients }}</div>
      </AppCard>
      <AppCard class="insights__metric">
        <div class="insights__metric-label">Transports</div>
        <div class="insights__metric-value display">{{ summary.totalTransports }}</div>
      </AppCard>
      <AppCard class="insights__metric">
        <div class="insights__metric-label">Avg Response</div>
        <div class="insights__metric-value display font-mono">
          {{ secsToMMSS(summary.avgResponseSeconds) }}
        </div>
      </AppCard>
    </div>

    <!-- Tabs -->
    <div class="insights__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'trend'"
        class="insights__tab"
        :class="{ 'insights__tab--on': tab === 'trend' }"
        @click="tab = 'trend'"
      >
        Trend
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'units'"
        class="insights__tab"
        :class="{ 'insights__tab--on': tab === 'units' }"
        @click="tab = 'units'"
      >
        By Unit
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'zones'"
        class="insights__tab"
        :class="{ 'insights__tab--on': tab === 'zones' }"
        @click="tab = 'zones'"
      >
        By Zone
      </button>
    </div>

    <!-- Tab content -->
    <AppCard class="insights__tab-content">
      <!-- TREND -->
      <div v-if="tab === 'trend' && trend">
        <Eyebrow class="mb-3">Monthly call volume trend</Eyebrow>
        <svg :viewBox="`0 0 ${trend.W} ${trend.H}`" class="insights__trend-svg">
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-brand-600)" stop-opacity="0.18" />
              <stop offset="100%" stop-color="var(--color-brand-600)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="trend.areaPath" fill="url(#trendGrad)" />
          <path
            :d="trend.linePath"
            fill="none"
            stroke="var(--color-brand-600)"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <g v-for="(p, i) in trend.pts" :key="i">
            <circle :cx="p.x" :cy="p.y" r="4" fill="var(--color-brand-600)" />
            <text
              :x="p.x"
              :y="trend.H - 6"
              text-anchor="middle"
              font-size="10"
              font-family="var(--font-mono)"
              fill="var(--color-muted)"
            >
              {{ p.label }}
            </text>
            <text
              :x="p.x"
              :y="p.y - 10"
              text-anchor="middle"
              font-size="10"
              font-family="var(--font-mono)"
              fill="var(--color-brand-700)"
              font-weight="600"
            >
              {{ p.calls }}
            </text>
          </g>
        </svg>
      </div>

      <!-- BY UNIT -->
      <div v-if="tab === 'units'">
        <Eyebrow class="mb-3">Calls by unit · {{ monthLabel(selectedMonth) }}</Eyebrow>
        <div class="insights__units">
          <div v-for="u in units" :key="u.unitName" class="insights__unit-row">
            <div class="insights__unit-head">
              <span class="display insights__unit-name">{{ u.unitName }}</span>
              <span class="insights__unit-meta">
                <span v-if="u.avgResponseSeconds > 0" class="font-mono">
                  Avg {{ secsToMMSS(u.avgResponseSeconds) }} ·
                </span>
                <span class="font-mono insights__unit-runs">
                  {{ u.runs }} runs ({{ u.percentage.toFixed(2) }}%)
                </span>
              </span>
            </div>
            <div class="insights__unit-bar-track">
              <div
                class="insights__unit-bar"
                :style="{ width: `${(u.runs / maxRuns) * 100}%` }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- BY ZONE -->
      <div v-if="tab === 'zones'">
        <Eyebrow class="mb-3">Calls by scene zone · {{ monthLabel(selectedMonth) }}</Eyebrow>
        <div class="insights__zones">
          <div class="insights__zone-donut">
            <svg viewBox="0 0 140 140">
              <path
                v-for="(s, i) in donut.slices"
                :key="i"
                :d="s.d"
                :fill="s.color"
                stroke="white"
                stroke-width="1.2"
              />
              <circle cx="70" cy="70" r="34" fill="var(--color-surface)" />
              <text
                x="70"
                y="66"
                text-anchor="middle"
                font-family="var(--font-display)"
                font-size="20"
                fill="var(--color-brand-700)"
              >
                {{ donut.total }}
              </text>
              <text
                x="70"
                y="80"
                text-anchor="middle"
                font-family="var(--font-mono)"
                font-size="9"
                font-weight="600"
                letter-spacing="0.08em"
                fill="var(--color-muted)"
              >
                TOTAL
              </text>
            </svg>
          </div>
          <ul class="insights__zone-legend">
            <li v-for="(s, i) in donut.slices" :key="i" class="insights__zone-li">
              <span class="insights__zone-swatch" :style="{ background: s.color }" />
              <span class="insights__zone-name">{{ s.zone.zoneName }}</span>
              <span class="insights__zone-num font-mono">
                {{ s.zone.calls }} ({{ s.zone.percentage.toFixed(1) }}%)
              </span>
            </li>
          </ul>
        </div>
      </div>
    </AppCard>
  </div>
</template>

<style scoped>
.insights {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .insights {
    padding: 40px 40px 64px;
  }
}

.insights__title {
  font-size: 32px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .insights__title {
    font-size: 40px;
  }
}
.insights__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}

.insights__month-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0 16px;
}
.insights__month-select {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  cursor: pointer;
}

.insights__metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}
@media (min-width: 768px) {
  .insights__metrics {
    grid-template-columns: repeat(4, 1fr);
  }
}
.insights__metric {
  padding: 14px 16px;
}
.insights__metric-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.insights__metric-value {
  font-size: 28px;
  letter-spacing: -0.02em;
  color: var(--color-brand-700);
  line-height: 1;
}

.insights__tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  margin-bottom: 16px;
  overflow-x: auto;
}
.insights__tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink-soft);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  flex: 1;
  min-width: 80px;
  transition: all 120ms var(--ease-out);
}
.insights__tab:hover {
  color: var(--color-ink);
}
.insights__tab--on {
  background: var(--color-surface);
  color: var(--color-brand-700);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.insights__tab-content {
  padding: 18px;
}

.insights__trend-svg {
  width: 100%;
  height: auto;
}

.insights__units {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.insights__unit-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.insights__unit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.insights__unit-name {
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.insights__unit-meta {
  font-size: 11.5px;
  color: var(--color-muted);
}
.insights__unit-runs {
  color: var(--color-brand-700);
  font-weight: 600;
}
.insights__unit-bar-track {
  height: 8px;
  border-radius: 999px;
  background: oklch(0.96 0.01 250);
  overflow: hidden;
}
.insights__unit-bar {
  height: 100%;
  background: var(--color-brand-600);
  border-radius: 999px;
  transition: width 600ms var(--ease-out);
}

.insights__zones {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  align-items: start;
}
@media (min-width: 640px) {
  .insights__zones {
    grid-template-columns: 180px 1fr;
  }
}
.insights__zone-donut svg {
  width: 100%;
  max-width: 180px;
  height: auto;
  margin: 0 auto;
  display: block;
}
.insights__zone-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px 18px;
}
@media (min-width: 480px) {
  .insights__zone-legend {
    grid-template-columns: 1fr 1fr;
  }
}
.insights__zone-li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.insights__zone-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.insights__zone-name {
  color: var(--color-ink);
  font-weight: 500;
  min-width: 0;
  flex: 1;
}
.insights__zone-num {
  color: var(--color-muted);
  font-size: 11px;
  flex-shrink: 0;
}
</style>
