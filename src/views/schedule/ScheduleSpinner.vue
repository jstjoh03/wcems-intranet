<script setup lang="ts">
/**
 * Panel loading state — same ring the module shell boots with, sized
 * for in-panel use. Every panel gates its first paint on this instead
 * of flashing an empty table before the data lands (Justin, 2026-09-24).
 */
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading…' })
</script>

<template>
  <div class="sp" role="status" aria-live="polite">
    <span class="sp__ring" aria-hidden="true" />
    <p class="sp__text">{{ label }}</p>
  </div>
</template>

<style scoped>
.sp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 2.8rem 0 3.2rem;
}

.sp__ring {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid oklch(0.9 0.02 260);
  border-top-color: var(--color-accent-600);
  animation: sp-spin 0.9s linear infinite;
}

.sp__text {
  font-size: 0.82rem;
  letter-spacing: 0.02em;
  color: var(--color-muted);
  margin: 0;
}

@keyframes sp-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sp__ring {
    animation-duration: 2.5s;
  }
}
</style>
