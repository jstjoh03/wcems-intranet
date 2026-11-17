// rec-filed-notify — an advancement recommendation was just filed.
//
// Called by the ftep_recommendations_notify AFTER INSERT trigger over
// pg_net (no JWT — MUST be deployed with verify_jwt OFF). Looks the
// letter up by id, then pushes and emails the CDO office:
//   "Brittany Wooldridge filed an advancement recommendation
//    (Release) for Tyler Lowery — 1 of 2 on file."
//
// Recipients are a FIXED list (Justin: "only Heather and myself",
// 2026-11-17 — explicitly NOT the whole pipeline_editors circle).
// Staffing change = edit RECIPIENT_EMAILS and redeploy.
//
// Secrets already set: VAPID_*, GRAPH_TENANT_ID, LIFECYCLE_CLIENT_ID,
// LIFECYCLE_CLIENT_SECRET.

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
const SENDER = 'education@wallercountyems.com'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

const CHOICE_LABELS: Record<string, string> = {
  release: 'Release',
  extend: 'Extend training',
  separate: 'Separation',
}

async function graphToken(): Promise<string | null> {
  const tenant = env.get('GRAPH_TENANT_ID')
  const id = env.get('LIFECYCLE_CLIENT_ID')
  const secret = env.get('LIFECYCLE_CLIENT_SECRET')
  if (!tenant || !id || !secret) return null
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    body,
  })
  if (!res.ok) {
    console.warn('[rec-notify] graph token failed:', res.status)
    return null
  }
  return (await res.json()).access_token as string
}

async function sendMail(tok: string, to: string, subject: string, html: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  })
  if (!res.ok) console.warn('[rec-notify] sendMail failed:', res.status)
}

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let id: string
  try {
    id = ((await req.json()) as { id: string }).id
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!id) return new Response('Bad payload', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: rec } = await supabase
    .from('ftep_recommendations')
    .select(
      'id, trainee_id, transition, recommendation, recommender_role, trainee:app_users!ftep_recommendations_trainee_id_fkey(full_name), recommender:app_users!ftep_recommendations_recommender_id_fkey(full_name)',
    )
    .eq('id', id)
    .maybeSingle()
  if (!rec) return new Response('Not found', { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = rec as any
  const traineeName = r.trainee?.full_name ?? 'a trainee'
  const recommenderName = r.recommender?.full_name ?? 'Someone'
  const choice = CHOICE_LABELS[r.recommendation] ?? r.recommendation

  const { count } = await supabase
    .from('ftep_recommendations')
    .select('id', { count: 'exact', head: true })
    .eq('trainee_id', r.trainee_id)
    .eq('transition', r.transition)
  const tally = `${count ?? 1} of 2 on file`

  const headline = `${recommenderName} filed an advancement recommendation (${choice}) for ${traineeName}`

  /* Recipients: fixed CDO-office list, resolved to accounts server-side. */
  const RECIPIENT_EMAILS = [
    'justin.stjohn@wallercountyems.com',
    'heather.fojt@wallercountyems.com',
  ]
  const { data: people } = await supabase
    .from('app_users')
    .select('id, email, full_name, active')
    .in('email', RECIPIENT_EMAILS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recips = ((people ?? []) as any[]).filter((u) => u?.active && u?.email)

  /* Push to each editor's devices. */
  let pushed = 0
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT && recips.length) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .in('user_id', recips.map((u) => u.id))
    const list = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]
    const payload = JSON.stringify({
      title: 'Advancement recommendation filed',
      body: `📋 ${headline} — ${tally}.`,
      url: `/clinical/people/${r.trainee_id}`,
      tag: `rec-filed-${r.id}`,
      icon: '/wcems-patch.png',
      badge: '/wcems-patch.png',
    })
    const results = await Promise.allSettled(
      list.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        ),
      ),
    )
    const dead: string[] = []
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') pushed++
      else {
        const err = res.reason as { statusCode?: number }
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(list[i].id)
      }
    })
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead)
  }

  /* One email per editor. */
  let mailed = 0
  const tok = await graphToken()
  if (tok) {
    const html = `
      <p><b>${headline}.</b></p>
      <p>${tally} for this credentialing step.</p>
      <p><a href="https://employee.wallercountyems.com/clinical/people/${r.trainee_id}">Open ${traineeName}'s credentialing file</a>
      — the letter is under Advancement recommendations.</p>
      <p style="color:#888;font-size:12px">Waller County EMS employee portal · automated notice</p>`
    for (const u of recips) {
      await sendMail(tok, u.email as string, headline, html)
      mailed++
    }
  }

  return new Response(JSON.stringify({ pushed, mailed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
