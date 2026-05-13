<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Play, Search, Film } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import RecordingPlayerModal from '@/components/training/RecordingPlayerModal.vue'
import {
  useTrainingRecordings,
  sortRecordings,
  type TrainingRecording,
  type SortKey,
} from '@/composables/useTrainingRecordings'
import { resolveThumbnail } from '@/lib/videoSource'

const route = useRoute()
const router = useRouter()
const { visibleRecordings, categories, loading, ready } = useTrainingRecordings()

const search = ref('')
const activeCategory = ref<string | null>(null)
const sortKey = ref<SortKey>('newest')
const activeRecording = ref<TrainingRecording | null>(null)

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'most-viewed', label: 'Most viewed' },
  { value: 'alpha', label: 'A → Z' },
]

/* How many videos to surface in the Recently Added strip at the top
   of the grouped view. 6 fills two clean rows on a 3-col desktop and
   wraps gracefully on narrower screens. If the library has fewer than
   this it just shows what exists. */
const RECENTLY_ADDED_LIMIT = 6

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

/* Search + category filter + sort.
   - When activeCategory is null, the grid below switches to "grouped by
     category" sections. When it's set, the grid is a flat list of just
     that category — grouping by one category would be redundant.
   - Sort is applied AFTER filtering so the "Most viewed" option reflects
     the visible slice, not the global library. */
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const base = visibleRecordings.value.filter((r) => {
    if (activeCategory.value && r.category !== activeCategory.value) return false
    if (!q) return true
    return (
      r.title.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q) ||
      (r.instructor ?? '').toLowerCase().includes(q) ||
      (r.category ?? '').toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
    )
  })
  return sortRecordings(base, sortKey.value)
})

/* Recently Added — top N by created_at (upload date), not recorded_at,
   so an older training that was just digitized still counts as "new."
   Same visibility gate as `grouped` below: only shows when "All" is
   selected and no search is active. Sort key is forced regardless of
   what the user picked in the toolbar — the section's whole purpose
   is "what's new", so user sort would defeat it. */
const recentlyAdded = computed(() => {
  if (activeCategory.value || search.value.trim()) return null
  if (visibleRecordings.value.length === 0) return null
  return [...visibleRecordings.value]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENTLY_ADDED_LIMIT)
})

/* When activeCategory is null AND there's no search, render groups.
   Each group is { name, items }; uncategorized rows fall into a
   "Other" bucket at the bottom. Empty groups are skipped per Justin's
   spec — keeps the page clean when categories haven't been populated. */
const grouped = computed(() => {
  if (activeCategory.value || search.value.trim()) return null
  const map = new Map<string, TrainingRecording[]>()
  for (const r of filtered.value) {
    const key = (r.category ?? '').trim() || 'Other'
    const list = map.get(key) ?? []
    list.push(r)
    map.set(key, list)
  }
  return Array.from(map.entries())
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => {
      /* "Other" sinks to the bottom; otherwise alphabetical. */
      if (a === 'Other' && b !== 'Other') return 1
      if (b === 'Other' && a !== 'Other') return -1
      return a.localeCompare(b)
    })
    .map(([name, items]) => ({ name, items }))
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
          placeholder="Search by title, instructor, topic, or tag…"
          aria-label="Search recordings"
        />
      </label>
      <div class="tr__toolbar-right">
        <select v-model="sortKey" class="tr__sort" aria-label="Sort recordings">
          <option v-for="s in SORT_OPTIONS" :key="s.value" :value="s.value">
            Sort: {{ s.label }}
          </option>
        </select>
      </div>
    </div>

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

    <div v-if="!ready && loading" class="tr__empty">Loading recordings…</div>
    <div v-else-if="filtered.length === 0" class="tr__empty">
      <template v-if="search || activeCategory">No recordings match those filters.</template>
      <template v-else>
        No recordings yet. Check back soon — admins will post past trainings here.
      </template>
    </div>

    <!-- Grouped view: "All" + no search → Recently Added strip on top,
         then category sections with headers. -->
    <template v-else-if="grouped">
      <section v-if="recentlyAdded && recentlyAdded.length > 0" class="tr-group tr-group--recent">
        <div class="tr-group__head">
          <h2 class="display tr-group__title">Recently Added</h2>
          <span class="tr-group__count">Just published</span>
        </div>
        <div class="tr__grid">
          <button
            v-for="r in recentlyAdded"
            :key="`recent-${r.id}`"
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
      </section>

      <section v-for="g in grouped" :key="g.name" class="tr-group">
        <div class="tr-group__head">
          <h2 class="display tr-group__title">{{ g.name }}</h2>
          <span class="tr-group__count">{{ g.items.length }}</span>
        </div>
        <div class="tr__grid">
          <button
            v-for="r in g.items"
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
              <div v-if="r.tags.length > 0" class="tr-card__tags">
                <span v-for="t in r.tags" :key="t" class="tr-card__tag">{{ t }}</span>
              </div>
            </div>
          </button>
        </div>
      </section>
    </template>

    <!-- Flat view: a specific category is selected, or there's a search. -->
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
          <div v-if="r.tags.length > 0" class="tr-card__tags">
            <span v-for="t in r.tags" :key="t" class="tr-card__tag">{{ t }}</span>
          </div>
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
.tr__toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tr__sort {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
}
.tr__sort:focus-visible {
  outline: none;
  border-color: var(--color-brand-600);
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
  margin-top: 14px;
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
.tr-card__tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tr-card__tag {
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-brand-100);
  color: var(--color-brand-700);
}

/* ── Grouped-by-category sections ─────────────────────────────────── */
.tr-group {
  margin-top: 28px;
}
.tr-group__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 10px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--color-line);
}
.tr-group__title {
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.tr-group__count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  letter-spacing: 0.04em;
}
</style>
