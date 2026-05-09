<script setup lang="ts">
import * as icons from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{
  name: string
  size?: number
  strokeWidth?: number
}>()

/**
 * Resolve a lucide icon by string name (e.g. "Package", "Stethoscope").
 * Used by data-driven views (Quick Links) where the icon component name
 * lives in the JSON, not the .vue file.
 */
const Cmp = computed(() => {
  const lib = icons as Record<string, unknown>
  return (lib[props.name] as object) ?? lib['HelpCircle']
})
</script>

<template>
  <component
    :is="Cmp"
    :size="size ?? 16"
    :stroke-width="strokeWidth ?? 1.85"
  />
</template>
