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
      <p class="dc__event-name" :title="ev.notes ?? undefined">
        {{ ev.label }}<span v-if="ev.notes" class="dc__noteicon" />
      </p>
      <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="dc__row">
        <span class="dc__name" :class="{ 'dc__name--open': row.open }">
          {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
        </span>
        <span class="dc__time">{{ row.start }}-{{ row.end }}</span>
      </div>
    </div>

    <div v-if="model.extraHours.length" class="dc__section dc__section--extra">
      <p class="dc__section-h">Extra Hours</p>
      <div v-for="r in model.extraHours" :key="r.entryId">
        <div class="dc__row">
          <span class="dc__name">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
      </div>
    </div>

    <div v-if="model.trades.length" class="dc__section dc__section--trade">
      <p class="dc__section-h">Trades</p>
      <div v-for="r in model.trades" :key="r.entryId">
        <div class="dc__row">
          <span class="dc__name">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
      </div>
    </div>

    <div v-if="model.timeOff.length" class="dc__section dc__section--off">
      <p class="dc__section-h">Time Off</p>
      <div v-for="r in model.timeOff" :key="r.entryId">
        <div class="dc__row">
          <span class="dc__name">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
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
  /* Aladtec behavior: one line, ellipsize when long, time stays put. */
  font-size: 0.75rem;
  color: var(--color-ink);
  min-width: 0;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.dc__noteicon {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-left: 5px;
  border-radius: 2px;
  background: oklch(0.88 0.1 86.8);
  border: 1px solid oklch(0.6 0.11 86.8);
  cursor: help;
}

.dc__section {
  padding: 0.25rem 0.55rem 0.3rem;
  border-top: 1px solid var(--color-line-soft);
}

.dc__section-h {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0 0 0.1rem;
}

.dc__section--extra .dc__section-h {
  color: var(--color-brand-700);
}

.dc__section--trade .dc__section-h {
  color: var(--color-success-500);
}

.dc__section--off .dc__section-h {
  color: oklch(0.5 0.13 60);
}

.dc__sub {
  font-size: 0.62rem;
  color: var(--color-muted);
  margin: 0;
  line-height: 1.25;
}
</style>
