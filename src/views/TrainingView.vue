<script setup lang="ts">
import { computed } from 'vue'
import {
  GraduationCap,
  RefreshCw,
  MapPin,
  Clock,
  User,
  ExternalLink,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import { useTraining } from '@/composables/useTraining'
import { parseDateOnly } from '@/utils/date'

const REGISTER_URL = 'https://www.wallercountyems.com/internaleducation'

const { events, loading, lastFetchedAt, errorMessage, refresh } = useTraining()

function freshnessLabel(d: Date | null): string {
  if (!d) return ''
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (diffMin < 1) return 'updated just now'
  if (diffMin < 60) return `updated ${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `updated ${diffHr}h ago`
}

function monthAbbr(iso: string) {
  return parseDateOnly(iso)?.toLocaleDateString('en-US', { month: 'short' }) ?? ''
}
function dayOfMonth(iso: string) {
  return parseDateOnly(iso)?.getDate() ?? ''
}
function weekday(iso: string) {
  return parseDateOnly(iso)?.toLocaleDateString('en-US', { weekday: 'short' }) ?? ''
}

/* Group events into month buckets so the page reads as a calendar
   rather than a wall of cards. Useful when the team has 30+ upcoming
   sessions and admins/crew need to scan by month. */
const monthBuckets = computed(() => {
  const map = new Map<string, { label: string; events: typeof events.value }>()
  for (const ev of events.value) {
    if (!ev.date) continue
    const parts = ev.date.split('-')
    if (parts.length < 3) continue
    const key = `${parts[0]}-${parts[1]}`
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1)
    const label = d.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
    const bucket = map.get(key)
    if (bucket) bucket.events.push(ev)
    else map.set(key, { label, events: [ev] })
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
})

function fillPercent(filled: number, total: number) {
  if (total <= 0) return 0
  return Math.min(100, (filled / total) * 100)
}

function fillColor(filled: number, total: number) {
  if (total <= 0) return 'var(--color-muted)'
  const pct = filled / total
  if (pct >= 1) return 'var(--color-danger-500)'
  if (pct >= 0.75) return 'var(--color-accent-700)'
  return 'var(--color-success-500)'
}
</script>

<template>
  <div class="training">
    <header class="training__header">
      <div class="training__title-row">
        <div class="flex items-center gap-2">
          <GraduationCap
            :size="22"
            :stroke-width="1.85"
            style="color: var(--color-brand-600)"
          />
          <h1 class="display training__title">Upcoming Training</h1>
        </div>
        <div class="training__toolbar">
          <span v-if="lastFetchedAt" class="training__freshness">
            {{ freshnessLabel(lastFetchedAt) }}
          </span>
          <button
            v-if="lastFetchedAt"
            type="button"
            class="training__refresh"
            :disabled="loading"
            aria-label="Refresh training list"
            @click="refresh"
          >
            <RefreshCw :size="14" :stroke-width="1.85" :class="loading ? 'spin' : ''" />
          </button>
        </div>
      </div>
      <p class="training__sub">
        Pulled from Wix Bookings and the Training and Education group calendar. Syncs every 15
        minutes.
      </p>
    </header>

    <div v-if="errorMessage" class="training__empty">
      <GraduationCap :size="22" :stroke-width="1.5" class="training__empty-icon" />
      <div class="training__empty-title">Couldn't load training</div>
      <p class="training__empty-sub">{{ errorMessage }}</p>
    </div>

    <div v-else-if="loading && events.length === 0" class="training__empty">
      <div class="training__empty-title">Loading…</div>
    </div>

    <div v-else-if="events.length === 0" class="training__empty">
      <GraduationCap :size="22" :stroke-width="1.5" class="training__empty-icon" />
      <div class="training__empty-title">No upcoming sessions</div>
      <p class="training__empty-sub">
        Sessions you're registered for will show up here. Check the
        <a
          href="https://www.wallercountyems.com/internaleducation"
          target="_blank"
          rel="noopener noreferrer"
        >
          Internal Education catalog
        </a>
        for what's coming up.
      </p>
    </div>

    <template v-else>
      <section v-for="bucket in monthBuckets" :key="bucket.label" class="training__month">
        <div class="training__month-head display">{{ bucket.label }}</div>
        <AppCard
          v-for="t in bucket.events"
          :key="t.id"
          class="training__row"
        >
          <div class="training__date">
            <div class="training__date-mo">{{ monthAbbr(t.date) }}</div>
            <div class="training__date-day display">{{ dayOfMonth(t.date) }}</div>
            <div class="training__date-wd">{{ weekday(t.date) }}</div>
          </div>
          <div class="training__body">
            <div class="training__row-title display">{{ t.title }}</div>
            <div class="training__meta">
              <span v-if="t.time" class="training__chip">
                <Clock :size="11" :stroke-width="2" />
                {{ t.time }}
              </span>
              <span v-if="t.location" class="training__chip">
                <MapPin :size="11" :stroke-width="2" />
                {{ t.location }}
              </span>
              <span v-if="t.instructor" class="training__chip">
                <User :size="11" :stroke-width="2" />
                {{ t.instructor }}
              </span>
            </div>
            <div v-if="t.source === 'wix' && t.total > 0" class="training__seats">
              <div class="training__seats-label">
                <span>Registered</span>
                <span
                  class="training__seats-count"
                  :style="{ color: fillColor(t.filled, t.total) }"
                >
                  {{ t.filled }} / {{ t.total }}
                </span>
              </div>
              <div class="training__seats-bar">
                <div
                  class="training__seats-fill"
                  :style="{
                    width: `${fillPercent(t.filled, t.total)}%`,
                    background: fillColor(t.filled, t.total),
                  }"
                />
              </div>
            </div>
          </div>
          <a
            v-if="t.source === 'wix'"
            :href="REGISTER_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="training__register"
          >
            Register
            <ExternalLink :size="13" :stroke-width="1.85" />
          </a>
        </AppCard>
      </section>
    </template>
  </div>
</template>

<style scoped>
.training {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}
@media (min-width: 768px) {
  .training {
    padding: 40px 40px 80px;
  }
}

.training__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.training__title {
  font-size: 32px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .training__title {
    font-size: 40px;
  }
}
.training__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}

.training__toolbar {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.training__freshness {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.training__refresh {
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--color-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition:
    color 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.training__refresh:hover:not(:disabled) {
  color: var(--color-ink);
  border-color: var(--color-muted-soft);
}
.training__refresh:disabled {
  opacity: 0.5;
  cursor: wait;
}
.spin {
  animation: training-spin 800ms linear infinite;
}
@keyframes training-spin {
  to {
    transform: rotate(360deg);
  }
}

.training__empty {
  margin-top: 32px;
  text-align: center;
  padding: 48px 20px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.training__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 10px;
}
.training__empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.training__empty-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.training__empty-sub a {
  color: var(--color-brand-600);
}

.training__month {
  margin-top: 28px;
}
.training__month:first-of-type {
  margin-top: 24px;
}
.training__month-head {
  font-size: 18px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-line);
}

.training__row {
  display: flex !important;
  gap: 16px;
  padding: 14px 16px !important;
  margin-bottom: 8px;
  align-items: flex-start;
}
.training__date {
  flex-shrink: 0;
  min-width: 56px;
  text-align: center;
  padding: 8px 6px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
}
.training__date-mo {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.training__date-day {
  font-size: 22px;
  color: var(--color-brand-600);
  line-height: 1.05;
}
.training__date-wd {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.training__body {
  flex: 1;
  min-width: 0;
}
.training__row-title {
  font-size: 16px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  line-height: 1.25;
}
.training__meta {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.training__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-ink-soft);
}
.training__chip svg {
  color: var(--color-muted);
}

.training__seats {
  margin-top: 10px;
}
.training__seats-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.training__seats-count {
  font-weight: 600;
}
.training__seats-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--color-line);
  overflow: hidden;
}
.training__seats-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 600ms var(--ease-out);
}

.training__register {
  flex-shrink: 0;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  background: var(--color-brand-600);
  color: white;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  transition: background 120ms var(--ease-out);
  white-space: nowrap;
}
.training__register:hover {
  background: var(--color-brand-700);
}
@media (max-width: 639px) {
  .training__row {
    flex-wrap: wrap;
  }
  .training__register {
    align-self: stretch;
    justify-content: center;
    margin-left: 72px; /* line up under the body, not the date pill */
  }
}
</style>
