<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Camera,
  ImageIcon,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
} from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import { useAuthStore } from '@/stores/auth'
import { useGallery, type GalleryPhoto } from '@/composables/useGallery'
import { usePhotoReactions } from '@/composables/usePhotoReactions'
import { usePhotoComments } from '@/composables/usePhotoComments'
import GalleryUploadModal from './GalleryUploadModal.vue'
import PhotoDetailModal from './PhotoDetailModal.vue'

const auth = useAuthStore()
const { photos, remove } = useGallery()
const currentUserId = computed(() => auth.appUser?.id ?? 'anonymous')
const reactions = usePhotoReactions(currentUserId.value)
const comments = usePhotoComments(currentUserId.value)

const uploadOpen = ref(false)
const activePhoto = ref<GalleryPhoto | null>(null)

/* Horizontal scroll-snap carousel.
   Cells are sized to show 2 at a time on mobile / 4 on desktop (matches
   the prior grid). The arrow buttons step by one cell — feels right on
   both viewports, and "page-sized" scrolls felt jumpy in testing. */
const scroller = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateScrollState() {
  const el = scroller.value
  if (!el) return
  /* Use a small tolerance — scrollLeft can pick up sub-pixel values
     from snap alignment and we don't want a phantom "left arrow"
     showing at the leftmost position. */
  canScrollLeft.value = el.scrollLeft > 4
  canScrollRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 4
}

function scrollByCell(direction: 1 | -1) {
  const el = scroller.value
  if (!el) return
  const first = el.querySelector<HTMLElement>('.photo-cell')
  const step = first ? first.offsetWidth + 12 /* gap */ : el.clientWidth * 0.5
  el.scrollBy({ left: step * direction, behavior: 'smooth' })
}

watch(photos, () => {
  void nextTick(updateScrollState)
})

let ro: ResizeObserver | null = null
onMounted(() => {
  void nextTick(updateScrollState)
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    ro = new ResizeObserver(updateScrollState)
    ro.observe(scroller.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

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
  /* Stop the cell tap from also opening the detail modal — users
     tapping the heart just want to react, not dive in. */
  e.stopPropagation()
  void reactions.toggle(p.id)
}
</script>

<template>
  <section id="photos" class="reveal" style="margin-top: 48px; animation-delay: 160ms">
    <header class="photos__header">
      <Eyebrow>Around the County</Eyebrow>
      <div class="photos__actions">
        <button
          v-if="auth.isAdmin"
          type="button"
          class="photos__upload"
          @click="uploadOpen = true"
        >
          <Camera :size="12" :stroke-width="1.85" /> Upload photo
        </button>
        <RouterLink
          v-if="photos.length > 0"
          to="/gallery"
          class="photos__view-all"
        >
          View all
        </RouterLink>
      </div>
    </header>

    <div v-if="photos.length === 0" class="photos__empty">
      <ImageIcon :size="22" :stroke-width="1.5" class="photos__empty-icon" />
      <div class="photos__empty-title">No photos yet</div>
      <p class="photos__empty-sub">
        Field, training, and outreach photos will appear here once the team starts uploading.
      </p>
    </div>

    <div v-else class="photos__carousel">
      <button
        type="button"
        class="photos__arrow photos__arrow--left"
        :class="{ 'photos__arrow--hidden': !canScrollLeft }"
        aria-label="Scroll photos left"
        @click="scrollByCell(-1)"
      >
        <ChevronLeft :size="18" />
      </button>

      <div
        ref="scroller"
        class="photos__track"
        @scroll.passive="updateScrollState"
      >
        <button
          v-for="(p, i) in photos"
          :key="p.id"
          type="button"
          class="photo-cell reveal"
          :style="{ animationDelay: `${180 + i * 40}ms` }"
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

      <button
        type="button"
        class="photos__arrow photos__arrow--right"
        :class="{ 'photos__arrow--hidden': !canScrollRight }"
        aria-label="Scroll photos right"
        @click="scrollByCell(1)"
      >
        <ChevronRight :size="18" />
      </button>
    </div>

    <GalleryUploadModal :open="uploadOpen" @close="uploadOpen = false" />
    <PhotoDetailModal :photo="activePhoto" @close="activePhoto = null" />
  </section>
</template>

<style scoped>
.photos__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.photos__actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.photos__upload {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: var(--color-surface);
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.photos__upload:hover {
  border-color: var(--color-muted-soft);
}
.photos__view-all {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.photos__view-all:hover {
  text-decoration: underline;
}

.photos__empty {
  text-align: center;
  padding: 36px 16px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.photos__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 8px;
}
.photos__empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.photos__empty-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
}

/* Carousel — horizontal scroll-snap track with overlay arrows.
   Cells are sized so 2 fit on mobile and 4 on desktop, matching the
   density of the prior grid. Scrollbar is hidden; users scroll via
   the arrows or by swiping (mobile) / shift+wheel (desktop). */
.photos__carousel {
  position: relative;
}
.photos__track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.photos__track::-webkit-scrollbar {
  display: none;
}

.photo-cell {
  position: relative;
  flex: 0 0 calc((100% - 12px) / 2);
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--color-line);
  scroll-snap-align: start;
  /* button reset — cell is a <button> so the whole tile is keyboard-
     focusable for opening the detail modal. */
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
@media (min-width: 1024px) {
  .photo-cell {
    flex-basis: calc((100% - 36px) / 4);
  }
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
  padding-bottom: 36px; /* leave room for engagement chips below */
  color: white;
  background: linear-gradient(to top, oklch(0 0 0 / 0.65) 0%, oklch(0 0 0 / 0) 100%);
  pointer-events: none;
}

/* Engagement overlay — bottom-left corner chips for heart + comment
   count. Sits above the caption gradient so it's always legible. */
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

/* Arrows — overlay buttons centered vertically over the track. They
   sit above the photos so they're always tappable on small viewports
   where there's no hover-to-reveal affordance. */
.photos__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.92);
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  cursor: pointer;
  z-index: 2;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition:
    opacity 150ms var(--ease-out),
    transform 150ms var(--ease-out),
    background 120ms var(--ease-out);
}
.photos__arrow:hover {
  background: white;
}
.photos__arrow--left {
  left: -8px;
}
.photos__arrow--right {
  right: -8px;
}
.photos__arrow--hidden {
  opacity: 0;
  pointer-events: none;
}
@media (min-width: 768px) {
  .photos__arrow--left {
    left: -18px;
  }
  .photos__arrow--right {
    right: -18px;
  }
}
</style>
