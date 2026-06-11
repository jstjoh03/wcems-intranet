<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  FileText,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Users,
  ChevronRight,
  Upload,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { usePolicies } from '@/composables/usePolicies'
import type {
  EmploymentType,
  Policy,
  PolicyCategory,
  PolicyReviewCycle,
  Role,
  ShiftLetter,
} from '@/types'

const auth = useAuthStore()
const {
  ready,
  policies,
  acksFor,
  savePolicy,
  uploadDocument,
  deletePolicy,
} = usePolicies()

interface Draft {
  id?: string
  title: string
  summary: string
  category: PolicyCategory
  effectiveDate: string
  reviewCycle: PolicyReviewCycle
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  audienceEmploymentTypes: EmploymentType[]
  attestationStatement: string
  active: boolean
}

const DEFAULT_ATTESTATION =
  'I have read this policy, I understand its contents, and I know where to find it on the intranet.'

function blankDraft(): Draft {
  return {
    title: '',
    summary: '',
    category: 'clinical',
    effectiveDate: '',
    reviewCycle: 'annual',
    audienceRoles: [],
    audienceShifts: [],
    audienceEmploymentTypes: [],
    attestationStatement: DEFAULT_ATTESTATION,
    active: true,
  }
}

const draft = ref<Draft | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)

const uploadingId = ref<string | null>(null)
const uploadError = ref<string | null>(null)

function startCreate() {
  draft.value = blankDraft()
  error.value = null
}

function startEdit(p: Policy) {
  draft.value = {
    id: p.id,
    title: p.title,
    summary: p.summary,
    category: p.category,
    effectiveDate: p.effectiveDate ?? '',
    reviewCycle: p.reviewCycle,
    audienceRoles: [...p.audienceRoles],
    audienceShifts: [...p.audienceShifts],
    audienceEmploymentTypes: [...p.audienceEmploymentTypes],
    attestationStatement: p.attestationStatement || DEFAULT_ATTESTATION,
    active: p.active,
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
  const result = await savePolicy({
    id: d.id,
    title: d.title.trim(),
    summary: d.summary.trim(),
    category: d.category,
    effectiveDate: d.effectiveDate ? d.effectiveDate : null,
    reviewCycle: d.reviewCycle,
    audienceRoles: d.audienceRoles,
    audienceShifts: d.audienceShifts,
    audienceEmploymentTypes: d.audienceEmploymentTypes,
    attestationStatement: d.attestationStatement.trim() || DEFAULT_ATTESTATION,
    active: d.active,
  })
  saving.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  draft.value = null
}

async function onDelete(p: Policy) {
  if (
    !confirm(
      `Delete "${p.title}" and ALL its acknowledgement records? This cannot be undone.`,
    )
  )
    return
  const result = await deletePolicy(p.id)
  if (!result.ok) alert(result.error)
}

async function onUpload(p: Policy, event: Event) {
  uploadError.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadingId.value = p.id
  const result = await uploadDocument(p.id, file)
  uploadingId.value = null
  /* Reset the input so re-selecting the same file fires the change event. */
  input.value = ''
  if (!result.ok) {
    uploadError.value = `${p.title}: ${result.error}`
    return
  }
}

function ackStats(policyId: string): { signed: number; stale: number } {
  const acks = acksFor(policyId)
  const policy = policies.value.find((p) => p.id === policyId)
  if (!policy) return { signed: 0, stale: 0 }
  let signed = 0
  let stale = 0
  /* Per-user latest ack — count by version against policy.version. */
  const latestByUser = new Map<string, number>()
  for (const a of acks) {
    const prev = latestByUser.get(a.userId) ?? -1
    if (a.policyVersionAtSigning > prev) latestByUser.set(a.userId, a.policyVersionAtSigning)
  }
  for (const v of latestByUser.values()) {
    if (v >= policy.version) signed += 1
    else stale += 1
  }
  return { signed, stale }
}

const ROLE_OPTIONS: Role[] = ['crew', 'supervisor', 'admin']
const SHIFT_OPTIONS: ShiftLetter[] = ['A', 'B', 'C']
const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: 'full_time', label: 'Full-Time' },
  { value: 'part_time', label: 'Part-Time' },
]
const CATEGORY_OPTIONS: Array<{ value: PolicyCategory; label: string }> = [
  { value: 'clinical', label: 'Clinical' },
  { value: 'operational', label: 'Operational' },
  { value: 'hr', label: 'HR' },
  { value: 'general', label: 'General' },
]
const REVIEW_CYCLE_OPTIONS: Array<{ value: PolicyReviewCycle; label: string }> = [
  { value: 'annual', label: 'Annual' },
  { value: 'biennial', label: 'Biennial (every 2 years)' },
  { value: 'as_needed', label: 'As needed' },
]

function toggleRole(r: Role) {
  if (!draft.value) return
  const i = draft.value.audienceRoles.indexOf(r)
  if (i === -1) draft.value.audienceRoles = [...draft.value.audienceRoles, r]
  else draft.value.audienceRoles = draft.value.audienceRoles.filter((x) => x !== r)
}
function toggleShift(s: ShiftLetter) {
  if (!draft.value) return
  const i = draft.value.audienceShifts.indexOf(s)
  if (i === -1) draft.value.audienceShifts = [...draft.value.audienceShifts, s]
  else draft.value.audienceShifts = draft.value.audienceShifts.filter((x) => x !== s)
}
function toggleEmploymentType(e: EmploymentType) {
  if (!draft.value) return
  const i = draft.value.audienceEmploymentTypes.indexOf(e)
  if (i === -1)
    draft.value.audienceEmploymentTypes = [...draft.value.audienceEmploymentTypes, e]
  else
    draft.value.audienceEmploymentTypes = draft.value.audienceEmploymentTypes.filter(
      (x) => x !== e,
    )
}

const orderedPolicies = computed(() =>
  [...policies.value].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.title.localeCompare(b.title)
  }),
)

const CATEGORY_LABEL: Record<PolicyCategory, string> = {
  clinical: 'Clinical',
  operational: 'Operational',
  hr: 'HR',
  general: 'General',
}
</script>

<template>
  <div class="mp">
    <header class="mp__header">
      <div class="flex items-center gap-2">
        <FileText :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mp__title">Manage Policies</h1>
      </div>
      <p class="mp__sub">
        Upload PDFs of clinical, operational, and HR policies. Crew open them
        on <code>/policies</code>, scroll to the end, and sign the
        acknowledgement. Bumping the version (Replace PDF) re-prompts everyone
        for fresh sign-off.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mp__gate">Admin only.</div>

    <template v-else>
      <div v-if="!draft" class="mp__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> New policy
        </button>
      </div>

      <AppCard v-if="draft" class="mp-form">
        <Eyebrow class="mb-3">{{ draft.id ? 'Edit policy' : 'New policy' }}</Eyebrow>

        <form @submit.prevent="onSave">
          <div class="mp-form__row">
            <label class="mp-form__field mp-form__field--wide">
              <span class="mp-form__label">Title *</span>
              <input
                v-model="draft.title"
                type="text"
                required
                placeholder="e.g. HCID Patient Management"
                class="mp-form__input"
              />
            </label>
            <label class="mp-form__field">
              <span class="mp-form__label">Category *</span>
              <select v-model="draft.category" class="mp-form__input">
                <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
            </label>
          </div>

          <label class="mp-form__field">
            <span class="mp-form__label">Summary</span>
            <textarea
              v-model="draft.summary"
              rows="2"
              placeholder="One-line description shown on the list and detail page."
              class="mp-form__input"
            />
          </label>

          <div class="mp-form__row">
            <label class="mp-form__field">
              <span class="mp-form__label">Effective date</span>
              <input v-model="draft.effectiveDate" type="date" class="mp-form__input" />
            </label>
            <label class="mp-form__field">
              <span class="mp-form__label">Review cycle</span>
              <select v-model="draft.reviewCycle" class="mp-form__input">
                <option v-for="r in REVIEW_CYCLE_OPTIONS" :key="r.value" :value="r.value">
                  {{ r.label }}
                </option>
              </select>
            </label>
          </div>

          <div class="mp-form__audience">
            <span class="mp-form__label">Audience (empty = everyone)</span>
            <div class="mp-form__audience-group">
              <span class="mp-form__audience-label">Roles</span>
              <button
                v-for="r in ROLE_OPTIONS"
                :key="r"
                type="button"
                class="mp-form__chip"
                :class="{ 'mp-form__chip--on': draft.audienceRoles.includes(r) }"
                @click="toggleRole(r)"
              >
                {{ r }}
              </button>
            </div>
            <div class="mp-form__audience-group">
              <span class="mp-form__audience-label">Shifts</span>
              <button
                v-for="s in SHIFT_OPTIONS"
                :key="s"
                type="button"
                class="mp-form__chip"
                :class="{ 'mp-form__chip--on': draft.audienceShifts.includes(s) }"
                @click="toggleShift(s)"
              >
                {{ s }}
              </button>
            </div>
            <div class="mp-form__audience-group">
              <span class="mp-form__audience-label">Employment</span>
              <button
                v-for="e in EMPLOYMENT_OPTIONS"
                :key="e.value"
                type="button"
                class="mp-form__chip"
                :class="{
                  'mp-form__chip--on': draft.audienceEmploymentTypes.includes(e.value),
                }"
                @click="toggleEmploymentType(e.value)"
              >
                {{ e.label }}
              </button>
            </div>
          </div>

          <label class="mp-form__field">
            <span class="mp-form__label">Attestation statement</span>
            <textarea
              v-model="draft.attestationStatement"
              rows="2"
              class="mp-form__input"
            />
          </label>

          <label class="mp-form__field mp-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (crew can see this policy)</span>
          </label>

          <div v-if="error" class="mp-form__error">{{ error }}</div>

          <div class="mp-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
          <p class="mp-form__hint">
            After saving, upload the PDF from the row below
            <strong>Replace PDF</strong>.
          </p>
        </form>
      </AppCard>

      <div v-if="uploadError" class="mp__upload-error">{{ uploadError }}</div>

      <div v-if="!ready" class="mp__empty">Loading policies…</div>
      <div v-else-if="orderedPolicies.length === 0" class="mp__empty">
        No policies yet. Tap <strong>New policy</strong> to create the first one.
      </div>

      <ul v-else class="mp-list">
        <li v-for="p in orderedPolicies" :key="p.id" class="mp-row">
          <div class="mp-row__icon">
            <FileText :size="18" :stroke-width="1.85" />
          </div>
          <div class="mp-row__body">
            <div class="mp-row__head">
              <span class="mp-row__title display">{{ p.title }}</span>
              <span class="mp-row__chip">{{ CATEGORY_LABEL[p.category] }}</span>
              <span class="mp-row__chip mp-row__chip--ver">v{{ p.version }}</span>
              <span v-if="!p.active" class="mp-row__chip mp-row__chip--off">Inactive</span>
            </div>
            <div class="mp-row__meta">
              <template v-if="p.documentFilename">
                {{ p.documentFilename }}
              </template>
              <template v-else>
                <em>No PDF uploaded yet.</em>
              </template>
              ·
              {{ ackStats(p.id).signed }} signed
              <template v-if="ackStats(p.id).stale">
                · {{ ackStats(p.id).stale }} stale
              </template>
            </div>
          </div>

          <div class="mp-row__actions">
            <RouterLink
              :to="`/admin/policies/${p.id}`"
              class="mp-row__action mp-row__action--ghost"
            >
              <Users :size="13" :stroke-width="2" />
              Roster
              <ChevronRight :size="12" :stroke-width="2" />
            </RouterLink>
            <label class="mp-row__action mp-row__action--upload">
              <Upload :size="13" :stroke-width="2" />
              {{ uploadingId === p.id ? 'Uploading…' : p.documentStoragePath ? 'Replace PDF' : 'Upload PDF' }}
              <input
                type="file"
                accept="application/pdf,.pdf"
                hidden
                :disabled="uploadingId === p.id"
                @change="(e) => onUpload(p, e)"
              />
            </label>
            <button
              type="button"
              class="mp-row__action mp-row__action--edit"
              @click="startEdit(p)"
            >
              <Edit2 :size="13" :stroke-width="2" />
              Edit
            </button>
            <button
              type="button"
              class="mp-row__action mp-row__action--del"
              @click="onDelete(p)"
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
.mp {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mp {
    padding: 40px 40px 80px;
  }
}
.mp__header {
  margin-bottom: 16px;
}
.mp__title {
  font-size: 24px;
  letter-spacing: -0.01em;
}
.mp__sub {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
}
.mp__sub code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-surface-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

.mp__gate,
.mp__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mp__toolbar {
  margin: 14px 0;
}

.mp__upload-error {
  margin: 12px 0;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
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
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out);
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

.mp-form {
  margin-bottom: 18px;
  padding: 18px !important;
}
.mp-form__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .mp-form__row {
    grid-template-columns: 1fr;
  }
}
.mp-form__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}
.mp-form__field--wide {
  grid-column: span 1;
}
.mp-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mp-form__input {
  font-family: var(--font-sans);
  font-size: 13.5px;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
}
.mp-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.mp-form__audience {
  margin: 10px 0;
  padding: 10px 12px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.mp-form__audience-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}
.mp-form__audience-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  min-width: 80px;
}
.mp-form__chip {
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  cursor: pointer;
  text-transform: capitalize;
}
.mp-form__chip--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.mp-form__error {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 6px;
  padding: 6px 10px;
}

.mp-form__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.mp-form__hint {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
}

.mp-list {
  margin-top: 8px;
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mp-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}
.mp-row__icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mp-row__body {
  flex: 1;
  min-width: 0;
}
.mp-row__head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mp-row__title {
  font-size: 15px;
  color: var(--color-ink);
  margin-right: 4px;
}
.mp-row__chip {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: 1px solid var(--color-brand-100);
}
.mp-row__chip--ver {
  background: var(--color-surface-soft);
  color: var(--color-muted);
  border-color: var(--color-line);
}
.mp-row__chip--off {
  background: var(--color-line);
  color: var(--color-muted);
  border-color: transparent;
}
.mp-row__meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}

.mp-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
}
@media (max-width: 700px) {
  .mp-row {
    flex-direction: column;
  }
  .mp-row__actions {
    width: 100%;
  }
}
.mp-row__action {
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
  text-decoration: none;
}
.mp-row__action:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-700);
}
.mp-row__action--upload {
  background: var(--color-brand-50);
  border-color: var(--color-brand-100);
  color: var(--color-brand-700);
}
.mp-row__action--del:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}
</style>
