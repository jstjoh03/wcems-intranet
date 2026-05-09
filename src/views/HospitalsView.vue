<script setup lang="ts">
import { ref, computed } from 'vue'
import { MapPin, Hospital as HospitalIcon, BellRing, Edit2, Lock, Eye, EyeOff } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import CodeEditor from '@/components/dashboard/CodeEditor.vue'
import { useCodeReveal } from '@/composables/useCodeReveal'
import hospitalsData from '@/data/hospitals.json'
import type { Hospital, TraumaLevel, CodeField } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'

const auth = useAuthStore()
const hospitals = ref<Hospital[]>(JSON.parse(JSON.stringify(hospitalsData)))
const { record, latestFor } = useCodeEditHistory()

// Pre-create reveals per (hospital, field) so composable lifecycle hooks
// register on this view's instance during setup.
const reveals = new Map<string, ReturnType<typeof useCodeReveal>>()
for (const h of hospitals.value) {
  reveals.set(`${h.id}:er`, useCodeReveal())
  reveals.set(`${h.id}:ems_room`, useCodeReveal())
}
function reveal(id: string, field: 'er' | 'ems_room') {
  return reveals.get(`${id}:${field}`)!
}

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
    changedBy: h.doorCodeUpdatedBy ?? 'Unknown',
  })
  editing.value = null
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
      <div class="flex items-center gap-2">
        <HospitalIcon :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display hosp-view__title">Hospitals</h1>
      </div>
      <p class="hosp-view__sub">
        {{ filtered.length }} of {{ hospitals.length }} hospitals — sorted by
        {{ sortBy === 'trauma' ? 'trauma level' : sortBy }}.
        Door codes shown in gold; tap to reveal.
      </p>
    </header>

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
                  <Eye :size="11" :stroke-width="2" /> Tap to reveal
                </button>
                <button
                  v-else
                  type="button"
                  class="hosp-card__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'er').hide"
                >
                  <span class="font-mono hosp-card__code-value">{{ h.erDoorCode }}</span>
                  <EyeOff :size="11" :stroke-width="1.85" />
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
                  <Eye :size="11" :stroke-width="2" /> Tap to reveal
                </button>
                <button
                  v-else
                  type="button"
                  class="hosp-card__code-revealed"
                  title="Tap to hide"
                  @click="reveal(h.id, 'ems_room').hide"
                >
                  <span class="font-mono hosp-card__code-value">{{ h.emsRoomCode }}</span>
                  <EyeOff :size="11" :stroke-width="1.85" />
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
              </template>
            </div>
          </aside>
        </div>

        <!-- Footer: notes, effective date, edited-by stamp -->
        <footer class="hosp-card__foot">
          <div v-if="h.notes" class="hosp-card__notes">{{ h.notes }}</div>
          <div class="hosp-card__meta">
            <span v-if="h.codeEffectiveFrom">
              Effective from {{ new Date(h.codeEffectiveFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
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

/* Codes panel — the most-used info, given dominant treatment */
.hosp-card__codes {
  background: oklch(0.97 0.04 86.8);
  border-top: 1px solid oklch(0.92 0.07 86.8);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
@media (min-width: 640px) {
  .hosp-card__codes {
    border-top: none;
    border-left: 1px solid oklch(0.92 0.07 86.8);
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
  color: var(--color-accent-700);
}

.hosp-card__code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hosp-card__code-key {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
  min-width: 56px;
  flex-shrink: 0;
}

.hosp-card__bell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent-700);
  font-style: italic;
}

.hosp-card__code-cta {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-accent-500);
  color: var(--color-brand-700);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.hosp-card__code-cta:hover {
  background: var(--color-accent-500);
  color: var(--color-brand-900);
}

.hosp-card__code-revealed {
  position: relative;
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 8px;
  background: var(--color-brand-700);
  border: 1px solid var(--color-brand-700);
  color: white;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  overflow: hidden;
}
.hosp-card__code-value {
  flex: 1;
  text-align: left;
}
.hosp-card__code-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--color-accent-500);
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

.hosp-card__code-add {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  background: transparent;
  border: 1px dashed var(--color-line);
  color: var(--color-muted);
  font-size: 11.5px;
  cursor: pointer;
}
.hosp-card__code-add:hover {
  border-color: var(--color-muted-soft);
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
