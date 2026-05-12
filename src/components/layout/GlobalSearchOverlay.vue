<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Search, X, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { useGlobalSearch, type SearchResult } from '@/composables/useGlobalSearch'

/**
 * Command-palette-style global search. Opens via the topbar search
 * button OR Cmd/Ctrl+K from anywhere. Aggregates pages, quick links,
 * hospitals, stations, and training sessions via useGlobalSearch().
 *
 * Keyboard: arrow keys to navigate, Enter to open, Esc to close.
 * Mouse / touch: tap a result to open. Quick-link results open in a
 * new tab; internal routes navigate in-place.
 */

const open = ref(false)
const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const activeIdx = ref(0)
const router = useRouter()
const { search } = useGlobalSearch()

const buckets = computed(() => search(query.value))

/* Flat list of results in display order — used for arrow-key
   navigation across categories. */
const flatResults = computed<SearchResult[]>(() =>
  buckets.value.flatMap((b) => b.results),
)

const activeResult = computed(() => flatResults.value[activeIdx.value] ?? null)

function openOverlay() {
  open.value = true
  query.value = ''
  activeIdx.value = 0
}

function closeOverlay() {
  open.value = false
}

function handleSelect(r: SearchResult) {
  if (r.href) {
    window.open(r.href, '_blank', 'noopener,noreferrer')
  } else if (r.to) {
    void router.push(r.hash ? { path: r.to, hash: r.hash } : { path: r.to })
  }
  closeOverlay()
}

function onKey(e: KeyboardEvent) {
  /* Cmd/Ctrl + K opens (or closes) from anywhere. */
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (open.value) closeOverlay()
    else openOverlay()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeOverlay()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (flatResults.value.length === 0) return
    activeIdx.value = (activeIdx.value + 1) % flatResults.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (flatResults.value.length === 0) return
    activeIdx.value =
      (activeIdx.value - 1 + flatResults.value.length) % flatResults.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeResult.value) handleSelect(activeResult.value)
  }
}

function onOpenEvent() {
  openOverlay()
}

watch(query, () => {
  /* Reset selection to top when the query changes. */
  activeIdx.value = 0
})

watch(open, async (v) => {
  if (v) {
    document.body.style.overflow = 'hidden'
    await nextTick()
    inputEl.value?.focus()
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => {
  window.addEventListener('wcems:open-search', onOpenEvent)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('wcems:open-search', onOpenEvent)
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})

/* Resolve which display index belongs to which flat-index — used to
   highlight the active item across grouped buckets. */
function indexOfResult(r: SearchResult): number {
  return flatResults.value.findIndex((x) => x.id === r.id)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="gso">
      <div v-if="open" class="gso-overlay" @click.self="closeOverlay">
        <div class="gso-modal" role="dialog" aria-label="Site search">
          <div class="gso-modal__head">
            <Search :size="16" :stroke-width="1.9" class="gso-modal__head-icon" />
            <input
              ref="inputEl"
              v-model="query"
              type="search"
              placeholder="Search the intranet…"
              aria-label="Search the intranet"
              autocomplete="off"
              class="gso-modal__input"
            />
            <button
              type="button"
              class="gso-modal__close"
              aria-label="Close search"
              @click="closeOverlay"
            >
              <X :size="16" />
            </button>
          </div>

          <div class="gso-modal__body">
            <div v-if="flatResults.length === 0" class="gso-empty">
              <template v-if="query.trim()">
                No matches for "{{ query }}".
              </template>
              <template v-else>
                Type to search pages, quick links, hospitals, stations, and training.
              </template>
            </div>

            <div v-else class="gso-buckets">
              <section v-for="bucket in buckets" :key="bucket.category" class="gso-bucket">
                <div class="gso-bucket__head">{{ bucket.label }}</div>
                <ul class="gso-list">
                  <li v-for="r in bucket.results" :key="r.id">
                    <button
                      type="button"
                      class="gso-row"
                      :class="{ 'gso-row--active': indexOfResult(r) === activeIdx }"
                      @click="handleSelect(r)"
                      @mouseenter="activeIdx = indexOfResult(r)"
                    >
                      <span class="gso-row__icon">
                        <component :is="r.icon" :size="14" :stroke-width="1.85" />
                      </span>
                      <span class="gso-row__text">
                        <span class="gso-row__title">{{ r.title }}</span>
                        <span v-if="r.subtitle" class="gso-row__sub">{{ r.subtitle }}</span>
                      </span>
                      <span v-if="r.href" class="gso-row__hint">External</span>
                    </button>
                  </li>
                </ul>
              </section>
            </div>
          </div>

          <footer class="gso-modal__foot">
            <span class="gso-foot__hint">
              <ArrowUp :size="10" :stroke-width="2.2" />
              <ArrowDown :size="10" :stroke-width="2.2" />
              <span>navigate</span>
            </span>
            <span class="gso-foot__hint">
              <CornerDownLeft :size="10" :stroke-width="2.2" />
              <span>open</span>
            </span>
            <span class="gso-foot__hint">
              <kbd>esc</kbd>
              <span>close</span>
            </span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gso-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: oklch(0.18 0.015 260 / 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 16px 16px;
}
@media (max-width: 639px) {
  .gso-overlay {
    padding: 12px;
    align-items: stretch;
  }
}

.gso-modal {
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (max-width: 639px) {
  .gso-modal {
    max-height: none;
    flex: 1;
  }
}

.gso-modal__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-line-soft);
}
.gso-modal__head-icon {
  color: var(--color-muted);
  flex-shrink: 0;
}
.gso-modal__input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-sans);
  font-size: 15px;
  color: var(--color-ink);
  min-width: 0;
}
.gso-modal__input::placeholder {
  color: var(--color-muted-soft);
}
.gso-modal__close {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--color-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.gso-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.gso-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px;
}

.gso-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

.gso-buckets {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gso-bucket {
  display: flex;
  flex-direction: column;
}
.gso-bucket__head {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 6px 14px 4px;
}
.gso-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.gso-row {
  width: 100%;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-family: inherit;
  transition: background 100ms var(--ease-out);
}
.gso-row--active {
  background: var(--color-surface-soft);
}
.gso-row__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: 1px solid var(--color-brand-100);
}
.gso-row--active .gso-row__icon {
  background: var(--color-brand-100);
}
.gso-row__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.gso-row__title {
  font-size: 14px;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gso-row__sub {
  font-size: 11.5px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gso-row__hint {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 8px;
}

.gso-modal__foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--color-line-soft);
  flex-wrap: wrap;
}
.gso-foot__hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-muted);
}
.gso-foot__hint kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--color-ink-soft);
}

.gso-enter-active,
.gso-leave-active {
  transition:
    opacity 180ms var(--ease-out),
    transform 180ms var(--ease-out);
}
.gso-enter-from,
.gso-leave-to {
  opacity: 0;
}
.gso-enter-from .gso-modal,
.gso-leave-to .gso-modal {
  transform: translateY(-8px);
  opacity: 0;
}
</style>
