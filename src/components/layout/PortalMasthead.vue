<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { Search, ChevronDown } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'

/**
 * Desktop masthead + primary nav (approved portal mockup v2): serif
 * wordmark with the crest, a search field that opens the global
 * overlay, and a horizontal navy nav bar with gold active states.
 *
 * Nav shape:
 *  - plain items route in-app
 *  - `external` items open satellites in a new tab until each app is
 *    absorbed as a section (Protocols flips to a route in Phase 3)
 *  - `children` render a dropdown; Systems is generated from the
 *    admin-curated quick_links catalog (grouped by category) so the
 *    menu stays editable in-app
 */
interface NavChild {
  label: string
  to?: string
  url?: string
  category?: string
}
interface NavItem {
  label: string
  to?: string
  url?: string
  children?: NavChild[]
  adminOnly?: boolean
  match?: string // route-prefix that marks this item active
}

const auth = useAuthStore()
const route = useRoute()
const { links } = useQuickLinks()

const ADMIN_CHILDREN: NavChild[] = [
  { label: 'Manage Employees', to: '/admin/employees' },
  { label: 'Manage Stations', to: '/admin/stations' },
  { label: 'Manage Hospitals', to: '/admin/hospitals' },
  { label: 'Manage Call Volume', to: '/admin/call-volume' },
  { label: 'Manage Classes', to: '/admin/training' },
  { label: 'Manage Training Library', to: '/admin/training-recordings' },
  { label: 'Manage Required Training', to: '/admin/required-training' },
  { label: 'Manage Policies', to: '/admin/policies' },
  { label: 'Manage Admin Staff', to: '/admin/admin-staff' },
  { label: 'Manage Quick Links', to: '/admin/quick-links' },
  { label: 'Usage', to: '/admin/usage' },
]

const nav = computed<NavItem[]>(() => [
  { label: 'Home', to: '/', match: 'exact-home' },
  { label: 'Directory', to: '/directory', match: '/directory' },
  { label: 'Protocols', to: '/protocols', match: '/protocols' },
  {
    label: 'Training',
    match: '/training',
    children: [
      { label: 'Upcoming Classes', to: '/training' },
      { label: 'Training Library', to: '/training/recordings' },
      { label: 'Required Training', to: '/training/required' },
      /* Same route adapts per viewer: full pipeline board for
         supervisors/editors/FTOs, own progress for crew. Label follows
         role; FTO crew still get the board when they land. */
      {
        label: auth.isSupervisor ? 'Clinical Development' : 'My Progress',
        to: '/clinical-development',
      },
    ],
  },
  { label: 'Policies', to: '/policies', match: '/policies' },
  { label: 'Hospitals', to: '/hospitals', match: '/hospitals' },
  { label: 'MIH Referral', to: '/mih-referral', match: '/mih-referral' },
  { label: 'Uniforms', url: 'https://uniforms.wallercountyems.com' },
  {
    label: 'Systems',
    children: links.value.map((l) => ({
      label: l.label,
      url: l.url,
      category: l.category,
    })),
  },
  ...(auth.isAdmin
    ? [{ label: 'Admin', match: '/admin', children: ADMIN_CHILDREN, adminOnly: true } as NavItem]
    : []),
])

function isActive(item: NavItem): boolean {
  if (item.match === 'exact-home') return route.path === '/'
  if (!item.match) return false
  return route.path.startsWith(item.match)
}

/* One dropdown open at a time; closes on route change, outside click,
   or Escape. */
const openMenu = ref<string | null>(null)
function toggleMenu(label: string) {
  openMenu.value = openMenu.value === label ? null : label
}
function closeMenus() {
  openMenu.value = null
}
function onDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest?.('.mh-nav__dd')) closeMenus()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenus()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

/** Group a dropdown's children by category (Systems menu); items
 *  without a category land in a single unnamed group (Training/Admin). */
function grouped(children: NavChild[]): Array<{ category: string; items: NavChild[] }> {
  const map = new Map<string, NavChild[]>()
  for (const c of children) {
    const key = c.category ?? ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(c)
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
}

function openSearch() {
  window.dispatchEvent(new CustomEvent('wcems:open-search'))
}
</script>

<template>
  <header class="mh">
    <div class="mh__top">
      <RouterLink to="/" class="mh__wordmark">
        <img src="/wcems-patch.png" alt="" class="mh__crest" width="52" height="52" />
        <div>
          <h1 class="mh__title display">Waller County EMS</h1>
          <div class="mh__tag">Employee Portal</div>
        </div>
      </RouterLink>

      <button type="button" class="mh__search" aria-label="Search the portal" @click="openSearch">
        <Search :size="14" class="mh__search-icon" />
        <span class="mh__search-ph">Search people, policies, protocols…</span>
        <kbd class="mh__kbd">⌘K</kbd>
      </button>
    </div>

    <nav class="mh-nav" aria-label="Primary">
      <div class="mh-nav__inner">
        <template v-for="item in nav" :key="item.label">
          <!-- dropdown item -->
          <div v-if="item.children" class="mh-nav__dd">
            <button
              class="mh-nav__link"
              :class="{ 'mh-nav__link--on': isActive(item) || openMenu === item.label }"
              :aria-expanded="openMenu === item.label"
              @click="toggleMenu(item.label)"
            >
              {{ item.label }}
              <ChevronDown :size="12" class="mh-nav__caret" :class="{ 'mh-nav__caret--open': openMenu === item.label }" />
            </button>
<!-- Explicit duration: Vue then uses a timer instead of waiting on
                 transitionend, which never fires in throttled background
                 tabs and would leave a closing panel stuck in the DOM. -->
            <Transition name="dd" :duration="140">
              <div v-if="openMenu === item.label" class="mh-nav__panel" :class="{ 'mh-nav__panel--wide': item.label === 'Systems' }">
                <div v-for="g in grouped(item.children)" :key="g.category" class="mh-nav__group">
                  <div v-if="g.category" class="mh-nav__group-label">{{ g.category }}</div>
                  <template v-for="c in g.items" :key="c.label">
                    <RouterLink
                      v-if="c.to"
                      :to="c.to"
                      class="mh-nav__panel-link"
                      @click="closeMenus"
                    >{{ c.label }}</RouterLink>
                    <a
                      v-else
                      :href="c.url"
                      target="_blank"
                      rel="noopener"
                      class="mh-nav__panel-link"
                      @click="closeMenus"
                    >{{ c.label }} <span class="mh-nav__ext">↗</span></a>
                  </template>
                </div>
              </div>
            </Transition>
          </div>

          <!-- external item -->
          <a
            v-else-if="item.url"
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="mh-nav__link"
          >{{ item.label }} <span class="mh-nav__ext">↗</span></a>

          <!-- internal item -->
          <RouterLink
            v-else
            :to="item.to!"
            class="mh-nav__link"
            :class="{ 'mh-nav__link--on': isActive(item) }"
          >{{ item.label }}</RouterLink>
        </template>
      </div>
    </nav>
  </header>
</template>

<style scoped>
.mh {
  background: var(--color-canvas);
}
.mh__top {
  max-width: 1400px;
  margin: 0 auto;
  padding: 22px 40px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
.mh__wordmark {
  display: flex;
  align-items: center;
  gap: 16px;
  text-decoration: none;
}
.mh__crest {
  width: 52px;
  height: 52px;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px oklch(0.18 0.015 260 / 0.18));
}
.mh__title {
  font-size: 30px;
  line-height: 1.05;
  color: var(--color-ink);
  letter-spacing: 0.005em;
}
.mh__tag {
  margin-top: 3px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-accent-600);
}
.mh__search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 380px;
  padding: 9px 14px;
  border-radius: 9px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-family: var(--font-sans);
  text-align: left;
  transition: border-color 140ms var(--ease-out), box-shadow 140ms var(--ease-out);
}
.mh__search:hover {
  border-color: var(--color-accent-500);
  box-shadow: var(--shadow-md);
}
.mh__search-icon {
  color: var(--color-muted);
  flex-shrink: 0;
}
.mh__search-ph {
  flex: 1;
  font-size: 13px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mh__kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--color-surface-sunk);
  color: var(--color-muted);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-line);
}

/* ── primary nav bar ─────────────────────────────────────────────── */
.mh-nav {
  position: sticky;
  top: 0;
  z-index: 40;
  background: var(--color-brand-900);
  border-bottom: 2px solid var(--color-accent-600);
}
.mh-nav__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 40px;
  display: flex;
  align-items: stretch;
}
.mh-nav__dd {
  position: relative;
  display: flex;
}
.mh-nav__link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.015em;
  color: oklch(0.82 0.025 250);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  position: relative;
  transition: color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.mh-nav__link:hover {
  color: white;
  background: var(--color-brand-800);
}
.mh-nav__link--on {
  color: var(--color-accent-on-dark);
}
.mh-nav__link--on::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  background: var(--color-accent-on-dark);
}
.mh-nav__ext {
  font-size: 10px;
  opacity: 0.6;
}
.mh-nav__caret {
  transition: transform 140ms var(--ease-out);
}
.mh-nav__caret--open {
  transform: rotate(180deg);
}

/* dropdown panel */
.mh-nav__panel {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 230px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 0 0 10px 10px;
  box-shadow: var(--shadow-lg);
  padding: 8px;
  z-index: 50;
}
.mh-nav__panel--wide {
  min-width: 300px;
  max-height: 70vh;
  overflow-y: auto;
}
.mh-nav__group + .mh-nav__group {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--color-line-soft);
}
.mh-nav__group-label {
  padding: 6px 10px 3px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-600);
}
.mh-nav__panel-link {
  display: block;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 450;
  color: var(--color-ink-soft);
  text-decoration: none;
  transition: background 100ms var(--ease-out), color 100ms var(--ease-out);
}
.mh-nav__panel-link:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.dd-enter-active,
.dd-leave-active {
  transition: opacity 130ms var(--ease-out), transform 130ms var(--ease-out);
}
.dd-enter-from,
.dd-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
