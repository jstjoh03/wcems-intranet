<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import { useUsageTracking } from '@/composables/useUsageTracking'

const route = useRoute()

// Fire-and-forget engagement tracking — logs route changes so the
// /admin/usage page can show real weekly-active + top-route data.
useUsageTracking()

/* Sign-in and chromeless sections (the absorbed protocols app — a
   self-contained full-viewport dark UI with its own header) live
   outside the chrome — no topbar, drawer, footer, or dock. */
const useShell = computed(
  () => route.meta.public !== true && route.meta.chromeless !== true,
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
</template>
