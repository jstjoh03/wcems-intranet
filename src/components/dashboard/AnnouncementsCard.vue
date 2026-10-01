<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import {
  Plus,
  Edit2,
  X,
  Upload,
  Archive,
  ArchiveRestore,
  Bold,
  Italic,
  Link2,
  List,
  Eye,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AnnouncementDetailModal from '@/components/dashboard/AnnouncementDetailModal.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useAnnouncements } from '@/composables/useAnnouncements'
import { renderRichText, richTextToPlain } from '@/lib/richtext'
import type { Announcement } from '@/types'

const auth = useAuthStore()
const { announcements, publish, update, setArchived, remove } = useAnnouncements()

const PRESET_CATEGORIES = [
  'Operations',
  'Protocol',
  'Education',
  'Recognition',
  'Outreach',
  'Event',
] as const

interface Draft {
  id: string | null
  tag: string
  customTag: string
  title: string
  body: string
  imageUrl: string | null
  allowComments: boolean
  /** app_users ids pushed when someone comments. */
  notifyIds: string[]
}

const composing = ref(false)
const draft = ref<Draft>(blankDraft())
const submitting = ref(false)
const uploadingImage = ref(false)
const composeError = ref<string | null>(null)
const lightboxUrl = ref<string | null>(null)

/* Admin-only toggle: archived rows are hidden from the list by default
   (matches what crew sees via RLS) and surfaced only when the admin
   asks to see them, so the dashboard stays uncluttered. */
const showArchived = ref(false)

const archivedCount = computed(
  () => announcements.value.filter((a) => !a.active).length,
)

const visibleAnnouncements = computed(() => {
  // Non-admins never receive inactive rows from the server (RLS), so
  // the filter is effectively a no-op for them. For admins, hide
  // archived rows unless they opt in.
  if (auth.isAdmin && !showArchived.value) {
    return announcements.value.filter((a) => a.active)
  }
  return announcements.value
})

/* Admins get a slim one-liner when nothing is posted (the + New button
   stays in reach without a big empty box); the dashboard hides the
   card entirely for crew in that state. */
const compact = computed(
  () => auth.isAdmin && visibleAnnouncements.value.length === 0 && !composing.value,
)

/* Image-size cap kept consistent with the training-recording thumbnail
   uploader. Most invitation flyers are ~1-3 MB; 5 MB gives headroom
   without letting someone drop a 50 MB PDF-rendered PNG into the bucket. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

function blankDraft(): Draft {
  return {
    id: null,
    tag: 'Operations',
    customTag: '',
    title: '',
    body: '',
    imageUrl: null,
    allowComments: false,
    notifyIds: [],
  }
}

/* ── Comment-notification recipients ──
   Roster for the "notify on comments" picker, loaded lazily the first
   time the compose form opens (same source as the spotlight picker:
   app_users directly, so ids resolve for the push). */
const roster = ref<Array<{ id: string; fullName: string }>>([])
let rosterLoaded = false
async function loadRoster() {
  if (rosterLoaded) return
  if (auth.usingDevStub) {
    /* Fixture roster so the picker flow is demoable offline. */
    rosterLoaded = true
    roster.value = [
      { id: 'dev-1', fullName: 'Benjamin Egert' },
      { id: 'dev-2', fullName: 'April Mancini' },
      { id: 'dev-3', fullName: 'Heather Fojt' },
    ]
    return
  }
  rosterLoaded = true
  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name')
    .eq('active', true)
    .eq('account_type', 'person')
    .order('full_name')
  if (error) {
    console.warn('[announcements] roster load failed:', error.message)
    rosterLoaded = false
    return
  }
  roster.value = (data ?? []).map((r: { id: string; full_name: string }) => ({
    id: r.id,
    fullName: r.full_name,
  }))
}

const notifyPicker = ref('')
function addNotifyPick() {
  const id = notifyPicker.value
  notifyPicker.value = ''
  if (id && !draft.value.notifyIds.includes(id)) {
    draft.value.notifyIds = [...draft.value.notifyIds, id]
  }
}
function removeNotify(id: string) {
  draft.value.notifyIds = draft.value.notifyIds.filter((x) => x !== id)
}
function notifyName(id: string): string {
  return roster.value.find((r) => r.id === id)?.fullName ?? 'Teammate'
}
const notifyOptions = computed(() =>
  roster.value.filter((r) => !draft.value.notifyIds.includes(r.id)),
)

/* ── Full-story view (spotlight pattern) ──
   Long bodies get a snippet in-card with a "Read the full story" link
   into the detail modal; announcements posted with comments allowed
   always get the link so the thread is reachable. Truncation decisions
   run on the plain-text form so a long markdown link doesn't count its
   URL against the limit (or get cut mid-syntax). */
const SNIPPET_LIMIT = 240

const detailId = ref<string | null>(null)
const detailAnnouncement = computed<Announcement | null>(
  () => announcements.value.find((a) => a.id === detailId.value) ?? null,
)

function plainBody(a: Announcement): string {
  return richTextToPlain(a.body)
}

function isTruncated(a: Announcement): boolean {
  return plainBody(a).length > SNIPPET_LIMIT
}

function snippetFor(a: Announcement): string {
  const plain = plainBody(a)
  if (plain.length <= SNIPPET_LIMIT) return plain
  const cut = plain.slice(0, SNIPPET_LIMIT)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > SNIPPET_LIMIT * 0.6 ? lastSpace : SNIPPET_LIMIT).trimEnd()}…`
}

/* ── Body formatting (composer) ──
   The body is stored as plain text with a tiny markdown subset
   (see lib/richtext.ts); these helpers drive the toolbar buttons by
   rewriting the textarea selection. */
const bodyEl = ref<HTMLTextAreaElement | null>(null)
const previewing = ref(false)
const linkOpen = ref(false)
const linkLabel = ref('')
const linkUrl = ref('')
const linkUrlEl = ref<HTMLInputElement | null>(null)
let linkRange: [number, number] = [0, 0]

function applyBodyEdit(next: string, selStart: number, selEnd: number) {
  draft.value.body = next
  void nextTick(() => {
    const el = bodyEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}

function surround(marker: string) {
  const el = bodyEl.value
  if (!el || previewing.value) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const body = draft.value.body
  const sel = body.slice(s, e)
  const before = body.slice(0, s)
  const after = body.slice(e)
  // Toggle: unwrap if the selection (or its surroundings) already carry
  // the marker, otherwise wrap.
  if (before.endsWith(marker) && after.startsWith(marker)) {
    applyBodyEdit(
      before.slice(0, -marker.length) + sel + after.slice(marker.length),
      s - marker.length,
      e - marker.length,
    )
    return
  }
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2) {
    const inner = sel.slice(marker.length, sel.length - marker.length)
    applyBodyEdit(before + inner + after, s, s + inner.length)
    return
  }
  applyBodyEdit(before + marker + sel + marker + after, s + marker.length, e + marker.length)
}

function bulletToggle() {
  const el = bodyEl.value
  if (!el || previewing.value) return
  const body = draft.value.body
  const lineStart = body.lastIndexOf('\n', el.selectionStart - 1) + 1
  let lineEnd = body.indexOf('\n', el.selectionEnd)
  if (lineEnd === -1) lineEnd = body.length
  const lines = body.slice(lineStart, lineEnd).split('\n')
  const allBulleted = lines.every((l) => !l.trim() || /^[-•]\s/.test(l))
  const next = lines
    .map((l) => {
      if (!l.trim()) return l
      if (allBulleted) return l.replace(/^[-•]\s+/, '')
      return /^[-•]\s/.test(l) ? l : `- ${l}`
    })
    .join('\n')
  applyBodyEdit(
    body.slice(0, lineStart) + next + body.slice(lineEnd),
    lineStart,
    lineStart + next.length,
  )
}

function openLinkForm() {
  previewing.value = false
  const el = bodyEl.value
  const s = el?.selectionStart ?? draft.value.body.length
  const e = el?.selectionEnd ?? draft.value.body.length
  linkRange = [s, e]
  linkLabel.value = draft.value.body.slice(s, e).trim().replace(/[[\]]/g, '')
  linkUrl.value = ''
  linkOpen.value = true
  void nextTick(() => linkUrlEl.value?.focus())
}

function insertLink() {
  let url = linkUrl.value.trim()
  if (!url) return
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('/')) url = `https://${url}`
  // Parens/spaces would terminate the [label](url) syntax early.
  url = url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')
  const label = linkLabel.value.trim().replace(/[[\]]/g, '')
  const snippet = label ? `[${label}](${url})` : url
  const [s, e] = linkRange
  const body = draft.value.body
  applyBodyEdit(
    body.slice(0, s) + snippet + body.slice(e),
    s + snippet.length,
    s + snippet.length,
  )
  linkOpen.value = false
}

function onBodyKeydown(ev: KeyboardEvent) {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return
  const k = ev.key.toLowerCase()
  if (k === 'b') {
    ev.preventDefault()
    surround('**')
  } else if (k === 'i') {
    ev.preventDefault()
    surround('*')
  } else if (k === 'k') {
    ev.preventDefault()
    openLinkForm()
  }
}

function togglePreview() {
  previewing.value = !previewing.value
  linkOpen.value = false
}

const previewHtml = computed(() => renderRichText(draft.value.body))

function storyLinkLabel(a: Announcement): string {
  if (isTruncated(a)) {
    return a.allowComments ? 'Read the full story & comment →' : 'Read the full story →'
  }
  return 'Leave a comment →'
}

function startCompose() {
  draft.value = blankDraft()
  composing.value = true
  composeError.value = null
  previewing.value = false
  linkOpen.value = false
  void loadRoster()
}

function startEdit(id: string) {
  const a = announcements.value.find((x) => x.id === id)
  if (!a) return
  const isPreset = (PRESET_CATEGORIES as readonly string[]).includes(a.tag)
  draft.value = {
    id: a.id,
    tag: isPreset ? a.tag : 'Other',
    customTag: isPreset ? '' : a.tag,
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl,
    allowComments: a.allowComments,
    notifyIds: [...a.commentNotifyUserIds],
  }
  composing.value = true
  composeError.value = null
  previewing.value = false
  linkOpen.value = false
  void loadRoster()
}

function cancelCompose() {
  composing.value = false
  composeError.value = null
  previewing.value = false
  linkOpen.value = false
}

async function onImagePicked(event: Event) {
  composeError.value = null
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    composeError.value = 'Please choose an image file.'
    input.value = ''
    return
  }
  if (file.size > IMAGE_MAX_BYTES) {
    composeError.value = 'Image is too large (max 5 MB).'
    input.value = ''
    return
  }
  uploadingImage.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const key = `${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('announcement-images')
      .upload(key, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('announcement-images').getPublicUrl(key)
    draft.value.imageUrl = data.publicUrl
  } catch (err) {
    composeError.value = `Image upload failed: ${(err as Error).message}`
  } finally {
    uploadingImage.value = false
    input.value = ''
  }
}

function clearDraftImage() {
  /* Just clears the reference on the draft. The uploaded file stays in
     the bucket as an orphan — tech debt; cleanup belongs in a separate
     storage-janitor job, not this user flow. */
  draft.value.imageUrl = null
}

async function submitDraft() {
  if (submitting.value) return
  if (!draft.value.title.trim()) {
    composeError.value = 'Headline is required.'
    return
  }
  const finalTag =
    draft.value.tag === 'Other'
      ? draft.value.customTag.trim() || 'Other'
      : draft.value.tag
  submitting.value = true
  composeError.value = null
  try {
    const payload = {
      tag: finalTag,
      title: draft.value.title.trim(),
      body: draft.value.body.trim(),
      imageUrl: draft.value.imageUrl,
      allowComments: draft.value.allowComments,
      commentNotifyUserIds: draft.value.allowComments ? draft.value.notifyIds : [],
    }
    if (draft.value.id) {
      await update({ id: draft.value.id, ...payload })
    } else {
      await publish(payload)
    }
    composing.value = false
    draft.value = blankDraft()
  } catch (err) {
    composeError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

async function removeAnnouncement(id: string, title: string) {
  if (!confirm(`Delete announcement "${title}"? This cannot be undone.`)) return
  try {
    await remove(id)
  } catch (err) {
    alert(`Delete failed: ${(err as Error).message}`)
  }
}

async function archiveAnnouncement(id: string) {
  // Reversible — no confirm dialog.
  try {
    await setArchived(id, true)
  } catch (err) {
    alert(`Archive failed: ${(err as Error).message}`)
  }
}

async function restoreAnnouncement(id: string) {
  try {
    await setArchived(id, false)
  } catch (err) {
    alert(`Restore failed: ${(err as Error).message}`)
  }
}

function openLightbox(url: string | null) {
  if (!url) return
  lightboxUrl.value = url
}
function closeLightbox() {
  lightboxUrl.value = null
}

const submitLabel = computed(() => {
  if (submitting.value) return 'Saving…'
  return draft.value.id ? 'Update' : 'Publish'
})
</script>

<template>
  <AppCard class="announcements-card" :class="{ 'announcements-card--compact': compact }">
    <div class="flex items-center justify-between flex-wrap gap-2" :class="compact ? 'mb-0' : 'mb-4'">
      <Eyebrow>Announcements</Eyebrow>
      <span class="announcements-card__head-actions">
        <button
          v-if="auth.isAdmin && archivedCount > 0 && !composing"
          type="button"
          class="announcements-card__archive-toggle"
          @click="showArchived = !showArchived"
        >
          {{ showArchived ? 'Hide archived' : `Show archived (${archivedCount})` }}
        </button>
        <button
          v-if="auth.isAdmin && !composing"
          class="announcements-card__new"
          @click="startCompose"
        >
          <Plus :size="11" :stroke-width="2" /> New
        </button>
      </span>
    </div>

    <!-- Compose / edit form (admin only) -->
    <form v-if="composing" class="announcements-card__compose" @submit.prevent="submitDraft">
      <input
        v-model="draft.title"
        type="text"
        placeholder="Headline"
        class="announcements-card__input"
        required
      />
      <select v-model="draft.tag" class="announcements-card__select">
        <option v-for="c in PRESET_CATEGORIES" :key="c">{{ c }}</option>
        <option>Other</option>
      </select>
      <input
        v-if="draft.tag === 'Other'"
        v-model="draft.customTag"
        type="text"
        placeholder="Custom category (e.g. CISM, Recall, Holiday)"
        class="announcements-card__input"
        maxlength="24"
      />
      <div class="announcements-card__bodywrap">
        <div class="announcements-card__fmtbar" role="toolbar" aria-label="Body formatting">
          <button
            type="button"
            class="announcements-card__fmtbtn"
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            @click="surround('**')"
          >
            <Bold :size="13" :stroke-width="2.5" />
          </button>
          <button
            type="button"
            class="announcements-card__fmtbtn"
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            @click="surround('*')"
          >
            <Italic :size="13" :stroke-width="2.25" />
          </button>
          <button
            type="button"
            class="announcements-card__fmtbtn"
            title="Insert link (Ctrl+K)"
            aria-label="Insert link"
            @click="openLinkForm"
          >
            <Link2 :size="13" :stroke-width="2.25" />
          </button>
          <button
            type="button"
            class="announcements-card__fmtbtn"
            title="Bulleted list"
            aria-label="Bulleted list"
            @click="bulletToggle"
          >
            <List :size="13" :stroke-width="2.25" />
          </button>
          <button
            type="button"
            class="announcements-card__fmtbtn announcements-card__fmtbtn--preview"
            :class="{ 'announcements-card__fmtbtn--on': previewing }"
            @click="togglePreview"
          >
            <Edit2 v-if="previewing" :size="12" :stroke-width="2.25" />
            <Eye v-else :size="13" :stroke-width="2.25" />
            {{ previewing ? 'Write' : 'Preview' }}
          </button>
        </div>
        <textarea
          v-show="!previewing"
          ref="bodyEl"
          v-model="draft.body"
          placeholder="Body (optional) — paste a link and it posts clickable"
          class="announcements-card__textarea"
          rows="4"
          @keydown="onBodyKeydown"
        />
        <div
          v-if="previewing"
          class="announcements-card__preview announcements-card__rich"
        >
          <div v-if="draft.body.trim()" v-html="previewHtml" />
          <span v-else class="announcements-card__preview-empty">Nothing to preview yet.</span>
        </div>
        <div v-if="linkOpen" class="announcements-card__linkpop">
          <input
            v-model="linkLabel"
            type="text"
            placeholder="Link text — what crews tap (e.g. Watch the video)"
            class="announcements-card__input"
            @keydown.enter.prevent="insertLink"
          />
          <input
            ref="linkUrlEl"
            v-model="linkUrl"
            type="url"
            placeholder="https://…"
            class="announcements-card__input"
            @keydown.enter.prevent="insertLink"
          />
          <div class="announcements-card__linkpop-actions">
            <button type="button" class="btn btn-ghost btn--sm" @click="linkOpen = false">
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn--sm"
              :disabled="!linkUrl.trim()"
              @click="insertLink"
            >
              Insert link
            </button>
          </div>
        </div>
        <p class="announcements-card__fmt-hint">
          **bold** · *italic* · “- ” starts a bullet · pasted links post clickable
        </p>
      </div>

      <label class="announcements-card__toggle">
        <input v-model="draft.allowComments" type="checkbox" />
        <span>
          Allow comments
          <span class="announcements-card__toggle-hint">
            — crew can reply on the full-story view
          </span>
        </span>
      </label>

      <!-- Who gets a push when a comment lands (e.g. the person the
           good news is about). Only meaningful with comments on. -->
      <div v-if="draft.allowComments && roster.length" class="announcements-card__notify">
        <span class="announcements-card__notify-label">Notify on new comments</span>
        <div v-if="draft.notifyIds.length" class="announcements-card__notify-chips">
          <span v-for="id in draft.notifyIds" :key="id" class="announcements-card__notify-chip">
            {{ notifyName(id) }}
            <button
              type="button"
              class="announcements-card__notify-chip-x"
              :aria-label="`Stop notifying ${notifyName(id)}`"
              @click="removeNotify(id)"
            >×</button>
          </span>
        </div>
        <select v-model="notifyPicker" class="announcements-card__select" @change="addNotifyPick">
          <option value="" disabled>
            {{ draft.notifyIds.length ? 'Add another person…' : 'Pick who gets notified…' }}
          </option>
          <option v-for="r in notifyOptions" :key="r.id" :value="r.id">{{ r.fullName }}</option>
        </select>
        <span class="announcements-card__toggle-hint">
          They'll get a push notification each time someone comments.
        </span>
      </div>

      <!-- Image picker — flyer / invitation / etc. -->
      <div class="announcements-card__image-block">
        <div v-if="draft.imageUrl" class="announcements-card__image-preview-wrap">
          <img
            :src="draft.imageUrl"
            class="announcements-card__image-preview"
            alt="Announcement image preview"
          />
          <button
            type="button"
            class="announcements-card__image-remove"
            aria-label="Remove image"
            @click="clearDraftImage"
          >
            <X :size="13" :stroke-width="2.25" />
          </button>
        </div>
        <label class="announcements-card__image-pick">
          <input
            type="file"
            accept="image/*"
            :disabled="uploadingImage"
            @change="onImagePicked"
          />
          <Upload :size="12" :stroke-width="2" />
          <span v-if="uploadingImage">Uploading…</span>
          <span v-else-if="draft.imageUrl">Replace image</span>
          <span v-else>Add image (optional)</span>
        </label>
      </div>

      <div v-if="composeError" class="announcements-card__error">{{ composeError }}</div>

      <div class="announcements-card__compose-actions">
        <button type="button" class="btn btn-ghost" @click="cancelCompose">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="submitting || uploadingImage">
          {{ submitLabel }}
        </button>
      </div>
    </form>

    <!-- Empty state. Crew never sees this (the dashboard hides the card
         for them when nothing is posted); admins get one quiet line. -->
    <p v-if="visibleAnnouncements.length === 0 && !composing" class="announcements-card__quiet">
      Nothing posted — crews won't see this section until you post.
    </p>

    <!-- List -->
    <div v-else-if="visibleAnnouncements.length > 0" class="space-y-3">
      <article
        v-for="(a, i) in visibleAnnouncements"
        :key="a.id"
        class="announcements-card__row"
        :class="{
          'announcements-card__row--last': i === visibleAnnouncements.length - 1,
          'announcements-card__row--archived': !a.active,
        }"
      >
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <AppChip variant="brand">{{ a.tag }}</AppChip>
          <span
            v-if="!a.active"
            class="announcements-card__archived-tag"
            aria-label="Archived"
          >
            Archived
          </span>
          <span class="font-mono text-[10.5px]" style="color: var(--color-muted)">
            {{ a.date }}
          </span>
          <span class="ml-auto flex items-center gap-2">
            <button
              v-if="auth.isAdmin"
              class="announcements-card__edit"
              aria-label="Edit"
              @click="startEdit(a.id)"
            >
              <Edit2 :size="11" />
            </button>
            <button
              v-if="auth.isAdmin && a.active"
              class="announcements-card__edit"
              aria-label="Archive"
              title="Archive"
              @click="archiveAnnouncement(a.id)"
            >
              <Archive :size="11" />
            </button>
            <button
              v-if="auth.isAdmin && !a.active"
              class="announcements-card__edit"
              aria-label="Restore"
              title="Restore"
              @click="restoreAnnouncement(a.id)"
            >
              <ArchiveRestore :size="11" />
            </button>
            <button
              v-if="auth.isAdmin"
              class="announcements-card__edit"
              aria-label="Delete"
              @click="removeAnnouncement(a.id, a.title)"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
        <h4 class="announcements-card__title display">{{ a.title }}</h4>
        <button
          v-if="a.imageUrl"
          type="button"
          class="announcements-card__image-btn"
          :aria-label="`Open ${a.title} image`"
          @click="openLightbox(a.imageUrl)"
        >
          <img
            :src="a.imageUrl"
            :alt="`${a.title} image`"
            class="announcements-card__image"
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        </button>
        <!-- Short bodies render rich in-card (links stay tappable even
             when no story link appears); truncated ones fall back to a
             plain snippet — the full-story modal carries the links. -->
        <div
          v-if="a.body && !isTruncated(a)"
          class="announcements-card__body announcements-card__rich"
          v-html="renderRichText(a.body)"
        />
        <p v-else-if="a.body" class="announcements-card__body">{{ snippetFor(a) }}</p>
        <button
          v-if="isTruncated(a) || a.allowComments"
          type="button"
          class="announcements-card__story-link"
          @click="detailId = a.id"
        >
          {{ storyLinkLabel(a) }}
        </button>
        <div class="announcements-card__by">— {{ a.authorName }}</div>
      </article>
    </div>

    <!-- Lightbox — full-size image overlay. Clicking the backdrop or
         the X closes; Esc handled by stopping at the overlay scope. -->
    <Teleport to="body">
      <div
        v-if="lightboxUrl"
        class="announcements-lightbox"
        role="dialog"
        aria-modal="true"
        @click="closeLightbox"
      >
        <button
          type="button"
          class="announcements-lightbox__close"
          aria-label="Close image"
          @click.stop="closeLightbox"
        >
          <X :size="20" />
        </button>
        <img
          :src="lightboxUrl"
          alt=""
          class="announcements-lightbox__img"
          referrerpolicy="no-referrer"
          @click.stop
        />
      </div>
    </Teleport>

    <!-- Full-story + comments modal (spotlight pattern). -->
    <AnnouncementDetailModal
      :announcement="detailAnnouncement"
      @close="detailId = null"
    />
  </AppCard>
</template>

<style scoped>
.announcements-card {
  padding: 20px;
}
.announcements-card__head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.announcements-card__new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.announcements-card__new:hover {
  background: var(--color-brand-100);
}
.announcements-card__archive-toggle {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.announcements-card__archive-toggle:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink-soft);
}

.announcements-card__row--archived {
  opacity: 0.6;
}
.announcements-card__archived-tag {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 1px 5px;
}

.announcements-card__compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  margin-bottom: 12px;
}
.announcements-card__input,
.announcements-card__select,
.announcements-card__textarea {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  width: 100%;
}
.announcements-card__input:focus,
.announcements-card__select:focus,
.announcements-card__textarea:focus {
  border-color: var(--color-brand-500);
}
.announcements-card__textarea {
  resize: vertical;
  font-family: var(--font-sans);
}

/* ── Body formatting toolbar ── */
.announcements-card__bodywrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.announcements-card__fmtbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.announcements-card__fmtbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 28px;
  min-height: 28px;
  padding: 4px 7px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  cursor: pointer;
  transition:
    border-color 120ms var(--ease-out),
    color 120ms var(--ease-out),
    background 120ms var(--ease-out);
}
.announcements-card__fmtbtn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.announcements-card__fmtbtn--preview {
  margin-left: auto;
}
.announcements-card__fmtbtn--on {
  background: var(--color-brand-50);
  border-color: var(--color-brand-200);
  color: var(--color-brand-700);
}
.announcements-card__preview {
  min-height: 96px;
  padding: 10px 12px;
  border: 1px dashed var(--color-line);
  border-radius: 6px;
  background: var(--color-surface);
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.55;
}
.announcements-card__preview-empty {
  font-size: 12px;
  color: var(--color-muted-soft);
}
.announcements-card__linkpop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}
.announcements-card__linkpop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.announcements-card__fmt-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.01em;
  color: var(--color-muted-soft);
}

/* Rendered rich bodies (card + composer preview). Generated markup is
   limited to p / br / ul / li / strong / em / a.rt-link. */
.announcements-card__rich :deep(p) {
  margin: 0;
}
.announcements-card__rich :deep(p + p),
.announcements-card__rich :deep(p + ul),
.announcements-card__rich :deep(ul + p),
.announcements-card__rich :deep(ul + ul) {
  margin-top: 8px;
}
.announcements-card__rich :deep(ul) {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
}
.announcements-card__rich :deep(li) {
  margin: 2px 0;
}
.announcements-card__rich :deep(li)::marker {
  color: var(--color-accent-600);
}
.announcements-card__rich :deep(strong) {
  color: var(--color-ink);
  font-weight: 650;
}
.announcements-card__rich :deep(a.rt-link) {
  color: var(--color-brand-600);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: var(--color-accent-500);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
  transition: color 120ms var(--ease-out);
}
.announcements-card__rich :deep(a.rt-link:hover) {
  color: var(--color-brand-800);
  text-decoration-color: var(--color-accent-600);
}

.announcements-card__image-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.announcements-card__image-preview-wrap {
  position: relative;
  width: 100%;
  max-height: 200px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
}
.announcements-card__image-preview {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  background: var(--color-surface-sunk);
}
.announcements-card__image-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0 0 0 / 0.6);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
}
.announcements-card__image-pick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.announcements-card__image-pick:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.announcements-card__image-pick input {
  display: none;
}

.announcements-card__error {
  font-size: 12px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 6px;
  padding: 7px 10px;
}

.announcements-card__compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.announcements-card--compact {
  padding: 14px 18px;
}
.announcements-card__quiet {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted-soft);
}

.announcements-card__row {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line);
}
.announcements-card__row--last {
  padding-bottom: 0;
  border-bottom: none;
}
.announcements-card__title {
  font-size: 16px;
  line-height: 1.25;
  font-weight: 700;
  color: var(--color-ink);
  margin-top: 4px;
}
.announcements-card__body {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.announcements-card__by {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
}
.announcements-card__story-link {
  display: inline-block;
  margin-top: 6px;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-600);
  transition: color 120ms var(--ease-out);
}
.announcements-card__story-link:hover {
  color: var(--color-brand-700);
  text-decoration: underline;
}
.announcements-card__toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  user-select: none;
}
.announcements-card__toggle input {
  accent-color: var(--color-brand-600);
  width: 15px;
  height: 15px;
  cursor: pointer;
}
.announcements-card__toggle-hint {
  font-weight: 400;
  color: var(--color-muted);
}
.announcements-card__notify {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px dashed var(--color-line);
}
.announcements-card__notify-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.announcements-card__notify-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.announcements-card__notify-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border-radius: 999px;
  padding: 3px 6px 3px 10px;
}
.announcements-card__notify-chip-x {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: var(--color-brand-600);
  padding: 0 3px;
}
.announcements-card__notify-chip-x:hover {
  color: var(--color-brand-800);
}
.announcements-card__edit {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px 4px;
  border-radius: 4px;
}
.announcements-card__edit:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

/* Attached image — tap to open full-size in the lightbox. Constrained
   in-card so a tall invitation flyer doesn't dominate the dashboard. */
.announcements-card__image-btn {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color 120ms var(--ease-out);
}
.announcements-card__image-btn:hover {
  border-color: var(--color-muted-soft);
}
.announcements-card__image {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  background: var(--color-surface-sunk);
}

/* Lightbox overlay (teleported to body so it escapes the dashboard's
   grid). z-index 80 matches the modal range so we're above the dock
   and quick-link panel but below the global search overlay (90). */
.announcements-lightbox {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.85);
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  cursor: zoom-out;
  -webkit-tap-highlight-color: transparent;
}
.announcements-lightbox__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.15);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transition: background 120ms var(--ease-out);
}
.announcements-lightbox__close:hover {
  background: oklch(1 0 0 / 0.25);
}
.announcements-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  cursor: default;
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}

/* Standard button styles shared with other cards. */
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
.btn--sm {
  padding: 5px 10px;
  font-size: 12px;
}
</style>
