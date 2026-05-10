<script setup lang="ts">
import { GraduationCap } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import trainingData from '@/data/training.json'
import { parseDateOnly } from '@/utils/date'

function monthAbbr(iso: string) {
  return parseDateOnly(iso)?.toLocaleDateString('en-US', { month: 'short' }) ?? ''
}
function dayOfMonth(iso: string) {
  return parseDateOnly(iso)?.getDate() ?? ''
}

const events = trainingData as Array<{
  id: string
  title: string
  date: string
  time: string
  filled: number
  total: number
  location: string
}>
</script>

<template>
  <AppCard class="training-card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <Eyebrow>Upcoming Training</Eyebrow>
      <button v-if="events.length > 0" class="training-card__view-all">
        View all
      </button>
    </div>

    <div v-if="events.length === 0" class="training-card__empty">
      <GraduationCap :size="20" :stroke-width="1.5" class="training-card__empty-icon" />
      <div class="training-card__empty-title">No upcoming sessions</div>
      <p class="training-card__empty-sub">
        Sessions you're registered for will show up here. Check the
        <a href="https://www.wallercountyems.com/internaleducation" target="_blank" rel="noopener noreferrer">
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
            {{ t.time }} · {{ t.filled }}/{{ t.total }} registered · {{ t.location }}
          </div>
          <div class="training-card__progress">
            <div
              class="training-card__progress-bar"
              :style="{ width: `${(t.filled / t.total) * 100}%` }"
            />
          </div>
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
</style>
