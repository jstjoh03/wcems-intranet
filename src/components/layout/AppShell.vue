<script setup lang="ts">
import { ref } from 'vue'
import AppTopBar from './AppTopBar.vue'
import NavDrawer from './NavDrawer.vue'
import AppFooter from './AppFooter.vue'
import QuickLinksDock from './QuickLinksDock.vue'
import GlobalSearchOverlay from './GlobalSearchOverlay.vue'
import UserProfileModal from './UserProfileModal.vue'
import InstallPromptBanner from './InstallPromptBanner.vue'

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

    <!-- Global site search (Cmd/Ctrl+K from anywhere; topbar search opens it) -->
    <GlobalSearchOverlay />

    <!-- Self-serve profile modal — opened via the `wcems:open-profile`
         window event from the nav drawer footer or the user dropdown. -->
    <UserProfileModal />

    <!-- "Install the app" prompt for mobile visitors who arrived in a
         browser tab. Self-gates on display-mode, mobile UA, and a
         localStorage dismiss flag — desktop + already-installed users
         never see it. -->
    <InstallPromptBanner />
  </div>
</template>
