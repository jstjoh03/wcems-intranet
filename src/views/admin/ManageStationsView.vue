<script setup lang="ts">
import { ref, computed } from 'vue'
import { Settings, Plus, Power, RotateCcw, Save, X, Trash2 } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useStationsStore } from '@/stores/stations'
import type { Station } from '@/types'

const auth = useAuthStore()
const stationsStore = useStationsStore()

if (!auth.isAdmin) {
  // Soft-block — page renders an admin-only message instead of editor controls.
}

const stations = computed(() => stationsStore.allStations)

const composing = ref(false)
const editing = ref<string | null>(null)

const blank = (): Station => ({
  id: '',
  name: '',
  address: '',
  city: '',
  phone: '',
  mapUrl: '',
  doorCode: '',
  active: true,
  doorCodeUpdatedAt: null,
  doorCodeUpdatedBy: null,
})

const draft = ref<Station>(blank())
const error = ref<string | null>(null)

function startCreate() {
  composing.value = true
  editing.value = null
  draft.value = { ...blank(), active: true }
  error.value = null
}

function startEdit(s: Station) {
  composing.value = false
  editing.value = s.id
  draft.value = { ...s }
  error.value = null
}

function cancel() {
  composing.value = false
  editing.value = null
  error.value = null
}

function save() {
  error.value = null

  // Auto-fill name from id
  if (composing.value && !draft.value.name && draft.value.id) {
    draft.value.name = `Medic ${draft.value.id}`
  }

  if (!draft.value.id.trim()) {
    error.value = 'Station ID is required.'
    return
  }
  if (!draft.value.name.trim()) {
    error.value = 'Station name is required.'
    return
  }

  try {
    if (composing.value) {
      stationsStore.add({ ...draft.value })
    } else if (editing.value) {
      stationsStore.update(editing.value, draft.value)
    }
    composing.value = false
    editing.value = null
  } catch (err) {
    error.value = (err as Error).message
  }
}

function toggleActive(s: Station) {
  stationsStore.setActive(s.id, !s.active)
}

function remove(s: Station) {
  if (!confirm(`Remove ${s.name}? This is a hard delete.`)) return
  stationsStore.remove(s.id)
}

function resetSeed() {
  if (!confirm('Reset all stations to the seed list? Local edits will be lost.')) return
  stationsStore.resetToSeed()
  cancel()
}
</script>

<template>
  <div class="ms-view">
    <header class="ms-view__header">
      <div class="flex items-center gap-2">
        <Settings :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display ms-view__title">Manage Stations</h1>
      </div>
      <p class="ms-view__sub">
        Add a new medic station, deactivate one that's coming offline, or correct
        an address as it changes. Door codes themselves are managed inline on the
        <RouterLink to="/" class="ms-view__link">dashboard</RouterLink>.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="ms-view__deny">
      You need admin access to manage stations. Currently signed in as
      <strong>{{ auth.role }}</strong>.
    </div>

    <template v-else>
      <div class="ms-view__toolbar">
        <button
          v-if="!composing"
          type="button"
          class="btn btn-primary"
          @click="startCreate"
        >
          <Plus :size="14" :stroke-width="2" /> Add station
        </button>
        <button
          type="button"
          class="btn btn-ghost ms-view__reset"
          aria-label="Reset to seed data"
          @click="resetSeed"
        >
          <RotateCcw :size="13" :stroke-width="1.85" /> Reset to seed
        </button>
      </div>

      <!-- Compose / edit form -->
      <AppCard v-if="composing || editing" class="ms-form">
        <Eyebrow class="mb-3">{{ composing ? 'Add new station' : 'Edit station' }}</Eyebrow>
        <form class="ms-form__grid" @submit.prevent="save">
          <label class="ms-form__field">
            <span class="ms-form__label">ID</span>
            <input
              v-model="draft.id"
              type="text"
              class="ms-form__input"
              placeholder="e.g. 291"
              :disabled="!composing"
              maxlength="10"
              required
            />
          </label>
          <label class="ms-form__field ms-form__field--wide">
            <span class="ms-form__label">Name</span>
            <input
              v-model="draft.name"
              type="text"
              class="ms-form__input"
              placeholder="Medic 291"
              required
            />
          </label>
          <label class="ms-form__field ms-form__field--wide">
            <span class="ms-form__label">Address</span>
            <input v-model="draft.address" type="text" class="ms-form__input" placeholder="1234 Main St" />
          </label>
          <label class="ms-form__field">
            <span class="ms-form__label">City / ZIP</span>
            <input v-model="draft.city" type="text" class="ms-form__input" placeholder="Hempstead, TX 77445" />
          </label>
          <label class="ms-form__field">
            <span class="ms-form__label">Phone</span>
            <input v-model="draft.phone" type="text" class="ms-form__input" placeholder="(979) 000-0000" />
          </label>
          <label class="ms-form__field ms-form__field--wide">
            <span class="ms-form__label">Map URL</span>
            <input v-model="draft.mapUrl" type="url" class="ms-form__input" placeholder="https://maps.app.goo.gl/…" />
          </label>
          <label class="ms-form__field">
            <span class="ms-form__label">Door code</span>
            <input v-model="draft.doorCode" type="text" class="ms-form__input" placeholder="App Access or numeric" />
          </label>
          <label class="ms-form__field ms-form__active">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (visible to crews)</span>
          </label>

          <div v-if="error" class="ms-form__error">{{ error }}</div>

          <div class="ms-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              <Save :size="14" :stroke-width="2" /> {{ composing ? 'Add' : 'Save' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- All-stations list -->
      <div class="ms-list">
        <AppCard
          v-for="s in stations"
          :key="s.id"
          class="ms-row"
          :class="{ 'ms-row--inactive': !s.active }"
        >
          <div class="ms-row__id">
            <Eyebrow>Medic</Eyebrow>
            <span class="display ms-row__id-num">{{ s.id }}</span>
          </div>

          <div class="ms-row__main">
            <div class="display ms-row__name">{{ s.name }}</div>
            <div class="ms-row__addr">{{ s.address }}{{ s.address && s.city ? ' · ' : '' }}{{ s.city }}</div>
            <div class="ms-row__phone font-mono">{{ s.phone }}</div>
            <span v-if="!s.active" class="ms-row__inactive-chip">Inactive</span>
          </div>

          <div class="ms-row__actions">
            <button
              type="button"
              class="ms-row__btn"
              :class="s.active ? 'ms-row__btn--active' : 'ms-row__btn--inactive'"
              @click="toggleActive(s)"
            >
              <Power :size="13" :stroke-width="1.85" />
              {{ s.active ? 'Deactivate' : 'Activate' }}
            </button>
            <button type="button" class="ms-row__btn" @click="startEdit(s)">
              Edit
            </button>
            <button
              type="button"
              class="ms-row__btn ms-row__btn--danger"
              aria-label="Delete station"
              @click="remove(s)"
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
.ms-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .ms-view {
    padding: 40px 40px 64px;
  }
}
.ms-view__title {
  font-size: 32px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .ms-view__title {
    font-size: 40px;
  }
}
.ms-view__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 60ch;
}
.ms-view__link {
  color: var(--color-brand-600);
}

.ms-view__deny {
  margin-top: 24px;
  padding: 24px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  background: var(--color-warning-50);
  color: var(--color-ink-soft);
  text-align: center;
}

.ms-view__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 16px;
}
.ms-view__reset {
  margin-left: auto;
}

.ms-form {
  padding: 18px 20px;
  margin-bottom: 16px;
}
.ms-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .ms-form__grid {
    grid-template-columns: 1fr 1fr;
  }
}
.ms-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ms-form__field--wide {
  grid-column: 1 / -1;
}
.ms-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.ms-form__input {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
}
.ms-form__input:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.ms-form__input:disabled {
  background: var(--color-surface-soft);
  color: var(--color-muted);
  cursor: not-allowed;
}
.ms-form__active {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
}
.ms-form__error {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  font-size: 13px;
}
.ms-form__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ms-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ms-row {
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 60px 1fr auto;
  gap: 14px;
  align-items: center;
}
.ms-row--inactive {
  opacity: 0.55;
  background: var(--color-surface-soft);
}
.ms-row__id {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px;
  border-radius: 6px;
  background: var(--color-surface-soft);
}
.ms-row__id-num {
  font-size: 18px;
  color: var(--color-brand-600);
  letter-spacing: -0.01em;
}
.ms-row__name {
  font-size: 16px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.ms-row__addr {
  font-size: 12px;
  color: var(--color-ink-soft);
  margin-top: 2px;
}
.ms-row__phone {
  font-size: 11.5px;
  color: var(--color-muted);
  margin-top: 1px;
}
.ms-row__inactive-chip {
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

.ms-row__actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ms-row__btn {
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
.ms-row__btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.ms-row__btn--active {
  color: var(--color-success-500);
}
.ms-row__btn--inactive {
  color: var(--color-muted);
}
.ms-row__btn--danger {
  color: var(--color-danger-500);
}
.ms-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  background: var(--color-danger-50);
}

@media (max-width: 600px) {
  .ms-row {
    grid-template-columns: 50px 1fr;
  }
  .ms-row__actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
