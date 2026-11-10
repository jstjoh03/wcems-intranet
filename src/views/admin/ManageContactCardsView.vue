<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Contact, Copy, Download, ExternalLink, Plus, QrCode, Upload, X } from 'lucide-vue-next'
import QRCode from 'qrcode'
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
/**
 * Every upload goes through the canvas: max 800px, JPEG. Phones only
 * get the photo if it rides INSIDE the vCard, and the vCard skips
 * photos past ~900KB — a raw 1.7MB roster PNG is exactly how the saved
 * contact lost its picture.
 */
async function compressPhoto(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
  const MAX = 800
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image in this browser.')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo.'))), 'image/jpeg', 0.85),
  )
}
async function onPhoto(c: CardRow, ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  if (f.size > 12 * 1024 * 1024) {
    err.value = 'Photo too large — keep it under 12 MB.'
    return
  }
  busy.value = true
  err.value = null
  try {
    const blob = await compressPhoto(f)
    const path = `${c.userId}-${Date.now()}.jpg`
    const up = await supabase.storage
      .from('contact-cards')
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
    if (up.error) throw new Error(up.error.message)
    if (c.photoPath) await supabase.storage.from('contact-cards').remove([c.photoPath])
    const { error } = await supabase
      .from('contact_cards')
      .update({ photo_path: path, updated_at: new Date().toISOString() })
      .eq('user_id', c.userId)
    if (error) throw new Error(error.message)
    input.value = ''
    await load()
  } catch (e) {
    err.value = (e as Error).message
  }
  busy.value = false
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
  <div class="mcc">
    <!-- Navy lit-surface band, same treatment as the portal home hero -->
    <header class="mcc__hero">
      <div class="mcc__heromain">
        <div class="mcc__eyebrow">Admin · Business cards</div>
        <h1 class="display mcc__title">Digital contact cards</h1>
        <p class="mcc__sub">
          Each card is a public page + live vCard at <code>…/card/&lt;slug&gt;</code>. Enter the
          person's info, drop their QR into the Canva design, and send it to print — info changes
          later update the page, never the printed code.
        </p>
      </div>
      <div class="mcc__heromark" aria-hidden="true"><QrCode :size="64" :stroke-width="1.1" /></div>
      <div class="mcc__goldseam" aria-hidden="true"></div>
    </header>

    <p v-if="err" class="mcc__err">{{ err }}</p>
    <p v-if="auth.usingDevStub" class="mcc__quiet">Not available in the dev preview.</p>

    <template v-if="!auth.usingDevStub && ready">
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
          <button type="button" class="mcc__qrbtn" title="QR as SVG (best for print)" @click="downloadQrSvg(c)">
            <Download :size="12" /> QR · SVG
          </button>
          <button type="button" class="mcc__qrbtn" title="QR as PNG 2048px" @click="downloadQrPng(c)">
            <Download :size="12" /> QR · PNG
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
            <span class="mcc__hint">Photos are resized automatically so they save into the contact.</span>
            <button v-if="c.photoPath" type="button" class="mcc__mini" @click="removePhoto(c)"><X :size="12" /> Remove photo</button>
            <span style="flex: 1"></span>
            <button type="button" class="mcc__mini mcc__mini--danger" @click="removeCard(c)">
              {{ armedDelete === c.userId ? 'Confirm delete' : 'Delete card' }}
            </button>
            <button type="button" class="mcc__btn" :disabled="busy" @click="saveEdit">Save</button>
          </div>
        </div>
      </div>

      <p v-if="cards.length === 0" class="mcc__quiet" style="padding: 10px 2px">No cards yet — add the first one above.</p>

      <div class="mcc__footnote"><Contact :size="12" :stroke-width="2" /> Printed QRs point at the URL, not the data — edit anyone's card anytime and every card already in circulation picks it up.</div>
    </template>
  </div>
</template>

<style scoped>
.mcc { padding-bottom: 48px; max-width: 920px; }

/* ── Hero band: the home page's lit-surface navy + gold seam ── */
.mcc__hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 16px 0 20px;
  padding: 26px 26px 24px;
  border-radius: 12px;
  overflow: hidden;
  background:
    radial-gradient(ellipse 90% 70% at 15% 0%, oklch(0.4 0.13 250 / 0.55), transparent 60%),
    radial-gradient(ellipse 70% 60% at 85% 100%, oklch(0.32 0.12 250 / 0.5), transparent 60%),
    radial-gradient(ellipse 50% 45% at 70% 20%, oklch(0.45 0.12 250 / 0.28), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  box-shadow: 0 10px 30px oklch(0.18 0.05 255 / 0.25), inset 0 1px 0 oklch(1 0 0 / 0.07);
}
.mcc__heromain { flex: 1; min-width: 0; }
.mcc__eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-accent-on-dark); opacity: 0.9; margin-bottom: 4px;
}
.mcc__title { font-size: 27px; color: #fff; margin: 0 0 7px; }
.mcc__sub { font-size: 13px; line-height: 1.55; color: oklch(0.88 0.02 250); max-width: 560px; }
.mcc__sub code { font-size: 12px; color: var(--color-accent-on-dark); background: oklch(1 0 0 / 0.08); padding: 1px 5px; border-radius: 4px; }
.mcc__heromark { color: oklch(1 0 0 / 0.16); flex: none; padding-right: 6px; }
.mcc__goldseam {
  position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
  background: linear-gradient(90deg, var(--color-accent-700, #a8842c), var(--color-accent-500, #d9b45b) 45%, oklch(0.78 0.11 85 / 0.35));
}
@media (max-width: 560px) {
  .mcc__heromark { display: none; }
}

.mcc__err { font-size: 13px; color: var(--color-danger-600, oklch(0.5 0.19 27)); margin: 8px 0; }
.mcc__quiet { font-size: 13px; color: var(--color-muted); }

.mcc__addrow { display: flex; gap: 8px; padding-bottom: 14px; flex-wrap: wrap; }

/* ── Person rows: surface cards with a gold hover accent ── */
.mcc__row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; margin-bottom: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-line);
  border-radius: 8px;
  flex-wrap: wrap;
  transition: border-color 140ms var(--ease-out, ease), box-shadow 140ms var(--ease-out, ease);
}
.mcc__row:hover { border-left-color: var(--color-accent-strong, #a8842c); box-shadow: 0 3px 14px oklch(0.3 0.05 255 / 0.08); }
.mcc__row--off { opacity: 0.6; }
.mcc__thumb { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid var(--color-accent-500, #d9b45b); flex: none; }
.mcc__thumb--empty {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, var(--color-brand-700), var(--color-brand-900));
  color: var(--color-accent-on-dark); font-weight: 700; font-size: 16px;
  border-color: var(--color-line);
}
.mcc__main { flex: 1; min-width: 200px; }
.mcc__name { font-weight: 650; font-size: 14.5px; display: flex; align-items: center; gap: 8px; color: var(--color-ink); }
.mcc__offpill { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-muted); border: 1px solid var(--color-line); border-radius: 4px; padding: 1px 6px; }
.mcc__meta { font-size: 12px; color: var(--color-muted); overflow-wrap: anywhere; }
.mcc__lnk { color: var(--color-brand-700); text-decoration: none; display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }
.mcc__lnk:hover { text-decoration: underline; text-underline-offset: 3px; }

.mcc__actions { display: flex; gap: 6px; flex-wrap: wrap; }
/* The QR downloads are THE job of this page — navy primaries */
.mcc__qrbtn {
  display: inline-flex; align-items: center; gap: 5px;
  font: inherit; font-size: 11.5px; font-weight: 650; letter-spacing: 0.01em;
  padding: 5px 11px; border: 0; border-radius: 6px; cursor: pointer; white-space: nowrap;
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  color: #fff;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.12);
}
.mcc__qrbtn:hover { background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-900)); color: var(--color-accent-on-dark); }
.mcc__mini { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink-soft); cursor: pointer; white-space: nowrap; }
.mcc__mini:hover { border-color: var(--color-accent-strong, #a8842c); color: var(--color-ink); }
.mcc__mini--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.mcc__btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 13px; border: 0; border-radius: 6px; background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)); color: #fff; cursor: pointer; }
.mcc__btn:disabled { opacity: 0.55; cursor: default; }
.mcc__input { font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-surface); color: var(--color-ink); min-width: 160px; }

.mcc__edit { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 0 4px; border-top: 1px dashed var(--color-accent-500, #d9b45b); margin-top: 8px; }
.mcc__fld { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a6d2f; }
.mcc__fld--wide { flex: 1 1 100%; }
.mcc__check { display: flex; align-items: center; gap: 6px; font-size: 13px; align-self: end; padding-bottom: 6px; }
.mcc__editrow { flex-basis: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mcc__upload { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-brand-700); border: 1px dashed var(--color-line); border-radius: 6px; padding: 6px 11px; cursor: pointer; }
.mcc__upload:hover { border-color: var(--color-accent-strong, #a8842c); }
.mcc__hint { font-size: 11px; color: var(--color-muted); }

.mcc__footnote { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--color-muted); margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-line); }
</style>
