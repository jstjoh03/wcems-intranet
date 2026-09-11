<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BarChart3, RefreshCw } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useUsageMetrics, type DailyPoint } from '@/composables/useUsageMetrics'

const auth = useAuthStore()
const {
  overview,
  daily,
  hourly,
  engagement,
  sections,
  weekCompare,
  topRoutes,
  topUsers,
  neverSignedIn,
  loading,
  error,
  reachPct,
  load,
} = useUsageMetrics()

onMounted(() => {
  if (auth.isAdmin) void load()
})

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  const hour = Math.floor(min / 60)
  const day = Math.floor(hour / 24)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hour < 24) return `${hour}h ago`
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Daily series, gap-filled to a continuous 30-day axis ─────────── */

function centralDateISO(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
    .format(new Date(Date.now() - offsetDays * 86400000))
  return parts // en-CA gives YYYY-MM-DD
}

const dailyFilled = computed<DailyPoint[]>(() => {
  const byDay = new Map(daily.value.map((d) => [d.day, d]))
  const out: DailyPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const day = centralDateISO(i)
    out.push(byDay.get(day) ?? { day, views: 0, unique_users: 0 })
  }
  return out
})

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
/* ── Bar-chart geometry (shared by the three SVG charts) ──────────── */

const CHART_W = 600
const CHART_H = 150
const PAD_L = 30
const PAD_B = 18

interface Bar {
  x: number
  y: number
  w: number
  h: number
  label: string
  value: number
  sub?: string
  key: string
}

function buildBars(
  values: Array<{ key: string; value: number; label: string; sub?: string }>,
): { bars: Bar[]; max: number; ticks: number[] } {
  const max = Math.max(1, ...values.map((v) => v.value))
  /* A round-ish tick ceiling so gridline labels are honest numbers. */
  const pow = Math.pow(10, Math.max(0, String(Math.ceil(max)).length - 1))
  const top = Math.ceil(max / pow) * pow
  const innerW = CHART_W - PAD_L - 4
  const innerH = CHART_H - PAD_B - 8
  const step = innerW / values.length
  const barW = Math.max(2, step - 2)
  const bars = values.map((v, i) => {
    const h = Math.max(v.value > 0 ? 2 : 0, (v.value / top) * innerH)
    return {
      x: PAD_L + i * step + (step - barW) / 2,
      y: 8 + innerH - h,
      w: barW,
      h,
      label: v.label,
      value: v.value,
      sub: v.sub,
      key: v.key,
    }
  })
  return { bars, max: top, ticks: [top, top / 2] }
}

const dauChart = computed(() =>
  buildBars(
    dailyFilled.value.map((d) => ({
      key: d.day,
      value: d.unique_users,
      label: `${dayLabel(d.day)} — ${d.unique_users} ${d.unique_users === 1 ? 'person' : 'people'}`,
      sub: `${d.views} views`,
    })),
  ),
)
const viewsChart = computed(() =>
  buildBars(
    dailyFilled.value.map((d) => ({
      key: d.day,
      value: d.views,
      label: `${dayLabel(d.day)} — ${d.views} views`,
      sub: `${d.unique_users} ${d.unique_users === 1 ? 'person' : 'people'}`,
    })),
  ),
)

function hourLabel(h: number): string {
  if (h === 0) return '12a'
  if (h < 12) return `${h}a`
  if (h === 12) return '12p'
  return `${h - 12}p`
}
const hourChart = computed(() => {
  const byHour = new Map(hourly.value.map((h) => [h.hour, h.views]))
  return buildBars(
    Array.from({ length: 24 }, (_, h) => ({
      key: String(h),
      value: byHour.get(h) ?? 0,
      label: `${hourLabel(h)} — ${byHour.get(h) ?? 0} views`,
    })),
  )
})
const peakHour = computed(() => {
  let best = -1
  let bestV = -1
  for (const h of hourly.value) if (h.views > bestV) { bestV = h.views; best = h.hour }
  return best
})

/* Every-nth x labels so 30 days / 24 hours don't collide. */
function xLabelEvery(i: number, n: number, every: number): boolean {
  /* The last point always gets a label; a modulo label too close to it
     is dropped so the two never collide. */
  if (i === n - 1) return true
  return i % every === 0 && n - 1 - i >= Math.ceil(every / 2)
}

/* ── Hover tooltip (one per chart card) ───────────────────────────── */
const tip = ref<{ chart: string; x: number; y: number; text: string; sub?: string } | null>(null)
function showTip(chart: string, b: Bar, evt: MouseEvent) {
  const host = (evt.currentTarget as SVGElement).closest('.usage__chartwrap') as HTMLElement | null
  if (!host) return
  const rect = host.getBoundingClientRect()
  tip.value = {
    chart,
    x: Math.min(rect.width - 130, Math.max(6, evt.clientX - rect.left + 10)),
    y: Math.max(4, evt.clientY - rect.top - 34),
    text: b.label,
    sub: b.sub,
  }
}
function hideTip() {
  tip.value = null
}

/* ── Engagement buckets ───────────────────────────────────────────── */
const buckets = computed(() => {
  const b = { power: 0, regular: 0, occasional: 0, dormant: 0, never: 0 }
  const dormantNames: string[] = []
  for (const r of engagement.value) {
    if (!r.ever_signed_in) b.never++
    else if (r.days_active >= 15) b.power++
    else if (r.days_active >= 5) b.regular++
    else if (r.days_active >= 1) b.occasional++
    else {
      b.dormant++
      dormantNames.push(r.full_name)
    }
  }
  const rows = [
    { label: 'Power users', hint: '15+ days this month', n: b.power },
    { label: 'Regulars', hint: '5–14 days', n: b.regular },
    { label: 'Occasional', hint: '1–4 days', n: b.occasional },
    { label: 'Dormant', hint: 'signed in before, quiet this month', n: b.dormant },
    { label: 'Never signed in', hint: 'no account link yet', n: b.never },
  ]
  const max = Math.max(1, ...rows.map((r) => r.n))
  return { rows, max, dormantNames: dormantNames.sort() }
})
const showDormant = ref(false)

const sectionMax = computed(() => Math.max(1, ...sections.value.map((s) => s.views)))
</script>

<template>
  <div class="usage">
    <header class="usage__header">
      <div class="flex items-center gap-2">
        <BarChart3 :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display usage__title">Usage</h1>
      </div>
      <p class="usage__sub">
        Real engagement — logged on every in-app route change, bucketed in Central time.
        Charts cover the last 30 days.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="usage__gate">Admin only.</div>

    <template v-else>
      <div class="usage__toolbar">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="load">
          <RefreshCw :size="14" :stroke-width="2" />
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>

      <div v-if="error" class="usage__error">{{ error }}</div>

      <!-- OVERVIEW STRIP -->
      <div v-if="overview" class="usage__metrics">
        <AppCard class="usage__metric">
          <Eyebrow>Roster</Eyebrow>
          <div class="usage__num">{{ overview.roster }}</div>
          <div class="usage__hint">active employees</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Ever signed in</Eyebrow>
          <div class="usage__num">{{ overview.everSignedIn }}</div>
          <div class="usage__hint">{{ reachPct }}% of roster</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 30 days</Eyebrow>
          <div class="usage__num">{{ overview.active30d }}</div>
          <div class="usage__hint">opened the app this month</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 7 days</Eyebrow>
          <div class="usage__num">{{ overview.active7d }}</div>
          <div class="usage__hint">opened the app this week</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 24 hours</Eyebrow>
          <div class="usage__num">{{ overview.active24h }}</div>
          <div class="usage__hint">opened the app today</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Views · 7 days</Eyebrow>
          <div class="usage__num">{{ weekCompare ? weekCompare.views : '—' }}</div>
          <div class="usage__hint">
            <template v-if="weekCompare && weekCompare.viewsDeltaPct !== null">
              <span :class="weekCompare.viewsDeltaPct >= 0 ? 'usage__up' : 'usage__down'">
                {{ weekCompare.viewsDeltaPct >= 0 ? '▲' : '▼' }} {{ Math.abs(weekCompare.viewsDeltaPct) }}%
              </span>
              vs prior week
            </template>
            <template v-else>page views this week</template>
          </div>
        </AppCard>
      </div>

      <!-- DAILY CHARTS -->
      <div class="usage__grid2">
        <AppCard class="usage__panel">
          <Eyebrow class="mb-2">People per day · last 30 days</Eyebrow>
          <div class="usage__chartwrap" @mouseleave="hideTip">
            <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="usage__chart" role="img" aria-label="Unique people using the portal per day, last 30 days">
              <g v-for="t in dauChart.ticks" :key="t">
                <line :x1="PAD_L" :x2="CHART_W - 4" :y1="8 + (1 - t / dauChart.max) * (CHART_H - PAD_B - 8)" :y2="8 + (1 - t / dauChart.max) * (CHART_H - PAD_B - 8)" class="usage__grid" />
                <text :x="PAD_L - 5" :y="11 + (1 - t / dauChart.max) * (CHART_H - PAD_B - 8)" class="usage__tick" text-anchor="end">{{ t }}</text>
              </g>
              <line :x1="PAD_L" :x2="CHART_W - 4" :y1="CHART_H - PAD_B" :y2="CHART_H - PAD_B" class="usage__axis" />
              <rect
                v-for="b in dauChart.bars"
                :key="b.key"
                :x="b.x" :y="b.y" :width="b.w" :height="b.h"
                rx="2"
                class="usage__bar"
                @mousemove="showTip('dau', b, $event)"
              />
              <text
                v-for="(b, i) in dauChart.bars"
                :key="`l-${b.key}`"
                v-show="xLabelEvery(i, dauChart.bars.length, 7)"
                :x="b.x + b.w / 2" :y="CHART_H - 5"
                class="usage__tick" text-anchor="middle"
              >{{ dayLabel(b.key) }}</text>
            </svg>
            <div v-if="tip && tip.chart === 'dau'" class="usage__tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
              {{ tip.text }}<span v-if="tip.sub" class="usage__tip-sub">{{ tip.sub }}</span>
            </div>
          </div>
        </AppCard>

        <AppCard class="usage__panel">
          <Eyebrow class="mb-2">Page views per day · last 30 days</Eyebrow>
          <div class="usage__chartwrap" @mouseleave="hideTip">
            <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="usage__chart" role="img" aria-label="Page views per day, last 30 days">
              <g v-for="t in viewsChart.ticks" :key="t">
                <line :x1="PAD_L" :x2="CHART_W - 4" :y1="8 + (1 - t / viewsChart.max) * (CHART_H - PAD_B - 8)" :y2="8 + (1 - t / viewsChart.max) * (CHART_H - PAD_B - 8)" class="usage__grid" />
                <text :x="PAD_L - 5" :y="11 + (1 - t / viewsChart.max) * (CHART_H - PAD_B - 8)" class="usage__tick" text-anchor="end">{{ t }}</text>
              </g>
              <line :x1="PAD_L" :x2="CHART_W - 4" :y1="CHART_H - PAD_B" :y2="CHART_H - PAD_B" class="usage__axis" />
              <rect
                v-for="b in viewsChart.bars"
                :key="b.key"
                :x="b.x" :y="b.y" :width="b.w" :height="b.h"
                rx="2"
                class="usage__bar usage__bar--gold"
                @mousemove="showTip('views', b, $event)"
              />
              <text
                v-for="(b, i) in viewsChart.bars"
                :key="`l-${b.key}`"
                v-show="xLabelEvery(i, viewsChart.bars.length, 7)"
                :x="b.x + b.w / 2" :y="CHART_H - 5"
                class="usage__tick" text-anchor="middle"
              >{{ dayLabel(b.key) }}</text>
            </svg>
            <div v-if="tip && tip.chart === 'views'" class="usage__tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
              {{ tip.text }}<span v-if="tip.sub" class="usage__tip-sub">{{ tip.sub }}</span>
            </div>
          </div>
        </AppCard>
      </div>

      <!-- HOUR OF DAY + ENGAGEMENT -->
      <div class="usage__grid2">
        <AppCard class="usage__panel">
          <Eyebrow class="mb-2">Time of day · Central</Eyebrow>
          <div class="usage__chartwrap" @mouseleave="hideTip">
            <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="usage__chart" role="img" aria-label="Portal views by hour of day">
              <line :x1="PAD_L" :x2="CHART_W - 4" :y1="CHART_H - PAD_B" :y2="CHART_H - PAD_B" class="usage__axis" />
              <rect
                v-for="b in hourChart.bars"
                :key="b.key"
                :x="b.x" :y="b.y" :width="b.w" :height="b.h"
                rx="2"
                class="usage__bar"
                :class="{ 'usage__bar--gold': Number(b.key) === peakHour }"
                @mousemove="showTip('hour', b, $event)"
              />
              <text
                v-for="(b, i) in hourChart.bars"
                :key="`l-${b.key}`"
                v-show="xLabelEvery(i, 24, 4)"
                :x="b.x + b.w / 2" :y="CHART_H - 5"
                class="usage__tick" text-anchor="middle"
              >{{ hourLabel(Number(b.key)) }}</text>
            </svg>
            <div v-if="tip && tip.chart === 'hour'" class="usage__tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
              {{ tip.text }}
            </div>
          </div>
          <p v-if="peakHour >= 0" class="usage__hint usage__hint--block">
            Peak hour: <b>{{ hourLabel(peakHour) }}</b> — a good publish window for announcements.
          </p>
        </AppCard>

        <AppCard class="usage__panel">
          <Eyebrow class="mb-2">Engagement depth · last 30 days</Eyebrow>
          <div class="usage__bars">
            <div v-for="row in buckets.rows" :key="row.label" class="usage__brow">
              <span class="usage__blabel">{{ row.label }}</span>
              <span class="usage__btrack"><span class="usage__bfill" :style="{ width: (row.n / buckets.max) * 100 + '%' }"></span></span>
              <span class="usage__bnum">{{ row.n }}</span>
              <span class="usage__bhint">{{ row.hint }}</span>
            </div>
          </div>
          <template v-if="buckets.dormantNames.length">
            <button type="button" class="usage__link" @click="showDormant = !showDormant">
              {{ showDormant ? 'Hide' : 'Show' }} the {{ buckets.dormantNames.length }} dormant
            </button>
            <p v-if="showDormant" class="usage__dormant">{{ buckets.dormantNames.join(' · ') }}</p>
          </template>
        </AppCard>
      </div>

      <!-- SECTION SHARE -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Where the time goes · last 30 days</Eyebrow>
        <div class="usage__bars">
          <div v-for="s in sections" :key="s.label" class="usage__brow">
            <span class="usage__blabel">{{ s.label }}</span>
            <span class="usage__btrack"><span class="usage__bfill usage__bfill--gold" :style="{ width: (s.views / sectionMax) * 100 + '%' }"></span></span>
            <span class="usage__bnum">{{ s.views }}</span>
            <span class="usage__bhint">{{ s.pct }}%</span>
          </div>
        </div>
      </AppCard>

      <!-- TOP ROUTES -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Top pages · last 7 days</Eyebrow>
        <p v-if="!topRoutes.length && !loading" class="usage__empty">No route activity logged yet.</p>
        <table v-else class="usage__table">
          <thead>
            <tr>
              <th>Route</th>
              <th class="num">Views</th>
              <th class="num">Unique users</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in topRoutes" :key="r.route">
              <td><code class="usage__path">{{ r.route }}</code></td>
              <td class="num">{{ r.views }}</td>
              <td class="num">{{ r.unique_users }}</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- TOP USERS -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Most engaged · last 30 days</Eyebrow>
        <p v-if="!topUsers.length && !loading" class="usage__empty">No data yet.</p>
        <table v-else class="usage__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th class="num">Views</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in topUsers" :key="u.user_id">
              <td>{{ u.full_name }}</td>
              <td><span class="usage__chip">{{ u.role }}</span></td>
              <td class="num">{{ u.views }}</td>
              <td class="usage__rel">{{ relativeTime(u.last_seen_at) }}</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- NEVER SIGNED IN -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Never signed in</Eyebrow>
        <p v-if="!neverSignedIn.length && !loading" class="usage__empty usage__empty--good">
          Nobody — the entire active roster has signed in at least once.
        </p>
        <ul v-else class="usage__list">
          <li v-for="u in neverSignedIn" :key="u.id" class="usage__list-item">
            <span>{{ u.full_name }}</span>
            <span class="usage__chip">{{ u.role }}</span>
          </li>
        </ul>
        <p v-if="neverSignedIn.length" class="usage__hint usage__hint--block">
          People in the roster whose account hasn't been linked to a sign-in yet — good
          candidates for a personal nudge.
        </p>
      </AppCard>
    </template>
  </div>
</template>

<style scoped>
.usage {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .usage {
    padding: 40px 40px 80px;
  }
}

.usage__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .usage__title {
    font-size: 36px;
  }
}
.usage__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 720px;
}

.usage__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.usage__toolbar {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}

.usage__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

/* OVERVIEW STRIP */
.usage__metrics {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (min-width: 640px) {
  .usage__metrics {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 960px) {
  .usage__metrics {
    grid-template-columns: repeat(6, 1fr);
  }
}
.usage__metric {
  padding: 14px 16px !important;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage__num {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-brand-600);
  line-height: 1;
  margin-top: 4px;
}
.usage__hint {
  font-size: 11.5px;
  color: var(--color-muted);
}
.usage__hint--block {
  display: block;
  margin-top: 12px;
}
.usage__up { color: var(--color-success-500); font-weight: 700; }
.usage__down { color: var(--color-danger-500); font-weight: 700; }

/* CHART GRID */
.usage__grid2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0 16px;
}
@media (min-width: 900px) {
  .usage__grid2 {
    grid-template-columns: 1fr 1fr;
  }
}

/* PANELS */
.usage__panel {
  margin-top: 16px;
  padding: 18px !important;
}
.usage__empty {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.usage__empty--good {
  color: var(--color-success-500);
  font-weight: 600;
}

/* SVG CHARTS */
.usage__chartwrap {
  position: relative;
}
.usage__chart {
  display: block;
  width: 100%;
  height: auto;
}
.usage__grid {
  stroke: var(--color-line-soft);
  stroke-width: 1;
}
.usage__axis {
  stroke: var(--color-line);
  stroke-width: 1;
}
.usage__tick {
  font-size: 9px;
  fill: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
.usage__bar {
  fill: var(--color-brand-600);
  opacity: 0.9;
}
.usage__bar:hover {
  opacity: 1;
}
.usage__bar--gold {
  fill: var(--color-accent-strong, #a8842c);
}
.usage__tip {
  position: absolute;
  pointer-events: none;
  background: var(--color-brand-800, #182644);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  padding: 4px 8px;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgb(10 15 30 / 0.25);
  z-index: 5;
}
.usage__tip-sub {
  display: block;
  font-weight: 400;
  opacity: 0.75;
}

/* BAR LISTS (engagement + sections) */
.usage__bars {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 4px;
}
.usage__brow {
  display: grid;
  grid-template-columns: 130px 1fr 40px minmax(0, 160px);
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.usage__blabel {
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.usage__btrack {
  display: block;
  height: 12px;
  border-radius: 4px;
  background: var(--color-surface-soft);
  overflow: hidden;
}
.usage__bfill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--color-brand-600);
  min-width: 2px;
}
.usage__bfill--gold {
  background: var(--color-accent-strong, #a8842c);
}
.usage__bnum {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--color-ink);
}
.usage__bhint {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 560px) {
  .usage__brow {
    grid-template-columns: 110px 1fr 34px;
  }
  .usage__bhint {
    display: none;
  }
}
.usage__link {
  margin-top: 10px;
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-600);
  cursor: pointer;
}
.usage__link:hover {
  text-decoration: underline;
}
.usage__dormant {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-ink-soft);
}

/* TABLE */
.usage__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.usage__table th,
.usage__table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.usage__table th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.usage__table th.num,
.usage__table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.usage__table tbody tr:last-child td {
  border-bottom: none;
}
.usage__path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-ink-soft);
}
.usage__chip {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
}
.usage__rel {
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
.usage__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.usage__list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  padding: 6px 2px;
  border-bottom: 1px solid var(--color-line-soft);
}
.usage__list-item:last-child {
  border-bottom: none;
}
</style>
