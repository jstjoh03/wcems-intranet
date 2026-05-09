<script setup lang="ts">
import { Camera, ImageIcon } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import { useAuthStore } from '@/stores/auth'
import photosData from '@/data/photos.json'

const auth = useAuthStore()
const photos = photosData
</script>

<template>
  <section id="photos" class="reveal" style="margin-top: 48px; animation-delay: 160ms">
    <header class="photos__header">
      <Eyebrow>Around the County</Eyebrow>
      <div class="photos__actions">
        <button v-if="auth.isAdmin" type="button" class="photos__upload">
          <Camera :size="12" :stroke-width="1.85" /> Upload photo
        </button>
        <button v-if="photos.length > 0" class="photos__view-all">View all</button>
      </div>
    </header>

    <div v-if="photos.length === 0" class="photos__empty">
      <ImageIcon :size="22" :stroke-width="1.5" class="photos__empty-icon" />
      <div class="photos__empty-title">No photos yet</div>
      <p class="photos__empty-sub">
        Field, training, and outreach photos will appear here once the team starts uploading.
      </p>
    </div>

    <div v-else class="photos__grid">
      <div
        v-for="(p, i) in photos"
        :key="p.id"
        class="photo-cell reveal"
        :style="{ animationDelay: `${180 + i * 40}ms` }"
      >
        <div
          class="photo-cell__cover"
          :style="
            p.imagePath
              ? { backgroundImage: `url(${p.imagePath})`, backgroundSize: 'cover' }
              : { background: `linear-gradient(135deg, ${p.gradient[0]} 0%, ${p.gradient[1]} 100%)` }
          "
        />
        <AppChip class="photo-cell__chip">{{ p.tag }}</AppChip>
        <div class="photo-cell__caption">
          <div class="display text-[15px] leading-tight">{{ p.caption }}</div>
        </div>
      </div>
    </div>
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
  background: transparent;
  border: none;
  cursor: pointer;
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

.photos__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (min-width: 1024px) {
  .photos__grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.photo-cell {
  position: relative;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--color-line);
}
.photo-cell__cover {
  position: absolute;
  inset: 0;
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
.photo-cell__caption {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  padding: 14px;
  color: white;
  background: linear-gradient(to top, oklch(0 0 0 / 0.65) 0%, oklch(0 0 0 / 0) 100%);
}
</style>
