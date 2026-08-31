import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { ratingAverage, type FtepKind, type FtepPayload } from '@/constants/ftepForms'
import type { FtepReport } from '@/types'

/**
 * FTEP reports (DORs + ICRs). Module singleton like the other
 * composables; RLS trims the load — evaluators see everything,
 * trainees only their own submitted reports.
 *
 * Drafts are server-side rows (status 'draft'): saveDraft() creates or
 * updates, and a report started on one device resumes on another.
 */

interface ReportRow {
  id: string
  kind: FtepKind
  trainee_id: string
  evaluator_id: string
  status: 'draft' | 'submitted'
  eval_date: string
  payload: FtepPayload
  trainee_signature: string | null
  evaluator_signature: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  updated_at: string
}

const COLUMNS =
  'id, kind, trainee_id, evaluator_id, status, eval_date, payload, trainee_signature, evaluator_signature, submitted_at, reviewed_by, reviewed_at, updated_at'

function fromRow(r: ReportRow): FtepReport {
  return {
    id: r.id,
    kind: r.kind,
    traineeId: r.trainee_id,
    evaluatorId: r.evaluator_id,
    status: r.status,
    evalDate: r.eval_date,
    payload: r.payload ?? {},
    traineeSignature: r.trainee_signature,
    evaluatorSignature: r.evaluator_signature,
    submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    updatedAt: r.updated_at,
  }
}

const reports = ref<FtepReport[]>([])
const ready = ref(false)
let loadStarted = false
let realtimeSubscribed = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('ftep_reports')
    .select(COLUMNS)
    .order('eval_date', { ascending: false })
  if (error) console.error('[ftep] load:', error.message)
  reports.value = (data ?? []).map((r) => fromRow(r as ReportRow))
  ready.value = true

  if (!realtimeSubscribed) {
    realtimeSubscribed = true
    supabase
      .channel('ftep-reports')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ftep_reports' },
        async () => {
          const { data: rows } = await supabase
            .from('ftep_reports')
            .select(COLUMNS)
            .order('eval_date', { ascending: false })
          if (rows) reports.value = rows.map((r) => fromRow(r as ReportRow))
        },
      )
      .subscribe()
  }
}

export function useFtep() {
  const auth = useAuthStore()
  void load()

  const isLive = computed(() => !auth.usingDevStub)

  function reportsFor(traineeId: string): FtepReport[] {
    return reports.value.filter((r) => r.traineeId === traineeId)
  }

  function submittedFor(traineeId: string, kind?: FtepKind): FtepReport[] {
    return reportsFor(traineeId).filter(
      (r) => r.status === 'submitted' && (!kind || r.kind === kind),
    )
  }

  /** My open draft for this trainee+kind (one at a time). */
  function myDraft(traineeId: string, kind: FtepKind): FtepReport | null {
    const uid = auth.appUser?.id
    if (!uid) return null
    return (
      reports.value.find(
        (r) =>
          r.status === 'draft' &&
          r.kind === kind &&
          r.traineeId === traineeId &&
          r.evaluatorId === uid,
      ) ?? null
    )
  }

  function myDrafts(): FtepReport[] {
    const uid = auth.appUser?.id
    if (!uid) return []
    return reports.value.filter((r) => r.status === 'draft' && r.evaluatorId === uid)
  }

  /** Submitted DORs that count in the record (clinical can exclude a
   *  duplicate/erroneous one — payload.excludedFromRecord). */
  function activeDors(traineeId: string): FtepReport[] {
    return submittedFor(traineeId, 'dor').filter((r) => !r.payload.excludedFromRecord)
  }

  /** Rolling DOR average over the most recent N counting DORs. */
  function dorRollingAverage(traineeId: string, lastN = 4): number | null {
    const dors = activeDors(traineeId)
      .sort((a, b) => b.evalDate.localeCompare(a.evalDate))
      .slice(0, lastN)
    const avgs = dors
      .map((d) => d.payload.average ?? ratingAverage(d.payload.ratings))
      .filter((a): a is number => a !== null && a !== undefined)
    if (avgs.length === 0) return null
    return Math.round((avgs.reduce((x, y) => x + y, 0) / avgs.length) * 100) / 100
  }

  /** ICRs counting toward the required 10 scored ALS evaluations.
   *  For legacy trainees pass their current rung ('P1' | 'P2') — each
   *  rung needs its own 10, so evals attributed to the other rung are
   *  excluded (rows without an attribution count toward the current
   *  rung, grandfathering older entries). */
  function icrCount(traineeId: string, legacyPhase?: 'P1' | 'P2'): number {
    return submittedFor(traineeId, 'icr').filter((r) => {
      if (!r.payload.countsToward10) return false
      /* Rung attribution applies to any attributed row — historical
         Jotform imports AND portal ICRs (legacy files those too now).
         Unattributed rows grandfather into the current rung. */
      if (legacyPhase && r.payload.legacyPhase)
        return r.payload.legacyPhase === legacyPhase
      return true
    }).length
  }

  function lastDorDate(traineeId: string): string | null {
    const dors = activeDors(traineeId).sort((a, b) =>
      b.evalDate.localeCompare(a.evalDate),
    )
    return dors[0]?.evalDate ?? null
  }

  async function saveDraft(input: {
    id?: string
    kind: FtepKind
    traineeId: string
    evalDate: string
    payload: FtepPayload
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (!isLive.value) return { ok: true, id: input.id ?? 'dev-draft' }

    if (input.id) {
      const { data, error } = await supabase
        .from('ftep_reports')
        .update({ payload: input.payload, eval_date: input.evalDate })
        .eq('id', input.id)
        .select(COLUMNS)
        .single()
      if (error) return { ok: false, error: error.message }
      const row = fromRow(data as ReportRow)
      reports.value = [row, ...reports.value.filter((r) => r.id !== row.id)]
      return { ok: true, id: row.id }
    }
    const { data, error } = await supabase
      .from('ftep_reports')
      .insert({
        kind: input.kind,
        trainee_id: input.traineeId,
        evaluator_id: uid,
        status: 'draft',
        eval_date: input.evalDate,
        payload: input.payload,
      })
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReportRow)
    reports.value = [row, ...reports.value]
    return { ok: true, id: row.id }
  }

  async function submitReport(input: {
    id: string
    evalDate: string
    payload: FtepPayload
    /** Null = trainee unavailable at shift change; they're prompted to
     *  review & sign from My Progress (ftep_sign_report RPC). */
    traineeSignature: string | null
    evaluatorSignature: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: true }
    const { data, error } = await supabase
      .from('ftep_reports')
      .update({
        status: 'submitted',
        eval_date: input.evalDate,
        payload: input.payload,
        trainee_signature: input.traineeSignature,
        evaluator_signature: input.evaluatorSignature,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', input.id)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReportRow)
    reports.value = [row, ...reports.value.filter((r) => r.id !== row.id)]
    return { ok: true }
  }

  /** Trainee adds their deferred signature (view-only flow — the RPC
   *  only accepts their own submitted, still-unsigned report). */
  async function signAsTrainee(
    reportId: string,
    signature: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: true }
    const { data, error } = await supabase.rpc('ftep_sign_report', {
      p_report_id: reportId,
      p_signature: signature,
    })
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: 'This report can no longer be signed.' }
    reports.value = reports.value.map((r) =>
      r.id === reportId ? { ...r, traineeSignature: signature } : r,
    )
    return { ok: true }
  }

  /** Clinical triage: include/exclude an ICR from the required 10,
   *  documenting why (editors only — RLS enforces). */
  async function setIcrCounts(
    reportId: string,
    counts: boolean,
    reason?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: true }
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return { ok: false, error: 'Report not found.' }
    const payload: FtepPayload = {
      ...report.payload,
      countsToward10: counts,
      triageNote: counts ? undefined : (reason?.trim() || undefined),
    }
    const { data, error } = await supabase
      .from('ftep_reports')
      .update({ payload })
      .eq('id', reportId)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReportRow)
    reports.value = reports.value.map((r) => (r.id === row.id ? row : r))
    return { ok: true }
  }

  /** Clinical triage (DOR): exclude a DOR from the record — it drops
   *  out of the rolling average, rideout counts, and scheduled-day
   *  matching. Reason documented like ICR triage; reversible. */
  async function setDorExcluded(
    reportId: string,
    excluded: boolean,
    reason?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: true }
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return { ok: false, error: 'Report not found.' }
    const payload: FtepPayload = {
      ...report.payload,
      excludedFromRecord: excluded || undefined,
      triageNote: excluded ? (reason?.trim() || undefined) : undefined,
    }
    const { data, error } = await supabase
      .from('ftep_reports')
      .update({ payload })
      .eq('id', reportId)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReportRow)
    reports.value = reports.value.map((r) => (r.id === row.id ? row : r))
    return { ok: true }
  }

  async function discardDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: true }
    const { error } = await supabase.from('ftep_reports').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    reports.value = reports.value.filter((r) => r.id !== id)
    return { ok: true }
  }

  /** Legacy-track call eval recorded manually from Jotform (until the
   *  webhook automates it): a submitted ICR row with no ratings or
   *  signatures — it exists to drive the x/10 count. */
  async function recordLegacyCallEval(input: {
    traineeId: string
    evalDate: string
    note?: string
    /** Which legacy rung this eval counts toward. */
    legacyPhase?: 'P1' | 'P2'
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (!isLive.value) return { ok: true }
    const { data, error } = await supabase
      .from('ftep_reports')
      .insert({
        kind: 'icr',
        trainee_id: input.traineeId,
        evaluator_id: uid,
        status: 'submitted',
        eval_date: input.evalDate,
        payload: {
          countsToward10: true,
          legacyManual: true,
          legacyPhase: input.legacyPhase,
          note: input.note?.trim() || undefined,
        },
        submitted_at: new Date().toISOString(),
      })
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    reports.value = [fromRow(data as ReportRow), ...reports.value]
    return { ok: true }
  }

  /** CDO acknowledgement — clears the "new reports" queue item. */
  async function markReviewed(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!isLive.value || !uid) return { ok: true }
    const { data, error } = await supabase
      .from('ftep_reports')
      .update({ reviewed_by: uid, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReportRow)
    reports.value = [row, ...reports.value.filter((r) => r.id !== row.id)]
    return { ok: true }
  }

  const unreviewed = computed(() =>
    reports.value.filter((r) => r.status === 'submitted' && !r.reviewedAt),
  )

  function reportById(id: string): FtepReport | null {
    return reports.value.find((r) => r.id === id) ?? null
  }

  return {
    ready,
    reports,
    reportsFor,
    submittedFor,
    activeDors,
    myDraft,
    myDrafts,
    dorRollingAverage,
    icrCount,
    lastDorDate,
    saveDraft,
    submitReport,
    signAsTrainee,
    setIcrCounts,
    setDorExcluded,
    recordLegacyCallEval,
    discardDraft,
    markReviewed,
    unreviewed,
    reportById,
  }
}
