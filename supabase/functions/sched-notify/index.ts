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
//   { kind: 'shift_reminders',   dryRun? }   ← pg_cron every 15 min (also
//     editors, for testing). System calls authenticate with the
//     x-sync-secret header (ROSTER_SYNC_SECRET) + the anon key as the
//     gateway bearer; sched_settings 'reminders' {enabled, lead_hours}
//     controls it (default: on, 12h). Sends once per merged shift start
//     (sched_reminders_sent claims), honoring each member's 'reminders'
//     notification row.
//     The SAME cron tick also drives the time-verification prompts
//     (Justin, 2026-09-28), each exactly-once via sched_notify_claims:
//       · end-of-shift "verify your times" when a merged block ends
//       · "attest yesterday's trucks" to the on-duty supervisors at
//         the 0600 changeover (per-truck attest rows)
//       · pay-period sign-off the Sunday after close (initial 0700,
//         last call 0900, crew deadline 1000) + a Monday-0700
//         verification summary to editors/HR
//       · event-equipment check at each event assignment's START
//         (Justin, 2026-10-02): crews on special events get "do the
//         equipment shift check" with a /equipment link — push+email,
//         matrix 'reminders', gated by sched_settings
//         reminders.event_equip (default on)
//     Verification prompts are push + email ONLY — never SMS (cost
//     control; matrix key 'verify').
//
// Recipients and their addresses are ALWAYS resolved server-side:
// the caller supplies ids, this function decides who may be told what
// (page-outs use the recipient list frozen on the sched_pages row) and
// pulls emails/phones/push subscriptions itself. Each person's
// notification matrix (sched_member_settings.notify — absent = ON) and
// SMS opt-in are honored per channel; nobody is notified about their
// own action. SMS is reserved for the urgent lane: page-outs, same-day
// approvals, shift reminders — routine lifecycle rides push + email.
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
  discrepancy: 'Time discrepancy',
}
const OFF_LABELS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  unpaid: 'Unpaid time off',
  bereavement: 'Bereavement',
  deployment: 'Deployment',
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

/* The button carries the SAME deep link as the push (verify/attest/
   sign-off drawers, day boards) — a hardcoded /schedule dumped attest
   clicks on the month view (Justin, 2026-09-28). */
function schedEmail(firstName: string, lines: string[], url?: string): string {
  const paras = lines.map((l) => `<p style="margin:0 0 10px;">${l}</p>`).join('\n    ')
  const href = `${PORTAL}${url && url.startsWith('/') ? url : '/schedule'}`
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#273142;max-width:640px;">
    <div style="border-bottom:3px solid #182644;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:17px;font-weight:700;color:#182644;letter-spacing:0.04em;">WALLER COUNTY EMS</div>
      <div style="font-size:11px;letter-spacing:0.14em;color:#a8842c;font-weight:600;">SCHEDULING</div>
    </div>
    <p>Hi ${esc(firstName)},</p>
    ${paras}
    <p style="margin:16px 0 0;">
      <a href="${href}" style="display:inline-block;background:#182644;color:#ffffff;text-decoration:none;font-weight:600;padding:9px 18px;border-radius:8px;">Open the schedule</a>
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
            await sendMail(tok, u.email as string, m.subject, schedEmail(first, m.emailLines, m.url))
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

/** Who gets the approval-queue pings (request filed / claimed). The
 *  schedulers who handle students and events do NOT work the queue —
 *  only the approvers do (Rhonda G + Justin today; Justin, 2026-10-01).
 *  Setup → "Approval notifications" writes the explicit list to
 *  sched_settings 'notify'.approver_user_ids; unset/empty falls back
 *  to every global_admin. NEVER falls back to schedulers. */
async function approverIds(): Promise<string[]> {
  const { data: s } = await sb
    .from('sched_settings')
    .select('value')
    .eq('key', 'notify')
    .maybeSingle()
  const ids = (s?.value as { approver_user_ids?: unknown } | null)?.approver_user_ids
  if (Array.isArray(ids) && ids.length > 0) return ids.map(String)
  const { data } = await sb.from('sched_access').select('user_id').eq('level', 'global_admin')
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
  comments: string | null
  decision_note: string | null
  status: string
}

async function loadRequests(ids: string[]): Promise<ReqRow[]> {
  const { data, error } = await sb
    .from('sched_requests')
    .select('id, type, requester_id, counterparty_id, work_date, start_at, end_at, off_type, unit_code, position_label, comments, decision_note, status')
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
  // the note IS the discrepancy — carry it in the approver line
  const note = r.type === 'discrepancy' && r.comments ? ` — "${clean(r.comments, 140)}"` : ''
  return `${label} — ${fmtDate(r.work_date)}${windowText(r.start_at, r.end_at)}${where ? ` (${where})` : ''}${note}`
}

// ── schedule math for shift reminders ────────────────────────────────
// Ported from useSchedule.ts (platoonFor / unitPlatoonFor / shiftWindow
// / segsForUserOnDate / mergeSegs) — KEEP IN LOCKSTEP with the client:
// if rendering rules change there, reminders must change here.

const ROT_ANCHOR = '2026-04-06'
const ROT_SEQ = ['B', 'B', 'C', 'C', 'A', 'A']

function daysBetweenIso(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86_400_000)
}

function platoonFor(dateIso: string): string {
  const d = daysBetweenIso(ROT_ANCHOR, dateIso)
  return ROT_SEQ[((d % 6) + 6) % 6]
}

function unitPlatoonFor(pattern: string[] | null, anchor: string | null, dateIso: string): string | null {
  if (!pattern || pattern.length === 0) return platoonFor(dateIso)
  const a = anchor ?? ROT_ANCHOR
  const len = pattern.length
  const d = daysBetweenIso(a, dateIso)
  const tok = (pattern[((d % len) + len) % len] ?? '').toUpperCase()
  return tok === 'A' || tok === 'B' || tok === 'C' ? tok : null
}

function todayCentralIso(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Chicago' }).format(new Date())
}

function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Epoch ms of dateIso + 'HH:MM' Central (CDT/CST probed like the client). */
function centralMs(dateIso: string, time: string): number {
  for (const off of ['-05:00', '-06:00']) {
    const c = new Date(`${dateIso}T${time}:00${off}`)
    const chk = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'America/Chicago',
    }).format(c).replace(', ', 'T')
    if (chk === `${dateIso}T${time}`) return c.getTime()
  }
  return new Date(`${dateIso}T${time}:00-05:00`).getTime()
}

/** A unit's rotation window on a work date, clamped inside 0600→0600. */
function unitWindow(fromRaw: string | null, untilRaw: string | null, dateIso: string): { start: number; end: number } {
  const f = (fromRaw ?? '06:00').slice(0, 5)
  const u = (untilRaw ?? '06:00').slice(0, 5)
  const dayEnd = centralMs(addDaysIso(dateIso, 1), '06:00')
  const start = f >= '06:00' ? centralMs(dateIso, f) : centralMs(addDaysIso(dateIso, 1), f)
  let end = u > '06:00' && u > f && f >= '06:00' ? centralMs(dateIso, u) : centralMs(addDaysIso(dateIso, 1), u)
  if (u === '06:00' || end <= start) end = dayEnd
  if (end > dayEnd) end = dayEnd
  return { start, end }
}

function fmtStamp(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' }).format(d).replace(':', '')
  return `${date} ${t}`
}

function centralDateOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Chicago' }).format(new Date(ms))
}

// ── main ─────────────────────────────────────────────────────────────

// @ts-expect-error Deno.serve in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')
    return Response.json({ ok: false, error: 'POST only' }, { status: 405, headers: CORS })

  /* pg_cron calls carry the anon key (passes the gateway JWT check) +
   * the shared sync secret — same trust pattern as roster-sync. A
   * system caller may ONLY run shift_reminders (its empty id and
   * non-editor level dead-end every other branch). */
  const syncSecret = env.get('ROSTER_SYNC_SECRET')
  const caller: Caller | null =
    syncSecret && req.headers.get('x-sync-secret') === syncSecret
      ? { id: '', name: 'System', level: 'system' }
      : await resolveCaller(req)
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

      /* Announcements (and pages with no shift attached) land on the
         message archive with THIS message highlighted — clicking the
         push used to dump crews on a bare board with the text gone
         (2026-10-01). Single-shift pages keep the pickup deep link. */
      const url =
        isAnn
          ? `/schedule?page=${page.id}`
          : shifts.length === 1 && shifts[0].entryId
            ? `/schedule?d=${shifts[0].dateIso ?? ''}&pickup=${shifts[0].entryId}`
            : shifts[0]?.dateIso
              ? `/schedule?d=${shifts[0].dateIso}&v=day`
              : `/schedule?page=${page.id}`

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
      const tomorrow = (() => {
        const dt = new Date(`${todayC}T12:00:00Z`)
        dt.setUTCDate(dt.getUTCDate() + 1)
        return dt.toISOString().slice(0, 10)
      })()
      // Same-day = TODAY or TOMORROW only. Past dates (after-the-fact
      // extra-hours logs) are not urgent — one texted Justin as URGENT
      // on day 1. And texts are reserved for the truly urgent: routine
      // approver notifications ride push + email only.
      // Extra-hours requests are NEVER urgent, whatever the date — the
      // member is volunteering MORE coverage, and logging today's
      // instructor hours kept texting URGENT (Justin, 2026-09-24).
      // Urgency means a same-day hole: time off / pickups only.
      // And a shift already under way is not a same-day emergency —
      // a 0900 giveaway accepted at 1602 texted the Chief URGENT for
      // hours that were mostly worked (Justin, 2026-09-25).
      const nowMs = Date.now()
      const urgentTypes = rows.filter(
        (r) => r.type !== 'extra_hours' && (!r.start_at || Date.parse(r.start_at) > nowMs),
      )
      const soonestUrgent =
        urgentTypes.map((r) => r.work_date).filter((x): x is string => !!x).sort()[0] ?? null
      const sameDay = soonestUrgent !== null && soonestUrgent >= todayC && soonestUrgent <= tomorrow
      const d = await deliver(
        await approverIds(),
        'approvals',
        {
          title: sameDay ? 'SAME-DAY request needs approval' : 'Request needs approval',
          body: line,
          tag: `sched-req-${first.id}`,
          subject: `WCEMS Scheduling — ${sameDay ? 'SAME-DAY ' : ''}request needs approval`,
          emailLines: [esc(line) + awaiting, 'Review it on the Requests tab.'],
          sms: `${sameDay ? 'URGENT ' : ''}WCEMS: ${line} — approve on the portal.`,
          channels: { sms: sameDay },
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
          // texts are for urgent pickups — decisions ride push + email
          channels: { sms: false },
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
          // texts are for urgent pickups — changes ride push + email
          channels: { sms: false },
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
          // texts are for urgent pickups — trade chatter rides push + email
          channels: { sms: false },
        },
        caller.id,
      )
      return Response.json({ ok: true, delivery: d }, { headers: CORS })
    }

    // ── shift reminders (cron every 15 min) ──────────────────────────
    if (kind === 'shift_reminders') {
      if (caller.level !== 'system' && !isEditor(caller))
        return Response.json({ ok: false, error: 'Not authorized' }, { status: 403, headers: CORS })
      const dryRun = body.dryRun === true

      const { data: remSet } = await sb.from('sched_settings').select('value').eq('key', 'reminders').maybeSingle()
      const cfg = (remSet?.value ?? {}) as { enabled?: boolean; lead_hours?: number; event_equip?: boolean }
      // reminders can be switched off in Setup; the verification
      // sweeps below still run on every tick
      const remindersEnabled = cfg.enabled !== false
      const eventEquipEnabled = cfg.event_equip !== false
      const leadH = Number(cfg.lead_hours ?? 12) || 12
      const now = Date.now()
      const windowEnd = now + leadH * 3_600_000

      // Work dates: 3 back for multi-day-block continuity (a 48/72-hr
      // run must merge so day 2 doesn't get a mid-shift "reminder"),
      // 1 forward so a 12h+ lead still sees tomorrow.
      const today = todayCentralIso()
      const dates: string[] = []
      for (let i = -3; i <= 1; i++) dates.push(addDaysIso(today, i))

      const [uR, sR, rR, eR, pR] = await Promise.all([
        sb.from('sched_units').select('id, code, active, rotation_pattern, rotation_anchor, shift_start, shift_end'),
        sb.from('sched_seats').select('id, unit_id, label, active'),
        sb.from('sched_rotation_assignments').select('seat_id, platoon, user_id, effective_from, effective_to'),
        sb.from('sched_entries').select('work_date, seat_id, user_id, kind, status, start_at, end_at, note')
          .gte('work_date', dates[0]).lte('work_date', dates[dates.length - 1]),
        sb.from('app_users').select('id, full_name').eq('active', true).eq('account_type', 'person'),
      ])
      const err0 = uR.error ?? sR.error ?? rR.error ?? eR.error ?? pR.error
      if (err0) return Response.json({ ok: false, error: err0.message }, { status: 500, headers: CORS })
      const unitsA = (uR.data ?? []).filter((u) => u.active)
      const unitById = new Map(unitsA.map((u) => [u.id, u]))
      const seatsA = (sR.data ?? []).filter((s) => s.active && unitById.has(s.unit_id))
      const rot = rR.data ?? []
      const rows = eR.data ?? []
      const nameById = new Map((pR.data ?? []).map((p) => [p.id, p.full_name as string]))

      const rotOccupant = (seatId: string, platoon: string, dateIso: string): string | null => {
        let best: { from: string; user: string | null } | null = null
        for (const a of rot) {
          if (a.seat_id !== seatId || a.platoon !== platoon) continue
          if (a.effective_from > dateIso) continue
          if (a.effective_to !== null && a.effective_to < dateIso) continue
          if (best === null || a.effective_from > best.from) best = { from: a.effective_from, user: a.user_id }
        }
        return best?.user ?? null
      }

      interface LSeg { start: number; end: number; label: string }
      interface EntryRowLite {
        work_date: string
        seat_id: string | null
        user_id: string | null
        kind: string
        status: string
        start_at: string
        end_at: string
        note: string | null
      }

      /**
       * Per-user merged on-duty blocks (time off subtracted) across a
       * date span — the schedule truth every sweep shares. KEEP IN
       * LOCKSTEP with segsForUserOnDate in the client. Also reports
       * which units were staffed per date and who held the S-trucks
       * (per-truck attestation recipients).
       */
      const buildBlocks = (dateList: string[], entryRows: EntryRowLite[]) => {
        const byUser = new Map<string, LSeg[]>()
        const supsByDate = new Map<string, Set<string>>()
        const staffedByDate = new Map<string, Set<string>>()
        /* Raw S-truck coverage — resolved into supsByDate only AFTER
           time off is subtracted. Erica Torr held S201 via a trade row
           but was on vacation with a pickup covering her: the raw walk
           counted her on duty and the attest prompt reached her on the
           beach (Justin, 2026-09-28). */
        const supSegsRaw: { dateIso: string; uid: string; start: number; end: number }[] = []
        const pushSeg = (uid: string, seg: LSeg) => {
          const l = byUser.get(uid) ?? []
          l.push(seg)
          byUser.set(uid, l)
        }
        const markStaffed = (dateIso: string, unitId: string) => {
          const s = staffedByDate.get(dateIso) ?? new Set<string>()
          s.add(unitId)
          staffedByDate.set(dateIso, s)
        }

        for (const dateIso of dateList) {
          const dayRows = entryRows.filter((r) => r.work_date === dateIso)
          for (const seat of seatsA) {
            const unit = unitById.get(seat.unit_id)!
            const label = `${unit.code} ${seat.label}`
            const isSupUnit = String(unit.code).toUpperCase().startsWith('S')
            const seatRows = dayRows.filter((r) => r.seat_id === seat.id && r.kind !== 'timeoff' && r.status !== 'off')
            if (seatRows.length > 0) {
              for (const r of seatRows) {
                if (r.user_id && r.status === 'scheduled') {
                  const seg = { start: Date.parse(r.start_at), end: Date.parse(r.end_at), label }
                  pushSeg(r.user_id, seg)
                  markStaffed(dateIso, unit.id)
                  if (isSupUnit) supSegsRaw.push({ dateIso, uid: r.user_id, start: seg.start, end: seg.end })
                }
              }
            } else {
              const platoon = unitPlatoonFor(unit.rotation_pattern, unit.rotation_anchor, dateIso)
              if (!platoon) continue
              const occ = rotOccupant(seat.id, platoon, dateIso)
              if (!occ) continue
              const w = unitWindow(unit.shift_start, unit.shift_end, dateIso)
              pushSeg(occ, { start: w.start, end: w.end, label })
              markStaffed(dateIso, unit.id)
              if (isSupUnit) supSegsRaw.push({ dateIso, uid: occ, start: w.start, end: w.end })
            }
          }
          for (const r of dayRows) {
            if (r.seat_id !== null || !r.user_id || r.status !== 'scheduled') continue
            if (r.kind === 'extra' || r.kind === 'event' || r.kind === 'student' || r.kind === 'rider') {
              const label =
                r.kind === 'event' ? (r.note || 'Special event')
                : r.kind === 'extra' ? 'Extra hours'
                : r.kind === 'student' ? 'Student ride'
                : 'Rider'
              pushSeg(r.user_id, { start: Date.parse(r.start_at), end: Date.parse(r.end_at), label })
            }
          }
        }

        // TIME OFF FOLLOWS THE PERSON (2026-09-25, lockstep with
        // segsForUserOnDate in the client): booked-off hours never
        // earn a prompt, wherever the member sits that day.
        const offByUser = new Map<string, { s: number; e: number }[]>()
        for (const r of entryRows) {
          if (r.kind !== 'timeoff' || !r.user_id) continue
          const l = offByUser.get(r.user_id) ?? []
          l.push({ s: Date.parse(r.start_at), e: Date.parse(r.end_at) })
          offByUser.set(r.user_id, l)
        }

        // resolve raw S-truck coverage into ON-DUTY supervisors:
        // subtract each candidate's time off first — only sups with
        // real remaining duty time on the date get attest prompts
        for (const s of supSegsRaw) {
          let segs = [{ start: s.start, end: s.end }]
          for (const o of offByUser.get(s.uid) ?? []) {
            const next: { start: number; end: number }[] = []
            for (const x of segs) {
              const os = Math.max(x.start, o.s)
              const oe = Math.min(x.end, o.e)
              if (oe - os < 60_000) {
                next.push(x)
                continue
              }
              if (os - x.start >= 60_000) next.push({ start: x.start, end: os })
              if (x.end - oe >= 60_000) next.push({ start: oe, end: x.end })
            }
            segs = next
          }
          if (segs.length > 0) {
            const set = supsByDate.get(s.dateIso) ?? new Set<string>()
            set.add(s.uid)
            supsByDate.set(s.dateIso, set)
          }
        }

        // merge per user (multi-day blocks become one segment; the
        // label of the run's FIRST piece names the shift)
        const blocks = new Map<string, LSeg[]>()
        for (const [uid, segs] of byUser) {
          const sorted = segs.filter((s) => s.end - s.start >= 60_000).sort((a, b) => a.start - b.start)
          const merged: LSeg[] = []
          for (const s of sorted) {
            const last = merged[merged.length - 1]
            if (last && s.start <= last.end + 60_000) last.end = Math.max(last.end, s.end)
            else merged.push({ ...s })
          }
          let eff = merged
          for (const o of offByUser.get(uid) ?? []) {
            const next: LSeg[] = []
            for (const s of eff) {
              const os = Math.max(s.start, o.s)
              const oe = Math.min(s.end, o.e)
              if (oe - os < 60_000) {
                next.push(s)
                continue
              }
              if (os - s.start >= 60_000) next.push({ ...s, end: os })
              if (s.end - oe >= 60_000) next.push({ ...s, start: oe })
            }
            eff = next
          }
          blocks.set(uid, eff)
        }
        return { blocks, supsByDate, staffedByDate }
      }

      const main = buildBlocks(dates, rows as EntryRowLite[])

      // 1) shift reminders — due = merged starts inside the lead window
      const due: { userId: string; name: string; start: number; end: number; label: string }[] = []
      if (remindersEnabled) {
        for (const [uid, blocks] of main.blocks) {
          const name = nameById.get(uid)
          if (!name) continue
          for (const m of blocks) {
            if (m.start > now && m.start <= windowEnd) due.push({ userId: uid, name, start: m.start, end: m.end, label: m.label })
          }
        }
      }

      // 1b) event equipment check — fires AT each event assignment's
      //     start (Justin, 2026-10-02): event crews must complete the
      //     Equipment module's shift check before they roll, and the
      //     12h-lead shift reminder is too early to land. Raw event
      //     rows, not merged blocks (merging folds an event into an
      //     adjacent truck shift and loses the event identity). The
      //     grace window tolerates missed cron ticks; a prompt after
      //     the event ends is pointless and skipped.
      const EVENT_EQUIP_GRACE = 2 * 3_600_000
      const eventEquipDue: { userId: string; name: string; start: number; end: number; label: string }[] = []
      if (eventEquipEnabled) {
        const offBy = new Map<string, { s: number; e: number }[]>()
        for (const r of rows) {
          if (r.kind !== 'timeoff' || !r.user_id) continue
          const l = offBy.get(r.user_id) ?? []
          l.push({ s: Date.parse(r.start_at), e: Date.parse(r.end_at) })
          offBy.set(r.user_id, l)
        }
        for (const r of rows) {
          if (r.kind !== 'event' || r.status !== 'scheduled' || !r.user_id) continue
          const name = nameById.get(r.user_id)
          if (!name) continue
          const start = Date.parse(r.start_at)
          const end = Date.parse(r.end_at)
          if (!(start <= now && now < start + EVENT_EQUIP_GRACE) || now >= end) continue
          // booked off across the whole event window → no prompt
          const fullyOff = (offBy.get(r.user_id) ?? []).some((o) => o.s <= start && o.e >= end)
          if (fullyOff) continue
          eventEquipDue.push({ userId: r.user_id, name, start, end, label: r.note || 'Special event' })
        }
      }

      // 2) end-of-shift verify — blocks that ENDED inside the last 45
      //    minutes get "do your times look right?" (claims dedupe)
      const VERIFY_LOOKBACK = 45 * 60_000
      const verifyDue: { userId: string; name: string; end: number; label: string; dates: string[] }[] = []
      for (const [uid, blocks] of main.blocks) {
        const name = nameById.get(uid)
        if (!name) continue
        for (const m of blocks) {
          if (m.end > now || m.end <= now - VERIFY_LOOKBACK) continue
          const covered: string[] = []
          for (const d of dates) {
            const dayStart = centralMs(d, '06:00')
            const dayEnd = centralMs(addDaysIso(d, 1), '06:00')
            if (Math.min(m.end, dayEnd) - Math.max(m.start, dayStart) >= 60_000) covered.push(d)
          }
          if (covered.length > 0) verifyDue.push({ userId: uid, name, end: m.end, label: m.label, dates: covered })
        }
      }
      // drop anyone who already confirmed every covered work date
      if (verifyDue.length > 0) {
        const uids = [...new Set(verifyDue.map((v) => v.userId))]
        const conf = await sb
          .from('sched_verifications')
          .select('user_id, work_date')
          .eq('kind', 'shift_confirm')
          .in('user_id', uids)
          .gte('work_date', dates[0])
        const confSet = new Set((conf.data ?? []).map((r) => `${r.user_id}|${r.work_date}`))
        for (let i = verifyDue.length - 1; i >= 0; i--) {
          const v = verifyDue[i]
          if (v.dates.every((d) => confSet.has(`${v.userId}|${d}`))) verifyDue.splice(i, 1)
        }
      }

      // 3) supervisor attest — the work date that ended this morning,
      //    prompted once per on-duty supervisor (15-min buffer past
      //    the 0600 changeover; skipped once every staffed truck has
      //    an attest row)
      const workDateOf = (ms: number) => centralDateOf(ms - 6 * 3_600_000)
      const nowWork = workDateOf(now)
      const attDate = addDaysIso(nowWork, -1)
      let attestPrompts: { userId: string; name: string }[] = []
      if (now >= centralMs(nowWork, '06:15')) {
        const sups = main.supsByDate.get(attDate) ?? new Set<string>()
        const staffed = main.staffedByDate.get(attDate) ?? new Set<string>()
        if (sups.size > 0 && staffed.size > 0) {
          const aRes = await sb
            .from('sched_verifications')
            .select('unit_id')
            .eq('kind', 'shift_attest')
            .eq('work_date', attDate)
          const attested = new Set((aRes.data ?? []).map((r) => r.unit_id))
          if ([...staffed].some((u) => !attested.has(u))) {
            attestPrompts = [...sups]
              .map((uid) => ({ userId: uid, name: nameById.get(uid) ?? '' }))
              .filter((x) => x.name)
          }
        }
      }

      // 4) pay-period sign-off — the Sunday after close: initial from
      //    0700, last call from 0900 (crew deadline 1000); HR summary
      //    Monday from 0700
      const anchorDays = (d: string) => ((daysBetweenIso('2026-08-30', d) % 14) + 14) % 14
      const centralHour = Number(
        new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }).format(new Date(now)),
      )
      const yesterday = addDaysIso(today, -1)
      let signoffSends: { userId: string; name: string; stage: 'initial' | 'reminder' }[] = []
      let signoffPeriodEnd: string | null = null
      if (anchorDays(yesterday) === 13 && centralHour >= 7) {
        signoffPeriodEnd = yesterday
        const pStart = addDaysIso(yesterday, -13)
        const pDates: string[] = []
        for (let d = pStart; d <= yesterday; d = addDaysIso(d, 1)) pDates.push(d)
        const eP = await sb
          .from('sched_entries')
          .select('work_date, seat_id, user_id, kind, status, start_at, end_at, note')
          .gte('work_date', pStart)
          .lte('work_date', yesterday)
        if (eP.error) {
          // fail quiet — next tick retries; claims keep it exactly-once
        } else {
          const per = buildBlocks(pDates, (eP.data ?? []) as EntryRowLite[])
          const withHours = [...per.blocks.entries()]
            .filter(([uid, bl]) => nameById.has(uid) && bl.reduce((t, b) => t + (b.end - b.start), 0) >= 360_000)
            .map(([uid]) => uid)
          let signed = new Set<string>()
          if (withHours.length > 0) {
            const soRes = await sb
              .from('sched_verifications')
              .select('user_id')
              .eq('kind', 'period_signoff')
              .eq('period_end', yesterday)
              .in('user_id', withHours)
            signed = new Set((soRes.data ?? []).map((r) => r.user_id))
          }
          const stage: 'initial' | 'reminder' = centralHour >= 9 ? 'reminder' : 'initial'
          signoffSends = withHours
            .filter((u) => !signed.has(u))
            .map((uid) => ({ userId: uid, name: nameById.get(uid)!, stage }))
        }
      }
      const twoBack = addDaysIso(today, -2)
      const summaryDue: string | null = anchorDays(twoBack) === 13 && centralHour >= 7 ? twoBack : null

      if (dryRun) {
        return Response.json(
          {
            ok: true, dryRun: true, leadHours: leadH, checked: main.blocks.size,
            due: due.map((d) => ({ name: d.name, label: d.label, start: fmtStamp(d.start), end: fmtStamp(d.end) })),
            eventEquip: eventEquipDue.map((d) => ({ name: d.name, label: d.label, start: fmtStamp(d.start) })),
            verifyDue: verifyDue.map((v) => ({ name: v.name, label: v.label, end: fmtStamp(v.end), dates: v.dates })),
            attest: { date: attDate, prompts: attestPrompts.map((a) => a.name) },
            signoff: signoffPeriodEnd
              ? { periodEnd: signoffPeriodEnd, stage: signoffSends[0]?.stage ?? null, unsigned: signoffSends.map((s) => s.name) }
              : null,
            summaryDue,
          },
          { headers: CORS },
        )
      }

      let sent = 0
      const delivery = { push: 0, email: 0, sms: 0 }
      const errors: string[] = []
      for (const d of due) {
        // claim first — the unique (user_id, shift_start) row is the
        // exactly-once guarantee across cron runs
        const ins = await sb
          .from('sched_reminders_sent')
          .upsert(
            { user_id: d.userId, shift_start: new Date(d.start).toISOString(), label: d.label },
            { onConflict: 'user_id,shift_start', ignoreDuplicates: true },
          )
          .select('id')
        if (ins.error) {
          errors.push(`claim ${d.name}: ${ins.error.message}`)
          continue
        }
        if (!ins.data || ins.data.length === 0) continue // already reminded
        const hrs = Math.round(((d.end - d.start) / 3_600_000) * 10) / 10
        const line = `${d.label} — ${fmtStamp(d.start)} to ${fmtStamp(d.end)} (${hrs} hrs)`
        const del = await deliver(
          [d.userId],
          'reminders',
          {
            title: 'Shift reminder',
            body: line,
            tag: `sched-rem-${d.userId}-${d.start}`,
            subject: 'WCEMS Scheduling — shift reminder',
            emailLines: [
              `Reminder: you're on <b>${esc(d.label)}</b> — ${esc(fmtStamp(d.start))} to ${esc(fmtStamp(d.end))} (${hrs} hrs).`,
            ],
            sms: `WCEMS: Shift reminder — ${d.label}, ${fmtStamp(d.start)} to ${fmtStamp(d.end)}.`,
            url: `/schedule?d=${centralDateOf(d.start)}&v=day`,
          },
          null,
        )
        sent++
        delivery.push += del.push
        delivery.email += del.email
        delivery.sms += del.sms
        errors.push(...del.errors)
      }
      // ── verification sends — push + email ONLY, never SMS ─────────
      const claim = async (ckind: string, userId: string, ref: string): Promise<boolean> => {
        const ins = await sb
          .from('sched_notify_claims')
          .upsert({ kind: ckind, user_id: userId, ref }, { onConflict: 'kind,user_id,ref', ignoreDuplicates: true })
          .select('id')
        if (ins.error) {
          errors.push(`claim ${ckind}: ${ins.error.message}`)
          return false
        }
        return !!ins.data && ins.data.length > 0
      }

      // event equipment checks — claimed per (user, event start)
      for (const d of eventEquipDue) {
        if (!(await claim('event_equip', d.userId, `${new Date(d.start).toISOString()}|${d.label}`))) continue
        const line = `${d.label} — complete the equipment shift check in the Equipment module before you roll.`
        const del = await deliver(
          [d.userId],
          'reminders',
          {
            title: 'Event equipment check',
            body: line,
            tag: `sched-eqp-${d.userId}-${d.start}`,
            subject: 'WCEMS — event equipment check',
            emailLines: [
              `You're on <b>${esc(d.label)}</b> — ${esc(fmtStamp(d.start))} to ${esc(fmtStamp(d.end))}.`,
              'Complete the <b>equipment shift check</b> in the Equipment module at the start of your shift.',
            ],
            sms: '',
            url: '/equipment',
            channels: { sms: false },
          },
          null,
        )
        sent++
        delivery.push += del.push
        delivery.email += del.email
        errors.push(...del.errors)
      }

      // end-of-shift verify
      for (const v of verifyDue) {
        if (!(await claim('shift_verify', v.userId, new Date(v.end).toISOString()))) continue
        const lastDate = v.dates[v.dates.length - 1]
        const line = `Your shift (${v.label}) ended ${fmtStamp(v.end)}. Do your scheduled times look right?`
        const del = await deliver(
          [v.userId],
          'verify',
          {
            title: 'Shift complete — verify your times',
            body: line,
            tag: `sched-verify-${v.userId}-${v.end}`,
            subject: 'WCEMS Scheduling — verify your shift times',
            emailLines: [
              esc(line),
              'Open <b>My schedule</b> to confirm your times — or report extra hours / time off if the day changed.',
            ],
            sms: '',
            url: `/schedule?verify=${lastDate}`,
            channels: { sms: false },
          },
          null,
        )
        sent++
        delivery.push += del.push
        delivery.email += del.email
        errors.push(...del.errors)
      }

      // supervisor attest prompts (per-truck attest rows)
      for (const a of attestPrompts) {
        if (!(await claim('shift_attest', a.userId, attDate))) continue
        const line = `Attest ${fmtDate(attDate)}: confirm each truck's roster matched who actually worked, and flag anything that changed.`
        const del = await deliver(
          [a.userId],
          'verify',
          {
            title: "Attest yesterday's trucks",
            body: line,
            tag: `sched-attest-${a.userId}-${attDate}`,
            subject: "WCEMS Scheduling — attest yesterday's trucks",
            emailLines: [esc(line)],
            sms: '',
            url: `/schedule?attest=${attDate}`,
            channels: { sms: false },
          },
          null,
        )
        sent++
        delivery.push += del.push
        delivery.email += del.email
        errors.push(...del.errors)
      }

      // pay-period sign-off prompts
      for (const s of signoffSends) {
        if (!signoffPeriodEnd) break
        if (!(await claim('period_signoff', s.userId, `${signoffPeriodEnd}:${s.stage}`))) continue
        const pl = `${fmtDate(addDaysIso(signoffPeriodEnd, -13))} – ${fmtDate(signoffPeriodEnd)}`
        const line =
          s.stage === 'initial'
            ? `Review and approve your hours for ${pl} — deadline 10:00 this morning. HR keys Paycom first thing tomorrow.`
            : `Last call: approve your pay-period hours (${pl}) by 10:00 — HR keys Paycom first thing tomorrow.`
        const del = await deliver(
          [s.userId],
          'verify',
          {
            title: s.stage === 'initial' ? 'Approve your pay-period hours' : 'Last call — hours due by 10:00',
            body: line,
            tag: `sched-signoff-${s.userId}-${signoffPeriodEnd}`,
            subject: 'WCEMS Scheduling — approve your pay-period hours',
            emailLines: [esc(line)],
            sms: '',
            url: `/schedule?signoff=${signoffPeriodEnd}`,
            channels: { sms: false },
          },
          null,
        )
        sent++
        delivery.push += del.push
        delivery.email += del.email
        errors.push(...del.errors)
      }

      // Monday-morning verification summary → editors + HR
      if (summaryDue) {
        const acc = await sb.from('sched_access').select('user_id, level').in('level', ['global_admin', 'scheduler', 'hr'])
        const admins = (acc.data ?? []).map((r) => r.user_id as string)
        if (admins.length > 0) {
          const [soR, atR, dqR] = await Promise.all([
            sb.from('sched_verifications').select('user_id, status').eq('kind', 'period_signoff').eq('period_end', summaryDue),
            sb.from('sched_verifications').select('id, status').eq('kind', 'shift_attest')
              .gte('work_date', addDaysIso(summaryDue, -13)).lte('work_date', summaryDue),
            sb.from('sched_requests').select('id').eq('type', 'discrepancy').eq('status', 'pending'),
          ])
          const approved = (soR.data ?? []).filter((r) => r.status === 'approved').length
          const disputed = (soR.data ?? []).filter((r) => r.status === 'disputed').length
          const attests = (atR.data ?? []).length
          const attFlags = (atR.data ?? []).filter((r) => r.status === 'flagged').length
          const flags = (dqR.data ?? []).length
          const pl = `${fmtDate(addDaysIso(summaryDue, -13))} – ${fmtDate(summaryDue)}`
          const line = `Period ${pl}: ${approved} sign-offs approved · ${disputed} disputed · ${attests} truck attestations (${attFlags} flagged) · ${flags} open discrepanc${flags === 1 ? 'y' : 'ies'}.`
          for (const uid of admins) {
            if (!(await claim('signoff_summary', uid, summaryDue))) continue
            const del = await deliver(
              [uid],
              'verify',
              {
                title: 'Payroll verification summary',
                body: line,
                tag: `sched-vsum-${uid}-${summaryDue}`,
                subject: 'WCEMS Scheduling — payroll verification summary',
                emailLines: [
                  esc(line),
                  'The full board is under Payroll → Sign-offs. Pending sign-offs and open flags are worth a look before the export goes out.',
                ],
                sms: '',
                url: '/schedule',
                channels: { sms: false },
              },
              null,
            )
            sent++
            delivery.push += del.push
            delivery.email += del.email
            errors.push(...del.errors)
          }
        }
      }

      // prune claims older than two weeks (both tables)
      await sb.from('sched_reminders_sent').delete().lt('sent_at', new Date(now - 14 * 86_400_000).toISOString())
      await sb.from('sched_notify_claims').delete().lt('sent_at', new Date(now - 14 * 86_400_000).toISOString())
      return Response.json(
        {
          ok: true, checked: main.blocks.size, due: due.length, eventEquip: eventEquipDue.length,
          verify: verifyDue.length, attest: attestPrompts.length, signoff: signoffSends.length,
          sent, delivery, errors: errors.slice(0, 20),
        },
        { headers: CORS },
      )
    }

    return Response.json({ ok: false, error: `Unknown kind "${kind}"` }, { status: 400, headers: CORS })
  } catch (e) {
    console.error('[sched-notify]', (e as Error).message)
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500, headers: CORS })
  }
})
