<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Users, Power, Save, X, Edit2 } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import type { AppUser, Role, ShiftLetter } from '@/types'
import { formatShortDate } from '@/utils/date'

const auth = useAuthStore()

interface AppUserRow {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  role: Role
  shift: ShiftLetter | null
  station: string | null
  fuel_number: string | null
  date_of_birth: string | null
  show_birthday: boolean
  active: boolean
}

interface DraftUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  role: Role
  shift: ShiftLetter | null
  station: string
  fuelNumber: string
  dateOfBirth: string
  showBirthday: boolean
  active: boolean
}

const users = ref<AppUser[]>([])
const ready = ref(false)
const editing = ref<string | null>(null)
const draft = ref<DraftUser | null>(null)
const error = ref<string | null>(null)
const search = ref('')
const showInactive = ref(false)
const saving = ref(false)

const ROLES: Role[] = ['crew', 'supervisor', 'admin']
const SHIFTS: Array<ShiftLetter | ''> = ['', 'A', 'B', 'C']

function rowToUser(r: AppUserRow): AppUser & { active: boolean } {
  return {
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    fullName: r.full_name,
    initials: computeInitials(r.full_name || r.email),
    role: r.role,
    shift: r.shift,
    station: r.station,
    fuelNumber: r.fuel_number,
    dateOfBirth: r.date_of_birth,
    showBirthday: r.show_birthday,
    active: r.active,
  } as AppUser & { active: boolean }
}

function computeInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

async function load() {
  if (auth.usingDevStub) {
    /* Dev mode: surface just the stub user so the layout is observable
       without a real session. Real session pulls every row. */
    if (auth.appUser) {
      users.value = [{ ...auth.appUser, active: true } as AppUser & { active: boolean }]
    } else {
      users.value = []
    }
    ready.value = true
    return
  }
  const { data, error: fetchErr } = await supabase
    .from('app_users')
    .select(
      'id, email, first_name, last_name, full_name, role, shift, station, fuel_number, date_of_birth, show_birthday, active',
    )
    .order('full_name')
  if (fetchErr) {
    console.error('[employees] load failed:', fetchErr.message)
    ready.value = true
    return
  }
  users.value = (data ?? []).map((d) => rowToUser(d as AppUserRow))
  ready.value = true
}

const filtered = computed(() => {
  let list = users.value as Array<AppUser & { active: boolean }>
  if (!showInactive.value) list = list.filter((u) => u.active)
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    )
  }
  return list
})

function userToDraft(u: AppUser & { active: boolean }): DraftUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: u.fullName,
    role: u.role,
    shift: u.shift,
    station: u.station ?? '',
    fuelNumber: u.fuelNumber ?? '',
    dateOfBirth: u.dateOfBirth ?? '',
    showBirthday: u.showBirthday,
    active: u.active,
  }
}

function startEdit(u: AppUser & { active: boolean }) {
  editing.value = u.id
  draft.value = userToDraft(u)
  error.value = null
}

function cancelEdit() {
  editing.value = null
  draft.value = null
  error.value = null
}

async function save() {
  if (!draft.value || saving.value) return
  error.value = null
  saving.value = true
  try {
    if (auth.usingDevStub) {
      /* Dev mode: mutate the local user list directly. */
      users.value = users.value.map((u) =>
        u.id === draft.value!.id
          ? ({
              ...u,
              firstName: draft.value!.firstName,
              lastName: draft.value!.lastName,
              fullName: draft.value!.fullName,
              role: draft.value!.role,
              shift: draft.value!.shift,
              station: draft.value!.station || null,
              fuelNumber: draft.value!.fuelNumber || null,
              dateOfBirth: draft.value!.dateOfBirth || null,
              showBirthday: draft.value!.showBirthday,
              active: draft.value!.active,
              initials: computeInitials(draft.value!.fullName || draft.value!.email),
            } as AppUser & { active: boolean })
          : u,
      )
      cancelEdit()
      return
    }

    const patch = {
      first_name: draft.value.firstName,
      last_name: draft.value.lastName,
      full_name: draft.value.fullName,
      role: draft.value.role,
      shift: draft.value.shift,
      station: draft.value.station || null,
      fuel_number: draft.value.fuelNumber || null,
      date_of_birth: draft.value.dateOfBirth || null,
      show_birthday: draft.value.showBirthday,
      active: draft.value.active,
    }
    const { data, error: updErr } = await supabase
      .from('app_users')
      .update(patch)
      .eq('id', draft.value.id)
      .select(
        'id, email, first_name, last_name, full_name, role, shift, station, fuel_number, date_of_birth, show_birthday, active',
      )
      .single()
    if (updErr) {
      error.value = updErr.message
      return
    }
    users.value = users.value.map((u) =>
      u.id === draft.value!.id ? rowToUser(data as AppUserRow) : u,
    )
    cancelEdit()
  } finally {
    saving.value = false
  }
}

async function toggleActive(u: AppUser & { active: boolean }) {
  if (auth.usingDevStub) {
    users.value = users.value.map((x) =>
      x.id === u.id ? ({ ...x, active: !u.active } as AppUser & { active: boolean }) : x,
    )
    return
  }
  const { data, error: updErr } = await supabase
    .from('app_users')
    .update({ active: !u.active })
    .eq('id', u.id)
    .select(
      'id, email, first_name, last_name, full_name, role, shift, station, fuel_number, date_of_birth, show_birthday, active',
    )
    .single()
  if (updErr) {
    console.error('[employees] toggle failed:', updErr.message)
    return
  }
  users.value = users.value.map((x) => (x.id === u.id ? rowToUser(data as AppUserRow) : x))
}

function syncFullName() {
  if (!draft.value) return
  const composed = `${draft.value.firstName} ${draft.value.lastName}`.trim()
  if (composed) draft.value.fullName = composed
}

function shiftLabel(s: ShiftLetter | null) {
  return s ?? '—'
}

const formatDob = formatShortDate

onMounted(load)
</script>

<template>
  <div class="me-view">
    <header class="me-view__header">
      <div class="flex items-center gap-2">
        <Users :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display me-view__title">Manage Employees</h1>
      </div>
      <p class="me-view__sub">
        Set role, shift, station, and fuel# for each crew member. New employees
        appear here automatically the first time they sign in.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="me-view__deny">
      You need admin access to manage employees. Currently signed in as
      <strong>{{ auth.role }}</strong>.
    </div>

    <template v-else>
      <div class="me-view__toolbar">
        <input
          v-model="search"
          type="search"
          class="me-view__search"
          placeholder="Search by name or email"
          aria-label="Search employees"
        />
        <label class="me-view__toggle">
          <input v-model="showInactive" type="checkbox" />
          <span>Show inactive</span>
        </label>
      </div>

      <!-- Edit form -->
      <AppCard v-if="editing && draft" class="me-form">
        <Eyebrow class="mb-3">Edit employee</Eyebrow>
        <form class="me-form__grid" @submit.prevent="save">
          <label class="me-form__field me-form__field--wide">
            <span class="me-form__label">Email (read-only)</span>
            <input :value="draft.email" type="email" class="me-form__input" disabled />
          </label>

          <label class="me-form__field">
            <span class="me-form__label">First name</span>
            <input
              v-model="draft.firstName"
              type="text"
              class="me-form__input"
              @blur="syncFullName"
            />
          </label>
          <label class="me-form__field">
            <span class="me-form__label">Last name</span>
            <input
              v-model="draft.lastName"
              type="text"
              class="me-form__input"
              @blur="syncFullName"
            />
          </label>
          <label class="me-form__field me-form__field--wide">
            <span class="me-form__label">Display name</span>
            <input v-model="draft.fullName" type="text" class="me-form__input" />
          </label>

          <label class="me-form__field">
            <span class="me-form__label">Role</span>
            <select v-model="draft.role" class="me-form__input">
              <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="me-form__field">
            <span class="me-form__label">Shift</span>
            <select
              :value="draft.shift ?? ''"
              class="me-form__input"
              @change="
                (e) => {
                  if (draft) draft.shift = ((e.target as HTMLSelectElement).value || null) as ShiftLetter | null
                }
              "
            >
              <option v-for="s in SHIFTS" :key="s || 'none'" :value="s">
                {{ s || '— none —' }}
              </option>
            </select>
          </label>

          <label class="me-form__field">
            <span class="me-form__label">Station</span>
            <input
              v-model="draft.station"
              type="text"
              class="me-form__input"
              placeholder="e.g. S202 or Medic 211"
            />
          </label>
          <label class="me-form__field">
            <span class="me-form__label">Fuel #</span>
            <input v-model="draft.fuelNumber" type="text" class="me-form__input" />
          </label>

          <label class="me-form__field">
            <span class="me-form__label">Date of birth</span>
            <input v-model="draft.dateOfBirth" type="date" class="me-form__input" />
          </label>
          <label class="me-form__field me-form__check">
            <input v-model="draft.showBirthday" type="checkbox" />
            <span>Show birthday on dashboard</span>
          </label>

          <label class="me-form__field me-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (visible to crews)</span>
          </label>

          <div v-if="error" class="me-form__error">{{ error }}</div>

          <div class="me-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancelEdit">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- List -->
      <div v-if="!ready" class="me-view__empty">Loading employees…</div>
      <div v-else-if="filtered.length === 0" class="me-view__empty">
        No employees match those filters.
      </div>
      <div v-else class="me-list">
        <AppCard
          v-for="u in filtered"
          :key="u.id"
          class="me-row"
          :class="{ 'me-row--inactive': !u.active }"
        >
          <div class="me-row__avatar display">{{ u.initials }}</div>
          <div class="me-row__main">
            <div class="me-row__head">
              <div class="display me-row__name">{{ u.fullName }}</div>
              <AppChip :variant="u.role === 'admin' ? 'accent' : 'brand'" class="me-row__role">
                {{ u.role }}
              </AppChip>
              <span v-if="!u.active" class="me-row__inactive-chip">Inactive</span>
            </div>
            <div class="me-row__email">{{ u.email }}</div>
            <div class="me-row__meta">
              <span>Shift {{ shiftLabel(u.shift) }}</span>
              <span v-if="u.station">· {{ u.station }}</span>
              <span v-if="u.fuelNumber">· Fuel #{{ u.fuelNumber }}</span>
              <span v-if="u.dateOfBirth">· DOB {{ formatDob(u.dateOfBirth) }}</span>
            </div>
          </div>

          <div class="me-row__actions">
            <button
              type="button"
              class="me-row__btn"
              :class="u.active ? 'me-row__btn--active' : 'me-row__btn--inactive'"
              @click="toggleActive(u)"
            >
              <Power :size="13" :stroke-width="1.85" />
              {{ u.active ? 'Deactivate' : 'Activate' }}
            </button>
            <button type="button" class="me-row__btn" @click="startEdit(u)">
              <Edit2 :size="13" :stroke-width="1.85" />
              Edit
            </button>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.me-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .me-view {
    padding: 40px 40px 96px;
  }
}
.me-view__title {
  font-size: 32px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .me-view__title {
    font-size: 40px;
  }
}
.me-view__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 64ch;
}
.me-view__deny {
  margin-top: 24px;
  padding: 24px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  background: var(--color-warning-50);
  color: var(--color-ink-soft);
  text-align: center;
}

.me-view__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 24px 0 16px;
}
.me-view__search {
  flex: 1;
  min-width: 200px;
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
}
.me-view__search:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.me-view__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-ink-soft);
  cursor: pointer;
}

.me-view__empty {
  margin-top: 16px;
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

.me-form {
  padding: 20px 22px;
  margin-bottom: 16px;
}
.me-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .me-form__grid {
    grid-template-columns: 1fr 1fr;
  }
}
.me-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.me-form__field--wide {
  grid-column: 1 / -1;
}
.me-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
}
.me-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.me-form__input {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
}
.me-form__input:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.me-form__input:disabled {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.me-form__error {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  font-size: 13px;
}
.me-form__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.me-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.me-row {
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 14px;
  align-items: center;
}
.me-row--inactive {
  opacity: 0.6;
  background: var(--color-surface-soft);
}
.me-row__avatar {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.me-row__main {
  min-width: 0;
}
.me-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.me-row__name {
  font-size: 16px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.me-row__role {
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.me-row__inactive-chip {
  display: inline-block;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  background: var(--color-line);
  border-radius: 999px;
}
.me-row__email {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
}
.me-row__meta {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-ink-soft);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.me-row__actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.me-row__btn {
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
.me-row__btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.me-row__btn--active {
  color: var(--color-success-500);
}
.me-row__btn--inactive {
  color: var(--color-muted);
}

@media (max-width: 600px) {
  .me-row {
    grid-template-columns: 44px 1fr;
  }
  .me-row__actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
