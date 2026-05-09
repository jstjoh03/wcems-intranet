<script setup lang="ts">
import { ref, computed } from 'vue'
import { Phone, MapPin, Hospital as HospitalIcon, BellRing, Edit2, Lock } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import RevealCode from '@/components/primitives/RevealCode.vue'
import CodeEditor from '@/components/dashboard/CodeEditor.vue'
import hospitalsData from '@/data/hospitals.json'
import type { Hospital, TraumaLevel, CodeField } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'

const auth = useAuthStore()
const hospitals = ref<Hospital[]>(JSON.parse(JSON.stringify(hospitalsData)))
const { record, latestFor } = useCodeEditHistory()

// ── Filters / sort ───────────────────────────────────────────────────
type TraumaFilter = 'All' | 'I' | 'II' | 'III' | 'IV'
const traumaFilter = ref<TraumaFilter>('All')
const filterStrokeC = ref(false)
const filterStrokeP = ref(false)
const filterPCI = ref(false)
const filterPed = ref(false)
const filterMaternal = ref(false)

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
  let list = hospitals.value.slice()

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

function saveCode(h: Hospital, field: 'er' | 'ems_room', newValue: string) {
  const oldValue = field === 'er' ? h.erDoorCode ?? '' : h.emsRoomCode ?? ''
  if (field === 'er') h.erDoorCode = newValue
  else h.emsRoomCode = newValue
  h.doorCodeUpdatedAt = new Date().toISOString()
  h.doorCodeUpdatedBy = auth.appUser?.fullName ?? 'Unknown'

  record({
    entityType: 'hospital',
    entityId: h.id,
    codeField: field as CodeField,
    oldValue,
    newValue,
    changedBy: h.doorCodeUpdatedBy,
  })

  editing.value = null
}

function lastChanged(h: Hospital, field: 'er' | 'ems_room') {
  const fromHistory = latestFor('hospital', h.id, field)
  if (fromHistory) return { by: fromHistory.changedBy, at: fromHistory.changedAt }
  if (!h.doorCodeUpdatedBy || !h.doorCodeUpdatedAt) return null
  return { by: h.doorCodeUpdatedBy, at: h.doorCodeUpdatedAt }
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
      <div class="flex items-center gap-2">
        <HospitalIcon :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display hosp-view__title">Hospitals</h1>
      </div>
      <p class="hosp-view__sub">
        {{ filtered.length }} of {{ hospitals.length }} hospitals — sorted by {{ sortBy === 'trauma' ? 'trauma level' : sortBy }}.
      </p>
    </header>

    <!-- Sticky filter / sort strip -->
    <div class="hosp-view__controls" role="toolbar" aria-label="Hospital filters">
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
        <button
          type="button"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': filterStrokeC }"
          @click="filterStrokeC = !filterStrokeC"
          aria-pressed="filterStrokeC"
        >
          Stroke: Comprehensive
        </button>
        <button
          type="button"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': filterStrokeP }"
          @click="filterStrokeP = !filterStrokeP"
          aria-pressed="filterStrokeP"
        >
          Stroke: Primary
        </button>
        <button
          type="button"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': filterPCI }"
          @click="filterPCI = !filterPCI"
          aria-pressed="filterPCI"
        >
          PCI Capable
        </button>
        <button
          type="button"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': filterPed }"
          @click="filterPed = !filterPed"
          aria-pressed="filterPed"
        >
          Pediatric
        </button>
        <button
          type="button"
          class="hosp-chip"
          :class="{ 'hosp-chip--on': filterMaternal }"
          @click="filterMaternal = !filterMaternal"
          aria-pressed="filterMaternal"
        >
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

    <!-- Card list -->
    <div class="hosp-view__list">
      <AppCard v-for="h in filtered" :key="h.id" class="hosp-card">
        <header class="hosp-card__head">
          <div class="hosp-card__name-block">
            <h3 class="hosp-card__name display">{{ h.name }}</h3>
            <div class="hosp-card__address">
              <a :href="h.mapUrl" target="_blank" rel="noopener noreferrer" class="hosp-card__map">
                <MapPin :size="11" :stroke-width="1.85" />
                {{ h.address }}
              </a>
            </div>
          </div>
          <AppChip :variant="traumaVariant(h.trauma)" class="hosp-card__trauma">
            {{ traumaShort(h.trauma) }}
          </AppChip>
        </header>

        <!-- Capability chips -->
        <div class="hosp-card__caps">
          <AppChip v-if="h.stroke !== 'N'" variant="brand">
            Stroke · {{ h.stroke }}
          </AppChip>
          <AppChip v-if="h.pciCapable" variant="brand">PCI</AppChip>
          <AppChip v-if="h.maternalLevel" variant="default">
            Mat · {{ h.maternalLevel.replace(/^Level /, '') }}
          </AppChip>
          <AppChip v-if="h.nicuLevel" variant="default">
            NICU · {{ h.nicuLevel.replace(/^Level /, '') }}
          </AppChip>
          <AppChip v-if="h.isPediatric" variant="accent">Pediatric</AppChip>
        </div>

        <!-- Codes -->
        <div class="hosp-card__codes">
          <!-- ER door code -->
          <div class="hosp-card__code-row">
            <span class="hosp-card__code-label">
              <Lock :size="10" :stroke-width="2" /> ER door
            </span>

            <CodeEditor
              v-if="editing && editing.id === h.id && editing.field === 'er'"
              :initial-value="h.erDoorCode"
              @save="(v) => saveCode(h, 'er', v)"
              @cancel="cancelEdit"
            />
            <template v-else-if="h.noDoorCode">
              <span class="hosp-card__bell">
                <BellRing :size="11" :stroke-width="1.85" /> Ring door bell
              </span>
            </template>
            <template v-else-if="h.erDoorCode">
              <RevealCode :code="h.erDoorCode" :compact="true" placeholder="Reveal" />
              <button
                type="button"
                class="hosp-card__update-btn"
                @click="startEdit(h.id, 'er')"
              >
                <Edit2 :size="10" /> Update
              </button>
            </template>
            <template v-else>
              <span class="hosp-card__no-code">No code on file</span>
              <button
                type="button"
                class="hosp-card__update-btn"
                @click="startEdit(h.id, 'er')"
              >
                <Edit2 :size="10" /> Add
              </button>
            </template>
          </div>

          <!-- EMS room code -->
          <div v-if="h.emsRoomCode || (!h.noDoorCode && editing?.id === h.id && editing?.field === 'ems_room')" class="hosp-card__code-row">
            <span class="hosp-card__code-label">
              <Lock :size="10" :stroke-width="2" /> EMS room
            </span>

            <CodeEditor
              v-if="editing && editing.id === h.id && editing.field === 'ems_room'"
              :initial-value="h.emsRoomCode"
              @save="(v) => saveCode(h, 'ems_room', v)"
              @cancel="cancelEdit"
            />
            <template v-else>
              <RevealCode :code="h.emsRoomCode" :compact="true" placeholder="Reveal" />
              <button
                type="button"
                class="hosp-card__update-btn"
                @click="startEdit(h.id, 'ems_room')"
              >
                <Edit2 :size="10" /> Update
              </button>
            </template>
          </div>

          <!-- Add EMS room code button when none exists -->
          <button
            v-if="!h.emsRoomCode && !h.noDoorCode && (!editing || editing.id !== h.id || editing.field !== 'ems_room')"
            type="button"
            class="hosp-card__add-ems"
            @click="startEdit(h.id, 'ems_room')"
          >
            + Add EMS room code
          </button>

          <!-- Updated meta + notes -->
          <div v-if="lastChanged(h, 'er')" class="hosp-card__updated">
            Updated by <strong>{{ lastChanged(h, 'er')?.by }}</strong>
            · {{ timeAgo(lastChanged(h, 'er')!.at) }}
            <span v-if="h.codeEffectiveFrom">· effective from {{ new Date(h.codeEffectiveFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
          </div>

          <div v-if="h.notes" class="hosp-card__notes">{{ h.notes }}</div>
        </div>

        <!-- Phone-style call link if a phone number is ever added -->
        <a v-if="false" href="tel:" class="hosp-card__phone">
          <Phone :size="11" />
        </a>
      </AppCard>
    </div>

    <div v-if="filtered.length === 0" class="hosp-view__empty">
      No hospitals match those filters. Tap "All" to reset.
    </div>
  </div>
</template>

<style scoped>
.hosp-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .hosp-view {
    padding: 40px 40px 64px;
  }
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
.hosp-view__sub {
  font-size: 13px;
  color: var(--color-muted);
  margin-top: 4px;
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
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hosp-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.hosp-card__name-block {
  flex: 1;
  min-width: 0;
}
.hosp-card__name {
  font-size: 18px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.2;
}
.hosp-card__address {
  margin-top: 4px;
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
.hosp-card__trauma {
  flex-shrink: 0;
}

.hosp-card__caps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.hosp-card__codes {
  padding-top: 10px;
  border-top: 1px solid var(--color-line-soft);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hosp-card__code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hosp-card__code-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  min-width: 84px;
}
.hosp-card__bell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent-700);
  background: oklch(0.97 0.04 86.8);
  border: 1px solid oklch(0.92 0.07 86.8);
  border-radius: 999px;
  padding: 3px 10px;
}
.hosp-card__no-code {
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
}
.hosp-card__update-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 999px;
  transition: all 120ms var(--ease-out);
}
.hosp-card__update-btn:hover {
  border-color: var(--color-line);
  color: var(--color-brand-600);
}
.hosp-card__add-ems {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--color-line);
  color: var(--color-muted);
  font-size: 11.5px;
  padding: 4px 12px;
  border-radius: 999px;
  cursor: pointer;
}
.hosp-card__add-ems:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-brand-600);
}

.hosp-card__updated {
  font-size: 11px;
  color: var(--color-muted);
}
.hosp-card__updated strong {
  font-weight: 600;
  color: var(--color-ink-soft);
}
.hosp-card__notes {
  font-size: 12px;
  color: var(--color-ink-soft);
  font-style: italic;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--color-surface-soft);
  border-left: 2px solid var(--color-accent-500);
}

.hosp-view__empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--color-muted);
}
</style>
