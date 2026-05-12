<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { X, Upload, Image as ImageIcon } from 'lucide-vue-next'
import { useGallery, GALLERY_TAGS } from '@/composables/useGallery'
import { useAuthStore } from '@/stores/auth'

const OTHER_SENTINEL = '__other'

const auth = useAuthStore()
const fileSizeHint = computed(() =>
  auth.usingDevStub
    ? 'Dev mode caps offline storage at 2 MB per photo. Sign in for real to upload up to 8 MB.'
    : 'Up to 8 MB. JPG / PNG / WebP. Stored in Supabase Storage.',
)

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { upload } = useGallery()

const caption = ref('')
const tagChoice = ref<string>('WCEMS')
const customTag = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<string | null>(null)
const error = ref<string | null>(null)
const submitting = ref(false)

const resolvedTag = computed(() =>
  tagChoice.value === OTHER_SENTINEL ? customTag.value.trim() : tagChoice.value,
)
const canSubmit = computed(() =>
  !!file.value && !submitting.value && resolvedTag.value.length > 0,
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      caption.value = ''
      tagChoice.value = 'WCEMS'
      customTag.value = ''
      file.value = null
      if (preview.value) URL.revokeObjectURL(preview.value)
      preview.value = null
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
  if (preview.value) URL.revokeObjectURL(preview.value)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  file.value = f
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = f ? URL.createObjectURL(f) : null
  error.value = null
}

function clearPickedFile() {
  file.value = null
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = null
  if (fileInput.value) fileInput.value.value = ''
}

async function submit() {
  if (!file.value) {
    error.value = 'Pick a photo to upload.'
    return
  }
  if (tagChoice.value === OTHER_SENTINEL && !customTag.value.trim()) {
    error.value = 'Enter a custom tag, or pick one from the list.'
    return
  }
  error.value = null
  submitting.value = true
  const result = await upload({
    caption: caption.value,
    tag: resolvedTag.value,
    file: file.value,
  })
  submitting.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="gallery-modal">
      <div v-if="open" class="gallery-modal-overlay" @click.self="$emit('close')">
        <div class="gallery-modal" role="dialog" aria-labelledby="gallery-modal-title">
          <header class="gallery-modal__head">
            <div>
              <div class="gallery-modal__eyebrow">Gallery</div>
              <h2 id="gallery-modal-title" class="gallery-modal__title display">
                Upload photo
              </h2>
            </div>
            <button
              type="button"
              class="gallery-modal__close"
              aria-label="Close"
              @click="$emit('close')"
            >
              <X :size="18" />
            </button>
          </header>

          <form class="gallery-modal__form" @submit.prevent="submit">
            <div class="gallery-modal__field">
              <span class="gallery-modal__label">Photo</span>
              <input
                ref="fileInput"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="sr-only"
                @change="onFilePicked"
              />
              <div class="gallery-modal__file-row">
                <button
                  type="button"
                  class="gallery-modal__file-btn"
                  @click="fileInput?.click()"
                >
                  <Upload :size="13" :stroke-width="1.85" />
                  {{ file ? 'Choose a different photo' : 'Choose photo' }}
                </button>
                <div v-if="file" class="gallery-modal__file-info">
                  <ImageIcon :size="13" :stroke-width="1.85" />
                  <span class="truncate">{{ file.name }}</span>
                  <span class="gallery-modal__file-size">
                    {{ (file.size / 1024 / 1024).toFixed(2) }} MB
                  </span>
                  <button
                    type="button"
                    class="gallery-modal__file-clear"
                    aria-label="Remove file"
                    @click="clearPickedFile"
                  >
                    <X :size="12" />
                  </button>
                </div>
              </div>
              <div v-if="preview" class="gallery-modal__preview">
                <img :src="preview" alt="Photo preview" />
              </div>
              <span class="gallery-modal__hint">{{ fileSizeHint }}</span>
            </div>

            <label class="gallery-modal__field">
              <span class="gallery-modal__label">Caption</span>
              <input
                v-model="caption"
                type="text"
                maxlength="80"
                placeholder="Crew at the May community fair"
                class="gallery-modal__input"
              />
              <span class="gallery-modal__hint">{{ caption.length }} / 80</span>
            </label>

            <div class="gallery-modal__field">
              <label class="gallery-modal__label" for="gallery-tag-select">Tag</label>
              <select
                id="gallery-tag-select"
                v-model="tagChoice"
                class="gallery-modal__select"
              >
                <option v-for="t in GALLERY_TAGS" :key="t" :value="t">{{ t }}</option>
                <option :value="OTHER_SENTINEL">Other…</option>
              </select>
              <input
                v-if="tagChoice === OTHER_SENTINEL"
                v-model="customTag"
                type="text"
                maxlength="24"
                placeholder="Custom tag"
                class="gallery-modal__input"
              />
            </div>

            <div v-if="error" class="gallery-modal__error" role="alert">
              {{ error }}
            </div>

            <footer class="gallery-modal__foot">
              <button
                type="button"
                class="gallery-modal__secondary"
                @click="$emit('close')"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="gallery-modal__primary"
                :disabled="!canSubmit"
              >
                {{ submitting ? 'Uploading…' : 'Upload' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gallery-modal-overlay {
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
  .gallery-modal-overlay {
    align-items: center;
  }
}

.gallery-modal {
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

.gallery-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 6px;
}
.gallery-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.gallery-modal__title {
  font-size: 20px;
  margin-top: 2px;
  color: var(--color-ink);
}
.gallery-modal__close {
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
.gallery-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.gallery-modal__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 18px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.gallery-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.gallery-modal__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.gallery-modal__input,
.gallery-modal__select {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.gallery-modal__input:focus,
.gallery-modal__select:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.gallery-modal__hint {
  font-size: 11px;
  color: var(--color-muted);
  align-self: flex-end;
}

.gallery-modal__file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.gallery-modal__file-btn {
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
  transition:
    border-color 120ms var(--ease-out),
    color 120ms var(--ease-out);
}
.gallery-modal__file-btn:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
.gallery-modal__file-info {
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
.gallery-modal__file-size {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  white-space: nowrap;
}
.gallery-modal__file-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}
.gallery-modal__file-clear:hover {
  color: var(--color-danger-500);
}
.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gallery-modal__preview {
  margin-top: 8px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  aspect-ratio: 4 / 3;
  background: var(--color-surface-soft);
}
.gallery-modal__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.gallery-modal__error {
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.4;
}

.gallery-modal__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  position: sticky;
  bottom: -18px;
  margin: 8px -18px -18px;
  padding: 12px 18px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-line-soft);
  z-index: 1;
}
.gallery-modal__secondary {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.gallery-modal__secondary:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.gallery-modal__primary {
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
.gallery-modal__primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.gallery-modal__primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.gallery-modal-overlay {
  transition: opacity 200ms var(--ease-out);
}
.gallery-modal {
  transition:
    transform 220ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.gallery-modal-enter-from,
.gallery-modal-leave-to {
  opacity: 0;
}
.gallery-modal-enter-from .gallery-modal,
.gallery-modal-leave-to .gallery-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
