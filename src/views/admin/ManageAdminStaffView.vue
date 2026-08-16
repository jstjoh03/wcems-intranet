<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  ArrowUp,
  ArrowDown,
  Phone,
  Mail,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useAdminStaff } from '@/composables/useAdminStaff'
import { formatPhoneInput } from '@/utils/phone'
import type { AdminStaff } from '@/types'

const auth = useAuthStore()
const { staff, ready, save, remove, move } = useAdminStaff()

interface Draft {
  id?: string
  title: string
  name: string
  email: string
  phone: string
  notes: string
  active: boolean
}

function blankDraft(): Draft {
  return {
    title: '',
    name: '',
    email: '',
    phone: '',
    notes: '',
    active: true,
  }
}

const draft = ref<Draft | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)
const movingId = ref<string | null>(null)

function startCreate() {
  draft.value = blankDraft()
  error.value = null
}

function startEdit(s: AdminStaff) {
  draft.value = {
    id: s.id,
    title: s.title,
    name: s.name,
    email: s.email ?? '',
    phone: s.phone ?? '',
    notes: s.notes ?? '',
    active: s.active,
  }
  error.value = null
}

function cancel() {
  draft.value = null
  error.value = null
}

async function onSave() {
  if (!draft.value || saving.value) return
  saving.value = true
  error.value = null
  const d = draft.value
  const result = await save({
    id: d.id,
    title: d.title.trim(),
    name: d.name.trim(),
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    notes: d.notes.trim() || null,
    active: d.active,
  })
  saving.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  draft.value = null
}

async function onDelete(s: AdminStaff) {
  if (!confirm(`Remove ${s.name} (${s.title}) from the admin staff list?`)) return
  const result = await remove(s.id)
  if (!result.ok) alert(result.error)
}

async function onMove(s: AdminStaff, direction: 'up' | 'down') {
  if (movingId.value) return
  movingId.value = s.id
  const result = await move(s.id, direction)
  movingId.value = null
  if (!result.ok) alert(result.error)
}

/* List is always rendered in sort_order. Inactive rows are mixed in
   so admins can see/restore them; the chip makes the state clear. */
const ordered = computed(() =>
  [...staff.value].sort((a, b) => a.sortOrder - b.sortOrder),
)
</script>

<template>
  <div class="mas">
    <header class="mas__header">
      <div class="flex items-center gap-2">
        <Building2
          :size="22"
          :stroke-width="1.85"
          style="color: var(--color-brand-600)"
        />
        <h1 class="display mas__title">Manage Admin Staff</h1>
      </div>
      <p class="mas__sub">
        Edit titles and contact info, mark someone inactive, or reorder the
        cards. Crew see the result on
        <code>/admin-staff</code>. Realtime — changes show up everywhere
        within seconds.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mas__gate">Admin only.</div>

    <template v-else>
      <div v-if="!draft" class="mas__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> New entry
        </button>
      </div>

      <AppCard v-if="draft" class="mas-form">
        <Eyebrow class="mb-3">{{ draft.id ? 'Edit entry' : 'New entry' }}</Eyebrow>

        <form @submit.prevent="onSave">
          <div class="mas-form__row">
            <label class="mas-form__field">
              <span class="mas-form__label">Title *</span>
              <input
                v-model="draft.title"
                type="text"
                required
                placeholder="e.g. Chief / EMS Director"
                class="mas-form__input"
              />
            </label>
            <label class="mas-form__field">
              <span class="mas-form__label">Name *</span>
              <input
                v-model="draft.name"
                type="text"
                required
                placeholder="Full name (or 'Open position')"
                class="mas-form__input"
              />
            </label>
          </div>

          <div class="mas-form__row">
            <label class="mas-form__field">
              <span class="mas-form__label">Email</span>
              <input
                v-model="draft.email"
                type="email"
                placeholder="name@wallercountyems.com"
                class="mas-form__input"
              />
            </label>
            <label class="mas-form__field">
              <span class="mas-form__label">Phone</span>
              <input
                v-model="draft.phone"
                type="tel"
                placeholder="(832) 555-0123"
                class="mas-form__input"
                @input="draft.phone = formatPhoneInput(draft.phone)"
              />
            </label>
          </div>

          <label class="mas-form__field">
            <span class="mas-form__label">Notes</span>
            <textarea
              v-model="draft.notes"
              rows="2"
              placeholder="Optional — e.g. 'Mon–Fri daytime hours'"
              class="mas-form__input"
            />
          </label>

          <label class="mas-form__field mas-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (visible to crew)</span>
          </label>

          <div v-if="error" class="mas-form__error">{{ error }}</div>

          <div class="mas-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </form>
      </AppCard>

      <div v-if="!ready" class="mas__empty">Loading…</div>
      <div v-else-if="!ordered.length" class="mas__empty">
        No entries yet. Tap <strong>New entry</strong> to add one.
      </div>

      <ul v-else class="mas-list">
        <li
          v-for="(s, idx) in ordered"
          :key="s.id"
          class="mas-row"
          :class="{ 'mas-row--inactive': !s.active }"
        >
          <div class="mas-row__reorder">
            <button
              type="button"
              class="mas-row__arrow"
              :disabled="idx === 0 || movingId === s.id"
              :aria-label="`Move ${s.name} up`"
              @click="onMove(s, 'up')"
            >
              <ArrowUp :size="13" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="mas-row__arrow"
              :disabled="idx === ordered.length - 1 || movingId === s.id"
              :aria-label="`Move ${s.name} down`"
              @click="onMove(s, 'down')"
            >
              <ArrowDown :size="13" :stroke-width="2" />
            </button>
          </div>

          <div class="mas-row__body">
            <div class="mas-row__head">
              <span class="mas-row__title display">{{ s.name }}</span>
              <span v-if="!s.active" class="mas-row__chip">Inactive</span>
            </div>
            <div class="mas-row__role">{{ s.title }}</div>
            <div class="mas-row__contact">
              <span v-if="s.phone" class="mas-row__contact-item">
                <Phone :size="11" :stroke-width="1.85" />
                <span class="font-mono">{{ s.phone }}</span>
              </span>
              <span v-if="s.email" class="mas-row__contact-item">
                <Mail :size="11" :stroke-width="1.85" />
                {{ s.email }}
              </span>
            </div>
            <p v-if="s.notes" class="mas-row__notes">{{ s.notes }}</p>
          </div>

          <div class="mas-row__actions">
            <button
              type="button"
              class="mas-row__action mas-row__action--edit"
              @click="startEdit(s)"
            >
              <Edit2 :size="13" :stroke-width="2" />
              Edit
            </button>
            <button
              type="button"
              class="mas-row__action mas-row__action--del"
              @click="onDelete(s)"
            >
              <Trash2 :size="13" :stroke-width="2" />
              Delete
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.mas {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mas {
    padding: 40px 40px 80px;
  }
}
.mas__header {
  margin-bottom: 14px;
}
.mas__title {
  font-size: 24px;
  letter-spacing: -0.01em;
}
.mas__sub {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
}
.mas__sub code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-surface-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

.mas__gate,
.mas__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mas__toolbar {
  margin: 14px 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.btn-primary {
  background: var(--color-brand-600);
  color: white;
}
.btn-primary:hover {
  background: var(--color-brand-700);
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover {
  border-color: var(--color-muted-soft);
}

.mas-form {
  margin-bottom: 18px;
  padding: 18px !important;
}
.mas-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .mas-form__row {
    grid-template-columns: 1fr;
  }
}
.mas-form__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}
.mas-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mas-form__input {
  font-family: var(--font-sans);
  font-size: 13.5px;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
}
.mas-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.mas-form__error {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 6px;
  padding: 6px 10px;
}
.mas-form__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.mas-list {
  margin-top: 8px;
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mas-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}
.mas-row--inactive {
  opacity: 0.7;
}

.mas-row__reorder {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.mas-row__arrow {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  cursor: pointer;
}
.mas-row__arrow:hover:not(:disabled) {
  border-color: var(--color-brand-600);
  color: var(--color-brand-700);
}
.mas-row__arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mas-row__body {
  flex: 1;
  min-width: 0;
}
.mas-row__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mas-row__title {
  font-size: 15px;
  color: var(--color-ink);
}
.mas-row__chip {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 7px;
  background: var(--color-line);
  color: var(--color-muted);
  border-radius: 999px;
}
.mas-row__role {
  margin-top: 1px;
  font-size: 12.5px;
  color: var(--color-brand-700);
  font-weight: 500;
}
.mas-row__contact {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--color-muted);
}
.mas-row__contact-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.mas-row__notes {
  margin: 6px 0 0;
  font-size: 12px;
  font-style: italic;
  color: var(--color-muted);
}

.mas-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}
@media (max-width: 700px) {
  .mas-row {
    flex-wrap: wrap;
  }
  .mas-row__actions {
    width: 100%;
  }
}
.mas-row__action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.mas-row__action:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-700);
}
.mas-row__action--del:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}
</style>
