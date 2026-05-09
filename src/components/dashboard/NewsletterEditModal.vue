<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { X, Upload, FileText, Trash2 } from 'lucide-vue-next'
import { useNewsletter } from '@/composables/useNewsletter'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { current, publish, clear } = useNewsletter()

const title = ref('')
const subtitle = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const error = ref<string | null>(null)
const submitting = ref(false)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      title.value = current.value?.title ?? ''
      subtitle.value = current.value?.subtitle ?? ''
      file.value = null
      error.value = null
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onEsc)
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEsc)
    }
  },
)

onMounted(() => {
  if (props.open) document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEsc)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  error.value = null
}

async function submit() {
  error.value = null
  submitting.value = true
  const result = await publish({
    title: title.value,
    subtitle: subtitle.value,
    file: file.value,
  })
  submitting.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('close')
}

function removePublished() {
  if (!confirm('Remove the current newsletter? This cannot be undone.')) return
  clear()
  emit('close')
}

function clearPickedFile() {
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <Transition name="news-modal">
    <div v-if="open" class="news-modal-overlay" @click.self="$emit('close')">
      <div class="news-modal" role="dialog" aria-labelledby="news-modal-title">
        <header class="news-modal__head">
          <div>
            <div class="news-modal__eyebrow">Newsletter</div>
            <h2 id="news-modal-title" class="news-modal__title display">
              {{ current ? 'Update newsletter' : 'Publish newsletter' }}
            </h2>
          </div>
          <button
            type="button"
            class="news-modal__close"
            aria-label="Close"
            @click="$emit('close')"
          >
            <X :size="18" />
          </button>
        </header>

        <form class="news-modal__form" @submit.prevent="submit">
          <label class="news-modal__field">
            <span class="news-modal__label">Title</span>
            <input
              v-model="title"
              type="text"
              required
              maxlength="80"
              placeholder="May 2026 Newsletter"
              class="news-modal__input"
            />
          </label>

          <label class="news-modal__field">
            <span class="news-modal__label">Blurb</span>
            <textarea
              v-model="subtitle"
              rows="3"
              maxlength="280"
              placeholder="A short tease of what's inside — recognitions, training reminders, schedule changes."
              class="news-modal__textarea"
            />
            <span class="news-modal__hint">{{ subtitle.length }} / 280</span>
          </label>

          <div class="news-modal__field">
            <span class="news-modal__label">PDF (optional)</span>
            <input
              ref="fileInput"
              type="file"
              accept="application/pdf"
              class="sr-only"
              @change="onFilePicked"
            />
            <div class="news-modal__file-row">
              <button
                type="button"
                class="news-modal__file-btn"
                @click="fileInput?.click()"
              >
                <Upload :size="13" :stroke-width="1.85" />
                {{ file ? 'Choose a different PDF' : 'Choose PDF' }}
              </button>
              <div v-if="file" class="news-modal__file-info">
                <FileText :size="13" :stroke-width="1.85" />
                <span class="truncate">{{ file.name }}</span>
                <span class="news-modal__file-size">
                  {{ (file.size / 1024 / 1024).toFixed(2) }} MB
                </span>
                <button
                  type="button"
                  class="news-modal__file-clear"
                  aria-label="Remove file"
                  @click="clearPickedFile"
                >
                  <X :size="12" />
                </button>
              </div>
              <div v-else-if="current?.fileName" class="news-modal__file-info news-modal__file-info--current">
                <FileText :size="13" :stroke-width="1.85" />
                <span class="truncate">Currently: {{ current.fileName }}</span>
              </div>
            </div>
            <span class="news-modal__hint">
              Phase 1 stores up to 3 MB locally. Larger PDFs need Supabase Storage (Phase 2).
            </span>
          </div>

          <div v-if="error" class="news-modal__error" role="alert">
            {{ error }}
          </div>

          <footer class="news-modal__foot">
            <button
              v-if="current"
              type="button"
              class="news-modal__remove"
              @click="removePublished"
            >
              <Trash2 :size="13" :stroke-width="1.85" />
              Remove published
            </button>
            <div class="news-modal__primary-actions">
              <button
                type="button"
                class="news-modal__secondary"
                @click="$emit('close')"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="news-modal__primary"
                :disabled="submitting || !title.trim()"
              >
                {{ submitting ? 'Publishing…' : current ? 'Update' : 'Publish' }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.news-modal-overlay {
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
  .news-modal-overlay {
    align-items: center;
  }
}

.news-modal {
  width: 100%;
  max-width: 520px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  max-height: 92dvh;
  overflow: hidden;
}

.news-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 6px;
}
.news-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.news-modal__title {
  font-size: 20px;
  margin-top: 2px;
  color: var(--color-ink);
}
.news-modal__close {
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
}
.news-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.news-modal__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 18px 18px;
  overflow-y: auto;
}

.news-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.news-modal__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.news-modal__input,
.news-modal__textarea {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  resize: vertical;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.news-modal__input:focus,
.news-modal__textarea:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.news-modal__hint {
  font-size: 11px;
  color: var(--color-muted);
  align-self: flex-end;
}

.news-modal__file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.news-modal__file-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px dashed var(--color-line);
  background: var(--color-surface-soft);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.news-modal__file-btn:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
.news-modal__file-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--color-ink-soft);
  background: var(--color-brand-50);
  border: 1px solid var(--color-brand-100);
  padding: 6px 10px;
  border-radius: 8px;
}
.news-modal__file-info--current {
  background: var(--color-surface-soft);
  border-color: var(--color-line);
  color: var(--color-muted);
}
.news-modal__file-size {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  white-space: nowrap;
}
.news-modal__file-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}
.news-modal__file-clear:hover {
  color: var(--color-danger-500);
}
.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.news-modal__error {
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.4;
}

.news-modal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
}
.news-modal__primary-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.news-modal__remove {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  font-size: 12px;
  color: var(--color-danger-500);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
}
.news-modal__remove:hover {
  background: oklch(0.97 0.04 20);
}
.news-modal__secondary {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.news-modal__secondary:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.news-modal__primary {
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
.news-modal__primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.news-modal__primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.news-modal-overlay {
  transition: opacity 200ms var(--ease-out);
}
.news-modal {
  transition: transform 220ms var(--ease-out), opacity 200ms var(--ease-out);
}
.news-modal-enter-from,
.news-modal-leave-to {
  opacity: 0;
}
.news-modal-enter-from .news-modal,
.news-modal-leave-to .news-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
