<script setup lang="ts">
import { useShift } from '@/composables/useShift'
import { useAuthStore } from '@/stores/auth'
import { computed } from 'vue'

const auth = useAuthStore()
const userShift = computed(() => auth.appUser?.shift ?? null)
const { current, isOnDuty } = useShift(userShift.value)

const label = computed(() =>
  isOnDuty.value
    ? `On duty · ${current.value.shift} Shift · Day ${current.value.day}`
    : `${current.value.shift} Shift on duty · Day ${current.value.day}`,
)
</script>

<template>
  <span class="chip shift-pill" :class="{ 'shift-pill--on': isOnDuty }">
    <span class="shift-pill__dot" aria-hidden="true" />
    <span class="shift-pill__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.shift-pill {
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  font-weight: 500;
  padding: 3px 10px;
  font-size: 12px;
}
.shift-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-muted-soft);
}
.shift-pill--on {
  background: var(--color-success-50);
  border-color: oklch(0.88 0.1 150);
  color: oklch(0.35 0.13 150);
  font-weight: 600;
}
.shift-pill--on .shift-pill__dot {
  background: var(--color-success-500);
  animation: dot-pulse 2.4s var(--ease-in-out) infinite;
}
</style>
