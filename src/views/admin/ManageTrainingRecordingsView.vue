<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Film, Plus, Save, X, Edit2, Trash2, Upload, ExternalLink } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import TagInput from '@/components/primitives/TagInput.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  useTrainingRecordings,
  RECORDING_CATEGORY_PRESETS,
  RECORDING_CATEGORY_OTHER,
} from '@/composables/useTrainingRecordings'
import {
  extractYouTubeId,
  resolveThumbnail,
  type VideoSource,
} from '@/lib/videoSource'
import type { Role } from '@/types'

interface RecordingRow {
  id: string
  title: string
  description: string | null
  instructor: string | null
  recorded_at: string | null
  duration_minutes: number | null
  category: string | null
  tags: string[] | null
  thumbnail_url: string | null
  video_source: VideoSource
  video_ref: string
  visible_to_roles: string[]
  view_count: number
  active: boolean
}

interface Draft {
  id: string | null
  title: string
  description: string
  instructor: string
  recorded_at: string
  duration_minutes: number | null
  /** One of RECORDING_CATEGORY_PRESETS, or 'Other' to enable category_other. */
  category_pick: string
  /** Free-text value used only when category_pick === 'Other'. */
  category_other: string
  tags: string[]
  thumbnail_url: string
  video_source: VideoSource
  video_ref: string
  visible_to_roles: Role[]
  active: boolean
}

const ROLES: Role[] = ['crew', 'supervisor', 'admin']
const SOURCES: Array<{ value: VideoSource; label: string; hint: string }> = [
  {
    value: 'wix',
    label: 'Wix Media',
    hint: 'Paste the direct .mp4 URL from Wix Media Manager (right-click → Copy media URL).',
  },
  {
    value: 'sharepoint',
    label: 'SharePoint',
    hint: 'Paste the embed iframe URL from SharePoint (Embed dialog, the `src` value).',
  },
  {
    value: 'youtube',
    label: 'YouTube',
    hint: 'Paste the YouTube URL or just the 11-character video ID. Mark videos as Unlisted on YouTube.',
  },
  {
    value: 'direct',
    label: 'Direct URL',
    hint: 'Any other direct video file URL (.mp4, .webm). Plays in our native player.',
  },
]

const auth = useAuthStore()
const { allTags, refresh: refreshLibrary } = useTrainingRecordings()

const rows = ref<RecordingRow[]>([])
const loading = ref(true)
const draft = ref<Draft | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')
const uploadingThumb = ref(false)

async function load() {
  loading.value = true
  error.value = null
  const { data, error: fetchErr } = await supabase
    .from('training_recordings')
    .select(
      'id, title, description, instructor, recorded_at, duration_minutes, category, tags, thumbnail_url, video_source, video_ref, visible_to_roles, view_count, active',
    )
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (fetchErr) {
    error.value = fetchErr.message
    loading.value = false
    return
  }
  rows.value = (data ?? []) as RecordingRow[]
  loading.value = false
}

onMounted(load)

function blankDraft(): Draft {
  return {
    id: null,
    title: '',
    description: '',
    instructor: '',
    recorded_at: '',
    duration_minutes: null,
    category_pick: '',
    category_other: '',
    tags: [],
    thumbnail_url: '',
    video_source: 'wix',
    video_ref: '',
    visible_to_roles: ['crew', 'supervisor', 'admin'],
    active: true,
  }
}

function startCreate() {
  draft.value = blankDraft()
  error.value = null
}

function startEdit(r: RecordingRow) {
  /* Map the row's persisted category back into the form's two-field
     representation. If the value matches a preset, it goes into the
     selector. If not, it lands in the "Other" free-text and the
     selector is set to 'Other' so the input reveals. */
  const cat = r.category ?? ''
  const matchesPreset = (RECORDING_CATEGORY_PRESETS as readonly string[]).includes(cat)
  draft.value = {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    instructor: r.instructor ?? '',
    recorded_at: r.recorded_at ?? '',
    duration_minutes: r.duration_minutes,
    category_pick: matchesPreset ? cat : cat ? RECORDING_CATEGORY_OTHER : '',
    category_other: matchesPreset ? '' : cat,
    tags: (r.tags ?? []).slice(),
    thumbnail_url: r.thumbnail_url ?? '',
    video_source: r.video_source,
    video_ref: r.video_ref,
    visible_to_roles: (r.visible_to_roles ?? []) as Role[],
    active: r.active,
  }
  error.value = null
}

/** Resolve a draft's two-field category representation back into the
 *  single string we actually persist. Returns null for "uncategorized." */
function resolvedCategory(d: Draft): string | null {
  if (d.category_pick === RECORDING_CATEGORY_OTHER) {
    return d.category_other.trim() || null
  }
  return d.category_pick.trim() || null
}

function cancelEdit() {
  draft.value = null
  error.value = null
}

function toggleRole(role: Role) {
  if (!draft.value) return
  const i = draft.value.visible_to_roles.indexOf(role)
  if (i >= 0) draft.value.visible_to_roles.splice(i, 1)
  else draft.value.visible_to_roles.push(role)
}

/* For a YouTube ref the admin can paste any URL form; we normalize to
   the bare 11-char ID on save so the playback layer doesn't have to keep
   re-parsing. Other sources pass through as-is. */
function normalizeRef(source: VideoSource, raw: string): string {
  const v = raw.trim()
  if (source === 'youtube') {
    const id = extractYouTubeId(v)
    return id ?? v // fall through if we can't parse; validate() catches it
  }
  return v
}

function validate(d: Draft): string | null {
  if (!d.title.trim()) return 'Title is required.'
  if (!d.video_ref.trim()) return 'Video URL or ID is required.'
  if (d.video_source === 'youtube' && !extractYouTubeId(d.video_ref)) {
    return 'Could not find a YouTube video ID in that URL. Paste the full YouTube URL or just the 11-character ID.'
  }
  if (
    (d.video_source === 'wix' || d.video_source === 'direct') &&
    !/^https?:\/\//i.test(d.video_ref.trim())
  ) {
    return 'Direct/Wix sources need a full https:// URL ending in .mp4 (or similar).'
  }
  if (d.video_source === 'sharepoint' && !/^https?:\/\//i.test(d.video_ref.trim())) {
    return 'SharePoint source needs the full https:// embed URL.'
  }
  return null
}

async function save() {
  if (!draft.value || saving.value) return
  const d = draft.value
  const v = validate(d)
  if (v) {
    error.value = v
    return
  }
  saving.value = true
  error.value = null
  const payload = {
    title: d.title.trim(),
    description: d.description.trim() || null,
    instructor: d.instructor.trim() || null,
    recorded_at: d.recorded_at || null,
    duration_minutes: d.duration_minutes,
    category: resolvedCategory(d),
    tags: d.tags.map((t) => t.trim()).filter((t) => t.length > 0),
    thumbnail_url: d.thumbnail_url.trim() || null,
    video_source: d.video_source,
    video_ref: normalizeRef(d.video_source, d.video_ref),
    visible_to_roles:
      d.visible_to_roles.length > 0 ? d.visible_to_roles : ['crew', 'supervisor', 'admin'],
    active: d.active,
  }
  if (d.id) {
    const { error: updErr } = await supabase
      .from('training_recordings')
      .update(payload)
      .eq('id', d.id)
    if (updErr) {
      saving.value = false
      error.value = updErr.message
      return
    }
  } else {
    const { error: insErr } = await supabase
      .from('training_recordings')
      .insert({
        ...payload,
        created_by: auth.appUser?.id ?? null,
      })
    if (insErr) {
      saving.value = false
      error.value = insErr.message
      return
    }
  }
  saving.value = false
  draft.value = null
  await load()
  await refreshLibrary()
}

async function removeRecording(r: RecordingRow) {
  if (
    !confirm(
      `Delete "${r.title}"? The video file at its source URL is not affected — only this library entry is removed.`,
    )
  )
    return
  const { error: delErr } = await supabase
    .from('training_recordings')
    .delete()
    .eq('id', r.id)
  if (delErr) {
    alert(delErr.message)
    return
  }
  await load()
  await refreshLibrary()
}

async function toggleActive(r: RecordingRow) {
  const { error: updErr } = await supabase
    .from('training_recordings')
    .update({ active: !r.active })
    .eq('id', r.id)
  if (updErr) {
    alert(updErr.message)
    return
  }
  await load()
  await refreshLibrary()
}

async function onThumbnailUpload(event: Event) {
  if (!draft.value) return
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  uploadingThumb.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const key = `${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('training-recording-thumbnails')
      .upload(key, file, { cacheControl: '31536000', upsert: false })
    if (upErr) throw upErr
    const { data } = supabase.storage
      .from('training-recording-thumbnails')
      .getPublicUrl(key)
    draft.value.thumbnail_url = data.publicUrl
  } catch (e) {
    alert(`Thumbnail upload failed: ${(e as Error).message}`)
  } finally {
    uploadingThumb.value = false
    target.value = ''
  }
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      (r.instructor ?? '').toLowerCase().includes(q) ||
      (r.category ?? '').toLowerCase().includes(q) ||
      (r.tags ?? []).some((t) => t.toLowerCase().includes(q)),
  )
})

function thumbFor(r: RecordingRow): string | null {
  return resolveThumbnail(r.video_source, r.video_ref, r.thumbnail_url)
}

function sourceLabel(s: VideoSource): string {
  return SOURCES.find((x) => x.value === s)?.label ?? s
}

const activeSourceHint = computed(() => {
  if (!draft.value) return ''
  return SOURCES.find((s) => s.value === draft.value!.video_source)?.hint ?? ''
})
</script>

<template>
  <div class="mtr">
    <header class="mtr__header">
      <div class="flex items-center gap-2">
        <Film :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mtr__title">Manage Training Library</h1>
      </div>
      <p class="mtr__sub">
        Publish past trainings (protocol updates, Doc Day, skills refreshers, etc.) for
        crews to watch in the intranet. Videos play inline — no new tabs.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mtr__gate">Admin only.</div>

    <template v-else>
      <div class="mtr__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> Add recording
        </button>
        <input
          v-model="search"
          type="search"
          placeholder="Search by title, instructor, or category…"
          aria-label="Search recordings"
          class="mtr__search"
        />
      </div>

      <!-- Edit / create form -->
      <AppCard v-if="draft" class="mtr-form">
        <Eyebrow class="mb-3">{{ draft.id ? 'Edit recording' : 'New recording' }}</Eyebrow>
        <form class="mtr-form__grid" @submit.prevent="save">
          <label class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Title</span>
            <input
              v-model="draft.title"
              type="text"
              maxlength="120"
              required
              placeholder="e.g. 2026 Protocol Updates"
              class="mtr-form__input"
            />
          </label>

          <label class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Description (optional)</span>
            <textarea
              v-model="draft.description"
              rows="3"
              maxlength="600"
              placeholder="What's covered? Who's it for?"
              class="mtr-form__input mtr-form__textarea"
            />
          </label>

          <label class="mtr-form__field">
            <span class="mtr-form__label">Instructor</span>
            <input
              v-model="draft.instructor"
              type="text"
              maxlength="80"
              placeholder="e.g. Dr. Buzzard"
              class="mtr-form__input"
            />
          </label>

          <label class="mtr-form__field">
            <span class="mtr-form__label">Recorded on</span>
            <input
              v-model="draft.recorded_at"
              type="date"
              class="mtr-form__input"
            />
          </label>

          <label class="mtr-form__field">
            <span class="mtr-form__label">Duration (minutes)</span>
            <input
              v-model.number="draft.duration_minutes"
              type="number"
              min="1"
              max="600"
              placeholder="e.g. 28"
              class="mtr-form__input"
            />
          </label>

          <label class="mtr-form__field">
            <span class="mtr-form__label">Category</span>
            <select v-model="draft.category_pick" class="mtr-form__input">
              <option value="">— None —</option>
              <option v-for="c in RECORDING_CATEGORY_PRESETS" :key="c" :value="c">
                {{ c }}
              </option>
              <option :value="RECORDING_CATEGORY_OTHER">Other…</option>
            </select>
            <input
              v-if="draft.category_pick === RECORDING_CATEGORY_OTHER"
              v-model="draft.category_other"
              type="text"
              maxlength="40"
              placeholder="Type a custom category"
              class="mtr-form__input"
              style="margin-top: 6px"
            />
            <span class="mtr-form__hint">Pick a preset; choose "Other" for a one-off.</span>
          </label>

          <div class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Tags</span>
            <TagInput
              v-model="draft.tags"
              :suggestions="allTags"
              placeholder="Type a tag, press Enter (e.g. cardiac, pediatric, 2026)"
            />
            <span class="mtr-form__hint">
              Optional cross-cutting tags for search. Pulls from existing tags as you type.
            </span>
          </div>

          <div class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Video source</span>
            <div class="mtr-form__source-row">
              <label
                v-for="s in SOURCES"
                :key="s.value"
                class="mtr-form__source"
                :class="{ 'mtr-form__source--on': draft.video_source === s.value }"
              >
                <input
                  type="radio"
                  name="video_source"
                  :value="s.value"
                  v-model="draft.video_source"
                />
                <span>{{ s.label }}</span>
              </label>
            </div>
            <span class="mtr-form__hint">{{ activeSourceHint }}</span>
          </div>

          <label class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">
              {{
                draft.video_source === 'youtube'
                  ? 'YouTube URL or video ID'
                  : draft.video_source === 'sharepoint'
                  ? 'SharePoint embed URL'
                  : 'Video URL'
              }}
            </span>
            <input
              v-model="draft.video_ref"
              type="text"
              required
              :placeholder="
                draft.video_source === 'youtube'
                  ? 'https://youtu.be/… or the 11-char ID'
                  : draft.video_source === 'sharepoint'
                  ? 'https://…sharepoint.com/…&embed=true'
                  : 'https://…/file.mp4'
              "
              class="mtr-form__input"
            />
          </label>

          <div class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Thumbnail (optional)</span>
            <div class="mtr-form__thumb-row">
              <div class="mtr-form__thumb-preview">
                <img v-if="draft.thumbnail_url" :src="draft.thumbnail_url" alt="" />
                <span v-else class="mtr-form__thumb-empty">No image</span>
              </div>
              <div class="mtr-form__thumb-controls">
                <input
                  v-model="draft.thumbnail_url"
                  type="url"
                  placeholder="Paste a URL, or upload below"
                  class="mtr-form__input"
                />
                <label class="mtr-form__upload">
                  <input
                    type="file"
                    accept="image/*"
                    :disabled="uploadingThumb"
                    @change="onThumbnailUpload"
                  />
                  <Upload :size="13" :stroke-width="2" />
                  {{ uploadingThumb ? 'Uploading…' : 'Upload image' }}
                </label>
              </div>
            </div>
            <span class="mtr-form__hint">
              YouTube videos auto-generate a thumbnail if you leave this blank. For Wix/SharePoint, paste an image URL or upload one.
            </span>
          </div>

          <div class="mtr-form__field mtr-form__field--wide">
            <span class="mtr-form__label">Visible to</span>
            <div class="mtr-form__role-row">
              <label
                v-for="r in ROLES"
                :key="r"
                class="mtr-form__role"
                :class="{ 'mtr-form__role--on': draft.visible_to_roles.includes(r) }"
              >
                <input
                  type="checkbox"
                  :checked="draft.visible_to_roles.includes(r)"
                  @change="toggleRole(r)"
                />
                <span>{{ r }}</span>
              </label>
            </div>
            <span class="mtr-form__hint">
              Default: visible to everyone. Uncheck any role to hide from them.
            </span>
          </div>

          <label class="mtr-form__field mtr-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Published (visible to crews)</span>
          </label>

          <div v-if="error" class="mtr-form__error">{{ error }}</div>

          <div class="mtr-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancelEdit">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add recording' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- List -->
      <div v-if="loading" class="mtr__empty">Loading…</div>
      <div v-else-if="filteredRows.length === 0" class="mtr__empty">
        {{
          search
            ? 'No recordings match that search.'
            : 'No recordings yet. Click "Add recording" above.'
        }}
      </div>

      <AppCard
        v-for="r in filteredRows"
        :key="r.id"
        class="mtr-row"
        :class="{ 'mtr-row--inactive': !r.active }"
      >
        <div class="mtr-row__thumb">
          <img v-if="thumbFor(r)" :src="thumbFor(r) || ''" :alt="r.title" />
          <span v-else class="mtr-row__thumb-empty">{{ sourceLabel(r.video_source) }}</span>
        </div>
        <div class="mtr-row__text">
          <div class="display mtr-row__name">{{ r.title }}</div>
          <div class="mtr-row__meta">
            <span v-if="r.instructor">{{ r.instructor }}</span>
            <span v-if="r.instructor && r.recorded_at"> · </span>
            <span v-if="r.recorded_at">{{ r.recorded_at }}</span>
            <span v-if="r.duration_minutes"> · {{ r.duration_minutes }} min</span>
            <span v-if="r.category"> · {{ r.category }}</span>
            <span v-if="r.tags && r.tags.length > 0" class="mtr-row__tags">
              <span v-for="t in r.tags" :key="t" class="mtr-row__tag">{{ t }}</span>
            </span>
            <span class="mtr-row__source-tag">{{ sourceLabel(r.video_source) }}</span>
            <span v-if="!r.active" class="mtr-row__inactive-chip">Hidden</span>
            <span class="mtr-row__views">{{ r.view_count }} view{{ r.view_count === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div class="mtr-row__actions">
          <a
            :href="r.video_ref"
            target="_blank"
            rel="noopener noreferrer"
            class="mtr-row__btn"
            title="Open source URL"
          >
            <ExternalLink :size="13" :stroke-width="1.85" />
          </a>
          <button
            type="button"
            class="mtr-row__btn"
            :title="r.active ? 'Unpublish' : 'Publish'"
            @click="toggleActive(r)"
          >
            {{ r.active ? 'Unpublish' : 'Publish' }}
          </button>
          <button type="button" class="mtr-row__btn" @click="startEdit(r)">
            <Edit2 :size="13" :stroke-width="1.85" /> Edit
          </button>
          <button
            type="button"
            class="mtr-row__btn mtr-row__btn--danger"
            @click="removeRecording(r)"
          >
            <Trash2 :size="13" :stroke-width="1.85" />
          </button>
        </div>
      </AppCard>
    </template>
  </div>
</template>

<style scoped>
.mtr {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mtr {
    padding: 40px 40px 80px;
  }
}

.mtr__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .mtr__title {
    font-size: 36px;
  }
}
.mtr__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 60ch;
}

.mtr__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mtr__toolbar {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mtr__search {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px;
  outline: none;
}
.mtr__search:focus {
  border-color: var(--color-brand-600);
}

.mtr__empty {
  margin-top: 24px;
  padding: 28px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

/* ── Form ──────────────────────────────────────────────────────────── */
.mtr-form {
  margin-top: 18px;
  padding: 18px !important;
}
.mtr-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 768px) {
  .mtr-form__grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}
.mtr-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mtr-form__field--wide {
  grid-column: 1 / -1;
}
.mtr-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mtr-form__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.mtr-form__input {
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
.mtr-form__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.mtr-form__textarea {
  font-family: var(--font-sans);
  resize: vertical;
  min-height: 64px;
}

.mtr-form__source-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mtr-form__source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 12.5px;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.mtr-form__source:hover {
  border-color: var(--color-muted-soft);
}
.mtr-form__source input {
  display: none;
}
.mtr-form__source--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.mtr-form__role-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mtr-form__role {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 12px;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
  text-transform: capitalize;
}
.mtr-form__role input {
  display: none;
}
.mtr-form__role--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.mtr-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
}
.mtr-form__check input {
  width: 16px;
  height: 16px;
}

.mtr-form__thumb-row {
  display: flex;
  gap: 12px;
  align-items: stretch;
}
.mtr-form__thumb-preview {
  flex: 0 0 140px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.mtr-form__thumb-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mtr-form__thumb-empty {
  font-size: 11px;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mtr-form__thumb-controls {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.mtr-form__upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.mtr-form__upload:hover {
  border-color: var(--color-muted-soft);
}
.mtr-form__upload input[type='file'] {
  display: none;
}

.mtr-form__error {
  grid-column: 1 / -1;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.mtr-form__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

/* ── List ──────────────────────────────────────────────────────────── */
.mtr-row {
  display: flex !important;
  align-items: center;
  gap: 14px;
  padding: 12px 14px !important;
  margin-bottom: 6px;
  margin-top: 6px;
}
.mtr-row--inactive {
  opacity: 0.6;
}

.mtr-row__thumb {
  flex: 0 0 96px;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mtr-row__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mtr-row__thumb-empty {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  color: white;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mtr-row__text {
  flex: 1;
  min-width: 0;
}
.mtr-row__name {
  font-size: 15px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.mtr-row__meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.mtr-row__source-tag {
  margin-left: 6px;
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.mtr-row__tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-left: 4px;
}
.mtr-row__tag {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-brand-100);
  color: var(--color-brand-700);
  letter-spacing: 0;
  text-transform: none;
}
.mtr-row__inactive-chip {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: oklch(0.97 0.04 20);
  color: var(--color-danger-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.mtr-row__views {
  margin-left: auto;
}

.mtr-row__actions {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}
.mtr-row__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: border-color 120ms var(--ease-out);
}
.mtr-row__btn:hover {
  border-color: var(--color-muted-soft);
}
.mtr-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}

/* Buttons (same as ManageQuickLinksView) */
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
