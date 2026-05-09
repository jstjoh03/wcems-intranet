<script setup lang="ts">
defineProps<{
  /** Add subtle hover-lift + shadow-sm reveal */
  interactive?: boolean
  /** Removes the default 1px border (for hero/marquee uses) */
  borderless?: boolean
}>()
</script>

<template>
  <div
    class="card transition-all duration-150"
    :class="{
      'app-card--interactive': interactive,
      'app-card--borderless': borderless,
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.app-card--interactive {
  cursor: pointer;
}
.app-card--interactive:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.app-card--borderless {
  border: none;
}
</style>
