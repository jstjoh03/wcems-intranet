<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { X, RotateCcw, Save, Check } from 'lucide-vue-next'
import IconRender from '@/components/primitives/IconRender.vue'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'

/**
 * Pick up to 4 quick links to feature on the dashboard hero strip.
 * Tile 5 (Hospitals) stays fixed — not editable. Empty selection
 * resets to the user's role-based defaults.
 */

const MAX_SELECTED = 4

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const { links } = useQuickLinks()

const selectedIds = ref<string[]>([])
const error = ref<string | null>(null)
const saving = ref(false)

watch(
  () => props.open,
  (v) => {
    if (v) {
      selectedIds.value = [...(auth.appUser?.featuredQuickLinkIds ?? [])]
      error.value = null
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onEsc)
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEsc)
    }
  },
)
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEsc)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

/* Visibility-gate the picker to what this user is actually allowed
   to see in the dock (catalog rows respect `visibleTo`). */
const pickable = computed(() => {
  const role = auth.role ?? 'crew'
  return links.value.filter(
    (l) =>
      !l.visibleTo || l.visibleTo.length === 0 || l.visibleTo.includes(role),
  )
})

const grouped = computed(() => {
  const map = new Map<string, typeof pickable.value>()
  for (const l of pickable.value) {
    const key = l.category || 'Other'
    const arr = map.get(key) ?? []
    arr.push(l)
    map.set(key, arr)
  }
  for (const [, arr] of map) arr.sort((a, b) => a.defaultSort - b.defaultSort)
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
})

const selectedCount = computed(() => selectedIds.value.length)
const canSelectMore = computed(() => selectedCount.value < MAX_SELECTED)

function toggle(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) {
    selectedIds.value.splice(i, 1)
  } else if (canSelectMore.value) {
    selectedIds.value.push(id)
  }
}

function resetToDefaults() {
  selectedIds.value = []
}

async function submit() {
  saving.value = true
  error.value = null
  try {
    await auth.updateOwnFeaturedQuickLinks(selectedIds.value)
    saving.value = false
    emit('close')
  } catch (err) {
    saving.value = false
    error.value = (err as Error).message
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="flem">
      <div v-if="open" class="flem-overlay" @click.self="$emit('close')">
        <div class="flem-modal" role="dialog" aria-labelledby="flem-title">
          <header class="flem-modal__head">
            <div>
              <div class="flem-modal__eyebrow">Customize</div>
              <h2 id="flem-title" class="flem-modal__title display">
                Featured shortcuts
              </h2>
              <div class="flem-modal__hint">
                Pick up to {{ MAX_SELECTED }}. Empty falls back to the role default.
                <span class="flem-modal__count">
                  {{ selectedCount }} / {{ MAX_SELECTED }} selected
                </span>
              </div>
            </div>
            <button
              type="button"
              class="flem-modal__close"
              aria-label="Close"
              @click="$emit('close')"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="flem-modal__body">
            <section v-for="[cat, items] in grouped" :key="cat" class="flem-section">
              <div class="flem-section__head">{{ cat }}</div>
              <ul class="flem-list">
                <li v-for="l in items" :key="l.id">
                  <button
                    type="button"
                    class="flem-row"
                    :class="{
                      'flem-row--on': selectedIds.includes(l.id),
                      'flem-row--disabled':
                        !selectedIds.includes(l.id) && !canSelectMore,
                    }"
                    :aria-pressed="selectedIds.includes(l.id)"
                    @click="toggle(l.id)"
                  >
                    <span class="flem-row__icon">
                      <IconRender :name="l.iconName" :size="14" :stroke-width="1.85" />
                    </span>
                    <span class="flem-row__text">
                      <span class="flem-row__title">{{ l.label }}</span>
                      <span v-if="l.sub" class="flem-row__sub">{{ l.sub }}</span>
                    </span>
                    <span v-if="selectedIds.includes(l.id)" class="flem-row__check">
                      <Check :size="14" :stroke-width="2.2" />
                    </span>
                  </button>
                </li>
              </ul>
            </section>
          </div>

          <div v-if="error" class="flem-modal__error">{{ error }}</div>

          <footer class="flem-modal__foot">
            <button
              type="button"
              class="flem-modal__reset"
              :disabled="saving || selectedCount === 0"
              @click="resetToDefaults"
            >
              <RotateCcw :size="12" :stroke-width="2" /> Reset
            </button>
            <div class="flem-modal__primary-actions">
              <button
                type="button"
                class="flem-modal__secondary"
                @click="$emit('close')"
              >
                Cancel
              </button>
              <button
                type="button"
                class="flem-modal__primary"
                :disabled="saving"
                @click="submit"
              >
                <Save :size="13" :stroke-width="2" />
                {{ saving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.flem-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: oklch(0.18 0.015 260 / 0.5);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
}
@media (min-width: 640px) {
  .flem-overlay {
    align-items: center;
  }
}

.flem-modal {
  width: 100%;
  max-width: 520px;
  max-height: 92dvh;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.flem-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--color-line-soft);
}
.flem-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.flem-modal__title {
  font-size: 20px;
  margin-top: 2px;
  color: var(--color-ink);
}
.flem-modal__hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}
.flem-modal__count {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
}
.flem-modal__close {
  background: transparent;
  border: none;
  border-radius: 6px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  cursor: pointer;
  flex-shrink: 0;
}
.flem-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.flem-modal__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 12px;
}

.flem-section {
  margin-bottom: 10px;
}
.flem-section__head {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 8px 12px 4px;
}
.flem-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.flem-row {
  width: 100%;
  display: grid;
  grid-template-columns: 28px 1fr 18px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  transition:
    background 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.flem-row:hover {
  background: var(--color-surface-soft);
}
.flem-row--on {
  background: oklch(0.99 0.01 86.8);
  border-color: oklch(0.92 0.07 86.8);
}
.flem-row--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.flem-row__icon {
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
.flem-row--on .flem-row__icon {
  background: oklch(0.95 0.05 86.8);
  color: var(--color-accent-700);
  border-color: oklch(0.85 0.07 86.8);
}
.flem-row__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.flem-row__title {
  font-size: 14px;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flem-row__sub {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flem-row__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent-700);
}

.flem-modal__error {
  margin: 0 18px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.flem-modal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-line-soft);
}
.flem-modal__reset {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
}
.flem-modal__reset:hover:not(:disabled) {
  color: var(--color-ink-soft);
}
.flem-modal__reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.flem-modal__primary-actions {
  display: inline-flex;
  gap: 8px;
}
.flem-modal__secondary {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.flem-modal__secondary:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.flem-modal__primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-brand-600);
  color: white;
  border: none;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.flem-modal__primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.flem-modal__primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.flem-overlay {
  transition: opacity 200ms var(--ease-out);
}
.flem-modal {
  transition:
    transform 220ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.flem-enter-from,
.flem-leave-to {
  opacity: 0;
}
.flem-enter-from .flem-modal,
.flem-leave-to .flem-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
