<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { defineAsyncComponent } from 'vue'
import AppShell from '@/components/layout/AppShell.vue'
import AssistantPanel from '@/components/assistant/AssistantPanel.vue'

/* Dev-only dynamic import: the dead branch is dropped at build time, so
   the mascot (and its chunk) never reaches a production bundle. */
const ScoutMascot = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/components/assistant/ScoutMascot.vue'))
  : null
import { useAuthStore } from '@/stores/auth'
import { useUsageTracking } from '@/composables/useUsageTracking'

const route = useRoute()
const auth = useAuthStore()

// Fire-and-forget engagement tracking — logs route changes so the
// /admin/usage page can show real weekly-active + top-route data.
useUsageTracking()

/* Sign-in and chromeless sections (the absorbed protocols app — a
   self-contained full-viewport dark UI with its own header) live
   outside the chrome — no topbar, drawer, footer, or dock. */
const useShell = computed(
  () => route.meta.public !== true && route.meta.chromeless !== true,
)

/* Ask WCEMS rides OUTSIDE the shell so it's on every authenticated
   route, chromeless protocols pages included — but never on /signin or
   the anonymous student pages (register/checkin/eval/quiz).
   TEMPORARILY admin-only (Justin, 2026-10-24): pulled from production
   while the Scout mascot rebrand is decided — crew shouldn't learn a
   UI that may change. Restore by dropping the isAdmin check. */
const showAssistant = computed(
  () => route.meta.public !== true && auth.isAuthenticated && auth.isAdmin,
)
</script>

<template>
  <AppShell v-if="useShell">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </AppShell>
  <RouterView v-else v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>

  <AssistantPanel v-if="showAssistant" />
  <!-- Scout mascot: DEV ONLY while the character is tuned (Justin,
       2026-10-25) — never ships to production, admins included, until
       he signs off. Iterate at /dev/scout or any authed dev route. -->
  <component :is="ScoutMascot" v-if="ScoutMascot && showAssistant" />
</template>
