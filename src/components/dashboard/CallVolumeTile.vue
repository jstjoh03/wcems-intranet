<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useCallVolume } from '@/composables/useCallVolume'

const { summaries: rawSummaries } = useCallVolume()

/* Live data from Supabase (dev-stub falls back to the JSON fixture).
   Sorted ascending so the last element is the most recent month. */
const summaries = computed(() =>
  [...rawSummaries.value].sort(
    (a, b) => new Date(a.reportMonth).getTime() - new Date(b.reportMonth).getTime(),
  ),
)

const latest = computed(() => summaries.value[summaries.value.length - 1] ?? null)
const prev = computed(() =>
  summaries.value.length > 1 ? summaries.value[summaries.value.length - 2] : null,
)

const monthLabel = computed(() => {
  if (!latest.value) return ''
  const d = new Date(latest.value.reportMonth)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

const delta = computed(() => {
  if (!prev.value || !latest.value) return null
  const d = latest.value.totalCalls - prev.value.totalCalls
  const pct = (d / prev.value.totalCalls) * 100
  return { d, pct }
})

const sparkPath = computed(() => {
  const list = summaries.value
  if (list.length < 2) return ''
  const W = 140
  const H = 40
  const PAD = 4
  const max = Math.max(...list.map((s) => s.totalCalls))
  const min = Math.min(...list.map((s) => s.totalCalls))
  const range = max - min || 1
  const pts = list.map((s, i) => {
    const x = PAD + (i / (list.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (s.totalCalls - min) / range) * (H - PAD * 2)
    return [x, y] as const
  })
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
})

const sparkArea = computed(() => {
  if (!sparkPath.value) return ''
  const W = 140
  const H = 40
  const PAD = 4
  const lastX = W - PAD
  const firstX = PAD
  return `${sparkPath.value} L${lastX},${H - PAD} L${firstX},${H - PAD} Z`
})

function secsToMMSS(secs: number) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <RouterLink to="/insights" class="cv-tile-link">
    <AppCard interactive class="cv-tile">
      <div class="cv-tile__head">
        <Eyebrow>Call Volume<template v-if="monthLabel"> · {{ monthLabel }}</template></Eyebrow>
        <ChevronRight :size="14" class="cv-tile__chev" />
      </div>

      <div v-if="!latest" class="cv-tile__empty">Loading…</div>

      <template v-else>
      <div class="cv-tile__metric-row">
        <div class="cv-tile__big">
          <span class="display cv-tile__big-num">{{ latest.totalCalls }}</span>
          <span class="cv-tile__big-label">total calls</span>
        </div>

        <svg
          v-if="sparkPath"
          viewBox="0 0 140 40"
          class="cv-tile__spark"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="cv-spark-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-brand-600)" stop-opacity="0.2" />
              <stop offset="100%" stop-color="var(--color-brand-600)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="sparkArea" fill="url(#cv-spark-grad)" />
          <path
            :d="sparkPath"
            fill="none"
            stroke="var(--color-brand-600)"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <div class="cv-tile__sub-row">
        <div class="cv-tile__sub">
          <span class="cv-tile__sub-num font-mono">{{ latest.totalPatients }}</span>
          <span class="cv-tile__sub-label">patients</span>
        </div>
        <div class="cv-tile__sub">
          <span class="cv-tile__sub-num font-mono">{{ latest.totalTransports }}</span>
          <span class="cv-tile__sub-label">transports</span>
        </div>
        <div class="cv-tile__sub">
          <span class="cv-tile__sub-num font-mono">{{ secsToMMSS(latest.avgResponseSeconds) }}</span>
          <span class="cv-tile__sub-label">avg response</span>
        </div>
      </div>

      <div v-if="delta" class="cv-tile__delta">
        <span :class="delta.d >= 0 ? 'cv-tile__delta--up' : 'cv-tile__delta--down'">
          {{ delta.d >= 0 ? '+' : '' }}{{ delta.d }} vs. {{ prev && new Date(prev.reportMonth).toLocaleDateString('en-US', { month: 'short' }) }}
        </span>
        ({{ delta.pct >= 0 ? '+' : '' }}{{ delta.pct.toFixed(1) }}%)
      </div>
      </template>
    </AppCard>
  </RouterLink>
</template>

<style scoped>
.cv-tile-link {
  text-decoration: none;
  display: block;
}
.cv-tile {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cv-tile__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cv-tile__chev {
  color: var(--color-muted);
}

.cv-tile__empty {
  font-size: 12px;
  color: var(--color-muted);
}

.cv-tile__metric-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.cv-tile__big {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.cv-tile__big-num {
  font-size: 44px;
  letter-spacing: -0.02em;
  color: var(--color-brand-600);
  font-variant-numeric: tabular-nums;
}
.cv-tile__big-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
}
.cv-tile__spark {
  width: 140px;
  height: 40px;
  flex-shrink: 0;
}

.cv-tile__sub-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-line-soft);
}
.cv-tile__sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cv-tile__sub-num {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
}
.cv-tile__sub-label {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.cv-tile__delta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
}
.cv-tile__delta--up {
  color: var(--color-success-500);
  font-weight: 600;
}
.cv-tile__delta--down {
  color: var(--color-danger-500);
  font-weight: 600;
}
</style>
