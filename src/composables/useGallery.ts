import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * "Around the County" photo gallery.
 *
 * Real-session: backed by `gallery_photos` table + `gallery-photos`
 * public Storage bucket. Public bucket so the dashboard doesn't pay a
 * per-tile signed-URL round-trip — gallery photos are intentionally
 * community-facing.
 *
 * Dev-stub: localStorage with base64 data URLs so admins can preview
 * uploads without a real session. Capped tight because base64 in
 * localStorage chews quota fast.
 *
 * Photos are ordered by `sort_order ASC, uploaded_at DESC` so admins
 * can pin a featured photo by giving it a lower sort_order (future
 * UI; for now everything is sort_order = 0 and newest floats up).
 */

/**
 * Predefined tag preset list. The DB column is just `text`, so admins
 * can also enter a custom tag via the "Other" path in the upload modal
 * — the type is `string` everywhere downstream.
 */
export const GALLERY_TAGS = [
  'WCEMS',
  'Outreach',
  'Stations',
  'Training',
  'Crew',
] as const

export interface GalleryPhoto {
  id: string
  caption: string
  tag: string
  /** Resolved URL — public URL in real session, base64 data URL in dev stub */
  imageUrl: string
  /** Storage path in `gallery-photos` bucket — null in dev stub */
  imagePath: string | null
  uploadedAt: string
  uploadedBy: string | null
}

const STORAGE_KEY = 'wcems:gallery:photos'
const MAX_DEV_FILE_BYTES = 2 * 1024 * 1024 /* 2 MB pre-encode per photo (localStorage budget) */
const MAX_REAL_FILE_BYTES = 8 * 1024 * 1024 /* 8 MB upload cap */
const BUCKET = 'gallery-photos'

interface GalleryRow {
  id: string
  caption: string
  tag: string
  image_path: string
  sort_order: number
  uploaded_at: string
  uploaded_by: string | null
}

const photos = ref<GalleryPhoto[]>([])
const ready = ref(false)
let loadStarted = false

function publicUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? ''
}

function rowToPhoto(r: GalleryRow): GalleryPhoto {
  return {
    id: r.id,
    caption: r.caption ?? '',
    tag: (r.tag ?? '').trim() || 'WCEMS',
    imageUrl: publicUrl(r.image_path),
    imagePath: r.image_path,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by,
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) photos.value = JSON.parse(raw) as GalleryPhoto[]
      } catch {
        /* ignore */
      }
    }
    ready.value = true
    return
  }

  /* Clean up any legacy dev key once we're on a real session. */
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)

  const { data, error } = await supabase
    .from('gallery_photos')
    .select('id, caption, tag, image_path, sort_order, uploaded_at, uploaded_by')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('uploaded_at', { ascending: false })
  if (error) {
    console.error('[gallery] failed to load:', error.message)
    ready.value = true
    return
  }
  photos.value = (data ?? []).map((r) => rowToPhoto(r as GalleryRow))
  ready.value = true
}

function persistDevStub() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(photos.value))
  } catch {
    /* quota — caller validated per-file size */
  }
}

export function useGallery() {
  void load()

  async function upload(input: {
    caption: string
    tag: string
    file: File
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const caption = input.caption.trim()
    const tag = input.tag.trim() || 'WCEMS'
    if (!input.file) return { ok: false, error: 'Pick a photo to upload.' }

    const auth = useAuthStore()

    if (auth.usingDevStub) {
      if (input.file.size > MAX_DEV_FILE_BYTES) {
        return {
          ok: false,
          error: `Dev mode caps photos at 2 MB; you picked ${(
            input.file.size /
            1024 /
            1024
          ).toFixed(1)} MB. Sign in for real to upload up to 8 MB.`,
        }
      }
      let dataUrl: string
      try {
        dataUrl = await readAsDataUrl(input.file)
      } catch {
        return { ok: false, error: 'Could not read that file. Try again?' }
      }
      const next: GalleryPhoto = {
        id: `dev-${crypto.randomUUID()}`,
        caption,
        tag,
        imageUrl: dataUrl,
        imagePath: null,
        uploadedAt: new Date().toISOString(),
        uploadedBy: auth.appUser?.id ?? null,
      }
      photos.value = [next, ...photos.value]
      persistDevStub()
      return { ok: true }
    }

    /* Real session — upload to Storage, then INSERT row. */
    if (input.file.size > MAX_REAL_FILE_BYTES) {
      return {
        ok: false,
        error: `Photo is ${(input.file.size / 1024 / 1024).toFixed(
          1,
        )} MB; the upload cap is 8 MB. Resize or compress the image.`,
      }
    }
    const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${crypto.randomUUID()}/${safeName}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, input.file, {
        upsert: false,
        contentType: input.file.type || 'image/jpeg',
      })
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }

    const { data: inserted, error: insErr } = await supabase
      .from('gallery_photos')
      .insert({
        caption,
        tag,
        image_path: path,
        uploaded_by: auth.appUser?.id ?? null,
      })
      .select('id, caption, tag, image_path, sort_order, uploaded_at, uploaded_by')
      .single()
    if (insErr) {
      /* Best-effort cleanup so we don't orphan the object. */
      await supabase.storage.from(BUCKET).remove([path])
      return { ok: false, error: `Save failed: ${insErr.message}` }
    }

    photos.value = [rowToPhoto(inserted as GalleryRow), ...photos.value]
    return { ok: true }
  }

  async function remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = useAuthStore()
    const target = photos.value.find((p) => p.id === id)
    if (!target) return { ok: false, error: 'Photo not found.' }

    if (auth.usingDevStub) {
      photos.value = photos.value.filter((p) => p.id !== id)
      persistDevStub()
      return { ok: true }
    }

    const { error: delErr } = await supabase
      .from('gallery_photos')
      .delete()
      .eq('id', id)
    if (delErr) return { ok: false, error: `Delete failed: ${delErr.message}` }

    if (target.imagePath) {
      /* Best-effort Storage cleanup — if it fails we still want the row
         gone from the gallery, an orphaned object is harmless. */
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([target.imagePath])
      if (rmErr) console.warn('[gallery] storage cleanup failed:', rmErr.message)
    }

    photos.value = photos.value.filter((p) => p.id !== id)
    return { ok: true }
  }

  return { photos, ready, upload, remove }
}
