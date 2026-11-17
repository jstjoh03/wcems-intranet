// cert-expiry-push — one employee's certification is expiring.
//
// Called by the employee_cert_reminders() daily pg_cron sweep (over
// pg_net, no JWT — MUST be deployed with verify_jwt OFF) once per
// reminder stage (60 → 30 → 7 days → expired). Sends BOTH:
//   · a web push to every one of that user's push_subscriptions
//   · an email from education@wallercountyems.com via Graph app-only
//     Mail.Send (same creds as cert-notify)
// The recipient resolves server-side from app_users — the payload
// carries only the user id and cert facts.
//
// Secrets already set for the project: VAPID_*, GRAPH_TENANT_ID,
// LIFECYCLE_CLIENT_ID, LIFECYCLE_CLIENT_SECRET.

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

interface Payload {
  user_id: string
  cert_name: string
  expires_on: string
  days: number
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
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: 'POST', body },
  )
  if (!res.ok) {
    console.warn('[cert-expiry] graph token failed:', res.status)
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
  if (!res.ok) console.warn('[cert-expiry] sendMail failed:', res.status)
}

function phrasing(days: number, name: string): { headline: string; line: string } {
  if (days < 0) {
    return {
      headline: `${name} has expired`,
      line: `Your ${name} expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago. Upload the renewed card in the portal when you have it.`,
    }
  }
  if (days === 0) {
    return { headline: `${name} expires today`, line: `Your ${name} expires today.` }
  }
  return {
    headline: `${name} expires in ${days} day${days === 1 ? '' : 's'}`,
    line: `Your ${name} expires on the date on file. Plan the renewal and upload the new card in the portal.`,
  }
}

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let p: Payload
  try {
    p = (await req.json()) as Payload
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!p.user_id || !p.cert_name) return new Response('Bad payload', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { headline, line } = phrasing(p.days, p.cert_name)

  /* Web push to this user's devices. */
  let sent = 0
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', p.user_id)
    const list = (subs ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]
    const payload = JSON.stringify({
      title: 'Certification reminder',
      body: `📄 ${headline}`,
      url: '/my-certs',
      tag: `cert-expiry-${p.user_id}-${p.cert_name}`,
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
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') sent++
      else {
        const err = r.reason as { statusCode?: number }
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(list[i].id)
      }
    })
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead)
  }

  /* Email, resolved server-side. */
  const { data: user } = await supabase
    .from('app_users')
    .select('email, first_name, full_name, active')
    .eq('id', p.user_id)
    .maybeSingle()
  let mailed = false
  if (user?.active && user.email) {
    const tok = await graphToken()
    if (tok) {
      const first = (user.first_name as string) || (user.full_name as string)?.split(' ')[0] || 'there'
      const html = `
        <p>Hi ${first},</p>
        <p><b>${headline}</b> (expiration on file: ${p.expires_on}).</p>
        <p>${line}</p>
        <p><a href="https://employee.wallercountyems.com/my-certs">Open My Certifications</a>
        to update the card and the new expiration date — reminders stop once it's renewed.</p>
        <p style="color:#888;font-size:12px">Waller County EMS employee portal · automated reminder</p>`
      await sendMail(tok, user.email as string, `Reminder: ${headline}`, html)
      mailed = true
    }
  }

  return new Response(JSON.stringify({ push: sent, mailed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
