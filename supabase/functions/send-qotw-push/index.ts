// supabase/functions/send-qotw-push/index.ts
//
// Fans a Web Push out to every push_subscriptions row when the
// Question of the Week publishes (qotw_notify_published AFTER UPDATE
// trigger over pg_net — see migration 20261117090000_qotw.sql).
// Clone of send-announcement-push with QOTW copy.
//
// Dead subscriptions (404 / 410) are pruned.
//
// MUST be deployed with verify_jwt OFF — the only caller is a
// Postgres trigger over pg_net with no JWT (same foot-gun as
// send-announcement-push and sched-ics).
//
// Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
// (already set for send-announcement-push).

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

interface QotwPayload {
  id: string
  prompt: string
  kind: 'text' | 'poll'
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error('[qotw-push] missing VAPID secrets')
    return new Response('Server not configured', { status: 500 })
  }

  let question: QotwPayload
  try {
    question = (await req.json()) as QotwPayload
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (error) {
    console.error('[qotw-push] subs query failed:', error.message)
    return new Response('Subscriptions query failed', { status: 500 })
  }

  const subscriptions = (subs ?? []) as SubscriptionRow[]
  if (subscriptions.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /* Short body; the prompt IS the hook. Tag namespaces by question so
     a Publish-now correction replaces the stale notification. */
  const prompt = question.prompt.replace(/\s+/g, ' ').trim().slice(0, 140)
  const payload = JSON.stringify({
    title: 'Question of the Week',
    body: question.kind === 'poll' ? `🗳️ ${prompt}` : `💬 ${prompt}`,
    url: '/#qotw',
    tag: `qotw-${question.id}`,
    icon: '/wcems-patch.png',
    badge: '/wcems-patch.png',
  })

  const deadIds: string[] = []
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      ),
    ),
  )

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const err = r.reason as { statusCode?: number; message?: string }
      if (err.statusCode === 404 || err.statusCode === 410) {
        deadIds.push(subscriptions[i].id)
      } else {
        console.warn('[qotw-push] send failed:', err.statusCode, err.message)
      }
    }
  })

  if (deadIds.length > 0) {
    const { error: delErr } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', deadIds)
    if (delErr) console.warn('[qotw-push] cleanup failed:', delErr.message)
  }

  const sent = results.filter((r) => r.status === 'fulfilled').length
  return new Response(
    JSON.stringify({ sent, dropped: deadIds.length, total: subscriptions.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
