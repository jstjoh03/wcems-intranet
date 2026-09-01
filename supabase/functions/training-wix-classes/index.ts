// supabase/functions/training-wix-classes/index.ts
//
// Lists Wix Bookings class slots for the training dashboard's
// "Scheduled on Wix — not managed here yet" import strip. Queries Wix
// DIRECTLY (same time-slots endpoint the calendar sync uses) from the
// start of TODAY in Central time, so a same-day class stays importable
// even after its start time passes — the synced training_sessions
// mirror drops past-start slots, which is why the strip can't rely
// on it.
//
// Auth: signed-in WCEMS user (verified JWT). Uses WIX_API_TOKEN /
// WIX_SITE_ID secrets.

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const SLOTS_URL =
  'https://www.wixapis.com/_api/service-availability/v2/time-slots/event'

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/** YYYY-MM-DD of "today" in Central time (DST-safe). */
function centralToday(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Chicago',
  })
}

function plusDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

interface WixTimeSlot {
  serviceId?: string
  localStartDate?: string
  totalCapacity?: number
  remainingCapacity?: number
  location?: { formattedAddress?: string }
  eventInfo?: { eventId?: string; eventTitle?: string }
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = env.get('SUPABASE_URL')!
    const anonKey = env.get('SUPABASE_ANON_KEY')!
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not authenticated.' }, 401)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: u, error: ue } = await userClient.auth.getUser()
    if (ue || !u?.user) return json({ error: 'Not authenticated.' }, 401)

    const token = env.get('WIX_API_TOKEN')
    const siteId = env.get('WIX_SITE_ID')
    if (!token || !siteId) {
      return json({ error: 'Wix credentials not configured.' }, 500)
    }

    const today = centralToday()
    const fromLocalDate = `${today}T00:00:00`
    const toLocalDate = `${plusDays(today, 180)}T23:59:59`

    const slots: WixTimeSlot[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const res = await fetch(SLOTS_URL, {
        method: 'POST',
        headers: {
          Authorization: token,
          'wix-site-id': siteId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromLocalDate,
          toLocalDate,
          timeZone: 'America/Chicago',
          includeNonBookable: true,
          cursorPaging: cursor ? { cursor, limit: 50 } : { limit: 50 },
        }),
      })
      const text = await res.text()
      if (!res.ok) {
        return json({ error: `Wix slots query failed: ${text.slice(0, 200)}` }, 502)
      }
      const data = JSON.parse(text)
      const pageSlots: WixTimeSlot[] = Array.isArray(data.timeSlots)
        ? data.timeSlots
        : []
      slots.push(...pageSlots)
      cursor = data.pagingMetadata?.cursors?.next ?? undefined
      if (!cursor || pageSlots.length === 0) break
    }

    const classes = slots
      .filter((s) => s.eventInfo?.eventId && s.localStartDate)
      .map((s) => ({
        eventId: s.eventInfo!.eventId!,
        serviceId: s.serviceId ?? null,
        title: s.eventInfo?.eventTitle ?? '',
        localStart: s.localStartDate!,
        totalCapacity: s.totalCapacity ?? 0,
        remainingCapacity: s.remainingCapacity ?? 0,
        location: s.location?.formattedAddress ?? '',
      }))

    return json({ classes })
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Request failed.' },
      500,
    )
  }
})
