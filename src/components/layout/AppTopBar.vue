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

      <div class="topbar__search">
        <Search :size="13" class="topbar__search-icon" />
        <input
          placeholder="Search the intranet…"
          class="topbar__search-input"
          aria-label="Search"
        />
        <kbd class="topbar__kbd">⌘K</kbd>
      </div>

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
  overflow: hidden;
}

.topbar__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
@media (min-width: 768px) {
  .topbar__inner {
    padding: 10px 40px;
  }
}

.topbar__menu {
  background: transparent;
  border: none;
  color: var(--color-accent-500);
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
  color: var(--color-accent-500);
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
}
.topbar__search-icon {
  color: var(--color-accent-500);
  opacity: 0.7;
  flex-shrink: 0;
}
.topbar__search-input {
  flex: 1;
  background: transparent;
  outline: none;
  border: none;
  font-size: 13px;
  color: white;
  min-width: 0;
}
.topbar__search-input::placeholder {
  color: oklch(0.7 0.02 250);
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
  background: var(--color-accent-500);
  color: var(--color-brand-900);
}
</style>
