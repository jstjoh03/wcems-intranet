import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Currently-published monthly newsletter.
 *
 * Real-session mode: backed by `newsletters` table + `newsletter-pdfs`
 * Storage bucket. PDFs are uploaded to storage, served to viewers via
 * short-lived signed URLs created on click.
 *
 * Dev-stub mode: localStorage with a base64 data URL (the original
 * Phase 1 stub) so dev iteration works without a real session. The
 * 3 MB cap only applies in dev.
 *
 * `publish` flips any previously-active row to inactive before
 * inserting the new one — the dashboard shows the single most-recent
 * active newsletter, but historical issues are preserved for a future
 * "back issues" view.
 */

export interface NewsletterDoc {
  id: string
  title: string
  subtitle: string
  fileName: string | null
  fileType: string | null
  /** Storage path inside the `newsletter-pdfs` bucket — real-session only */
  pdfPath: string | null
  /** Inline base64 PDF — dev-stub fallback only */
  dataUrl: string | null
  publishedAt: string
  publishedBy: string | null
}

const STORAGE_KEY = 'wcems:newsletter:current'
const MAX_DEV_FILE_BYTES = 3 * 1024 * 1024 /* 3 MB pre-encode (localStorage cap) */
const MAX_REAL_FILE_BYTES = 25 * 1024 * 1024 /* 25 MB upload cap (Supabase free tier comfort) */
const BUCKET = 'newsletter-pdfs'
const SIGNED_URL_TTL_SECONDS = 3600

interface NewsletterRow {
  id: string
  title: string
  blurb: string
  pdf_path: string | null
  pdf_filename: string | null
  published_at: string
  published_by: string | null
}

const current = ref<NewsletterDoc | null>(null)
const ready = ref(false)
let loadStarted = false

function rowToDoc(r: NewsletterRow): NewsletterDoc {
  return {
    id: r.id,
    title: r.title,
    subtitle: r.blurb ?? '',
    fileName: r.pdf_filename,
    fileType: r.pdf_path ? 'application/pdf' : null,
    pdfPath: r.pdf_path,
    dataUrl: null,
    publishedAt: r.published_at,
    publishedBy: r.published_by,
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
        if (raw) current.value = JSON.parse(raw) as NewsletterDoc
      } catch {
        /* ignore */
      }
    }
    ready.value = true
    return
  }

  /* Clean up the legacy dev key. */
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)

  const { data, error } = await supabase
    .from('newsletters')
    .select('id, title, blurb, pdf_path, pdf_filename, published_at, published_by')
    .eq('active', true)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[newsletter] failed to load:', error.message)
    ready.value = true
    return
  }
  current.value = data ? rowToDoc(data as NewsletterRow) : null
  ready.value = true
}

function persistDevStub() {
  if (typeof localStorage === 'undefined') return
  try {
    if (current.value) localStorage.setItem(STORAGE_KEY, JSON.stringify(current.value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* quota — caller validated size */
  }
}

export function useNewsletter() {
  void load()

  async function publish(input: {
    title: string
    subtitle: string
    file: File | null
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const title = input.title.trim()
    const subtitle = input.subtitle.trim()
    if (!title) return { ok: false, error: 'Title is required.' }

    const auth = useAuthStore()

    if (auth.usingDevStub) {
      let dataUrl = current.value?.dataUrl ?? null
      let fileName = current.value?.fileName ?? null
      let fileType = current.value?.fileType ?? null
      if (input.file) {
        if (input.file.size > MAX_DEV_FILE_BYTES) {
          return {
            ok: false,
            error: `Dev mode caps offline storage at 3 MB; you uploaded ${(
              input.file.size /
              1024 /
              1024
            ).toFixed(1)} MB. Sign in for real to use the 25 MB Storage bucket.`,
          }
        }
        try {
          dataUrl = await readAsDataUrl(input.file)
          fileName = input.file.name
          fileType = input.file.type || 'application/pdf'
        } catch {
          return { ok: false, error: 'Could not read that file. Try again?' }
        }
      }
      current.value = {
        id: 'dev-stub',
        title,
        subtitle,
        fileName,
        fileType,
        pdfPath: null,
        dataUrl,
        publishedAt: new Date().toISOString(),
        publishedBy: auth.appUser?.id ?? null,
      }
      persistDevStub()
      return { ok: true }
    }

    /* Real session ── upload to Storage, then INSERT row. */
    let pdfPath: string | null = current.value?.pdfPath ?? null
    let pdfFilename: string | null = current.value?.fileName ?? null

    if (input.file) {
      if (input.file.size > MAX_REAL_FILE_BYTES) {
        return {
          ok: false,
          error: `File is ${(input.file.size / 1024 / 1024).toFixed(
            1,
          )} MB; the upload cap is 25 MB. Compress the PDF.`,
        }
      }
      const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${crypto.randomUUID()}/${safeName}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, input.file, {
          upsert: false,
          contentType: 'application/pdf',
        })
      if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }
      pdfPath = path
      pdfFilename = input.file.name
    }

    /* Soft-deactivate previous active rows so only the new one is current. */
    const { error: deactErr } = await supabase
      .from('newsletters')
      .update({ active: false })
      .eq('active', true)
    if (deactErr) {
      return { ok: false, error: `Deactivate previous failed: ${deactErr.message}` }
    }

    const { data: inserted, error: insErr } = await supabase
      .from('newsletters')
      .insert({
        title,
        blurb: subtitle,
        pdf_path: pdfPath,
        pdf_filename: pdfFilename,
        published_by: auth.appUser?.id ?? null,
        active: true,
      })
      .select(
        'id, title, blurb, pdf_path, pdf_filename, published_at, published_by',
      )
      .single()
    if (insErr) return { ok: false, error: `Save failed: ${insErr.message}` }

    current.value = rowToDoc(inserted as NewsletterRow)
    return { ok: true }
  }

  async function clear() {
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      current.value = null
      persistDevStub()
      return
    }
    if (current.value?.id && current.value.id !== 'dev-stub') {
      const { error } = await supabase
        .from('newsletters')
        .update({ active: false })
        .eq('id', current.value.id)
      if (error) {
        console.error('[newsletter] clear failed:', error.message)
        return
      }
    }
    current.value = null
  }

  /**
   * Resolve a click-time URL for the published PDF. In dev-stub mode we
   * already have an inline data URL; in real-session mode we mint a
   * short-lived signed URL against Storage. Returns null when there's
   * no PDF attached.
   */
  async function getPdfUrl(): Promise<string | null> {
    const doc = current.value
    if (!doc) return null
    if (doc.dataUrl) return doc.dataUrl
    if (!doc.pdfPath) return null
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.pdfPath, SIGNED_URL_TTL_SECONDS)
    if (error) {
      console.error('[newsletter] signed URL failed:', error.message)
      return null
    }
    return data?.signedUrl ?? null
  }

  return { current, ready, publish, clear, getPdfUrl }
}
