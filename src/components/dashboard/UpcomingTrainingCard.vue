<script setup lang="ts">
import { GraduationCap, RefreshCw, ExternalLink } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { parseDateOnly } from '@/utils/date'
import { useTraining } from '@/composables/useTraining'

const REGISTER_URL = 'https://www.wallercountyems.com/internaleducation'

const { events, loading, lastFetchedAt, errorMessage, refresh } = useTraining()

function monthAbbr(iso: string) {
  return parseDateOnly(iso)?.toLocaleDateString('en-US', { month: 'short' }) ?? ''
}
function dayOfMonth(iso: string) {
  return parseDateOnly(iso)?.getDate() ?? ''
}
function freshnessLabel(d: Date | null): string {
  if (!d) return ''
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (diffMin < 1) return 'updated just now'
  if (diffMin < 60) return `updated ${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `updated ${diffHr}h ago`
}
</script>

<template>
  <AppCard class="training-card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <Eyebrow>Upcoming Classes</Eyebrow>
      <div class="flex items-center gap-3">
        <span v-if="lastFetchedAt" class="training-card__freshness">
          {{ freshnessLabel(lastFetchedAt) }}
        </span>
        <button
          v-if="lastFetchedAt"
          type="button"
          class="training-card__refresh"
          :disabled="loading"
          aria-label="Refresh training list"
          @click="refresh"
        >
          <RefreshCw :size="13" :stroke-width="1.85" :class="loading ? 'spin' : ''" />
        </button>
        <RouterLink
          v-if="events.length > 0"
          to="/training"
          class="training-card__view-all"
        >
          View all
        </RouterLink>
      </div>
    </div>

    <div v-if="errorMessage" class="training-card__empty">
      <GraduationCap :size="20" :stroke-width="1.5" class="training-card__empty-icon" />
      <div class="training-card__empty-title">Couldn't load training</div>
      <p class="training-card__empty-sub">{{ errorMessage }}</p>
    </div>

    <div v-else-if="loading && events.length === 0" class="training-card__empty">
      <div class="training-card__empty-title">Loading…</div>
    </div>

    <div v-else-if="events.length === 0" class="training-card__empty">
      <GraduationCap :size="20" :stroke-width="1.5" class="training-card__empty-icon" />
      <div class="training-card__empty-title">No upcoming sessions</div>
      <p class="training-card__empty-sub">
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

    <div v-else class="space-y-3">
      <div
        v-for="(t, i) in events"
        :key="t.id"
        class="training-card__row"
        :class="{ 'training-card__row--last': i === events.length - 1 }"
      >
        <div class="training-card__date">
          <div class="training-card__date-mo">{{ monthAbbr(t.date) }}</div>
          <div class="training-card__date-day display">{{ dayOfMonth(t.date) }}</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="training-card__title display">{{ t.title }}</div>
          <div class="training-card__meta">
            <template v-if="t.time">{{ t.time }}</template>
            <template v-if="t.source === 'wix' && t.total > 0">
              <template v-if="t.time"> · </template>
              {{ t.filled }}/{{ t.total }} registered
            </template>
            <template v-if="t.location">
              <template v-if="t.time || (t.source === 'wix' && t.total > 0)"> · </template>
              {{ t.location }}
            </template>
            <template v-if="t.instructor">
              <template v-if="t.time || (t.source === 'wix' && t.total > 0) || t.location">
                ·
              </template>
              {{ t.instructor }}
            </template>
          </div>
          <div
            v-if="t.source === 'wix' && t.total > 0"
            class="training-card__progress"
          >
            <div
              class="training-card__progress-bar"
              :style="{ width: `${(t.filled / t.total) * 100}%` }"
            />
          </div>
          <a
            v-if="t.source === 'wix'"
            :href="REGISTER_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="training-card__register"
          >
            Register
            <ExternalLink :size="11" :stroke-width="2" />
          </a>
        </div>
      </div>
    </div>
  </AppCard>
</template>

<style scoped>
.training-card {
  padding: 20px;
}
.training-card__view-all {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-brand-600);
  background: transparent;
  border: none;
  cursor: pointer;
}
.training-card__freshness {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.training-card__refresh {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  display: inline-flex;
  align-items: center;
  padding: 2px;
}
.training-card__refresh:hover:not(:disabled) {
  color: var(--color-ink);
}
.training-card__refresh:disabled {
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

.training-card__empty {
  text-align: center;
  padding: 16px 8px;
}
.training-card__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 8px;
}
.training-card__empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.training-card__empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.55;
}
.training-card__empty-sub a {
  color: var(--color-brand-600);
}

.training-card__row {
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line);
}
.training-card__row--last {
  padding-bottom: 0;
  border-bottom: none;
}
.training-card__date {
  flex-shrink: 0;
  min-width: 46px;
  text-align: center;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
}
.training-card__date-mo {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.training-card__date-day {
  font-size: 20px;
  color: var(--color-brand-600);
}
.training-card__title {
  font-size: 15.5px;
  line-height: 1.2;
  color: var(--color-ink);
}
.training-card__meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  margin-top: 4px;
}
.training-card__progress {
  margin-top: 6px;
  height: 3px;
  border-radius: 999px;
  background: var(--color-line);
  overflow: hidden;
}
.training-card__progress-bar {
  height: 100%;
  background: var(--color-success-500);
  transition: width 600ms var(--ease-out);
}
.training-card__register {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  text-decoration: none;
  letter-spacing: 0.02em;
}
.training-card__register:hover {
  color: var(--color-brand-700);
  text-decoration: underline;
}
</style>
