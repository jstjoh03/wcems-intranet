import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * FTEP Resources library — handbooks, program guides, workbooks, blank
 * forms. Editor-uploaded into a private bucket; RLS scopes what each
 * viewer's load returns (trainee-audience docs for everyone,
 * evaluator docs for supervisors/FTOs/editors, editor docs for the
 * clinical department). Module singleton per house convention.
 */

export type ResourceAudience = 'trainees' | 'evaluators' | 'editors'
export type ResourceCategory = 'guide' | 'handbook' | 'workbook' | 'form' | 'exam' | 'other'

export const AUDIENCE_LABELS: Record<ResourceAudience, string> = {
  trainees: 'Everyone (trainees included)',
  evaluators: 'Supervisors & FTOs',
  editors: 'Clinical department only',
}

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  guide: 'Program guide',
  handbook: 'Handbook',
  workbook: 'Workbook',
  form: 'Blank form',
  exam: 'Protocol exam',
  other: 'Other',
}

export interface FtepResource {
  id: string
  title: string
  category: ResourceCategory
  audience: ResourceAudience
  storagePath: string
  contentType: string | null
  sizeBytes: number | null
  note: string | null
  sort: number
  createdAt: string
}

interface ResourceRow {
  id: string
  title: string
  category: ResourceCategory
  audience: ResourceAudience
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  note: string | null
  sort: number
  created_at: string
}

const COLUMNS = 'id, title, category, audience, storage_path, content_type, size_bytes, note, sort, created_at'

function fromRow(r: ResourceRow): FtepResource {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    audience: r.audience,
    storagePath: r.storage_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    note: r.note,
    sort: r.sort,
    createdAt: r.created_at,
  }
}

const resources = ref<FtepResource[]>([])
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
    .from('ftep_resources')
    .select(COLUMNS)
    .order('sort')
    .order('title')
  if (error) console.error('[ftep-resources] load:', error.message)
  resources.value = (data ?? []).map((r) => fromRow(r as ResourceRow))
  ready.value = true
}

export function useFtepResources() {
  const auth = useAuthStore()
  void load()

  async function upload(input: {
    title: string
    category: ResourceCategory
    audience: ResourceAudience
    file: File
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: false, error: 'Not available in dev mode.' }
    const safeName = input.file.name.replace(/[^\w.\- ]/g, '_')
    const path = `${Date.now()}_${safeName}`

    const { error: upErr } = await supabase.storage
      .from('ftep-resources')
      .upload(path, input.file, { contentType: input.file.type || undefined })
    if (upErr) return { ok: false, error: upErr.message }

    const { data, error } = await supabase
      .from('ftep_resources')
      .insert({
        title: input.title.trim(),
        category: input.category,
        audience: input.audience,
        storage_path: path,
        content_type: input.file.type || null,
        size_bytes: input.file.size,
        uploaded_by: auth.appUser?.id ?? null,
      })
      .select(COLUMNS)
      .single()
    if (error) {
      /* Orphan cleanup so a failed insert doesn't strand the object. */
      await supabase.storage.from('ftep-resources').remove([path])
      return { ok: false, error: error.message }
    }
    resources.value = [...resources.value, fromRow(data as ResourceRow)].sort(
      (a, b) => a.sort - b.sort || a.title.localeCompare(b.title),
    )
    return { ok: true }
  }

  async function open(r: FtepResource): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const { data, error } = await supabase.storage
      .from('ftep-resources')
      .createSignedUrl(r.storagePath, 300)
    if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'Could not open.' }
    return { ok: true, url: data.signedUrl }
  }

  async function remove(r: FtepResource): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.from('ftep_resources').delete().eq('id', r.id)
    if (error) return { ok: false, error: error.message }
    await supabase.storage.from('ftep-resources').remove([r.storagePath])
    resources.value = resources.value.filter((x) => x.id !== r.id)
    return { ok: true }
  }

  return { resources, ready, upload, open, remove }
}
