<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import {
  LayoutDashboard,
  PlusCircle,
  SlidersHorizontal,
  ClipboardList,
  Library,
  FileSpreadsheet,
  FileCheck2,
  ShieldCheck,
} from 'lucide-vue-next'
import { useAuthStore } from '@/training/stores/auth'

/**
 * Training-management section chrome inside the portal. The standalone
 * training PWA carried its own full topbar; here the portal masthead
 * owns identity/sign-out, so the shell reduces to a breadcrumb + tab
 * bar over the same content column the views were built for.
 */

const auth = useAuthStore()
const route = useRoute()

interface Tab {
  label: string
  to: string
  exact?: boolean
  icon: typeof LayoutDashboard
  adminOnly?: boolean
}

const ALL_TABS: Tab[] = [
  { label: 'Dashboard', to: '/training/manage', exact: true, icon: LayoutDashboard },
  { label: 'Create', to: '/training/manage/create', icon: PlusCircle },
  { label: 'Controls', to: '/training/manage/controls', icon: SlidersHorizontal },
  { label: 'Registrations', to: '/training/manage/registrations', icon: ClipboardList },
  { label: 'Archive', to: '/training/manage/hub', icon: Library },
  { label: 'Rosters', to: '/training/manage/roster-export', icon: FileSpreadsheet },
  { label: 'Evals', to: '/training/manage/evals-export', icon: FileCheck2 },
  { label: 'Access', to: '/training/manage/access', icon: ShieldCheck, adminOnly: true },
]

const tabs = computed(() => ALL_TABS.filter((t) => !t.adminOnly || auth.isAdmin))

function isOn(t: Tab): boolean {
  return t.exact ? route.path === t.to : route.path.startsWith(t.to)
}
</script>

<template>
  <div class="shell">
    <div class="shell__chrome">
      <nav class="shell__crumbs" aria-label="Breadcrumb">
        <RouterLink to="/" class="shell__crumb-link">Portal</RouterLink>
        <ChevronRight :size="11" :stroke-width="2" />
        <RouterLink to="/training" class="shell__crumb-link">Training</RouterLink>
        <ChevronRight :size="11" :stroke-width="2" />
        <b>Manage</b>
      </nav>
      <nav class="shell__tabs" aria-label="Training management sections">
        <RouterLink
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          class="shell__tab"
          :class="{ 'shell__tab--on': isOn(t) }"
        >
          <component :is="t.icon" :size="14" :stroke-width="2" />
          {{ t.label }}
        </RouterLink>
      </nav>
    </div>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 60dvh;
  background: var(--color-canvas);
}
.shell__chrome {
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 16px 0;
}
@media (min-width: 768px) {
  .shell__chrome {
    padding: 22px 40px 0;
  }
}
.shell__crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-muted);
  margin-bottom: 12px;
}
.shell__crumbs svg {
  color: var(--color-accent-600);
}
.shell__crumbs b {
  font-weight: 600;
  color: var(--color-ink);
}
.shell__crumb-link {
  color: var(--color-muted);
  text-decoration: none;
}
.shell__crumb-link:hover {
  color: var(--color-brand-600);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.shell__tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-line);
  overflow-x: auto;
  scrollbar-width: none;
}
.shell__tabs::-webkit-scrollbar {
  display: none;
}
.shell__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
}
.shell__tab svg {
  color: var(--color-muted-soft);
}
.shell__tab:hover {
  color: var(--color-ink);
}
.shell__tab--on {
  color: var(--color-brand-800);
  border-bottom-color: var(--color-accent-600);
}
.shell__tab--on svg {
  color: var(--color-accent-600);
}

.content {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}
@media (min-width: 768px) {
  .content {
    padding: 28px 40px 80px;
  }
}
</style>
