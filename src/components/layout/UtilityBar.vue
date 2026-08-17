<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'

/**
 * Desktop-only utility strip above the masthead — headline external
 * systems on the left, session identity on the right. Part of the
 * portal chrome (approved mockup v2): the portal is the front door,
 * the systems it branches into live one click away at the very top.
 *
 * Links come from the admin-curated quick_links catalog so the bar
 * stays editable in-app; SYSTEM_PRIORITY just picks which few earn a
 * permanent slot up here. Everything else is in the Systems menu.
 */
const SYSTEM_PRIORITY = ['ESO', 'Aladtec', 'Lexipol', 'Paycom', 'Operative IQ', 'Supply Portal']

const auth = useAuthStore()
const router = useRouter()
const { links } = useQuickLinks()

const systems = computed(() =>
  SYSTEM_PRIORITY
    .map((label) => links.value.find((l) => l.label === label))
    .filter((l): l is NonNullable<typeof l> => !!l),
)

const roles = ['crew', 'supervisor', 'admin'] as const
const isDev = import.meta.env.DEV

function openProfile() {
  window.dispatchEvent(new CustomEvent('wcems:open-profile'))
}

async function signOut() {
  await auth.signOut()
  router.push({ name: 'signin' })
}
</script>

<template>
  <div class="util">
    <div class="util__inner">
      <nav class="util__sys" aria-label="External systems">
        <a
          v-for="s in systems"
          :key="s.id"
          :href="s.url"
          target="_blank"
          rel="noopener"
        >{{ s.label }} <span class="util__ext">↗</span></a>
      </nav>

      <div class="util__session">
        <div v-if="isDev" class="util__dev" title="Dev only — production reads role from Entra ID">
          <span class="util__dev-tag">DEV</span>
          <button
            v-for="r in roles"
            :key="r"
            class="util__dev-btn"
            :class="{ 'util__dev-btn--active': auth.role === r }"
            @click="auth.setRole(r)"
          >
            {{ r }}
          </button>
        </div>
        <button class="util__user" @click="openProfile">
          <span class="util__dot" aria-hidden="true"></span>{{ auth.appUser?.fullName ?? 'Signed in' }}
        </button>
        <button class="util__signout" @click="signOut">Sign out</button>
      </div>
    </div>
  </div>
  <div class="util__goldseam" aria-hidden="true"></div>
</template>

<style scoped>
.util {
  background: var(--color-brand-950);
}
.util__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 7px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.util__sys {
  display: flex;
  align-items: center;
  gap: 22px;
}
.util__sys a {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: oklch(0.72 0.03 250);
  text-decoration: none;
  transition: color 120ms var(--ease-out);
}
.util__sys a:hover {
  color: var(--color-accent-on-dark);
}
.util__ext {
  font-size: 10px;
  opacity: 0.7;
}
.util__session {
  display: flex;
  align-items: center;
  gap: 18px;
}
.util__user {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  color: oklch(0.82 0.02 250);
}
.util__user:hover {
  color: white;
}
.util__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: oklch(0.7 0.17 150);
  box-shadow: 0 0 6px oklch(0.7 0.17 150 / 0.7);
}
.util__signout {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  color: oklch(0.62 0.03 250);
  transition: color 120ms var(--ease-out);
}
.util__signout:hover {
  color: var(--color-accent-on-dark);
}

/* Feathered gold seam — the signature divider from the design system */
.util__goldseam {
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(200, 164, 77, 0.55) 18%,
    #e8cb72 50%,
    rgba(200, 164, 77, 0.55) 82%,
    transparent
  );
}

.util__dev {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px 2px 1px 7px;
  border-radius: 7px;
  border: 1px dashed oklch(0.5 0.16 60);
}
.util__dev-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: oklch(0.7 0.16 60);
  margin-right: 4px;
}
.util__dev-btn {
  padding: 2px 8px;
  font-size: 9.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: oklch(0.78 0.02 250);
  cursor: pointer;
}
.util__dev-btn--active {
  background: var(--color-accent-on-dark);
  color: var(--color-brand-900);
}
</style>
