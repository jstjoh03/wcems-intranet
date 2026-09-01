// supabase/functions/training-public/index.ts
//
// Anonymous, token-validated endpoint for the public student pages.
// Replaces these legacy Power Automate flows:
//   getSessionById      ← FLOW_GET_SESSION (register)
//   getSessionByToken   ← FLOW_GET_SESSION_BY_TOKEN (check-in / eval)
//   register            ← FLOW_REGISTER
//   submitCheckin       ← FLOW_SUBMIT_CHECKIN
//   submitEval          ← FLOW_SUBMIT (eval)
//
// Students are never authenticated. Every action requires either the
// session's check-in/eval token or its sessionId, validated here against
// the row before any read/write. Uses the service-role key (RLS bypass);
// only the minimal student-facing fields are returned.
//
// Deploy with --no-verify-jwt (no Supabase auth on the request).

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Inlined from _shared/cors.ts for single-file deploys:
// Shared CORS headers for the training Edge Functions. The public
// student pages and the instructor SPA both call these cross-origin.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extra,
    },
  })
}

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const SESSION_COLS =
  'session_id, session_type, title, card_course_name, lecture_title, ' +
  'class_date, start_time, end_time, location, hours_awarded, ' +
  'dshs_content_area, status, check_in_status, eval_status, ' +
  'registration_type, registration_url, max_seats, ' +
  'virtual_enabled, teams_meeting_url, ' +
  'primary_instructor_name, secondary_instructor_name, ' +
  'tertiary_instructor_name, quaternary_instructor_name'

interface SessionRow {
  session_id: string
  session_type: 'CardClass' | 'Lecture'
  title: string
  card_course_name: string
  lecture_title: string
  class_date: string | null
  start_time: string
  end_time: string
  location: string
  hours_awarded: string
  dshs_content_area: string
  status: string
  check_in_status: string
  eval_status: string
  registration_type: string
  registration_url: string
  max_seats: number | null
  virtual_enabled: boolean | null
  teams_meeting_url: string | null
  primary_instructor_name: string
  secondary_instructor_name: string
  tertiary_instructor_name: string
  quaternary_instructor_name: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPublic(row: SessionRow, registeredCount: number) {
  return {
    sessionId: row.session_id,
    sessionType: row.session_type,
    title: row.title,
    cardCourseName: row.card_course_name,
    lectureTitle: row.lecture_title,
    classDate: row.class_date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    hoursAwarded: row.hours_awarded,
    dshsContentArea: row.dshs_content_area,
    status: row.status,
    checkInStatus: row.check_in_status,
    evalStatus: row.eval_status,
    registrationType: row.registration_type,
    registrationUrl: row.registration_url,
    maxSeats: row.max_seats,
    registeredCount,
    virtualEnabled: !!row.virtual_enabled,
    teamsMeetingUrl: row.teams_meeting_url ?? '',
    primaryInstructorName: row.primary_instructor_name,
    secondaryInstructorName: row.secondary_instructor_name,
    tertiaryInstructorName: row.tertiary_instructor_name,
    quaternaryInstructorName: row.quaternary_instructor_name,
  }
}

/** YYYY-MM-DD in America/Chicago for a UTC ISO timestamp (DST-safe). */
function centralDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

/** Check whether the email has a confirmed Wix booking on this session's
 *  schedule + class date. Returns true on match, false on no match or
 *  on any error (we want a safer-by-default behavior: unverifiable =
 *  pending, never auto-confirm). */
async function emailInWixBookings(
  email: string,
  wixScheduleId: string,
  classDate: string,
  token: string,
  siteId: string,
): Promise<boolean> {
  const target = email.toLowerCase().trim()
  if (!target || !wixScheduleId || !classDate) return false

  const url =
    'https://www.wixapis.com/_api/bookings-reader/v2/extended-bookings/query'
  const SORT = [{ fieldName: 'createdDate', order: 'DESC' }]
  const PAGE = 100
  for (let offset = 0; offset < 600; offset += PAGE) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: token,
          'wix-site-id': siteId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: { sort: SORT },
          paging: { limit: PAGE, offset },
        }),
      })
    } catch {
      return false
    }
    if (!res.ok) return false
    let data: unknown
    try {
      data = JSON.parse(await res.text())
    } catch {
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any
    const list: unknown[] = Array.isArray(d?.extendedBookings)
      ? d.extendedBookings
      : Array.isArray(d?.bookings)
        ? d.bookings
        : []
    if (!list.length) return false

    for (const e of list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry: any = e
      const b = entry?.booking ?? entry
      const c = entry?.contactDetails ?? b?.contactDetails ?? {}
      const contactEmail = String(c.email || '').toLowerCase().trim()
      if (contactEmail !== target) continue
      // Same email — now confirm it's THIS session.
      const slot = b?.bookedEntity?.slot ?? null
      const schIds = [
        b?.bookedEntity?.scheduleId,
        b?.bookedEntity?.schedule?.scheduleId,
        b?.bookedEntity?.schedule?.id,
        slot?.scheduleId,
      ]
        .map((x) => String(x || ''))
        .filter(Boolean)
      const scheduleOk = schIds.includes(wixScheduleId)
      const starts = [b?.startDate, slot?.startDate]
        .map((x) => String(x || ''))
        .filter(Boolean)
      const dateOk = starts.some((s) => centralDate(s) === classDate)
      const status = String(b?.status || '').toUpperCase()
      if (status === 'CANCELED' || status === 'CANCELLED' || status === 'DECLINED') {
        continue
      }
      if (scheduleOk && dateOk) return true
    }
    // Wix ignores offset on this reader, so stop after a single page —
    // we already requested newest-first, which is what we want.
    break
  }
  return false
}

// @ts-expect-error createClient typing loose at runtime
async function inPersonCount(admin, sessionId: string): Promise<number> {
  const { count } = await admin
    .from('training_attendance')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('attendance_mode', 'InPerson')
  return count ?? 0
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createClient(
      env.get('SUPABASE_URL')!,
      env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const action = String(body.action || '')

    // ── getSessionById (register page) ────────────────────────────────
    if (action === 'getSessionById') {
      const sessionId = String(body.sessionId || '')
      if (!sessionId) return json({ error: 'Missing sessionId.' }, 400)
      const { data } = await admin
        .from('course_sessions')
        .select(SESSION_COLS)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (!data) return json({ error: 'Session not found.' }, 404)
      return json(toPublic(data, await inPersonCount(admin, sessionId)))
    }

    // ── getSessionByToken (check-in & eval pages) ─────────────────────
    if (action === 'getSessionByToken') {
      const token = String(body.token || '')
      if (!token) return json({ error: 'Missing token.' }, 400)
      const { data } = await admin
        .from('course_sessions')
        .select(SESSION_COLS + ', check_in_token, eval_token')
        .or(`check_in_token.eq.${token},eval_token.eq.${token}`)
        .maybeSingle()
      if (!data) return json({ error: 'Invalid or expired link.' }, 404)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = data as any
      const tokenKind =
        r.check_in_token === token ? 'checkin' : 'eval'
      const pub = toPublic(r, await inPersonCount(admin, r.session_id))
      return json({ ...pub, tokenKind })
    }

    // ── register (Lecture pre-registration) ───────────────────────────
    if (action === 'register') {
      const sessionId = String(body.sessionId || '')
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const mode = String(body.attendanceMode || '')
      const rawCert = String(body.certLevel || '').trim()
      const certLevel =
        rawCert && ['Paramedic', 'EMT'].includes(rawCert) ? rawCert : null
      if (!sessionId || !name || !email || !mode) {
        return json({ message: 'Please fill in all required fields.' }, 400)
      }
      const { data: session } = await admin
        .from('course_sessions')
        .select('session_id, session_type, status, max_seats')
        .eq('session_id', sessionId)
        .maybeSingle()
      if (!session) return json({ message: 'Session not found.' }, 404)
      if (session.session_type === 'CardClass') {
        return json(
          { message: 'This is a Card Class. Please use the Wix sign-up.' },
          409,
        )
      }
      const status = String(session.status || '').toLowerCase()
      if (status !== 'active' && status !== 'scheduled') {
        return json({ message: 'Registration is closed.' }, 409)
      }
      if (mode === 'InPerson' && session.max_seats) {
        const taken = await inPersonCount(admin, sessionId)
        if (taken >= session.max_seats) {
          return json(
            { message: 'In-person registration is full. Try Virtual.' },
            409,
          )
        }
      }
      const { error } = await admin.from('training_attendance').upsert(
        {
          session_id: sessionId,
          student_name: name,
          student_email: email,
          attendance_mode: mode,
          cert_level: certLevel,
          status: 'Pending',
          phase: 'registered',
        },
        { onConflict: 'session_id,student_email', ignoreDuplicates: false },
      )
      if (error) {
        if (error.code === '23505') {
          return json(
            { message: 'You are already registered for this session.' },
            409,
          )
        }
        return json({ message: error.message }, 500)
      }
      return json({ success: true })
    }

    // ── submitCheckin ─────────────────────────────────────────────────
    if (action === 'submitCheckin') {
      const sessionId = String(body.sessionId || '')
      const studentName = String(body.studentName || '').trim()
      const studentEmail = String(body.studentEmail || '')
        .trim()
        .toLowerCase()
      const mode = String(body.attendanceMode || '')
      if (!sessionId || !studentName || !studentEmail || !mode) {
        return json({ message: 'Please fill in all required fields.' }, 400)
      }
      const { data: session } = await admin
        .from('course_sessions')
        .select(
          'session_id, session_type, check_in_status, wix_schedule_id, class_date',
        )
        .eq('session_id', sessionId)
        .maybeSingle()
      if (!session) return json({ message: 'Session not found.' }, 404)
      if (session.check_in_status !== 'Open') {
        return json({ message: 'Check-in is not open for this session.' }, 409)
      }
      const isCard = session.session_type === 'CardClass'

      // Pre-registration is required for every session. Unknown students
      // (i.e. walk-ins) land as 'Pending' so the instructor can approve
      // them in one tap from Session Controls.
      let confirmed = false

      // Path 1 (Card Class only): live Wix Bookings lookup.
      if (isCard) {
        const wixToken = env.get('WIX_API_TOKEN')
        const wixSiteId = env.get('WIX_SITE_ID')
        if (wixToken && wixSiteId && session.wix_schedule_id) {
          const classDate = String(session.class_date || '').slice(0, 10)
          confirmed = await emailInWixBookings(
            studentEmail,
            session.wix_schedule_id,
            classDate,
            wixToken,
            wixSiteId,
          )
        }
      }

      // Path 2: in-app registration row (phase='registered'). Always
      // honored — for lectures it's the only source; for card classes
      // it's the fallback that lets a manually-added walk-in skip the
      // approval queue.
      if (!confirmed) {
        const { data: reg } = await admin
          .from('training_attendance')
          .select('id, phase')
          .eq('session_id', sessionId)
          .eq('student_email', studentEmail)
          .eq('phase', 'registered')
          .maybeSingle()
        confirmed = !!reg
      }

      const { error } = await admin.from('training_attendance').upsert(
        {
          session_id: sessionId,
          student_name: studentName,
          student_email: studentEmail,
          attendance_mode: mode,
          e_card_email: isCard
            ? String(body.eCardEmail || '').trim().toLowerCase()
            : '',
          mailing_address: isCard ? String(body.mailingAddress || '').trim() : '',
          phone: isCard ? String(body.phone || '').trim() : '',
          status: confirmed ? 'CheckedIn' : 'Pending',
          phase: 'checkedin',
        },
        { onConflict: 'session_id,student_email', ignoreDuplicates: false },
      )
      if (error) return json({ message: error.message }, 500)
      return json({ success: true, pending: !confirmed })
    }

    // ── submitEval ────────────────────────────────────────────────────
    if (action === 'submitEval') {
      const sessionId = String(body.SessionID || body.sessionId || '')
      if (!sessionId) return json({ message: 'Missing session.' }, 400)
      const { data: session } = await admin
        .from('course_sessions')
        .select('session_id, eval_status')
        .eq('session_id', sessionId)
        .maybeSingle()
      if (!session) return json({ message: 'Session not found.' }, 404)
      if (session.eval_status !== 'Open') {
        return json({ message: 'Evaluations are not open.' }, 409)
      }
      const studentName = String(body.StudentName || '').trim()
      const studentEmail = String(body.StudentEmail || '')
        .trim()
        .toLowerCase()
      const { error } = await admin.from('training_evals').upsert(
        {
          session_id: sessionId,
          student_name: studentName,
          student_email: studentEmail,
          title: String(body.Title || ''),
          course_type: String(body.CourseType || 'BLS'),
          answers: body,
        },
        { onConflict: 'session_id,student_email', ignoreDuplicates: false },
      )
      if (error) return json({ message: error.message }, 500)
      return json({ success: true })
    }

    // ── getQuizByToken ────────────────────────────────────────────────
    // Returns session metadata + the cert-level's questions WITHOUT
    // correct_index (so a student inspecting the network tab can't peek).
    if (action === 'getQuizByToken') {
      const token = String(body.token || '')
      const certLevel = String(body.certLevel || '')
      if (!token) return json({ message: 'Missing token.' }, 400)
      if (certLevel && !['Paramedic', 'EMT'].includes(certLevel)) {
        return json({ message: 'Invalid cert level.' }, 400)
      }

      const { data: session } = await admin
        .from('course_sessions')
        .select(
          'id, session_id, session_type, lecture_title, title, dshs_content_area, ' +
            'hours_awarded, class_date, quiz_status, status',
        )
        .eq('quiz_token', token)
        .maybeSingle()
      if (!session) return json({ message: 'Quiz link is invalid.' }, 404)
      if (session.status === 'Canceled') {
        return json({ message: 'This session was canceled.' }, 409)
      }

      const { data: quizzes } = await admin
        .from('training_lecture_quizzes')
        .select('id, cert_level, passing_pct, status, attempts_allowed')
        .eq('course_session_id', session.id)
      const available = (quizzes ?? []).map((q: { cert_level: string }) => q.cert_level)

      const payload: Record<string, unknown> = {
        sessionId: session.session_id,
        lectureTitle: session.lecture_title || session.title || 'CE Lecture',
        dshsContentArea: session.dshs_content_area || '',
        hoursAwarded: session.hours_awarded || '',
        classDate: session.class_date,
        quizStatus: session.quiz_status,
        availableCertLevels: available,
      }

      if (!certLevel) return json(payload)

      const quiz = (quizzes ?? []).find(
        (q: { cert_level: string }) => q.cert_level === certLevel,
      ) as { id: string; passing_pct: number; status: string; attempts_allowed: number } | undefined
      if (!quiz) {
        return json(
          { ...payload, message: 'No quiz defined for that cert level.' },
          404,
        )
      }
      if (session.quiz_status !== 'Open') {
        return json(
          { ...payload, message: 'Quiz is not currently open.' },
          409,
        )
      }
      // NOTE: only prompt + options + sortOrder leave the server here.
      // correct_index + rationale stay hidden until after submit.
      const { data: questions } = await admin
        .from('training_quiz_questions')
        .select('id, prompt, options, sort_order')
        .eq('quiz_id', quiz.id)
        .order('sort_order')
      payload.quiz = {
        id: quiz.id,
        certLevel,
        passingPct: quiz.passing_pct,
        attemptsAllowed: quiz.attempts_allowed,
        questions: (questions ?? []).map(
          (q: { id: string; prompt: string; options: unknown; sort_order: number }) => ({
            id: q.id,
            prompt: q.prompt,
            options: q.options,
            sortOrder: q.sort_order,
          }),
        ),
      }
      return json(payload)
    }

    // ── submitQuiz ────────────────────────────────────────────────────
    if (action === 'submitQuiz') {
      const token = String(body.token || '')
      const certLevel = String(body.certLevel || '')
      const studentName = String(body.studentName || '').trim()
      const studentEmail = String(body.studentEmail || '').trim().toLowerCase()
      const answers = Array.isArray(body.answers) ? body.answers : null
      if (!token || !certLevel || !studentName || !studentEmail || !answers) {
        return json({ message: 'Missing required fields.' }, 400)
      }
      if (!['Paramedic', 'EMT'].includes(certLevel)) {
        return json({ message: 'Invalid cert level.' }, 400)
      }
      const { data: session } = await admin
        .from('course_sessions')
        .select('id, session_id, quiz_status, status')
        .eq('quiz_token', token)
        .maybeSingle()
      if (!session) return json({ message: 'Quiz link is invalid.' }, 404)
      if (session.status === 'Canceled') {
        return json({ message: 'This session was canceled.' }, 409)
      }
      if (session.quiz_status !== 'Open') {
        return json({ message: 'Quiz is not currently open.' }, 409)
      }
      const { data: quiz } = await admin
        .from('training_lecture_quizzes')
        .select('id, passing_pct, attempts_allowed')
        .eq('course_session_id', session.id)
        .eq('cert_level', certLevel)
        .maybeSingle()
      if (!quiz) return json({ message: 'Quiz not found.' }, 404)

      // Look up any prior submission to enforce attempts + sticky pass.
      const { data: prior } = await admin
        .from('training_quiz_submissions')
        .select('id, passed, attempts_used')
        .eq('quiz_id', quiz.id)
        .eq('student_email', studentEmail)
        .maybeSingle()
      if (prior?.passed) {
        return json(
          {
            message:
              'You have already passed this quiz. Your previous result still stands.',
          },
          409,
        )
      }
      const limit = quiz.attempts_allowed ?? 3
      const usedSoFar = prior?.attempts_used ?? 0
      if (limit > 0 && usedSoFar >= limit) {
        return json(
          {
            message: `No retakes remaining. You used all ${limit} attempt${limit === 1 ? '' : 's'}.`,
            attemptsUsed: usedSoFar,
            attemptsAllowed: limit,
          },
          409,
        )
      }

      const { data: questions } = await admin
        .from('training_quiz_questions')
        .select('id, prompt, options, correct_index, rationale, sort_order')
        .eq('quiz_id', quiz.id)
        .order('sort_order')
      const list = (questions ?? []) as Array<{
        id: string
        prompt: string
        options: string[]
        correct_index: number
        rationale: string | null
        sort_order: number
      }>
      if (!list.length) return json({ message: 'Quiz has no questions.' }, 409)

      let correct = 0
      const review = list.map((q, i) => {
        const yourAnswer = Number(answers[i])
        const isCorrect = yourAnswer === q.correct_index
        if (isCorrect) correct++
        return {
          prompt: q.prompt,
          options: q.options,
          yourAnswer: Number.isFinite(yourAnswer) ? yourAnswer : null,
          correctIndex: q.correct_index,
          rationale: q.rationale ?? '',
          isCorrect,
        }
      })
      const scorePct = Math.round((correct / list.length) * 100)
      const passed = scorePct >= quiz.passing_pct
      const nextAttemptsUsed = usedSoFar + 1

      const { error: subErr } = await admin
        .from('training_quiz_submissions')
        .upsert(
          {
            quiz_id: quiz.id,
            session_id: session.session_id,
            student_name: studentName,
            student_email: studentEmail,
            answers: answers,
            score_pct: scorePct,
            passed,
            attempts_used: nextAttemptsUsed,
          },
          { onConflict: 'quiz_id,student_email', ignoreDuplicates: false },
        )
      if (subErr) return json({ message: subErr.message }, 500)

      return json({
        success: true,
        scorePct,
        passed,
        passingPct: quiz.passing_pct,
        correct,
        total: list.length,
        attemptsUsed: nextAttemptsUsed,
        attemptsAllowed: limit,
        attemptsLeft:
          limit > 0 ? Math.max(0, limit - nextAttemptsUsed) : null,
        review,
      })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Request failed.' },
      500,
    )
  }
})
