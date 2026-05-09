<script setup lang="ts">
defineProps<{ as?: string }>()
</script>

<template>
  <component :is="as ?? 'div'" class="eyebrow">
    <slot />
  </component>
</template>
