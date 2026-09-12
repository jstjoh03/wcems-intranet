<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  payPeriodFor,
  payPeriodList,
  addDaysIso,
  todayCentralIso,
  type PayPeriod,
} from '@/composables/useSchedule'
import ScheduleDayColumn from './ScheduleDayColumn.vue'

/** Pay-period board: a dropdown of two-week periods (current selected by
 *  default) rendering fourteen day columns. */

const emit = defineEmits<{
  (e: 'open-day', iso: string): void
  (e: 'range', start: string, end: string): void
}>()

const periods = ref<PayPeriod[]>(payPeriodList(todayCentralIso(), 6, 6))
const selected = ref(payPeriodFor(todayCentralIso()).start)

const period = computed(
  () => periods.value.find((p) => p.start === selected.value) ?? periods.value[0],
)

const days = computed(() =>
  Array.from({ length: 14 }, (_, i) => addDaysIso(period.value.start, i)),
)

watch(
  period,
  (p) => {
    emit('range', p.start, p.end)
  },
  { immediate: true },
)
</script>

<template>
  <div class="pb">
    <label class="pb__pick">
      <span class="pb__pick-label">Pay period</span>
      <select v-model="selected" class="pb__select">
        <option v-for="p in periods" :key="p.start" :value="p.start">{{ p.label }}</option>
      </select>
    </label>

    <div class="pb__grid">
      <ScheduleDayColumn
        v-for="iso in days"
        :key="iso"
        :date-iso="iso"
        @open-day="emit('open-day', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.pb__pick {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.pb__pick-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.pb__select {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.pb__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  align-items: start;
}

@media (max-width: 900px) {
  .pb__grid {
    grid-template-columns: 1fr;
  }
}
</style>
