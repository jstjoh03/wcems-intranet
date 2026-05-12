<script setup lang="ts">
import { ref, computed } from 'vue'
import { ImageIcon, Camera, Trash2, Heart, MessageCircle } from 'lucide-vue-next'
import AppChip from '@/components/primitives/AppChip.vue'
import { useAuthStore } from '@/stores/auth'
import { useGallery, type GalleryPhoto } from '@/composables/useGallery'
import { usePhotoReactions } from '@/composables/usePhotoReactions'
import { usePhotoComments } from '@/composables/usePhotoComments'
import GalleryUploadModal from '@/components/dashboard/GalleryUploadModal.vue'
import PhotoDetailModal from '@/components/dashboard/PhotoDetailModal.vue'

const auth = useAuthStore()
const { photos, remove } = useGallery()
const currentUserId = computed(() => auth.appUser?.id ?? 'anonymous')
const reactions = usePhotoReactions(currentUserId.value)
const comments = usePhotoComments(currentUserId.value)

const uploadOpen = ref(false)
const activePhoto = ref<GalleryPhoto | null>(null)
const filter = ref<string>('All')

const tagsInUse = computed(() => {
  const set = new Set<string>()
  for (const p of photos.value) set.add(p.tag)
  return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
})

const visible = computed(() =>
  filter.value === 'All' ? photos.value : photos.value.filter((p) => p.tag === filter.value),
)

async function onDelete(id: string, caption: string) {
  const label = caption.trim() ? `"${caption}"` : 'this photo'
  if (!confirm(`Remove ${label} from the gallery? This cannot be undone.`)) return
  const result = await remove(id)
  if (!result.ok) alert(result.error)
}

function openPhoto(p: GalleryPhoto) {
  activePhoto.value = p
}
function onToggleHeart(p: GalleryPhoto, e: MouseEvent) {
  e.stopPropagation()
  void reactions.toggle(p.id)
}
</script>

<template>
  <div class="gallery">
    <header class="gallery__header">
      <div class="gallery__title-row">
        <div class="flex items-center gap-2">
          <ImageIcon :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
          <h1 class="display gallery__title">Around the County</h1>
        </div>
        <button
          v-if="auth.isAdmin"
          type="button"
          class="gallery__upload"
          @click="uploadOpen = true"
        >
          <Camera :size="13" :stroke-width="1.85" /> Upload photo
        </button>
      </div>
      <p class="gallery__sub">
        {{ photos.length }} photo{{ photos.length === 1 ? '' : 's' }}
        — field, training, and outreach moments shared by the team.
      </p>
    </header>

    <div v-if="tagsInUse.length > 1" class="gallery__filters">
      <button
        v-for="t in tagsInUse"
        :key="t"
        type="button"
        class="gallery__filter"
        :class="{ 'gallery__filter--active': filter === t }"
        @click="filter = t"
      >
        {{ t }}
      </button>
    </div>

    <div v-if="photos.length === 0" class="gallery__empty">
      <ImageIcon :size="28" :stroke-width="1.4" class="gallery__empty-icon" />
      <div class="gallery__empty-title">No photos yet</div>
      <p class="gallery__empty-sub">
        Once admins start uploading, every photo will show up here.
      </p>
    </div>

    <div v-else-if="visible.length === 0" class="gallery__empty">
      <div class="gallery__empty-title">No photos with the "{{ filter }}" tag</div>
      <p class="gallery__empty-sub">Pick another tag, or upload a new photo.</p>
    </div>

    <div v-else class="gallery__grid">
      <button
        v-for="p in visible"
        :key="p.id"
        type="button"
        class="photo-cell"
        :aria-label="p.caption ? `Open photo: ${p.caption}` : 'Open photo'"
        @click="openPhoto(p)"
      >
        <div
          class="photo-cell__cover"
          :style="{ backgroundImage: `url(${p.imageUrl})` }"
        />
        <AppChip class="photo-cell__chip">{{ p.tag }}</AppChip>
        <button
          v-if="auth.isAdmin"
          type="button"
          class="photo-cell__delete"
          aria-label="Remove photo"
          @click.stop="onDelete(p.id, p.caption)"
        >
          <Trash2 :size="13" :stroke-width="1.85" />
        </button>
        <div class="photo-cell__engagement">
          <span
            class="photo-cell__heart"
            :class="{ 'photo-cell__heart--reacted': reactions.hasReacted(p.id) }"
            :aria-label="reactions.hasReacted(p.id) ? 'Remove your heart' : 'Heart this photo'"
            role="button"
            tabindex="0"
            @click="onToggleHeart(p, $event)"
            @keydown.enter.stop.prevent="onToggleHeart(p, $event as unknown as MouseEvent)"
            @keydown.space.stop.prevent="onToggleHeart(p, $event as unknown as MouseEvent)"
          >
            <Heart :size="12" :fill="reactions.hasReacted(p.id) ? 'currentColor' : 'none'" />
            <span v-if="reactions.getCount(p.id) > 0">{{ reactions.getCount(p.id) }}</span>
          </span>
          <span v-if="comments.getCount(p.id) > 0" class="photo-cell__comment-count">
            <MessageCircle :size="11" :stroke-width="2" />
            {{ comments.getCount(p.id) }}
          </span>
        </div>
        <div v-if="p.caption" class="photo-cell__caption">
          <div class="display text-[15px] leading-tight">{{ p.caption }}</div>
        </div>
      </button>
    </div>

    <GalleryUploadModal :open="uploadOpen" @close="uploadOpen = false" />
    <PhotoDetailModal :photo="activePhoto" @close="activePhoto = null" />
  </div>
</template>

<style scoped>
.gallery {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}
@media (min-width: 768px) {
  .gallery {
    padding: 40px 40px 80px;
  }
}

.gallery__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.gallery__title {
  font-size: 32px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .gallery__title {
    font-size: 40px;
  }
}
.gallery__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.gallery__upload {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  background: var(--color-brand-600);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.gallery__upload:hover {
  background: var(--color-brand-700);
}

.gallery__filters {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gallery__filter {
  padding: 5px 12px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms var(--ease-out),
    color 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.gallery__filter:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.gallery__filter--active {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.gallery__empty {
  margin-top: 32px;
  text-align: center;
  padding: 48px 20px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.gallery__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 10px;
}
.gallery__empty-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.gallery__empty-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}

.gallery__grid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (min-width: 768px) {
  .gallery__grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
}
@media (min-width: 1024px) {
  .gallery__grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
}

.photo-cell {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--color-line);
  /* button reset */
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  appearance: none;
}
.photo-cell:focus-visible {
  outline: 2px solid var(--color-brand-600);
  outline-offset: 2px;
}
.photo-cell__cover {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: transform 600ms var(--ease-out);
}
.photo-cell:hover .photo-cell__cover {
  transform: scale(1.04);
}
.photo-cell__chip {
  position: absolute;
  top: 12px;
  left: 12px;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-brand-700);
  border-color: transparent;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.photo-cell__delete {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-danger-500);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  transition:
    opacity 150ms var(--ease-out),
    background 120ms var(--ease-out);
}
.photo-cell:hover .photo-cell__delete,
.photo-cell:focus-within .photo-cell__delete {
  opacity: 1;
}
.photo-cell__delete:hover {
  background: white;
}
.photo-cell__caption {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  padding: 14px;
  padding-bottom: 36px;
  color: white;
  background: linear-gradient(to top, oklch(0 0 0 / 0.65) 0%, oklch(0 0 0 / 0) 100%);
  pointer-events: none;
}

.photo-cell__engagement {
  position: absolute;
  bottom: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  z-index: 1;
}
.photo-cell__heart {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-muted);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition:
    color 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.photo-cell__heart:hover {
  color: var(--color-ink-soft);
}
.photo-cell__heart:active {
  transform: scale(0.92);
}
.photo-cell__heart--reacted,
.photo-cell__heart--reacted:hover {
  color: var(--color-danger-500);
}
.photo-cell__comment-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-ink-soft);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
</style>
