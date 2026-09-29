// supabase/functions/training-update-schedule/index.ts
//
// Move a session's date/times after creation (Justin, 2026-09-29): a
// date picked wrong at creation shouldn't force Cancel + recreate.
//   - course_sessions: class_date / start_time / end_time
//   - Card Class with a Wix event: PATCH the Wix calendar event so the
//     booking page and bookers follow. Wix failure is NON-fatal — the
//     local row still moves and the response carries wixWarning so the
//     instructor knows to fix Wix by hand.
//   - training_sessions mirror (portal "Upcoming Training" tiles):
//     wix:<eventId> row for card classes, lecture_session_id row for
//     lectures — local_start moves immediately instead of waiting on
//     the next Wix sync.
//
// Auth: signed-in WCEMS user (verified JWT), same pattern as
// training-cancel-session. Reuses WIX_API_TOKEN / WIX_SITE_ID secrets.

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const TIME_ZONE = 'America/Chicago'

interface UpdatePayload {
  sessionId: string
  classDate: string // 'YYYY-MM-DD'
  startTime?: string // 'HH:MM' — falls back to the stored value
  endTime?: string
}

async function moveWixEvent(
  eventId: string,
  startLocal: string,
  endLocal: string,
  token: string,
  siteId: string,
): Promise<{ ok: boolean; detail: string }> {
  // Same path family the create/cancel functions use; try the public
  // host first, the _api fallback second.
  const attempts = [
    `https://www.wixapis.com/calendar/v3/events/${eventId}`,
    `https://www.wixapis.com/_api/calendar/v3/events/${eventId}`,
  ]
  const body = JSON.stringify({
    event: {
      start: { localDate: startLocal, timeZone: TIME_ZONE },
      end: { localDate: endLocal, timeZone: TIME_ZONE },
    },
  })
  const tried: string[] = []
  for (const url of attempts) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body,
    })
    const text = await res.text()
    tried.push(`${url.replace('https://www.wixapis.com', '')} → ${res.status}`)
    if (res.ok) return { ok: true, detail: tried.join('; ') }
    if (res.status !== 404) {
      return { ok: false, detail: `${tried.join('; ')} — ${text.slice(0, 300)}` }
    }
  }
  return { ok: false, detail: tried.join('; ') }
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

    // Authn
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not authenticated.' }, 401)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Not authenticated.' }, 401)
    }

    const payload = (await req.json()) as UpdatePayload
    if (!payload?.sessionId) return json({ error: 'Missing sessionId.' }, 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.classDate ?? '')) {
      return json({ error: 'Pick a valid class date.' }, 400)
    }
    const timeOk = (t: string | undefined) => !t || /^\d{2}:\d{2}$/.test(t)
    if (!timeOk(payload.startTime) || !timeOk(payload.endTime)) {
      return json({ error: 'Times must be HH:MM.' }, 400)
    }

    const admin = createClient(url, serviceKey)
    const { data: row, error: rowErr } = await admin
      .from('course_sessions')
      .select('id, session_type, status, class_date, start_time, end_time, wix_event_id')
      .eq('session_id', payload.sessionId)
      .maybeSingle()
    if (rowErr) return json({ error: rowErr.message }, 500)
    if (!row) return json({ error: 'Session not found.' }, 404)
    if (row.status === 'Canceled') {
      return json({ error: 'This session is canceled — create a new one instead.' }, 400)
    }

    const newDate = payload.classDate
    const newStart = payload.startTime || row.start_time || ''
    const newEnd = payload.endTime || row.end_time || ''

    const { error: updErr } = await admin
      .from('course_sessions')
      .update({ class_date: newDate, start_time: newStart, end_time: newEnd })
      .eq('id', row.id)
    if (updErr) return json({ error: `Failed to save: ${updErr.message}` }, 500)

    let wixWarning: string | null = null
    let wixMoved = false
    if (row.wix_event_id) {
      const wixToken = env.get('WIX_API_TOKEN')
      const wixSiteId = env.get('WIX_SITE_ID')
      if (!wixToken || !wixSiteId) {
        wixWarning = 'Wix credentials are not configured — move the Wix event by hand.'
      } else if (!newStart || !newEnd) {
        wixWarning = 'No start/end time on file — the Wix event was not moved.'
      } else {
        const res = await moveWixEvent(
          row.wix_event_id,
          `${newDate}T${newStart}:00`,
          `${newDate}T${newEnd}:00`,
          wixToken,
          wixSiteId,
        )
        wixMoved = res.ok
        if (!res.ok) {
          wixWarning = `The date saved here, but the Wix event could not be moved (${res.detail}). Update it in Wix so bookers see the right date.`
        }
      }
    }

    // Portal "Upcoming Training" mirror — best effort, non-fatal.
    if (newStart) {
      const localStart = `${newDate}T${newStart}:00`
      if (row.wix_event_id) {
        await admin
          .from('training_sessions')
          .update({ local_start: localStart })
          .eq('id', `wix:${row.wix_event_id}`)
      }
      if (row.session_type === 'Lecture') {
        await admin
          .from('training_sessions')
          .update({ local_start: localStart })
          .eq('lecture_session_id', row.id)
      }
    }

    return json({ success: true, wixMoved, wixWarning })
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Update schedule failed.' },
      500,
    )
  }
})
