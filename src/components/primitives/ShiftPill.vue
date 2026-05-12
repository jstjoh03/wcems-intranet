<script setup lang="ts">
import { useShift } from '@/composables/useShift'
import { useAuthStore } from '@/stores/auth'
import { computed } from 'vue'

/**
 * Always-green informational pill that tells the room which shift is
 * currently on duty. Not user-specific: a PRN / admin staff person
 * who isn't on a shift sees the same pill as a crew member who is.
 *
 * Earlier versions toggled the green styling based on whether the
 * signed-in user was on duty; that made the pill look "dead" for
 * anyone unassigned to a shift, which defeated the informational
 * purpose. The label still reads the live shift rotation from
 * useShift().
 */

const auth = useAuthStore()
const userShift = computed(() => auth.appUser?.shift ?? null)
const { current } = useShift(userShift.value)

const label = computed(
  () => `${current.value.shift} Shift on duty · Day ${current.value.day}`,
)
</script>

<template>
  <span class="chip shift-pill">
    <span class="shift-pill__dot" aria-hidden="true" />
    <span class="shift-pill__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.shift-pill {
  background: var(--color-success-50);
  border-color: oklch(0.88 0.1 150);
  color: oklch(0.35 0.13 150);
  font-weight: 600;
  padding: 3px 10px;
  font-size: 12px;
}
.shift-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-success-500);
  animation: dot-pulse 2.4s var(--ease-in-out) infinite;
}
</style>
