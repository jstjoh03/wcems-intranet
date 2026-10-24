<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import { usePipeline } from '@/composables/usePipeline'
import SkillsChooserDialog from '@/components/SkillsChooserDialog.vue'

/**
 * Section chrome for the Clinical Development module. On desktop the
 * module runs as its own app — a navy app bar with an "Employee
 * Portal" exit, exactly like Scheduling (Justin, 2026-10-23: the
 * mockup's site-within-a-site, not pills on a page). Phones keep the
 * compact portal topbar, so the bar collapses to a scrollable pill
 * strip there. "Skills" asks which board (NEOP Skills Day vs the 2026
 * protocol updates) instead of defaulting to NEOP.
 */

export type Crumb = string | { label: string; to: string }

defineProps<{
  crumbs: Crumb[]
}>()

const route = useRoute()
const { canEdit } = usePipeline()
const skillsOpen = ref(false)

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
        { label: 'Today', to: '/clinical', exact: true },
        { label: 'Board', to: '/clinical/board', exact: false },
        { label: 'FTEP', to: '/clinical/ftep', exact: false },
        { label: 'People', to: '/clinical/people', exact: false },
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
  <div>
    <!-- Desktop: the module's own navy app bar (full-bleed, sticky) -->
    <nav class="ca" aria-label="Clinical Development">
      <RouterLink to="/" class="ca__exit" title="Back to the employee portal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
        Employee Portal
      </RouterLink>
      <RouterLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="ca__link"
        :class="{ 'ca__link--on': isOn(s) }"
      >{{ s.label }}</RouterLink>
      <button type="button" class="ca__link" @click="skillsOpen = true">Skills</button>
      <span class="ca__flex" aria-hidden="true"></span>
      <span class="ca__brand display">Clinical Development</span>
    </nav>

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
      <!-- Phone / tablet: the bar has no room, keep the pill strip -->
      <nav class="cn__sections" aria-label="Clinical Development sections">
        <RouterLink
          v-for="s in sections"
          :key="s.to"
          :to="s.to"
          class="cn__pill"
          :class="{ 'cn__pill--on': isOn(s) }"
        >{{ s.label }}</RouterLink>
        <button type="button" class="cn__pill" @click="skillsOpen = true">Skills</button>
      </nav>
    </div>

    <SkillsChooserDialog v-if="skillsOpen" @close="skillsOpen = false" />
  </div>
</template>

<style scoped>
/* ── Module app bar (desktop ≥1024px, matching the scheduler's) ── */
.ca {
  display: none;
}
@media (min-width: 1024px) {
  .ca {
    position: sticky;
    top: 10px;
    z-index: 45;
    display: flex;
    align-items: stretch;
    margin: 0 0 20px;
    padding: 0 0.5rem;
    background: var(--color-brand-900);
    border-bottom: 2px solid var(--color-accent-600, oklch(0.664 0.119 86.8));
    border-radius: 11px;
    overflow-x: auto;
    box-shadow: 0 10px 30px oklch(0.18 0.05 255 / 0.28), inset 0 1px 0 oklch(1 0 0 / 0.07);
  }
  .ca__exit { border-radius: 10px 0 0 10px; }
}
.ca__exit {
  display: flex; align-items: center; gap: 7px;
  padding: 11px 16px 11px 10px; margin-right: 6px;
  font-size: 13px; font-weight: 600; color: #fff; text-decoration: none; white-space: nowrap;
  border-right: 1px solid oklch(1 0 0 / 0.14);
  transition: color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.ca__exit svg { width: 15px; height: 15px; }
.ca__exit:hover { background: var(--color-brand-800); color: var(--color-accent-on-dark); }
.ca__link {
  position: relative;
  display: flex; align-items: center; gap: 6px;
  padding: 11px 14px; border: 0; background: none; cursor: pointer;
  font-family: var(--font-sans); font-size: 13px; font-weight: 500; letter-spacing: 0.015em;
  color: oklch(0.82 0.025 250); white-space: nowrap; text-decoration: none;
  transition: color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.ca__link:hover { color: #fff; background: var(--color-brand-800); }
.ca__link--on { color: var(--color-accent-on-dark); }
.ca__link--on::after {
  content: ''; position: absolute; left: 11px; right: 11px; bottom: 0; height: 2px;
  background: var(--color-accent-on-dark);
}
.ca__flex { flex: 1; }
.ca__brand { align-self: center; font-size: 15px; color: oklch(0.92 0.02 250); padding: 0 12px; white-space: nowrap; }

/* ── Crumbs + mobile pill strip ── */
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
  overflow-x: auto;
  max-width: 100%;
}
@media (min-width: 1024px) {
  /* The app bar carries the sections on desktop */
  .cn__sections { display: none; }
}
.cn__pill {
  padding: 6px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--color-muted);
  text-decoration: none;
  background: none;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
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
