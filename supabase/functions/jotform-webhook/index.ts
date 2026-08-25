// supabase/functions/jotform-webhook/index.ts
//
// Jotform → portal bridge for the legacy-track "FTEP - Call Evaluation"
// form. Jotform POSTs each submission here (webhook configured in the
// form's Settings → Integrations → Webhooks); we match the employee and
// evaluator to app_users and file a submitted ICR row exactly like the
// manual "Record call evaluation" flow (payload.legacyManual, counts
// toward the 10). Anything that can't be auto-filed lands in
// jotform_inbox with the reason, surfaced to clinical editors in the
// Submissions view — nothing is silently dropped.
//
// Auth: Jotform can't send headers, so the webhook URL carries
// ?secret=<ROSTER_SYNC_SECRET>. Idempotent per Jotform submissionID.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

/* Same nickname→legal alias map as cert-import/roster-sync. */
const ALIASES: Record<string, string> = {
  'joe diaz': 'jose diaz',
  'maddie white': 'madison white',
  'trae ivy': 'travarious ivy',
  'ron thibodeaux': 'ronald thibodeaux',
  'aletha kankel-howell': 'aletha howell',
  'darry-davis luther': 'darry luther',
  'edward delany': 'ed delany',
  'joshua webb': 'josh webb',
  'leo gammon': 'trae gammon',
  'mary shannon mcconaty': 'mary mcconaty',
  'timothy friedel': 'tim friedel',
  'tzee kwang perry tong': 'perry tong',
}
const SUFFIX_TOKENS = new Set(['m', 'd', 'md', 'do', 'jr', 'sr', 'ii', 'iii', 'iv', 'rn', 'lp', 'np', 'pa'])

function normName(raw: string): string {
  let s = raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  const toks = s.split(' ').filter((t) => !SUFFIX_TOKENS.has(t))
  s = toks.join(' ')
  return ALIASES[s] ?? s
}

interface JotformFields {
  employeeName: string | null
  employeeEmail: string | null
  evaluatorName: string | null
  evaluatorEmail: string | null
  incident: string | null
  complaint: string | null
  level: string | null
}

/** Jotform rawRequest keys look like q4_employeesName / q7_incidentNumber
 *  — ids vary per form, so match on the sluggified label instead. */
function extractFields(raw: Record<string, unknown>): JotformFields {
  const out: JotformFields = {
    employeeName: null,
    employeeEmail: null,
    evaluatorName: null,
    evaluatorEmail: null,
    incident: null,
    complaint: null,
    level: null,
  }
  const nameOf = (v: unknown): string | null => {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const first = String(o.first ?? '').trim()
      const last = String(o.last ?? '').trim()
      const joined = `${first} ${last}`.trim()
      return joined || null
    }
    const s = String(v ?? '').trim()
    return s || null
  }
  for (const [key, value] of Object.entries(raw)) {
    const k = key.toLowerCase()
    if (k.includes('employee') && k.includes('name')) out.employeeName = nameOf(value)
    else if (k.includes('employee') && k.includes('email')) out.employeeEmail = String(value ?? '').trim().toLowerCase() || null
    else if (k.includes('evaluator') && k.includes('name')) out.evaluatorName = nameOf(value)
    else if (k.includes('evaluator') && k.includes('email')) out.evaluatorEmail = String(value ?? '').trim().toLowerCase() || null
    else if (k.includes('incident')) out.incident = String(value ?? '').trim() || null
    else if (k.includes('complaint')) out.complaint = String(value ?? '').trim() || null
    else if (k.includes('levelof') || (k.includes('level') && k.includes('evaluation'))) out.level = String(value ?? '').trim() || null
  }
  return out
}

interface AppUser {
  id: string
  full_name: string
  email: string | null
}

function matchUser(users: AppUser[], email: string | null, name: string | null): AppUser | null {
  if (email) {
    const byEmail = users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (byEmail) return byEmail
  }
  if (name) {
    const norm = normName(name)
    const byName = users.find((u) => normName(u.full_name) === norm)
    if (byName) return byName
  }
  return null
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405 })
  }
  const url = new URL(req.url)
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || url.searchParams.get('secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  /* Jotform sends multipart/form-data with rawRequest (JSON string),
     formTitle, and submissionID. */
  let submissionId = ''
  let formTitle = ''
  let raw: Record<string, unknown> = {}
  try {
    const form = await req.formData()
    submissionId = String(form.get('submissionID') ?? '')
    formTitle = String(form.get('formTitle') ?? '')
    const rawRequest = form.get('rawRequest')
    if (typeof rawRequest === 'string' && rawRequest.trim()) {
      raw = JSON.parse(rawRequest)
    } else {
      /* Some configurations send the fields flat. */
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') raw[k] = v
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `Parse failed: ${(e as Error).message}` }), { status: 400 })
  }

  const fields = extractFields(raw)

  const park = async (reason: string) => {
    await supabase.from('jotform_inbox').upsert(
      {
        submission_id: submissionId || null,
        form_title: formTitle || null,
        employee_name: fields.employeeName,
        evaluator_name: fields.evaluatorName,
        reason,
        raw,
      },
      { onConflict: 'submission_id', ignoreDuplicates: true },
    )
    return new Response(JSON.stringify({ ok: true, parked: reason }), { status: 200 })
  }

  /* Idempotency: one ICR per Jotform submission. */
  if (submissionId) {
    const { data: existing } = await supabase
      .from('ftep_reports')
      .select('id')
      .eq('payload->>jotformId', submissionId)
      .limit(1)
    if (existing?.length) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 })
    }
  }

  const { data: usersData, error: usersErr } = await supabase
    .from('app_users')
    .select('id, full_name, email')
    .eq('account_type', 'person')
    .eq('active', true)
  if (usersErr) return park(`Roster lookup failed: ${usersErr.message}`)
  const users = (usersData ?? []) as AppUser[]

  const employee = matchUser(users, fields.employeeEmail, fields.employeeName)
  if (!employee) return park(`Employee not matched: "${fields.employeeName ?? fields.employeeEmail ?? '?'}"`)

  const evaluator = matchUser(users, fields.evaluatorEmail, fields.evaluatorName)
  if (!evaluator) return park(`Evaluator not matched: "${fields.evaluatorName ?? fields.evaluatorEmail ?? '?'}"`)

  /* Only the legacy track runs call evals through Jotform — anything
     else is parked for clinical review rather than silently counted. */
  const { data: rec } = await supabase
    .from('pipeline_records')
    .select('legacy_track, working_phase')
    .eq('user_id', employee.id)
    .maybeSingle()
  if (!rec?.legacy_track) {
    return park(`${employee.full_name} is not on the legacy track — review before counting`)
  }

  const noteBits = [
    `Jotform #${submissionId || 'n/a'}`,
    fields.incident ? `incident ${fields.incident}` : null,
    fields.complaint ?? null,
    fields.level ? `level: ${fields.level}` : null,
  ].filter(Boolean)

  const { error: insErr } = await supabase.from('ftep_reports').insert({
    kind: 'icr',
    trainee_id: employee.id,
    evaluator_id: evaluator.id,
    status: 'submitted',
    eval_date: new Date().toISOString().slice(0, 10),
    submitted_at: new Date().toISOString(),
    payload: {
      countsToward10: true,
      legacyManual: true,
      jotformId: submissionId || undefined,
      note: noteBits.join(' · '),
    },
  })
  if (insErr) return park(`Insert failed: ${insErr.message}`)

  return new Response(JSON.stringify({ ok: true, filed: employee.full_name }), { status: 200 })
})
