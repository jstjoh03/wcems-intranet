<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Contact, Copy, Download, ExternalLink, Plus, Upload, X } from 'lucide-vue-next'
import QRCode from 'qrcode'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Digital business cards — badge-maker style: admins enter each
 * person's card info (title lines, phones, optional photo), the system
 * serves the public page + live vCard at /card/<slug>, and this page
 * hands out the print-ready QR files (SVG + PNG, brand navy) for the
 * Canva card design. Changing info later changes the page/vCard only —
 * printed QRs never go stale.
 */

const auth = useAuthStore()
const CARD_BASE = 'https://employee.wallercountyems.com/card/'
const QR_NAVY = '#16233f'

interface Person {
  id: string
  name: string
  title: string | null
  phone: string | null
}
interface CardRow {
  userId: string
  slug: string
  active: boolean
  titleOverride: string | null
  showCell: boolean
  cellOverride: string | null
  showOffice: boolean
  blurb: string | null
  photoPath: string | null
}

const people = ref<Person[]>([])
const cards = ref<CardRow[]>([])
const ready = ref(false)
const err = ref<string | null>(null)
const busy = ref(false)

const personById = computed(() => new Map(people.value.map((p) => [p.id, p])))
const cardless = computed(() => people.value.filter((p) => !cards.value.some((c) => c.userId === p.id)))

async function load() {
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const [uRes, cRes] = await Promise.all([
    supabase
      .from('app_users')
      .select('id, full_name, title, phone')
      .eq('active', true)
      .eq('account_type', 'person')
      .order('full_name'),
    supabase
      .from('contact_cards')
      .select('user_id, slug, active, title_override, show_cell, cell_override, show_office, blurb, photo_path'),
  ])
  people.value = (uRes.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.full_name as string,
    title: (r.title as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
  }))
  cards.value = ((cRes.data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      userId: String(r.user_id),
      slug: String(r.slug),
      active: r.active !== false,
      titleOverride: (r.title_override as string | null) ?? null,
      showCell: r.show_cell !== false,
      cellOverride: (r.cell_override as string | null) ?? null,
      showOffice: r.show_office !== false,
      blurb: (r.blurb as string | null) ?? null,
      photoPath: (r.photo_path as string | null) ?? null,
    }))
    .sort((a, b) => (personById.value.get(a.userId)?.name ?? '').localeCompare(personById.value.get(b.userId)?.name ?? ''))
  ready.value = true
}
onMounted(load)

/* ── create ────────────────────────────────────────────────────────── */
const newPersonId = ref('')
function suggestSlug(name: string): string {
  const parts = name.toLowerCase().replace(/[^a-z\s-]/g, '').split(/\s+/).filter(Boolean)
  let slug = parts[0] ?? 'card'
  if (cards.value.some((c) => c.slug === slug) && parts.length > 1) slug = `${parts[0]}-${parts[parts.length - 1][0]}`
  let i = 2
  let out = slug
  while (cards.value.some((c) => c.slug === out)) out = `${slug}${i++}`
  return out
}
async function createCard() {
  const p = personById.value.get(newPersonId.value)
  if (!p || busy.value) return
  busy.value = true
  err.value = null
  const { error } = await supabase.from('contact_cards').insert({ user_id: p.id, slug: suggestSlug(p.name) })
  busy.value = false
  if (error) {
    err.value = error.message
    return
  }
  newPersonId.value = ''
  await load()
}

/* ── edit ──────────────────────────────────────────────────────────── */
const editingId = ref<string | null>(null)
const draft = ref<CardRow | null>(null)
function startEdit(c: CardRow) {
  editingId.value = c.userId
  draft.value = { ...c }
}
async function saveEdit() {
  if (!draft.value || busy.value) return
  const d = draft.value
  const slug = d.slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '')
  if (slug.length < 2) {
    err.value = 'Slug needs at least 2 characters (a–z, 0–9, dashes).'
    return
  }
  busy.value = true
  err.value = null
  const { error } = await supabase
    .from('contact_cards')
    .update({
      slug,
      active: d.active,
      title_override: d.titleOverride?.trim() || null,
      show_cell: d.showCell,
      cell_override: d.cellOverride?.trim() || null,
      show_office: d.showOffice,
      blurb: d.blurb?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', d.userId)
  busy.value = false
  if (error) {
    err.value = error.message
    return
  }
  editingId.value = null
  draft.value = null
  await load()
}
const armedDelete = ref<string | null>(null)
async function removeCard(c: CardRow) {
  if (armedDelete.value !== c.userId) {
    armedDelete.value = c.userId
    return
  }
  armedDelete.value = null
  const { error } = await supabase.from('contact_cards').delete().eq('user_id', c.userId)
  if (error) {
    err.value = error.message
    return
  }
  await load()
}

/* ── photo ─────────────────────────────────────────────────────────── */
async function onPhoto(c: CardRow, ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (f.size > 4 * 1024 * 1024) {
    err.value = 'Photo too large — keep it under 4 MB.'
    return
  }
  busy.value = true
  err.value = null
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${c.userId}-${Date.now()}.${ext}`
  const up = await supabase.storage.from('contact-cards').upload(path, f, { upsert: false })
  if (up.error) {
    busy.value = false
    err.value = up.error.message
    return
  }
  if (c.photoPath) await supabase.storage.from('contact-cards').remove([c.photoPath])
  const { error } = await supabase
    .from('contact_cards')
    .update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq('user_id', c.userId)
  busy.value = false
  if (error) {
    err.value = error.message
    return
  }
  ;(ev.target as HTMLInputElement).value = ''
  await load()
}
async function removePhoto(c: CardRow) {
  if (!c.photoPath) return
  await supabase.storage.from('contact-cards').remove([c.photoPath])
  await supabase.from('contact_cards').update({ photo_path: null, updated_at: new Date().toISOString() }).eq('user_id', c.userId)
  await load()
}
function photoUrl(c: CardRow): string | null {
  return c.photoPath
    ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/contact-cards/${c.photoPath}`
    : null
}

/* ── QR downloads ──────────────────────────────────────────────────── */
function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
async function downloadQrSvg(c: CardRow) {
  const svg = await QRCode.toString(CARD_BASE + c.slug, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    color: { dark: QR_NAVY, light: '#0000' },
  })
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `WCEMS-card-QR-${c.slug}.svg`)
}
async function downloadQrPng(c: CardRow) {
  const dataUrl = await QRCode.toDataURL(CARD_BASE + c.slug, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 2048,
    color: { dark: QR_NAVY, light: '#00000000' },
  })
  const blob = await (await fetch(dataUrl)).blob()
  saveBlob(blob, `WCEMS-card-QR-${c.slug}.png`)
}
const copied = ref<string | null>(null)
async function copyUrl(c: CardRow) {
  try {
    await navigator.clipboard.writeText(CARD_BASE + c.slug)
    copied.value = c.userId
    setTimeout(() => (copied.value = null), 2000)
  } catch {
    err.value = 'Copy failed — the URL is ' + CARD_BASE + c.slug
  }
}
</script>

<template>
  <div class="mcc page-wrap">
    <header class="mcc__head">
      <div>
        <Eyebrow>Admin · Business cards</Eyebrow>
        <h1 class="display mcc__title"><Contact :size="22" :stroke-width="1.9" /> Digital contact cards</h1>
        <p class="mcc__sub">
          Each card is a public page + live vCard at <code>…/card/&lt;slug&gt;</code>. Enter the
          person's info, drop their QR into the Canva design, and send it to print — info changes
          later update the page, never the printed code.
        </p>
      </div>
    </header>

    <p v-if="err" class="mcc__err">{{ err }}</p>
    <p v-if="auth.usingDevStub" class="mcc__sub">Not available in the dev preview.</p>

    <AppCard v-if="!auth.usingDevStub && ready" class="mcc__card">
      <div class="mcc__addrow">
        <select v-model="newPersonId" class="mcc__input">
          <option value="">Add a card for…</option>
          <option v-for="p in cardless" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button type="button" class="mcc__btn" :disabled="!newPersonId || busy" @click="createCard">
          <Plus :size="14" /> Create card
        </button>
      </div>

      <div v-for="c in cards" :key="c.userId" class="mcc__row" :class="{ 'mcc__row--off': !c.active }">
        <img v-if="photoUrl(c)" class="mcc__thumb" :src="photoUrl(c)!" alt="" />
        <div v-else class="mcc__thumb mcc__thumb--empty">{{ (personById.get(c.userId)?.name ?? '?').slice(0, 1) }}</div>

        <div class="mcc__main">
          <div class="mcc__name">
            {{ personById.get(c.userId)?.name ?? '—' }}
            <span v-if="!c.active" class="mcc__offpill">inactive</span>
          </div>
          <div class="mcc__meta">
            <a :href="CARD_BASE + c.slug" target="_blank" rel="noopener" class="mcc__lnk">/card/{{ c.slug }} <ExternalLink :size="11" /></a>
            · {{ c.titleOverride || personById.get(c.userId)?.title || 'roster title' }}
          </div>
        </div>

        <div class="mcc__actions">
          <button type="button" class="mcc__mini" title="QR as SVG (best for print)" @click="downloadQrSvg(c)">
            <Download :size="12" /> SVG
          </button>
          <button type="button" class="mcc__mini" title="QR as PNG 2048px" @click="downloadQrPng(c)">
            <Download :size="12" /> PNG
          </button>
          <button type="button" class="mcc__mini" @click="copyUrl(c)">
            <Copy :size="12" /> {{ copied === c.userId ? 'Copied' : 'URL' }}
          </button>
          <button type="button" class="mcc__mini" @click="editingId === c.userId ? (editingId = null) : startEdit(c)">
            {{ editingId === c.userId ? 'Close' : 'Edit' }}
          </button>
        </div>

        <div v-if="editingId === c.userId && draft" class="mcc__edit">
          <label class="mcc__fld"><span>Slug (the URL)</span><input v-model="draft.slug" type="text" class="mcc__input" /></label>
          <label class="mcc__fld mcc__fld--wide">
            <span>Title lines — use | to stack (blank = roster title)</span>
            <input v-model="draft.titleOverride" type="text" class="mcc__input" :placeholder="personById.get(c.userId)?.title ?? ''" />
          </label>
          <label class="mcc__check"><input v-model="draft.showCell" type="checkbox" /> Show cell</label>
          <label class="mcc__fld"><span>Cell (blank = roster)</span>
            <input v-model="draft.cellOverride" type="text" class="mcc__input" :placeholder="personById.get(c.userId)?.phone ?? ''" :disabled="!draft.showCell" />
          </label>
          <label class="mcc__check"><input v-model="draft.showOffice" type="checkbox" /> Show office line</label>
          <label class="mcc__fld mcc__fld--wide"><span>Blurb (optional, one sentence)</span>
            <input v-model="draft.blurb" type="text" class="mcc__input" maxlength="140" />
          </label>
          <label class="mcc__check"><input v-model="draft.active" type="checkbox" /> Card active</label>
          <div class="mcc__editrow">
            <label class="mcc__upload"><Upload :size="12" /> {{ c.photoPath ? 'Replace photo' : 'Add photo' }}
              <input type="file" accept="image/*" hidden @change="onPhoto(c, $event)" />
            </label>
            <button v-if="c.photoPath" type="button" class="mcc__mini" @click="removePhoto(c)"><X :size="12" /> Remove photo</button>
            <span style="flex: 1"></span>
            <button type="button" class="mcc__mini mcc__mini--danger" @click="removeCard(c)">
              {{ armedDelete === c.userId ? 'Confirm delete' : 'Delete card' }}
            </button>
            <button type="button" class="mcc__btn" :disabled="busy" @click="saveEdit">Save</button>
          </div>
        </div>
      </div>

      <p v-if="cards.length === 0" class="mcc__sub" style="padding: 10px 2px">No cards yet — add the first one above.</p>
    </AppCard>
  </div>
</template>

<style scoped>
.mcc__head { margin: 18px 0 14px; }
.mcc__title { display: flex; align-items: center; gap: 9px; font-size: 26px; margin: 4px 0 6px; }
.mcc__sub { font-size: 13.5px; color: var(--color-muted); max-width: 640px; }
.mcc__sub code { font-size: 12px; }
.mcc__err { font-size: 13px; color: var(--color-danger-600, oklch(0.5 0.19 27)); margin: 8px 0; }
.mcc__card { padding: 14px 16px; }
.mcc__addrow { display: flex; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--color-line); flex-wrap: wrap; }
.mcc__row { display: flex; align-items: center; gap: 12px; padding: 11px 2px; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); flex-wrap: wrap; }
.mcc__row--off { opacity: 0.6; }
.mcc__thumb { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid var(--color-line); flex: none; }
.mcc__thumb--empty { display: flex; align-items: center; justify-content: center; background: var(--color-canvas); color: var(--color-muted); font-weight: 700; }
.mcc__main { flex: 1; min-width: 200px; }
.mcc__name { font-weight: 650; font-size: 14.5px; display: flex; align-items: center; gap: 8px; }
.mcc__offpill { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-muted); border: 1px solid var(--color-line); border-radius: 4px; padding: 1px 6px; }
.mcc__meta { font-size: 12px; color: var(--color-muted); overflow-wrap: anywhere; }
.mcc__lnk { color: var(--color-brand-700); text-decoration: none; display: inline-flex; align-items: center; gap: 3px; }
.mcc__actions { display: flex; gap: 6px; flex-wrap: wrap; }
.mcc__mini { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink-soft); cursor: pointer; white-space: nowrap; }
.mcc__mini--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.mcc__btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 13px; border: 0; border-radius: 6px; background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)); color: #fff; cursor: pointer; }
.mcc__btn:disabled { opacity: 0.55; cursor: default; }
.mcc__input { font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-surface); color: var(--color-ink); min-width: 160px; }
.mcc__edit { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 0 4px; border-top: 1px dashed var(--color-line); margin-top: 6px; }
.mcc__fld { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-muted); }
.mcc__fld--wide { flex: 1 1 100%; }
.mcc__check { display: flex; align-items: center; gap: 6px; font-size: 13px; align-self: end; padding-bottom: 6px; }
.mcc__editrow { flex-basis: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcc__upload { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-brand-700); border: 1px dashed var(--color-line); border-radius: 6px; padding: 6px 11px; cursor: pointer; }
</style>
