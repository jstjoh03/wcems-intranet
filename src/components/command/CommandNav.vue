<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

/** Command sub-nav — Dashboard / Daily Summary / Archive. */
const route = useRoute()
const TABS = [
  { label: 'Dashboard', to: '/command', exact: true },
  { label: 'Daily Summary', to: '/command/daily-summary' },
  { label: 'Archive', to: '/command/summaries' },
]
function on(t: { to: string; exact?: boolean }): boolean {
  return t.exact ? route.path === t.to : route.path.startsWith(t.to)
}
</script>

<template>
  <nav class="cmdnav">
    <RouterLink
      v-for="t in TABS"
      :key="t.to"
      :to="t.to"
      class="cmdnav__tab"
      :class="{ 'cmdnav__tab--on': on(t) }"
    >{{ t.label }}</RouterLink>
  </nav>
</template>

<style scoped>
.cmdnav {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-line);
  margin-bottom: 18px;
  overflow-x: auto;
}
.cmdnav__tab {
  padding: 8px 13px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
}
.cmdnav__tab--on {
  color: var(--color-ink);
  border-bottom-color: var(--color-gold-500, #c9a227);
}
.cmdnav__tab:hover {
  color: var(--color-ink);
}
</style>
