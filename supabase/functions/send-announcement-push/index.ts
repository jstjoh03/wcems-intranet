// supabase/functions/send-announcement-push/index.ts
//
// Fans out a Web Push notification to every row in
// public.push_subscriptions when a new announcement is INSERTed.
//
// Triggered by the announcements_notify_new AFTER INSERT trigger
// (see migration 0042). The trigger POSTs the new announcement row
// here; we encrypt + sign per subscription using VAPID and deliver to
// each push endpoint (FCM for Chrome/Edge, Mozilla for Firefox,
// Apple for Safari, etc.).
//
// Dead subscriptions (404 / 410 from the push service) get deleted so
// the table doesn't accumulate garbage.
//
// Deployed with `--no-verify-jwt` because the only caller is a
// Postgres trigger over pg_net with no JWT.
//
// Secrets (set via `npx supabase secrets set ...`):
//   VAPID_PUBLIC_KEY   — public key from `npx web-push generate-vapid-keys`
//   VAPID_PRIVATE_KEY  — private key from same command
//   VAPID_SUBJECT      — `mailto:you@example.com` (RFC 8292 requires it)

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

interface AnnouncementPayload {
  id: string
  tag: string
  title: string
  body: string | null
  image_url: string | null
  author_name: string
  published_at: string
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
    console.error('[push] missing VAPID secrets — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT')
    return new Response('Server not configured', { status: 500 })
  }

  let announcement: AnnouncementPayload
  try {
    announcement = (await req.json()) as AnnouncementPayload
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (error) {
    console.error('[push] subs query failed:', error.message)
    return new Response('Subscriptions query failed', { status: 500 })
  }

  const subscriptions = (subs ?? []) as SubscriptionRow[]
  if (subscriptions.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /* Body is intentionally short — most platforms truncate to ~120
     chars and a long body just hides the headline. Tag namespaces
     announcements so a fresh notification replaces a stale one rather
     than stacking. URL takes the user to the dashboard, where the
     announcements card scrolls into view. */
  const truncated = (announcement.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  const payload = JSON.stringify({
    title: `${announcement.tag}: ${announcement.title}`,
    body: truncated,
    url: '/#announcements',
    tag: `announcement-${announcement.id}`,
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
      // 404 = subscription never existed; 410 = unsubscribed/expired.
      if (err.statusCode === 404 || err.statusCode === 410) {
        deadIds.push(subscriptions[i].id)
      } else {
        console.warn('[push] send failed:', err.statusCode, err.message)
      }
    }
  })

  if (deadIds.length > 0) {
    const { error: delErr } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', deadIds)
    if (delErr) {
      console.warn('[push] cleanup failed:', delErr.message)
    }
  }

  const sent = results.filter((r) => r.status === 'fulfilled').length
  return new Response(
    JSON.stringify({ sent, dropped: deadIds.length, total: subscriptions.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
