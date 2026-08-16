<script setup lang="ts">
import { ref, computed } from 'vue'
import { MapPin, Hospital as HospitalIcon, BellRing, Edit2, Lock, Eye, EyeOff, Search, Settings, X, ChevronRight } from 'lucide-vue-next'
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

// ── Row expansion ────────────────────────────────────────────────────
const openId = ref<string | null>(null)
function toggleRow(id: string) {
  openId.value = openId.value === id ? null : id
  if (editing.value && editing.value.id !== openId.value) editing.value = null
}

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
      <AppCard
        v-for="h in filtered"
        :key="h.id"
        class="hosp-row"
        :class="{ 'hosp-row--open': openId === h.id }"
      >
        <!-- Collapsed row: name + trauma badge + the ER code, right here. -->
        <div class="hosp-row__head">
          <button type="button" class="hosp-row__toggle" @click="toggleRow(h.id)">
            <ChevronRight
              :size="15"
              :stroke-width="2"
              class="hosp-row__chev"
              :class="{ 'hosp-row__chev--open': openId === h.id }"
            />
            <span class="hosp-row__name display">{{ h.name }}</span>
            <AppChip :variant="traumaVariant(h.trauma)" class="hosp-row__trauma">
              {{ traumaShort(h.trauma) }}
            </AppChip>
          </button>

          <span class="hosp-row__quick">
            <span v-if="h.noDoorCode" class="hosp-row__bell">
              <BellRing :size="12" :stroke-width="1.85" /> Ring bell
            </span>
            <template v-else-if="h.erDoorCode">
              <button
                v-if="!reveal(h.id, 'er').revealed.value"
                type="button"
                class="hosp-row__code-cta"
                @click="reveal(h.id, 'er').reveal"
              >
                <Eye :size="14" :stroke-width="2" /> ER code
              </button>
              <button
                v-else
                type="button"
                class="hosp-row__code-revealed"
                title="Tap to hide"
                @click="reveal(h.id, 'er').hide"
              >
                <span class="font-mono hosp-row__code-value">{{ h.erDoorCode }}</span>
                <EyeOff :size="13" :stroke-width="2" class="hosp-row__code-eye" />
                <span class="hosp-row__code-progress" :style="{ width: reveal(h.id, 'er').progressPct.value }" />
              </button>
            </template>
            <span v-else class="hosp-row__nocode">no code</span>
          </span>
        </div>

        <!-- Expanded: capabilities, address, both code rows w/ editing, notes. -->
        <div v-if="openId === h.id" class="hosp-row__detail">
          <div class="hosp-row__caps">
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

          <a :href="h.mapUrl" target="_blank" rel="noopener noreferrer" class="hosp-row__map">
            <MapPin :size="11" :stroke-width="1.85" />
            {{ h.address }}
          </a>

          <div class="hosp-row__codes">
            <!-- ER door -->
            <div class="hosp-row__code-line">
              <span class="hosp-row__code-key"><Lock :size="10" :stroke-width="2" /> ER door</span>
              <CodeEditor
                v-if="editing && editing.id === h.id && editing.field === 'er'"
                :initial-value="h.erDoorCode"
                @save="(v) => saveCode(h, 'er', v)"
                @cancel="cancelEdit"
              />
              <template v-else-if="h.noDoorCode">
                <span class="hosp-row__bell">
                  <BellRing :size="11" :stroke-width="1.85" /> Ring bell
                </span>
              </template>
              <template v-else>
                <button
                  v-if="h.erDoorCode && !reveal(h.id, 'er').revealed.value"
                  type="button"
                  class="hosp-row__code-cta"
                  @click="reveal(h.id, 'er').reveal"
                >
                  <Eye :size="14" :stroke-width="2" /> Reveal
                </button>
                <button
                  v-else-if="h.erDoorCode"
                  type="button"
                  class="hosp-row__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'er').hide"
                >
                  <span class="font-mono hosp-row__code-value">{{ h.erDoorCode }}</span>
                  <EyeOff :size="13" :stroke-width="2" class="hosp-row__code-eye" />
                  <span class="hosp-row__code-progress" :style="{ width: reveal(h.id, 'er').progressPct.value }" />
                </button>
                <button
                  v-if="!h.erDoorCode || !reveal(h.id, 'er').revealed.value"
                  type="button"
                  class="hosp-row__edit"
                  :aria-label="h.erDoorCode ? 'Edit ER door code' : 'Add ER door code'"
                  @click="startEdit(h.id, 'er')"
                >
                  <Edit2 :size="11" :stroke-width="1.85" />
                  <template v-if="!h.erDoorCode">Add code</template>
                </button>
              </template>
            </div>

            <!-- EMS room (only when applicable) -->
            <div v-if="!h.noDoorCode" class="hosp-row__code-line">
              <span class="hosp-row__code-key"><Lock :size="10" :stroke-width="2" /> EMS room</span>
              <CodeEditor
                v-if="editing && editing.id === h.id && editing.field === 'ems_room'"
                :initial-value="h.emsRoomCode"
                @save="(v) => saveCode(h, 'ems_room', v)"
                @cancel="cancelEdit"
              />
              <template v-else>
                <button
                  v-if="h.emsRoomCode && !reveal(h.id, 'ems_room').revealed.value"
                  type="button"
                  class="hosp-row__code-cta"
                  @click="reveal(h.id, 'ems_room').reveal"
                >
                  <Eye :size="14" :stroke-width="2" /> Reveal
                </button>
                <button
                  v-else-if="h.emsRoomCode"
                  type="button"
                  class="hosp-row__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'ems_room').hide"
                >
                  <span class="font-mono hosp-row__code-value">{{ h.emsRoomCode }}</span>
                  <EyeOff :size="13" :stroke-width="2" class="hosp-row__code-eye" />
                  <span class="hosp-row__code-progress" :style="{ width: reveal(h.id, 'ems_room').progressPct.value }" />
                </button>
                <button
                  v-if="!h.emsRoomCode || !reveal(h.id, 'ems_room').revealed.value"
                  type="button"
                  class="hosp-row__edit"
                  :aria-label="h.emsRoomCode ? 'Edit EMS room code' : 'Add EMS room code'"
                  @click="startEdit(h.id, 'ems_room')"
                >
                  <Edit2 :size="11" :stroke-width="1.85" />
                  <template v-if="!h.emsRoomCode">Add code</template>
                </button>
              </template>
            </div>
          </div>

          <div v-if="h.notes" class="hosp-row__notes">{{ h.notes }}</div>
          <div class="hosp-row__meta">
            <span v-if="h.codeEffectiveFrom">
              Effective from {{ formatLongDate(h.codeEffectiveFrom) }}
            </span>
            <span v-if="lastChanged(h)" class="hosp-row__updated">
              Updated by <strong>{{ lastChanged(h)?.by }}</strong> · {{ timeAgo(lastChanged(h)!.at) }}
            </span>
          </div>
        </div>
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
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Collapsible rows ─────────────────────────────────────────────── */
.hosp-row {
  padding: 0;
  overflow: hidden;
}
.hosp-row--open {
  box-shadow: var(--shadow-md);
}

.hosp-row__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 8px;
  flex-wrap: wrap;
}
.hosp-row__toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}
.hosp-row__chev {
  flex-shrink: 0;
  color: var(--color-muted-soft);
  transition: transform 140ms var(--ease-out);
}
.hosp-row__chev--open {
  transform: rotate(90deg);
}
.hosp-row__name {
  font-size: 16.5px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.15;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hosp-row__trauma {
  flex-shrink: 0;
}

.hosp-row__quick {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}
.hosp-row__bell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-700);
  padding: 6px 10px;
  white-space: nowrap;
}
.hosp-row__nocode {
  font-size: 11.5px;
  color: var(--color-muted-soft);
  padding: 6px 10px;
}

.hosp-row__code-cta,
.hosp-row__code-revealed {
  position: relative;
  height: 30px;
  min-width: 96px;
  padding: 0 12px;
  border-radius: 7px;
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
  gap: 7px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 2px 6px rgba(0, 0, 0, 0.12);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.hosp-row__code-cta:hover,
.hosp-row__code-revealed:hover {
  transform: translateY(-1px);
}
.hosp-row__code-cta svg {
  color: var(--color-accent-on-dark);
  flex-shrink: 0;
}
.hosp-row__code-revealed {
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  justify-content: space-between;
}
.hosp-row__code-value {
  flex: 1;
  text-align: center;
}
.hosp-row__code-eye {
  color: rgba(255, 255, 255, 0.78);
  flex-shrink: 0;
}
.hosp-row__code-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2.5px;
  background: var(--color-accent-on-dark);
  transition: width 0.05s linear;
  pointer-events: none;
}

/* ── Expanded detail ──────────────────────────────────────────────── */
.hosp-row__detail {
  padding: 12px 14px 12px 31px;
  border-top: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hosp-row__caps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hosp-row__map {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.hosp-row__map:hover {
  text-decoration: underline;
}
.hosp-row__codes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hosp-row__code-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hosp-row__code-key {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 84px;
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.hosp-row__edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.hosp-row__edit:hover {
  color: var(--color-brand-600);
  background: var(--color-surface);
}
.hosp-row__notes {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
  padding: 8px 10px;
  border-left: 3px solid var(--color-accent-600);
  background: var(--color-surface);
  border-radius: 0 8px 8px 0;
}
.hosp-row__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--color-muted);
}
.hosp-row__updated {
  margin-left: auto;
}

.hosp-view__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted-soft);
}
</style>
