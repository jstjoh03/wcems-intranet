// supabase/functions/training-create-session/index.ts
//
// Port of the legacy Wix Velo `createsession.jsw` +
// `CREATE_SESSION_FLOW_URL` Power Automate flow.
//
// For a Card Class it creates a Wix Bookings calendar event (so the
// intranet's existing Wix → training_sessions feed keeps surfacing it),
// then writes the row into `public.course_sessions`. For a Lecture it
// just writes the row.
//
// Auth: requires a signed-in WCEMS user (verified via the caller's JWT
// against `app_users`). The row write uses the service-role key.
//
// Reuses the intranet Edge Function secrets:
//   WIX_API_TOKEN  — Wix IST.eyJ... token
//   WIX_SITE_ID    — wix-site-id header value

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

const TIME_ZONE = 'America/Chicago'
// Wix staff/resource the legacy createsession.jsw pinned every Card
// Class event to. Unchanged.
const WIX_RESOURCE_ID = 'cfd7dcde-5bbc-440c-88c0-8ac126f0a9c9'

interface CreatePayload {
  sessionType: 'CardClass' | 'Lecture'
  title?: string
  classDate: string
  startTime: string
  endTime: string
  location?: string
  cardCourseName?: string
  lectureTitle?: string
  dshsContentArea?: string
  hoursAwarded: string
  maxSeats?: number | null
  verificationPointsRequired?: number | null
  primaryInstructorName: string
  primaryInstructorEmail: string
  primaryInstructorNumber: string
  primaryInstructorCardExp?: string
  secondaryInstructorName?: string
  secondaryInstructorEmail?: string
  secondaryInstructorNumber?: string
  secondaryInstructorCardExp?: string
  tertiaryInstructorName?: string
  tertiaryInstructorEmail?: string
  tertiaryInstructorNumber?: string
  tertiaryInstructorCardExp?: string
  registrationType: 'Wix' | 'Internal'
  registrationUrl: string
  status?: string
  requireRegistration?: boolean
  /** Adopt mode: manage a class that was scheduled DIRECTLY in Wix
   *  (by Heather, say) — links the existing Wix event instead of
   *  creating a new one. No Wix write happens. */
  adopt?: {
    wixEventId: string
    wixServiceId?: string | null
    wixScheduleId?: string | null
    wixServiceName?: string | null
  }
  /** Lecture only — opens the virtual attendance mode + Teams URL. */
  virtualEnabled?: boolean
  teamsMeetingUrl?: string
  /** Lecture only — the origin the instructor created from (e.g.
   *  https://training.wallercountyems.com). Used to build the public
   *  registration URL once sessionId is generated. */
  appBaseUrl?: string
}

function randToken(len = 28): string {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length]
  return out
}

function buildLocalDateTime(dateStr: string, timeStr: string): string {
  return `${dateStr}T${timeStr}:00`
}

async function queryWixServices(token: string, siteId: string) {
  const res = await fetch(
    'https://www.wixapis.com/_api/bookings/v2/services/query',
    {
      method: 'POST',
      headers: {
        Authorization: token,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: {}, paging: { limit: 100 } }),
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`Wix services query failed: ${text}`)
  const data = JSON.parse(text)
  return Array.isArray(data.services) ? data.services : []
}

async function createWixEvent(
  payload: CreatePayload,
  course: { wix_service_id: string; wix_schedule_id: string; name: string },
  token: string,
  siteId: string,
) {
  const services = await queryWixServices(token, siteId)
  const liveService = services.find(
    (s: { id?: string }) => s?.id === course.wix_service_id,
  )
  if (!liveService) {
    throw new Error(`Mapped Wix service not found: ${course.name}`)
  }
  const serviceLocation = liveService?.locations?.[0]
  if (!serviceLocation?.id || !serviceLocation?.type) {
    throw new Error(`No valid location on Wix service: ${course.name}`)
  }

  const eventBody = {
    event: {
      scheduleId: course.wix_schedule_id,
      type: 'CLASS',
      title: payload.title || payload.cardCourseName || course.name,
      description: payload.cardCourseName || '',
      location: { id: serviceLocation.id, type: serviceLocation.type },
      resources: [{ id: WIX_RESOURCE_ID }],
      start: {
        localDate: buildLocalDateTime(payload.classDate, payload.startTime),
        timeZone: TIME_ZONE,
      },
      end: {
        localDate: buildLocalDateTime(payload.classDate, payload.endTime),
        timeZone: TIME_ZONE,
      },
      capacity:
        payload.maxSeats && payload.maxSeats > 0 ? payload.maxSeats : 20,
    },
  }

  const res = await fetch('https://www.wixapis.com/calendar/v3/events', {
    method: 'POST',
    headers: {
      Authorization: token,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Wix event creation failed: ${text}`)
  const data = JSON.parse(text)
  const wixEventId = data?.event?.id || data?.event?._id || data?.id
  if (!wixEventId) {
    throw new Error(`Wix event created but no event ID returned: ${text}`)
  }
  return wixEventId as string
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

    // ── Authn: caller must be a signed-in WCEMS user ──────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not authenticated.' }, 401)

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userData, error: userErr } =
      await userClient.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Not authenticated.' }, 401)
    }

    const admin = createClient(url, serviceKey)

    // Resolve the app_users row for created_by attribution.
    const { data: appUserRow } = await admin
      .from('app_users')
      .select('id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle()

    const payload = (await req.json()) as CreatePayload
    if (!payload?.sessionType) {
      return json({ error: 'Missing session payload.' }, 400)
    }

    const sessionId = `SES-${Date.now()}`
    const checkInToken = randToken()
    const evalToken = randToken()
    const quizToken = randToken()

    // For lectures, build the public registration URL from the
    // instructor's origin + the freshly-generated sessionId. Falls back
    // to the canonical training PWA URL so a stray dev-origin payload
    // still produces a usable link on the calendar tile.
    const registrationUrl =
      payload.sessionType === 'Lecture'
        ? `${(payload.appBaseUrl || 'https://training.wallercountyems.com').replace(/\/$/, '')}/register?sessionId=${sessionId}`
        : payload.registrationUrl ?? ''

    let wixEventId: string | null = null
    let wixServiceId: string | null = null
    let wixScheduleId: string | null = null
    let wixServiceName: string | null = null

    if (payload.sessionType === 'CardClass' && payload.adopt?.wixEventId) {
      // Adopting a Wix-scheduled class: the event already exists on Wix
      // (sign-ups happen there as usual) — just link it so check-in,
      // rosters, and evals run through the portal. Refuse duplicates.
      const { data: dupe } = await admin
        .from('course_sessions')
        .select('id')
        .eq('wix_event_id', payload.adopt.wixEventId)
        .maybeSingle()
      if (dupe) {
        return json({ error: 'That Wix class is already managed here.' }, 409)
      }
      wixEventId = payload.adopt.wixEventId
      wixServiceId = payload.adopt.wixServiceId ?? null
      wixScheduleId = payload.adopt.wixScheduleId ?? null
      wixServiceName = payload.adopt.wixServiceName ?? payload.cardCourseName ?? null
    } else if (payload.sessionType === 'CardClass') {
      if (!payload.cardCourseName) {
        return json({ error: 'Please select a Card Course.' }, 400)
      }
      const { data: course, error: courseErr } = await admin
        .from('training_courses')
        .select('name, wix_service_id, wix_schedule_id')
        .eq('name', payload.cardCourseName)
        .maybeSingle()
      if (courseErr || !course) {
        return json(
          { error: `No course mapping found for ${payload.cardCourseName}` },
          400,
        )
      }
      if (course.wix_service_id && course.wix_schedule_id) {
        const wixToken = env.get('WIX_API_TOKEN')
        const wixSiteId = env.get('WIX_SITE_ID')
        if (!wixToken || !wixSiteId) {
          return json(
            { error: 'Wix credentials are not configured on the server.' },
            500,
          )
        }
        wixEventId = await createWixEvent(
          payload,
          {
            wix_service_id: course.wix_service_id,
            wix_schedule_id: course.wix_schedule_id,
            name: course.name,
          },
          wixToken,
          wixSiteId,
        )
        wixServiceId = course.wix_service_id
        wixScheduleId = course.wix_schedule_id
        wixServiceName = course.name
      }
    }

    const { data: insertedRow, error: insErr } = await admin
      .from('course_sessions')
      .insert({
      session_id: sessionId,
      session_type: payload.sessionType,
      title: payload.title ?? '',
      class_date: payload.classDate || null,
      start_time: payload.startTime ?? '',
      end_time: payload.endTime ?? '',
      location: payload.location ?? '',
      card_course_name: payload.cardCourseName ?? '',
      lecture_title: payload.lectureTitle ?? '',
      dshs_content_area: payload.dshsContentArea ?? '',
      hours_awarded: payload.hoursAwarded ?? '',
      max_seats: payload.maxSeats ?? null,
      verification_points_required: payload.verificationPointsRequired ?? null,
      primary_instructor_name: payload.primaryInstructorName ?? '',
      primary_instructor_email: payload.primaryInstructorEmail ?? '',
      primary_instructor_number: payload.primaryInstructorNumber ?? '',
      primary_instructor_card_exp: payload.primaryInstructorCardExp ?? '',
      secondary_instructor_name: payload.secondaryInstructorName ?? '',
      secondary_instructor_email: payload.secondaryInstructorEmail ?? '',
      secondary_instructor_number: payload.secondaryInstructorNumber ?? '',
      secondary_instructor_card_exp: payload.secondaryInstructorCardExp ?? '',
      tertiary_instructor_name: payload.tertiaryInstructorName ?? '',
      tertiary_instructor_email: payload.tertiaryInstructorEmail ?? '',
      tertiary_instructor_number: payload.tertiaryInstructorNumber ?? '',
      tertiary_instructor_card_exp: payload.tertiaryInstructorCardExp ?? '',
      registration_type: payload.registrationType ?? '',
      registration_url: registrationUrl,
      status: payload.status ?? 'Active',
      require_registration: !!payload.requireRegistration,
      check_in_status: 'Closed',
      eval_status: 'Closed',
      check_in_token: checkInToken,
      eval_token: evalToken,
      quiz_token: quizToken,
      wix_event_id: wixEventId,
      wix_service_id: wixServiceId,
      wix_schedule_id: wixScheduleId,
      wix_service_name: wixServiceName,
      virtual_enabled: !!payload.virtualEnabled,
      teams_meeting_url: payload.teamsMeetingUrl ?? null,
      created_by: appUserRow?.id ?? null,
    })
      .select('id')
      .single()
    if (insErr) {
      return json({ error: `Failed to save session: ${insErr.message}` }, 500)
    }

    // ── Lectures: publish to the intranet calendar ───────────────────────
    // The intranet's "Upcoming Training" widget reads from
    // public.training_sessions. Card classes already flow in via the
    // Wix → training_sessions sync edge function; lectures need to be
    // written explicitly. A trigger keeps remaining_capacity in sync as
    // students register.
    if (payload.sessionType === 'Lecture' && insertedRow?.id) {
      const totalCap =
        payload.maxSeats && payload.maxSeats > 0 ? payload.maxSeats : 0
      const localStart = buildLocalDateTime(
        payload.classDate,
        payload.startTime || '00:00',
      )
      const locationLabel =
        payload.virtualEnabled
          ? payload.location
            ? `${payload.location} + Teams`
            : 'Microsoft Teams'
          : payload.location || ''
      const calendarTitle =
        payload.lectureTitle || payload.title || 'CE Lecture'

      const { error: tsErr } = await admin.from('training_sessions').insert({
        service_id: null,
        title: calendarTitle,
        local_start: localStart,
        total_capacity: totalCap,
        remaining_capacity: totalCap,
        location: locationLabel,
        instructor: payload.primaryInstructorName ?? '',
        source: 'lecture',
        registration_url: registrationUrl,
        lecture_session_id: insertedRow.id,
      })
      if (tsErr) {
        // Non-fatal: the session row is saved. Surface as a warning
        // so the instructor knows the calendar tile won't appear.
        return json({
          success: true,
          sessionId,
          checkInToken,
          evalToken,
          quizToken,
          wixEventId,
          calendarWarning: tsErr.message,
        })
      }
    }

    return json({
      success: true,
      sessionId,
      checkInToken,
      evalToken,
      quizToken,
      wixEventId,
    })
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Create session failed.' },
      500,
    )
  }
})
