<script setup lang="ts">
import { ref, computed } from 'vue'
import { Hospital as HospitalIcon, Plus, Power, Save, X, Trash2 } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useHospitalsStore } from '@/stores/hospitals'
import type { Hospital, TraumaLevel, StrokeLevel } from '@/types'

const auth = useAuthStore()
const hospitalsStore = useHospitalsStore()

const hospitals = computed(() => hospitalsStore.hospitals)

const composing = ref(false)
const editing = ref<string | null>(null)
const error = ref<string | null>(null)

const TRAUMA_OPTIONS: TraumaLevel[] = ['I', 'II', 'In Pursuit II', 'III', 'IV', 'N']
const STROKE_OPTIONS: StrokeLevel[] = ['Comprehensive', 'Primary', 'N']
const MATERNAL_OPTIONS = [
  '',
  'Level I (Basic)',
  'Level II (Specialty Care)',
  'Level III (Subspecialty)',
  'Level IV (Comprehensive)',
]
const NICU_OPTIONS = [
  '',
  'Level I (Well Nursery)',
  'Level II (Specialty Care)',
  'Level III (ICU)',
  'Level IV (AICU)',
]

function blank(): Hospital {
  return {
    id: '',
    name: '',
    trauma: 'N',
    stroke: 'N',
    pciCapable: false,
    maternalLevel: null,
    nicuLevel: null,
    isPediatric: false,
    address: '',
    mapUrl: '',
    erDoorCode: null,
    emsRoomCode: null,
    noDoorCode: false,
    notes: null,
    codeEffectiveFrom: null,
    active: true,
    doorCodeUpdatedAt: null,
    doorCodeUpdatedBy: null,
  }
}

const draft = ref<Hospital>(blank())

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[·]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function startCreate() {
  composing.value = true
  editing.value = null
  draft.value = blank()
  error.value = null
}

function startEdit(h: Hospital) {
  composing.value = false
  editing.value = h.id
  draft.value = { ...h }
  error.value = null
}

function cancel() {
  composing.value = false
  editing.value = null
  error.value = null
}

async function save() {
  error.value = null

  if (!draft.value.name.trim()) {
    error.value = 'Hospital name is required.'
    return
  }
  if (composing.value && !draft.value.id.trim()) {
    draft.value.id = slugify(draft.value.name)
  }
  if (!draft.value.id.trim()) {
    error.value = 'Hospital ID is required (auto-generated from name).'
    return
  }
  if (draft.value.noDoorCode) {
    draft.value.erDoorCode = null
    draft.value.emsRoomCode = null
  }

  // Normalize empty strings → null for optional fields
  if (!draft.value.maternalLevel) draft.value.maternalLevel = null
  if (!draft.value.nicuLevel) draft.value.nicuLevel = null
  if (!draft.value.notes) draft.value.notes = null
  if (!draft.value.codeEffectiveFrom) draft.value.codeEffectiveFrom = null
  if (!draft.value.erDoorCode) draft.value.erDoorCode = null
  if (!draft.value.emsRoomCode) draft.value.emsRoomCode = null

  try {
    if (composing.value) {
      await hospitalsStore.add({ ...draft.value })
    } else if (editing.value) {
      await hospitalsStore.update(editing.value, draft.value)
    }
    composing.value = false
    editing.value = null
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function toggleActive(h: Hospital) {
  try {
    await hospitalsStore.setActive(h.id, !h.active)
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function remove(h: Hospital) {
  if (!confirm(`Remove ${h.name}? This is a hard delete.`)) return
  try {
    await hospitalsStore.remove(h.id)
  } catch (err) {
    error.value = (err as Error).message
  }
}
</script>

<template>
  <div class="mh-view">
    <header class="mh-view__header">
      <div class="flex items-center gap-2">
        <HospitalIcon :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mh-view__title">Manage Hospitals</h1>
      </div>
      <p class="mh-view__sub">
        Add a new hospital, deactivate one that's permanently closed, or
        update designations when a facility's trauma or stroke level changes.
        Door codes themselves are managed inline on the
        <RouterLink to="/hospitals" class="mh-view__link">hospitals page</RouterLink>.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mh-view__deny">
      You need admin access to manage hospitals. Currently signed in as
      <strong>{{ auth.role }}</strong>.
    </div>

    <template v-else>
      <div class="mh-view__toolbar">
        <button
          v-if="!composing"
          type="button"
          class="btn btn-primary"
          @click="startCreate"
        >
          <Plus :size="14" :stroke-width="2" /> Add hospital
        </button>
      </div>

      <!-- Compose / edit form -->
      <AppCard v-if="composing || editing" class="mh-form">
        <Eyebrow class="mb-3">{{ composing ? 'Add new hospital' : 'Edit hospital' }}</Eyebrow>
        <form class="mh-form__grid" @submit.prevent="save">
          <label class="mh-form__field mh-form__field--wide">
            <span class="mh-form__label">Name</span>
            <input
              v-model="draft.name"
              type="text"
              class="mh-form__input"
              placeholder="Memorial Hermann · Katy"
              required
            />
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">Trauma designation</span>
            <select v-model="draft.trauma" class="mh-form__input">
              <option v-for="t in TRAUMA_OPTIONS" :key="t" :value="t">{{ t }}</option>
            </select>
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">Stroke designation</span>
            <select v-model="draft.stroke" class="mh-form__input">
              <option v-for="s in STROKE_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>

          <label class="mh-form__field mh-form__check">
            <input v-model="draft.pciCapable" type="checkbox" />
            <span>PCI Capable</span>
          </label>

          <label class="mh-form__field mh-form__check">
            <input v-model="draft.isPediatric" type="checkbox" />
            <span>Pediatric facility</span>
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">Maternal level</span>
            <select v-model="draft.maternalLevel" class="mh-form__input">
              <option
                v-for="m in MATERNAL_OPTIONS"
                :key="m || 'none'"
                :value="m || null"
              >
                {{ m || '— none —' }}
              </option>
            </select>
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">NICU level</span>
            <select v-model="draft.nicuLevel" class="mh-form__input">
              <option
                v-for="n in NICU_OPTIONS"
                :key="n || 'none'"
                :value="n || null"
              >
                {{ n || '— none —' }}
              </option>
            </select>
          </label>

          <label class="mh-form__field mh-form__field--wide">
            <span class="mh-form__label">Address</span>
            <input
              v-model="draft.address"
              type="text"
              class="mh-form__input"
              placeholder="1234 Hospital Way, City, TX 77000"
            />
          </label>

          <label class="mh-form__field mh-form__field--wide">
            <span class="mh-form__label">Map URL</span>
            <input
              v-model="draft.mapUrl"
              type="url"
              class="mh-form__input"
              placeholder="https://maps.app.goo.gl/…"
            />
          </label>

          <label class="mh-form__field mh-form__check">
            <input v-model="draft.noDoorCode" type="checkbox" />
            <span>No door code (ring door bell)</span>
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">ER door code</span>
            <input
              v-model="draft.erDoorCode"
              type="text"
              class="mh-form__input"
              :disabled="draft.noDoorCode"
              placeholder="0911#"
            />
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">EMS room code</span>
            <input
              v-model="draft.emsRoomCode"
              type="text"
              class="mh-form__input"
              :disabled="draft.noDoorCode"
              placeholder="0911"
            />
          </label>

          <label class="mh-form__field">
            <span class="mh-form__label">Code effective from</span>
            <input
              v-model="draft.codeEffectiveFrom"
              type="date"
              class="mh-form__input"
              :disabled="draft.noDoorCode"
            />
          </label>

          <label class="mh-form__field mh-form__field--wide">
            <span class="mh-form__label">Notes</span>
            <input
              v-model="draft.notes"
              type="text"
              class="mh-form__input"
              placeholder="e.g. Codes change annually"
            />
          </label>

          <label class="mh-form__field mh-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (visible to crews)</span>
          </label>

          <div v-if="error" class="mh-form__error">{{ error }}</div>

          <div class="mh-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              <Save :size="14" :stroke-width="2" /> {{ composing ? 'Add' : 'Save' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- All-hospitals list -->
      <div class="mh-list">
        <AppCard
          v-for="h in hospitals"
          :key="h.id"
          class="mh-row"
          :class="{ 'mh-row--inactive': !h.active }"
        >
          <div class="mh-row__main">
            <div class="display mh-row__name">{{ h.name }}</div>
            <div class="mh-row__meta">
              {{ h.trauma === 'N' ? 'No trauma' : `Trauma ${h.trauma}` }}
              <span v-if="h.stroke !== 'N'"> · Stroke {{ h.stroke }}</span>
              <span v-if="h.pciCapable"> · PCI</span>
              <span v-if="h.isPediatric"> · Pediatric</span>
              <span v-if="h.maternalLevel"> · Maternal {{ h.maternalLevel.replace(/^Level /, '') }}</span>
            </div>
            <div class="mh-row__addr">{{ h.address }}</div>
            <span v-if="!h.active" class="mh-row__inactive-chip">Inactive</span>
          </div>

          <div class="mh-row__actions">
            <button
              type="button"
              class="mh-row__btn"
              :class="h.active ? 'mh-row__btn--active' : 'mh-row__btn--inactive'"
              @click="toggleActive(h)"
            >
              <Power :size="13" :stroke-width="1.85" />
              {{ h.active ? 'Deactivate' : 'Activate' }}
            </button>
            <button type="button" class="mh-row__btn" @click="startEdit(h)">
              Edit
            </button>
            <button
              type="button"
              class="mh-row__btn mh-row__btn--danger"
              aria-label="Delete hospital"
              @click="remove(h)"
            >
              <Trash2 :size="13" :stroke-width="1.85" />
            </button>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mh-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mh-view {
    padding: 40px 40px 96px;
  }
}
.mh-view__title {
  font-size: 32px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .mh-view__title {
    font-size: 40px;
  }
}
.mh-view__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 64ch;
}
.mh-view__link {
  color: var(--color-brand-600);
}

.mh-view__deny {
  margin-top: 24px;
  padding: 24px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  background: var(--color-warning-50);
  color: var(--color-ink-soft);
  text-align: center;
}

.mh-view__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 16px;
}
.mh-view__reset {
  margin-left: auto;
}

.mh-form {
  padding: 20px 22px;
  margin-bottom: 16px;
}
.mh-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .mh-form__grid {
    grid-template-columns: 1fr 1fr;
  }
}
.mh-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.mh-form__field--wide {
  grid-column: 1 / -1;
}
.mh-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
}
.mh-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mh-form__input {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
}
.mh-form__input:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.mh-form__input:disabled {
  background: var(--color-surface-soft);
  color: var(--color-muted);
  cursor: not-allowed;
}
.mh-form__error {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  font-size: 13px;
}
.mh-form__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.mh-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mh-row {
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
  align-items: center;
}
.mh-row--inactive {
  opacity: 0.55;
  background: var(--color-surface-soft);
}
.mh-row__name {
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.mh-row__meta {
  font-size: 11.5px;
  color: var(--color-accent-700);
  font-weight: 600;
  letter-spacing: 0.02em;
  margin-top: 2px;
}
.mh-row__addr {
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 1px;
}
.mh-row__inactive-chip {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  background: var(--color-line);
  border-radius: 999px;
}

.mh-row__actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mh-row__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.mh-row__btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.mh-row__btn--active {
  color: var(--color-success-500);
}
.mh-row__btn--inactive {
  color: var(--color-muted);
}
.mh-row__btn--danger {
  color: var(--color-danger-500);
}
.mh-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  background: var(--color-danger-50);
}

@media (max-width: 600px) {
  .mh-row {
    grid-template-columns: 1fr;
  }
  .mh-row__actions {
    justify-content: flex-start;
  }
}
</style>
