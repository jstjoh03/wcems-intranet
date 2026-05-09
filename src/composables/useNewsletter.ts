import { ref, watch } from 'vue'

/**
 * Currently-published monthly newsletter.
 *
 * Phase 1: localStorage stub. The PDF is stored as a data URL so the
 * "Open PDF" link works after a refresh, on the same device. Phase 2
 * will swap in Supabase Storage — the public surface stays the same.
 *
 * The 3 MB cap is a soft guard: encoding to base64 inflates by ~33%, so
 * a 3 MB PDF lands at ~4 MB serialized — comfortably under the typical
 * 5 MB localStorage ceiling. Larger files get rejected with a friendly
 * error rather than silently failing.
 */

export interface NewsletterDoc {
  title: string
  subtitle: string
  fileName: string | null
  fileType: string | null
  dataUrl: string | null
  publishedAt: string
}

const STORAGE_KEY = 'wcems:newsletter:current'
const MAX_FILE_BYTES = 3 * 1024 * 1024 // 3 MB pre-encode

function load(): NewsletterDoc | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NewsletterDoc) : null
  } catch {
    return null
  }
}

function persist(doc: NewsletterDoc | null) {
  if (typeof localStorage === 'undefined') return
  try {
    if (doc) localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* quota — caller should have validated file size already */
  }
}

const current = ref<NewsletterDoc | null>(load())
watch(current, (val) => persist(val))

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

export function useNewsletter() {
  async function publish(input: {
    title: string
    subtitle: string
    file: File | null
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const title = input.title.trim()
    const subtitle = input.subtitle.trim()
    if (!title) return { ok: false, error: 'Title is required.' }

    let dataUrl: string | null = null
    let fileName: string | null = null
    let fileType: string | null = null

    if (input.file) {
      if (input.file.size > MAX_FILE_BYTES) {
        return {
          ok: false,
          error: `File is ${(input.file.size / 1024 / 1024).toFixed(
            1,
          )} MB — Phase 1 caps offline storage at 3 MB. Compress the PDF or wait until Supabase Storage is connected.`,
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
      title,
      subtitle,
      fileName,
      fileType,
      dataUrl,
      publishedAt: new Date().toISOString(),
    }
    return { ok: true }
  }

  function clear() {
    current.value = null
  }

  return { current, publish, clear }
}
