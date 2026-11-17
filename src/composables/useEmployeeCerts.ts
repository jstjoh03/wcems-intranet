import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * The employee's own certification wallet (employee_certs + private
 * employee-certs bucket): self-uploaded card images/PDFs with issue
 * and expiration dates. RLS scopes rows to the owner (admins and
 * pipeline editors can read everyone's); the daily DB sweep sends
 * expiration reminders — nothing here schedules anything.
 *
 * Dev-stub: localStorage, with file contents held as data URLs so
 * thumbnails work offline.
 */

export interface EmployeeCert {
  id: string
  userId: string
  name: string
  certNumber: string | null
  issuedOn: string | null
  expiresOn: string | null
  storagePath: string | null
  contentType: string | null
  note: string | null
  createdAt: string
}

const STORAGE_KEY = 'wcems:employee-certs'
const COLUMNS =
  'id, user_id, name, cert_number, issued_on, expires_on, storage_path, content_type, note, created_at'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): EmployeeCert {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    certNumber: r.cert_number ?? null,
    issuedOn: r.issued_on ?? null,
    expiresOn: r.expires_on ?? null,
    storagePath: r.storage_path ?? null,
    contentType: r.content_type ?? null,
    note: r.note ?? null,
    createdAt: r.created_at,
  }
}

const certs = ref<EmployeeCert[]>([])
const ready = ref(false)
let loadedFor: string | null = null

/* Dev-stub file bodies (data URLs) keyed by cert id. */
const stubFiles = ref<Record<string, string>>({})

function stubPersist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ certs: certs.value, files: stubFiles.value }))
  } catch {
    /* quota — thumbnails may drop, rows stay */
  }
}

export function useEmployeeCerts() {
  const auth = useAuthStore()

  function myId(): string | null {
    return auth.appUser?.id ?? null
  }

  async function load(): Promise<void> {
    const uid = myId()
    if (!uid || loadedFor === uid) return
    loadedFor = uid

    if (auth.usingDevStub) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { certs: EmployeeCert[]; files: Record<string, string> }
          certs.value = parsed.certs ?? []
          stubFiles.value = parsed.files ?? {}
        }
      } catch {
        certs.value = []
      }
      ready.value = true
      return
    }

    const { data, error } = await supabase
      .from('employee_certs')
      .select(COLUMNS)
      .eq('user_id', uid)
      .order('expires_on', { ascending: true, nullsFirst: false })
    if (!error) certs.value = (data ?? []).map(fromRow)
    ready.value = true
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = reject
      fr.readAsDataURL(file)
    })
  }

  async function add(input: {
    name: string
    certNumber: string
    issuedOn: string
    expiresOn: string
    note: string
    file: File
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = myId()
    if (!uid) return { ok: false, error: 'Sign in first.' }

    if (auth.usingDevStub) {
      const id = `dev-${crypto.randomUUID()}`
      stubFiles.value[id] = await fileToDataUrl(input.file)
      certs.value = [
        ...certs.value,
        {
          id,
          userId: uid,
          name: input.name.trim(),
          certNumber: input.certNumber.trim() || null,
          issuedOn: input.issuedOn || null,
          expiresOn: input.expiresOn || null,
          storagePath: `dev/${id}`,
          contentType: input.file.type,
          note: input.note.trim() || null,
          createdAt: new Date().toISOString(),
        },
      ]
      stubPersist()
      return { ok: true }
    }

    const safe = input.file.name.replace(/[^\w.\- ]/g, '_')
    const path = `${uid}/${Date.now()}_${safe}`
    const up = await supabase.storage.from('employee-certs').upload(path, input.file, {
      contentType: input.file.type || 'application/octet-stream',
    })
    if (up.error) return { ok: false, error: up.error.message }

    const { data, error } = await supabase
      .from('employee_certs')
      .insert({
        user_id: uid,
        name: input.name.trim(),
        cert_number: input.certNumber.trim() || null,
        issued_on: input.issuedOn || null,
        expires_on: input.expiresOn || null,
        storage_path: path,
        content_type: input.file.type || null,
        size_bytes: input.file.size,
        note: input.note.trim() || null,
      })
      .select(COLUMNS)
      .single()
    if (error) {
      await supabase.storage.from('employee-certs').remove([path])
      return { ok: false, error: error.message }
    }
    certs.value = [...certs.value, fromRow(data)]
    return { ok: true }
  }

  async function update(
    id: string,
    patch: { name: string; certNumber: string; issuedOn: string; expiresOn: string; note: string },
    newFile: File | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = myId()
    const existing = certs.value.find((c) => c.id === id)
    if (!uid || !existing) return { ok: false, error: 'Not found.' }

    if (auth.usingDevStub) {
      if (newFile) stubFiles.value[id] = await fileToDataUrl(newFile)
      certs.value = certs.value.map((c) =>
        c.id === id
          ? {
              ...c,
              name: patch.name.trim(),
              certNumber: patch.certNumber.trim() || null,
              issuedOn: patch.issuedOn || null,
              expiresOn: patch.expiresOn || null,
              note: patch.note.trim() || null,
              contentType: newFile ? newFile.type : c.contentType,
            }
          : c,
      )
      stubPersist()
      return { ok: true }
    }

    let path = existing.storagePath
    let contentType = existing.contentType
    if (newFile) {
      const safe = newFile.name.replace(/[^\w.\- ]/g, '_')
      const newPath = `${uid}/${Date.now()}_${safe}`
      const up = await supabase.storage.from('employee-certs').upload(newPath, newFile, {
        contentType: newFile.type || 'application/octet-stream',
      })
      if (up.error) return { ok: false, error: up.error.message }
      path = newPath
      contentType = newFile.type || null
    }

    const { data, error } = await supabase
      .from('employee_certs')
      .update({
        name: patch.name.trim(),
        cert_number: patch.certNumber.trim() || null,
        issued_on: patch.issuedOn || null,
        expires_on: patch.expiresOn || null,
        note: patch.note.trim() || null,
        storage_path: path,
        content_type: contentType,
        ...(newFile ? { size_bytes: newFile.size } : {}),
      })
      .eq('id', id)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    if (newFile && existing.storagePath) {
      await supabase.storage.from('employee-certs').remove([existing.storagePath])
    }
    certs.value = certs.value.map((c) => (c.id === id ? fromRow(data) : c))
    return { ok: true }
  }

  async function remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const existing = certs.value.find((c) => c.id === id)
    if (!existing) return { ok: true }

    if (auth.usingDevStub) {
      certs.value = certs.value.filter((c) => c.id !== id)
      delete stubFiles.value[id]
      stubPersist()
      return { ok: true }
    }

    const { error } = await supabase.from('employee_certs').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    if (existing.storagePath) {
      await supabase.storage.from('employee-certs').remove([existing.storagePath])
    }
    certs.value = certs.value.filter((c) => c.id !== id)
    return { ok: true }
  }

  /** Short-lived URL for viewing/thumbnailing the stored card. */
  async function fileUrl(cert: EmployeeCert): Promise<string | null> {
    if (auth.usingDevStub) return stubFiles.value[cert.id] ?? null
    if (!cert.storagePath) return null
    const { data } = await supabase.storage
      .from('employee-certs')
      .createSignedUrl(cert.storagePath, 300)
    return data?.signedUrl ?? null
  }

  return { certs, ready, load, add, update, remove, fileUrl }
}
