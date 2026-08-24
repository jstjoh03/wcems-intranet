import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type {
  FtepPhaseProgress,
  GateStatus,
  PipelineGateProgress,
  PipelinePerson,
  PipelinePhase,
  PipelineRecord,
  PipelineRequirement,
  PipelineRequirementCompletion,
  PipelineTransition,
  RequirementCycle,
} from '@/types'
import { PHASE_LADDER } from '@/constants/pipelineGates'

/**
 * Clinical Development pipeline state.
 *
 * Reads pipeline_records (joined with app_users identity) plus
 * pipeline_gate_progress and pipeline_editors. RLS does the real
 * gatekeeping: board viewers (supervisors/admins, pipeline editors,
 * FTOs) get every row, everyone else gets only their own — the same
 * queries serve both the board and the "My Progress" page.
 *
 * WRITES are a person-specific grant (pipeline_editors), NOT an admin
 * right — portal admins aren't all clinical staff. `canEdit` reflects
 * the current user's row in that table.
 *
 * Module-level singleton per house convention.
 */

interface RecordRow {
  id: string
  user_id: string
  cleared_phase: PipelinePhase | null
  working_phase: PipelinePhase | null
  working_started_at: string | null
  working_target_at: string | null
  pending: boolean
  pip_active: boolean
  pip_started_at: string | null
  pip_reason: string | null
  in_p3_process: boolean
  in_aemt_upgrade: boolean
  legacy_track: boolean
  level: string | null
  is_fto: boolean
  fto_name: string | null
  cert_level: string | null
  tx_license_number: string | null
  tx_license_expires_at: string | null
  tx_jurisprudence_at: string | null
  bloodborne_pathogen_at: string | null
  op_iq_access: boolean
  narc_safe_access: boolean
  op_iq_granted_at: string | null
  narc_safe_granted_at: string | null
  est_p2_ready_at: string | null
  coverage_note: string | null
  blocker_note: string | null
  notes: string | null
  updated_at: string
  person: {
    id: string
    full_name: string
    shift: string | null
    station: string | null
    title: string | null
    photo_url: string | null
    active: boolean
    account_type: string
  } | null
}

interface GateRow {
  id: string
  record_id: string
  transition: PipelineTransition
  gate_key: string
  status: GateStatus
  value: string | null
  completed_at: string | null
  note: string | null
  completed_by_user: { full_name: string } | null
}

const RECORD_SELECT =
  'id, user_id, cleared_phase, working_phase, working_started_at, working_target_at, ' +
  'pending, pip_active, pip_started_at, pip_reason, in_p3_process, in_aemt_upgrade, legacy_track, ' +
  'level, is_fto, fto_name, cert_level, tx_license_number, tx_license_expires_at, ' +
  'tx_jurisprudence_at, bloodborne_pathogen_at, op_iq_access, narc_safe_access, ' +
  'op_iq_granted_at, narc_safe_granted_at, ' +
  'est_p2_ready_at, coverage_note, blocker_note, notes, updated_at, ' +
  'person:app_users!pipeline_records_user_id_fkey(id, full_name, shift, station, title, photo_url, active, account_type)'

const GATE_SELECT =
  'id, record_id, transition, gate_key, status, value, completed_at, note, ' +
  'completed_by_user:app_users!pipeline_gate_progress_completed_by_fkey(full_name)'

function rowToRecord(r: RecordRow): PipelineRecord {
  return {
    id: r.id,
    userId: r.user_id,
    clearedPhase: r.cleared_phase,
    workingPhase: r.working_phase,
    workingStartedAt: r.working_started_at,
    workingTargetAt: r.working_target_at,
    pending: r.pending,
    pipActive: r.pip_active,
    pipStartedAt: r.pip_started_at,
    pipReason: r.pip_reason,
    inP3Process: r.in_p3_process,
    inAemtUpgrade: r.in_aemt_upgrade,
    legacyTrack: r.legacy_track,
    level: r.level,
    isFto: r.is_fto,
    ftoName: r.fto_name,
    certLevel: r.cert_level,
    txLicenseNumber: r.tx_license_number,
    txLicenseExpiresAt: r.tx_license_expires_at,
    txJurisprudenceAt: r.tx_jurisprudence_at,
    bloodbornePathogenAt: r.bloodborne_pathogen_at,
    opIqAccess: r.op_iq_access,
    narcSafeAccess: r.narc_safe_access,
    opIqGrantedAt: r.op_iq_granted_at,
    narcSafeGrantedAt: r.narc_safe_granted_at,
    estP2ReadyAt: r.est_p2_ready_at,
    coverageNote: r.coverage_note,
    blockerNote: r.blocker_note,
    notes: r.notes,
    updatedAt: r.updated_at,
  }
}

function rowToGate(r: GateRow): PipelineGateProgress {
  return {
    id: r.id,
    recordId: r.record_id,
    transition: r.transition,
    gateKey: r.gate_key,
    status: r.status,
    value: r.value,
    completedAt: r.completed_at,
    completedByName: r.completed_by_user?.full_name ?? null,
    note: r.note,
  }
}

const people = ref<PipelinePerson[]>([])
const gates = ref<PipelineGateProgress[]>([])
const phaseProgress = ref<FtepPhaseProgress[]>([])
const editorIds = ref<string[]>([])
const requirements = ref<PipelineRequirement[]>([])
const completions = ref<PipelineRequirementCompletion[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const lastFetchedAt = ref<Date | null>(null)
let loadStarted = false
let realtimeSubscribed = false
let devSeeded = false

/* Dev-stub fixture: a representative slice of the real board (active
   progression, ghost cohort, credentialed, FTO, PIP, license warning)
   so the page is testable without a live session. */
function seedDevFixture() {
  if (devSeeded) return
  devSeeded = true
  const base: Omit<PipelineRecord, 'id' | 'userId'> = {
    clearedPhase: null,
    workingPhase: null,
    workingStartedAt: null,
    workingTargetAt: null,
    pending: false,
    pipActive: false,
    pipStartedAt: null,
    pipReason: null,
    inP3Process: false,
    inAemtUpgrade: false,
    legacyTrack: false,
    level: null,
    isFto: false,
    ftoName: null,
    certLevel: null,
    txLicenseNumber: null,
    txLicenseExpiresAt: null,
    txJurisprudenceAt: null,
    bloodbornePathogenAt: null,
    opIqAccess: false,
    narcSafeAccess: false,
    opIqGrantedAt: null,
    narcSafeGrantedAt: null,
    estP2ReadyAt: null,
    coverageNote: null,
    blockerNote: null,
    notes: null,
    updatedAt: new Date().toISOString(),
  }
  const mk = (
    id: string,
    fullName: string,
    shift: string | null,
    station: string | null,
    patch: Partial<PipelineRecord>,
  ): PipelinePerson => ({
    record: { ...base, id: `rec-${id}`, userId: id, ...patch },
    userId: id,
    fullName,
    shift,
    station,
    title: null,
    photoUrl: null,
    active: true,
  })
  people.value = [
    mk('dev-1', 'Thomas Kim', 'C', '271', {
      clearedPhase: 'P1', workingPhase: 'P2', workingStartedAt: '2026-06-26',
      workingTargetAt: '2026-07-31', level: 'P1', certLevel: 'EMT-P',
      legacyTrack: true, txLicenseExpiresAt: '2027-08-31',
      opIqAccess: true, opIqGrantedAt: '2026-06-26',
      narcSafeAccess: true, narcSafeGrantedAt: '2026-06-26',
      coverageNote: 'HIGH – full truck with no P2-cap',
    }),
    mk('dev-2', 'Brianna Smith', null, null, {
      pending: true, workingPhase: 'NEOP', workingStartedAt: '2026-08-17',
      level: 'P1C', certLevel: 'EMT-P',
    }),
    mk('dev-3', 'Ashley Dodd', 'C', '242', {
      clearedPhase: 'FinalRelease', inP3Process: true, level: 'FTO', isFto: true,
      certLevel: 'LP', txLicenseExpiresAt: '2029-08-31',
    }),
    mk('dev-4', 'Cody Sholar', 'C', '231', {
      clearedPhase: 'FinalRelease', pipActive: true, pipReason: 'Documentation quality',
      level: 'ADV', certLevel: 'ADV EMT', txLicenseExpiresAt: '2029-05-31',
    }),
    mk('dev-5', 'Tristan Murphy', 'A', '206', {
      clearedPhase: 'FinalRelease', level: 'EMT', certLevel: 'EMT-B',
      txLicenseExpiresAt: '2026-09-30',
    }),
  ]
  editorIds.value = ['dev-admin']
  lastFetchedAt.value = new Date()
}

async function loadAll() {
  loading.value = true
  errorMessage.value = null
  const [recRes, gateRes, edRes, reqRes, compRes, phaseRes] = await Promise.all([
    supabase.from('pipeline_records').select(RECORD_SELECT),
    supabase.from('pipeline_gate_progress').select(GATE_SELECT),
    supabase.from('pipeline_editors').select('user_id'),
    supabase
      .from('pipeline_requirements')
      .select('id, name, cycle, active, sort, notes, required_levels')
      .order('sort'),
    supabase
      .from('pipeline_requirement_completions')
      .select('id, requirement_id, user_id, completed_at, expires_at, source, note'),
    supabase
      .from('ftep_phase_progress')
      .select('id, record_id, phase_key, fto_user_id, fto_name, started_at, completed_at, note'),
  ])
  const err =
    recRes.error ?? gateRes.error ?? edRes.error ?? reqRes.error ?? compRes.error ?? phaseRes.error
  if (err) {
    console.error('[pipeline] load failed:', err.message)
    errorMessage.value = err.message
    loading.value = false
    return
  }
  people.value = ((recRes.data ?? []) as unknown as RecordRow[])
    .filter((r) => r.person && r.person.active && r.person.account_type === 'person')
    .map((r) => ({
      record: rowToRecord(r),
      userId: r.person!.id,
      fullName: r.person!.full_name,
      shift: r.person!.shift,
      station: r.person!.station,
      title: r.person!.title,
      photoUrl: r.person!.photo_url,
      active: r.person!.active,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
  gates.value = ((gateRes.data ?? []) as unknown as GateRow[]).map(rowToGate)
  editorIds.value = (edRes.data ?? []).map((e) => e.user_id as string)
  requirements.value = (reqRes.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    cycle: r.cycle as RequirementCycle,
    active: r.active as boolean,
    sort: r.sort as number,
    notes: (r.notes ?? null) as string | null,
    requiredLevels: ((r.required_levels ?? []) as string[]),
  }))
  completions.value = (compRes.data ?? []).map((c) => ({
    id: c.id as string,
    requirementId: c.requirement_id as string,
    userId: c.user_id as string,
    completedAt: c.completed_at as string,
    expiresAt: (c.expires_at ?? null) as string | null,
    source: c.source as string,
    note: (c.note ?? null) as string | null,
  }))
  phaseProgress.value = (phaseRes.data ?? []).map((p) => ({
    id: p.id as string,
    recordId: p.record_id as string,
    phaseKey: p.phase_key as string,
    ftoUserId: (p.fto_user_id ?? null) as string | null,
    ftoName: (p.fto_name ?? null) as string | null,
    startedAt: (p.started_at ?? null) as string | null,
    completedAt: (p.completed_at ?? null) as string | null,
    note: (p.note ?? null) as string | null,
  }))
  lastFetchedAt.value = new Date()
  loading.value = false
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  /* Coalesced refetch: pipeline edits arrive in bursts (gate check-off
     + record touch), and rows need their app_users join anyway. */
  let timer: ReturnType<typeof setTimeout> | null = null
  const queueReload = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void loadAll(), 250)
  }
  supabase
    .channel('pipeline')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_records' }, queueReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_gate_progress' }, queueReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ftep_phase_progress' }, queueReload)
    .subscribe()
}

export interface SaveRecordInput extends Partial<Omit<PipelineRecord, 'id' | 'userId' | 'updatedAt'>> {
  userId: string
}

function recordPatch(input: SaveRecordInput): Record<string, unknown> {
  const map: Record<string, string> = {
    clearedPhase: 'cleared_phase',
    workingPhase: 'working_phase',
    workingStartedAt: 'working_started_at',
    workingTargetAt: 'working_target_at',
    pending: 'pending',
    pipActive: 'pip_active',
    pipStartedAt: 'pip_started_at',
    pipReason: 'pip_reason',
    inP3Process: 'in_p3_process',
    inAemtUpgrade: 'in_aemt_upgrade',
    legacyTrack: 'legacy_track',
    level: 'level',
    isFto: 'is_fto',
    ftoName: 'fto_name',
    txJurisprudenceAt: 'tx_jurisprudence_at',
    bloodbornePathogenAt: 'bloodborne_pathogen_at',
    opIqAccess: 'op_iq_access',
    narcSafeAccess: 'narc_safe_access',
    opIqGrantedAt: 'op_iq_granted_at',
    narcSafeGrantedAt: 'narc_safe_granted_at',
    estP2ReadyAt: 'est_p2_ready_at',
    coverageNote: 'coverage_note',
    blockerNote: 'blocker_note',
    notes: 'notes',
  }
  const patch: Record<string, unknown> = {}
  for (const [camel, snake] of Object.entries(map)) {
    if (camel in input) patch[snake] = (input as unknown as Record<string, unknown>)[camel]
  }
  return patch
}

export function usePipeline() {
  const auth = useAuthStore()
  const isLive = !auth.usingDevStub

  if (isLive && !loadStarted) {
    loadStarted = true
    void loadAll()
    subscribeRealtime()
  } else if (!isLive) {
    seedDevFixture()
  }

  const myUserId = computed(() => auth.appUser?.id ?? null)

  /* Person-specific grant. Dev-stub: mirror the admin toggle so the
     role switcher can exercise both UIs. */
  const canEdit = computed(() =>
    isLive ? (myUserId.value !== null && editorIds.value.includes(myUserId.value)) : auth.isAdmin,
  )

  const myRecord = computed<PipelinePerson | null>(
    () => people.value.find((p) => p.userId === myUserId.value) ?? null,
  )

  /* Board = supervisors/admins by role, editors by grant, FTOs by their
     own record flag. RLS enforces the same server-side; this just picks
     which page shell renders. */
  const canViewBoard = computed(
    () =>
      auth.isSupervisor ||
      canEdit.value ||
      (myRecord.value?.record.isFto ?? false),
  )

  const ready = computed(() => !loading.value && (lastFetchedAt.value !== null || !isLive))

  function gatesFor(recordId: string): PipelineGateProgress[] {
    return gates.value.filter((g) => g.recordId === recordId)
  }

  async function refresh() {
    if (!isLive) return
    await loadAll()
  }

  async function saveRecord(input: SaveRecordInput) {
    if (!isLive) return
    const patch = recordPatch(input)
    const existing = people.value.find((p) => p.userId === input.userId)
    if (existing) {
      const { error } = await supabase
        .from('pipeline_records')
        .update(patch)
        .eq('id', existing.record.id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('pipeline_records')
        .insert({ user_id: input.userId, ...patch })
      if (error) throw error
    }
    await loadAll()
  }

  async function setGate(
    recordId: string,
    transition: PipelineTransition,
    gateKey: string,
    status: GateStatus,
    value?: string | null,
    completedAt?: string | null,
  ) {
    if (!isLive) return
    const done = status === 'complete' || status === 'na'
    const { error } = await supabase.from('pipeline_gate_progress').upsert(
      {
        record_id: recordId,
        transition,
        gate_key: gateKey,
        status,
        value: value ?? null,
        completed_at: done ? (completedAt ?? new Date().toISOString().slice(0, 10)) : null,
        completed_by: done ? myUserId.value : null,
      },
      { onConflict: 'record_id,transition,gate_key' },
    )
    if (error) throw error
  }

  async function clearGate(recordId: string, transition: PipelineTransition, gateKey: string) {
    if (!isLive) return
    const { error } = await supabase
      .from('pipeline_gate_progress')
      .delete()
      .match({ record_id: recordId, transition, gate_key: gateKey })
    if (error) throw error
  }

  /** "+ Start onboarding": put someone into a working phase. */
  async function startOnboarding(
    userId: string,
    workingPhase: PipelinePhase,
    startedAt: string,
    targetAt: string | null,
  ) {
    await saveRecord({
      userId,
      workingPhase,
      workingStartedAt: startedAt,
      workingTargetAt: targetAt,
      pending: false,
    })
  }

  /** Promote: cleared ← working, working ← next rung (null past the top). */
  async function promote(person: PipelinePerson) {
    const r = person.record
    if (!r.workingPhase) return
    const i = PHASE_LADDER.indexOf(r.workingPhase === 'P3' ? 'P2' : r.workingPhase)
    const next = i >= 0 && i + 1 < PHASE_LADDER.length ? PHASE_LADDER[i + 1] : null
    await saveRecord({
      userId: person.userId,
      clearedPhase: r.workingPhase,
      workingPhase: next === 'FinalRelease' ? 'FinalRelease' : next,
      workingStartedAt: next ? new Date().toISOString().slice(0, 10) : null,
      workingTargetAt: null,
      pending: false,
    })
  }

  function completionsFor(userId: string): PipelineRequirementCompletion[] {
    return completions.value.filter((c) => c.userId === userId)
  }

  async function addCompletion(input: {
    requirementId: string
    userId: string
    completedAt: string
    expiresAt?: string | null
    source?: string
    note?: string | null
  }) {
    if (!isLive) return
    const { error } = await supabase.from('pipeline_requirement_completions').insert({
      requirement_id: input.requirementId,
      user_id: input.userId,
      completed_at: input.completedAt,
      expires_at: input.expiresAt ?? null,
      source: input.source ?? 'manual',
      note: input.note ?? null,
    })
    if (error) throw error
    await loadAll()
  }

  async function removeCompletion(id: string) {
    if (!isLive) return
    const { error } = await supabase.from('pipeline_requirement_completions').delete().eq('id', id)
    if (error) throw error
    await loadAll()
  }

  async function addRequirement(name: string, cycle: RequirementCycle) {
    if (!isLive) return
    const { error } = await supabase
      .from('pipeline_requirements')
      .insert({ name, cycle, sort: 200 })
    if (error) throw error
    await loadAll()
  }

  async function setRequirementActive(id: string, active: boolean) {
    if (!isLive) return
    const { error } = await supabase.from('pipeline_requirements').update({ active }).eq('id', id)
    if (error) throw error
    await loadAll()
  }

  function phasesFor(recordId: string): FtepPhaseProgress[] {
    return phaseProgress.value.filter((p) => p.recordId === recordId)
  }

  /** Upsert one phase's state (FTO assignment, start/complete dates). */
  async function setPhaseProgress(
    recordId: string,
    phaseKey: string,
    patch: {
      ftoUserId?: string | null
      ftoName?: string | null
      startedAt?: string | null
      completedAt?: string | null
      note?: string | null
    },
  ) {
    if (!isLive) return
    const existing = phaseProgress.value.find(
      (p) => p.recordId === recordId && p.phaseKey === phaseKey,
    )
    const { error } = await supabase.from('ftep_phase_progress').upsert(
      {
        record_id: recordId,
        phase_key: phaseKey,
        fto_user_id: patch.ftoUserId !== undefined ? patch.ftoUserId : (existing?.ftoUserId ?? null),
        fto_name: patch.ftoName !== undefined ? patch.ftoName : (existing?.ftoName ?? null),
        started_at: patch.startedAt !== undefined ? patch.startedAt : (existing?.startedAt ?? null),
        completed_at: patch.completedAt !== undefined ? patch.completedAt : (existing?.completedAt ?? null),
        note: patch.note !== undefined ? patch.note : (existing?.note ?? null),
      },
      { onConflict: 'record_id,phase_key' },
    )
    if (error) throw error
    await loadAll()
  }

  async function clearPhaseProgress(recordId: string, phaseKey: string) {
    if (!isLive) return
    const { error } = await supabase
      .from('ftep_phase_progress')
      .delete()
      .eq('record_id', recordId)
      .eq('phase_key', phaseKey)
    if (error) throw error
    await loadAll()
  }

  async function addEditor(userId: string) {
    if (!isLive) return
    const { error } = await supabase.from('pipeline_editors').insert({ user_id: userId })
    if (error) throw error
    await loadAll()
  }

  async function removeEditor(userId: string) {
    if (!isLive) return
    const { error } = await supabase.from('pipeline_editors').delete().eq('user_id', userId)
    if (error) throw error
    await loadAll()
  }

  return {
    people,
    gates,
    editorIds,
    requirements,
    completions,
    loading,
    ready,
    errorMessage,
    canEdit,
    canViewBoard,
    myRecord,
    gatesFor,
    phasesFor,
    setPhaseProgress,
    clearPhaseProgress,
    completionsFor,
    refresh,
    saveRecord,
    setGate,
    clearGate,
    startOnboarding,
    promote,
    addCompletion,
    removeCompletion,
    addRequirement,
    setRequirementActive,
    addEditor,
    removeEditor,
  }
}
