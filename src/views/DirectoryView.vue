<script setup lang="ts">
import { ref, computed } from 'vue'
import { Contact, Search, Phone, Mail, MapPin, Calendar } from 'lucide-vue-next'
import {
  useEmployeeDirectory,
  type DirectoryEntry,
} from '@/composables/useEmployeeDirectory'

const { entries, loading, ready } = useEmployeeDirectory()

const search = ref('')
const filterShift = ref<string | null>(null)
const filterStation = ref<string | null>(null)
const filterRole = ref<string | null>(null)

const shifts = computed(() => {
  const set = new Set<string>()
  for (const e of entries.value) if (e.shift) set.add(e.shift)
  return Array.from(set).sort()
})
const stations = computed(() => {
  const set = new Set<string>()
  for (const e of entries.value) if (e.station) set.add(e.station)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})
const roles = computed(() => {
  const set = new Set<string>()
  for (const e of entries.value) set.add(e.role)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (filterShift.value && e.shift !== filterShift.value) return false
    if (filterStation.value && e.station !== filterStation.value) return false
    if (filterRole.value && e.role !== filterRole.value) return false
    if (!q) return true
    return (
      e.fullName.toLowerCase().includes(q) ||
      (e.title ?? '').toLowerCase().includes(q) ||
      (e.station ?? '').toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q)
    )
  })
})

/* Best-effort tel: link. Stripping anything that isn't a digit or '+'
   makes it work whether the user typed (979) 555-0123 or 979.555.0123. */
function telHref(phone: string | null) {
  if (!phone) return null
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

function activeFilters(): boolean {
  return (
    !!filterShift.value ||
    !!filterStation.value ||
    !!filterRole.value ||
    !!search.value.trim()
  )
}

function clearFilters() {
  filterShift.value = null
  filterStation.value = null
  filterRole.value = null
  search.value = ''
}

function entryHref(e: DirectoryEntry): string | null {
  return telHref(e.phone)
}
</script>

<template>
  <div class="dir">
    <header class="dir__header">
      <div class="flex items-center gap-2">
        <Contact :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display dir__title">Employee Directory</h1>
      </div>
      <p class="dir__sub">
        Find a colleague's station, shift, phone, or email. Want to opt out? Open your
        profile (avatar top-right) and toggle "Include me in the Employee Directory."
      </p>
    </header>

    <div class="dir__toolbar">
      <label class="dir__search">
        <Search :size="14" :stroke-width="1.85" class="dir__search-icon" />
        <input
          v-model="search"
          type="search"
          placeholder="Search by name, title, station, or email…"
          aria-label="Search directory"
        />
      </label>
    </div>

    <div class="dir__filters">
      <div class="dir__filter-group">
        <span class="dir__filter-label">Shift</span>
        <button
          type="button"
          class="dir__pill"
          :class="{ 'dir__pill--on': filterShift === null }"
          @click="filterShift = null"
        >
          All
        </button>
        <button
          v-for="s in shifts"
          :key="`s-${s}`"
          type="button"
          class="dir__pill"
          :class="{ 'dir__pill--on': filterShift === s }"
          @click="filterShift = s"
        >
          {{ s }}
        </button>
      </div>
      <div v-if="stations.length" class="dir__filter-group">
        <span class="dir__filter-label">Station</span>
        <button
          type="button"
          class="dir__pill"
          :class="{ 'dir__pill--on': filterStation === null }"
          @click="filterStation = null"
        >
          All
        </button>
        <button
          v-for="s in stations"
          :key="`st-${s}`"
          type="button"
          class="dir__pill"
          :class="{ 'dir__pill--on': filterStation === s }"
          @click="filterStation = s"
        >
          {{ s }}
        </button>
      </div>
      <div v-if="roles.length > 1" class="dir__filter-group">
        <span class="dir__filter-label">Role</span>
        <button
          type="button"
          class="dir__pill"
          :class="{ 'dir__pill--on': filterRole === null }"
          @click="filterRole = null"
        >
          All
        </button>
        <button
          v-for="r in roles"
          :key="`r-${r}`"
          type="button"
          class="dir__pill dir__pill--cap"
          :class="{ 'dir__pill--on': filterRole === r }"
          @click="filterRole = r"
        >
          {{ r }}
        </button>
      </div>
    </div>

    <div v-if="!ready && loading" class="dir__empty">Loading directory…</div>
    <div v-else-if="entries.length === 0" class="dir__empty">
      No one has opted into the directory yet.
    </div>
    <div v-else-if="filtered.length === 0" class="dir__empty">
      No matches.
      <button v-if="activeFilters()" type="button" class="dir__clear" @click="clearFilters">
        Clear filters
      </button>
    </div>

    <div v-else class="dir__grid">
      <article v-for="e in filtered" :key="e.id" class="dir-card">
        <header class="dir-card__head">
          <div class="dir-card__avatar display">{{ e.initials }}</div>
          <div class="dir-card__head-text">
            <div class="display dir-card__name">{{ e.fullName }}</div>
            <div v-if="e.title || e.role" class="dir-card__title">
              <span v-if="e.title">{{ e.title }}</span>
              <span v-else class="dir-card__role">{{ e.role }}</span>
            </div>
          </div>
        </header>

        <div class="dir-card__meta">
          <div v-if="e.station" class="dir-card__meta-row">
            <MapPin :size="13" :stroke-width="1.85" />
            <span>{{ e.station }}</span>
          </div>
          <div v-if="e.shift" class="dir-card__meta-row">
            <Calendar :size="13" :stroke-width="1.85" />
            <span>Shift {{ e.shift }}</span>
          </div>
        </div>

        <div class="dir-card__actions">
          <a
            v-if="e.phone"
            :href="entryHref(e) ?? '#'"
            class="dir-card__action"
            :title="`Call ${e.phone}`"
          >
            <Phone :size="13" :stroke-width="1.85" />
            <span class="dir-card__action-text">{{ e.phone }}</span>
          </a>
          <a
            :href="`mailto:${e.email}`"
            class="dir-card__action"
            :title="`Email ${e.email}`"
          >
            <Mail :size="13" :stroke-width="1.85" />
            <span class="dir-card__action-text dir-card__action-text--break">
              {{ e.email }}
            </span>
          </a>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.dir {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .dir {
    padding: 40px 40px 80px;
  }
}

.dir__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .dir__title {
    font-size: 36px;
  }
}
.dir__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 60ch;
}

.dir__toolbar {
  margin-top: 18px;
}
.dir__search {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
  max-width: 480px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px 7px 32px;
  transition: border-color 120ms var(--ease-out);
}
.dir__search:focus-within {
  border-color: var(--color-brand-600);
}
.dir__search-icon {
  position: absolute;
  left: 11px;
  color: var(--color-muted);
}
.dir__search input {
  flex: 1;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: transparent;
  border: none;
  outline: none;
}

.dir__filters {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
@media (min-width: 768px) {
  .dir__filters {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 18px;
  }
}
.dir__filter-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dir__filter-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-right: 4px;
}

.dir__pill {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 4px 11px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.dir__pill:hover {
  border-color: var(--color-muted-soft);
}
.dir__pill--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.dir__pill--cap {
  text-transform: capitalize;
}

.dir__empty {
  margin-top: 36px;
  padding: 36px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.dir__clear {
  display: inline-block;
  margin-top: 10px;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.dir__clear:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}

.dir__grid {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .dir__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (min-width: 1024px) {
  .dir__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.dir-card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 160ms var(--ease-out), box-shadow 160ms var(--ease-out),
    transform 160ms var(--ease-out);
}
.dir-card:hover {
  transform: translateY(-1px);
  border-color: var(--color-muted-soft);
  box-shadow: var(--shadow-md);
}

.dir-card__head {
  display: flex;
  gap: 12px;
  align-items: center;
}
.dir-card__avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  letter-spacing: -0.01em;
}
.dir-card__head-text {
  flex: 1;
  min-width: 0;
}
.dir-card__name {
  font-size: 16px;
  color: var(--color-ink);
  letter-spacing: -0.005em;
  line-height: 1.2;
}
.dir-card__title {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-muted);
}
.dir-card__role {
  text-transform: capitalize;
}

.dir-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--color-ink-soft);
}
.dir-card__meta-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dir-card__actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dir-card__action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12.5px;
  color: var(--color-ink);
  text-decoration: none;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.dir-card__action:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
.dir-card__action-text {
  min-width: 0;
  flex: 1;
}
.dir-card__action-text--break {
  word-break: break-all;
  font-size: 11.5px;
}
</style>
