<script setup lang="ts">
import { ref } from 'vue'
import AppTopBar from './AppTopBar.vue'
import NavDrawer from './NavDrawer.vue'
import AppFooter from './AppFooter.vue'
import QuickLinksDock from './QuickLinksDock.vue'

const navOpen = ref(false)
</script>

<template>
  <div class="min-h-screen flex flex-col" style="background: var(--color-canvas)">
    <NavDrawer :open="navOpen" @close="navOpen = false" />
    <AppTopBar @open-menu="navOpen = true" />

    <main class="flex-1">
      <slot />
    </main>

    <AppFooter />

    <!-- Floating quick-links dock — visible on every route -->
    <QuickLinksDock />
  </div>
</template>
