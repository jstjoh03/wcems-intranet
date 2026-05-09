<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import {
  LayoutGrid,
  ChevronUp,
  X,
  Settings2,
  Pin,
  Search,
  ExternalLink,
} from 'lucide-vue-next'
import IconRender from '@/components/primitives/IconRender.vue'
import linksData from '@/data/quicklinks.json'
import type { QuickLink } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useUserLinkPreferences } from '@/composables/useUserLinkPreferences'

/**
 * Floating dock + slide-up sheet for the Quick Links system.
 *
 * Replaces the old in-page grid section. The dock is a small fixed
 * pill at the bottom of the viewport — visible on every route. Tapping
 * opens a sheet:
 *
 *   - Mobile (< 640px): full-width sheet rising from the bottom edge
 *   - Desktop (>= 640px): popover panel above the dock pill
 *
 * Pinned tiles render as small icon-only chips inline on the dock so
 * the user's most-used shortcuts are one tap away without opening the
 * sheet at all.
 */
const auth = useAuthStore()
const links = linksData as QuickLink[]
const userId = computed(() => auth.appUser?.id ?? 'anonymous')
const { getPref, togglePin, toggleHide } = useUserLinkPreferences(userId.value)

const open = ref(false)
const customizing = ref(false)
const search = ref('')

const visibleLinks = computed(() => {
  const role = auth.role.value ?? 'crew'
  return links.filter((l) => l.visibleTo.includes(role))
})

const pinned = computed(() =>
  visibleLinks.value.filter((l) => getPref(l.id).pinned),
)

const filteredAll = computed(() => {
  const q = search.value.trim().toLowerCase()
  let arr = visibleLinks.value
  if (!customizing.value) arr = arr.filter((l) => !getPref(l.id).hidden)
  if (q) {
    arr = arr.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        (l.sub ?? '').toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q),
    )
  }
  return arr
})

const groupedFiltered = computed(() => {
  const grouped = new Map<string, QuickLink[]>()
  for (const l of filteredAll.value) {
    const arr = grouped.get(l.category) ?? []
    arr.push(l)
    grouped.set(l.category, arr)
  }
  for (const [, arr] of grouped) arr.sort((a, b) => a.defaultSort - b.defaultSort)
  return Array.from(grouped.entries())
})

function closeSheet() {
  open.value = false
  search.value = ''
  customizing.value = false
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) closeSheet()
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('keydown', onEsc)
    document.body.style.overflow = 'hidden'
  } else {
    window.removeEventListener('keydown', onEsc)
    document.body.style.overflow = ''
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  document.body.style.overflow = ''
})
</script>

<template>
  <!-- Backdrop -->
  <Transition name="qld-backdrop">
    <div v-if="open" class="qld-backdrop" @click="closeSheet" />
  </Transition>

  <!-- Sheet -->
  <Transition name="qld-sheet">
    <section
      v-if="open"
      class="qld-sheet"
      role="dialog"
      aria-label="Quick Links"
    >
      <header class="qld-sheet__head">
        <div class="qld-sheet__title">
          <LayoutGrid :size="14" :stroke-width="1.85" />
          <span class="eyebrow">Quick Links</span>
          <span class="qld-sheet__count">{{ visibleLinks.length }}</span>
        </div>
        <div class="qld-sheet__actions">
          <button
            type="button"
            class="qld-sheet__customize"
            :class="{ 'qld-sheet__customize--on': customizing }"
            @click="customizing = !customizing"
          >
            <component :is="customizing ? X : Settings2" :size="13" :stroke-width="1.85" />
            {{ customizing ? 'Done' : 'Customize' }}
          </button>
          <button
            type="button"
            class="qld-sheet__close"
            aria-label="Close"
            @click="closeSheet"
          >
            <X :size="16" />
          </button>
        </div>
      </header>

      <div class="qld-sheet__search">
        <Search :size="13" :stroke-width="1.85" />
        <input
          v-model="search"
          type="search"
          placeholder="Search links…"
          aria-label="Search quick links"
          autocomplete="off"
        />
      </div>

      <div class="qld-sheet__body">
        <!-- Pinned -->
        <div v-if="pinned.length > 0 && !search" class="qld-section">
          <div class="qld-section__head">
            <Pin :size="11" :stroke-width="2" />
            <span class="eyebrow">Pinned</span>
          </div>
          <ul class="qld-list">
            <li v-for="l in pinned" :key="l.id">
              <a :href="l.url" target="_blank" rel="noopener noreferrer" class="qld-row qld-row--pinned">
                <span class="qld-row__icon">
                  <IconRender :name="l.iconName" :size="14" />
                </span>
                <span class="qld-row__text">
                  <span class="qld-row__name">{{ l.label }}</span>
                  <span v-if="l.sub" class="qld-row__sub">{{ l.sub }}</span>
                </span>
                <button
                  v-if="customizing"
                  type="button"
                  class="qld-row__pin qld-row__pin--on"
                  :aria-label="'Unpin'"
                  @click.stop.prevent="togglePin(l.id)"
                >
                  <Pin :size="11" :stroke-width="2.2" />
                </button>
                <ExternalLink v-else :size="11" class="qld-row__arrow" />
              </a>
            </li>
          </ul>
        </div>

        <div
          v-for="[category, items] in groupedFiltered"
          :key="category"
          class="qld-section"
        >
          <div class="qld-section__head">
            <span class="eyebrow">{{ category }}</span>
          </div>
          <ul class="qld-list">
            <li v-for="l in items" :key="l.id">
              <a :href="l.url" target="_blank" rel="noopener noreferrer" class="qld-row">
                <span class="qld-row__icon">
                  <IconRender :name="l.iconName" :size="14" />
                </span>
                <span class="qld-row__text">
                  <span class="qld-row__name">{{ l.label }}</span>
                  <span v-if="l.sub" class="qld-row__sub">{{ l.sub }}</span>
                </span>
                <span v-if="customizing" class="qld-row__controls">
                  <button
                    type="button"
                    class="qld-row__pin"
                    :class="{ 'qld-row__pin--on': getPref(l.id).pinned }"
                    :aria-label="getPref(l.id).pinned ? 'Unpin' : 'Pin'"
                    :aria-pressed="getPref(l.id).pinned ?? false"
                    @click.stop.prevent="togglePin(l.id)"
                  >
                    <Pin :size="11" :stroke-width="2.2" />
                  </button>
                  <button
                    type="button"
                    class="qld-row__hide"
                    :class="{ 'qld-row__hide--on': getPref(l.id).hidden }"
                    :aria-label="getPref(l.id).hidden ? 'Show' : 'Hide'"
                    @click.stop.prevent="toggleHide(l.id)"
                  >
                    {{ getPref(l.id).hidden ? 'Show' : 'Hide' }}
                  </button>
                </span>
                <ExternalLink v-else :size="11" class="qld-row__arrow" />
              </a>
            </li>
          </ul>
        </div>

        <div v-if="search && filteredAll.length === 0" class="qld-empty">
          No links match "{{ search }}".
        </div>
      </div>
    </section>
  </Transition>

  <!-- Dock pill — always visible -->
  <button
    type="button"
    class="qld-pill"
    :class="{ 'qld-pill--open': open }"
    :aria-expanded="open"
    aria-haspopup="dialog"
    aria-label="Open quick links"
    @click="open = !open"
  >
    <span class="qld-pill__icon">
      <LayoutGrid :size="14" :stroke-width="2" />
    </span>
    <span class="qld-pill__label">Quick Links</span>
    <span class="qld-pill__count">{{ visibleLinks.length }}</span>
    <ChevronUp :size="13" class="qld-pill__chev" />
  </button>
</template>

<style scoped>
/* ── Floating dock pill ────────────────────────────────────────────── */
.qld-pill {
  position: fixed;
  z-index: 35;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px 9px 12px;
  border-radius: 999px;
  background: var(--color-brand-900);
  color: white;
  border: 1px solid var(--color-brand-700);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  box-shadow:
    0 1px 2px oklch(0.18 0.015 260 / 0.16),
    0 8px 24px oklch(0.18 0.015 260 / 0.18),
    inset 0 1px 0 oklch(1 0 0 / 0.06);
  transition:
    transform 200ms var(--ease-out),
    box-shadow 200ms var(--ease-out),
    background 200ms var(--ease-out);
}
.qld-pill:hover {
  background: var(--color-brand-800);
  transform: translateX(-50%) translateY(-2px);
  box-shadow:
    0 1px 2px oklch(0.18 0.015 260 / 0.18),
    0 12px 32px oklch(0.18 0.015 260 / 0.22),
    inset 0 1px 0 oklch(1 0 0 / 0.06);
}
.qld-pill--open {
  background: var(--color-brand-800);
}
.qld-pill__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
}
.qld-pill__label {
  white-space: nowrap;
}
.qld-pill__count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-brand-700);
  color: oklch(0.85 0.04 86.8);
}
.qld-pill__chev {
  color: var(--color-accent-500);
  transition: transform 200ms var(--ease-out);
}
.qld-pill--open .qld-pill__chev {
  transform: rotate(180deg);
}

@media (min-width: 768px) {
  .qld-pill {
    left: auto;
    right: 28px;
    transform: none;
    bottom: 24px;
  }
  .qld-pill:hover {
    transform: translateY(-2px);
  }
}

/* ── Backdrop + sheet ──────────────────────────────────────────────── */
.qld-backdrop {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.4);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 33;
}

.qld-sheet {
  position: fixed;
  z-index: 34;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow:
    0 -2px 4px oklch(0.18 0.015 260 / 0.04),
    0 -16px 48px oklch(0.18 0.015 260 / 0.2),
    inset 0 1px 0 oklch(1 0 0 / 0.6);

  /* Mobile: full-width slide-up sheet */
  bottom: 0;
  left: 0;
  right: 0;
  border-radius: 18px 18px 0 0;
  max-height: 84dvh;
}
@media (min-width: 768px) {
  .qld-sheet {
    /* Desktop: popover panel above the dock pill on the right */
    left: auto;
    right: 28px;
    bottom: 80px;
    width: 420px;
    max-height: 70dvh;
    border-radius: 16px;
  }
}

.qld-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-line-soft);
  flex-shrink: 0;
}
.qld-sheet__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-muted);
}
.qld-sheet__count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.qld-sheet__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.qld-sheet__customize {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.qld-sheet__customize:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.qld-sheet__customize--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.qld-sheet__close {
  background: transparent;
  border: none;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-muted);
}
.qld-sheet__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.qld-sheet__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 14px 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  color: var(--color-muted);
  flex-shrink: 0;
}
.qld-sheet__search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  min-width: 0;
}
.qld-sheet__body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 6px 80px;
}

/* ── List rows ─────────────────────────────────────────────────────── */
.qld-section {
  margin-bottom: 14px;
}
.qld-section__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 6px;
  color: var(--color-muted);
}
.qld-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qld-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--color-ink);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.qld-row:hover {
  background: var(--color-surface-soft);
}
.qld-row--pinned {
  background: oklch(0.99 0.01 86.8);
  border: 1px solid oklch(0.92 0.07 86.8);
}
.qld-row--pinned:hover {
  background: oklch(0.97 0.04 86.8);
}

.qld-row__icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--color-brand-50);
  color: var(--color-brand-600);
  border: 1px solid var(--color-brand-100);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.qld-row__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.qld-row__name {
  font-family: var(--font-display);
  font-size: 15px;
  letter-spacing: -0.005em;
  line-height: 1.15;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qld-row__sub {
  font-size: 11px;
  color: var(--color-muted);
  font-weight: 500;
}
.qld-row__arrow {
  color: var(--color-muted-soft);
}
.qld-row__controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qld-row__pin,
.qld-row__hide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  padding: 3px 8px;
  transition: all 120ms var(--ease-out);
}
.qld-row__pin {
  width: 26px;
  height: 26px;
  padding: 0;
}
.qld-row__pin:hover,
.qld-row__hide:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.qld-row__pin--on {
  color: var(--color-accent-700);
  border-color: oklch(0.85 0.07 86.8);
  background: oklch(0.99 0.01 86.8);
}
.qld-row__hide--on {
  color: var(--color-danger-500);
  border-color: oklch(0.85 0.07 20);
}

.qld-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-muted);
  font-size: 13px;
}

/* ── Transitions ───────────────────────────────────────────────────── */
.qld-backdrop-enter-active,
.qld-backdrop-leave-active {
  transition: opacity 250ms var(--ease-out);
}
.qld-backdrop-enter-from,
.qld-backdrop-leave-to {
  opacity: 0;
}

.qld-sheet-enter-active,
.qld-sheet-leave-active {
  transition:
    transform 320ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.qld-sheet-enter-from,
.qld-sheet-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
@media (max-width: 767px) {
  .qld-sheet-enter-from,
  .qld-sheet-leave-to {
    transform: translateY(100%);
  }
}
</style>
