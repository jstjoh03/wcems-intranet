<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { X, Upload, Image as ImageIcon, Trash2 } from 'lucide-vue-next'
import { useSpotlight } from '@/composables/useSpotlight'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fileSizeHint = computed(() =>
  auth.usingDevStub
    ? 'Dev mode caps offline storage at 2 MB. Sign in for real to upload up to 8 MB.'
    : 'Up to 8 MB. JPG / PNG / WebP. Optional — the spotlight reads fine without one.',
)

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { current, publish, clear } = useSpotlight()

const personName = ref('')
const role = ref('')
const tenure = ref('')
const blurb = ref('')
const photo = ref<File | null>(null)
const photoInput = ref<HTMLInputElement | null>(null)
const photoPreview = ref<string | null>(null)
const removeExistingPhoto = ref(false)
const error = ref<string | null>(null)
const submitting = ref(false)
const removing = ref(false)

const hasExistingPhoto = computed(
  () => !!current.value?.photoUrl && !removeExistingPhoto.value && !photo.value,
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      personName.value = current.value?.personName ?? ''
      role.value = current.value?.role ?? ''
      tenure.value = current.value?.tenure ?? ''
      blurb.value = current.value?.blurb ?? ''
      photo.value = null
      removeExistingPhoto.value = false
      if (photoPreview.value) URL.revokeObjectURL(photoPreview.value)
      photoPreview.value = null
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
  if (photoPreview.value) URL.revokeObjectURL(photoPreview.value)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onPhotoPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  photo.value = f
  if (photoPreview.value) URL.revokeObjectURL(photoPreview.value)
  photoPreview.value = f ? URL.createObjectURL(f) : null
  removeExistingPhoto.value = false
  error.value = null
}

function clearPickedPhoto() {
  photo.value = null
  if (photoPreview.value) URL.revokeObjectURL(photoPreview.value)
  photoPreview.value = null
  if (photoInput.value) photoInput.value.value = ''
}

function dropExistingPhoto() {
  removeExistingPhoto.value = true
  clearPickedPhoto()
}

async function submit() {
  if (!personName.value.trim()) {
    error.value = 'Name is required.'
    return
  }
  error.value = null
  submitting.value = true
  const result = await publish({
    personName: personName.value,
    role: role.value,
    tenure: tenure.value,
    blurb: blurb.value,
    photo: photo.value,
    removeExistingPhoto: removeExistingPhoto.value,
  })
  submitting.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('close')
}

async function removePublished() {
  if (!confirm('Remove the current spotlight? This cannot be undone.')) return
  removing.value = true
  const result = await clear()
  removing.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="spotlight-modal">
      <div v-if="open" class="spotlight-modal-overlay" @click.self="$emit('close')">
        <div class="spotlight-modal" role="dialog" aria-labelledby="spotlight-modal-title">
          <header class="spotlight-modal__head">
            <div>
              <div class="spotlight-modal__eyebrow">Spotlight</div>
              <h2 id="spotlight-modal-title" class="spotlight-modal__title display">
                {{ current ? 'Update spotlight' : 'Choose a spotlight' }}
              </h2>
            </div>
            <button
              type="button"
              class="spotlight-modal__close"
              aria-label="Close"
              @click="$emit('close')"
            >
              <X :size="18" />
            </button>
          </header>

          <form class="spotlight-modal__form" @submit.prevent="submit">
            <label class="spotlight-modal__field">
              <span class="spotlight-modal__label">Name</span>
              <input
                v-model="personName"
                type="text"
                required
                maxlength="80"
                placeholder="Justin St. John"
                class="spotlight-modal__input"
              />
            </label>

            <div class="spotlight-modal__row">
              <label class="spotlight-modal__field">
                <span class="spotlight-modal__label">Role / title</span>
                <input
                  v-model="role"
                  type="text"
                  maxlength="60"
                  placeholder="Paramedic"
                  class="spotlight-modal__input"
                />
              </label>
              <label class="spotlight-modal__field">
                <span class="spotlight-modal__label">Tenure</span>
                <input
                  v-model="tenure"
                  type="text"
                  maxlength="40"
                  placeholder="5 years on team"
                  class="spotlight-modal__input"
                />
              </label>
            </div>

            <label class="spotlight-modal__field">
              <span class="spotlight-modal__label">Blurb</span>
              <textarea
                v-model="blurb"
                rows="3"
                maxlength="280"
                placeholder="What's worth recognizing about them?"
                class="spotlight-modal__textarea"
              />
              <span class="spotlight-modal__hint">{{ blurb.length }} / 280</span>
            </label>

            <div class="spotlight-modal__field">
              <span class="spotlight-modal__label">Photo (optional)</span>
              <input
                ref="photoInput"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="sr-only"
                @change="onPhotoPicked"
              />
              <div class="spotlight-modal__file-row">
                <button
                  type="button"
                  class="spotlight-modal__file-btn"
                  @click="photoInput?.click()"
                >
                  <Upload :size="13" :stroke-width="1.85" />
                  {{ photo ? 'Choose a different photo' : 'Choose photo' }}
                </button>
                <div v-if="photo" class="spotlight-modal__file-info">
                  <ImageIcon :size="13" :stroke-width="1.85" />
                  <span class="truncate">{{ photo.name }}</span>
                  <span class="spotlight-modal__file-size">
                    {{ (photo.size / 1024 / 1024).toFixed(2) }} MB
                  </span>
                  <button
                    type="button"
                    class="spotlight-modal__file-clear"
                    aria-label="Remove picked photo"
                    @click="clearPickedPhoto"
                  >
                    <X :size="12" />
                  </button>
                </div>
                <div
                  v-else-if="hasExistingPhoto"
                  class="spotlight-modal__file-info spotlight-modal__file-info--current"
                >
                  <ImageIcon :size="13" :stroke-width="1.85" />
                  <span>Currently set</span>
                  <button
                    type="button"
                    class="spotlight-modal__file-clear"
                    aria-label="Remove current photo"
                    @click="dropExistingPhoto"
                  >
                    <X :size="12" />
                  </button>
                </div>
              </div>
              <div v-if="photoPreview" class="spotlight-modal__preview">
                <img :src="photoPreview" alt="Spotlight photo preview" />
              </div>
              <div
                v-else-if="hasExistingPhoto && current?.photoUrl"
                class="spotlight-modal__preview"
              >
                <img :src="current.photoUrl" alt="Current spotlight photo" />
              </div>
              <span class="spotlight-modal__hint">{{ fileSizeHint }}</span>
            </div>

            <div v-if="error" class="spotlight-modal__error" role="alert">
              {{ error }}
            </div>

            <footer class="spotlight-modal__foot">
              <button
                v-if="current"
                type="button"
                class="spotlight-modal__remove"
                :disabled="removing"
                @click="removePublished"
              >
                <Trash2 :size="13" :stroke-width="1.85" />
                {{ removing ? 'Removing…' : 'Remove spotlight' }}
              </button>
              <div class="spotlight-modal__primary-actions">
                <button
                  type="button"
                  class="spotlight-modal__secondary"
                  @click="$emit('close')"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="spotlight-modal__primary"
                  :disabled="submitting || !personName.trim()"
                >
                  {{ submitting ? 'Publishing…' : current ? 'Update' : 'Publish' }}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spotlight-modal-overlay {
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
  .spotlight-modal-overlay {
    align-items: center;
  }
}

.spotlight-modal {
  width: 100%;
  max-width: 540px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  max-height: 92dvh;
  overflow: hidden;
}

.spotlight-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 6px;
}
.spotlight-modal__eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.spotlight-modal__title {
  font-size: 20px;
  margin-top: 2px;
  color: var(--color-ink);
}
.spotlight-modal__close {
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
.spotlight-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.spotlight-modal__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 18px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.spotlight-modal__row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 480px) {
  .spotlight-modal__row {
    grid-template-columns: 1fr 1fr;
  }
}

.spotlight-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.spotlight-modal__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.spotlight-modal__input,
.spotlight-modal__textarea {
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
.spotlight-modal__input:focus,
.spotlight-modal__textarea:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.spotlight-modal__hint {
  font-size: 11px;
  color: var(--color-muted);
  align-self: flex-end;
}

.spotlight-modal__file-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.spotlight-modal__file-btn {
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
.spotlight-modal__file-btn:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
.spotlight-modal__file-info {
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
.spotlight-modal__file-info--current {
  background: var(--color-surface-soft);
  border-color: var(--color-line);
  color: var(--color-muted);
}
.spotlight-modal__file-size {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  white-space: nowrap;
}
.spotlight-modal__file-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}
.spotlight-modal__file-clear:hover {
  color: var(--color-danger-500);
}
.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotlight-modal__preview {
  margin-top: 8px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  aspect-ratio: 4 / 3;
  background: var(--color-surface-soft);
}
.spotlight-modal__preview img {
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

.spotlight-modal__error {
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.4;
}

.spotlight-modal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: sticky;
  bottom: -18px;
  margin: 8px -18px -18px;
  padding: 12px 18px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-line-soft);
  z-index: 1;
}
.spotlight-modal__primary-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.spotlight-modal__remove {
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
.spotlight-modal__remove:hover {
  background: oklch(0.97 0.04 20);
}
.spotlight-modal__remove:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.spotlight-modal__secondary {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
}
.spotlight-modal__secondary:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.spotlight-modal__primary {
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
.spotlight-modal__primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.spotlight-modal__primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spotlight-modal-overlay {
  transition: opacity 200ms var(--ease-out);
}
.spotlight-modal {
  transition:
    transform 220ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.spotlight-modal-enter-from,
.spotlight-modal-leave-to {
  opacity: 0;
}
.spotlight-modal-enter-from .spotlight-modal,
.spotlight-modal-leave-to .spotlight-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
