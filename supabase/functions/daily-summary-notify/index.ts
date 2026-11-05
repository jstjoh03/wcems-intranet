// supabase/functions/daily-summary-notify/index.ts
//
// Emails a submitted Supervisor Daily Summary (letterhead PDF attached)
// to every active supervisor — parity with the retired Jotform's
// on-submit email. Called by the portal right after submit with the
// submitter's JWT; the caller must be command staff (supervisor/admin).
// Sender: office@wallercountyems.com via Graph app-only Mail.Send.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const SENDER = 'office@wallercountyems.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST',
}

async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.get('GRAPH_CLIENT_ID')!,
    client_secret: env.get('GRAPH_CLIENT_SECRET')!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${env.get('GRAPH_TENANT_ID')}/oauth2/v2.0/token`,
    { method: 'POST', body },
  )
  const data = await res.json()
  if (!data.access_token) throw new Error(`graph token: ${JSON.stringify(data)}`)
  return data.access_token
}

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(out)
}

const SIDE_LABEL: Record<string, string> = {
  north: 'North (S201)',
  south: 'South (S202)',
  all: 'County-wide',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  /* Caller must be signed-in command staff. */
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401)
  const { data: who } = await supabase.auth.getUser(jwt)
  if (!who.user) return json({ ok: false, error: 'unauthorized' }, 401)
  const { data: caller } = await supabase
    .from('app_users')
    .select('id, full_name, role, active')
    .eq('auth_user_id', who.user.id)
    .maybeSingle()
  if (!caller?.active || !['supervisor', 'admin'].includes(caller.role)) {
    return json({ ok: false, error: 'command staff only' }, 403)
  }

  let summaryId = ''
  try {
    summaryId = String((await req.json())?.summaryId ?? '')
  } catch (_) { /* fall through */ }
  if (!summaryId) return json({ ok: false, error: 'summaryId required' }, 400)

  const { data: s, error: sErr } = await supabase
    .from('sup_daily_summaries')
    .select('id, shift_date, side, shift_letter, status, pdf_path, data')
    .eq('id', summaryId)
    .maybeSingle()
  if (sErr) return json({ ok: false, error: sErr.message }, 500)
  if (!s || s.status !== 'submitted' || !s.pdf_path) {
    return json({ ok: false, error: 'summary not submitted or missing its PDF' }, 400)
  }

  const dl = await supabase.storage.from('daily-summaries').download(s.pdf_path)
  if (dl.error || !dl.data) return json({ ok: false, error: `pdf download: ${dl.error?.message}` }, 500)
  const pdfB64 = b64(await dl.data.arrayBuffer())

  /* Recipients: every active supervisor (Jotform parity). */
  const { data: sups, error: rErr } = await supabase
    .from('app_users')
    .select('full_name, email')
    .eq('role', 'supervisor')
    .eq('active', true)
    .eq('account_type', 'person')
  if (rErr) return json({ ok: false, error: rErr.message }, 500)
  const recipients = (sups ?? []).filter((r) => !!r.email)
  if (!recipients.length) return json({ ok: false, error: 'no supervisor emails found' }, 500)

  const dateStr = new Date(`${s.shift_date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
  const sideLabel = SIDE_LABEL[s.side] ?? s.side
  const supNames = ((s.data?.supervisors ?? []) as Array<{ name?: string }>)
    .map((x) => x.name)
    .filter(Boolean)
    .join(', ')
  const subject = `Supervisor Daily Summary — ${sideLabel} — ${dateStr}${s.shift_letter ? ` (${s.shift_letter} Shift)` : ''}`
  const html =
    `<p>The ${sideLabel} Daily Summary for <b>${dateStr}</b> has been submitted` +
    (supNames ? ` by ${supNames}` : '') +
    `.</p><p>The full report is attached. The searchable archive is in the portal under ` +
    `<a href="https://employee.wallercountyems.com/command/summaries">Command &rsaquo; Archive</a>.</p>`

  const tok = await graphToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients.map((r) => ({ emailAddress: { address: r.email } })),
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: `Daily_Summary_${s.shift_date}_${s.side}.pdf`,
            contentType: 'application/pdf',
            contentBytes: pdfB64,
          },
        ],
      },
      saveToSentItems: true,
    }),
  })
  if (res.status !== 202) {
    return json({ ok: false, error: `graph sendMail ${res.status}: ${await res.text()}` }, 500)
  }

  return json({ ok: true, sent: recipients.length })
})
