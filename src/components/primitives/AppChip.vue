<script setup lang="ts">
defineProps<{
  /** Visual variant */
  variant?: 'default' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'trauma-1' | 'trauma-2' | 'trauma-3' | 'trauma-4'
  dot?: boolean
}>()
</script>

<template>
  <span class="chip" :class="`chip--${variant ?? 'default'}`">
    <span v-if="dot" class="chip-dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.chip--brand {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border-color: var(--color-brand-100);
}
.chip--accent {
  background: oklch(0.97 0.04 86.8);
  color: var(--color-brand-700);
  border-color: oklch(0.92 0.07 86.8);
}
.chip--success {
  background: var(--color-success-50);
  color: oklch(0.4 0.13 150);
  border-color: oklch(0.88 0.1 150);
}
.chip--warning {
  background: var(--color-warning-50);
  color: oklch(0.4 0.14 60);
  border-color: oklch(0.88 0.1 60);
}
.chip--danger {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  border-color: oklch(0.88 0.1 20);
}

.chip--trauma-1 {
  background: oklch(0.96 0.025 27);
  color: var(--color-trauma-1);
  border-color: oklch(0.85 0.1 27);
  font-weight: 600;
}
.chip--trauma-2 {
  background: oklch(0.97 0.04 50);
  color: oklch(0.45 0.16 50);
  border-color: oklch(0.85 0.1 50);
  font-weight: 600;
}
.chip--trauma-3 {
  background: oklch(0.97 0.04 86.8);
  color: var(--color-accent-700);
  border-color: oklch(0.92 0.07 86.8);
  font-weight: 600;
}
.chip--trauma-4 {
  background: oklch(0.96 0.02 200);
  color: var(--color-trauma-4);
  border-color: oklch(0.85 0.05 200);
  font-weight: 600;
}
</style>
