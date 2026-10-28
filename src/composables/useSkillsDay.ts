import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type {
  SkillsCheckoff,
  SkillsCheckoffSection,
  SkillsDayCandidate,
  SkillsDaySession,
  SkillsEvaluation,
  SkillsRecheck,
  SkillItemResult,
} from '@/types'

/**
 * NEOP Skills Day: checkoff definitions, candidate roster (the pending
 * pipeline cohort), evaluations with realtime for the live board, and
 * the evaluator grant list.
 *
 * Evaluator status comes from the DB helper via the role model:
 * admins + supervisors are evaluators by role; FTOs and person-grants
 * are resolved from the loaded pipeline/grant data client-side (RLS
 * enforces the real rule server-side).
 */

interface CheckoffRow {
  id: string
  key: string
  title: string
  subtitle: string
  note: string
  sections: SkillsCheckoffSection[]
  sort: number
  active: boolean
  equipment: string[] | null
}

interface EvaluationRow {
  id: string
  checkoff_id: string
  candidate_id: string
  evaluator_id: string
  eval_date: string
  items: Record<string, { result: SkillItemResult; comment?: string; label?: string }>
  overall: 'pass' | 'remediation'
  candidate_signature: string | null
  evaluator_signature: string | null
  recorded_by: string | null
  recorded_note: string | null
  submitted_at: string
  rechecks: SkillsRecheck[]
}

export interface SkillsCandidate {
  id: string
  fullName: string
  title: string | null
}

const EVAL_COLUMNS =
  'id, checkoff_id, candidate_id, evaluator_id, eval_date, items, overall, candidate_signature, evaluator_signature, recorded_by, recorded_note, submitted_at, rechecks'

function checkoffFromRow(r: CheckoffRow): SkillsCheckoff {
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    subtitle: r.subtitle,
    note: r.note,
    sections: r.sections ?? [],
    sort: r.sort,
    active: r.active,
    equipment: r.equipment ?? null,
  }
}

function evalFromRow(r: EvaluationRow): SkillsEvaluation {
  return {
    id: r.id,
    checkoffId: r.checkoff_id,
    candidateId: r.candidate_id,
    evaluatorId: r.evaluator_id,
    evalDate: r.eval_date,
    items: r.items ?? {},
    overall: r.overall,
    candidateSignature: r.candidate_signature,
    evaluatorSignature: r.evaluator_signature,
    recordedBy: r.recorded_by,
    recordedNote: r.recorded_note,
    submittedAt: r.submitted_at,
    rechecks: r.rechecks ?? [],
  }
}

/* Every checkoff (incl. inactive) for the admin Setup surface; the
   exported `checkoffs` keeps its original meaning of active-only so
   the board, runner, and clinical file behave unchanged. */
const allCheckoffs = ref<SkillsCheckoff[]>([])
const checkoffs = computed(() => allCheckoffs.value.filter((c) => c.active))
const evaluations = ref<SkillsEvaluation[]>([])
const candidates = ref<SkillsCandidate[]>([])
const days = ref<SkillsDaySession[]>([])
const dayStationIds = ref<Record<string, string[]>>({})
const dayCandidates = ref<Record<string, SkillsDayCandidate[]>>({})
const evaluatorIds = ref<string[]>([])
const ftoIds = ref<string[]>([])
const peopleNames = ref<Record<string, string>>({})
const ready = ref(false)
let loadStarted = false
let realtimeSubscribed = false

function sortDays(list: SkillsDaySession[]): SkillsDaySession[] {
  return [...list].sort((a, b) => a.onDate.localeCompare(b.onDate) || a.label.localeCompare(b.label))
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    allCheckoffs.value = [
      {
        id: 'co-airway',
        key: 'airway',
        title: 'Airway',
        subtitle: 'Morning Rotation · Station 1',
        note: 'Scenario covers the core airway sequence; bench demos after.',
        sort: 1,
        active: true,
        equipment: ['Airway manikin', 'BVM + masks', 'Suction unit'],
        sections: [
          {
            title: 'Scenario core',
            items: [
              { key: 'airway_assessment', label: 'Airway assessment performed' },
              { key: 'intubation', label: 'Intubation' },
              { key: 'cric', label: 'Cricothyrotomy simulation' },
            ],
          },
          {
            title: 'Bench demonstrations',
            items: [
              { key: 'npa', label: 'NPA insertion' },
              { key: 'cpap', label: 'CPAP setup' },
            ],
          },
        ],
      },
      {
        id: 'co-trauma',
        key: 'trauma',
        title: 'Trauma',
        subtitle: 'Morning Rotation · Station 3',
        note: 'Relay circuit. Automatic remediation triggers: failure to recognize a life threat · improper tourniquet placement · loss of spinal precautions.',
        sort: 3,
        active: true,
        equipment: null,
        sections: [
          {
            title: 'Relay circuit',
            items: [
              { key: 'primary_survey', label: 'Primary trauma survey' },
              { key: 'tourniquet', label: 'Tourniquet application' },
            ],
          },
        ],
      },
    ]
    candidates.value = [
      { id: 'cand-1', fullName: 'Brianna Smith', title: 'Paramedic' },
      { id: 'cand-2', fullName: 'Dennis Ho', title: 'EMT' },
      { id: 'cand-3', fullName: 'Tara Roth', title: 'Paramedic' },
    ]
    peopleNames.value = {
      'cand-1': 'Brianna Smith',
      'cand-2': 'Dennis Ho',
      'cand-3': 'Tara Roth',
      'dev-admin': 'Dev Admin',
      '1507': 'Justin St. John',
    }
    const today = new Date()
    const plus = (n: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() + n)
      return d.toISOString().slice(0, 10)
    }
    days.value = [
      { id: 'dev-day-1', onDate: plus(0), label: 'Session 1', note: '', active: true },
      { id: 'dev-day-2', onDate: plus(2), label: 'Session 2', note: '', active: true },
    ]
    dayStationIds.value = {
      'dev-day-1': ['co-airway'],
      'dev-day-2': ['co-airway', 'co-trauma'],
    }
    dayCandidates.value = {
      'dev-day-1': [
        { userId: 'cand-1', stationIds: null },
        { userId: 'cand-2', stationIds: null },
      ],
      'dev-day-2': [
        { userId: 'cand-2', stationIds: ['co-trauma'] },
        { userId: 'cand-3', stationIds: null },
      ],
    }
    ready.value = true
    return
  }

  const [cRes, eRes, candRes, dRes, dsRes, dcRes, gRes, ftoRes, namesRes] = await Promise.all([
    supabase.from('skills_checkoffs').select('*').order('sort'),
    supabase.from('skills_evaluations').select(EVAL_COLUMNS),
    /* Candidates = the pending pipeline cohort, via SECURITY DEFINER
       RPC so grant-only evaluators (no pipeline visibility) still get
       the list. */
    supabase.rpc('skills_candidates'),
    supabase.from('skills_days').select('*').order('on_date'),
    supabase.from('skills_day_stations').select('day_id, checkoff_id'),
    supabase.from('skills_day_candidates').select('day_id, user_id, station_ids'),
    supabase.from('skills_evaluators').select('user_id'),
    supabase.from('pipeline_records').select('user_id').eq('is_fto', true),
    supabase
      .from('app_users')
      .select('id, full_name')
      .eq('account_type', 'person'),
  ])

  if (cRes.error) console.error('[skills] checkoffs load:', cRes.error.message)
  if (eRes.error) console.error('[skills] evaluations load:', eRes.error.message)
  if (candRes.error) console.error('[skills] candidates load:', candRes.error.message)
  if (dRes.error) console.error('[skills] days load:', dRes.error.message)

  allCheckoffs.value = (cRes.data ?? []).map((r) => checkoffFromRow(r as unknown as CheckoffRow))
  evaluations.value = (eRes.data ?? []).map((r) => evalFromRow(r as EvaluationRow))
  candidates.value = ((candRes.data ?? []) as unknown as Array<{
    id: string
    full_name: string
    title: string | null
  }>).map((r) => ({ id: r.id, fullName: r.full_name, title: r.title }))
  days.value = sortDays(
    ((dRes.data ?? []) as Array<{
      id: string
      on_date: string
      label: string
      note: string
      active: boolean
    }>).map((r) => ({
      id: r.id,
      onDate: r.on_date,
      label: r.label,
      note: r.note,
      active: r.active,
    })),
  )
  const dsMap: Record<string, string[]> = {}
  for (const r of (dsRes.data ?? []) as Array<{ day_id: string; checkoff_id: string }>) {
    ;(dsMap[r.day_id] ??= []).push(r.checkoff_id)
  }
  dayStationIds.value = dsMap
  const dcMap: Record<string, SkillsDayCandidate[]> = {}
  for (const r of (dcRes.data ?? []) as Array<{
    day_id: string
    user_id: string
    station_ids: string[] | null
  }>) {
    ;(dcMap[r.day_id] ??= []).push({ userId: r.user_id, stationIds: r.station_ids })
  }
  dayCandidates.value = dcMap
  evaluatorIds.value = (gRes.data ?? []).map((r) => r.user_id as string)
  ftoIds.value = (ftoRes.data ?? []).map((r) => r.user_id as string)
  peopleNames.value = Object.fromEntries(
    ((namesRes.data ?? []) as Array<{ id: string; full_name: string }>).map((r) => [
      r.id,
      r.full_name,
    ]),
  )

  subscribeRealtime()
  ready.value = true
}

function upsertLocal(row: EvaluationRow) {
  const next = evalFromRow(row)
  evaluations.value = [
    ...evaluations.value.filter((e) => e.id !== next.id),
    next,
  ]
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('skills_evaluations')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'skills_evaluations' },
      (payload) => upsertLocal(payload.new as EvaluationRow),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'skills_evaluations' },
      (payload) => upsertLocal(payload.new as EvaluationRow),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'skills_evaluations' },
      (payload) => {
        const oldId = (payload.old as { id?: string }).id
        if (oldId) evaluations.value = evaluations.value.filter((e) => e.id !== oldId)
      },
    )
    .subscribe()
}

export function useSkillsDay() {
  const auth = useAuthStore()
  void load()

  const isEvaluator = computed(() => {
    const uid = auth.appUser?.id
    if (!uid) return false
    if (auth.isAdmin || auth.isSupervisor) return true
    return ftoIds.value.includes(uid) || evaluatorIds.value.includes(uid)
  })

  function nameFor(userId: string): string {
    return peopleNames.value[userId] ?? 'Unknown'
  }

  function evaluationFor(checkoffId: string, candidateId: string): SkillsEvaluation | null {
    return (
      evaluations.value.find(
        (e) => e.checkoffId === checkoffId && e.candidateId === candidateId,
      ) ?? null
    )
  }

  function checkoffById(id: string): SkillsCheckoff | null {
    /* Includes inactive stations so old records still resolve. */
    return allCheckoffs.value.find((c) => c.id === id) ?? null
  }

  function candidateById(id: string): SkillsCandidate | null {
    const fromCohort = candidates.value.find((c) => c.id === id)
    if (fromCohort) return fromCohort
    /* Day-assigned trainees may not be in the pending pipeline cohort —
       resolve their name from the staff directory instead. */
    const name = peopleNames.value[id]
    return name ? { id, fullName: name, title: null } : null
  }

  /* ── Skills Day sessions ──────────────────────────────────────────
     With a day selected, the board shows exactly the stations
     scheduled that day × the trainees assigned to it; a null dayId is
     the unscoped view (every active station × the pipeline cohort
     plus anyone assigned to any day). */

  function stationsForDay(dayId: string | null): SkillsCheckoff[] {
    if (!dayId) return checkoffs.value
    const ids = dayStationIds.value[dayId] ?? []
    return checkoffs.value.filter((c) => ids.includes(c.id))
  }

  function candidatesForDay(dayId: string | null): SkillsCandidate[] {
    if (!dayId) {
      const seen = new Set(candidates.value.map((c) => c.id))
      const extra: SkillsCandidate[] = []
      for (const list of Object.values(dayCandidates.value)) {
        for (const entry of list) {
          if (seen.has(entry.userId)) continue
          seen.add(entry.userId)
          const c = candidateById(entry.userId)
          if (c) extra.push(c)
        }
      }
      return [...candidates.value, ...extra].sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      )
    }
    return (dayCandidates.value[dayId] ?? [])
      .map((entry) => candidateById(entry.userId))
      .filter((c): c is SkillsCandidate => c !== null)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }

  /* Whether a station applies to a trainee on a day (their assignment
     may be scoped to specific stations). */
  function appliesTo(dayId: string | null, checkoffId: string, userId: string): boolean {
    if (!dayId) return true
    const entry = (dayCandidates.value[dayId] ?? []).find((e) => e.userId === userId)
    if (!entry) return false
    return entry.stationIds === null || entry.stationIds.includes(checkoffId)
  }

  /* Admin: create/update a Skills Day with its station schedule and
     trainee roster in one save. */
  async function saveDayFull(input: {
    id?: string
    onDate: string
    label: string
    note: string
    active: boolean
    stationIds: string[]
    candidates: SkillsDayCandidate[]
  }): Promise<{ ok: boolean; error?: string }> {
    const normalized = input.candidates.map((c) => ({
      userId: c.userId,
      stationIds: c.stationIds && c.stationIds.length ? c.stationIds : null,
    }))
    if (auth.usingDevStub) {
      const id = input.id ?? `dev-day-${Date.now()}`
      const row: SkillsDaySession = {
        id,
        onDate: input.onDate,
        label: input.label,
        note: input.note,
        active: input.active,
      }
      days.value = sortDays([...days.value.filter((d) => d.id !== id), row])
      dayStationIds.value = { ...dayStationIds.value, [id]: [...input.stationIds] }
      dayCandidates.value = { ...dayCandidates.value, [id]: normalized }
      return { ok: true }
    }
    let dayId = input.id ?? null
    if (dayId) {
      const { error } = await supabase
        .from('skills_days')
        .update({
          on_date: input.onDate,
          label: input.label,
          note: input.note,
          active: input.active,
        })
        .eq('id', dayId)
      if (error) return { ok: false, error: error.message }
    } else {
      const { data, error } = await supabase
        .from('skills_days')
        .insert({
          on_date: input.onDate,
          label: input.label,
          note: input.note,
          active: input.active,
        })
        .select('id')
        .single()
      if (error) return { ok: false, error: error.message }
      dayId = (data as { id: string }).id
    }
    {
      const { error } = await supabase.from('skills_day_stations').delete().eq('day_id', dayId)
      if (error) return { ok: false, error: error.message }
    }
    if (input.stationIds.length) {
      const { error } = await supabase
        .from('skills_day_stations')
        .insert(input.stationIds.map((checkoff_id) => ({ day_id: dayId, checkoff_id })))
      if (error) return { ok: false, error: error.message }
    }
    {
      const { error } = await supabase.from('skills_day_candidates').delete().eq('day_id', dayId)
      if (error) return { ok: false, error: error.message }
    }
    if (normalized.length) {
      const { error } = await supabase.from('skills_day_candidates').insert(
        normalized.map((c) => ({
          day_id: dayId,
          user_id: c.userId,
          station_ids: c.stationIds,
        })),
      )
      if (error) return { ok: false, error: error.message }
    }
    const row: SkillsDaySession = {
      id: dayId,
      onDate: input.onDate,
      label: input.label,
      note: input.note,
      active: input.active,
    }
    days.value = sortDays([...days.value.filter((d) => d.id !== dayId), row])
    dayStationIds.value = { ...dayStationIds.value, [dayId]: [...input.stationIds] }
    dayCandidates.value = { ...dayCandidates.value, [dayId]: normalized }
    return { ok: true }
  }

  async function deleteDay(dayId: string): Promise<{ ok: boolean; error?: string }> {
    if (!auth.usingDevStub) {
      const { error } = await supabase.from('skills_days').delete().eq('id', dayId)
      if (error) return { ok: false, error: error.message }
    }
    days.value = days.value.filter((d) => d.id !== dayId)
    const ds = { ...dayStationIds.value }
    delete ds[dayId]
    dayStationIds.value = ds
    const dc = { ...dayCandidates.value }
    delete dc[dayId]
    dayCandidates.value = dc
    return { ok: true }
  }

  /* ── Station (checkoff) management ────────────────────────────── */

  function slugKey(title: string): string {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'station'
    let key = base
    let n = 2
    while (allCheckoffs.value.some((c) => c.key === key)) key = `${base}_${n++}`
    return key
  }

  async function saveCheckoff(input: {
    id?: string
    title: string
    subtitle: string
    note: string
    sort: number
    active: boolean
    sections: SkillsCheckoffSection[]
    equipment: string[] | null
  }): Promise<{ ok: boolean; error?: string }> {
    if (auth.usingDevStub) {
      const id = input.id ?? `dev-co-${Date.now()}`
      const next: SkillsCheckoff = {
        id,
        key: allCheckoffs.value.find((c) => c.id === id)?.key ?? slugKey(input.title),
        title: input.title,
        subtitle: input.subtitle,
        note: input.note,
        sections: input.sections,
        sort: input.sort,
        active: input.active,
        equipment: input.equipment,
      }
      allCheckoffs.value = [...allCheckoffs.value.filter((c) => c.id !== id), next].sort(
        (a, b) => a.sort - b.sort || a.title.localeCompare(b.title),
      )
      return { ok: true }
    }
    if (input.id) {
      const { data, error } = await supabase
        .from('skills_checkoffs')
        .update({
          title: input.title,
          subtitle: input.subtitle,
          note: input.note,
          sort: input.sort,
          active: input.active,
          sections: input.sections,
          equipment: input.equipment,
        })
        .eq('id', input.id)
        .select('*')
        .single()
      if (error) return { ok: false, error: error.message }
      const next = checkoffFromRow(data as unknown as CheckoffRow)
      allCheckoffs.value = allCheckoffs.value
        .map((c) => (c.id === next.id ? next : c))
        .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('skills_checkoffs')
      .insert({
        key: slugKey(input.title),
        title: input.title,
        subtitle: input.subtitle,
        note: input.note,
        sort: input.sort,
        active: input.active,
        sections: input.sections,
        equipment: input.equipment,
      })
      .select('*')
      .single()
    if (error) return { ok: false, error: error.message }
    const next = checkoffFromRow(data as unknown as CheckoffRow)
    allCheckoffs.value = [...allCheckoffs.value, next].sort(
      (a, b) => a.sort - b.sort || a.title.localeCompare(b.title),
    )
    return { ok: true }
  }

  /* Deleting a station cascades to its evaluations — the Setup panel
     only offers it when none exist. */
  async function deleteCheckoff(checkoffId: string): Promise<{ ok: boolean; error?: string }> {
    if (evaluations.value.some((e) => e.checkoffId === checkoffId))
      return { ok: false, error: 'This station has recorded check-offs — mark it inactive instead.' }
    if (!auth.usingDevStub) {
      const { error } = await supabase.from('skills_checkoffs').delete().eq('id', checkoffId)
      if (error) return { ok: false, error: error.message }
    }
    allCheckoffs.value = allCheckoffs.value.filter((c) => c.id !== checkoffId)
    return { ok: true }
  }

  /* Redo item keys still outstanding on an evaluation. */
  function redoKeys(e: SkillsEvaluation): string[] {
    return Object.entries(e.items)
      .filter(([, v]) => v.result === 'redo')
      .map(([k]) => k)
  }

  async function submitEvaluation(input: {
    checkoffId: string
    candidateId: string
    items: Record<string, { result: SkillItemResult; comment?: string; label?: string }>
    candidateSignature: string
    /** Absent when recording on another evaluator's behalf. */
    evaluatorSignature?: string
    /** app_user id of the instructor who actually ran the station —
     *  set only when they can't sign personally; the current user is
     *  stamped as recorded_by. */
    onBehalfOfId?: string
    /** Optional context for a proxy sign-off. */
    recordedNote?: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    const overall = Object.values(input.items).some((v) => v.result === 'redo')
      ? 'remediation'
      : 'pass'
    if (auth.usingDevStub) {
      upsertLocal({
        id: `dev-${input.checkoffId}-${input.candidateId}`,
        checkoff_id: input.checkoffId,
        candidate_id: input.candidateId,
        evaluator_id: input.onBehalfOfId ?? uid,
        eval_date: new Date().toISOString().slice(0, 10),
        items: input.items,
        overall,
        candidate_signature: input.candidateSignature,
        evaluator_signature: input.onBehalfOfId ? null : (input.evaluatorSignature ?? null),
        recorded_by: input.onBehalfOfId ? uid : null,
        recorded_note: input.onBehalfOfId ? (input.recordedNote?.trim() || null) : null,
        submitted_at: new Date().toISOString(),
        rechecks: [],
      })
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('skills_evaluations')
      .upsert(
        {
          checkoff_id: input.checkoffId,
          candidate_id: input.candidateId,
          evaluator_id: input.onBehalfOfId ?? uid,
          items: input.items,
          overall,
          candidate_signature: input.candidateSignature,
          evaluator_signature: input.onBehalfOfId ? null : (input.evaluatorSignature ?? null),
          recorded_by: input.onBehalfOfId ? uid : null,
          recorded_note: input.onBehalfOfId ? (input.recordedNote?.trim() || null) : null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: 'checkoff_id,candidate_id' },
      )
      .select(EVAL_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    upsertLocal(data as EvaluationRow)
    return { ok: true }
  }

  /* Second-attempt: clear specific redo items to pass, log the recheck
     with fresh signatures, recompute overall. */
  async function submitRecheck(input: {
    evaluationId: string
    clearedKeys: string[]
    comments: Record<string, string>
    candidateSignature: string
    evaluatorSignature: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    const existing = evaluations.value.find((e) => e.id === input.evaluationId)
    if (!existing) return { ok: false, error: 'Evaluation not found.' }

    const items = { ...existing.items }
    for (const key of input.clearedKeys) {
      const prev = items[key]
      items[key] = {
        result: 'pass',
        label: prev?.label,
        comment:
          [prev?.comment, input.comments[key]].filter(Boolean).join(' · ') || undefined,
      }
    }
    const overall = Object.values(items).some((v) => v.result === 'redo')
      ? 'remediation'
      : 'pass'
    const recheck: SkillsRecheck = {
      at: new Date().toISOString(),
      evaluatorId: uid,
      items: input.clearedKeys,
      candidateSignature: input.candidateSignature,
      evaluatorSignature: input.evaluatorSignature,
    }
    if (auth.usingDevStub) {
      evaluations.value = evaluations.value.map((e) =>
        e.id === existing.id
          ? { ...e, items, overall, rechecks: [...e.rechecks, recheck] }
          : e,
      )
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('skills_evaluations')
      .update({
        items,
        overall,
        rechecks: [...existing.rechecks, recheck],
      })
      .eq('id', input.evaluationId)
      .select(EVAL_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    upsertLocal(data as EvaluationRow)
    return { ok: true }
  }

  /* Admin: manage the extras grant list. */
  async function addEvaluator(userId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.from('skills_evaluators').insert({ user_id: userId })
    if (error && !error.message.includes('duplicate')) return { ok: false, error: error.message }
    if (!evaluatorIds.value.includes(userId))
      evaluatorIds.value = [...evaluatorIds.value, userId]
    return { ok: true }
  }

  async function removeEvaluator(userId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.from('skills_evaluators').delete().eq('user_id', userId)
    if (error) return { ok: false, error: error.message }
    evaluatorIds.value = evaluatorIds.value.filter((id) => id !== userId)
    return { ok: true }
  }

  /* Admin: replace one checkoff's item lists (the dose-and-draw list
     "may change on the day"). */
  async function saveCheckoffSections(
    checkoffId: string,
    sections: SkillsCheckoffSection[],
  ): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await supabase
      .from('skills_checkoffs')
      .update({ sections })
      .eq('id', checkoffId)
      .select('*')
      .single()
    if (error) return { ok: false, error: error.message }
    const next = checkoffFromRow(data as unknown as CheckoffRow)
    allCheckoffs.value = allCheckoffs.value.map((c) => (c.id === next.id ? next : c))
    return { ok: true }
  }

  return {
    ready,
    checkoffs,
    allCheckoffs,
    evaluations,
    candidates,
    days,
    dayStationIds,
    dayCandidates,
    evaluatorIds,
    isEvaluator,
    nameFor,
    peopleNames,
    evaluationFor,
    checkoffById,
    candidateById,
    stationsForDay,
    candidatesForDay,
    appliesTo,
    redoKeys,
    submitEvaluation,
    submitRecheck,
    saveDayFull,
    deleteDay,
    saveCheckoff,
    deleteCheckoff,
    addEvaluator,
    removeEvaluator,
    saveCheckoffSections,
  }
}
