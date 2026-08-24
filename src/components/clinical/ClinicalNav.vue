<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'

/**
 * Section chrome for the redesigned Clinical Development area
 * (/clinical): breadcrumb + section nav. More areas (FTEP,
 * Evaluations, Resources, Settings) join as their phases ship —
 * only built pages are listed, no dead links.
 */

defineProps<{
  crumbs: string[]
}>()

const route = useRoute()

const SECTIONS = [
  { label: 'Home', to: '/clinical', exact: true },
  { label: 'Employee Files', to: '/clinical/people', exact: false },
]

function isOn(s: (typeof SECTIONS)[number]): boolean {
  return s.exact ? route.path === s.to : route.path.startsWith(s.to)
}
</script>

<template>
  <div class="cn">
    <nav class="cn__crumbs" aria-label="Breadcrumb">
      <span>Portal</span>
      <ChevronRight :size="11" :stroke-width="2" />
      <span>Clinical Development</span>
      <template v-for="(c, i) in crumbs" :key="c">
        <ChevronRight :size="11" :stroke-width="2" />
        <b :class="{ 'cn__last': i === crumbs.length - 1 }">{{ c }}</b>
      </template>
    </nav>
    <nav class="cn__sections" aria-label="Clinical Development sections">
      <RouterLink
        v-for="s in SECTIONS"
        :key="s.to"
        :to="s.to"
        class="cn__pill"
        :class="{ 'cn__pill--on': isOn(s) }"
      >{{ s.label }}</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.cn {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.cn__crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-muted);
}
.cn__crumbs svg {
  color: var(--color-accent-strong, #a8842c);
}
.cn__crumbs b {
  font-weight: 600;
  color: var(--color-ink-soft);
}
.cn__crumbs b.cn__last {
  color: var(--color-ink);
}
.cn__sections {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.cn__pill {
  padding: 6px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
  transition: color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.cn__pill:hover {
  color: var(--color-ink);
  background: var(--color-surface-soft);
}
.cn__pill--on {
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  box-shadow: inset 0 -2px 0 var(--color-accent-strong, #a8842c);
}
</style>
