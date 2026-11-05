// supabase/functions/sync-wix-training/index.ts
//
// Syncs upcoming training into the `training_sessions` table from
// TWO sources:
//   1. Wix Bookings (`/_api/service-availability/v2/time-slots/event`)
//      — bookable classes with seat counts. Rows tagged source='wix'.
//   2. M365 Education group calendar via Microsoft Graph — events
//      whose `categories` array includes "blue" (calendar-only
//      training that doesn't have a Wix booking). Rows tagged
//      source='calendar'.
//
// PHASE 2 (2026-11-05): also imports card-class Wix BOOKINGS into
// `training_attendance` so the QR check-in system sees every booker —
// the Registrations view only displayed them before, and instructors
// were re-typing each registrant by hand.
//
// Replaces both the Power Automate flow (Wix → SP) and the
// browser-side MSAL fetch. Single architecture, no popups.
//
// Triggered by Supabase cron every 15 minutes via pg_cron + pg_net.
// Can also be invoked on-demand via the Manage Training admin page's
// "Sync now" button (or curl).
//
// Secrets (set via `supabase secrets set ...`):
//   WIX_API_TOKEN       — Wix IST.eyJ... token
//   WIX_SITE_ID         — wix-site-id header value
//   GRAPH_TENANT_ID     — Entra directory (tenant) ID
//   GRAPH_CLIENT_ID     — Entra app reg client ID
//   GRAPH_CLIENT_SECRET — client secret from the same app reg (under
//                         Certificates & secrets → Client secrets)
//   GRAPH_GROUP_ID      — Internal Education group's object ID
//
// Required Entra Application permissions (NOT delegated) on the
// app reg, granted admin consent:
//   Calendars.Read  (or Group.Read.All — either works)

// @ts-expect-error Deno std import resolved at runtime by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const WIX_TIME_SLOTS_URL =
  'https://www.wixapis.com/_api/service-availability/v2/time-slots/event'

// ── Shared types ────────────────────────────────────────────────────

interface SessionRow {
  id: string
  service_id: string | null
  title: string
  local_start: string
  total_capacity: number
  remaining_capacity: number
  location: string
  source: 'wix' | 'calendar'
  synced_at: string
}

// ── Wix ─────────────────────────────────────────────────────────────

interface WixTimeSlot {
  serviceId?: string
  localStartDate?: string
  totalCapacity?: number
  remainingCapacity?: number
  location?: { formattedAddress?: string }
  eventInfo?: { eventId?: string; eventTitle?: string }
}

interface WixResponse {
  timeSlots?: WixTimeSlot[]
  pagingMetadata?: { cursors?: { next?: string } }
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function nowLocalIsoNoTz(): string {
  const d = new Date()
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  )
}
function plusDaysLocalIsoNoTz(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  )
}

async function fetchAllTimeSlots(
  token: string,
  siteId: string,
): Promise<WixTimeSlot[]> {
  const all: WixTimeSlot[] = []
  let cursor: string | undefined
  const fromLocalDate = nowLocalIsoNoTz()
  const toLocalDate = plusDaysLocalIsoNoTz(180)

  for (let page = 0; page < 20; page++) {
    const body: Record<string, unknown> = {
      fromLocalDate,
      toLocalDate,
      timeZone: 'America/Chicago',
      includeNonBookable: true,
      cursorPaging: cursor ? { cursor, limit: 50 } : { limit: 50 },
    }

    const res = await fetch(WIX_TIME_SLOTS_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Wix ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = (await res.json()) as WixResponse
    const slots = data.timeSlots ?? []
    all.push(...slots)
    cursor = data.pagingMetadata?.cursors?.next ?? undefined
    if (!cursor || slots.length === 0) break
  }
  return all
}

function slotToRow(slot: WixTimeSlot): SessionRow | null {
  const id = slot.eventInfo?.eventId
  const localStart = slot.localStartDate
  if (!id || !localStart) return null
  return {
    /* Prefix the ID so Wix rows can't collide with calendar rows on
       the table's primary key (calendar IDs are base64 from Graph). */
    id: `wix:${id}`,
    service_id: slot.serviceId ?? null,
    title: slot.eventInfo?.eventTitle ?? '',
    local_start: localStart,
    total_capacity: slot.totalCapacity ?? 0,
    remaining_capacity: slot.remainingCapacity ?? 0,
    location: slot.location?.formattedAddress ?? '',
    source: 'wix',
    synced_at: new Date().toISOString(),
  }
}

// ── Wix bookings → training_attendance (QR roster) ──────────────────

const WIX_BOOKINGS_URL =
  'https://www.wixapis.com/_api/bookings-reader/v2/extended-bookings/query'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSlots(be: any): any[] {
  if (!be) return []
  if (be.slot) return [be.slot]
  if (Array.isArray(be.setOfSlots)) return be.setOfSlots
  if (be.singleSession) return [be.singleSession]
  return []
}

/** Central-time calendar date of a UTC ISO instant (DST-safe). */
function centralDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

function bookingMatchesSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b: any,
  wixEventId: string | null,
  wixScheduleId: string | null,
  classDate: string,
): boolean {
  const slots = extractSlots(b?.bookedEntity)
  let dateHit = false
  const starts: string[] = [
    String(b?.startDate || ''),
    ...slots.map((s) => String(s?.startDate || s?.start || '')),
  ].filter(Boolean)
  for (const st of starts) {
    if (classDate && centralDate(st) === classDate) dateHit = true
  }
  const scheduleIds = [
    b?.bookedEntity?.scheduleId,
    b?.bookedEntity?.schedule?.scheduleId,
    b?.bookedEntity?.schedule?.id,
    b?.schedule?.scheduleId,
    ...slots.map((s) => s?.scheduleId),
    ...slots.map((s) => s?.schedule?.scheduleId),
  ]
    .map((x) => String(x || ''))
    .filter(Boolean)
  const scheduleHit = !!wixScheduleId && scheduleIds.includes(wixScheduleId)
  const eventIds = [
    b?.bookedEntity?.eventId,
    b?.bookedEntity?.sessionId,
    b?.bookedEntity?.slot?.sessionId,
    ...slots.map((s) => s?.sessionId),
    ...slots.map((s) => s?.eventId),
    ...slots.map((s) => s?.id),
  ]
    .map((x) => String(x || ''))
    .filter(Boolean)
  const exact = !!wixEventId && eventIds.includes(wixEventId)
  /* Confident matches only: the exact Wix session, or the same course
     on the same Central calendar date. */
  return exact || (scheduleHit && dateHit)
}

interface LiveBooking {
  name: string
  email: string
  phone: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any
}

/** Recent live bookings, newest first (the reader ignores offset on
 *  some sites, so newest-first sorting is what guarantees fresh
 *  bookings are reachable; the 15-minute cadence keeps them on the
 *  first pages). */
async function fetchRecentBookings(
  token: string,
  siteId: string,
): Promise<LiveBooking[]> {
  const PAGE = 100
  const MAX_PAGES = 6
  const out: LiveBooking[] = []
  const seen = new Set<string>()
  let offset = 0
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await fetch(WIX_BOOKINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: { sort: [{ fieldName: 'createdDate', order: 'DESC' }] },
        paging: { limit: PAGE, offset },
      }),
    })
    if (!res.ok) {
      if (p === 0) {
        const text = await res.text()
        throw new Error(`Wix bookings ${res.status}: ${text.slice(0, 200)}`)
      }
      break
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const list = Array.isArray(data?.extendedBookings) ? data.extendedBookings : []
    if (!list.length) break
    const before = seen.size
    for (const e of list) {
      const b = e?.booking ? e.booking : e
      const id = String(b?.id || b?._id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      const st = String(b?.status || '').toUpperCase()
      if (st === 'CANCELED' || st === 'CANCELLED' || st === 'DECLINED') continue
      const c =
        e?.contactDetails || b?.contactDetails || b?.formInfo?.contactDetails || {}
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
        c.fullName ||
        c.name ||
        ''
      out.push({
        name,
        email: String(c.email || '').toLowerCase().trim(),
        phone: String(c.phone || ''),
        booking: b,
      })
    }
    if (seen.size === before) break // offset ignored by this site — stop
    offset += list.length
    if (list.length < PAGE) break
  }
  return out
}

// ── Graph ────────────────────────────────────────────────────────────

interface GraphCalendarEvent {
  id: string
  subject?: string
  start?: { dateTime?: string; timeZone?: string }
  location?: { displayName?: string }
  categories?: string[]
}

interface GraphList<T> {
  value: T[]
  '@odata.nextLink'?: string
}

interface GraphTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

async function getGraphAppToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph token ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as GraphTokenResponse
  return data.access_token
}

/**
 * Convert a Graph event's start.dateTime + timeZone into the
 * Postgres `timestamp without time zone` string we store
 * (`YYYY-MM-DDTHH:MM:SS`) reflecting Central Time, matching how
 * Wix rows are stored.
 */
function graphStartToLocalIsoNoTz(
  dateTime: string,
  timeZone: string | undefined,
): string {
  /* Graph returns dateTime in the requested timeZone (we set Prefer
     header below) without an offset, e.g. "2026-03-29T10:00:00.0000000".
     Strip fractional seconds + any trailing Z/offset to match our
     storage format. */
  let s = dateTime
  if (s.includes('.')) s = s.split('.')[0]
  if (s.endsWith('Z')) s = s.slice(0, -1)
  /* Suppress unused-var note */
  void timeZone
  return s
}

async function fetchCalendarEvents(
  token: string,
  groupId: string,
): Promise<SessionRow[]> {
  /* Use calendarView (not events) so:
     - The date range is a request param, not an $filter clause, which
       Graph handles more reliably across server timezones.
     - Recurring training (CPR every Tuesday, etc.) expands into one
       row per occurrence instead of returning only the master event. */
  const fromIso = new Date().toISOString()
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + 180)
  const toIso = horizon.toISOString()

  const url =
    `https://graph.microsoft.com/v1.0/groups/${groupId}/calendar/calendarView` +
    `?startDateTime=${encodeURIComponent(fromIso)}` +
    `&endDateTime=${encodeURIComponent(toIso)}` +
    `&$orderby=${encodeURIComponent('start/dateTime')}` +
    `&$top=100`

  const all: GraphCalendarEvent[] = []
  let nextUrl: string | undefined = url
  for (let page = 0; page < 10 && nextUrl; page++) {
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        /* Ask Graph to express start/end in Central Time so we don't
           have to do TZ conversion server-side. */
        Prefer: 'outlook.timezone="Central Standard Time"',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Graph calendar ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = (await res.json()) as GraphList<GraphCalendarEvent>
    all.push(...(data.value ?? []))
    nextUrl = data['@odata.nextLink']
  }

  /* Debug surface: log what Graph actually returned BEFORE we filter
     so the function logs in the Supabase dashboard reveal whether
     it's a category-name issue, a permissions issue, or an empty
     calendar. Drop these once syncing is stable. */
  console.log(`[graph] events returned: ${all.length}`)
  for (const e of all.slice(0, 10)) {
    console.log(
      `[graph]  - ${e.subject} | categories=${JSON.stringify(e.categories ?? [])}`,
    )
  }

  const now = new Date().toISOString()
  return all
    /* Match the SPFx version's filter: events tagged with a "blue"
       category are training. Outlook ships category names like
       "Blue category" — case-insensitive contains-match catches both
       that and a plain "blue". */
    .filter((e) =>
      e.categories?.some((c) => c.toLowerCase().includes('blue')),
    )
    .filter((e) => !!e.start?.dateTime)
    .map((e) => ({
      id: `cal:${e.id}`,
      service_id: null,
      title: e.subject ?? '',
      local_start: graphStartToLocalIsoNoTz(
        e.start!.dateTime!,
        e.start?.timeZone,
      ),
      total_capacity: 0,
      remaining_capacity: 0,
      location: e.location?.displayName ?? '',
      source: 'calendar' as const,
      synced_at: now,
    }))
}

// ── Function entry ───────────────────────────────────────────────────

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'authorization, content-type, apikey, x-client-info, prefer',
        'Access-Control-Allow-Methods': 'POST',
      },
    })
  }

  const supabaseUrl = env.get('SUPABASE_URL')
  const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
  const wixToken = env.get('WIX_API_TOKEN')
  const wixSiteId = env.get('WIX_SITE_ID')
  const graphTenantId = env.get('GRAPH_TENANT_ID')
  const graphClientId = env.get('GRAPH_CLIENT_ID')
  const graphClientSecret = env.get('GRAPH_CLIENT_SECRET')
  const graphGroupId = env.get('GRAPH_GROUP_ID')

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Supabase env not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (!wixToken || !wixSiteId) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'WIX_API_TOKEN and WIX_SITE_ID must be set via supabase secrets',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
  /* Graph secrets are optional — function still runs if they're not
     set yet (Wix-only sync). Logs a warning so admins notice. */
  const graphConfigured =
    !!graphTenantId && !!graphClientId && !!graphClientSecret && !!graphGroupId

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    })

    const { data: excludedRows, error: excludedErr } = await supabase
      .from('training_excluded_services')
      .select('service_id')
    if (excludedErr) {
      throw new Error(`load excluded services: ${excludedErr.message}`)
    }
    const excludedIds = new Set(
      (excludedRows ?? []).map((r: { service_id: string }) => r.service_id),
    )

    /* Pull Wix + Graph in parallel. If Graph isn't configured yet,
       we still return Wix-only rows so the function stays useful. */
    const [wixSlots, calRowsResult] = await Promise.all([
      fetchAllTimeSlots(wixToken, wixSiteId),
      graphConfigured
        ? getGraphAppToken(graphTenantId!, graphClientId!, graphClientSecret!)
            .then((tok) => fetchCalendarEvents(tok, graphGroupId!))
            .catch((err) => {
              console.error('[sync] graph fetch failed:', err)
              return [] as SessionRow[]
            })
        : Promise.resolve([] as SessionRow[]),
    ])

    const wixRows = wixSlots
      .map(slotToRow)
      .filter((r): r is SessionRow => r !== null)
      .filter((r) => !r.service_id || !excludedIds.has(r.service_id))

    const rows: SessionRow[] = [...wixRows, ...calRowsResult]

    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('training_sessions')
        .upsert(rows, { onConflict: 'id' })
      if (upsertErr) throw new Error(`upsert: ${upsertErr.message}`)
    }

    /* Prune rows not seen in this run — handles canceled sessions,
       calendar events that got "blue" un-tagged, and the 180-day
       horizon falloff. Only reconcile the sources this sync OWNS:
       'manual' (one-off classes added by hand, e.g. Jotform-registered)
       and 'lecture' rows are managed elsewhere and must survive. */
    const liveIds = rows.map((r) => r.id)
    const ownSources = ['wix', 'calendar']
    const { error: delErr } =
      liveIds.length > 0
        ? await supabase
            .from('training_sessions')
            .delete()
            .in('source', ownSources)
            .not('id', 'in', `(${liveIds.map((id) => `"${id}"`).join(',')})`)
        : await supabase.from('training_sessions').delete().in('source', ownSources)
    if (delErr) throw new Error(`prune: ${delErr.message}`)

    /* Tidy: drop manual one-offs once their class day is well past
       (the UI already hides past dates; this just keeps the table clean). */
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19)
    await supabase
      .from('training_sessions')
      .delete()
      .eq('source', 'manual')
      .lt('local_start', cutoff)

    /* ── Phase 2: card-class bookings → training_attendance ──────────
       The QR check-in reads training_attendance; until 2026-11-05 Wix
       bookers were display-only in the Registrations view and had to
       be re-typed by hand. Match every live booking to an upcoming
       CardClass session (exact Wix session id, else same course +
       same Central date) and insert the missing roster rows. Dedupe
       key is (session, lowercased email) — or the exact name when a
       booking carries no email — so manual rows never duplicate.
       Cancelled bookings are skipped; rows already on the roster are
       left untouched. Failures here never block the session sync. */
    let regsImported = 0
    let regsMatched = 0
    const regsPerSession: Record<string, number> = {}
    let regsError: string | null = null
    try {
      const sinceIso = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
      const { data: csRows, error: csErr } = await supabase
        .from('course_sessions')
        .select('session_id, title, wix_event_id, wix_schedule_id, class_date')
        .eq('session_type', 'CardClass')
        .not('wix_schedule_id', 'is', null)
        .gte('class_date', sinceIso)
      if (csErr) throw new Error(csErr.message)
      const cardSessions = csRows ?? []

      if (cardSessions.length > 0) {
        const bookings = await fetchRecentBookings(wixToken, wixSiteId)
        const bySession = new Map<string, LiveBooking[]>()
        for (const bk of bookings) {
          for (const s of cardSessions) {
            const classDate = String(s.class_date || '').slice(0, 10)
            if (bookingMatchesSession(bk.booking, s.wix_event_id, s.wix_schedule_id, classDate)) {
              const list = bySession.get(s.session_id) ?? []
              list.push(bk)
              bySession.set(s.session_id, list)
              regsMatched++
              break
            }
          }
        }

        if (bySession.size > 0) {
          const ids = [...bySession.keys()]
          const { data: existing, error: exErr } = await supabase
            .from('training_attendance')
            .select('session_id, student_name, student_email')
            .in('session_id', ids)
          if (exErr) throw new Error(exErr.message)
          const have = new Set(
            (existing ?? []).map((r) => {
              const em = String(r.student_email || '').toLowerCase().trim()
              return `${r.session_id}|${em || 'n:' + String(r.student_name || '').toLowerCase().trim()}`
            }),
          )

          /* Link portal accounts by email where possible. */
          const { data: users } = await supabase
            .from('app_users')
            .select('id, email')
            .eq('account_type', 'person')
          const userByEmail = new Map(
            (users ?? [])
              .filter((u) => !!u.email)
              .map((u) => [String(u.email).toLowerCase(), u.id]),
          )

          const inserts: Record<string, unknown>[] = []
          for (const [sessionId, list] of bySession) {
            for (const bk of list) {
              if (!bk.name && !bk.email) continue
              const key = `${sessionId}|${bk.email || 'n:' + bk.name.toLowerCase().trim()}`
              if (have.has(key)) continue
              have.add(key)
              inserts.push({
                session_id: sessionId,
                student_name: bk.name || bk.email,
                student_email: bk.email,
                phone: bk.phone,
                attendance_mode: 'InPerson',
                status: 'Pending',
                phase: 'registered',
                user_id: bk.email ? (userByEmail.get(bk.email) ?? null) : null,
              })
              regsPerSession[sessionId] = (regsPerSession[sessionId] ?? 0) + 1
            }
          }
          if (inserts.length > 0) {
            const { error: insErr } = await supabase
              .from('training_attendance')
              .insert(inserts)
            if (insErr) throw new Error(insErr.message)
            regsImported = inserts.length
          }
        }
      }
    } catch (err) {
      regsError = (err as Error).message
      console.error('[sync] bookings import failed:', err)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        wixCount: wixRows.length,
        calendarCount: calRowsResult.length,
        syncedCount: rows.length,
        graphConfigured,
        regsMatched,
        regsImported,
        regsPerSession,
        regsError,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  }
})
