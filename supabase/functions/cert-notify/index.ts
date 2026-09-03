// cert-notify — email employees about compliance items on their file.
//
// The portal's Action Center computes who is missing required certs or
// holding expired/expiring cards & licenses; an editor clicks "Email
// affected employees" and this function sends each person ONE email
// listing THEIR items, from education@wallercountyems.com via Graph
// app-only Mail.Send (the WCEMS Lifecycle Automation app registration).
//
// POST body:
//   { dryRun: true, people: [...] }   → resolve recipients, send nothing
//   { test: true,  people: [...] }    → build every email but deliver
//                                       them ALL to the caller only
//   { people: [{ userId, items: [{ item, status, when }] }] }
//
// Recipient addresses are ALWAYS resolved server-side from app_users —
// the client supplies userIds and item text only, so this endpoint can
// never be pointed at an arbitrary mailbox.
//
// Auth: x-sync-secret, or a signed-in admin's / pipeline editor's JWT
// (same policy as cert-import).

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST',
}

const SENDER = 'education@wallercountyems.com'
const MAX_RECIPIENTS = 120

interface NotifyItem {
  item: string
  status: string
  when: string | null
}
interface NotifyPerson {
  userId: string
  items: NotifyItem[]
}

async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.get('LIFECYCLE_CLIENT_ID')!,
    client_secret: env.get('LIFECYCLE_CLIENT_SECRET')!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${env.get('GRAPH_TENANT_ID')}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  )
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 250)}`)
  return (await res.json()).access_token
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
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 250)}`)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function buildEmail(firstName: string, items: NotifyItem[]): { subject: string; html: string } {
  const rows = items
    .map((it) => {
      const when = fmtWhen(it.when)
      return `<tr>
        <td style="padding:7px 14px 7px 0;border-bottom:1px solid #e6e2d8;font-weight:600;color:#182644;">${esc(it.item)}</td>
        <td style="padding:7px 0;border-bottom:1px solid #e6e2d8;color:#5a5f6b;">${esc(it.status)}${when ? ` — ${esc(when)}` : ''}</td>
      </tr>`
    })
    .join('')
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#273142;max-width:640px;">
    <div style="border-bottom:3px solid #182644;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:17px;font-weight:700;color:#182644;letter-spacing:0.04em;">WALLER COUNTY EMS</div>
      <div style="font-size:11px;letter-spacing:0.14em;color:#a8842c;font-weight:600;">CLINICAL DEVELOPMENT</div>
    </div>
    <p>Hi ${esc(firstName)},</p>
    <p>A review of your clinical file shows the following item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} attention:</p>
    <table style="border-collapse:collapse;width:100%;margin:6px 0 14px;">${rows}</table>
    <p>If you have already completed any of these, reply to this email with a photo or PDF of the card or certificate and we will update your file. Otherwise, please plan to complete them before the dates listed — reach out if you need help getting scheduled.</p>
    <p style="margin-top:18px;">Thank you,<br/>
    <b>Clinical Development</b><br/>
    Waller County EMS<br/>
    <a href="mailto:${SENDER}" style="color:#182644;">${SENDER}</a></p>
  </div>`
  return {
    subject: `Action needed: ${items.length} item${items.length === 1 ? '' : 's'} on your clinical file`,
    html,
  }
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'POST only' }, { status: 405, headers: CORS })

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  /* Secret (script path) or admin/pipeline-editor JWT (portal path). */
  const secret = env.get('ROSTER_SYNC_SECRET')
  let authorized = !!secret && req.headers.get('x-sync-secret') === secret
  let callerEmail: string | null = null
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (jwt) {
    const { data } = await supabase.auth.getUser(jwt)
    if (data.user) {
      const { data: row } = await supabase
        .from('app_users')
        .select('id, role, active, email')
        .eq('auth_user_id', data.user.id)
        .maybeSingle()
      if (row?.active) {
        callerEmail = row.email ?? null
        if (!authorized) {
          if (row.role === 'admin') authorized = true
          else {
            const { data: ed } = await supabase
              .from('pipeline_editors')
              .select('user_id')
              .eq('user_id', row.id)
              .maybeSingle()
            authorized = !!ed
          }
        }
      }
    }
  }
  if (!authorized)
    return Response.json({ ok: false, error: 'Not authorized' }, { status: 401, headers: CORS })

  let body: { dryRun?: boolean; test?: boolean; people?: NotifyPerson[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: CORS })
  }

  const people = (body.people ?? []).filter(
    (p) => p && typeof p.userId === 'string' && Array.isArray(p.items) && p.items.length > 0,
  )
  if (people.length === 0)
    return Response.json({ ok: false, error: 'No recipients' }, { status: 400, headers: CORS })
  if (people.length > MAX_RECIPIENTS)
    return Response.json(
      { ok: false, error: `Refusing to send to more than ${MAX_RECIPIENTS} people in one run` },
      { status: 400, headers: CORS },
    )
  if (body.test && !callerEmail)
    return Response.json(
      { ok: false, error: 'Test mode needs a signed-in caller to deliver to' },
      { status: 400, headers: CORS },
    )

  /* Resolve recipients server-side — userIds in, real work addresses
     out. Inactive people and userIds this DB doesn't know are skipped
     and reported, never guessed. */
  const ids = people.map((p) => p.userId)
  const { data: users, error: uErr } = await supabase
    .from('app_users')
    .select('id, full_name, email, active, account_type')
    .in('id', ids)
  if (uErr) return Response.json({ ok: false, error: uErr.message }, { status: 500, headers: CORS })

  const byId = new Map<string, { full_name: string; email: string | null; active: boolean; account_type: string }>()
  for (const u of users ?? []) byId.set(u.id, u)

  const resolved: Array<{ userId: string; name: string; email: string; items: NotifyItem[] }> = []
  const skipped: Array<{ userId: string; name: string | null; reason: string }> = []
  for (const p of people) {
    const u = byId.get(p.userId)
    if (!u) skipped.push({ userId: p.userId, name: null, reason: 'unknown user' })
    else if (!u.active) skipped.push({ userId: p.userId, name: u.full_name, reason: 'inactive' })
    else if (u.account_type && u.account_type !== 'person')
      skipped.push({ userId: p.userId, name: u.full_name, reason: 'not a person account' })
    else if (!u.email) skipped.push({ userId: p.userId, name: u.full_name, reason: 'no email on file' })
    else resolved.push({ userId: p.userId, name: u.full_name, email: u.email, items: p.items.slice(0, 25) })
  }

  if (body.dryRun) {
    return Response.json(
      {
        ok: true,
        dryRun: true,
        sender: SENDER,
        recipients: resolved.map((r) => ({ name: r.name, email: r.email, itemCount: r.items.length })),
        skipped,
      },
      { headers: CORS },
    )
  }

  const tok = await graphToken()
  const sent: Array<{ name: string; email: string }> = []
  const failed: Array<{ name: string; email: string; error: string }> = []
  for (const r of resolved) {
    const first = r.name.split(' ')[0] || r.name
    const mail = buildEmail(first, r.items)
    const to = body.test ? callerEmail! : r.email
    const subject = body.test ? `TEST (would go to ${r.email}) — ${mail.subject}` : mail.subject
    try {
      await sendMail(tok, to, subject, mail.html)
      sent.push({ name: r.name, email: to })
    } catch (e) {
      failed.push({ name: r.name, email: to, error: (e as Error).message })
    }
  }

  return Response.json(
    { ok: true, test: !!body.test, sender: SENDER, sentCount: sent.length, sent, failed, skipped },
    { headers: CORS },
  )
})
