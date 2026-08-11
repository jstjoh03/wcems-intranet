import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import peopleData from '@/data/people.json'

/**
 * Currently-active "spotlight" — admin-curated recognition slot on the
 * dashboard People row.
 *
 * Real-session: backed by `spotlights` table + `spotlight-photos`
 * public Storage bucket. Publish flips any previously-active row to
 * inactive before inserting the new one (cardinality of active rows is
 * at most 1; past spotlights are preserved for a future "history" view).
 *
 * Dev-stub: reads `people.json.spotlight` if present + localStorage for
 * draft state. Photo uploads in dev-stub mode use a base64 data URL.
 */

export interface Spotlight {
  id: string
  /** Rendered display string — one name, or "A & B" / "A, B & C". */
  personName: string
  /** Individual roster names — the comment-push recipients. */
  personNames: string[]
  role: string
  tenure: string
  blurb: string
  /** Long-form write-up shown in the "Read the full story" view. */
  story: string
  /** Storage path inside `spotlight-photos` bucket — null in dev stub */
  photoPath: string | null
  /** Resolved public URL — data URL in dev-stub, public URL in real session */
  photoUrl: string | null
  publishedAt: string
  publishedBy: string | null
}

interface SpotlightRow {
  id: string
  person_name: string
  person_names: string[] | null
  role: string
  tenure: string
  blurb: string
  story: string | null
  photo_path: string | null
  published_at: string
  published_by: string | null
}

const STORAGE_KEY = 'wcems:spotlight:current'
const MAX_DEV_FILE_BYTES = 2 * 1024 * 1024 /* 2 MB dev cap (localStorage budget) */
const MAX_REAL_FILE_BYTES = 8 * 1024 * 1024 /* 8 MB real upload cap */
const BUCKET = 'spotlight-photos'

const current = ref<Spotlight | null>(null)
const ready = ref(false)
let loadStarted = false

function photoPublicUrl(path: string | null): string | null {
  if (!path) return null
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

function rowToSpotlight(r: SpotlightRow): Spotlight {
  return {
    id: r.id,
    personName: r.person_name,
    personNames: r.person_names?.length ? r.person_names : r.person_name ? [r.person_name] : [],
    role: r.role ?? '',
    tenure: r.tenure ?? '',
    blurb: r.blurb ?? '',
    story: r.story ?? '',
    photoPath: r.photo_path,
    photoUrl: photoPublicUrl(r.photo_path),
    publishedAt: r.published_at,
    publishedBy: r.published_by,
  }
}

/** "A" / "A & B" / "A, B & C" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
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
    /* Dev-stub: prefer the localStorage draft (admin previewed in dev),
       otherwise fall back to people.json.spotlight if it's populated. */
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          current.value = JSON.parse(raw) as Spotlight
          ready.value = true
          return
        }
      } catch {
        /* ignore corrupt local copy */
      }
    }
    const stub = (
      peopleData as {
        spotlight: { name: string; role: string; tenure: string; blurb: string } | null
      }
    ).spotlight
    if (stub) {
      current.value = {
        id: 'dev-stub',
        personName: stub.name,
        personNames: [stub.name],
        role: stub.role,
        tenure: stub.tenure,
        blurb: stub.blurb,
        story: '',
        photoPath: null,
        photoUrl: null,
        publishedAt: new Date().toISOString(),
        publishedBy: null,
      }
    }
    ready.value = true
    return
  }

  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)

  const { data, error } = await supabase
    .from('spotlights')
    .select('id, person_name, person_names, role, tenure, blurb, story, photo_path, published_at, published_by')
    .eq('active', true)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[spotlight] failed to load:', error.message)
    ready.value = true
    return
  }
  current.value = data ? rowToSpotlight(data as SpotlightRow) : null
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

export function useSpotlight() {
  void load()

  async function publish(input: {
    personNames: string[]
    role: string
    tenure: string
    blurb: string
    story: string
    photo: File | null
    /** True if admin clicked "Remove photo" — clears the existing path. */
    removeExistingPhoto?: boolean
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const personNames = input.personNames.map((n) => n.trim()).filter(Boolean)
    if (personNames.length === 0) return { ok: false, error: 'Pick at least one employee.' }
    const personName = joinNames(personNames)
    const role = input.role.trim()
    const tenure = input.tenure.trim()
    const blurb = input.blurb.trim()
    const story = input.story.trim()

    const auth = useAuthStore()

    if (auth.usingDevStub) {
      let photoUrl: string | null = input.removeExistingPhoto ? null : current.value?.photoUrl ?? null
      if (input.photo) {
        if (input.photo.size > MAX_DEV_FILE_BYTES) {
          return {
            ok: false,
            error: `Dev mode caps photos at 2 MB; you picked ${(
              input.photo.size /
              1024 /
              1024
            ).toFixed(1)} MB. Sign in for real to upload up to 8 MB.`,
          }
        }
        try {
          photoUrl = await readAsDataUrl(input.photo)
        } catch {
          return { ok: false, error: 'Could not read that file. Try again?' }
        }
      }
      current.value = {
        id: 'dev-stub',
        personName,
        personNames,
        role,
        tenure,
        blurb,
        story,
        photoPath: null,
        photoUrl,
        publishedAt: new Date().toISOString(),
        publishedBy: auth.appUser?.id ?? null,
      }
      persistDevStub()
      return { ok: true }
    }

    /* Real session — upload (if new photo), deactivate previous, insert. */
    let photoPath: string | null = input.removeExistingPhoto
      ? null
      : current.value?.photoPath ?? null

    if (input.photo) {
      if (input.photo.size > MAX_REAL_FILE_BYTES) {
        return {
          ok: false,
          error: `Photo is ${(input.photo.size / 1024 / 1024).toFixed(
            1,
          )} MB; the upload cap is 8 MB. Resize or compress.`,
        }
      }
      const safeName = input.photo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${crypto.randomUUID()}/${safeName}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, input.photo, {
          upsert: false,
          contentType: input.photo.type || 'image/jpeg',
        })
      if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` }
      photoPath = path
    }

    /* Deactivate any existing active row before inserting the new one. */
    const { error: deactErr } = await supabase
      .from('spotlights')
      .update({ active: false })
      .eq('active', true)
    if (deactErr) {
      return { ok: false, error: `Deactivate previous failed: ${deactErr.message}` }
    }

    const { data: inserted, error: insErr } = await supabase
      .from('spotlights')
      .insert({
        person_name: personName,
        person_names: personNames,
        role,
        tenure,
        blurb,
        story,
        photo_path: photoPath,
        published_by: auth.appUser?.id ?? null,
        active: true,
      })
      .select('id, person_name, person_names, role, tenure, blurb, story, photo_path, published_at, published_by')
      .single()
    if (insErr) return { ok: false, error: `Save failed: ${insErr.message}` }

    current.value = rowToSpotlight(inserted as SpotlightRow)
    return { ok: true }
  }

  async function clear(): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      current.value = null
      persistDevStub()
      return { ok: true }
    }
    if (current.value?.id && current.value.id !== 'dev-stub') {
      const { error } = await supabase
        .from('spotlights')
        .update({ active: false })
        .eq('id', current.value.id)
      if (error) return { ok: false, error: error.message }
    }
    current.value = null
    return { ok: true }
  }

  return { current, ready, publish, clear }
}
