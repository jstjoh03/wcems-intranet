<script setup lang="ts">
import { computed } from 'vue'

/**
 * 24-hour time picker for every schedule form. Native
 * `<input type="time">` renders in the OS locale — AM/PM on the
 * crews' phones and desktops — while the boards show 24-hour times
 * (Justin, 2026-09-22: "all times everywhere 24hr"). A select keeps
 * entry mistake-proof and phones get their native wheel.
 *
 * Quarter-hour steps cover every real shift boundary; an off-grid
 * bound value (imported or legacy data) is kept as its own option so
 * nothing silently shifts on open.
 */

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const OPTIONS: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of ['00', '15', '30', '45']) {
    OPTIONS.push(`${String(h).padStart(2, '0')}:${m}`)
  }
}

const options = computed(() => {
  const v = props.modelValue
  if (!v || OPTIONS.includes(v)) return OPTIONS
  return [...OPTIONS, v].sort()
})
</script>

<template>
  <select
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="o in options" :key="o" :value="o">{{ o }}</option>
  </select>
</template>
