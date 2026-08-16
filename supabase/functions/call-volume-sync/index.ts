// supabase/functions/call-volume-sync/index.ts
//
// Call-volume automation: Rhonda emails a monthly "<Month> Call Volume"
// report (PDF attachment, e.g. Jul26Run.pdf) that Outlook files into
// Justin's "Call Volume" folder. This function reads that folder via
// Graph app-only, parses the newest unprocessed PDFs, and upserts the
// intranet's call_volume_summaries / _units / _zones tables — the same
// shape the admin Manage Call Volume screen writes.
//
// Parser validated against Feb–Jun 2026 reports: per-unit and per-zone
// sums reconcile exactly to the report's total-call figure each month.
// A mismatch is reported as a warning but still ingested.
//
// Idempotency: processed messages are recorded in call_volume_ingest
// by internet_message_id. A NEW email for the same month (corrected
// report) re-ingests and replaces that month's rows.
//
// Auth: header `x-sync-secret: $ROSTER_SYNC_SECRET` (cron), or a
// signed-in ADMIN's JWT (the Manage Call Volume "Sync from email"
// button). POST {} = dry run; POST {"apply":true} = ingest.
//
// Requires: Mail.Read APPLICATION permission w/ admin consent on the
// WCEMS Lifecycle Automation app reg (LIFECYCLE_CLIENT_ID/SECRET).

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-expect-error resolved by Edge Runtime
import { extractText, getDocumentProxy } from 'npm:unpdf'

// @ts-expect-error Deno global
const env = Deno.env

const MAILBOX = 'justin.stjohn@wallercountyems.com'
const FOLDER = 'Call Volume'
const LOOKBACK = 6 // newest N messages considered per run

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST',
}

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
  if (!res.ok) throw new Error(`Graph token ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).access_token
}

async function g(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph ${res.status} on ${url.split('?')[0]}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

/** The folder may sit at the mailbox top level or under Inbox. */
async function findFolder(token: string): Promise<string> {
  const base = `https://graph.microsoft.com/v1.0/users/${MAILBOX}`
  const enc = FOLDER.replace(/'/g, "''")
  const top = await g(token, `${base}/mailFolders?$filter=displayName eq '${enc}'`)
  if (top.value?.length) return top.value[0].id
  const sub = await g(token, `${base}/mailFolders/inbox/childFolders?$filter=displayName eq '${enc}'`)
  if (sub.value?.length) return sub.value[0].id
  throw new Error(`Mail folder "${FOLDER}" not found in ${MAILBOX}`)
}

/* ── PDF parsing (prototype-validated against Feb–Jun 2026) ────────── */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

interface Parsed {
  month: string
  summary: {
    totalCalls: number
    avgResponseSeconds: number
    callsInDistrict: number
    callsOutOfDistrict: number
    patients: number
    transported: number
    uhu: number
    airTransports: number
  }
  units: Array<{ name: string; runs: number; avgSeconds: number }>
  zones: Array<{ name: string; calls: number }>
  warnings: string[]
}

function parseReport(pageText: string): Parsed {
  const clean = pageText.replace(/\s+/g, ' ')
  const num = (re: RegExp) => {
    const m = clean.match(re)
    return m ? Number(m[1].replace(/,/g, '')) : null
  }
  const mmss = (v: string | undefined | null) => {
    if (!v) return 0
    const [m, s] = v.split(':').map(Number)
    return m * 60 + (s || 0)
  }

  const monthMatch = clean.match(new RegExp(`(${MONTHS.join('|')})\\s+(20\\d\\d)`, 'i'))
  if (!monthMatch) throw new Error('no "<Month> <Year>" header found in PDF')
  const month = `${monthMatch[2]}-${String(MONTHS.indexOf(monthMatch[1].toLowerCase()) + 1).padStart(2, '0')}-01`

  const totalCalls = num(/Total # of Incidents\s+([\d,]+)/i)
  if (totalCalls === null) throw new Error('no "Total # of Incidents" found')

  const summary = {
    totalCalls,
    avgResponseSeconds: mmss((clean.match(/Average response time\s+(\d+:\d+)/i) ?? [])[1]),
    callsInDistrict: num(/# Calls in District\s+([\d,]+)/i) ?? 0,
    callsOutOfDistrict: num(/# Calls out of District\s+([\d,]+)/i) ?? 0,
    patients: num(/# of Patients\s+([\d,]+)/i) ?? 0,
    transported: num(/# of Patients Transported\s+([\d,]+)/i) ?? 0,
    uhu: Number((clean.match(/UHU.{0,80}?(\d?\.\d{2,3})/i) ?? [])[1] ?? 0),
    airTransports: num(/Air Transports\/LZ\s+([\d,]+)/i) ?? 0,
  }

  const units: Parsed['units'] = []
  const unitRe = /(Medic \d+|Supervisor|Community Paramedic)\s+([\d,]+)\s+[\d.]+%(?:\s+(\d+:\d+))?/g
  for (const m of clean.matchAll(unitRe)) {
    units.push({ name: m[1], runs: Number(m[2].replace(/,/g, '')), avgSeconds: mmss(m[3]) })
  }

  /* Whitelisted names so the left-column mutual-aid notes can't bleed
     into zone rows. */
  const zoneSection = clean.split(/# of calls by Scene Zone/i)[1] ?? ''
  const zones: Parsed['zones'] = []
  const zoneRe = /(City of [A-Z][A-Za-z ]*?|Dist \d+|Daikin|PVAMU|Out of District|Posting Assignment)\s+([\d,]+)\s+[\d.]+%/g
  for (const m of zoneSection.matchAll(zoneRe)) {
    zones.push({ name: m[1].trim(), calls: Number(m[2].replace(/,/g, '')) })
  }

  const warnings: string[] = []
  const unitSum = units.reduce((a, u) => a + u.runs, 0)
  const zoneSum = zones.reduce((a, z) => a + z.calls, 0)
  if (unitSum !== totalCalls) warnings.push(`unit runs sum ${unitSum} ≠ total calls ${totalCalls}`)
  if (zoneSum !== totalCalls) warnings.push(`zone calls sum ${zoneSum} ≠ total calls ${totalCalls}`)
  if (units.length < 8) warnings.push(`only ${units.length} unit rows parsed`)
  if (zones.length < 12) warnings.push(`only ${zones.length} zone rows parsed`)
  return { month, summary, units, zones, warnings }
}

/* ── HTTP ──────────────────────────────────────────────────────────── */

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  /* Cron path: shared secret. Admin path: portal JWT + role check. */
  const secret = env.get('ROSTER_SYNC_SECRET')
  let authorized = !!secret && req.headers.get('x-sync-secret') === secret
  if (!authorized) {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (jwt) {
      const { data } = await supabase.auth.getUser(jwt)
      if (data.user) {
        const { data: row } = await supabase
          .from('app_users')
          .select('role, active')
          .eq('auth_user_id', data.user.id)
          .maybeSingle()
        authorized = row?.role === 'admin' && row?.active === true
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }

  let apply = false
  try {
    apply = (await req.json())?.apply === true
  } catch (_) { /* empty body = dry run */ }

  try {
    const token = await graphToken()
    const folderId = await findFolder(token)
    const msgs = await g(
      token,
      `https://graph.microsoft.com/v1.0/users/${MAILBOX}/mailFolders/${folderId}/messages` +
        `?$top=${LOOKBACK}&$orderby=receivedDateTime desc` +
        `&$select=id,subject,receivedDateTime,internetMessageId,hasAttachments`,
    )

    const { data: logRows, error: logErr } = await supabase
      .from('call_volume_ingest')
      .select('internet_message_id')
    if (logErr) throw new Error(`ingest log: ${logErr.message}`)
    const done = new Set((logRows ?? []).map((r) => r.internet_message_id))

    const processed: Array<Record<string, unknown>> = []
    const skipped: Array<Record<string, unknown>> = []

    for (const msg of msgs.value ?? []) {
      if (done.has(msg.internetMessageId)) {
        skipped.push({ subject: msg.subject, reason: 'already ingested' })
        continue
      }
      if (!msg.hasAttachments) {
        skipped.push({ subject: msg.subject, reason: 'no attachments' })
        continue
      }
      const atts = await g(
        token,
        `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages/${msg.id}/attachments`,
      )
      const pdf = (atts.value ?? []).find(
        (a: any) => a.contentType === 'application/pdf' && a.contentBytes,
      )
      if (!pdf) {
        skipped.push({ subject: msg.subject, reason: 'no PDF attachment' })
        continue
      }

      const bytes = Uint8Array.from(atob(pdf.contentBytes), (c) => c.charCodeAt(0))
      const doc = await getDocumentProxy(bytes)
      const { text } = await extractText(doc, { mergePages: false })
      const page1 = Array.isArray(text) ? text[0] : text
      const parsed = parseReport(page1)

      if (apply) {
        const { error: sumErr } = await supabase.from('call_volume_summaries').upsert({
          report_month: parsed.month,
          total_calls: parsed.summary.totalCalls,
          total_patients: parsed.summary.patients,
          total_transports: parsed.summary.transported,
          avg_response_seconds: parsed.summary.avgResponseSeconds,
          calls_in_district: parsed.summary.callsInDistrict,
          calls_out_of_district: parsed.summary.callsOutOfDistrict,
          unit_hour_utilization: parsed.summary.uhu,
          air_transports: parsed.summary.airTransports,
        })
        if (sumErr) throw new Error(`summary ${parsed.month}: ${sumErr.message}`)

        await supabase.from('call_volume_units').delete().eq('report_month', parsed.month)
        const { error: unitErr } = await supabase.from('call_volume_units').insert(
          parsed.units.map((u) => ({
            report_month: parsed.month,
            unit_name: u.name,
            runs: u.runs,
            avg_response_seconds: u.avgSeconds,
          })),
        )
        if (unitErr) throw new Error(`units ${parsed.month}: ${unitErr.message}`)

        await supabase.from('call_volume_zones').delete().eq('report_month', parsed.month)
        const { error: zoneErr } = await supabase.from('call_volume_zones').insert(
          parsed.zones.map((z) => ({
            report_month: parsed.month,
            zone_name: z.name,
            calls: z.calls,
          })),
        )
        if (zoneErr) throw new Error(`zones ${parsed.month}: ${zoneErr.message}`)

        const { error: markErr } = await supabase.from('call_volume_ingest').insert({
          internet_message_id: msg.internetMessageId,
          report_month: parsed.month,
          subject: msg.subject,
          attachment_name: pdf.name,
          warnings: parsed.warnings.length ? parsed.warnings.join('; ') : null,
        })
        if (markErr) throw new Error(`ingest mark: ${markErr.message}`)
      }

      processed.push({
        subject: msg.subject,
        attachment: pdf.name,
        month: parsed.month,
        totalCalls: parsed.summary.totalCalls,
        units: parsed.units.length,
        zones: parsed.zones.length,
        warnings: parsed.warnings,
      })
    }

    return new Response(
      JSON.stringify({ ok: true, applied: apply, processed, skipped }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
