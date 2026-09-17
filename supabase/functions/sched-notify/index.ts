// sched-notify — every outbound message the scheduling module sends:
// page-outs (supervisor/editor blasts about open shifts) and the
// request-lifecycle notifications (filed, decided, trade activity,
// schedule changed by a scheduler).
//
// POST body (always JSON, caller's portal JWT in Authorization):
//   { kind: 'pageout',           pageId }
//   { kind: 'request_submitted', requestIds: [uuid, …] }
//   { kind: 'request_decided',   requestId }
//   { kind: 'schedule_change',   userId, summary }
//   { kind: 'trade_activity',    requestId, offerUserId?,
//     event: 'offer'|'accepted'|'declined'|'direct_request'|'direct_accepted'|'direct_declined' }
//
// Recipients and their addresses are ALWAYS resolved server-side:
// the caller supplies ids, this function decides who may be told what
// (page-outs use the recipient list frozen on the sched_pages row) and
// pulls emails/phones/push subscriptions itself. Each person's
// notification matrix (sched_member_settings.notify — absent = ON) and
// SMS opt-in are honored per channel; nobody is notified about their
// own action.
//
// Channels:
//   push  — web-push over the portal's existing VAPID keys +
//           push_subscriptions rows (per-user).
//   email — Graph app-only Mail.Send from schedule@wallercountyems.com
//           (same LIFECYCLE app registration as the birthday digest).
//   sms   — Twilio REST. Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//           and TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM (E.164).
//           When unset, SMS is skipped and reported — push/email still go.
//
// Deployed with the gateway JWT check ON; role authorization happens
// here (portal JWT → app_users → sched level), matching cert-notify.

// @ts-expect-error npm specifier resolved by Supabase Edge Runtime
import webpush from 'npm:web-push@3.6.7'
// @ts-expect-error esm.sh URL resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // x-client-info is sent by supabase-js functions.invoke — omitting it
  // fails the preflight and the browser never reaches the function.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL = 'https://employee.wallercountyems.com'
/* Dedicated scheduling mailbox (shared, created 2026-09-17) so crews
 * see where the message came from; the LIFECYCLE app's tenant-wide
 * Mail.Send covers it like any mailbox. */
const SENDER = 'schedule@wallercountyems.com'

const VAPID_PUBLIC_KEY = env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = env.get('VAPID_SUBJECT') ?? ''
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

const TW_SID = env.get('TWILIO_ACCOUNT_SID') ?? ''
const TW_TOKEN = env.get('TWILIO_AUTH_TOKEN') ?? ''
const TW_MSS = env.get('TWILIO_MESSAGING_SERVICE_SID') ?? ''
const TW_FROM = env.get('TWILIO_FROM') ?? ''
const smsConfigured = !!(TW_SID && TW_TOKEN && (TW_MSS || TW_FROM))

const sb = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const REQ_LABELS: Record<string, string> = {
  time_off: 'Time off',
  extra_hours: 'Extra hours',
  pickup: 'Shift pickup',
  trade: 'Shift trade',
  giveaway: 'Giveaway',
}
const OFF_LABELS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  unpaid: 'Unpaid time off',
  bereavement: 'Bereavement',
}

// ── formatting ───────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtTime(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts)
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' })
    .replace(':', '')
}

function windowText(startAt: string | null, endAt: string | null): string {
  if (!startAt || !endAt) return ''
  return ` ${fmtTime(startAt)}–${fmtTime(endAt)}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clean(s: unknown, max: number): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function e164(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (phone.trim().startsWith('+') && digits.length >= 11 && digits.length <= 15) return `+${digits}`
  return null
}

/** One cell of the notification matrix — absent means ON. */
function notifyOn(notify: unknown, type: string, ch: 'push' | 'email' | 'sms'): boolean {
  const t = (notify as Record<string, Record<string, unknown>> | null)?.[type]
  return t?.[ch] !== false
}

// ── senders ──────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).access_token
}

async function sendMail(tok: string, to: string, subject: string, html: string): Promise<void> {
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
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

/* Every outbound text carries opt-out language — CTIA best practice,
 * and toll-free/A2P reviewers check message samples against actual
 * traffic (rejection 30909 taught us they mean it). Own line so the
 * message body stays readable. */
const SMS_OPT_OUT = '\nReply STOP to opt out, HELP for help.'

async function sendSms(to: string, body: string): Promise<void> {
  const params = new URLSearchParams({ To: to, Body: body + SMS_OPT_OUT })
  if (TW_MSS) params.set('MessagingServiceSid', TW_MSS)
  else params.set('From', TW_FROM)
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${TW_SID}:${TW_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

function schedEmail(firstName: string, lines: string[]): string {
  const paras = lines.map((l) => `<p style="margin:0 0 10px;">${l}</p>`).join('\n    ')
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#273142;max-width:640px;">
    <div style="border-bottom:3px solid #182644;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:17px;font-weight:700;color:#182644;letter-spacing:0.04em;">WALLER COUNTY EMS</div>
      <div style="font-size:11px;letter-spacing:0.14em;color:#a8842c;font-weight:600;">SCHEDULING</div>
    </div>
    <p>Hi ${esc(firstName)},</p>
    ${paras}
    <p style="margin:16px 0 0;">
      <a href="${PORTAL}/schedule" style="display:inline-block;background:#182644;color:#ffffff;text-decoration:none;font-weight:600;padding:9px 18px;border-radius:8px;">Open the schedule</a>
    </p>
    <p style="margin-top:18px;color:#8a8f99;font-size:12px;">Manage which messages you receive under My schedule → My settings on the portal.</p>
  </div>`
}

// ── recipient resolution ─────────────────────────────────────────────

interface Delivery {
  push: number
  email: number
  sms: number
  errors: string[]
  skippedSms: number
}

/**
 * Fan one message out to a set of members over the channels each has
 * enabled for `typeKey`. `exclude` (normally the caller) is never
 * notified about their own action.
 */
async function deliver(
  userIds: string[],
  typeKey: string,
  m: {
    title: string
    body: string
    tag: string
    subject: string
    emailLines: string[]
    sms: string
    url?: string
    channels?: { push?: boolean; email?: boolean; sms?: boolean }
  },
  exclude: string | null,
): Promise<Delivery> {
  const out: Delivery = { push: 0, email: 0, sms: 0, errors: [], skippedSms: 0 }
  const ids = [...new Set(userIds)].filter((id) => id && id !== exclude)
  if (ids.length === 0) return out

  const [uRes, sRes, pRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, email, phone, active, account_type').in('id', ids),
    sb.from('sched_member_settings').select('user_id, notify, sms_opt_in, sms_phone').in('user_id', ids),
    sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', ids),
  ])
  if (uRes.error) {
    out.errors.push(`users: ${uRes.error.message}`)
    return out
  }
  const settings = new Map<string, { notify: unknown; sms_opt_in: boolean; sms_phone: string | null }>()
  for (const r of sRes.data ?? [])
    settings.set(r.user_id, { notify: r.notify, sms_opt_in: !!r.sms_opt_in, sms_phone: r.sms_phone ?? null })

  const people = (uRes.data ?? []).filter((u) => u.active && (!u.account_type || u.account_type === 'person'))
  const chOn = { push: m.channels?.push !== false, email: m.channels?.email !== false, sms: m.channels?.sms !== false }

  // push
  if (chOn.push && VAPID_PUBLIC_KEY) {
    const wantPush = new Set(
      people.filter((u) => notifyOn(settings.get(u.id)?.notify ?? {}, typeKey, 'push')).map((u) => u.id),
    )
    const subs = (pRes.data ?? []).filter((s) => wantPush.has(s.user_id))
    const payload = JSON.stringify({
      title: m.title,
      body: m.body.slice(0, 160),
      url: m.url ?? '/schedule',
      tag: m.tag,
      icon: '/wcems-patch.png',
      badge: '/wcems-patch.png',
    })
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload),
      ),
    )
    const dead: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push++
      else {
        const err = r.reason as { statusCode?: number }
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(subs[i].id)
      }
    })
    if (dead.length > 0) await sb.from('push_subscriptions').delete().in('id', dead)
  }

  // email
  if (chOn.email) {
    const emailTo = people.filter(
      (u) => u.email && notifyOn(settings.get(u.id)?.notify ?? {}, typeKey, 'email'),
    )
    if (emailTo.length > 0) {
      try {
        const tok = await graphToken()
        for (const u of emailTo) {
          const first = (u.full_name ?? '').split(' ')[0] || 'there'
          try {
            await sendMail(tok, u.email as string, m.subject, schedEmail(first, m.emailLines))
            out.email++
          } catch (e) {
            out.errors.push(`email ${u.full_name}: ${(e as Error).message}`)
          }
        }
      } catch (e) {
        out.errors.push(`email token: ${(e as Error).message}`)
      }
    }
  }

  // sms — opt-in AND a usable phone AND the matrix cell on
  if (chOn.sms) {
    const smsTo = people
      .map((u) => {
        const st = settings.get(u.id)
        if (!st?.sms_opt_in) return null
        if (!notifyOn(st.notify ?? {}, typeKey, 'sms')) return null
        // Texts go to the number consented to on the opt-in form; the
        // roster phone is only the fallback for pre-existing opt-ins.
        const to = e164(st.sms_phone || u.phone)
        if (!to) {
          out.skippedSms++
          return null
        }
        return { to, name: u.full_name as string }
      })
      .filter((x): x is { to: string; name: string } => x !== null)
    if (smsTo.length > 0) {
      if (!smsConfigured) {
        out.errors.push(`sms: Twilio secrets not set — ${smsTo.length} text${smsTo.length === 1 ? '' : 's'} skipped`)
      } else {
        for (const r of smsTo) {
          try {
            // 480 clears the worst legit page-out (120-char lead + two
            // shift lines + urgent note + link) without cutting the
            // link; the composer caps custom text so nothing real
            // gets near this.
            await sendSms(r.to, m.sms.slice(0, 480))
            out.sms++
          } catch (e) {
            out.errors.push(`sms ${r.name}: ${(e as Error).message}`)
          }
        }
      }
    }
  }

  return out
}

// ── auth ─────────────────────────────────────────────────────────────

interface Caller {
  id: string
  name: string
  level: string
}

async function resolveCaller(req: Request): Promise<Caller | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data } = await sb.auth.getUser(jwt)
  if (!data.user) return null
  const { data: row } = await sb
    .from('app_users')
    .select('id, full_name, role, active')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()
  if (!row?.active) return null
  const { data: acc } = await sb.from('sched_access').select('level').eq('user_id', row.id).maybeSingle()
  const level = acc?.level ?? (row.role === 'admin' || row.role === 'supervisor' ? 'supervisor' : 'member')
  if (level === 'none') return null
  return { id: row.id, name: row.full_name, level }
}

const isEditor = (c: Caller) => c.level === 'global_admin' || c.level === 'scheduler'
const canPage = (c: Caller) => isEditor(c) || c.level === 'supervisor'

async function editorIds(): Promise<string[]> {
  const { data } = await sb.from('sched_access').select('user_id, level').in('level', ['global_admin', 'scheduler'])
  return (data ?? []).map((r) => r.user_id)
}

// ── request row helpers ──────────────────────────────────────────────

interface ReqRow {
  id: string
  type: string
  requester_id: string
  counterparty_id: string | null
  work_date: string | null
  start_at: string | null
  end_at: string | null
  off_type: string | null
  unit_code: string | null
  position_label: string | null
  decision_note: string | null
  status: string
}

async function loadRequests(ids: string[]): Promise<ReqRow[]> {
  const { data, error } = await sb
    .from('sched_requests')
    .select('id, type, requester_id, counterparty_id, work_date, start_at, end_at, off_type, unit_code, position_label, decision_note, status')
    .in('id', ids)
  if (error) throw new Error(error.message)
  return (data ?? []) as ReqRow[]
}

async function nameOf(userId: string | null): Promise<string> {
  if (!userId) return 'Someone'
  const { data } = await sb.from('app_users').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name ?? 'Someone'
}

function reqLine(r: ReqRow): string {
  const label = r.type === 'time_off' ? `${OFF_LABELS[r.off_type ?? ''] ?? 'Time off'} time off` : (REQ_LABELS[r.type] ?? r.type)
  const where = [r.unit_code, r.position_label].filter(Boolean).join(' ')
  return `${label} — ${fmtDate(r.work_date)}${windowText(r.start_at, r.end_at)}${where ? ` (${where})` : ''}`
}

// ── main ─────────────────────────────────────────────────────────────

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'POST only' }, { status: 405, headers: CORS })

  const caller = await resolveCaller(req)
  if (!caller) return Response.json({ ok: false, error: 'Not authorized' }, { status: 401, headers: CORS })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: CORS })
  }
  const kind = String(body.kind ?? '')

  try {
    // ── page-out ─────────────────────────────────────────────────────
    if (kind === 'pageout') {
      if (!canPage(caller))
        return Response.json({ ok: false, error: 'Page-outs need supervisor access' }, { status: 403, headers: CORS })
      const pageId = String(body.pageId ?? '')
      const { data: page, error } = await sb
        .from('sched_pages')
        .select('id, message, channels, recipients, sent_by, message_type, urgent, shifts')
        .eq('id', pageId)
        .maybeSingle()
      if (error || !page)
        return Response.json({ ok: false, error: error?.message ?? 'Page-out not found' }, { status: 404, headers: CORS })
      if (page.sent_by !== caller.id && !isEditor(caller))
        return Response.json({ ok: false, error: 'Not your page-out' }, { status: 403, headers: CORS })

      const msg = clean(page.message, 600)
      const isAnn = page.message_type === 'announcement'
      const urgent = !!page.urgent
      const shifts = (Array.isArray(page.shifts) ? page.shifts : []) as {
        entryId?: string | null
        dateIso?: string
        unit?: string | null
        position?: string | null
        text?: string
      }[]

      // Urgent openings get claimed by voice — the exact wording is a
      // Setup setting (Justin, 2026-09-15: keep it light, supervisors
      // will flag plenty of pages urgent).
      let urgentNote = ''
      if (urgent) {
        const { data: poSet } = await sb
          .from('sched_settings')
          .select('value')
          .eq('key', 'pageout')
          .maybeSingle()
        urgentNote =
          clean((poSet?.value as { urgent_note?: string } | null)?.urgent_note, 180) ||
          'Immediate opening — call S201 or S202 to pick up.'
      }

      const pre = urgent ? 'URGENT — ' : ''
      let subject: string
      if (isAnn) subject = `${pre}WCEMS Announcement`
      else if (shifts.length === 1) {
        const s0 = shifts[0]
        subject = `${pre}WCEMS Scheduling: ${s0.position ?? 'Open shift'} needed${s0.unit ? ` on ${s0.unit}` : ''} — ${fmtDate(s0.dateIso ?? null)}`
      } else if (shifts.length > 1) subject = `${pre}WCEMS Scheduling: ${shifts.length} open shifts`
      else subject = `${pre}WCEMS Scheduling`

      // With no custom text the message must still say what it IS — a
      // bare shift line + link read like spam (Justin, 2026-09-17).
      const n = shifts.length
      const defaultLead = isAnn
        ? ''
        : n === 1
          ? 'Open shift available — can you take it?'
          : n > 1
            ? `${n} open shifts available — grab what you can.`
            : ''
      const lead = msg || defaultLead

      const emailLines: string[] = []
      // The email intro gets the automatic lead too when the sender
      // typed nothing — a bare shift list didn't say what it was.
      const emailIntro = msg || defaultLead
      if (emailIntro) emailLines.push(esc(emailIntro).replace(/\n/g, '<br/>'))
      if (shifts.length > 0) {
        const items = shifts
          .map((s) => {
            const href = s.entryId
              ? `${PORTAL}/schedule?d=${s.dateIso ?? ''}&pickup=${s.entryId}`
              : `${PORTAL}/schedule?d=${s.dateIso ?? ''}&v=day`
            return `<li style="margin:4px 0;"><a href="${href}" style="color:#182644;font-weight:600;">${esc(s.text ?? '')}</a></li>`
          })
          .join('')
        emailLines.push(
          `<b>Open shift${shifts.length === 1 ? '' : 's'} — tap one to request it:</b><ul style="margin:6px 0 0;padding-left:18px;">${items}</ul>`,
        )
      }
      if (urgent) {
        emailLines.push(`<b style="color:#b3261e;">${esc(urgentNote)}</b>`)
      }

      // Multi-line SMS: lead, one line per shift, link and STOP each on
      // their own line — the single-line pipe format read as clutter.
      // Lead capped so a long custom message can't push the link/STOP
      // lines past the send cap (composer enforces the same 120).
      const smsLead = lead.length > 120 ? `${lead.slice(0, 119)}…` : lead
      let sms = `${urgent ? 'URGENT — ' : ''}WCEMS: ${smsLead}`
      for (const s of shifts.slice(0, 2)) sms += `\n${s.text ?? ''}`
      if (shifts.length > 2) sms += `\n+${shifts.length - 2} more on the portal`
      if (urgent) sms += `\n${urgentNote}`
      sms += `\n${PORTAL}/schedule`

      const url =
        shifts.length === 1 && shifts[0].entryId
          ? `/schedule?d=${shifts[0].dateIso ?? ''}&pickup=${shifts[0].entryId}`
          : shifts[0]?.dateIso
            ? `/schedule?d=${shifts[0].dateIso}&v=day`
            : '/schedule'

      const d = await deliver(
        (page.recipients ?? []) as string[],
        isAnn ? 'announcements' : 'open_shift',
        {
          title: `${urgent ? 'URGENT — ' : ''}${
            isAnn
              ? 'WCEMS announcement'
              : n === 1
                ? 'Open shift available'
                : n > 1
                  ? `${n} open shifts available`
                  : 'WCEMS scheduling'
          }`,
          body: [msg, shifts[0]?.text].filter(Boolean).join(' — '),
          tag: `sched-page-${page.id}`,
          subject,
          emailLines,
          sms,
          url,
          channels: (page.channels ?? {}) as { push?: boolean; email?: boolean; sms?: boolean },
        },
        null, // page-outs go to everyone selected, sender included if listed
      )
      await sb
        .from('sched_pages')
        .update({ delivery: { push: d.push, email: d.email, sms: d.sms, skipped_sms: d.skippedSms, errors: d.errors.slice(0, 20) } })
        .eq('id', page.id)
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    // ── request submitted → the approvers ────────────────────────────
    if (kind === 'request_submitted') {
      const ids = (Array.isArray(body.requestIds) ? body.requestIds : []).map(String).slice(0, 20)
      if (ids.length === 0)
        return Response.json({ ok: false, error: 'No requests' }, { status: 400, headers: CORS })
      const rows = await loadRequests(ids)
      if (rows.length === 0) return Response.json({ ok: true, delivery: null, note: 'no rows' }, { headers: CORS })
      const mine = rows.every(
        (r) => r.requester_id === caller.id || r.counterparty_id === caller.id,
      )
      if (!mine && !isEditor(caller))
        return Response.json({ ok: false, error: 'Not your request' }, { status: 403, headers: CORS })

      const who = await nameOf(rows[0].requester_id)
      const first = rows[0]
      let line: string
      if (rows.length === 1) line = `${who}: ${reqLine(first)}`
      else {
        const dates = rows.map((r) => r.work_date ?? '').filter(Boolean).sort()
        line = `${who}: ${OFF_LABELS[first.off_type ?? ''] ?? 'Time off'} time off — ${rows.length} days (${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])})`
      }
      const awaiting = first.status === 'partner_accepted' ? ' Partner accepted — awaiting approval.' : ''
      // Same-day / next-day requests are the ones crews were told to
      // call in — flag them loudly so the Chief sees them in time.
      const todayC = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
      const soonest = rows.map((r) => r.work_date).filter((x): x is string => !!x).sort()[0] ?? null
      const tomorrow = (() => {
        const dt = new Date(`${todayC}T12:00:00Z`)
        dt.setUTCDate(dt.getUTCDate() + 1)
        return dt.toISOString().slice(0, 10)
      })()
      const sameDay = soonest !== null && soonest <= tomorrow
      const d = await deliver(
        await editorIds(),
        'approvals',
        {
          title: sameDay ? 'SAME-DAY request needs approval' : 'Request needs approval',
          body: line,
          tag: `sched-req-${first.id}`,
          subject: `WCEMS Scheduling — ${sameDay ? 'SAME-DAY ' : ''}request needs approval`,
          emailLines: [esc(line) + awaiting, 'Review it on the Requests tab.'],
          sms: `${sameDay ? 'URGENT ' : ''}WCEMS: ${line} — approve on the portal.`,
        },
        caller.id,
      )
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    // ── request decided → the requester (+ trade partner) ────────────
    if (kind === 'request_decided') {
      if (!isEditor(caller))
        return Response.json({ ok: false, error: 'Editors only' }, { status: 403, headers: CORS })
      const rows = await loadRequests([String(body.requestId ?? '')])
      const r = rows[0]
      if (!r) return Response.json({ ok: false, error: 'Request not found' }, { status: 404, headers: CORS })
      const verdict = r.status === 'approved' ? 'APPROVED' : r.status === 'denied' ? 'DENIED' : r.status
      const note = r.decision_note ? ` Note: ${clean(r.decision_note, 160)}` : ''
      const line = `${reqLine(r)}: ${verdict}.${note}`
      const targets = [r.requester_id, r.counterparty_id].filter((x): x is string => !!x)
      const d = await deliver(
        targets,
        'request_decision',
        {
          title: `Request ${verdict.toLowerCase()}`,
          body: line,
          tag: `sched-req-${r.id}`,
          subject: `WCEMS Scheduling — request ${verdict.toLowerCase()}`,
          emailLines: [esc(line)],
          sms: `WCEMS: ${line}`,
        },
        caller.id,
      )
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    // ── scheduler changed someone's day ──────────────────────────────
    if (kind === 'schedule_change') {
      if (!isEditor(caller))
        return Response.json({ ok: false, error: 'Editors only' }, { status: 403, headers: CORS })
      const userId = String(body.userId ?? '')
      const summary = clean(body.summary, 240)
      if (!userId || !summary)
        return Response.json({ ok: false, error: 'userId and summary required' }, { status: 400, headers: CORS })
      const d = await deliver(
        [userId],
        'schedule_change',
        {
          title: 'Schedule change',
          body: summary,
          tag: `sched-chg-${userId}-${Date.now()}`,
          subject: 'WCEMS Scheduling — your schedule changed',
          emailLines: [esc(summary), `Changed by ${esc(caller.name)}.`],
          sms: `WCEMS: ${summary} (${caller.name})`,
        },
        caller.id,
      )
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    // ── trade board activity ─────────────────────────────────────────
    if (kind === 'trade_activity') {
      const rows = await loadRequests([String(body.requestId ?? '')])
      const r = rows[0]
      if (!r) return Response.json({ ok: false, error: 'Request not found' }, { status: 404, headers: CORS })
      const event = String(body.event ?? '')
      const postLabel = `${REQ_LABELS[r.type] ?? r.type} for ${fmtDate(r.work_date)}${windowText(r.start_at, r.end_at)}`

      let targets: string[] = []
      let line = ''
      const kindWord = r.type === 'trade' ? 'swap' : 'giveaway'
      if (event === 'offer') {
        targets = [r.requester_id]
        line = `${caller.name} offered to take your ${postLabel}.`
      } else if (event === 'accepted' || event === 'declined') {
        if (caller.id !== r.requester_id && !isEditor(caller))
          return Response.json({ ok: false, error: 'Not your posting' }, { status: 403, headers: CORS })
        const target = String(body.offerUserId ?? '')
        if (!target) return Response.json({ ok: false, error: 'offerUserId required' }, { status: 400, headers: CORS })
        targets = [target]
        line =
          event === 'accepted'
            ? `${caller.name} accepted your offer on their ${postLabel} — awaiting Chief approval.`
            : `${caller.name} declined your offer on the ${postLabel}.`
      } else if (event === 'direct_request') {
        // Poster sent the giveaway/swap straight to one member.
        if (caller.id !== r.requester_id && !isEditor(caller))
          return Response.json({ ok: false, error: 'Not your posting' }, { status: 403, headers: CORS })
        const target = String(r.counterparty_id ?? '')
        if (!target) return Response.json({ ok: false, error: 'No direct recipient on this request' }, { status: 400, headers: CORS })
        targets = [target]
        line =
          r.type === 'trade'
            ? `${caller.name} sent you a swap request — ${postLabel}. Open the Trades tab to offer a shift back or decline.`
            : `${caller.name} asked you to take their ${postLabel}. Open the Trades tab to accept or decline.`
      } else if (event === 'direct_accepted' || event === 'direct_declined') {
        // The direct recipient answered — tell the poster.
        if (caller.id !== r.counterparty_id && !isEditor(caller))
          return Response.json({ ok: false, error: 'Not your request to answer' }, { status: 403, headers: CORS })
        targets = [r.requester_id]
        line =
          event === 'direct_accepted'
            ? `${caller.name} accepted your ${kindWord} — ${postLabel}. Awaiting Chief approval.`
            : `${caller.name} declined your ${kindWord} request — ${postLabel}.`
      } else {
        return Response.json({ ok: false, error: 'Unknown event' }, { status: 400, headers: CORS })
      }
      const d = await deliver(
        targets,
        'trade_activity',
        {
          title: 'Trade activity',
          body: line,
          tag: `sched-trade-${r.id}`,
          subject: 'WCEMS Scheduling — trade activity',
          emailLines: [esc(line)],
          sms: `WCEMS: ${line}`,
        },
        caller.id,
      )
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    return Response.json({ ok: false, error: `Unknown kind "${kind}"` }, { status: 400, headers: CORS })
  } catch (e) {
    console.error('[sched-notify]', (e as Error).message)
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: CORS })
  }
})
