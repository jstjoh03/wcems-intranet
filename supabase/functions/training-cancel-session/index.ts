// supabase/functions/training-cancel-session/index.ts
//
// Cancel a session — distinct from "Close" (archive-after-completed).
// "Cancel" means the class isn't happening:
//   - For Card Classes with a Wix event: call Wix to cancel the event,
//     which notifies registered bookers via Wix's standard cancellation
//     emails and frees the seats.
//   - In our DB: flip status to 'Canceled' and close check-in/eval so
//     no late submissions sneak in after the call.
//
// Auth: signed-in WCEMS user (verified JWT), same pattern as
// training-create-session. Reuses WIX_API_TOKEN / WIX_SITE_ID secrets.

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

async function cancelWixEvent(
  eventId: string,
  token: string,
  siteId: string,
): Promise<{ ok: boolean; status: number; text: string; tried: string[] }> {
  // Wix has shifted these paths over time. Try the well-known cancel
  // endpoints in turn; the first one that returns 2xx wins.
  const attempts = [
    `https://www.wixapis.com/calendar/v3/events/${eventId}/cancel`,
    `https://www.wixapis.com/_api/calendar/v3/events/${eventId}/cancel`,
  ]
  const tried: string[] = []
  let last: { status: number; text: string } = { status: 0, text: '' }
  for (const url of attempts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: token,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notifyParticipants: true }),
    })
    const text = await res.text()
    tried.push(`${url.replace('https://www.wixapis.com', '')} → ${res.status}`)
    if (res.ok) return { ok: true, status: res.status, text, tried }
    last = { status: res.status, text: text.slice(0, 300) }
  }
  return { ok: false, status: last.status, text: last.text, tried }
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
    const { data: u, error: ue } = await userClient.auth.getUser()
    if (ue || !u?.user) return json({ error: 'Not authenticated.' }, 401)

    const admin = createClient(url, serviceKey)
    const { sessionId } = await req.json()
    if (!sessionId) return json({ error: 'Missing sessionId.' }, 400)

    const { data: session } = await admin
      .from('course_sessions')
      .select('id, session_id, session_type, status, wix_event_id')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (!session) return json({ error: 'Session not found.' }, 404)
    if (session.status === 'Canceled') {
      return json({ success: true, alreadyCanceled: true, wixCanceled: false })
    }

    let wixCanceled = false
    let wixWarning: string | null = null
    if (session.session_type === 'CardClass' && session.wix_event_id) {
      const token = env.get('WIX_API_TOKEN')
      const siteId = env.get('WIX_SITE_ID')
      if (!token || !siteId) {
        wixWarning =
          'Wix credentials not configured — DB marked canceled, Wix event not touched.'
      } else {
        const r = await cancelWixEvent(session.wix_event_id, token, siteId)
        if (r.ok) {
          wixCanceled = true
        } else {
          wixWarning =
            'Wix cancellation failed: ' + r.tried.join(' | ') +
            (r.text ? ` :: ${r.text}` : '')
        }
      }
    }

    // Flip the row regardless of Wix outcome. The instructor can retry
    // Wix-side via the dashboard if the cancellation API failed; the
    // class is still off in our system either way.
    const { error: upErr } = await admin
      .from('course_sessions')
      .update({
        status: 'Canceled',
        check_in_status: 'Closed',
        eval_status: 'Closed',
      })
      .eq('session_id', sessionId)
    if (upErr) {
      return json(
        { error: `DB update failed: ${upErr.message}`, wixCanceled, wixWarning },
        500,
      )
    }

    // Lectures only: remove the calendar tile from the intranet feed.
    // The intranet's "Upcoming Training" widget reads training_sessions;
    // a canceled lecture shouldn't keep advertising itself.
    if (session.session_type === 'Lecture' && session.id) {
      await admin
        .from('training_sessions')
        .delete()
        .eq('lecture_session_id', session.id)
    }

    return json({ success: true, wixCanceled, wixWarning })
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Request failed.' },
      500,
    )
  }
})
