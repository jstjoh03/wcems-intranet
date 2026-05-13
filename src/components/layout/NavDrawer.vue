<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Activity,
  MapPin,
  GraduationCap,
  Bell,
  Camera,
  Users,
  X,
  LogOut,
  Hospital,
  BarChart3,
  Building2,
  Briefcase,
  Settings,
  LayoutGrid,
  Home,
  Newspaper,
  Film,
  Contact,
  ChevronDown,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import Avatar from '@/components/primitives/Avatar.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

/* "On this page" anchors only make sense on the dashboard — every
   other route has its own content and no #section hashes. */
const isOnDashboard = computed(() => route.path === '/')

/* Collapse state for the "On this page" section. Default expanded so
   users discover the anchors on first open; localStorage-backed so the
   choice sticks across nav opens + sessions. The list is 7 items long
   and was pushing Pages below the fold on shorter phones — Justin's
   ask. */
const ON_THIS_PAGE_KEY = 'wcems:nav:on-this-page-collapsed'
const onThisPageCollapsed = ref(false)
try {
  onThisPageCollapsed.value = localStorage.getItem(ON_THIS_PAGE_KEY) === '1'
} catch {
  /* localStorage blocked (private mode, etc.) — fall through to default. */
}
function toggleOnThisPage() {
  onThisPageCollapsed.value = !onThisPageCollapsed.value
  try {
    localStorage.setItem(ON_THIS_PAGE_KEY, onThisPageCollapsed.value ? '1' : '0')
  } catch {
    /* No persistence in private mode — toggle still works in-session. */
  }
}

interface NavItem {
  id?: string
  label: string
  to?: string
  icon: typeof Activity
  hash?: string
  badge?: string
}

/* Order mirrors the dashboard's actual top-to-bottom render
   (Operations → Announcements → People → Stations → Training in
   sidebar → Photos → Newsletter) so the nav reads as a table of
   contents for the page in front of you. */
const sections: NavItem[] = [
  { id: 'operations', label: 'Operations', icon: Activity, hash: '#operations' },
  { id: 'announcements', label: 'Announcements', icon: Bell, hash: '#announcements' },
  { id: 'people', label: 'People', icon: Users, hash: '#people' },
  { id: 'stations', label: 'Stations', icon: MapPin, hash: '#stations' },
  { id: 'training', label: 'Upcoming Classes', icon: GraduationCap, hash: '#training' },
  { id: 'photos', label: 'Around the County', icon: Camera, hash: '#photos' },
  { id: 'newsletter', label: 'Newsletter', icon: Newspaper, hash: '#newsletter' },
]

const pages: NavItem[] = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Hospitals', to: '/hospitals', icon: Hospital },
  { label: 'Upcoming Classes', to: '/training', icon: GraduationCap },
  { label: 'Training Library', to: '/training/recordings', icon: Film },
  { label: 'Employee Directory', to: '/directory', icon: Contact },
  { label: 'Call Volume Insights', to: '/insights', icon: BarChart3 },
  { label: 'Admin Staff', to: '/admin-staff', icon: Building2 },
  { label: 'HR Hub', to: '/', icon: Briefcase, badge: 'Soon' },
]
const adminPages: NavItem[] = [
  { label: 'Manage Employees', to: '/admin/employees', icon: Users },
  { label: 'Manage Stations', to: '/admin/stations', icon: Settings },
  { label: 'Manage Hospitals', to: '/admin/hospitals', icon: Hospital },
  { label: 'Manage Call Volume', to: '/admin/call-volume', icon: BarChart3 },
  { label: 'Manage Classes', to: '/admin/training', icon: GraduationCap },
  { label: 'Manage Training Library', to: '/admin/training-recordings', icon: Film },
  { label: 'Manage Quick Links', to: '/admin/quick-links', icon: LayoutGrid },
]

function jumpTo(item: NavItem) {
  if (item.to) {
    router.push(item.to)
  } else if (item.hash) {
    if (router.currentRoute.value.path !== '/') {
      router.push({ path: '/', hash: item.hash })
    } else {
      const el = document.getElementById(item.hash.replace('#', ''))
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  emit('close')
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onEsc)
      document.body.style.overflow = 'hidden'
    } else {
      window.removeEventListener('keydown', onEsc)
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  document.body.style.overflow = ''
})

/* Same flow as UserDropdown.signOut — clear the session, then push
   to /signin so the signed-out state is immediately visible. The
   router instance is already imported at the top of this file. */
async function signOut() {
  emit('close')
  await auth.signOut()
  void router.push({ name: 'signin' })
}

/* Dispatch a window event consumed by UserProfileModal mounted in
   AppShell. Same decoupled pattern as the search overlay opener —
   keeps NavDrawer ignorant of the modal's existence. We also close
   the drawer so the user lands on the modal, not on the drawer. */
function openProfile() {
  emit('close')
  window.dispatchEvent(new CustomEvent('wcems:open-profile'))
}
</script>

<template>
  <div
    class="drawer-overlay"
    :class="{ 'drawer-overlay--open': open }"
    aria-hidden="true"
    @click="$emit('close')"
  />

  <nav
    class="drawer"
    :class="{ 'drawer--open': open }"
    aria-label="Navigation"
    :aria-hidden="!open"
  >
    <div class="drawer__header">
      <div class="drawer__brand">
        <img src="/wcems-patch.png" alt="" class="drawer__patch" width="36" height="36" />
        <div class="leading-tight">
          <div class="display text-[15px]" style="color: var(--color-ink)">Waller County EMS</div>
          <div class="drawer__brand-sub">Intranet</div>
        </div>
      </div>
      <button class="drawer__close" aria-label="Close menu" @click="$emit('close')">
        <X :size="18" />
      </button>
    </div>

    <div class="drawer__body">
      <section v-if="isOnDashboard">
        <button
          type="button"
          class="nav-section-toggle"
          :aria-expanded="!onThisPageCollapsed"
          aria-controls="nav-on-this-page"
          @click="toggleOnThisPage"
        >
          <Eyebrow>On this page</Eyebrow>
          <ChevronDown
            :size="14"
            :stroke-width="2"
            class="nav-section-toggle__chev"
            :class="{ 'nav-section-toggle__chev--collapsed': onThisPageCollapsed }"
          />
        </button>
        <div
          id="nav-on-this-page"
          class="nav-collapsible"
          :class="{ 'nav-collapsible--closed': onThisPageCollapsed }"
        >
          <div class="nav-collapsible__inner space-y-0.5">
            <button
              v-for="s in sections"
              :key="s.label"
              type="button"
              class="nav-item"
              @click="jumpTo(s)"
            >
              <component :is="s.icon" :size="16" :stroke-width="1.85" class="nav-item__icon" />
              <span>{{ s.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <section class="mt-6">
        <Eyebrow class="px-2 mb-2">Pages</Eyebrow>
        <div class="space-y-0.5">
          <button
            v-for="p in pages"
            :key="p.label"
            type="button"
            class="nav-item"
            @click="jumpTo(p)"
          >
            <component :is="p.icon" :size="16" :stroke-width="1.85" class="nav-item__icon" />
            <span>{{ p.label }}</span>
            <span v-if="p.badge" class="nav-item__badge">{{ p.badge }}</span>
          </button>
        </div>
      </section>

      <section v-if="auth.isAdmin" class="mt-6">
        <Eyebrow class="px-2 mb-2">Admin</Eyebrow>
        <div class="space-y-0.5">
          <button
            v-for="p in adminPages"
            :key="p.label"
            type="button"
            class="nav-item"
            @click="jumpTo(p)"
          >
            <component :is="p.icon" :size="16" :stroke-width="1.85" class="nav-item__icon" />
            <span>{{ p.label }}</span>
            <span v-if="p.badge" class="nav-item__badge">{{ p.badge }}</span>
          </button>
        </div>
      </section>
    </div>

    <footer class="drawer__footer">
      <!-- Whole row opens the profile modal; the sign-out icon escapes
           the row click via @click.stop so the existing quick sign-out
           gesture keeps working. -->
      <button type="button" class="drawer__user" @click="openProfile">
        <Avatar
          :photo-url="auth.appUser?.photoUrl ?? null"
          :initials="auth.appUser?.initials ?? '?'"
          size="md"
          tone="on-light"
        />
        <div class="flex-1 min-w-0 text-left">
          <div class="display text-[14.5px] truncate" style="color: var(--color-ink)">
            {{ auth.appUser?.fullName }}
          </div>
          <div class="drawer__user-hint">View profile</div>
        </div>
        <span
          class="drawer__signout"
          role="button"
          aria-label="Sign out"
          tabindex="0"
          @click.stop="signOut"
          @keydown.enter.stop="signOut"
          @keydown.space.prevent.stop="signOut"
        >
          <LogOut :size="15" />
        </span>
      </button>
    </footer>
  </nav>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0);
  z-index: 49;
  pointer-events: none;
  transition: background 250ms var(--ease-out);
}
.drawer-overlay--open {
  background: oklch(0.18 0.015 260 / 0.45);
  pointer-events: auto;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 320px;
  max-width: 85vw;
  background: var(--color-surface);
  border-right: 1px solid var(--color-line);
  transform: translateX(-100%);
  transition: transform 280ms var(--ease-out);
  z-index: 50;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}
.drawer--open {
  transform: translateX(0);
}

.drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-line);
}
.drawer__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drawer__patch {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.drawer__brand-sub {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}
.drawer__close {
  background: transparent;
  border: none;
  padding: 6px;
  border-radius: 6px;
  color: var(--color-muted);
  cursor: pointer;
}
.drawer__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 12px;
}

/* Section toggle — clickable Eyebrow + chevron header for the
   collapsible "On this page" section. Lives outside .nav-item styling
   so it doesn't read as a navigation link itself. */
.nav-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  margin-bottom: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
  transition: background 120ms var(--ease-out);
}
.nav-section-toggle:hover {
  background: var(--color-surface-soft);
}
.nav-section-toggle__chev {
  color: var(--color-muted);
  transition: transform 180ms var(--ease-out);
  flex-shrink: 0;
}
.nav-section-toggle__chev--collapsed {
  transform: rotate(-90deg);
}

/* grid-template-rows trick: animate between `1fr` and `0fr` to smoothly
   collapse a section whose inner content is variable-height. Requires
   an inner wrapper with overflow:hidden + min-height:0 so the rows
   actually compress. Falls back to instant snap in older browsers
   (grid-template-rows transitions landed in Chrome 117 / Safari 17.4
   / Firefox 124 — fine for our user base today). */
.nav-collapsible {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 200ms var(--ease-out);
}
.nav-collapsible--closed {
  grid-template-rows: 0fr;
}
.nav-collapsible__inner {
  overflow: hidden;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 7px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out);
}
.nav-item:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}
.nav-item__icon {
  color: var(--color-muted);
  flex-shrink: 0;
  transition: color 120ms var(--ease-out);
}
.nav-item:hover .nav-item__icon {
  color: var(--color-brand-600);
}
.nav-item__badge {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-surface-soft);
  color: var(--color-muted);
}

.drawer__footer {
  padding: 12px;
  border-top: 1px solid var(--color-line);
}
.drawer__user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid transparent;
  width: 100%;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
  font: inherit;
}
.drawer__user:hover {
  background: var(--color-surface);
  border-color: var(--color-line);
}
.drawer__user-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
  margin-top: 2px;
}
.drawer__user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.drawer__signout {
  background: transparent;
  border: none;
  padding: 8px;
  border-radius: 6px;
  color: var(--color-muted);
  cursor: pointer;
}
.drawer__signout:hover {
  background: var(--color-surface);
  color: var(--color-ink);
}
</style>
