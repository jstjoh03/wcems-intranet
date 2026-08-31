<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Users, FileText, FolderOpen, IdCard } from 'lucide-vue-next'
import { usePipeline } from '@/composables/usePipeline'

/**
 * FTEP's own tab bar — the section works as a mini-site inside
 * Clinical Development: Trainees (the working board), Reports (every
 * submitted DOR/ICR), Resources (handbooks, guides, blank forms), and
 * — for supervisors/FTOs, who don't get Employee Files — the
 * credential Roster.
 */

const route = useRoute()
const { canEdit } = usePipeline()

const tabs = computed(() => {
  const t = [
    { label: 'Trainees', to: '/clinical/ftep', exact: true, icon: Users },
    { label: 'Reports', to: '/clinical/ftep/reports', exact: false, icon: FileText },
    { label: 'Resources', to: '/clinical/ftep/resources', exact: false, icon: FolderOpen },
  ]
  if (!canEdit.value)
    t.push({ label: 'Roster', to: '/clinical/ftep/roster', exact: false, icon: IdCard })
  return t
})

function isOn(t: { to: string; exact: boolean }): boolean {
  return t.exact ? route.path === t.to : route.path.startsWith(t.to)
}
</script>

<template>
  <nav class="ft" aria-label="FTEP sections">
    <RouterLink
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="ft__tab"
      :class="{ 'ft__tab--on': isOn(t) }"
    >
      <component :is="t.icon" :size="14" :stroke-width="2" />
      {{ t.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.ft {
  display: flex;
  gap: 2px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--color-line);
}
.ft__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 120ms var(--ease-out);
}
.ft__tab svg {
  color: var(--color-muted-soft);
}
.ft__tab:hover {
  color: var(--color-ink);
}
.ft__tab--on {
  color: var(--color-brand-800);
  border-bottom-color: var(--color-accent-strong, #a8842c);
}
.ft__tab--on svg {
  color: var(--color-accent-strong, #a8842c);
}
</style>
