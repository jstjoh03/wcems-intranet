<script setup lang="ts">
import { ref } from 'vue'
import AppTopBar from './AppTopBar.vue'
import NavDrawer from './NavDrawer.vue'
import AppFooter from './AppFooter.vue'
import UtilityBar from './UtilityBar.vue'
import PortalMasthead from './PortalMasthead.vue'
import PortalFooter from './PortalFooter.vue'
import QuickLinksDock from './QuickLinksDock.vue'
import GlobalSearchOverlay from './GlobalSearchOverlay.vue'
import UserProfileModal from './UserProfileModal.vue'
import ProfileCompletionModal from './ProfileCompletionModal.vue'
import InstallPromptBanner from './InstallPromptBanner.vue'

const navOpen = ref(false)
</script>

<template>
  <div class="min-h-screen flex flex-col" style="background: var(--color-canvas)">
    <NavDrawer :open="navOpen" @close="navOpen = false" />

    <!-- Desktop chrome (portal mockup v2): utility bar + masthead + nav.
         Mobile keeps the compact topbar + drawer — crews are phone-first,
         the professional-website reading is for desktop. -->
    <div class="hidden lg:block">
      <UtilityBar />
      <PortalMasthead />
    </div>
    <div class="lg:hidden">
      <AppTopBar @open-menu="navOpen = true" />
    </div>

    <main class="flex-1">
      <slot />
    </main>

    <div class="hidden lg:block">
      <PortalFooter />
    </div>
    <div class="lg:hidden">
      <AppFooter />
    </div>

    <!-- Floating quick-links dock — mobile only; desktop reaches the
         same catalog via the utility bar + Systems menu -->
    <div class="lg:hidden">
      <QuickLinksDock />
    </div>

    <!-- Global site search (Cmd/Ctrl+K from anywhere; topbar search opens it) -->
    <GlobalSearchOverlay />

    <!-- Self-serve profile modal — opened via the `wcems:open-profile`
         window event from the nav drawer footer or the user dropdown. -->
    <UserProfileModal />

    <!-- First-run nudge: prompts new users to add a photo + set
         station/shift. Self-gates on profile completeness + dismissal;
         "Complete my profile" opens UserProfileModal above. -->
    <ProfileCompletionModal />

    <!-- "Install the app" prompt for mobile visitors who arrived in a
         browser tab. Self-gates on display-mode, mobile UA, and a
         localStorage dismiss flag — desktop + already-installed users
         never see it. -->
    <InstallPromptBanner />
  </div>
</template>
