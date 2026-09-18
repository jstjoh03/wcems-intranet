<script setup lang="ts">
import type { EquipmentStatus } from '@/types'

/** Status pill for an item. In-motion states pulse their dot. */
defineProps<{
  status: EquipmentStatus
  label: string
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <span class="eqchip" :class="[`eqchip--${status}`, { 'eqchip--md': size === 'md' }]">
    <span class="eqchip__dot" aria-hidden="true"></span>{{ label }}
  </span>
</template>

<style scoped>
.eqchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  white-space: nowrap;
  border-radius: 999px;
}
.eqchip--md {
  padding: 6px 13px 6px 11px;
  font-size: 12.5px;
}
.eqchip__dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 999px;
  background: currentColor;
}
.eqchip--available {
  background: oklch(0.955 0.04 150);
  color: oklch(0.42 0.12 150);
}
.eqchip--in_transit {
  background: var(--color-brand-50);
  color: var(--color-brand-600);
  box-shadow: inset 0 0 0 1px var(--color-brand-100);
}
.eqchip--on_unit {
  background: oklch(0.955 0.045 86.8);
  color: oklch(0.43 0.09 78);
}
.eqchip--missing {
  background: var(--color-danger-50);
  color: oklch(0.5 0.19 25);
  box-shadow: inset 0 0 0 1px oklch(0.88 0.06 25);
}
.eqchip--returning {
  background: oklch(0.95 0.025 220);
  color: oklch(0.42 0.08 220);
}
.eqchip--lost {
  background: var(--color-surface-sunk);
  color: oklch(0.42 0.06 25);
  box-shadow: inset 0 0 0 1px var(--color-line);
}
.eqchip--lost .eqchip__dot {
  background: none;
  box-shadow: inset 0 0 0 1.5px currentColor;
}
.eqchip--in_transit .eqchip__dot,
.eqchip--returning .eqchip__dot {
  animation: dot-pulse 2.4s var(--ease-in-out) infinite;
}
</style>
