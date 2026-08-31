import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * The employee file's document cabinet (clinical_documents +
 * private clinical-docs bucket). Editors upload/manage; a per-doc
 * toggle shares individual documents with the employee (counseling
 * never). Downloads go through short-lived signed URLs so the bucket
 * stays private.
 */

export type ClinicalDocFolder =
  | 'signed_forms'
  | 'certs'
  | 'ce_certs'
  | 'protocol_exams'
  | 'counseling'
  | 'generated'
  | 'other'

export const FOLDER_LABELS: Record<ClinicalDocFolder, string> = {
  signed_forms: 'Signed forms',
  certs: 'Cert cards',
  ce_certs: 'CE certificates',
  protocol_exams: 'Protocol exams',
  counseling: 'Counseling',
  generated: 'Generated PDFs',
  other: 'Other',
}

export interface ClinicalDoc {
  id: string
  userId: string
  folder: ClinicalDocFolder
  name: string
  storagePath: string
  contentType: string | null
  sizeBytes: number | null
  employeeVisible: boolean
  note: string | null
  uploadedBy: string | null
  createdAt: string
}

interface DocRow {
  id: string
  user_id: string
  folder: ClinicalDocFolder
  name: string
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  employee_visible: boolean
  note: string | null
  uploaded_by: string | null
  created_at: string
}

const COLUMNS =
  'id, user_id, folder, name, storage_path, content_type, size_bytes, employee_visible, note, uploaded_by, created_at'

function fromRow(r: DocRow): ClinicalDoc {
  return {
    id: r.id,
    userId: r.user_id,
    folder: r.folder,
    name: r.name,
    storagePath: r.storage_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    employeeVisible: r.employee_visible,
    note: r.note,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }
}

const docs = ref<ClinicalDoc[]>([])
const ready = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('clinical_documents')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (error) console.error('[clindocs] load:', error.message)
  docs.value = (data ?? []).map((r) => fromRow(r as DocRow))
  ready.value = true
}

export function useClinicalDocs() {
  const auth = useAuthStore()
  void load()

  function docsFor(userId: string): ClinicalDoc[] {
    return docs.value.filter((d) => d.userId === userId)
  }

  async function upload(input: {
    userId: string
    folder: ClinicalDocFolder
    file: File
    employeeVisible: boolean
    note?: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: false, error: 'Not available in dev mode.' }
    const safeName = input.file.name.replace(/[^\w.\- ]/g, '_')
    const path = `${input.userId}/${Date.now()}_${safeName}`

    const { error: upErr } = await supabase.storage
      .from('clinical-docs')
      .upload(path, input.file, {
        contentType: input.file.type || 'application/octet-stream',
        upsert: false,
      })
    if (upErr) return { ok: false, error: upErr.message }

    const { data, error } = await supabase
      .from('clinical_documents')
      .insert({
        user_id: input.userId,
        folder: input.folder,
        name: input.file.name,
        storage_path: path,
        content_type: input.file.type || null,
        size_bytes: input.file.size,
        employee_visible: input.folder === 'counseling' ? false : input.employeeVisible,
        note: input.note?.trim() || null,
        uploaded_by: auth.appUser?.id ?? null,
      })
      .select(COLUMNS)
      .single()
    if (error) {
      /* orphaned object cleanup — best effort */
      await supabase.storage.from('clinical-docs').remove([path])
      return { ok: false, error: error.message }
    }
    docs.value = [fromRow(data as DocRow), ...docs.value]
    return { ok: true }
  }

  /** Short-lived signed URL for viewing/downloading. */
  async function openDoc(doc: ClinicalDoc): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const { data, error } = await supabase.storage
      .from('clinical-docs')
      .createSignedUrl(doc.storagePath, 300)
    if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'No URL' }
    return { ok: true, url: data.signedUrl }
  }

  async function setVisibility(doc: ClinicalDoc, visible: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
    if (doc.folder === 'counseling') return { ok: false, error: 'Counseling documents are always staff-only.' }
    const { data, error } = await supabase
      .from('clinical_documents')
      .update({ employee_visible: visible })
      .eq('id', doc.id)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as DocRow)
    docs.value = docs.value.map((d) => (d.id === row.id ? row : d))
    return { ok: true }
  }

  async function remove(doc: ClinicalDoc): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.from('clinical_documents').delete().eq('id', doc.id)
    if (error) return { ok: false, error: error.message }
    await supabase.storage.from('clinical-docs').remove([doc.storagePath])
    docs.value = docs.value.filter((d) => d.id !== doc.id)
    return { ok: true }
  }

  return { ready, docs, docsFor, upload, openDoc, setVisibility, remove }
}
