import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Performance Improvement Plans. RLS is the whole access model: a PIP
 * row comes back ONLY for pip_admins (grant table, managed here), the
 * affected employee, and the supervisor named on the plan — so this
 * composable just loads what the database lets it see. No realtime
 * (deliberately quiet surface; viewers reload on action), no writes to
 * the clinical activity feed.
 */

export type PipStatus = 'active' | 'completed' | 'closed'
export type PipTargetStatus = 'pending' | 'met' | 'missed'
export type PipEntryKind = 'training' | 'meeting' | 'note'

export interface PipTarget {
  id: string
  pipId: string
  dueOn: string
  title: string
  detail: string | null
  status: PipTargetStatus
  completedAt: string | null
  note: string | null
  sort: number
}

export interface PipEntry {
  id: string
  pipId: string
  entryOn: string
  kind: PipEntryKind
  body: string
  createdBy: string | null
  createdAt: string
}

export interface PipDocument {
  id: string
  pipId: string
  name: string
  storagePath: string
  contentType: string | null
  sizeBytes: number | null
  createdAt: string
}

export interface Pip {
  id: string
  userId: string
  supervisorUserId: string | null
  status: PipStatus
  startsOn: string
  endsOn: string
  lengthDays: number | null
  summary: string
  areasOfConcern: string | null
  goals: string | null
  expectations: string | null
  requirements: string | null
  successCriteria: string | null
  consequences: string | null
  ftepHold: boolean
  outcomeNote: string | null
  createdBy: string | null
  createdAt: string
  closedAt: string | null
}

const PIP_COLUMNS =
  'id, user_id, supervisor_user_id, status, starts_on, ends_on, length_days, summary, areas_of_concern, goals, expectations, requirements, success_criteria, consequences, ftep_hold, outcome_note, created_by, created_at, closed_at'

interface PipRow {
  id: string
  user_id: string
  supervisor_user_id: string | null
  status: PipStatus
  starts_on: string
  ends_on: string
  length_days: number | null
  summary: string
  areas_of_concern: string | null
  goals: string | null
  expectations: string | null
  requirements: string | null
  success_criteria: string | null
  consequences: string | null
  ftep_hold: boolean
  outcome_note: string | null
  created_by: string | null
  created_at: string
  closed_at: string | null
}

function pipFromRow(r: PipRow): Pip {
  return {
    id: r.id,
    userId: r.user_id,
    supervisorUserId: r.supervisor_user_id,
    status: r.status,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    lengthDays: r.length_days,
    summary: r.summary,
    areasOfConcern: r.areas_of_concern,
    goals: r.goals,
    expectations: r.expectations,
    requirements: r.requirements,
    successCriteria: r.success_criteria,
    consequences: r.consequences,
    ftepHold: r.ftep_hold,
    outcomeNote: r.outcome_note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    closedAt: r.closed_at,
  }
}

/** Section fields shared by create and edit. */
export interface PipSections {
  summary: string
  areasOfConcern: string
  goals: string
  expectations: string
  requirements: string
  successCriteria: string
  consequences: string
}

const pips = ref<Pip[]>([])
const targets = ref<PipTarget[]>([])
const entries = ref<PipEntry[]>([])
const documents = ref<PipDocument[]>([])
const isAdmin = ref(false)
const ready = ref(false)
let loadStarted = false

async function load(): Promise<void> {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    isAdmin.value = auth.isAdmin
    ready.value = true
    return
  }
  await reload()
  const adm = await supabase.rpc('pip_am_admin')
  isAdmin.value = adm.data === true
  ready.value = true
}

async function reload(): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  const pRes = await supabase.from('pips').select(PIP_COLUMNS).order('created_at', { ascending: false })
  if (pRes.error) {
    console.error('[pips] load:', pRes.error.message)
    return
  }
  pips.value = ((pRes.data ?? []) as PipRow[]).map(pipFromRow)
  const ids = pips.value.map((p) => p.id)
  if (ids.length === 0) {
    targets.value = []
    entries.value = []
    documents.value = []
    return
  }
  const [tRes, eRes, dRes] = await Promise.all([
    supabase
      .from('pip_targets')
      .select('id, pip_id, due_on, title, detail, status, completed_at, note, sort')
      .in('pip_id', ids)
      .order('due_on'),
    supabase
      .from('pip_entries')
      .select('id, pip_id, entry_on, kind, body, created_by, created_at')
      .in('pip_id', ids)
      .order('entry_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('pip_documents')
      .select('id, pip_id, name, storage_path, content_type, size_bytes, created_at')
      .in('pip_id', ids)
      .order('created_at'),
  ])
  targets.value = ((tRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    pipId: String(r.pip_id),
    dueOn: String(r.due_on),
    title: String(r.title),
    detail: (r.detail as string | null) ?? null,
    status: r.status as PipTargetStatus,
    completedAt: (r.completed_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    sort: Number(r.sort ?? 0),
  }))
  entries.value = ((eRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    pipId: String(r.pip_id),
    entryOn: String(r.entry_on),
    kind: r.kind as PipEntryKind,
    body: String(r.body),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: String(r.created_at),
  }))
  documents.value = ((dRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    pipId: String(r.pip_id),
    name: String(r.name),
    storagePath: String(r.storage_path),
    contentType: (r.content_type as string | null) ?? null,
    sizeBytes: (r.size_bytes as number | null) ?? null,
    createdAt: String(r.created_at),
  }))
}

type Result = { ok: true } | { ok: false; error: string }
type IdResult = { ok: true; id: string } | { ok: false; error: string }

export function usePips() {
  const auth = useAuthStore()
  void load()

  const live = computed(() => !auth.usingDevStub)

  function listFor(userId: string): Pip[] {
    return pips.value.filter((p) => p.userId === userId)
  }
  function activeFor(userId: string): Pip | null {
    return pips.value.find((p) => p.userId === userId && p.status === 'active') ?? null
  }
  const myPip = computed<Pip | null>(() => {
    const me = auth.appUser?.id
    return me ? (activeFor(me) ?? null) : null
  })
  function targetsFor(pipId: string): PipTarget[] {
    return targets.value.filter((t) => t.pipId === pipId)
  }
  function entriesFor(pipId: string): PipEntry[] {
    return entries.value.filter((e) => e.pipId === pipId)
  }
  function documentsFor(pipId: string): PipDocument[] {
    return documents.value.filter((d) => d.pipId === pipId)
  }

  async function createPip(input: {
    userId: string
    supervisorUserId: string | null
    startsOn: string
    endsOn: string
    lengthDays: number | null
    ftepHold: boolean
    sections: PipSections
    targets: Array<{ dueOn: string; title: string; detail: string }>
  }): Promise<IdResult> {
    if (!live.value) return { ok: false, error: 'Not available in the dev preview.' }
    const s = input.sections
    const { data, error } = await supabase
      .from('pips')
      .insert({
        user_id: input.userId,
        supervisor_user_id: input.supervisorUserId,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        length_days: input.lengthDays,
        summary: s.summary.trim(),
        areas_of_concern: s.areasOfConcern.trim() || null,
        goals: s.goals.trim() || null,
        expectations: s.expectations.trim() || null,
        requirements: s.requirements.trim() || null,
        success_criteria: s.successCriteria.trim() || null,
        consequences: s.consequences.trim() || null,
        ftep_hold: input.ftepHold,
        created_by: auth.appUser?.id ?? null,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    const pipId = data.id as string
    const tRows = input.targets
      .filter((t) => t.dueOn && t.title.trim())
      .map((t, i) => ({ pip_id: pipId, due_on: t.dueOn, title: t.title.trim(), detail: t.detail.trim() || null, sort: i }))
    if (tRows.length > 0) {
      const tIns = await supabase.from('pip_targets').insert(tRows)
      if (tIns.error) {
        await reload()
        return { ok: false, error: `Plan saved, but checkpoints failed: ${tIns.error.message}` }
      }
    }
    if (input.ftepHold) await supabase.rpc('pip_set_hold', { p_user: input.userId, p_on: true })
    await reload()
    return { ok: true, id: pipId }
  }

  async function updatePip(
    id: string,
    patch: Partial<{
      supervisorUserId: string | null
      startsOn: string
      endsOn: string
      lengthDays: number | null
      ftepHold: boolean
    }> & { sections?: Partial<PipSections> },
  ): Promise<Result> {
    if (!live.value) return { ok: false, error: 'Not available in the dev preview.' }
    const p = pips.value.find((x) => x.id === id)
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('supervisorUserId' in patch) row.supervisor_user_id = patch.supervisorUserId
    if (patch.startsOn !== undefined) row.starts_on = patch.startsOn
    if (patch.endsOn !== undefined) row.ends_on = patch.endsOn
    if (patch.lengthDays !== undefined) row.length_days = patch.lengthDays
    if (patch.ftepHold !== undefined) row.ftep_hold = patch.ftepHold
    const s = patch.sections
    if (s) {
      if (s.summary !== undefined) row.summary = s.summary.trim()
      if (s.areasOfConcern !== undefined) row.areas_of_concern = s.areasOfConcern.trim() || null
      if (s.goals !== undefined) row.goals = s.goals.trim() || null
      if (s.expectations !== undefined) row.expectations = s.expectations.trim() || null
      if (s.requirements !== undefined) row.requirements = s.requirements.trim() || null
      if (s.successCriteria !== undefined) row.success_criteria = s.successCriteria.trim() || null
      if (s.consequences !== undefined) row.consequences = s.consequences.trim() || null
    }
    const { error } = await supabase.from('pips').update(row).eq('id', id)
    if (error) return { ok: false, error: error.message }
    if (patch.ftepHold !== undefined && p) {
      await supabase.rpc('pip_set_hold', { p_user: p.userId, p_on: patch.ftepHold })
    }
    await reload()
    return { ok: true }
  }

  function nextTargetFor(pipId: string): PipTarget | null {
    return targetsFor(pipId).filter((t) => t.status === 'pending').sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null
  }

  /** Closing always releases the FTEP hold. */
  async function closePip(id: string, status: 'completed' | 'closed', outcomeNote: string): Promise<Result> {
    if (!live.value) return { ok: false, error: 'Not available in the dev preview.' }
    const p = pips.value.find((x) => x.id === id)
    const { error } = await supabase
      .from('pips')
      .update({
        status,
        outcome_note: outcomeNote || null,
        closed_at: new Date().toISOString(),
        closed_by: auth.appUser?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    if (p?.ftepHold) await supabase.rpc('pip_set_hold', { p_user: p.userId, p_on: false })
    await reload()
    return { ok: true }
  }

  async function addTarget(pipId: string, input: { dueOn: string; title: string; detail: string }): Promise<Result> {
    const { error } = await supabase.from('pip_targets').insert({
      pip_id: pipId,
      due_on: input.dueOn,
      title: input.title,
      detail: input.detail || null,
    })
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function setTargetStatus(id: string, status: PipTargetStatus, note: string): Promise<Result> {
    const { error } = await supabase
      .from('pip_targets')
      .update({
        status,
        note: note || null,
        completed_at: status === 'pending' ? null : new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function removeTarget(id: string): Promise<Result> {
    const { error } = await supabase.from('pip_targets').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function addEntry(pipId: string, input: { entryOn: string; kind: PipEntryKind; body: string }): Promise<Result> {
    const { error } = await supabase.from('pip_entries').insert({
      pip_id: pipId,
      entry_on: input.entryOn,
      kind: input.kind,
      body: input.body,
      created_by: auth.appUser?.id ?? null,
    })
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function removeEntry(id: string): Promise<Result> {
    const { error } = await supabase.from('pip_entries').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function uploadDocument(pipId: string, file: File): Promise<Result> {
    if (!live.value) return { ok: false, error: 'Not available in the dev preview.' }
    const safe = file.name.replace(/[^\w.\- ]+/g, '').slice(0, 120) || 'document'
    const path = `${pipId}/${Date.now()}__${safe}`
    const up = await supabase.storage.from('pip-docs').upload(path, file, { upsert: false })
    if (up.error) return { ok: false, error: up.error.message }
    const { error } = await supabase.from('pip_documents').insert({
      pip_id: pipId,
      name: file.name,
      storage_path: path,
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: auth.appUser?.id ?? null,
    })
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  async function documentUrl(storagePath: string): Promise<string | null> {
    const { data } = await supabase.storage.from('pip-docs').createSignedUrl(storagePath, 300)
    return data?.signedUrl ?? null
  }

  async function removeDocument(doc: PipDocument): Promise<Result> {
    await supabase.storage.from('pip-docs').remove([doc.storagePath])
    const { error } = await supabase.from('pip_documents').delete().eq('id', doc.id)
    if (error) return { ok: false, error: error.message }
    await reload()
    return { ok: true }
  }

  /* ── access list (pip_admins) ────────────────────────────────────── */
  async function listAdmins(): Promise<Array<{ userId: string; notify: boolean }>> {
    const { data } = await supabase.from('pip_admins').select('user_id, notify')
    return (data ?? []).map((r) => ({ userId: r.user_id as string, notify: r.notify === true }))
  }
  /** Whether this admin gets copies of the T-7/T-1 reminders. */
  async function setAdminNotify(userId: string, on: boolean): Promise<Result> {
    const { error } = await supabase.from('pip_admins').update({ notify: on }).eq('user_id', userId)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  async function addAdmin(userId: string): Promise<Result> {
    const { error } = await supabase
      .from('pip_admins')
      .insert({ user_id: userId, added_by: auth.appUser?.id ?? null })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  async function removeAdmin(userId: string): Promise<Result> {
    const { error } = await supabase.from('pip_admins').delete().eq('user_id', userId)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  return {
    ready,
    isAdmin,
    pips,
    myPip,
    listFor,
    activeFor,
    targetsFor,
    nextTargetFor,
    entriesFor,
    documentsFor,
    reload,
    createPip,
    updatePip,
    closePip,
    addTarget,
    setTargetStatus,
    removeTarget,
    addEntry,
    removeEntry,
    uploadDocument,
    documentUrl,
    removeDocument,
    listAdmins,
    addAdmin,
    removeAdmin,
    setAdminNotify,
  }
}
