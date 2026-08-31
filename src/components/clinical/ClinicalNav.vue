<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import { usePipeline } from '@/composables/usePipeline'

/**
 * Section chrome for the redesigned Clinical Development area
 * (/clinical): breadcrumb + section nav. More areas (FTEP,
 * Evaluations, Resources, Settings) join as their phases ship —
 * only built pages are listed, no dead links. Supervisors/FTOs only
 * ever land on FTEP, so the Home/Employee Files pills are
 * editor-only.
 */

/** Crumbs are clickable when they carry a destination; plain strings
 *  render as static text (the last crumb = the current page). */
export type Crumb = string | { label: string; to: string }

defineProps<{
  crumbs: Crumb[]
}>()

const route = useRoute()
const { canEdit } = usePipeline()

const crumbLabel = (c: Crumb) => (typeof c === 'string' ? c : c.label)
const crumbTo = (c: Crumb) => (typeof c === 'string' ? null : c.to)

interface Section {
  label: string
  to: string
  exact: boolean
}

const sections = computed<Section[]>(() =>
  canEdit.value
    ? [
        { label: 'Home', to: '/clinical', exact: true },
        { label: 'Employee Files', to: '/clinical/people', exact: false },
        { label: 'FTEP', to: '/clinical/ftep', exact: false },
        { label: 'Submissions', to: '/clinical/submissions', exact: false },
        { label: 'Exams', to: '/clinical/exams', exact: false },
      ]
    : [{ label: 'FTEP', to: '/clinical/ftep', exact: false }],
)

function isOn(s: Section): boolean {
  return s.exact ? route.path === s.to : route.path.startsWith(s.to)
}
</script>

<template>
  <div class="cn">
    <nav class="cn__crumbs" aria-label="Breadcrumb">
      <RouterLink to="/" class="cn__crumb-link">Portal</RouterLink>
      <ChevronRight :size="11" :stroke-width="2" />
      <RouterLink :to="canEdit ? '/clinical' : '/clinical/ftep'" class="cn__crumb-link">Clinical Development</RouterLink>
      <template v-for="(c, i) in crumbs" :key="crumbLabel(c)">
        <ChevronRight :size="11" :stroke-width="2" />
        <RouterLink
          v-if="crumbTo(c) && i < crumbs.length - 1"
          :to="crumbTo(c)!"
          class="cn__crumb-link cn__crumb-link--strong"
        >{{ crumbLabel(c) }}</RouterLink>
        <b v-else :class="{ 'cn__last': i === crumbs.length - 1 }">{{ crumbLabel(c) }}</b>
      </template>
    </nav>
    <nav class="cn__sections" aria-label="Clinical Development sections">
      <RouterLink
        v-for="s in sections"
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
.cn__crumb-link {
  color: var(--color-muted);
  text-decoration: none;
}
.cn__crumb-link--strong {
  font-weight: 600;
  color: var(--color-ink-soft);
}
.cn__crumb-link:hover {
  color: var(--color-brand-600);
  text-decoration: underline;
  text-underline-offset: 3px;
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
