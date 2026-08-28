import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Protocol examinations. Candidates never receive answers — the
 * definitions carry questions only and grading happens in the
 * exam_submit RPC. RLS scopes the loads: editors see everything;
 * a candidate sees a definition only once their assignment is
 * released, and only their own assignments. Realtime keeps the
 * "waiting on proctor release" state live.
 */

export interface ExamQuestion {
  no: number
  section: string | null
  text: string
  options: Record<string, string>
  /** 'multi' = select-all-that-apply (graded as an exact set). */
  type?: 'single' | 'multi'
  /** Image filename in exam-assets/<slug>/. */
  image?: string
  critical?: boolean
}

/** Single answers are letters; multi-select answers are letter arrays. */
export type ExamAnswers = Record<string, string | string[]>

export interface ExamDefinition {
  id: string
  title: string
  slug: string | null
  timeLimitMinutes: number
  passingPct: number
  instructions: string | null
  questions: ExamQuestion[]
  active: boolean
}

export type ExamAssignmentStatus = 'assigned' | 'released' | 'in_progress' | 'submitted' | 'cancelled'

export interface ExamAssignment {
  id: string
  examId: string
  userId: string
  status: ExamAssignmentStatus
  assignedAt: string
  releasedAt: string | null
  startedAt: string | null
  submittedAt: string | null
  answers: ExamAnswers
  scorePct: number | null
  passed: boolean | null
  criticalMissed: number[] | null
}

const DEF_COLUMNS = 'id, title, slug, time_limit_minutes, passing_pct, instructions, questions, active'
const ASSIGN_COLUMNS =
  'id, exam_id, user_id, status, assigned_at, released_at, started_at, submitted_at, answers, score_pct, passed, critical_missed'

const definitions = ref<ExamDefinition[]>([])
const assignments = ref<ExamAssignment[]>([])
const ready = ref(false)
let loadStarted = false
let realtimeSubscribed = false

/* eslint-disable @typescript-eslint/no-explicit-any */
function defFromRow(r: any): ExamDefinition {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    timeLimitMinutes: r.time_limit_minutes,
    passingPct: r.passing_pct,
    instructions: r.instructions,
    questions: (r.questions ?? []) as ExamQuestion[],
    active: r.active,
  }
}

function assignFromRow(r: any): ExamAssignment {
  return {
    id: r.id,
    examId: r.exam_id,
    userId: r.user_id,
    status: r.status,
    assignedAt: r.assigned_at,
    releasedAt: r.released_at,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    answers: (r.answers ?? {}) as ExamAnswers,
    scorePct: r.score_pct !== null ? Number(r.score_pct) : null,
    passed: r.passed,
    criticalMissed: (r.critical_missed ?? null) as number[] | null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function loadAll() {
  const [defRes, asgRes] = await Promise.all([
    supabase.from('exam_definitions').select(DEF_COLUMNS).order('title'),
    supabase.from('exam_assignments').select(ASSIGN_COLUMNS).order('assigned_at', { ascending: false }),
  ])
  definitions.value = (defRes.data ?? []).map(defFromRow)
  assignments.value = (asgRes.data ?? []).map(assignFromRow)
  ready.value = true
}

function startLoad() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  void loadAll()
  if (!realtimeSubscribed) {
    realtimeSubscribed = true
    supabase
      .channel('exam-assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_assignments' }, () => void loadAll())
      .subscribe()
  }
}

export function useExams() {
  const auth = useAuthStore()
  startLoad()

  const activeDefinitions = computed(() => definitions.value.filter((d) => d.active))

  const myAssignments = computed(() =>
    assignments.value.filter(
      (a) => a.userId === auth.appUser?.id && a.status !== 'cancelled',
    ),
  )

  function assignmentsFor(userId: string): ExamAssignment[] {
    return assignments.value.filter((a) => a.userId === userId)
  }

  function definitionById(id: string): ExamDefinition | null {
    return definitions.value.find((d) => d.id === id) ?? null
  }

  function assignmentById(id: string): ExamAssignment | null {
    return assignments.value.find((a) => a.id === id) ?? null
  }

  /* Editor actions */
  async function assign(examId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase.from('exam_assignments').insert({
      exam_id: examId,
      user_id: userId,
      assigned_by: auth.appUser?.id ?? null,
    })
    if (error) return { ok: false, error: error.message }
    await loadAll()
    return { ok: true }
  }

  async function release(assignmentId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from('exam_assignments')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('id', assignmentId)
    if (error) return { ok: false, error: error.message }
    await loadAll()
    return { ok: true }
  }

  async function cancel(assignmentId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from('exam_assignments')
      .update({ status: 'cancelled' })
      .eq('id', assignmentId)
    if (error) return { ok: false, error: error.message }
    await loadAll()
    return { ok: true }
  }

  /* Candidate flow (RPCs — the only write path for candidates) */
  async function start(assignmentId: string): Promise<{ ok: boolean; startedAt?: string; error?: string }> {
    const { data, error } = await supabase.rpc('exam_start', { p_assignment: assignmentId })
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: 'This exam has not been released by your proctor yet.' }
    await loadAll()
    return { ok: true, startedAt: data as string }
  }

  async function saveAnswers(assignmentId: string, answers: ExamAnswers): Promise<boolean> {
    const { data } = await supabase.rpc('exam_save', { p_assignment: assignmentId, p_answers: answers })
    return !!data
  }

  async function submit(
    assignmentId: string,
    answers: ExamAnswers,
  ): Promise<{ ok: boolean; scorePct?: number; passed?: boolean; passingPct?: number; criticalMissed?: number[]; error?: string }> {
    const { data, error } = await supabase.rpc('exam_submit', {
      p_assignment: assignmentId,
      p_answers: answers,
    })
    if (error) return { ok: false, error: error.message }
    const r = data as { ok: boolean; error?: string; score_pct?: number; passed?: boolean; passing_pct?: number; critical_missed?: number[] }
    if (!r.ok) return { ok: false, error: r.error }
    await loadAll()
    return {
      ok: true,
      scorePct: Number(r.score_pct),
      passed: !!r.passed,
      passingPct: r.passing_pct,
      criticalMissed: r.critical_missed ?? [],
    }
  }

  return {
    ready,
    definitions,
    activeDefinitions,
    assignments,
    myAssignments,
    assignmentsFor,
    definitionById,
    assignmentById,
    assign,
    release,
    cancel,
    start,
    saveAnswers,
    submit,
    refresh: loadAll,
  }
}
