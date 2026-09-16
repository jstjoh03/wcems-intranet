<script setup lang="ts">
import { computed } from 'vue'
import { addDaysIso } from '@/composables/useSchedule'
import ScheduleDayColumn from './ScheduleDayColumn.vue'

/** Week board: seven day columns, Sunday through Saturday, containing the
 *  focused date. Stacks vertically on phones. */

const props = defineProps<{
  dateIso: string
  mine?: boolean
  forUser?: string | null
  hideOpen?: boolean
}>()
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const days = computed(() => {
  const d = new Date(`${props.dateIso}T00:00:00`)
  const start = addDaysIso(props.dateIso, -d.getDay())
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i))
})
</script>

<template>
  <div class="wb">
    <ScheduleDayColumn
      v-for="iso in days"
      :key="iso"
      :date-iso="iso"
      :mine="props.mine"
      :for-user="props.forUser"
      :hide-open="props.hideOpen"
      @open-day="emit('open-day', $event)"
    />
  </div>
</template>

<style scoped>
.wb {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  align-items: start;
}

@media (max-width: 900px) {
  .wb {
    grid-template-columns: 1fr;
  }
}
</style>
