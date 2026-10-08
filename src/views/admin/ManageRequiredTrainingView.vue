<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { supabase } from '@/lib/supabase'
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
import type { EmploymentType, RequiredTraining, Role, ShiftLetter, VideoSource } from '@/types'

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
  audienceMode: 'filters' | 'event'
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  audienceEmploymentTypes: EmploymentType[]
  audienceEventLabel: string
  audienceEventFrom: string
  audienceEventTo: string
  attestationStatement: string
  showInLibrary: boolean
  active: boolean
}

const DEFAULT_ATTESTATION = `I have watched this training video in its entirety.
I understand the content as presented.
I agree to apply this guidance in my work.`

/* External courses live on someone else's site — the attestation IS
   the completion record, so the default wording says so. */
const DEFAULT_ATTESTATION_EXTERNAL = `I have completed this course on the external training site in its entirety.
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
    audienceMode: 'filters',
    audienceRoles: [],
    audienceShifts: [],
    audienceEmploymentTypes: [],
    audienceEventLabel: '',
    audienceEventFrom: '',
    audienceEventTo: '',
    attestationStatement: DEFAULT_ATTESTATION,
    showInLibrary: true,
    active: true,
  }
}

/* ── Upcoming schedule events for the audience picker ─────────────── */
interface EventGroup {
  label: string
  from: string
  to: string
  people: number
}
const eventGroups = ref<EventGroup[]>([])

async function loadEventGroups() {
  if (auth.usingDevStub) return
  const today = new Date().toISOString().slice(0, 10)
  const res = await supabase
    .from('sched_entries')
    .select('user_id, work_date, note, event:sched_events(label)')
    .eq('kind', 'event')
    .eq('status', 'scheduled')
    .not('user_id', 'is', null)
    .gte('work_date', today)
    .order('work_date', { ascending: true })
  if (res.error) return
  const groups = new Map<string, { from: string; to: string; people: Set<string> }>()
  for (const r of (res.data ?? []) as Array<{
    user_id: string
    work_date: string
    note: string | null
    event: { label: string | null } | { label: string | null }[] | null
  }>) {
    const ev = Array.isArray(r.event) ? r.event[0] : r.event
    const label = ev?.label || r.note || 'Event'
    const g = groups.get(label) ?? { from: r.work_date, to: r.work_date, people: new Set<string>() }
    if (r.work_date < g.from) g.from = r.work_date
    if (r.work_date > g.to) g.to = r.work_date
    g.people.add(r.user_id)
    groups.set(label, g)
  }
  eventGroups.value = [...groups.entries()]
    .map(([label, g]) => ({ label, from: g.from, to: g.to, people: g.people.size }))
    .sort((a, b) => a.from.localeCompare(b.from))
}

onMounted(() => {
  void loadEventGroups()
})

function fmtEventDates(g: EventGroup): string {
  const f = new Date(`${g.from}T12:00:00`)
  const t = new Date(`${g.to}T12:00:00`)
  const fs = f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (g.from === g.to) return fs
  return `${fs} – ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/* Picking an event fills the label + window (window stays editable). */
function onPickEvent(label: string) {
  if (!draft.value) return
  draft.value.audienceEventLabel = label
  const g = eventGroups.value.find((x) => x.label === label)
  if (g) {
    draft.value.audienceEventFrom = g.from
    draft.value.audienceEventTo = g.to
    if (!draft.value.requiredBy) draft.value.requiredBy = g.from
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
    audienceMode: t.audienceEventLabel ? 'event' : 'filters',
    audienceRoles: [...t.audienceRoles],
    audienceShifts: [...t.audienceShifts],
    audienceEmploymentTypes: [...t.audienceEmploymentTypes],
    audienceEventLabel: t.audienceEventLabel ?? '',
    audienceEventFrom: t.audienceEventFrom ?? '',
    audienceEventTo: t.audienceEventTo ?? '',
    attestationStatement:
      t.attestationStatement ||
      (t.videoSource === 'external' ? DEFAULT_ATTESTATION_EXTERNAL : DEFAULT_ATTESTATION),
    showInLibrary: t.showInLibrary,
    active: t.active,
  }
  error.value = null
}

/* Switching to/from the external source swaps the suggested
   attestation — only when the admin hasn't customized it. */
watch(
  () => draft.value?.videoSource,
  (src, old) => {
    const d = draft.value
    if (!d || !src || !old || src === old) return
    if (src === 'external' && d.attestationStatement.trim() === DEFAULT_ATTESTATION)
      d.attestationStatement = DEFAULT_ATTESTATION_EXTERNAL
    if (src !== 'external' && d.attestationStatement.trim() === DEFAULT_ATTESTATION_EXTERNAL)
      d.attestationStatement = DEFAULT_ATTESTATION
  },
)

function cancel() {
  draft.value = null
  error.value = null
}

async function onSave() {
  if (!draft.value || saving.value) return
  saving.value = true
  error.value = null
  const d = draft.value
  /* <input type="number"> v-model can hand us a number (not the string
     we declared in the Draft interface) once the user actually types
     into it, so coerce defensively before any string ops. */
  const durationRaw = String(d.durationMinutes ?? '').trim()
  const durationNum = durationRaw ? Number(durationRaw) : NaN
  const durationSeconds =
    Number.isFinite(durationNum) && durationNum > 0
      ? Math.round(durationNum * 60)
      : null
  if (d.videoSource === 'external' && !/^https?:\/\//i.test(d.videoRef.trim())) {
    error.value = 'External course needs a full link (https://…).'
    saving.value = false
    return
  }
  const eventMode = d.audienceMode === 'event'
  if (eventMode && !d.audienceEventLabel.trim()) {
    error.value = 'Pick the schedule event this training is tied to.'
    saving.value = false
    return
  }
  const result = await saveTraining({
    id: d.id,
    title: d.title.trim(),
    description: d.description.trim(),
    videoSource: d.videoSource,
    videoRef: d.videoRef.trim(),
    durationSeconds,
    requiredBy: d.requiredBy ? d.requiredBy : null,
    audienceRoles: eventMode ? [] : d.audienceRoles,
    audienceShifts: eventMode ? [] : d.audienceShifts,
    audienceEmploymentTypes: eventMode ? [] : d.audienceEmploymentTypes,
    audienceEventLabel: eventMode ? d.audienceEventLabel.trim() : null,
    audienceEventFrom: eventMode && d.audienceEventFrom ? d.audienceEventFrom : null,
    audienceEventTo: eventMode && d.audienceEventTo ? d.audienceEventTo : null,
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
const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentType; label: string }> = [
  { value: 'full_time', label: 'Full-Time' },
  { value: 'part_time', label: 'Part-Time' },
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
              <span class="mrt-form__label">Content source *</span>
              <select v-model="draft.videoSource" class="mrt-form__input">
                <option value="youtube">YouTube</option>
                <option value="cloudflare_stream">Cloudflare Stream</option>
                <option value="direct">Direct MP4 URL</option>
                <option value="sharepoint">SharePoint stream</option>
                <option value="external">External course (link)</option>
              </select>
              <span v-if="draft.videoSource === 'external'" class="mrt-form__hint">
                Hosted elsewhere (Pulsara Academy, EMS1, a state site). Crews open the link,
                complete it there, then sign the attestation here — the signed attestation is
                the completion record.
              </span>
            </label>
            <label class="mrt-form__field">
              <span class="mrt-form__label">{{ draft.videoSource === 'external' ? 'Course link *' : 'Video URL or ID *' }}</span>
              <input
                v-model="draft.videoRef"
                type="text"
                required
                :placeholder="draft.videoSource === 'external' ? 'https://www.pulsara.com/academy/…' : 'https://www.youtube.com/watch?v=…'"
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
            <div class="mrt-form__chips" style="margin-bottom: 6px">
              <button
                type="button"
                class="mrt-form__chip"
                :class="{ 'mrt-form__chip--on': draft.audienceMode === 'filters' }"
                @click="draft.audienceMode = 'filters'"
              >
                Everyone matching filters
              </button>
              <button
                type="button"
                class="mrt-form__chip"
                :class="{ 'mrt-form__chip--on': draft.audienceMode === 'event' }"
                @click="draft.audienceMode = 'event'"
              >
                Scheduled on an event
              </button>
            </div>

            <template v-if="draft.audienceMode === 'event'">
              <div class="mrt-form__row mrt-form__row--cols" style="margin-bottom: 0">
                <label class="mrt-form__field">
                  <span class="mrt-form__label">Schedule event *</span>
                  <select
                    :value="draft.audienceEventLabel"
                    class="mrt-form__input"
                    @change="onPickEvent(($event.target as HTMLSelectElement).value)"
                  >
                    <option value="" disabled>Pick an upcoming event…</option>
                    <option
                      v-if="draft.audienceEventLabel && !eventGroups.some((g) => g.label === draft!.audienceEventLabel)"
                      :value="draft.audienceEventLabel"
                    >
                      {{ draft.audienceEventLabel }} (no upcoming slots)
                    </option>
                    <option v-for="g in eventGroups" :key="g.label" :value="g.label">
                      {{ g.label }} · {{ fmtEventDates(g) }} · {{ g.people }} scheduled
                    </option>
                  </select>
                </label>
                <div class="mrt-form__field">
                  <span class="mrt-form__label">Event window</span>
                  <div style="display: flex; gap: 8px">
                    <input v-model="draft.audienceEventFrom" type="date" class="mrt-form__input" />
                    <input v-model="draft.audienceEventTo" type="date" class="mrt-form__input" />
                  </div>
                </div>
              </div>
              <span class="mrt-form__hint">
                The audience is whoever holds a scheduled slot on this event — live from the
                schedule, so pickups and giveaways update it automatically. Assignment
                notifications go out within 15 minutes to anyone on the roster who hasn't
                completed it, including people who pick up a slot later.
              </span>
            </template>

            <div v-show="draft.audienceMode === 'filters'" class="mrt-form__chips">
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
              <span class="mrt-form__chip-sep">·</span>
              <button
                v-for="e in EMPLOYMENT_OPTIONS"
                :key="e.value"
                type="button"
                class="mrt-form__chip"
                :class="{ 'mrt-form__chip--on': draft.audienceEmploymentTypes.includes(e.value) }"
                @click="toggleEmploymentType(e.value)"
              >
                {{ e.label }}
              </button>
            </div>
            <span v-show="draft.audienceMode === 'filters'" class="mrt-form__hint">
              No selection on an axis = "any" for that axis. Selections across axes are AND-ed
              (e.g. <em>crew</em> + <em>Shift A</em> + <em>Full-Time</em> = A-shift FT crew only).
              Use the per-person overrides on the roster page for individual exceptions.
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
              <span v-if="t.audienceRoles.length || t.audienceShifts.length || t.audienceEmploymentTypes.length">
                · {{ [
                  ...t.audienceRoles,
                  ...t.audienceShifts.map((s) => 'Shift ' + s),
                  ...t.audienceEmploymentTypes.map((e) => e === 'full_time' ? 'Full-Time' : 'Part-Time'),
                ].join(', ') }}
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
