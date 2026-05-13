<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Play, Search, Film } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import RecordingPlayerModal from '@/components/training/RecordingPlayerModal.vue'
import {
  useTrainingRecordings,
  type TrainingRecording,
} from '@/composables/useTrainingRecordings'
import { resolveThumbnail } from '@/lib/videoSource'

const route = useRoute()
const router = useRouter()
const { visibleRecordings, categories, loading, ready } = useTrainingRecordings()

const search = ref('')
const activeCategory = ref<string | null>(null)
const activeRecording = ref<TrainingRecording | null>(null)

/* `?play=<id>` deep-links from the global search overlay (and anywhere
   else) auto-open the player on arrival. We watch both the query and
   the loaded list because the user might land before recordings have
   finished loading. */
watch(
  [() => route.query.play, visibleRecordings],
  ([id, list]) => {
    if (!id || typeof id !== 'string') return
    if (activeRecording.value?.id === id) return
    const hit = list.find((r) => r.id === id)
    if (hit) activeRecording.value = hit
  },
  { immediate: true },
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return visibleRecordings.value.filter((r) => {
    if (activeCategory.value && r.category !== activeCategory.value) return false
    if (!q) return true
    return (
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.instructor ?? '').toLowerCase().includes(q) ||
      (r.category ?? '').toLowerCase().includes(q)
    )
  })
})

function thumbFor(r: TrainingRecording): string | null {
  return resolveThumbnail(r.videoSource, r.videoRef, r.thumbnailUrl)
}

function formatRecordedAt(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function open(r: TrainingRecording) {
  activeRecording.value = r
  /* Reflect the open recording in the URL so it's shareable / refreshable
     without losing context. router.replace (not push) so the back button
     doesn't get cluttered with one history entry per video viewed. */
  if (route.query.play !== r.id) {
    void router.replace({ query: { ...route.query, play: r.id } })
  }
}
function close() {
  activeRecording.value = null
  if (route.query.play) {
    const next = { ...route.query }
    delete next.play
    void router.replace({ query: next })
  }
}
</script>

<template>
  <div class="tr">
    <header class="tr__header">
      <div class="flex items-center gap-2">
        <Film :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display tr__title">Training Library</h1>
      </div>
      <p class="tr__sub">
        Catch up on past trainings you may have missed — protocol updates, Doc Day
        recordings, skills refreshers, and more.
      </p>
    </header>

    <div class="tr__toolbar">
      <label class="tr__search">
        <Search :size="14" :stroke-width="1.85" class="tr__search-icon" />
        <input
          v-model="search"
          type="search"
          placeholder="Search by title, instructor, or topic…"
          aria-label="Search recordings"
        />
      </label>
      <div v-if="categories.length" class="tr__cats">
        <button
          type="button"
          class="tr__cat"
          :class="{ 'tr__cat--on': activeCategory === null }"
          @click="activeCategory = null"
        >
          All
        </button>
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          class="tr__cat"
          :class="{ 'tr__cat--on': activeCategory === c }"
          @click="activeCategory = c"
        >
          {{ c }}
        </button>
      </div>
    </div>

    <div v-if="!ready && loading" class="tr__empty">Loading recordings…</div>
    <div v-else-if="filtered.length === 0" class="tr__empty">
      <template v-if="search || activeCategory">No recordings match those filters.</template>
      <template v-else>
        No recordings yet. Check back soon — admins will post past trainings here.
      </template>
    </div>

    <div v-else class="tr__grid">
      <button
        v-for="r in filtered"
        :key="r.id"
        type="button"
        class="tr-card"
        @click="open(r)"
      >
        <div class="tr-card__thumb">
          <img
            v-if="thumbFor(r)"
            :src="thumbFor(r) || ''"
            :alt="r.title"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
          <div v-else class="tr-card__thumb-fallback">
            <Eyebrow style="color: white">Recording</Eyebrow>
            <span class="display">{{ r.title }}</span>
          </div>
          <span class="tr-card__play" aria-hidden="true">
            <Play :size="20" :stroke-width="2" fill="white" />
          </span>
          <span v-if="r.durationMinutes" class="tr-card__duration">
            {{ r.durationMinutes }} min
          </span>
        </div>
        <div class="tr-card__body">
          <div class="display tr-card__title">{{ r.title }}</div>
          <div class="tr-card__meta">
            <span v-if="r.instructor">{{ r.instructor }}</span>
            <span v-if="r.instructor && r.recordedAt"> · </span>
            <span v-if="r.recordedAt">{{ formatRecordedAt(r.recordedAt) }}</span>
          </div>
          <Eyebrow v-if="r.category" class="tr-card__cat">{{ r.category }}</Eyebrow>
        </div>
      </button>
    </div>

    <RecordingPlayerModal :recording="activeRecording" @close="close" />
  </div>
</template>

<style scoped>
.tr {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .tr {
    padding: 40px 40px 80px;
  }
}

.tr__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .tr__title {
    font-size: 36px;
  }
}
.tr__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 60ch;
}

.tr__toolbar {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
@media (min-width: 768px) {
  .tr__toolbar {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.tr__search {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  width: 100%;
  max-width: 380px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px 7px 32px;
  transition: border-color 120ms var(--ease-out);
}
.tr__search:focus-within {
  border-color: var(--color-brand-600);
}
.tr__search-icon {
  position: absolute;
  left: 11px;
  color: var(--color-muted);
}
.tr__search input {
  flex: 1;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: transparent;
  border: none;
  outline: none;
}

.tr__cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tr__cat {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.tr__cat:hover {
  border-color: var(--color-muted-soft);
}
.tr__cat--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.tr__empty {
  margin-top: 36px;
  padding: 36px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.tr__grid {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 640px) {
  .tr__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 1024px) {
  .tr__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.tr-card {
  display: flex;
  flex-direction: column;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out),
    border-color 160ms var(--ease-out);
  padding: 0;
}
.tr-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--color-muted-soft);
}

.tr-card__thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--color-brand-900);
  overflow: hidden;
}
.tr-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tr-card__thumb-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
  background: linear-gradient(
    135deg,
    var(--color-brand-700) 0%,
    var(--color-brand-900) 100%
  );
  color: white;
}
.tr-card__thumb-fallback .display {
  font-size: 18px;
  line-height: 1.15;
  letter-spacing: -0.01em;
}

.tr-card__play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 52px;
  height: 52px;
  border-radius: 999px;
  background: oklch(0 0 0 / 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: transform 160ms var(--ease-out), background 160ms var(--ease-out);
}
.tr-card:hover .tr-card__play {
  transform: translate(-50%, -50%) scale(1.06);
  background: var(--color-brand-600);
}

.tr-card__duration {
  position: absolute;
  bottom: 10px;
  right: 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 4px;
  background: oklch(0 0 0 / 0.65);
  color: white;
}

.tr-card__body {
  padding: 14px 16px 16px;
}
.tr-card__title {
  font-size: 15.5px;
  letter-spacing: -0.005em;
  line-height: 1.25;
  color: var(--color-ink);
}
.tr-card__meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}
.tr-card__cat {
  margin-top: 8px;
  display: inline-block;
}
</style>
