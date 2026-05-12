<script setup lang="ts">
import { Menu, Search } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import UserDropdown from './UserDropdown.vue'
import { RouterLink } from 'vue-router'

defineEmits<{
  openMenu: []
}>()

const auth = useAuthStore()
const roles = ['crew', 'supervisor', 'admin'] as const
const isDev = import.meta.env.DEV

/**
 * Topbar search opens the Quick Links dock — the dock already has a
 * search box that filters the catalog, so the topbar's pill acts as a
 * more prominent entry point + ⌘K shortcut surface. Cross-component
 * coordination via a window event keeps the dock and topbar decoupled.
 */
function openQuickLinks() {
  window.dispatchEvent(new CustomEvent('wcems:open-quicklinks'))
}
</script>

<template>
  <div class="topbar">
    <div class="topbar__inner">
      <button class="topbar__menu" aria-label="Open menu" @click="$emit('openMenu')">
        <Menu :size="20" :stroke-width="2" />
      </button>

      <RouterLink to="/" class="topbar__brand">
        <img
          src="/wcems-patch.png"
          alt="WCEMS patch"
          class="topbar__patch"
          width="28"
          height="28"
        />
        <div class="topbar__brand-text">
          <div class="display text-[15px] text-white">Waller County EMS</div>
          <div class="topbar__brand-sub">Intranet</div>
        </div>
      </RouterLink>

      <button
        type="button"
        class="topbar__search"
        aria-label="Open Quick Links search"
        @click="openQuickLinks"
      >
        <Search :size="13" class="topbar__search-icon" />
        <span class="topbar__search-placeholder">Search Quick Links…</span>
        <kbd class="topbar__kbd">⌘K</kbd>
      </button>

      <!--
        Dev role switcher — only renders in dev builds.
        In production the role is set by Entra group → Supabase JWT and
        is not user-toggleable. `isDev` is constant-folded by Vite, so
        this entire block is removed from the production bundle.
      -->
      <div v-if="isDev" class="topbar__role-switcher" :title="'Dev only — production reads role from Entra ID'">
        <span class="topbar__role-dev-tag">DEV</span>
        <button
          v-for="r in roles"
          :key="r"
          class="topbar__role-btn"
          :class="{ 'topbar__role-btn--active': auth.role === r }"
          @click="auth.setRole(r)"
        >
          {{ r }}
        </button>
      </div>

      <UserDropdown />
    </div>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  background: var(--color-brand-900);
  border-bottom: 1px solid var(--color-brand-800);
  width: 100%;
  /* Clip horizontally so the dev role-switcher / search can't leak past
     the viewport edge, but keep vertical visible so the user dropdown
     panel can extend below the bar without being chopped off. */
  overflow-x: clip;
  overflow-y: visible;
}

.topbar__inner {
  /* Edge-to-edge with tight padding — keeps the hamburger close to the
     viewport edge regardless of breakpoint. */
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
@media (min-width: 1280px) {
  .topbar__inner {
    padding: 10px 28px;
  }
}

.topbar__menu {
  background: transparent;
  border: none;
  color: var(--color-accent-on-dark);
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms var(--ease-out);
}
.topbar__menu:hover {
  background: var(--color-brand-800);
}

.topbar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex-shrink: 0;
}
.topbar__patch {
  width: 28px;
  height: 28px;
  object-fit: contain;
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.18));
}
.topbar__brand-text {
  line-height: 1.05;
  display: none;
}
@media (min-width: 640px) {
  .topbar__brand-text {
    display: block;
  }
}
.topbar__brand-sub {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accent-on-dark);
}

.topbar__search {
  flex: 1;
  min-width: 0;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--color-brand-800);
  border: 1px solid var(--color-brand-700);
  /* Looks like a text input but is actually a button — opens the
     Quick Links dock with its search prefocused. */
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
  transition: background 120ms var(--ease-out);
}
.topbar__search:hover {
  background: var(--color-brand-700);
}
.topbar__search-icon {
  color: var(--color-accent-on-dark);
  opacity: 0.7;
  flex-shrink: 0;
}
.topbar__search-placeholder {
  flex: 1;
  font-size: 13px;
  color: oklch(0.7 0.02 250);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar__kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--color-brand-700);
  color: oklch(0.85 0.02 250);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.topbar__role-switcher {
  display: none; /* hidden on mobile */
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px 7px;
  border-radius: 8px;
  background: var(--color-brand-800);
  border: 1px dashed oklch(0.5 0.16 60); /* dashed amber to read as "dev only" */
  flex-shrink: 0;
}
@media (min-width: 1024px) {
  .topbar__role-switcher {
    display: flex;
  }
}
.topbar__role-dev-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: oklch(0.7 0.16 60);
  margin-right: 4px;
}
.topbar__role-btn {
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: oklch(0.78 0.02 250);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.topbar__role-btn--active {
  background: var(--color-accent-on-dark);
  color: var(--color-brand-900);
}
</style>
