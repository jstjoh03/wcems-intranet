// supabase/functions/send-comment-push/index.ts
//
// Targeted Web Push to the PERSON a comment is about — spotlight
// congratulations and birthday wishes — so recognition actually
// reaches its subject instead of sitting unseen on the dashboard.
//
// Triggered by AFTER INSERT triggers on spotlight_comments and
// birthday_comments (migration comment_push_triggers) via pg_net.
// Unlike send-announcement-push (fan-out to everyone), this resolves
// ONE recipient and pushes only to their subscriptions:
//
//   spotlight — spotlights.person_name matched to app_users.full_name
//               (case-insensitive)
//   birthday  — person_key is slugify(full_name) (lowercase, spaces →
//               dashes), matched against the roster in JS
//
// Self-comments never notify. Recipients without push subscriptions
// (never enabled notifications, or name didn't match a roster row)
// resolve to {sent: 0} — the comment itself is unaffected.
//
// Deployed with --no-verify-jwt (caller is a Postgres trigger).
// Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.

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

interface CommentPayload {
  kind: 'spotlight' | 'birthday'
  user_id: string
  body: string
  spotlight_id?: string
  person_key?: string
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || 'A teammate'
}

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error('[comment-push] missing VAPID secrets')
    return new Response('Server not configured', { status: 500 })
  }

  let p: CommentPayload
  try {
    p = (await req.json()) as CommentPayload
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const done = (info: Record<string, unknown>) =>
    new Response(JSON.stringify(info), { status: 200, headers: { 'Content-Type': 'application/json' } })

  // Author (for the notification copy)
  const { data: author } = await supabase
    .from('app_users')
    .select('id, full_name')
    .eq('id', p.user_id)
    .maybeSingle()
  const authorName = author?.full_name ? firstName(author.full_name) : 'A teammate'

  // Resolve the recipient
  let targetId: string | null = null
  if (p.kind === 'spotlight' && p.spotlight_id) {
    const { data: spot } = await supabase
      .from('spotlights')
      .select('person_name')
      .eq('id', p.spotlight_id)
      .maybeSingle()
    if (spot?.person_name) {
      const { data: match } = await supabase
        .from('app_users')
        .select('id')
        .ilike('full_name', spot.person_name.trim())
        .limit(1)
        .maybeSingle()
      targetId = match?.id ?? null
    }
  } else if (p.kind === 'birthday' && p.person_key) {
    const { data: users } = await supabase
      .from('app_users')
      .select('id, full_name')
      .eq('active', true)
    targetId = (users ?? []).find((u: { full_name: string }) => slugify(u.full_name) === p.person_key)?.id ?? null
  }

  if (!targetId) return done({ sent: 0, reason: 'no matching recipient' })
  if (targetId === p.user_id) return done({ sent: 0, reason: 'self-comment' })

  const { data: subs, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', targetId)
  if (subErr) return new Response('Subscriptions query failed', { status: 500 })
  const subscriptions = (subs ?? []) as SubscriptionRow[]
  if (subscriptions.length === 0) return done({ sent: 0, reason: 'recipient has no push subscriptions' })

  const snippet = p.body.replace(/\s+/g, ' ').trim().slice(0, 120)
  const payload = JSON.stringify(
    p.kind === 'spotlight'
      ? {
          title: `🎉 ${authorName} congratulated you`,
          body: `On your Employee Spotlight: "${snippet}"`,
          url: '/#people',
          tag: `spotlight-comment-${p.spotlight_id}`,
          icon: '/wcems-patch.png',
          badge: '/wcems-patch.png',
        }
      : {
          title: `🎂 ${authorName} wished you a happy birthday`,
          body: `"${snippet}"`,
          url: '/#people',
          tag: `birthday-comment-${p.person_key}`,
          icon: '/wcems-patch.png',
          badge: '/wcems-patch.png',
        },
  )

  const deadIds: string[] = []
  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload),
    ),
  )
  let sent = 0
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sent++
    } else {
      const err = r.reason as { statusCode?: number; message?: string }
      if (err.statusCode === 404 || err.statusCode === 410) deadIds.push(subscriptions[i].id)
      else console.warn('[comment-push] send failed:', err.statusCode, err.message)
    }
  })
  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds)
  }

  return done({ sent })
})
