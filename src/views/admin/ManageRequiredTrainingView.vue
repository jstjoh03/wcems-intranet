<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  Save,
  X,
  Users,
  ChevronRight,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import type { RequiredTraining, Role, ShiftLetter, VideoSource } from '@/types'

const auth = useAuthStore()
const { ready, trainings, completionsFor, saveTraining, deleteTraining } = useRequiredTraining()

interface Draft {
  id?: string
  title: string
  description: string
  videoSource: VideoSource
  videoRef: string
  durationMinutes: string /* form text, converted to seconds on save */
  requiredBy: string
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  attestationStatement: string
  showInLibrary: boolean
  active: boolean
}

const DEFAULT_ATTESTATION = `I have watched this training video in its entirety.
I understand the content as presented.
I agree to apply this guidance in my work.`

function blankDraft(): Draft {
  return {
    title: '',
    description: '',
    videoSource: 'youtube',
    videoRef: '',
    durationMinutes: '',
    requiredBy: '',
    audienceRoles: [],
    audienceShifts: [],
    attestationStatement: DEFAULT_ATTESTATION,
    showInLibrary: true,
    active: true,
  }
}

const draft = ref<Draft | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)

function startCreate() {
  draft.value = blankDraft()
  error.value = null
}

function startEdit(t: RequiredTraining) {
  draft.value = {
    id: t.id,
    title: t.title,
    description: t.description,
    videoSource: t.videoSource,
    videoRef: t.videoRef,
    durationMinutes: t.durationSeconds ? String(Math.round(t.durationSeconds / 60)) : '',
    requiredBy: t.requiredBy ?? '',
    audienceRoles: [...t.audienceRoles],
    audienceShifts: [...t.audienceShifts],
    attestationStatement: t.attestationStatement || DEFAULT_ATTESTATION,
    showInLibrary: t.showInLibrary,
    active: t.active,
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
  const durationSeconds = d.durationMinutes.trim()
    ? Math.max(0, Math.round(Number(d.durationMinutes) * 60))
    : null
  const result = await saveTraining({
    id: d.id,
    title: d.title.trim(),
    description: d.description.trim(),
    videoSource: d.videoSource,
    videoRef: d.videoRef.trim(),
    durationSeconds,
    requiredBy: d.requiredBy ? d.requiredBy : null,
    audienceRoles: d.audienceRoles,
    audienceShifts: d.audienceShifts,
    attestationStatement: d.attestationStatement.trim(),
    showInLibrary: d.showInLibrary,
    active: d.active,
  })
  saving.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  draft.value = null
}

async function onDelete(t: RequiredTraining) {
  if (!confirm(`Delete "${t.title}" and all completion records? This cannot be undone.`)) return
  const result = await deleteTraining(t.id)
  if (!result.ok) alert(result.error)
}

function completionStats(trainingId: string): { signed: number; started: number } {
  const c = completionsFor(trainingId)
  return {
    signed: c.filter((x) => x.attestationSigned).length,
    started: c.filter((x) => !x.attestationSigned).length,
  }
}

const ROLE_OPTIONS: Role[] = ['crew', 'supervisor', 'admin']
const SHIFT_OPTIONS: ShiftLetter[] = ['A', 'B', 'C']

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

const orderedTrainings = computed(() =>
  [...trainings.value].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  }),
)
</script>

<template>
  <div class="mrt">
    <header class="mrt__header">
      <div class="flex items-center gap-2">
        <ShieldCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mrt__title">Manage Required Training</h1>
      </div>
      <p class="mrt__sub">
        Compliance modules every assigned employee must watch and attest to.
        Crew see them on <code>/training/required</code>; completions are recorded with a
        signed attestation and an auto-generated certificate.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mrt__gate">Admin only.</div>

    <template v-else>
      <!-- Toolbar -->
      <div v-if="!draft" class="mrt__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> New training
        </button>
      </div>

      <!-- Form -->
      <AppCard v-if="draft" class="mrt-form">
        <Eyebrow class="mb-3">{{ draft.id ? 'Edit training' : 'New training' }}</Eyebrow>

        <form @submit.prevent="onSave">
          <div class="mrt-form__row">
            <label class="mrt-form__field">
              <span class="mrt-form__label">Title *</span>
              <input
                v-model="draft.title"
                type="text"
                required
                placeholder="e.g. CDC PPE Removal Training"
                class="mrt-form__input"
              />
            </label>
          </div>

          <div class="mrt-form__row">
            <label class="mrt-form__field">
              <span class="mrt-form__label">Description</span>
              <textarea
                v-model="draft.description"
                rows="3"
                placeholder="Short summary shown above the video."
                class="mrt-form__input"
              />
            </label>
          </div>

          <div class="mrt-form__row mrt-form__row--cols">
            <label class="mrt-form__field">
              <span class="mrt-form__label">Video source *</span>
              <select v-model="draft.videoSource" class="mrt-form__input">
                <option value="youtube">YouTube</option>
                <option value="cloudflare_stream">Cloudflare Stream</option>
                <option value="direct">Direct MP4 URL</option>
                <option value="sharepoint">SharePoint stream</option>
              </select>
            </label>
            <label class="mrt-form__field">
              <span class="mrt-form__label">Video URL or ID *</span>
              <input
                v-model="draft.videoRef"
                type="text"
                required
                placeholder="https://www.youtube.com/watch?v=…"
                class="mrt-form__input"
              />
            </label>
          </div>

          <div class="mrt-form__row mrt-form__row--cols">
            <label class="mrt-form__field">
              <span class="mrt-form__label">Approx. duration (minutes)</span>
              <input
                v-model="draft.durationMinutes"
                type="number"
                min="0"
                placeholder="30"
                class="mrt-form__input"
              />
              <span class="mrt-form__hint">Optional. Used for progress display.</span>
            </label>
            <label class="mrt-form__field">
              <span class="mrt-form__label">Required by</span>
              <input v-model="draft.requiredBy" type="date" class="mrt-form__input" />
              <span class="mrt-form__hint">Leave blank for ongoing / no deadline.</span>
            </label>
          </div>

          <div class="mrt-form__row">
            <span class="mrt-form__label">Audience</span>
            <div class="mrt-form__chips">
              <button
                v-for="r in ROLE_OPTIONS"
                :key="r"
                type="button"
                class="mrt-form__chip"
                :class="{ 'mrt-form__chip--on': draft.audienceRoles.includes(r) }"
                @click="toggleRole(r)"
              >
                {{ r }}
              </button>
              <span class="mrt-form__chip-sep">·</span>
              <button
                v-for="s in SHIFT_OPTIONS"
                :key="s"
                type="button"
                class="mrt-form__chip"
                :class="{ 'mrt-form__chip--on': draft.audienceShifts.includes(s) }"
                @click="toggleShift(s)"
              >
                Shift {{ s }}
              </button>
            </div>
            <span class="mrt-form__hint">
              No selection = all signed-in employees. Roles AND shifts narrow it (e.g. crew on A
              shift only).
            </span>
          </div>

          <div class="mrt-form__row">
            <label class="mrt-form__field">
              <span class="mrt-form__label">Attestation statement</span>
              <textarea
                v-model="draft.attestationStatement"
                rows="4"
                placeholder="One bullet per line"
                class="mrt-form__input"
              />
              <span class="mrt-form__hint">One bullet per line. Defaults provided.</span>
            </label>
          </div>

          <div class="mrt-form__row">
            <label class="mrt-form__check">
              <input v-model="draft.showInLibrary" type="checkbox" />
              <span>
                <strong>Also show in Training Library</strong>
                <span class="mrt-form__check-sub">
                  Cross-lists this module in <code>/training/recordings</code> with a Required
                  tag, so crew can find it via the same browse / search UI as other reference
                  videos. The video stays accessible even after everyone's completed it.
                </span>
              </span>
            </label>
          </div>

          <div class="mrt-form__row">
            <label class="mrt-form__check">
              <input v-model="draft.active" type="checkbox" />
              <span>
                <strong>Active</strong>
                <span class="mrt-form__check-sub">Uncheck to archive — crew will no longer see this module.</span>
              </span>
            </label>
          </div>

          <div v-if="error" class="mrt-form__error">{{ error }}</div>

          <div class="mrt-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : (draft.id ? 'Update' : 'Create') }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- Module list -->
      <div v-if="!ready" class="mrt__empty">Loading…</div>
      <div v-else-if="!orderedTrainings.length && !draft" class="mrt__empty">
        No training modules yet. Click "New training" to add one.
      </div>
      <div v-else class="mrt-list">
        <AppCard
          v-for="t in orderedTrainings"
          :key="t.id"
          class="mrt-row"
          :class="{ 'mrt-row--archived': !t.active }"
        >
          <div class="mrt-row__main">
            <div class="mrt-row__head">
              <span class="mrt-row__title display">{{ t.title }}</span>
              <span v-if="!t.active" class="mrt-row__chip mrt-row__chip--archived">Archived</span>
            </div>
            <p v-if="t.description" class="mrt-row__desc">{{ t.description }}</p>
            <div class="mrt-row__meta">
              <span>
                <strong>{{ completionStats(t.id).signed }}</strong> signed
                <span v-if="completionStats(t.id).started > 0">
                  · {{ completionStats(t.id).started }} in progress
                </span>
              </span>
              <span v-if="t.requiredBy">· due {{ new Date(t.requiredBy).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' }) }}</span>
              <span v-if="t.audienceRoles.length || t.audienceShifts.length">
                · {{ [...t.audienceRoles, ...t.audienceShifts.map(s => 'Shift ' + s)].join(', ') }}
              </span>
            </div>
          </div>
          <div class="mrt-row__actions">
            <RouterLink :to="`/admin/required-training/${t.id}`" class="mrt-row__btn">
              <Users :size="13" :stroke-width="1.85" /> Roster
              <ChevronRight :size="13" :stroke-width="1.85" />
            </RouterLink>
            <button type="button" class="mrt-row__btn" @click="startEdit(t)">
              <Edit2 :size="13" :stroke-width="1.85" /> Edit
            </button>
            <button
              type="button"
              class="mrt-row__btn mrt-row__btn--danger"
              @click="onDelete(t)"
            >
              <Trash2 :size="13" :stroke-width="1.85" /> Delete
            </button>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mrt {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mrt {
    padding: 40px 40px 80px;
  }
}
.mrt__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .mrt__title {
    font-size: 36px;
  }
}
.mrt__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 800px;
}
.mrt__sub code {
  font-size: 12px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 0 4px;
}
.mrt__gate {
  margin-top: 32px;
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.mrt__toolbar {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}
.mrt__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

/* Form */
.mrt-form {
  margin-top: 18px;
  padding: 18px !important;
}
.mrt-form__row {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mrt-form__row:first-of-type {
  margin-top: 4px;
}
.mrt-form__row--cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 640px) {
  .mrt-form__row--cols {
    grid-template-columns: 1fr 1fr;
  }
}
.mrt-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mrt-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mrt-form__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.mrt-form__input {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.mrt-form__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.mrt-form__chips {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.mrt-form__chip {
  text-transform: capitalize;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.mrt-form__chip--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.mrt-form__chip-sep {
  color: var(--color-muted);
  margin: 0 2px;
}
.mrt-form__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.mrt-form__check input {
  margin-top: 2px;
}
.mrt-form__check-sub {
  display: block;
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 2px;
}
.mrt-form__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}
.mrt-form__actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* List */
.mrt-list {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mrt-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px !important;
}
.mrt-row--archived {
  opacity: 0.6;
}
.mrt-row__main {
  flex: 1;
  min-width: 0;
}
.mrt-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mrt-row__title {
  font-size: 16px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.mrt-row__chip {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  color: var(--color-muted);
}
.mrt-row__chip--archived {
  background: oklch(0.96 0.01 80);
  color: oklch(0.45 0.05 80);
}
.mrt-row__desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.mrt-row__meta {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mrt-row__actions {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}
@media (min-width: 640px) {
  .mrt-row__actions {
    flex-direction: row;
  }
}
.mrt-row__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: border-color 120ms var(--ease-out);
}
.mrt-row__btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.mrt-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.btn-primary {
  background: var(--color-brand-600);
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
