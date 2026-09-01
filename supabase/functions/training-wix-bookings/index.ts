// supabase/functions/training-wix-bookings/index.ts
//
// Lists Wix Bookings registrants for a Card Class session. Card-class
// sign-up happens on the Wix member portal (not in this app), so this
// pulls those bookers in for the Registrations view.
//
// Auth: signed-in WCEMS user (verified JWT). Reuses the project's
// WIX_API_TOKEN / WIX_SITE_ID secrets.
//
// Wix matching note: every class session of a service shares one
// scheduleId, so we read recent bookings and narrow to THIS session in
// code (by the calendar event/session id we stored at create time, or
// failing that the same local date). We deliberately send NO server-side
// filter — dotted-path filters on the bookings query 500 — and instead
// filter the returned page ourselves.

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Inlined from _shared/cors.ts for single-file deploys:
// Shared CORS headers for the training Edge Functions. The public
// student pages and the instructor SPA both call these cross-origin.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...extra,
    },
  })
}

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

interface OutBooking {
  name: string
  email: string
  phone: string
  partySize: number
  status: string
  createdDate: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSlots(be: any): any[] {
  if (!be) return []
  if (be.slot) return [be.slot]
  if (Array.isArray(be.setOfSlots)) return be.setOfSlots
  if (be.singleSession) return [be.singleSession]
  return []
}

// Wix sends slot/booking start times as UTC ISO. WCEMS classes are
// scheduled in America/Chicago, so compare the *Central* calendar date
// (DST-safe) rather than slicing the UTC string — a 7pm CT class would
// otherwise read as the next UTC day.
function centralDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // en-CA gives YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

function bookingMatchesSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b: any,
  wixEventId: string | null,
  wixScheduleId: string | null,
  classDate: string,
): { exact: boolean; dateHit: boolean; scheduleHit: boolean } {
  let exact = false
  let dateHit = false
  let scheduleHit = false

  // Candidate start datetimes: booking is top-level startDate (the
  // booked class slot), plus any nested slot startDates.
  const slots = extractSlots(b?.bookedEntity)
  const starts: string[] = [
    String(b?.startDate || ''),
    ...slots.map((s) => String(s?.startDate || s?.start || '')),
  ].filter(Boolean)
  for (const st of starts) {
    if (classDate && centralDate(st) === classDate) dateHit = true
  }

  // Schedule + exact-session ids can live on the slot, on bookedEntity
  // directly, or on bookedEntity.schedule (the shape this site returns).
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
  if (wixScheduleId && scheduleIds.includes(wixScheduleId)) scheduleHit = true

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
  if (wixEventId && eventIds.includes(wixEventId)) exact = true

  return { exact, dateHit, scheduleHit }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(b: any, contact: any): OutBooking {
  const c = contact || b?.contactDetails || b?.formInfo?.contactDetails || {}
  const name =
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
    c.fullName ||
    c.name ||
    '(no name)'
  return {
    name,
    email: String(c.email || '').toLowerCase(),
    phone: String(c.phone || ''),
    partySize: Number(b?.numberOfParticipants || b?.totalParticipants || 1),
    status: String(b?.status || 'UNKNOWN'),
    createdDate: String(b?.createdDate || b?._createdDate || ''),
  }
}

async function wixQuery(
  url: string,
  body: unknown,
  token: string,
  siteId: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: token,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = env.get('SUPABASE_URL')!
    const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = env.get('SUPABASE_ANON_KEY')!

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not authenticated.' }, 401)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: u, error: ue } = await userClient.auth.getUser()
    if (ue || !u?.user) return json({ error: 'Not authenticated.' }, 401)

    const admin = createClient(url, serviceKey)
    const { sessionId, debug } = await req.json()
    if (!sessionId) return json({ error: 'Missing sessionId.' }, 400)

    const { data: s } = await admin
      .from('course_sessions')
      .select('session_type, wix_event_id, wix_schedule_id, class_date')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (!s) return json({ error: 'Session not found.' }, 404)
    if (s.session_type !== 'CardClass' || !s.wix_schedule_id) {
      return json({ bookings: [], approximate: false, reason: 'not-wix' })
    }

    const token = env.get('WIX_API_TOKEN')
    const siteId = env.get('WIX_SITE_ID')
    if (!token || !siteId) {
      return json({ error: 'Wix credentials not configured.' }, 500)
    }

    // This Wix site/token is proven to accept the OLD query envelope —
    // `{ query: {}, paging: { limit, offset } }` (paging is a SIBLING of
    // query), exactly how the legacy createsession.jsw queried services.
    // The reader caps each page (~50), so we PAGE THROUGH all bookings
    // by offset and dedupe — otherwise a session's bookings can sit
    // beyond page one and never match.
    const PAGE = 100
    const MAX_PAGES = 12 // safety cap (~up to 1200 bookings)
    const SORT = [{ fieldName: 'createdDate', order: 'DESC' }]
    // Wix ignores `offset` on this reader, so pagination alone can't
    // reach an arbitrary session's bookings. Sorting newest-first is
    // what actually surfaces a just-made booking on page one. We try a
    // few sort placements (Wix has shipped both) and fall back to the
    // proven plain shape.
    const sortInQuery = (offset: number) => ({
      query: { sort: SORT },
      paging: { limit: PAGE, offset },
    })
    const sortSibling = (offset: number) => ({
      query: {},
      sort: SORT,
      paging: { limit: PAGE, offset },
    })
    const oldBody = (offset: number) => ({
      query: {},
      paging: { limit: PAGE, offset },
    })
    const newBody = () => ({
      query: { sort: SORT, cursorPaging: { limit: PAGE } },
    })
    const EXT = 'https://www.wixapis.com/_api/bookings-reader/v2/extended-bookings/query'
    const attempts: {
      label: string
      url: string
      paged: boolean
      body: (offset: number) => unknown
    }[] = [
      { label: 'ext_sortq', url: EXT, paged: true, body: sortInQuery },
      { label: 'ext_sortsib', url: EXT, paged: true, body: sortSibling },
      { label: 'api_extended_old', url: EXT, paged: true, body: oldBody },
      {
        label: 'api_extended_new',
        url: EXT,
        paged: false,
        body: newBody,
      },
      {
        label: 'api_bookings_old',
        url: 'https://www.wixapis.com/_api/bookings/v2/bookings/query',
        paged: true,
        body: oldBody,
      },
      {
        label: 'bookings_old',
        url: 'https://www.wixapis.com/bookings/v2/bookings/query',
        paged: true,
        body: oldBody,
      },
    ]

    const attemptLog: {
      label: string
      status: number
      ok: boolean
      snippet: string
    }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function arrOf(d: any): any[] {
      const a = d?.extendedBookings || d?.bookings || d?.bookingsEntries || []
      return Array.isArray(a) ? a : []
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entries: any[] = []
    let usedLabel = ''
    let pagesFetched = 0

    for (const a of attempts) {
      const r0 = await wixQuery(a.url, a.body(0), token, siteId)
      attemptLog.push({
        label: a.label,
        status: r0.status,
        ok: r0.ok,
        snippet: r0.text.slice(0, 140),
      })
      if (!r0.ok) continue
      let d0: unknown
      try {
        d0 = JSON.parse(r0.text)
      } catch {
        continue
      }
      const first = arrOf(d0)
      if (!first.length && !usedLabel) {
        // endpoint works but returned nothing — still mark usable
      }
      usedLabel = a.label
      pagesFetched = 1
      const seen = new Set<string>()
      const collect = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        list: any[],
      ) => {
        for (const e of list) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = e?.booking ? e.booking : e
          const id = String(b?.id || b?._id || Math.random())
          if (seen.has(id)) continue
          seen.add(id)
          entries.push(e)
        }
      }
      collect(first)

      if (a.paged && first.length >= 1) {
        let offset = first.length
        for (let p = 1; p < MAX_PAGES; p++) {
          const rn = await wixQuery(a.url, a.body(offset), token, siteId)
          if (!rn.ok) break
          let dn: unknown
          try {
            dn = JSON.parse(rn.text)
          } catch {
            break
          }
          const page = arrOf(dn)
          pagesFetched++
          if (!page.length) break
          const before = seen.size
          collect(page)
          // No new ids → Wix is ignoring offset (or we're done).
          if (seen.size === before) break
          offset += page.length
          if (page.length < PAGE && page.length < 50) break
        }
      }
      break
    }

    if (!usedLabel) {
      return json(
        {
          error:
            'Wix bookings query failed on all endpoint variants. ' +
            attemptLog.map((x) => `${x.label}:${x.status}`).join(' | '),
          debug: { attempts: attemptLog },
        },
        502,
      )
    }

    const classDate = String(s.class_date || '').slice(0, 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flattened = entries.map((e: any) => ({
      booking: e?.booking ? e.booking : e,
      contact:
        e?.contactDetails ||
        e?.booking?.contactDetails ||
        e?.booking?.formInfo?.contactDetails ||
        null,
    }))

    const live = flattened.filter((f) => {
      const st = String(f.booking?.status || '').toUpperCase()
      return st !== 'CANCELED' && st !== 'CANCELLED' && st !== 'DECLINED'
    })

    const tagged = live.map((f) => ({
      f,
      m: bookingMatchesSession(
        f.booking,
        s.wix_event_id,
        s.wix_schedule_id,
        classDate,
      ),
    }))

    // Match must be confident: the exact session, OR same course
    // (scheduleId) AND same calendar date. We do NOT fall back to
    // "every booking on this course" — that surfaced unrelated bookings
    // from other class dates.
    const exact = tagged.filter((t) => t.m.exact)
    let chosen = exact
    let approximate = false
    if (exact.length === 0) {
      const dated = tagged.filter((t) => t.m.scheduleHit && t.m.dateHit)
      chosen = dated
      approximate = dated.length > 0
    }

    const bookings: OutBooking[] = chosen.map((t) =>
      normalize(t.f.booking, t.f.contact),
    )

    const payload: Record<string, unknown> = { bookings, approximate }
    if (debug) {
      payload.debug = {
        usedLabel,
        pagesFetched,
        totalReturned: entries.length,
        liveCount: live.length,
        matchedExact: exact.length,
        matchedScheduleAndDate: tagged.filter(
          (t) => t.m.scheduleHit && t.m.dateHit,
        ).length,
        scheduleHits: tagged.filter((t) => t.m.scheduleHit).length,
        dateHits: tagged.filter((t) => t.m.dateHit).length,
        attempts: attemptLog,
        // Did the target session's date land in the fetched set at all?
        targetDateInSet: live.some(
          (f) => centralDate(String(f.booking?.startDate || '')) === classDate,
        ),
        newestCreated: live
          .map((f) => String(f.booking?.createdDate || ''))
          .sort()
          .slice(-3),
        // Every live booking's resolved identity vs. what we're matching
        // against — this shows exactly why a row did/didn't match.
        sampleRows: live.slice(0, 8).map((f) => ({
          name:
            [f.contact?.firstName, f.contact?.lastName]
              .filter(Boolean)
              .join(' ') || f.booking?.contactDetails?.email,
          startDate: f.booking?.startDate || null,
          centralDate: centralDate(String(f.booking?.startDate || '')),
          createdDate: f.booking?.createdDate || null,
          resolvedScheduleId:
            f.booking?.bookedEntity?.schedule?.scheduleId ||
            f.booking?.bookedEntity?.scheduleId ||
            null,
        })),
        wixEventId: s.wix_event_id,
        wixScheduleId: s.wix_schedule_id,
        classDate,
      }
    }
    return json(payload)
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Request failed.' },
      500,
    )
  }
})
