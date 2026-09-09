// birthday-digest — monthly birthday email + Laurel's birthday calendar.
//
// Runs every Monday via pg_cron (job 'birthday-digest-weekly'):
//   · ALWAYS syncs the "WCEMS Birthdays" calendar in Laurel's mailbox
//     against the roster (app_users mirrors HR's Master Roster via the
//     excel-to-list → roster-sync chain, so hires/separations flow
//     through automatically). One yearly-recurring all-day event per
//     person, tagged with an extended property carrying the app_user
//     id — renames, DOB corrections and departures reconcile on the
//     next run. Needs Calendars.ReadWrite (Application) on the WCEMS
//     Lifecycle Automation app registration.
//   · On the LAST Monday of the month (America/Chicago) also emails
//     the next month's birthday list to RECIPIENTS from office@.
//
// POST body flags (all optional):
//   { test: true }      digest goes ONLY to Justin
//   { force: true }     send the digest even if today isn't last Monday
//   { digest: false }   skip the email
//   { calendar: false } skip the calendar sync
//
// Auth: x-sync-secret.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const SENDER = 'office@wallercountyems.com'
const RECIPIENTS = [
  'justin.stjohn@wallercountyems.com',
  'april.mancini@wallercountyems.com',
  'laurel.vandagriff@wallercountyems.com',
]
const TEST_RECIPIENTS = ['justin.stjohn@wallercountyems.com']
const CAL_OWNER = 'laurel.vandagriff@wallercountyems.com'
const CAL_NAME = 'WCEMS Birthdays'
/* Extended property that ties an event to its roster row. */
const EXT_PROP = 'String {7f1b42fa-9c3d-4e21-b6a8-52ce90c40001} Name WcemsBirthdayUserId'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface Person {
  id: string
  full_name: string
  date_of_birth: string // YYYY-MM-DD
}

/* ── Central-time "today" ─────────────────────────────────────────── */

function centralToday(): { y: number; m: number; d: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday: get('weekday') }
}

function isLastMondayOfMonth(t: { y: number; m: number; d: number; weekday: string }): boolean {
  if (t.weekday !== 'Mon') return false
  const daysInMonth = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate()
  return t.d + 7 > daysInMonth
}

/* ── Graph ────────────────────────────────────────────────────────── */

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

async function g(tok: string, method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Graph ${res.status} ${method} ${url.split('?')[0].slice(-60)}: ${(await res.text()).slice(0, 250)}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/* ── Digest email ─────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildDigest(monthName: string, people: Person[]): { subject: string; html: string } {
  const rows = people
    .map((p) => {
      const day = Number(p.date_of_birth.slice(8, 10))
      return `<tr>
        <td style="padding:7px 16px 7px 0;border-bottom:1px solid #e6e2d8;color:#5a5f6b;white-space:nowrap;">${esc(monthName)} ${day}</td>
        <td style="padding:7px 0;border-bottom:1px solid #e6e2d8;font-weight:600;color:#182644;">${esc(p.full_name)}</td>
      </tr>`
    })
    .join('')
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#273142;max-width:560px;">
    <div style="border-bottom:3px solid #182644;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:17px;font-weight:700;color:#182644;letter-spacing:0.04em;">WALLER COUNTY EMS</div>
      <div style="font-size:11px;letter-spacing:0.14em;color:#a8842c;font-weight:600;">UPCOMING BIRTHDAYS</div>
    </div>
    <p>${people.length === 0
      ? `No staff birthdays in ${esc(monthName)}.`
      : `${people.length} birthday${people.length === 1 ? '' : 's'} to celebrate in <b>${esc(monthName)}</b>:`}</p>
    <table style="border-collapse:collapse;width:100%;margin:6px 0 14px;">${rows}</table>
    <p style="font-size:12px;color:#8a8f99;">Pulled automatically from the master roster — new hires and separations update this list and the birthday calendar on their own.</p>
  </div>`
  return { subject: `Upcoming birthdays — ${monthName}`, html }
}

async function sendDigest(tok: string, to: string[], subject: string, html: string) {
  await g(tok, 'POST', `https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
    },
    saveToSentItems: true,
  })
}

/* ── Calendar sync ────────────────────────────────────────────────── */

async function syncCalendar(tok: string, people: Person[]) {
  const base = `https://graph.microsoft.com/v1.0/users/${CAL_OWNER}`

  /* Find or create the dedicated calendar. */
  const cals = await g(tok, 'GET', `${base}/calendars?$select=id,name&$top=100`)
  let cal = (cals.value ?? []).find((c: { name: string }) => c.name === CAL_NAME)
  if (!cal) cal = await g(tok, 'POST', `${base}/calendars`, { name: CAL_NAME })

  /* Existing tagged events (paged). */
  const existing = new Map<string, { id: string; subject: string; month: number; day: number }>()
  let url: string | null =
    `${base}/calendars/${cal.id}/events?$top=100&$select=id,subject,recurrence` +
    `&$expand=singleValueExtendedProperties($filter=id eq '${EXT_PROP}')`
  while (url) {
    const page = await g(tok, 'GET', url)
    for (const ev of page.value ?? []) {
      const prop = (ev.singleValueExtendedProperties ?? []).find((p: { id: string }) => p.id === EXT_PROP)
      if (!prop?.value) continue
      existing.set(prop.value, {
        id: ev.id,
        subject: ev.subject ?? '',
        month: ev.recurrence?.pattern?.month ?? 0,
        day: ev.recurrence?.pattern?.dayOfMonth ?? 0,
      })
    }
    url = page['@odata.nextLink'] ?? null
  }

  const nowYear = centralToday().y
  let created = 0
  let deleted = 0
  const wanted = new Set<string>()

  for (const p of people) {
    wanted.add(p.id)
    const month = Number(p.date_of_birth.slice(5, 7))
    const day = Number(p.date_of_birth.slice(8, 10))
    const subject = `🎂 ${p.full_name}`
    const have = existing.get(p.id)
    if (have && have.subject === subject && have.month === month && have.day === day) continue
    /* New person, renamed, or corrected DOB → recreate the series. */
    if (have) {
      await g(tok, 'DELETE', `${base}/calendars/${cal.id}/events/${have.id}`)
      deleted++
    }
    const start = `${nowYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const endDate = new Date(Date.UTC(nowYear, month - 1, day + 1))
    const end = endDate.toISOString().slice(0, 10)
    await g(tok, 'POST', `${base}/calendars/${cal.id}/events`, {
      subject,
      isAllDay: true,
      showAs: 'free',
      isReminderOn: false,
      start: { dateTime: `${start}T00:00:00`, timeZone: 'America/Chicago' },
      end: { dateTime: `${end}T00:00:00`, timeZone: 'America/Chicago' },
      recurrence: {
        pattern: { type: 'absoluteYearly', interval: 1, month, dayOfMonth: day },
        range: { type: 'noEnd', startDate: start },
      },
      singleValueExtendedProperties: [{ id: EXT_PROP, value: p.id }],
    })
    created++
  }

  /* Departed staff → event comes off the calendar. */
  for (const [userId, ev] of existing) {
    if (wanted.has(userId)) continue
    await g(tok, 'DELETE', `${base}/calendars/${cal.id}/events/${ev.id}`)
    deleted++
  }

  return { calendar: CAL_NAME, owner: CAL_OWNER, events: people.length, created, deleted }
}

/* ── Handler ──────────────────────────────────────────────────────── */

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'POST only' }, { status: 405 })
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let flags: { test?: boolean; force?: boolean; digest?: boolean; calendar?: boolean } = {}
  try {
    flags = await req.json()
  } catch {
    /* empty body = defaults */
  }

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: people, error } = await supabase
    .from('app_users')
    .select('id, full_name, date_of_birth')
    .eq('active', true)
    .eq('account_type', 'person')
    .not('date_of_birth', 'is', null)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  const today = centralToday()
  const out: Record<string, unknown> = { ok: true, today: `${today.y}-${today.m}-${today.d} (${today.weekday})` }
  const tok = await graphToken()

  /* Digest — last Monday of the month, or forced. */
  if (flags.digest !== false) {
    const due = isLastMondayOfMonth(today)
    if (due || flags.force) {
      const nextM = today.m === 12 ? 1 : today.m + 1
      const monthName = MONTHS[nextM - 1]
      const celebrants = (people as Person[])
        .filter((p) => Number(p.date_of_birth.slice(5, 7)) === nextM)
        .sort(
          (a, b) =>
            Number(a.date_of_birth.slice(8, 10)) - Number(b.date_of_birth.slice(8, 10)) ||
            a.full_name.localeCompare(b.full_name),
        )
      const to = flags.test ? TEST_RECIPIENTS : RECIPIENTS
      const mail = buildDigest(monthName, celebrants)
      await sendDigest(tok, to, flags.test ? `TEST — ${mail.subject}` : mail.subject, mail.html)
      out.digest = { sent: true, to, month: monthName, count: celebrants.length, forced: !!flags.force }
    } else {
      out.digest = { sent: false, reason: 'not the last Monday of the month' }
    }
  }

  /* Calendar sync — every run. */
  if (flags.calendar !== false) {
    try {
      out.calendarSync = await syncCalendar(tok, people as Person[])
    } catch (e) {
      out.calendarSync = { error: (e as Error).message }
    }
  }

  return Response.json(out)
})
