<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Bell, Edit2, X, Upload } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useAnnouncements } from '@/composables/useAnnouncements'

const auth = useAuthStore()
const { announcements, publish, update, remove } = useAnnouncements()

const PRESET_CATEGORIES = [
  'Operations',
  'Protocol',
  'Education',
  'Recognition',
  'Outreach',
  'Event',
] as const

interface Draft {
  id: string | null
  tag: string
  customTag: string
  title: string
  body: string
  imageUrl: string | null
}

const composing = ref(false)
const draft = ref<Draft>(blankDraft())
const submitting = ref(false)
const uploadingImage = ref(false)
const composeError = ref<string | null>(null)
const lightboxUrl = ref<string | null>(null)

/* Image-size cap kept consistent with the training-recording thumbnail
   uploader. Most invitation flyers are ~1-3 MB; 5 MB gives headroom
   without letting someone drop a 50 MB PDF-rendered PNG into the bucket. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

function blankDraft(): Draft {
  return {
    id: null,
    tag: 'Operations',
    customTag: '',
    title: '',
    body: '',
    imageUrl: null,
  }
}

function startCompose() {
  draft.value = blankDraft()
  composing.value = true
  composeError.value = null
}

function startEdit(id: string) {
  const a = announcements.value.find((x) => x.id === id)
  if (!a) return
  const isPreset = (PRESET_CATEGORIES as readonly string[]).includes(a.tag)
  draft.value = {
    id: a.id,
    tag: isPreset ? a.tag : 'Other',
    customTag: isPreset ? '' : a.tag,
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl,
  }
  composing.value = true
  composeError.value = null
}

function cancelCompose() {
  composing.value = false
  composeError.value = null
}

async function onImagePicked(event: Event) {
  composeError.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    composeError.value = 'Please choose an image file.'
    input.value = ''
    return
  }
  if (file.size > IMAGE_MAX_BYTES) {
    composeError.value = 'Image is too large (max 5 MB).'
    input.value = ''
    return
  }
  uploadingImage.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const key = `${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('announcement-images')
      .upload(key, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('announcement-images').getPublicUrl(key)
    draft.value.imageUrl = data.publicUrl
  } catch (err) {
    composeError.value = `Image upload failed: ${(err as Error).message}`
  } finally {
    uploadingImage.value = false
    input.value = ''
  }
}

function clearDraftImage() {
  /* Just clears the reference on the draft. The uploaded file stays in
     the bucket as an orphan — tech debt; cleanup belongs in a separate
     storage-janitor job, not this user flow. */
  draft.value.imageUrl = null
}

async function submitDraft() {
  if (submitting.value) return
  if (!draft.value.title.trim()) {
    composeError.value = 'Headline is required.'
    return
  }
  const finalTag =
    draft.value.tag === 'Other'
      ? draft.value.customTag.trim() || 'Other'
      : draft.value.tag
  submitting.value = true
  composeError.value = null
  try {
    const payload = {
      tag: finalTag,
      title: draft.value.title.trim(),
      body: draft.value.body.trim(),
      imageUrl: draft.value.imageUrl,
    }
    if (draft.value.id) {
      await update({ id: draft.value.id, ...payload })
    } else {
      await publish(payload)
    }
    composing.value = false
    draft.value = blankDraft()
  } catch (err) {
    composeError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function removeAnnouncement(id: string, title: string) {
  if (!confirm(`Delete announcement "${title}"? This cannot be undone.`)) return
  try {
    await remove(id)
  } catch (err) {
    alert(`Delete failed: ${(err as Error).message}`)
  }
}

function openLightbox(url: string | null) {
  if (!url) return
  lightboxUrl.value = url
}
function closeLightbox() {
  lightboxUrl.value = null
}

const submitLabel = computed(() => {
  if (submitting.value) return 'Saving…'
  return draft.value.id ? 'Update' : 'Publish'
})
</script>

<template>
  <AppCard class="announcements-card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <Eyebrow>Announcements</Eyebrow>
      <button
        v-if="auth.isAdmin && !composing"
        class="announcements-card__new"
        @click="startCompose"
      >
        <Plus :size="11" :stroke-width="2" /> New
      </button>
    </div>

    <!-- Compose / edit form (admin only) -->
    <form v-if="composing" class="announcements-card__compose" @submit.prevent="submitDraft">
      <input
        v-model="draft.title"
        type="text"
        placeholder="Headline"
        class="announcements-card__input"
        required
      />
      <select v-model="draft.tag" class="announcements-card__select">
        <option v-for="c in PRESET_CATEGORIES" :key="c">{{ c }}</option>
        <option>Other</option>
      </select>
      <input
        v-if="draft.tag === 'Other'"
        v-model="draft.customTag"
        type="text"
        placeholder="Custom category (e.g. CISM, Recall, Holiday)"
        class="announcements-card__input"
        maxlength="24"
      />
      <textarea
        v-model="draft.body"
        placeholder="Body (optional)"
        class="announcements-card__textarea"
        rows="3"
      />

      <!-- Image picker — flyer / invitation / etc. -->
      <div class="announcements-card__image-block">
        <div v-if="draft.imageUrl" class="announcements-card__image-preview-wrap">
          <img
            :src="draft.imageUrl"
            class="announcements-card__image-preview"
            alt="Announcement image preview"
          />
          <button
            type="button"
            class="announcements-card__image-remove"
            aria-label="Remove image"
            @click="clearDraftImage"
          >
            <X :size="13" :stroke-width="2.25" />
          </button>
        </div>
        <label class="announcements-card__image-pick">
          <input
            type="file"
            accept="image/*"
            :disabled="uploadingImage"
            @change="onImagePicked"
          />
          <Upload :size="12" :stroke-width="2" />
          <span v-if="uploadingImage">Uploading…</span>
          <span v-else-if="draft.imageUrl">Replace image</span>
          <span v-else>Add image (optional)</span>
        </label>
      </div>

      <div v-if="composeError" class="announcements-card__error">{{ composeError }}</div>

      <div class="announcements-card__compose-actions">
        <button type="button" class="btn btn-ghost" @click="cancelCompose">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="submitting || uploadingImage">
          {{ submitLabel }}
        </button>
      </div>
    </form>

    <!-- Empty state -->
    <div v-if="announcements.length === 0 && !composing" class="announcements-card__empty">
      <Bell :size="20" :stroke-width="1.5" class="announcements-card__empty-icon" />
      <div class="announcements-card__empty-title">No current announcements</div>
      <p v-if="auth.isAdmin" class="announcements-card__empty-sub">
        Tap <strong>+ New</strong> to post an update for the team.
      </p>
      <p v-else class="announcements-card__empty-sub">
        Updates from operations, protocols, and education will appear here.
      </p>
    </div>

    <!-- List -->
    <div v-else-if="announcements.length > 0" class="space-y-3">
      <article
        v-for="(a, i) in announcements"
        :key="a.id"
        class="announcements-card__row"
        :class="{ 'announcements-card__row--last': i === announcements.length - 1 }"
      >
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <AppChip variant="brand">{{ a.tag }}</AppChip>
          <span class="font-mono text-[10.5px]" style="color: var(--color-muted)">
            {{ a.date }}
          </span>
          <span class="ml-auto flex items-center gap-2">
            <button
              v-if="auth.isAdmin"
              class="announcements-card__edit"
              aria-label="Edit"
              @click="startEdit(a.id)"
            >
              <Edit2 :size="11" />
            </button>
            <button
              v-if="auth.isAdmin"
              class="announcements-card__edit"
              aria-label="Delete"
              @click="removeAnnouncement(a.id, a.title)"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
        <h4 class="announcements-card__title display">{{ a.title }}</h4>
        <button
          v-if="a.imageUrl"
          type="button"
          class="announcements-card__image-btn"
          :aria-label="`Open ${a.title} image`"
          @click="openLightbox(a.imageUrl)"
        >
          <img
            :src="a.imageUrl"
            :alt="`${a.title} image`"
            class="announcements-card__image"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        </button>
        <p v-if="a.body" class="announcements-card__body">{{ a.body }}</p>
        <div class="announcements-card__by">— {{ a.authorName }}</div>
      </article>
    </div>

    <!-- Lightbox — full-size image overlay. Clicking the backdrop or
         the X closes; Esc handled by stopping at the overlay scope. -->
    <Teleport to="body">
      <div
        v-if="lightboxUrl"
        class="announcements-lightbox"
        role="dialog"
        aria-modal="true"
        @click="closeLightbox"
      >
        <button
          type="button"
          class="announcements-lightbox__close"
          aria-label="Close image"
          @click.stop="closeLightbox"
        >
          <X :size="20" />
        </button>
        <img
          :src="lightboxUrl"
          alt=""
          class="announcements-lightbox__img"
          referrerpolicy="no-referrer"
          @click.stop
        />
      </div>
    </Teleport>
  </AppCard>
</template>

<style scoped>
.announcements-card {
  padding: 20px;
}
.announcements-card__new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.announcements-card__new:hover {
  background: var(--color-brand-100);
}

.announcements-card__compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  margin-bottom: 12px;
}
.announcements-card__input,
.announcements-card__select,
.announcements-card__textarea {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  width: 100%;
}
.announcements-card__input:focus,
.announcements-card__select:focus,
.announcements-card__textarea:focus {
  border-color: var(--color-brand-500);
}
.announcements-card__textarea {
  resize: vertical;
  font-family: var(--font-sans);
}

.announcements-card__image-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.announcements-card__image-preview-wrap {
  position: relative;
  width: 100%;
  max-height: 200px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
}
.announcements-card__image-preview {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  background: var(--color-surface-sunk);
}
.announcements-card__image-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0 0 0 / 0.6);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
}
.announcements-card__image-pick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.announcements-card__image-pick:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.announcements-card__image-pick input {
  display: none;
}

.announcements-card__error {
  font-size: 12px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 6px;
  padding: 7px 10px;
}

.announcements-card__compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.announcements-card__empty {
  text-align: center;
  padding: 12px 8px 4px;
}
.announcements-card__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 8px;
}
.announcements-card__empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.announcements-card__empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.5;
}

.announcements-card__row {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line);
}
.announcements-card__row--last {
  padding-bottom: 0;
  border-bottom: none;
}
.announcements-card__title {
  font-size: 16px;
  line-height: 1.25;
  color: var(--color-ink);
  margin-top: 4px;
}
.announcements-card__body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.announcements-card__by {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
}
.announcements-card__edit {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px 4px;
  border-radius: 4px;
}
.announcements-card__edit:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

/* Attached image — tap to open full-size in the lightbox. Constrained
   in-card so a tall invitation flyer doesn't dominate the dashboard. */
.announcements-card__image-btn {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color 120ms var(--ease-out);
}
.announcements-card__image-btn:hover {
  border-color: var(--color-muted-soft);
}
.announcements-card__image {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  background: var(--color-surface-sunk);
}

/* Lightbox overlay (teleported to body so it escapes the dashboard's
   grid). z-index 80 matches the modal range so we're above the dock
   and quick-link panel but below the global search overlay (90). */
.announcements-lightbox {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.85);
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  cursor: zoom-out;
  -webkit-tap-highlight-color: transparent;
}
.announcements-lightbox__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.15);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transition: background 120ms var(--ease-out);
}
.announcements-lightbox__close:hover {
  background: oklch(1 0 0 / 0.25);
}
.announcements-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  cursor: default;
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}

/* Standard button styles shared with other cards. */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.btn-primary {
  background: var(--color-brand-600);
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
