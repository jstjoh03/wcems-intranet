// jotform-kudos — Kudos-submission Jotform → portal bridge.
//
// Paste the webhook URL (with ?secret=) into the kudos form's
// Settings → Integrations → Webhooks. Every submission is:
//   1. stored in kudos_submissions (idempotent per Jotform
//      submissionID — a webhook retry never double-notifies), and
//   2. emailed to the CDO from office@ with the answers laid out.
//
// Form-agnostic: whatever fields the form carries are prettified from
// the webhook's rawRequest (q3_someName → "Some Name"), so the form
// can be edited in Jotform without touching this function.
//
// Auth: Jotform can't send headers, so the URL carries
// ?secret=<ROSTER_SYNC_SECRET>.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const SENDER = 'office@wallercountyems.com'
const NOTIFY = ['justin.stjohn@wallercountyems.com']

/* The live Kudos form (261249366820056) uses generic field names —
   map them to readable labels; anything unmapped falls back to the
   generic prettifier so form edits keep working. */
const LABELS: Record<string, string> = {
  textbox1: 'Your first name',
  textbox2: 'Your last name',
  email3: 'Your email',
  textbox5: "Recipient's first name",
  textbox6: "Recipient's last name",
  email7: "Recipient's email",
  textarea8: 'Kudos',
}

function prettyLabel(key: string): string {
  const m = key.match(/^q\d+_(.+)$/)
  if (m && LABELS[m[1]]) return LABELS[m[1]]
  const base = (m ? m[1] : key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return base.charAt(0).toUpperCase() + base.slice(1)
}

function prettyValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(prettyValue).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    /* Name widgets: {first, last}; date widgets: {month, day, year}; etc. */
    if ('first' in o || 'last' in o)
      return `${String(o.first ?? '').trim()} ${String(o.last ?? '').trim()}`.trim()
    if ('month' in o && 'day' in o && 'year' in o)
      return `${o.month}/${o.day}/${o.year}`
    return Object.values(o).map(prettyValue).filter(Boolean).join(' ')
  }
  return String(v)
}

function extractFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    /* Only q<N>_<name> keys are answers; everything else is webhook
       bookkeeping (slug, tracker, submit metadata). */
    if (!/^q\d+_/.test(k)) continue
    const val = prettyValue(v)
    if (!val) continue
    out[prettyLabel(k)] = val
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function sendMail(subject: string, html: string) {
  const body = new URLSearchParams({
    client_id: env.get('LIFECYCLE_CLIENT_ID')!,
    client_secret: env.get('LIFECYCLE_CLIENT_SECRET')!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const tokRes = await fetch(
    `https://login.microsoftonline.com/${env.get('GRAPH_TENANT_ID')}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  )
  if (!tokRes.ok) throw new Error(`token ${tokRes.status}`)
  const tok = (await tokRes.json()).access_token
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: NOTIFY.map((a) => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  })
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405 })

  const url = new URL(req.url)
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || url.searchParams.get('secret') !== secret)
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 })

  let submissionId = ''
  let formId: string | null = null
  let formTitle = ''
  let raw: Record<string, unknown> = {}
  try {
    const form = await req.formData()
    submissionId = String(form.get('submissionID') ?? '')
    formTitle = String(form.get('formTitle') ?? '')
    formId = String(form.get('formID') ?? '') || null
    const rawRequest = form.get('rawRequest')
    if (typeof rawRequest === 'string' && rawRequest.trim()) {
      raw = JSON.parse(rawRequest)
    } else {
      for (const [k, v] of form.entries()) if (typeof v === 'string') raw[k] = v
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `Parse failed: ${(e as Error).message}` }), { status: 400 })
  }

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const fields = extractFields(raw)

  /* Idempotent per submission — a Jotform retry inserts nothing and
     sends no second email. */
  const { data: inserted, error } = await supabase
    .from('kudos_submissions')
    .insert({
      jotform_id: submissionId || null,
      form_id: formId,
      form_title: formTitle || null,
      fields,
      raw,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23505')
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 })
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }

  const rows = Object.entries(fields)
    .map(
      ([label, value]) => `<tr>
      <td style="padding:7px 16px 7px 0;border-bottom:1px solid #e6e2d8;color:#5a5f6b;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #e6e2d8;color:#182644;">${esc(value).replace(/\n/g, '<br/>')}</td>
    </tr>`,
    )
    .join('')
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#273142;max-width:600px;">
    <div style="border-bottom:3px solid #182644;padding-bottom:10px;margin-bottom:16px;">
      <div style="font-size:17px;font-weight:700;color:#182644;letter-spacing:0.04em;">WALLER COUNTY EMS</div>
      <div style="font-size:11px;letter-spacing:0.14em;color:#a8842c;font-weight:600;">KUDOS SUBMISSION</div>
    </div>
    <p>A new kudos submission just came in${formTitle ? ` on <b>${esc(formTitle)}</b>` : ''}:</p>
    <table style="border-collapse:collapse;width:100%;margin:6px 0 14px;">${rows || '<tr><td>No answer fields were parsed — see the stored raw payload.</td></tr>'}</table>
    <p style="font-size:12px;color:#8a8f99;">Stored in the portal (kudos_submissions${inserted ? ` · ${inserted.id}` : ''}) for the record.</p>
  </div>`
  const recipient = `${fields["Recipient's first name"] ?? ''} ${fields["Recipient's last name"] ?? ''}`.trim()
  const sender = `${fields['Your first name'] ?? ''} ${fields['Your last name'] ?? ''}`.trim()
  const subject = recipient
    ? `Kudos for ${recipient}${sender ? ` — from ${sender}` : ''}`
    : 'Kudos submission received'
  let emailed = true
  try {
    await sendMail(subject, html)
  } catch {
    emailed = false
  }

  return new Response(JSON.stringify({ ok: true, stored: true, emailed, fields: Object.keys(fields).length }), { status: 200 })
})
