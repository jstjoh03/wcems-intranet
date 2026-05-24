<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/components/layout/AppShell.vue'
import { useUsageTracking } from '@/composables/useUsageTracking'

const route = useRoute()

// Fire-and-forget engagement tracking — logs route changes so the
// /admin/usage page can show real weekly-active + top-route data.
useUsageTracking()

/* Sign-in lives outside the chrome — no topbar, drawer, footer, or
   quick-links dock — so it reads as a focused gateway, not a "page". */
const useShell = computed(() => route.meta.public !== true)
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
