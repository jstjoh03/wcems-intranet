<script setup lang="ts">
import { ref, computed } from 'vue'
import { MapPin, Hospital as HospitalIcon, BellRing, Edit2, Lock, Eye, EyeOff, Search, Settings, X } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import CodeEditor from '@/components/dashboard/CodeEditor.vue'
import { useCodeReveal } from '@/composables/useCodeReveal'
import type { Hospital, TraumaLevel } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useHospitalsStore } from '@/stores/hospitals'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'
import { formatLongDate } from '@/utils/date'

const auth = useAuthStore()
const hospitalsStore = useHospitalsStore()
const { latestFor } = useCodeEditHistory()

// Pre-create reveals per (hospital, field). New hospitals added at runtime
// via the admin route lazily get reveals on demand (same pattern as stations).
const reveals = new Map<string, ReturnType<typeof useCodeReveal>>()
for (const h of hospitalsStore.activeHospitals) {
  reveals.set(`${h.id}:er`, useCodeReveal())
  reveals.set(`${h.id}:ems_room`, useCodeReveal())
}
function reveal(id: string, field: 'er' | 'ems_room') {
  const key = `${id}:${field}`
  let r = reveals.get(key)
  if (!r) {
    r = useCodeReveal()
    reveals.set(key, r)
  }
  return r
}

// ── Filters / sort ───────────────────────────────────────────────────
type TraumaFilter = 'All' | 'I' | 'II' | 'III' | 'IV'
const traumaFilter = ref<TraumaFilter>('All')
const filterStrokeC = ref(false)
const filterStrokeP = ref(false)
const filterPCI = ref(false)
const filterPed = ref(false)
const filterMaternal = ref(false)
const search = ref('')

type SortKey = 'trauma' | 'name' | 'stroke' | 'pci'
const sortBy = ref<SortKey>('trauma')

const traumaRank: Record<TraumaLevel, number> = {
  I: 1,
  II: 2,
  III: 3,
  'In Pursuit II': 2.5,
  IV: 4,
  N: 5,
}

const filtered = computed(() => {
  let list = hospitalsStore.activeHospitals.slice()

  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        (h.notes ?? '').toLowerCase().includes(q),
    )
  }

  if (traumaFilter.value !== 'All') {
    list = list.filter((h) => {
      if (traumaFilter.value === 'II') return h.trauma === 'II' || h.trauma === 'In Pursuit II'
      return h.trauma === traumaFilter.value
    })
  }
  if (filterStrokeC.value) list = list.filter((h) => h.stroke === 'Comprehensive')
  if (filterStrokeP.value) list = list.filter((h) => h.stroke === 'Primary')
  if (filterPCI.value) list = list.filter((h) => h.pciCapable)
  if (filterPed.value) list = list.filter((h) => h.isPediatric)
  if (filterMaternal.value) list = list.filter((h) => !!h.maternalLevel)

  if (sortBy.value === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortBy.value === 'stroke') {
    const strokeRank = { Comprehensive: 1, Primary: 2, N: 3 }
    list.sort(
      (a, b) =>
        strokeRank[a.stroke] - strokeRank[b.stroke] || a.name.localeCompare(b.name),
    )
  } else if (sortBy.value === 'pci') {
    list.sort(
      (a, b) =>
        Number(b.pciCapable) - Number(a.pciCapable) || a.name.localeCompare(b.name),
    )
  } else {
    list.sort(
      (a, b) =>
        traumaRank[a.trauma] - traumaRank[b.trauma] || a.name.localeCompare(b.name),
    )
  }
  return list
})

// ── Inline code editing ─────────────────────────────────────────────
type EditTarget = { id: string; field: 'er' | 'ems_room' } | null
const editing = ref<EditTarget>(null)

function startEdit(id: string, field: 'er' | 'ems_room') {
  editing.value = { id, field }
}
function cancelEdit() {
  editing.value = null
}
async function saveCode(h: Hospital, field: 'er' | 'ems_room', newValue: string) {
  editing.value = null
  /* The DB stamp + audit triggers handle door_code_updated_at/by and the
     code_edit_history row; the client only sends the new value. */
  const patch: Partial<Hospital> = {
    [field === 'er' ? 'erDoorCode' : 'emsRoomCode']: newValue,
  }
  try {
    await hospitalsStore.update(h.id, patch)
  } catch (err) {
    console.error('[HospitalsView] save failed:', (err as Error).message)
  }
}

function lastChanged(h: Hospital) {
  const er = latestFor('hospital', h.id, 'er')
  const ems = latestFor('hospital', h.id, 'ems_room')
  const candidates = [er, ems].filter(Boolean) as NonNullable<typeof er>[]
  if (candidates.length > 0) {
    candidates.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
    return { by: candidates[0].changedBy, at: candidates[0].changedAt }
  }
  if (h.doorCodeUpdatedBy && h.doorCodeUpdatedAt)
    return { by: h.doorCodeUpdatedBy, at: h.doorCodeUpdatedAt }
  return null
}

function timeAgo(iso: string) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const traumaVariant = (t: TraumaLevel) => {
  if (t === 'I') return 'trauma-1'
  if (t === 'II' || t === 'In Pursuit II') return 'trauma-2'
  if (t === 'III') return 'trauma-3'
  if (t === 'IV') return 'trauma-4'
  return 'default'
}
const traumaShort = (t: TraumaLevel) => {
  if (t === 'In Pursuit II') return 'In Pursuit · II'
  if (t === 'N') return 'No trauma'
  return `Trauma ${t}`
}
</script>

<template>
  <div class="hosp-view">
    <header class="hosp-view__header">
      <div class="hosp-view__title-row">
        <div class="flex items-center gap-2">
          <HospitalIcon :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
          <h1 class="display hosp-view__title">Hospitals</h1>
        </div>
        <RouterLink
          v-if="auth.isAdmin"
          to="/admin/hospitals"
          class="hosp-view__manage"
        >
          <Settings :size="13" :stroke-width="1.85" />
          Manage
        </RouterLink>
      </div>
      <p class="hosp-view__sub">
        {{ filtered.length }} of {{ hospitalsStore.activeHospitals.length }} hospitals
        <span v-if="search">matching "{{ search }}"</span>
        — sorted by {{ sortBy === 'trauma' ? 'trauma level' : sortBy }}.
      </p>
    </header>

    <div class="hosp-view__controls" role="toolbar" aria-label="Hospital filters">
      <!-- Search bar -->
      <label class="hosp-view__search">
        <Search :size="14" :stroke-width="1.85" />
        <input
          v-model="search"
          type="search"
          placeholder="Search by name, address, or notes…"
          aria-label="Search hospitals"
          autocomplete="off"
        />
        <button
          v-if="search"
          type="button"
          class="hosp-view__search-clear"
          aria-label="Clear search"
          @click="search = ''"
        >
          <X :size="13" />
        </button>
      </label>
      <div class="hosp-view__chip-row" role="radiogroup" aria-label="Trauma level">
        <button
          v-for="t in (['All', 'I', 'II', 'III', 'IV'] as const)"
          :key="t"
          type="button"
          role="radio"
          :aria-checked="traumaFilter === t"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': traumaFilter === t }"
          @click="traumaFilter = t"
        >
          {{ t === 'All' ? 'All' : `Trauma ${t}` }}
        </button>
      </div>

      <div class="hosp-view__chip-row">
        <button type="button" class="hosp-chip" :class="{ 'hosp-chip--on': filterStrokeC }" @click="filterStrokeC = !filterStrokeC">
          Stroke: Comprehensive
        </button>
        <button type="button" class="hosp-chip" :class="{ 'hosp-chip--on': filterStrokeP }" @click="filterStrokeP = !filterStrokeP">
          Stroke: Primary
        </button>
        <button type="button" class="hosp-chip" :class="{ 'hosp-chip--on': filterPCI }" @click="filterPCI = !filterPCI">
          PCI Capable
        </button>
        <button type="button" class="hosp-chip" :class="{ 'hosp-chip--on': filterPed }" @click="filterPed = !filterPed">
          Pediatric
        </button>
        <button type="button" class="hosp-chip" :class="{ 'hosp-chip--on': filterMaternal }" @click="filterMaternal = !filterMaternal">
          Maternal
        </button>
      </div>

      <label class="hosp-view__sort">
        <span class="eyebrow">Sort</span>
        <select v-model="sortBy" class="hosp-view__select">
          <option value="trauma">Trauma level</option>
          <option value="name">Name (A–Z)</option>
          <option value="stroke">Stroke level</option>
          <option value="pci">PCI capable first</option>
        </select>
      </label>
    </div>

    <div class="hosp-view__list">
      <AppCard v-for="h in filtered" :key="h.id" class="hosp-card">
        <!-- Two-column body: info on left, codes on right -->
        <div class="hosp-card__body">
          <div class="hosp-card__info">
            <header class="hosp-card__head">
              <h3 class="hosp-card__name display">{{ h.name }}</h3>
              <AppChip :variant="traumaVariant(h.trauma)" class="hosp-card__trauma">
                {{ traumaShort(h.trauma) }}
              </AppChip>
            </header>
            <a :href="h.mapUrl" target="_blank" rel="noopener noreferrer" class="hosp-card__map">
              <MapPin :size="11" :stroke-width="1.85" />
              {{ h.address }}
            </a>

            <div class="hosp-card__caps">
              <AppChip v-if="h.stroke !== 'N'" variant="brand">
                Stroke · {{ h.stroke }}
              </AppChip>
              <AppChip v-if="h.pciCapable" variant="brand">PCI</AppChip>
              <AppChip v-if="h.maternalLevel" variant="default">
                Maternal · {{ h.maternalLevel.replace(/^Level /, '') }}
              </AppChip>
              <AppChip v-if="h.nicuLevel" variant="default">
                NICU · {{ h.nicuLevel.replace(/^Level /, '') }}
              </AppChip>
              <AppChip v-if="h.isPediatric" variant="accent">Pediatric</AppChip>
            </div>
          </div>

          <!-- Door-code control panel — visually dominant -->
          <aside class="hosp-card__codes">
            <div class="hosp-card__codes-label">
              <Lock :size="11" :stroke-width="2" />
              Door codes
            </div>

            <!-- ER door -->
            <div class="hosp-card__code-row">
              <span class="hosp-card__code-key">ER door</span>

              <CodeEditor
                v-if="editing && editing.id === h.id && editing.field === 'er'"
                :initial-value="h.erDoorCode"
                @save="(v) => saveCode(h, 'er', v)"
                @cancel="cancelEdit"
              />
              <template v-else-if="h.noDoorCode">
                <span class="hosp-card__bell">
                  <BellRing :size="11" :stroke-width="1.85" /> Ring bell
                </span>
              </template>
              <template v-else-if="h.erDoorCode">
                <button
                  v-if="!reveal(h.id, 'er').revealed.value"
                  type="button"
                  class="hosp-card__code-cta"
                  @click="reveal(h.id, 'er').reveal"
                >
                  <Eye :size="18" :stroke-width="2" /> Reveal code
                </button>
                <button
                  v-else
                  type="button"
                  class="hosp-card__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'er').hide"
                >
                  <Lock :size="18" :stroke-width="2" class="hosp-card__code-lock" />
                  <span class="font-mono hosp-card__code-value">{{ h.erDoorCode }}</span>
                  <span class="hosp-card__code-iconbox">
                    <EyeOff :size="16" :stroke-width="2" class="hosp-card__code-eye" />
                  </span>
                  <span class="hosp-card__code-progress" :style="{ width: reveal(h.id, 'er').progressPct.value }" />
                </button>
                <button
                  v-if="!reveal(h.id, 'er').revealed.value"
                  type="button"
                  class="hosp-card__edit"
                  aria-label="Edit ER door code"
                  @click="startEdit(h.id, 'er')"
                >
                  <Edit2 :size="11" :stroke-width="1.85" />
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="hosp-card__code-add"
                  @click="startEdit(h.id, 'er')"
                >
                  <Edit2 :size="10" /> Add code
                </button>
                <span class="hosp-card__edit-spacer" aria-hidden="true" />
              </template>
            </div>

            <!-- EMS room (only when applicable) -->
            <div v-if="!h.noDoorCode" class="hosp-card__code-row">
              <span class="hosp-card__code-key">EMS room</span>

              <CodeEditor
                v-if="editing && editing.id === h.id && editing.field === 'ems_room'"
                :initial-value="h.emsRoomCode"
                @save="(v) => saveCode(h, 'ems_room', v)"
                @cancel="cancelEdit"
              />
              <template v-else-if="h.emsRoomCode">
                <button
                  v-if="!reveal(h.id, 'ems_room').revealed.value"
                  type="button"
                  class="hosp-card__code-cta"
                  @click="reveal(h.id, 'ems_room').reveal"
                >
                  <Eye :size="18" :stroke-width="2" /> Reveal code
                </button>
                <button
                  v-else
                  type="button"
                  class="hosp-card__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'ems_room').hide"
                >
                  <Lock :size="18" :stroke-width="2" class="hosp-card__code-lock" />
                  <span class="font-mono hosp-card__code-value">{{ h.emsRoomCode }}</span>
                  <span class="hosp-card__code-iconbox">
                    <EyeOff :size="16" :stroke-width="2" class="hosp-card__code-eye" />
                  </span>
                  <span class="hosp-card__code-progress" :style="{ width: reveal(h.id, 'ems_room').progressPct.value }" />
                </button>
                <button
                  v-if="!reveal(h.id, 'ems_room').revealed.value"
                  type="button"
                  class="hosp-card__edit"
                  aria-label="Edit EMS room code"
                  @click="startEdit(h.id, 'ems_room')"
                >
                  <Edit2 :size="11" :stroke-width="1.85" />
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="hosp-card__code-add"
                  @click="startEdit(h.id, 'ems_room')"
                >
                  <Edit2 :size="10" /> Add code
                </button>
                <span class="hosp-card__edit-spacer" aria-hidden="true" />
              </template>
            </div>
          </aside>
        </div>

        <!-- Footer: notes, effective date, edited-by stamp -->
        <footer class="hosp-card__foot">
          <div v-if="h.notes" class="hosp-card__notes">{{ h.notes }}</div>
          <div class="hosp-card__meta">
            <span v-if="h.codeEffectiveFrom">
              Effective from {{ formatLongDate(h.codeEffectiveFrom) }}
            </span>
            <span v-if="lastChanged(h)" class="hosp-card__updated">
              Updated by <strong>{{ lastChanged(h)?.by }}</strong> · {{ timeAgo(lastChanged(h)!.at) }}
            </span>
          </div>
        </footer>
      </AppCard>
    </div>

    <div v-if="filtered.length === 0" class="hosp-view__empty">
      No hospitals match those filters. Tap "All" to reset.
    </div>
  </div>
</template>

<style scoped>
.hosp-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .hosp-view {
    padding: 40px 40px 64px;
  }
}

.hosp-view__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.hosp-view__title {
  font-size: 32px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .hosp-view__title {
    font-size: 40px;
  }
}
.hosp-view__manage {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: var(--color-brand-600);
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: background 120ms var(--ease-out);
}
.hosp-view__manage:hover {
  background: var(--color-brand-700);
}
.hosp-view__sub {
  font-size: 13px;
  color: var(--color-muted);
  margin-top: 4px;
}

.hosp-view__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-muted);
  transition: border-color 120ms var(--ease-out);
}
.hosp-view__search:focus-within {
  border-color: var(--color-brand-500);
  color: var(--color-ink);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.hosp-view__search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  min-width: 0;
}
.hosp-view__search input::-webkit-search-cancel-button {
  display: none;
}
.hosp-view__search-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.hosp-view__search-clear:hover {
  color: var(--color-ink);
  background: var(--color-surface-soft);
}

.hosp-view__controls {
  position: sticky;
  top: 56px;
  z-index: 30;
  background: var(--color-canvas);
  padding: 12px 0;
  margin: 16px 0 24px;
  border-bottom: 1px solid var(--color-line);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hosp-view__chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hosp-chip {
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 120ms var(--ease-out);
}
.hosp-chip:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.hosp-chip--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.hosp-view__sort {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.hosp-view__select {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  cursor: pointer;
}
.hosp-view__select:focus {
  border-color: var(--color-brand-500);
}

.hosp-view__list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 1024px) {
  .hosp-view__list {
    grid-template-columns: 1fr 1fr;
  }
}

.hosp-card {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Body splits into info (flex 1) + codes panel (fixed width on desktop) */
.hosp-card__body {
  display: grid;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .hosp-card__body {
    grid-template-columns: 1fr minmax(220px, 260px);
  }
}

.hosp-card__info {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.hosp-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.hosp-card__name {
  font-size: 17px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.2;
  flex: 1;
  min-width: 0;
}
.hosp-card__trauma {
  flex-shrink: 0;
}

.hosp-card__map {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: var(--color-muted);
  text-decoration: none;
  line-height: 1.4;
}
.hosp-card__map:hover {
  color: var(--color-brand-600);
  text-decoration: underline;
}

.hosp-card__caps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Codes panel — elevated treatment with a thin gold accent rule
   instead of a colored fill. White surface, hairline divider, and
   strong type hierarchy do the work. */
.hosp-card__codes {
  position: relative;
  background: var(--color-surface);
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* Mobile: gold rule across the top of the codes block */
.hosp-card__codes::before {
  content: '';
  position: absolute;
  top: 0;
  left: 16px;
  right: 16px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(0.734 0.114 86.8 / 0.55) 18%,
    oklch(0.734 0.114 86.8 / 0.55) 82%,
    transparent 100%
  );
}

@media (min-width: 640px) {
  /* Desktop: gold rule runs vertically as the column divider */
  .hosp-card__codes::before {
    top: 14px;
    bottom: 14px;
    left: 0;
    right: auto;
    height: auto;
    width: 1px;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      oklch(0.734 0.114 86.8 / 0.55) 30%,
      oklch(0.734 0.114 86.8 / 0.55) 70%,
      transparent 100%
    );
  }
}

.hosp-card__codes-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/* Grid so the label + button + edit pencil share the same column tracks
   on every row. `1fr` for the button column rather than `minmax(0,
   1fr)` so the button column can't shrink below its content size and
   force "Reveal code" to wrap. */
.hosp-card__code-row {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  align-items: center;
  gap: 8px;
}
.hosp-card__code-key {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
}

.hosp-card__bell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-ink-soft);
  font-style: italic;
}

.hosp-card__code-cta {
  position: relative;
  flex: 1;
  min-width: 110px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklch, var(--color-accent-on-dark) 48%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-brand-800) 88%, white 10%),
    color-mix(in oklch, var(--color-brand-800) 96%, black 4%)
  );
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  white-space: nowrap;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 3px 8px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;
}
.hosp-card__code-cta:hover {
  transform: translateY(-1px);
  border-color: color-mix(in oklch, var(--color-accent-on-dark) 70%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 5px 12px rgba(0, 0, 0, 0.18),
    0 0 14px color-mix(in oklch, var(--color-accent-on-dark) 22%, transparent);
}
.hosp-card__code-cta:active {
  transform: translateY(0) scale(0.98);
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.32),
    0 2px 6px rgba(0, 0, 0, 0.16);
}
.hosp-card__code-cta svg {
  width: 13px;
  height: 13px;
  color: var(--color-accent-on-dark);
  flex-shrink: 0;
}

.hosp-card__code-revealed {
  position: relative;
  flex: 1;
  min-width: 110px;
  height: 32px;
  white-space: nowrap;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklch, var(--color-accent-on-dark) 48%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-brand-800) 88%, white 10%),
    color-mix(in oklch, var(--color-brand-800) 96%, black 4%)
  );
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 3px 8px rgba(0, 0, 0, 0.14);
  transition: transform 180ms ease;
}
.hosp-card__code-revealed:hover {
  transform: translateY(-1px);
}
.hosp-card__code-revealed svg.hosp-card__code-lock {
  width: 13px;
  height: 13px;
}
.hosp-card__code-lock {
  flex-shrink: 0;
  color: var(--color-accent-on-dark);
}
.hosp-card__code-iconbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
}
.hosp-card__code-iconbox svg {
  width: 12px;
  height: 12px;
}
.hosp-card__code-eye {
  color: rgba(255, 255, 255, 0.78);
}
.hosp-card__code-value {
  flex: 1;
  text-align: center;
}
.hosp-card__code-progress {
  /* Drains from full → 0 over the 20s reveal window. At full it sits like
     a static gold border-bottom; the drain is the auto-hide countdown. */
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2.5px;
  background: var(--color-accent-on-dark);
  transition: width 0.05s linear;
  pointer-events: none;
}

.hosp-card__edit {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.hosp-card__edit:hover {
  border-color: var(--color-line);
  color: var(--color-brand-700);
  background: var(--color-surface);
}

.hosp-card__edit-spacer {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}

.hosp-card__code-add {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--color-muted);
  font-size: 11.5px;
  cursor: pointer;
  transition: color 120ms var(--ease-out);
}
.hosp-card__code-add:hover {
  color: var(--color-brand-600);
}

.hosp-card__foot {
  padding: 8px 16px 12px;
  border-top: 1px solid var(--color-line-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hosp-card__notes {
  font-size: 12px;
  color: var(--color-ink-soft);
  font-style: italic;
}
.hosp-card__meta {
  font-size: 10.5px;
  color: var(--color-muted);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hosp-card__updated strong {
  font-weight: 600;
  color: var(--color-ink-soft);
}

.hosp-view__empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--color-muted);
}
</style>
