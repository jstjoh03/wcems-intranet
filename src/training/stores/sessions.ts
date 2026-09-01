import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  ArchiveFile,
  Attendee,
  CertLevel,
  CourseSession,
  EngagementCode,
  EngagementResponse,
  EvalRecord,
  LectureQuiz,
  OpenClosed,
  PendingEcard,
  QuizQuestion,
  QuizSubmission,
  TrainingCourse,
} from '@/training/types'
import { supabase, invokeEdge } from '@/training/lib/supabase'
import { archiveFile } from '@/training/lib/archive'
import { useAuthStore } from './auth'

// ─── Row → domain mappers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(r: any): CourseSession {
  return {
    id: r.id,
    sessionId: r.session_id,
    sessionType: r.session_type,
    title: r.title ?? '',
    classDate: r.class_date ?? '',
    startTime: r.start_time ?? '',
    endTime: r.end_time ?? '',
    location: r.location ?? '',
    cardCourseName: r.card_course_name ?? '',
    lectureTitle: r.lecture_title ?? '',
    dshsContentArea: r.dshs_content_area ?? '',
    hoursAwarded: r.hours_awarded ?? '',
    maxSeats: r.max_seats ?? null,
    verificationPointsRequired: r.verification_points_required ?? null,
    primaryInstructorName: r.primary_instructor_name ?? '',
    primaryInstructorEmail: r.primary_instructor_email ?? '',
    primaryInstructorNumber: r.primary_instructor_number ?? '',
    primaryInstructorCardExp: r.primary_instructor_card_exp ?? '',
    secondaryInstructorName: r.secondary_instructor_name ?? '',
    secondaryInstructorEmail: r.secondary_instructor_email ?? '',
    secondaryInstructorNumber: r.secondary_instructor_number ?? '',
    secondaryInstructorCardExp: r.secondary_instructor_card_exp ?? '',
    tertiaryInstructorName: r.tertiary_instructor_name ?? '',
    tertiaryInstructorEmail: r.tertiary_instructor_email ?? '',
    tertiaryInstructorNumber: r.tertiary_instructor_number ?? '',
    tertiaryInstructorCardExp: r.tertiary_instructor_card_exp ?? '',
    quaternaryInstructorName: r.quaternary_instructor_name ?? '',
    registrationType: r.registration_type ?? '',
    registrationUrl: r.registration_url ?? '',
    status: r.status ?? 'Active',
    checkInStatus: r.check_in_status ?? 'Closed',
    evalStatus: r.eval_status ?? 'Closed',
    requireRegistration: !!r.require_registration,
    virtualEnabled: !!r.virtual_enabled,
    teamsMeetingUrl: r.teams_meeting_url ?? '',
    checkInToken: r.check_in_token ?? '',
    evalToken: r.eval_token ?? '',
    quizToken: r.quiz_token ?? '',
    quizStatus: r.quiz_status ?? 'Closed',
    wixEventId: r.wix_event_id ?? null,
    wixServiceId: r.wix_service_id ?? null,
    wixScheduleId: r.wix_schedule_id ?? null,
    wixServiceName: r.wix_service_name ?? null,
    engagementThresholdPct: r.engagement_threshold_pct ?? null,
    createdAt: r.created_at ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAttendee(r: any): Attendee {
  return {
    id: r.id,
    sessionId: r.session_id,
    studentName: r.student_name ?? '',
    studentEmail: r.student_email ?? '',
    attendanceMode: r.attendance_mode ?? '',
    certLevel: r.cert_level ?? null,
    eCardEmail: r.e_card_email ?? '',
    mailingAddress: r.mailing_address ?? '',
    phone: r.phone ?? '',
    status: r.status ?? 'CheckedIn',
    psaScore: r.psa_score ?? null,
    phase: r.phase ?? 'checkedin',
    ecardIssuedAt: r.ecard_issued_at ?? null,
    ceCertIssuedAt: r.ce_cert_issued_at ?? null,
    ceCertNumber: r.ce_cert_number ?? null,
    ceCertPath: r.ce_cert_path ?? null,
    ceHoursOverride: r.ce_hours_override ?? null,
    evalCredited: !!r.eval_credited,
    quizCredited: !!r.quiz_credited,
    createdAt: r.created_at ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEval(r: any): EvalRecord {
  return {
    id: r.id,
    sessionId: r.session_id,
    studentName: r.student_name ?? '',
    studentEmail: r.student_email ?? '',
    title: r.title ?? '',
    courseType: r.course_type ?? 'BLS',
    answers: r.answers ?? {},
    createdAt: r.created_at ?? '',
  }
}

const SESSION_COLS = '*'

/** Shape exposed to the Create Session view's instructor picker. Small
 *  subset of training_instructors + the per-discipline card expirations
 *  hydrated from the junction table for auto-filling the roster. */
export interface InstructorRosterEntry {
  id: string
  email: string
  fullName: string
  instructorNumber: string | null
  isAdmin: boolean
  /** Discipline-code → card_exp (YYYY-MM-DD). Empty when not tracked. */
  cardExpByCode: Record<string, string | null>
}

export const useSessionsStore = defineStore('sessions', () => {
  const courses = ref<TrainingCourse[]>([])
  const instructorRoster = ref<InstructorRosterEntry[]>([])
  const recentSessions = ref<CourseSession[]>([])
  const allSessions = ref<CourseSession[]>([])
  const allLoading = ref(false)
  const currentSession = ref<CourseSession | null>(null)
  /** Per cert-level quiz currently loaded for currentSession (lecture). */
  const quizzes = ref<Record<CertLevel, LectureQuiz | null>>({
    Paramedic: null,
    EMT: null,
  })
  const quizSubmissions = ref<QuizSubmission[]>([])
  // Engagement codes + responses for the current session.
  const engagementCodes = ref<EngagementCode[]>([])
  const engagementResponses = ref<EngagementResponse[]>([])
  const attendance = ref<Attendee[]>([])
  const evals = ref<EvalRecord[]>([])
  // One-shot list for the Registrations view — intentionally NOT tied to
  // the realtime channel below (registrations don't need live updates and
  // we don't want two views fighting over one channel).
  const registrationRows = ref<Attendee[]>([])
  const registrationsLoading = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null

  async function loadCourses() {
    const { data, error: e } = await supabase
      .from('training_courses')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
    if (e) {
      error.value = e.message
      return
    }
    courses.value = (data ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any): TrainingCourse => ({
        id: r.id,
        name: r.name,
        defaultHours: r.default_hours,
        wixServiceId: r.wix_service_id,
        wixScheduleId: r.wix_schedule_id,
        active: r.active,
        sortOrder: r.sort_order,
      }),
    )
  }

  /** Loads the active-instructor roster for the Create Session picker.
   *  Same join as the auth store uses for the signed-in user, but for
   *  every active instructor — the dropdown auto-fills name + email +
   *  instructor number + the per-discipline card expiration so the
   *  roster's required fields come pre-populated. */
  async function loadInstructorRoster() {
    const { data, error: e } = await supabase
      .from('training_instructors')
      .select(
        `id, email, full_name, instructor_number, is_admin,
         training_instructor_disciplines (
           card_exp,
           training_disciplines ( code )
         )`,
      )
      .eq('active', true)
      .order('full_name')
    if (e) {
      error.value = e.message
      return
    }
    instructorRoster.value = (data ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any): InstructorRosterEntry => {
        const cardExpByCode: Record<string, string | null> = {}
        for (const link of r.training_instructor_disciplines ?? []) {
          const code = link?.training_disciplines?.code
          if (code) cardExpByCode[code] = link.card_exp ?? null
        }
        return {
          id: r.id,
          email: r.email,
          fullName: r.full_name,
          instructorNumber: r.instructor_number,
          isAdmin: !!r.is_admin,
          cardExpByCode,
        }
      },
    )
  }

  async function loadRecentSessions() {
    const { data, error: e } = await supabase
      .from('course_sessions')
      .select(SESSION_COLS)
      .eq('status', 'Active')
      .order('class_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    if (e) {
      error.value = e.message
      return
    }
    recentSessions.value = (data ?? []).map(toSession)
  }

  async function loadSessionDetail(sessionId: string) {
    loading.value = true
    error.value = null
    try {
      const [s, a, ev] = await Promise.all([
        supabase
          .from('course_sessions')
          .select(SESSION_COLS)
          .eq('session_id', sessionId)
          .maybeSingle(),
        supabase
          .from('training_attendance')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true }),
        supabase
          .from('training_evals')
          .select('*')
          .eq('session_id', sessionId),
      ])
      if (s.error || !s.data) throw new Error(s.error?.message || 'Session not found')
      currentSession.value = toSession(s.data)
      attendance.value = (a.data ?? []).map(toAttendee)
      evals.value = (ev.data ?? []).map(toEval)
      subscribeRealtime(sessionId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session'
      currentSession.value = null
    } finally {
      loading.value = false
    }
  }

  async function loadAllSessions() {
    allLoading.value = true
    try {
      const { data, error: e } = await supabase
        .from('course_sessions')
        .select(SESSION_COLS)
        .order('class_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000)
      if (e) {
        error.value = e.message
        return
      }
      allSessions.value = (data ?? []).map(toSession)
    } finally {
      allLoading.value = false
    }
  }

  /** List archived files for a session from the training-archives
   *  bucket: roster PDFs, per-student eval PDFs, and per-student exam
   *  uploads. Returns short-lived signed URLs ready for download. */
  async function listArchives(sessionId: string): Promise<ArchiveFile[]> {
    const out: ArchiveFile[] = []

    // Roster + Evaluation: flat folders under {sessionId}/{recordType}.
    for (const recordType of ['Roster', 'Evaluation'] as const) {
      const prefix = `${sessionId}/${recordType}`
      const { data, error: e } = await supabase.storage
        .from('training-archives')
        .list(prefix, {
          limit: 200,
          sortBy: { column: 'created_at', order: 'desc' },
        })
      if (e || !data?.length) continue
      const files = data.filter((f) => f.name && !f.name.startsWith('.'))
      const paths = files.map((f) => `${prefix}/${f.name}`)
      const { data: signed } = await supabase.storage
        .from('training-archives')
        .createSignedUrls(paths, 3600)
      files.forEach((f, i) => {
        out.push({
          recordType,
          fileName: f.name,
          path: paths[i],
          createdAt:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (f as any).created_at ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (f as any).updated_at ||
            '',
          signedUrl: signed?.[i]?.signedUrl ?? '',
        })
      })
    }

    // Exams + CE certs: nested as {sessionId}/{Exam|CE}/{safeEmail}/<file>.
    // List the student-folders first, then list each one to collect files.
    for (const recordType of ['Exam', 'CE'] as const) {
      const prefix = `${sessionId}/${recordType}`
      const { data: studentDirs } = await supabase.storage
        .from('training-archives')
        .list(prefix, { limit: 500 })
      for (const dir of studentDirs ?? []) {
        if (!dir.name || dir.name.startsWith('.')) continue
        const subPrefix = `${prefix}/${dir.name}`
        const { data: files } = await supabase.storage
          .from('training-archives')
          .list(subPrefix, {
            limit: 200,
            sortBy: { column: 'created_at', order: 'desc' },
          })
        const real = (files ?? []).filter(
          (f) => f.name && !f.name.startsWith('.'),
        )
        if (!real.length) continue
        const paths = real.map((f) => `${subPrefix}/${f.name}`)
        const { data: signed } = await supabase.storage
          .from('training-archives')
          .createSignedUrls(paths, 3600)
        real.forEach((f, i) => {
          out.push({
            recordType,
            fileName: f.name,
            path: paths[i],
            studentEmail: dir.name,
            createdAt:
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (f as any).created_at ||
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (f as any).updated_at ||
              '',
            signedUrl: signed?.[i]?.signedUrl ?? '',
          })
        })
      }
    }

    return out
  }

  /** Edit a registered/checked-in attendee's info. All fields optional;
   *  pass only what's changing. Email-change collisions inside the same
   *  session surface as a 23505 we re-throw with a friendlier message
   *  (the `(session_id, student_email)` unique index protects this). */
  async function updateAttendance(
    attendeeId: string,
    fields: {
      studentName?: string
      studentEmail?: string
      attendanceMode?: 'InPerson' | 'Virtual'
      certLevel?: 'Paramedic' | 'EMT' | null
      ceHoursOverride?: string | null
    },
  ) {
    const patch: Record<string, unknown> = {}
    if (fields.studentName !== undefined) {
      const n = fields.studentName.trim()
      if (!n) throw new Error('Name cannot be empty.')
      patch.student_name = n
    }
    if (fields.studentEmail !== undefined) {
      const e = fields.studentEmail.trim().toLowerCase()
      if (!e || !e.includes('@')) {
        throw new Error('Please enter a valid email.')
      }
      patch.student_email = e
    }
    if (fields.attendanceMode !== undefined) {
      patch.attendance_mode = fields.attendanceMode
    }
    if (fields.certLevel !== undefined) {
      patch.cert_level = fields.certLevel
    }
    if (fields.ceHoursOverride !== undefined) {
      const v = fields.ceHoursOverride?.trim() ?? ''
      patch.ce_hours_override = v ? v : null
    }
    if (!Object.keys(patch).length) return
    const { error: e } = await supabase
      .from('training_attendance')
      .update(patch)
      .eq('id', attendeeId)
    if (e) {
      if (e.code === '23505') {
        throw new Error(
          'Another attendee in this session already uses that email.',
        )
      }
      throw new Error(e.message)
    }
  }

  /** Manually add a pre-registration for a walk-in. Inserts a
   *  `phase='registered'` row so the next time that email checks in, the
   *  edge function sees the in-app match and auto-confirms instead of
   *  routing to Pending. For card classes this is a no-op against Wix —
   *  the row only lives in our DB and only affects our check-in flow.
   *
   *  Re-adding the same email upserts cleanly (no duplicate error). */
  async function addRegistration(opts: {
    sessionId: string
    studentName: string
    studentEmail: string
    attendanceMode?: 'InPerson' | 'Virtual'
  }) {
    const email = opts.studentEmail.trim().toLowerCase()
    const name = opts.studentName.trim()
    if (!email || !email.includes('@')) {
      throw new Error('Please enter a valid email.')
    }
    if (!name) throw new Error('Please enter the registrant’s name.')
    const { error: e } = await supabase.from('training_attendance').upsert(
      {
        session_id: opts.sessionId,
        student_name: name,
        student_email: email,
        attendance_mode: opts.attendanceMode ?? 'InPerson',
        status: 'Pending',
        phase: 'registered',
      },
      { onConflict: 'session_id,student_email', ignoreDuplicates: false },
    )
    if (e) throw new Error(e.message)
  }

  /** Admin-only: delete a single file from the training-archives bucket.
   *  5-year retention is the rule — this exists only to dedupe accidental
   *  double-generations / duplicate uploads, gated server-side by the
   *  "Admins delete training-archives" RLS policy.
   *
   *  For CE certs we ALSO null the issuance metadata on the matching
   *  attendance row so the instructor can re-run "Award CE Credits" and
   *  regenerate cleanly. */
  async function deleteArchive(
    file: { path: string; recordType: string; studentEmail?: string },
    sessionId: string,
  ) {
    const { error } = await supabase.storage
      .from('training-archives')
      .remove([file.path])
    if (error) throw new Error(error.message)

    if (file.recordType === 'CE' && file.studentEmail) {
      // safeEmail in the storage path may have rewritten the address,
      // so match by case-insensitive substring on the path tail.
      await supabase
        .from('training_attendance')
        .update({
          ce_cert_issued_at: null,
          ce_cert_number: null,
          ce_cert_path: null,
        })
        .eq('session_id', sessionId)
        .eq('ce_cert_path', file.path)
    }
  }

  /* ── Quizzes ─────────────────────────────────────────────────────────
   * Per cert-level, optional, lecture-only. Single source of truth on
   * whether the quiz is "open" to students is course_sessions.quiz_status
   * (one toggle, covers both cert levels at once). */

  async function loadQuizzes(courseSessionUuid: string) {
    quizzes.value = { Paramedic: null, EMT: null }
    const { data, error } = await supabase
      .from('training_lecture_quizzes')
      .select(
        `id, course_session_id, cert_level, passing_pct, attempts_allowed, status,
         training_quiz_questions ( id, prompt, options, correct_index, rationale, sort_order )`,
      )
      .eq('course_session_id', courseSessionUuid)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any
      const cert = r.cert_level as CertLevel
      const questions: QuizQuestion[] = (r.training_quiz_questions ?? [])
        .map((q: { id: string; prompt: string; options: string[]; correct_index: number; rationale: string | null; sort_order: number }) => ({
          id: q.id,
          prompt: q.prompt,
          options: Array.isArray(q.options) ? q.options : [],
          correctIndex: q.correct_index,
          rationale: q.rationale ?? '',
          sortOrder: q.sort_order,
        }))
        .sort((a: QuizQuestion, b: QuizQuestion) => a.sortOrder - b.sortOrder)
      quizzes.value[cert] = {
        id: r.id,
        courseSessionId: r.course_session_id,
        certLevel: cert,
        passingPct: r.passing_pct,
        attemptsAllowed: r.attempts_allowed ?? 3,
        status: r.status as OpenClosed,
        questions,
      }
    }
  }

  async function loadQuizSubmissions(sessionId: string) {
    const { data, error } = await supabase
      .from('training_quiz_submissions')
      .select('*')
      .eq('session_id', sessionId)
      .order('submitted_at', { ascending: false })
    if (error) throw new Error(error.message)
    quizSubmissions.value = (data ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any): QuizSubmission => ({
        id: r.id,
        quizId: r.quiz_id,
        sessionId: r.session_id,
        studentName: r.student_name,
        studentEmail: r.student_email,
        answers: r.answers,
        scorePct: r.score_pct,
        passed: r.passed,
        attemptsUsed: r.attempts_used ?? 1,
        submittedAt: r.submitted_at,
      }),
    )
  }

  /** Upserts the quiz for (session, certLevel) and atomically replaces
   *  its question list — simpler than diffing question IDs, and the
   *  builder treats the quiz as a single editable record. */
  async function saveQuiz(opts: {
    courseSessionUuid: string
    certLevel: CertLevel
    passingPct: number
    attemptsAllowed: number
    questions: {
      prompt: string
      options: string[]
      correctIndex: number
      rationale?: string
    }[]
  }) {
    const { data: existing } = await supabase
      .from('training_lecture_quizzes')
      .select('id')
      .eq('course_session_id', opts.courseSessionUuid)
      .eq('cert_level', opts.certLevel)
      .maybeSingle()

    let quizId: string
    if (existing?.id) {
      const { error } = await supabase
        .from('training_lecture_quizzes')
        .update({
          passing_pct: opts.passingPct,
          attempts_allowed: opts.attemptsAllowed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
      quizId = existing.id as string
    } else {
      const { data: ins, error } = await supabase
        .from('training_lecture_quizzes')
        .insert({
          course_session_id: opts.courseSessionUuid,
          cert_level: opts.certLevel,
          passing_pct: opts.passingPct,
          attempts_allowed: opts.attemptsAllowed,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      quizId = ins!.id as string
    }

    // Atomic-ish question replacement.
    await supabase.from('training_quiz_questions').delete().eq('quiz_id', quizId)
    if (opts.questions.length) {
      const rows = opts.questions.map((q, i) => ({
        quiz_id: quizId,
        prompt: q.prompt,
        options: q.options,
        correct_index: q.correctIndex,
        rationale: q.rationale?.trim() || null,
        sort_order: i,
      }))
      const { error } = await supabase
        .from('training_quiz_questions')
        .insert(rows)
      if (error) throw new Error(error.message)
    }

    await loadQuizzes(opts.courseSessionUuid)
  }

  async function deleteQuiz(quizId: string, courseSessionUuid: string) {
    const { error } = await supabase
      .from('training_lecture_quizzes')
      .delete()
      .eq('id', quizId)
    if (error) throw new Error(error.message)
    await loadQuizzes(courseSessionUuid)
  }

  /* ── Engagement codes ──────────────────────────────────────────────
   * Instructor generates a short numeric code mid-lecture; virtual
   * attendees submit it on /engage to attest presence. CE award gates
   * virtual attendees on per-session participation %. */

  function toEngagementCode(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r: any,
  ): EngagementCode {
    return {
      id: r.id,
      sessionId: r.session_id,
      code: r.code,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }
  }
  function toEngagementResponse(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r: any,
  ): EngagementResponse {
    return {
      id: r.id,
      codeId: r.code_id,
      sessionId: r.session_id,
      attendeeEmail: r.attendee_email,
      attendeeName: r.attendee_name ?? null,
      submittedAt: r.submitted_at,
    }
  }

  async function loadEngagementCodes(sessionId: string) {
    const { data } = await supabase
      .from('training_engagement_codes')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
    engagementCodes.value = (data ?? []).map(toEngagementCode)
  }

  async function loadEngagementResponses(sessionId: string) {
    const { data } = await supabase
      .from('training_engagement_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('submitted_at', { ascending: false })
    engagementResponses.value = (data ?? []).map(toEngagementResponse)
  }

  /** Generate a fresh engagement code for the session. Default code is
   *  4 numeric digits; lifetime is caller-supplied in seconds (default
   *  60). Returns the inserted row so the UI can render it immediately. */
  async function generateEngagementCode(opts: {
    sessionId: string
    lifetimeSec?: number
    digits?: number
  }): Promise<EngagementCode> {
    const digits = Math.max(3, Math.min(6, opts.digits ?? 4))
    const lifetime = Math.max(15, Math.min(600, opts.lifetimeSec ?? 60))
    const max = 10 ** digits
    const code = String(Math.floor(Math.random() * max)).padStart(digits, '0')
    const expiresAt = new Date(Date.now() + lifetime * 1000).toISOString()
    const { data: who } = await supabase.auth.getUser()
    const { data, error: e } = await supabase
      .from('training_engagement_codes')
      .insert({
        session_id: opts.sessionId,
        code,
        expires_at: expiresAt,
        created_by: who?.user?.id ?? null,
      })
      .select('*')
      .single()
    if (e) throw new Error(e.message)
    return toEngagementCode(data)
  }

  /** Update the per-session pass threshold for virtual attendees. */
  async function setEngagementThreshold(sessionId: string, pct: number | null) {
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ engagement_threshold_pct: pct })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
    if (currentSession.value?.sessionId === sessionId) {
      currentSession.value = {
        ...currentSession.value,
        engagementThresholdPct: pct,
      }
    }
  }

  /** Update CE hours awarded on the session. Scheduled time and
   *  actual instruction time often differ — instructors edit this from
   *  Session Controls after the lecture runs so the cert reflects the
   *  real contact hours. The CE certificate generator reads from
   *  session.hoursAwarded, so this is the only write needed. */
  async function setHoursAwarded(sessionId: string, hours: string) {
    const trimmed = hours.trim()
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ hours_awarded: trimmed })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
    if (currentSession.value?.sessionId === sessionId) {
      currentSession.value = {
        ...currentSession.value,
        hoursAwarded: trimmed,
      }
    }
  }

  /** Flip the SESSION-level quiz_status (governs both cert quizzes
   *  simultaneously). Mirrors setCheckInStatus / setEvalStatus. */
  async function setQuizSessionStatus(
    sessionId: string,
    status: OpenClosed,
  ) {
    const { error } = await supabase
      .from('course_sessions')
      .update({ quiz_status: status })
      .eq('session_id', sessionId)
    if (error) throw new Error(error.message)
    if (currentSession.value?.sessionId === sessionId) {
      currentSession.value = { ...currentSession.value, quizStatus: status }
    }
  }

  /** Admin-only: permanently delete a whole session — every archived
   *  file, every attendance + eval row, the session row itself, and
   *  (for lectures) the calendar tile in training_sessions. 5-year
   *  retention is the rule; this is the deduplication / mis-create
   *  escape hatch, same spirit as deleteArchive() but session-wide.
   *
   *  Storage objects come down as a recursive list — the bucket has
   *  files at:
   *    {sessionId}/Roster/...
   *    {sessionId}/Evaluation/...
   *    {sessionId}/Exam/{safeEmail}/...
   *    {sessionId}/CE/{safeEmail}/...
   *  so we list each prefix (including the per-student subfolders)
   *  and remove() in batches. */
  async function deleteSession(sessionId: string): Promise<{
    files: number
    evals: number
    attendance: number
  }> {
    /* 1. Storage objects under the session prefix */
    const paths: string[] = []
    for (const recordType of ['Roster', 'Evaluation'] as const) {
      const prefix = `${sessionId}/${recordType}`
      const { data } = await supabase.storage
        .from('training-archives')
        .list(prefix, { limit: 500 })
      for (const f of data ?? []) {
        if (f.name && !f.name.startsWith('.')) paths.push(`${prefix}/${f.name}`)
      }
    }
    for (const recordType of ['Exam', 'CE'] as const) {
      const prefix = `${sessionId}/${recordType}`
      const { data: dirs } = await supabase.storage
        .from('training-archives')
        .list(prefix, { limit: 500 })
      for (const dir of dirs ?? []) {
        if (!dir.name || dir.name.startsWith('.')) continue
        const subPrefix = `${prefix}/${dir.name}`
        const { data: files } = await supabase.storage
          .from('training-archives')
          .list(subPrefix, { limit: 500 })
        for (const f of files ?? []) {
          if (f.name && !f.name.startsWith('.')) paths.push(`${subPrefix}/${f.name}`)
        }
      }
    }
    let removed = 0
    // Supabase Storage's remove() handles up to 1000 paths per call.
    // Batch defensively at 100 so a slow network doesn't time us out.
    const BATCH = 100
    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = paths.slice(i, i + BATCH)
      const { error: rmErr } = await supabase.storage
        .from('training-archives')
        .remove(batch)
      if (rmErr) throw new Error(`Storage delete failed: ${rmErr.message}`)
      removed += batch.length
    }

    /* 2. training_evals (no FK from this side) */
    const { count: evalCount, error: evalErr } = await supabase
      .from('training_evals')
      .delete({ count: 'exact' })
      .eq('session_id', sessionId)
    if (evalErr) throw new Error(`Evals delete failed: ${evalErr.message}`)

    /* 3. training_attendance (no FK from this side) */
    const { count: attCount, error: attErr } = await supabase
      .from('training_attendance')
      .delete({ count: 'exact' })
      .eq('session_id', sessionId)
    if (attErr) throw new Error(`Attendance delete failed: ${attErr.message}`)

    /* 4. course_sessions — CASCADE removes training_sessions where
          lecture_session_id was bound. */
    const { error: sessErr } = await supabase
      .from('course_sessions')
      .delete()
      .eq('session_id', sessionId)
    if (sessErr) throw new Error(`Session delete failed: ${sessErr.message}`)

    /* Cleanup local caches so the UI updates without a reload. */
    allSessions.value = allSessions.value.filter(
      (s) => s.sessionId !== sessionId,
    )
    recentSessions.value = recentSessions.value.filter(
      (s) => s.sessionId !== sessionId,
    )

    return {
      files: removed,
      evals: evalCount ?? 0,
      attendance: attCount ?? 0,
    }
  }

  /** Upload a student's exam answer sheet to the archive bucket under
   *  this session + student. Returns the signed URL for verification. */
  async function uploadExam(
    sessionId: string,
    studentEmail: string,
    file: File,
  ) {
    return archiveFile({
      sessionId,
      recordType: 'Exam',
      fileName: file.name,
      blob: file,
      studentEmail,
    })
  }

  async function loadRegistrations(sessionId: string) {
    registrationsLoading.value = true
    try {
      const { data } = await supabase
        .from('training_attendance')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
      registrationRows.value = (data ?? []).map(toAttendee)
    } finally {
      registrationsLoading.value = false
    }
  }

  function subscribeRealtime(sessionId: string) {
    if (channel) supabase.removeChannel(channel)
    channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'training_attendance',
          filter: `session_id=eq.${sessionId}`,
        },
        () => void refreshRoster(sessionId),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'training_evals',
          filter: `session_id=eq.${sessionId}`,
        },
        () => void refreshRoster(sessionId),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'course_sessions',
          filter: `session_id=eq.${sessionId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          currentSession.value = toSession(payload.new)
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'training_quiz_submissions',
          filter: `session_id=eq.${sessionId}`,
        },
        () => void loadQuizSubmissions(sessionId),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'training_engagement_codes',
          filter: `session_id=eq.${sessionId}`,
        },
        () => void loadEngagementCodes(sessionId),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'training_engagement_responses',
          filter: `session_id=eq.${sessionId}`,
        },
        () => void loadEngagementResponses(sessionId),
      )
      .subscribe()
  }

  async function refreshRoster(sessionId: string) {
    const [a, ev] = await Promise.all([
      supabase
        .from('training_attendance')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      supabase.from('training_evals').select('*').eq('session_id', sessionId),
    ])
    attendance.value = (a.data ?? []).map(toAttendee)
    evals.value = (ev.data ?? []).map(toEval)
  }

  function teardown() {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }

  async function createSession(payload: Record<string, unknown>) {
    const auth = useAuthStore()
    return invokeEdge<{
      success: boolean
      sessionId: string
      checkInToken: string
      evalToken: string
      wixEventId: string | null
    }>('training-create-session', payload, {
      authToken: auth.accessToken,
    })
  }

  async function setCheckInStatus(sessionId: string, open: boolean) {
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ check_in_status: open ? 'Open' : 'Closed' })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
  }

  async function setEvalStatus(sessionId: string, open: boolean) {
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ eval_status: open ? 'Open' : 'Closed' })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
  }

  /** Approve a walk-in: pending → CheckedIn. The realtime channel
   *  picks up the update and refreshes the roster. */
  async function approveAttendee(attendeeId: string) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({ status: 'CheckedIn' })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  /** Reject a walk-in by deleting the row outright (no audit log
   *  beyond the realtime event the channel already saw). */
  async function rejectAttendee(attendeeId: string) {
    const { error: e } = await supabase
      .from('training_attendance')
      .delete()
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  /** Same-day flip of the require_registration flag from Session
   *  Controls. The next check-in submission will honor the new value. */
  async function setRequireRegistration(sessionId: string, on: boolean) {
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ require_registration: on })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
  }

  /** Mark a student's AHA eCard as issued now (or clear it). The
   *  Dashboard's Pending eCards section watches this column. */
  async function setEcardIssued(attendeeId: string, issued: boolean) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({ ecard_issued_at: issued ? new Date().toISOString() : null })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  /** Manual eval-credit override. When the eval-form email doesn't
   *  match the check-in email (or any name-fallback), the instructor
   *  flips this from the roster to credit the attendee. Award CE
   *  Credits + the Eval column both honor it. */
  async function setEvalCredited(attendeeId: string, credited: boolean) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({ eval_credited: credited })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  /** Manual quiz-pass override — mirror of setEvalCredited. */
  async function setQuizCredited(attendeeId: string, credited: boolean) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({ quiz_credited: credited })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  /** Record a CE certificate as issued for a lecture attendee. The
   *  Award CE Credits action stores the cert number + Storage path so
   *  we can hand it back to the attendee from the Archive view. */
  async function setCeCertIssued(
    attendeeId: string,
    opts: { certNumber: string; path: string },
  ) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({
        ce_cert_issued_at: new Date().toISOString(),
        ce_cert_number: opts.certNumber,
        ce_cert_path: opts.path,
      })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  // ── Pending eCards (dashboard) ─────────────────────────────────────
  // All card-class students who have checked in (status CheckedIn) and
  // don't yet have an eCard issued timestamp. Joined with the session
  // so each row carries the course + date + instructor.
  const pendingEcards = ref<PendingEcard[]>([])
  const pendingEcardsLoading = ref(false)

  async function loadPendingEcards() {
    pendingEcardsLoading.value = true
    try {
      const { data, error: e } = await supabase
        .from('training_attendance')
        .select(
          `
          id, session_id, student_name, student_email, e_card_email,
          ecard_issued_at, created_at,
          course_sessions!inner(
            session_id, session_type, card_course_name, title,
            class_date, primary_instructor_name
          )
        `,
        )
        .is('ecard_issued_at', null)
        .eq('phase', 'checkedin')
        .eq('status', 'CheckedIn')
        .eq('course_sessions.session_type', 'CardClass')
        .order('created_at', { ascending: false })
        .limit(100)
      if (e) {
        error.value = e.message
        return
      }
      pendingEcards.value = (data ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any): PendingEcard => {
          const cs = Array.isArray(r.course_sessions)
            ? r.course_sessions[0]
            : r.course_sessions
          return {
            id: r.id,
            sessionId: r.session_id,
            studentName: r.student_name ?? '',
            studentEmail: r.student_email ?? '',
            eCardEmail: r.e_card_email ?? '',
            course: cs?.card_course_name || cs?.title || '',
            classDate: cs?.class_date ?? null,
            primaryInstructorName: cs?.primary_instructor_name ?? '',
            createdAt: r.created_at ?? '',
          }
        },
      )
    } finally {
      pendingEcardsLoading.value = false
    }
  }

  async function savePsaScore(attendeeId: string, score: number | null) {
    const { error: e } = await supabase
      .from('training_attendance')
      .update({ psa_score: score })
      .eq('id', attendeeId)
    if (e) throw new Error(e.message)
  }

  async function closeCourse(sessionId: string) {
    const { error: e } = await supabase
      .from('course_sessions')
      .update({ status: 'Closed' })
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
  }

  /** Instructor-authored edit for course + instructor slots after a
   *  session already exists. Common case: a BLS was created as a
   *  "Renewal" but the roster ends up needing the full course, or a
   *  co-instructor needs to be added after check-in has opened.
   *
   *  Patch keys map directly to course_sessions columns; only fields
   *  present in the patch get written. All 4 instructor blocks
   *  (primary + 3 assist slots) can be updated in one call. */
  async function updateSessionDetails(
    sessionId: string,
    patch: Partial<{
      cardCourseName: string
      primaryInstructorName: string
      primaryInstructorEmail: string
      primaryInstructorNumber: string
      primaryInstructorCardExp: string
      secondaryInstructorName: string
      secondaryInstructorEmail: string
      secondaryInstructorNumber: string
      secondaryInstructorCardExp: string
      tertiaryInstructorName: string
      tertiaryInstructorEmail: string
      tertiaryInstructorNumber: string
      tertiaryInstructorCardExp: string
      quaternaryInstructorName: string
    }>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbPatch: Record<string, any> = {}
    const M: Record<string, string> = {
      cardCourseName: 'card_course_name',
      primaryInstructorName: 'primary_instructor_name',
      primaryInstructorEmail: 'primary_instructor_email',
      primaryInstructorNumber: 'primary_instructor_number',
      primaryInstructorCardExp: 'primary_instructor_card_exp',
      secondaryInstructorName: 'secondary_instructor_name',
      secondaryInstructorEmail: 'secondary_instructor_email',
      secondaryInstructorNumber: 'secondary_instructor_number',
      secondaryInstructorCardExp: 'secondary_instructor_card_exp',
      tertiaryInstructorName: 'tertiary_instructor_name',
      tertiaryInstructorEmail: 'tertiary_instructor_email',
      tertiaryInstructorNumber: 'tertiary_instructor_number',
      tertiaryInstructorCardExp: 'tertiary_instructor_card_exp',
      quaternaryInstructorName: 'quaternary_instructor_name',
    }
    // Every mapped column is `text NOT NULL` in the schema — writing null
    // for a cleared assist slot would violate the constraint. Preserve the
    // empty string so "no assist slot 3" stays as '' on the row.
    for (const [k, col] of Object.entries(M)) {
      const v = (patch as Record<string, unknown>)[k]
      if (v !== undefined) dbPatch[col] = typeof v === 'string' ? v : ''
    }
    if (!Object.keys(dbPatch).length) return
    const { error: e } = await supabase
      .from('course_sessions')
      .update(dbPatch)
      .eq('session_id', sessionId)
    if (e) throw new Error(e.message)
    // Refresh the currently-loaded session so the view picks up changes.
    if (currentSession.value?.sessionId === sessionId) {
      await loadSessionDetail(sessionId)
    }
    await loadRecentSessions()
  }

  /** Cancel a session — distinct from Close. Calls the edge function so
   *  the Wix Bookings event for a Card Class is canceled too (notifying
   *  bookers). Closes check-in/eval as part of the same flip. */
  async function cancelSession(sessionId: string) {
    const auth = useAuthStore()
    return invokeEdge<{
      success: boolean
      wixCanceled: boolean
      wixWarning?: string | null
      alreadyCanceled?: boolean
    }>(
      'training-cancel-session',
      { sessionId },
      { authToken: auth.accessToken },
    )
  }

  return {
    courses,
    recentSessions,
    allSessions,
    allLoading,
    currentSession,
    attendance,
    evals,
    registrationRows,
    registrationsLoading,
    loading,
    error,
    loadCourses,
    instructorRoster,
    loadInstructorRoster,
    loadRecentSessions,
    loadAllSessions,
    listArchives,
    loadRegistrations,
    loadSessionDetail,
    refreshRoster,
    teardown,
    createSession,
    updateSessionDetails,
    setCheckInStatus,
    setEvalStatus,
    savePsaScore,
    approveAttendee,
    rejectAttendee,
    setRequireRegistration,
    closeCourse,
    cancelSession,
    uploadExam,
    addRegistration,
    updateAttendance,
    deleteArchive,
    deleteSession,
    setEcardIssued,
    setCeCertIssued,
    setEvalCredited,
    setQuizCredited,
    setHoursAwarded,
    // Engagement
    engagementCodes,
    engagementResponses,
    loadEngagementCodes,
    loadEngagementResponses,
    generateEngagementCode,
    setEngagementThreshold,
    // Quizzes
    quizzes,
    quizSubmissions,
    loadQuizzes,
    loadQuizSubmissions,
    saveQuiz,
    deleteQuiz,
    setQuizSessionStatus,
    pendingEcards,
    pendingEcardsLoading,
    loadPendingEcards,
  }
})
