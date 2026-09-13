<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule, todayCentralIso } from '@/composables/useSchedule'

/**
 * Compact Aladtec-style day column used by the Week and Pay-period
 * boards: date header with platoon chip, then unit blocks with
 * name/credential rows and right-aligned times.
 */

const props = defineProps<{ dateIso: string }>()
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const sched = useSchedule()
const model = computed(() => sched.dayModel(props.dateIso))
const isToday = computed(() => props.dateIso === todayCentralIso())

const header = computed(() =>
  new Date(`${props.dateIso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }),
)
</script>

<template>
  <div class="dc" :class="{ 'dc--today': isToday }">
    <button class="dc__head" @click="emit('open-day', dateIso)">
      <span class="dc__date">{{ header }}</span>
      <span class="dc__platoon" :data-platoon="model.platoon">
        <span class="dc__dot" />{{ model.platoon }}
      </span>
    </button>

    <div v-for="um in model.units" :key="um.unit.id" class="dc__unit">
      <p class="dc__unit-name">{{ um.unit.code }}</p>
      <template v-for="sm in um.seats" :key="sm.seat.id">
        <div
          v-for="(row, ri) in sm.rows"
          :key="sm.seat.id + '-' + ri"
          class="dc__row"
          :class="{ 'dc__row--open': row.open }"
        >
          <span v-if="row.open" class="dc__name dc__name--open">{{ sm.seat.label }}</span>
          <span v-else class="dc__name">
            {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
          </span>
          <span class="dc__time">{{ row.start }}-{{ row.end }}</span>
        </div>
      </template>
      <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="dc__row dc__row--extra">
        <span class="dc__name">{{ ex.name }}</span>
        <span class="dc__time">{{ ex.start }}-{{ ex.end }}</span>
      </div>
    </div>

    <div v-for="ev in model.events" :key="ev.label" class="dc__event">
      <p class="dc__event-name">{{ ev.label }}</p>
      <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="dc__row">
        <span class="dc__name" :class="{ 'dc__name--open': row.open }">
          {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
        </span>
        <span class="dc__time">{{ row.start }}-{{ row.end }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
  min-width: 0;
}

.dc--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 1px var(--color-accent-600);
}

.dc__head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  border: 0;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  font: inherit;
  padding: 0.4rem 0.55rem;
  cursor: pointer;
}

.dc__date {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-brand-800);
  white-space: nowrap;
}

.dc__platoon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--color-surface);
}

.dc__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

.dc__platoon[data-platoon='A'] .dc__dot {
  background: oklch(0.55 0.2 27);
}

.dc__platoon[data-platoon='B'] .dc__dot {
  background: oklch(0.5 0.16 255);
}

.dc__platoon[data-platoon='C'] .dc__dot {
  background: oklch(0.55 0.15 150);
}

.dc__unit {
  padding: 0.3rem 0.55rem 0.35rem;
  border-bottom: 1px solid var(--color-line-soft);
}

.dc__unit:last-child {
  border-bottom: 0;
}

.dc__unit-name {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-brand-700);
  margin: 0 0 0.15rem;
}

.dc__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.08rem 0;
}

.dc__name {
  font-size: 0.72rem;
  color: var(--color-ink);
  min-width: 0;
  line-height: 1.3;
  overflow-wrap: anywhere; /* full last names wrap instead of clipping */
}

.dc__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.dc__cred {
  color: var(--color-muted);
}

.dc__time {
  font-size: 0.7rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dc__row--extra .dc__name {
  color: var(--color-accent-700);
}

.dc__event {
  padding: 0.3rem 0.55rem 0.35rem;
  border-top: 1px solid oklch(0.9 0.04 86.8);
  background: oklch(0.99 0.008 86.8);
}

.dc__event-name {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 0 0 0.15rem;
}
</style>
