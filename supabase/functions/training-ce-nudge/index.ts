// training-ce-nudge — push-nudge the attendees of a training session
// who still owe the quiz and/or eval that gates their CE credit.
//
// POST { session_id: 'SES-...' }  (verify_jwt OFF — called over pg_net
// or by an admin tool; everything resolves server-side from the id, so
// the caller can't aim it at arbitrary people or write the message.)
//
// Who gets nudged mirrors the Session Controls roster exactly:
//   checked-in, not Pending, and missing the eval (no training_evals
//   row matching their email or normalized name, no eval_credited
//   override) or the quiz (no passed training_quiz_submissions row by
//   the same matching, no quiz_credited override).
//
// Each person's push deep-links to what THEY still owe (quiz first),
// using the session's own tokens. Push only — the CE email with both
// links already went out by hand.

// @ts-expect-error npm specifier resolved by Supabase Edge Runtime
import webpush from 'npm:web-push@3.6.7'
// @ts-expect-error esm.sh URL resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const VAPID_PUBLIC_KEY = env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = env.get('VAPID_SUBJECT') ?? ''
const SUPABASE_URL = env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

function normName(n: string): string {
  return (n || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: { session_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const sessionId = (body.session_id ?? '').trim()
  if (!sessionId) return new Response('session_id required', { status: 400 })
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT)
    return new Response('VAPID not configured', { status: 500 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: session } = await supabase
    .from('course_sessions')
    .select('session_id, title, quiz_token, eval_token')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (!session) return new Response('Unknown session', { status: 404 })

  const [att, evals, subs] = await Promise.all([
    supabase
      .from('training_attendance')
      .select('id, student_name, student_email, status, phase, eval_credited, quiz_credited, user_id')
      .eq('session_id', sessionId),
    supabase.from('training_evals').select('student_name, student_email').eq('session_id', sessionId),
    supabase
      .from('training_quiz_submissions')
      .select('student_name, student_email, passed')
      .eq('session_id', sessionId),
  ])

  const evalEmails = new Set((evals.data ?? []).map((e) => (e.student_email ?? '').toLowerCase()))
  const evalNames = new Set((evals.data ?? []).map((e) => normName(e.student_name ?? '')))
  const passed = (subs.data ?? []).filter((s) => s.passed)
  const quizEmails = new Set(passed.map((s) => (s.student_email ?? '').toLowerCase()))
  const quizNames = new Set(passed.map((s) => normName(s.student_name ?? '')))

  type Owing = { name: string; email: string; userId: string | null; missing: string }
  const owing: Owing[] = []
  for (const a of att.data ?? []) {
    if (a.phase !== 'checkedin' || a.status === 'Pending') continue
    const email = (a.student_email ?? '').toLowerCase()
    const nname = normName(a.student_name ?? '')
    const evalDone = !!a.eval_credited || evalEmails.has(email) || (!!nname && evalNames.has(nname))
    const quizDone = !!a.quiz_credited || quizEmails.has(email) || (!!nname && quizNames.has(nname))
    if (evalDone && quizDone) continue
    const missing = !quizDone && !evalDone ? 'quiz and eval' : !quizDone ? 'quiz' : 'eval'
    owing.push({ name: a.student_name ?? '', email, userId: a.user_id ?? null, missing })
  }

  /* Resolve portal accounts: the attendance row's user_id, else an
     active app_users match on the check-in email. */
  const unmatchedEmails = owing.filter((o) => !o.userId && o.email).map((o) => o.email)
  if (unmatchedEmails.length) {
    const { data: users } = await supabase
      .from('app_users')
      .select('id, email')
      .in('email', unmatchedEmails)
      .eq('active', true)
    const byEmail = new Map((users ?? []).map((u) => [(u.email as string).toLowerCase(), u.id as string]))
    for (const o of owing) if (!o.userId) o.userId = byEmail.get(o.email) ?? null
  }

  const userIds = owing.map((o) => o.userId).filter((x): x is string => !!x)
  const { data: allSubs } = userIds.length
    ? await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', userIds)
    : { data: [] }
  const subsByUser = new Map<string, { id: string; endpoint: string; p256dh: string; auth: string }[]>()
  for (const s of (allSubs ?? []) as { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }

  const title = (session.title as string) || 'Training'
  const dead: string[] = []
  const report: Array<{ name: string; missing: string; devices: number; delivered: number }> = []
  for (const o of owing) {
    const devices = o.userId ? (subsByUser.get(o.userId) ?? []) : []
    const url = o.missing.includes('quiz')
      ? `/quiz?t=${session.quiz_token}`
      : `/eval?t=${session.eval_token}`
    const payload = JSON.stringify({
      title: 'CE credit — action needed',
      body: `${title}: your ${o.missing} ${o.missing.includes('and') ? 'are' : 'is'} still outstanding. CEs can't be issued until both are done.`,
      url,
      tag: `ce-nudge-${sessionId}-${o.userId ?? o.email}`,
      icon: '/wcems-patch.png',
      badge: '/wcems-patch.png',
    })
    const results = await Promise.allSettled(
      devices.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload),
      ),
    )
    let delivered = 0
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') delivered++
      else {
        const err = r.reason as { statusCode?: number }
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(devices[i].id)
      }
    })
    report.push({ name: o.name, missing: o.missing, devices: devices.length, delivered })
  }
  if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead)

  return new Response(
    JSON.stringify({
      ok: true,
      session: sessionId,
      owing: owing.length,
      pushed: report.filter((r) => r.delivered > 0).length,
      unreachable: report.filter((r) => r.delivered === 0).map((r) => ({ name: r.name, missing: r.missing })),
      report,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
