// supabase/functions/jotform-webhook/index.ts
//
// Jotform → portal bridge for the "FTEP - Call Evaluation" form.
// v3 (Justin, 2026-08-25):
//   • NOTHING auto-files — every submission lands in jotform_inbox as
//     'pending' (employee/evaluator pre-matched) for the clinical
//     editors' review queue in the Submissions view.
//   • With a Jotform API key (?apikey= on the webhook URL, or the
//     JOTFORM_API_KEY function secret), the submission's actual PDF —
//     evaluator + employee signatures included — is pulled into the
//     private jotform-pdfs bucket and linked on the queue row.
//   • ?backfill=1&apikey=... pulls EVERY historical submission for the
//     form (found by title, or pass &formid=) into the same queue,
//     PDFs included. Idempotent per submissionID — safe to re-run.
//
// Auth: Jotform can't send headers, so the URL carries
// ?secret=<ROSTER_SYNC_SECRET>.

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
}

function nameOf(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const joined = `${String(o.first ?? '').trim()} ${String(o.last ?? '').trim()}`.trim()
    return joined || null
  }
  const s = String(v ?? '').trim()
  return s || null
}

/** Keys look like q4_employeesName — ids vary, so match on the label. */
function extractFields(raw: Record<string, unknown>): JotformFields {
  const out: JotformFields = {
    employeeName: null,
    employeeEmail: null,
    evaluatorName: null,
    evaluatorEmail: null,
  }
  for (const [key, value] of Object.entries(raw)) {
    const k = key.toLowerCase()
    if (k.includes('employee') && k.includes('name')) out.employeeName = nameOf(value)
    else if (k.includes('employee') && k.includes('email')) out.employeeEmail = String(value ?? '').trim().toLowerCase() || null
    else if (k.includes('evaluator') && k.includes('name')) out.evaluatorName = nameOf(value)
    else if (k.includes('evaluator') && k.includes('email')) out.evaluatorEmail = String(value ?? '').trim().toLowerCase() || null
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

/* WCEMS's Jotform account is HIPAA-mode — API calls live on the
   hipaa-api host (the standard host answers 301). Try HIPAA first. */
const JF_BASES = ['https://hipaa-api.jotform.com', 'https://api.jotform.com']

// deno-lint-ignore no-explicit-any
async function jfJson(pathAndQuery: string, apiKey: string): Promise<any | null> {
  for (const base of JF_BASES) {
    try {
      const res = await fetch(`${base}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}apiKey=${apiKey}`)
      const body = await res.json()
      if (body?.responseCode === 200) return body
    } catch (_e) {
      /* try next base */
    }
  }
  return null
}

/** Pull the submission's signed PDF into the private bucket.
 *  generatePDF wants LOWERCASE params on the HIPAA host — the
 *  formID/submissionID casing answers 401 (found the hard way,
 *  2026-08-25). */
// deno-lint-ignore no-explicit-any
async function storePdf(supabase: any, submissionId: string, formId: string | null, apiKey: string): Promise<string | null> {
  if (!apiKey || !submissionId) return null
  const urls = JF_BASES.flatMap((base) => [
    formId ? `${base}/generatePDF?formid=${formId}&submissionid=${submissionId}&apiKey=${apiKey}` : null,
    `${base}/pdf-submission/${submissionId}?apiKey=${apiKey}`,
  ]).filter(Boolean) as string[]
  for (const u of urls) {
    try {
      const res = await fetch(u)
      if (!res.ok) continue
      const type = res.headers.get('content-type') ?? ''
      const buf = new Uint8Array(await res.arrayBuffer())
      /* Accept only real PDFs (%PDF magic) — the API answers JSON errors
         with 200 sometimes. */
      if (!type.includes('pdf') && !(buf[0] === 0x25 && buf[1] === 0x50)) continue
      const path = `${submissionId}.pdf`
      const { error } = await supabase.storage
        .from('jotform-pdfs')
        .upload(path, buf, { contentType: 'application/pdf', upsert: true })
      if (!error) return path
    } catch (_e) {
      /* try next endpoint */
    }
  }
  return null
}

/** Queue one submission (webhook or backfill). Idempotent.
 *  legacyOnly (backfill): skip submissions cleanly matched to someone
 *  NOT on the legacy track — but still queue unmatched names, since a
 *  typo'd legacy trainee must surface for manual matching, not vanish. */
// deno-lint-ignore no-explicit-any
async function queueSubmission(supabase: any, users: AppUser[], input: {
  submissionId: string
  formId: string | null
  formTitle: string
  raw: Record<string, unknown>
  evalDate: string
  apiKey: string
  legacyOnly?: boolean
}): Promise<{ queued: boolean; filtered?: boolean; duplicate?: boolean; error?: string }> {
  const fields = extractFields(input.raw)
  const employee = matchUser(users, fields.employeeEmail, fields.employeeName)
  const evaluator = matchUser(users, fields.evaluatorEmail, fields.evaluatorName)

  const notes: string[] = []
  if (!employee) notes.push(`employee not matched: "${fields.employeeName ?? fields.employeeEmail ?? '?'}"`)
  if (!evaluator) notes.push(`evaluator not matched: "${fields.evaluatorName ?? fields.evaluatorEmail ?? '?'}"`)
  let isLegacy = false
  if (employee) {
    const { data: rec } = await supabase
      .from('pipeline_records')
      .select('legacy_track')
      .eq('user_id', employee.id)
      .maybeSingle()
    isLegacy = !!rec?.legacy_track
    if (!isLegacy) notes.push('not on the legacy track')
  }

  if (input.legacyOnly && employee && !isLegacy) {
    return { queued: false, filtered: true }
  }

  /* Skip the (slow) PDF pull for rows that already exist. */
  const { data: dup } = await supabase
    .from('jotform_inbox')
    .select('id')
    .eq('submission_id', input.submissionId)
    .limit(1)
  if (dup?.length) return { queued: false, duplicate: true }

  const pdfPath = await storePdf(supabase, input.submissionId, input.formId, input.apiKey)

  const { error } = await supabase.from('jotform_inbox').upsert(
    {
      submission_id: input.submissionId || null,
      form_title: input.formTitle || null,
      employee_name: fields.employeeName,
      evaluator_name: fields.evaluatorName,
      employee_id: employee?.id ?? null,
      evaluator_id: evaluator?.id ?? null,
      eval_date: input.evalDate,
      status: 'pending',
      reason: notes.length ? notes.join(' · ') : 'matched — awaiting review',
      pdf_path: pdfPath,
      raw: input.raw,
    },
    { onConflict: 'submission_id', ignoreDuplicates: true },
  )
  return error ? { queued: false, error: error.message } : { queued: true }
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
  const apiKey = url.searchParams.get('apikey') ?? env.get('JOTFORM_API_KEY') ?? ''

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: usersData } = await supabase
    .from('app_users')
    .select('id, full_name, email')
    .eq('account_type', 'person')
    .eq('active', true)
  const users = (usersData ?? []) as AppUser[]

  /* ── Refresh PDFs: retro-attach signed PDFs for queued rows once a
     full-access key is available. ─────────────────────────────────── */
  if (url.searchParams.get('refreshpdfs') === '1') {
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'apikey required' }), { status: 400 })
    }
    const formId = url.searchParams.get('formid')
    const { data: rows } = await supabase
      .from('jotform_inbox')
      .select('id, submission_id')
      .is('pdf_path', null)
      .not('submission_id', 'is', null)
    let attached = 0
    let missing = 0
    for (const r of (rows ?? []) as { id: string; submission_id: string }[]) {
      const path = await storePdf(supabase, r.submission_id, formId, apiKey)
      if (path) {
        await supabase.from('jotform_inbox').update({ pdf_path: path }).eq('id', r.id)
        attached++
      } else missing++
    }
    return new Response(JSON.stringify({ ok: true, refreshpdfs: true, attached, missing }), { status: 200 })
  }

  /* ── Backfill: pull every historical submission via the API ──────── */
  if (url.searchParams.get('backfill') === '1') {
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: 'apikey required for backfill' }), { status: 400 })
    }
    let formId = url.searchParams.get('formid')
    if (!formId) {
      const body = await jfJson('/user/forms?limit=200', apiKey)
      const forms = (body?.content ?? []) as { id: string; title: string }[]
      const hit = forms.find((f) => f.title?.toLowerCase().includes('call evaluation'))
      if (!hit) {
        return new Response(JSON.stringify({ ok: false, error: 'Call Evaluation form not found; pass &formid=' }), { status: 404 })
      }
      formId = hit.id
    }
    const legacyOnly = url.searchParams.get('legacyonly') === '1'
    let offset = 0
    let queued = 0
    let filtered = 0
    let duplicates = 0
    let failed = 0
    const errors: string[] = []
    for (;;) {
      const body = await jfJson(`/form/${formId}/submissions?limit=100&offset=${offset}&orderby=created_at`, apiKey)
      const subs = (body?.content ?? []) as {
        id: string
        created_at: string
        answers: Record<string, { name?: string; answer?: unknown }>
      }[]
      if (!subs.length) break
      for (const s of subs) {
        /* Rebuild the webhook's rawRequest key shape from API answers. */
        const raw: Record<string, unknown> = {}
        for (const [qid, a] of Object.entries(s.answers ?? {})) {
          if (a?.answer !== undefined) raw[`q${qid}_${a.name ?? qid}`] = a.answer
        }
        const evalDate = (s.created_at ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
        const r = await queueSubmission(supabase, users, {
          submissionId: s.id,
          formId,
          formTitle: 'FTEP - Call Evaluation (backfill)',
          raw,
          evalDate,
          apiKey,
          legacyOnly,
        })
        if (r.queued) queued++
        else if (r.filtered) filtered++
        else if (r.duplicate) duplicates++
        else {
          failed++
          if (r.error) errors.push(`${s.id}: ${r.error}`)
        }
      }
      offset += subs.length
      if (subs.length < 100) break
    }
    return new Response(
      JSON.stringify({ ok: true, backfill: true, formId, legacyOnly, queued, filtered, duplicates, failed, errors: errors.slice(0, 10) }),
      { status: 200 },
    )
  }

  /* ── Live webhook: one submission per POST ───────────────────────── */
  let submissionId = ''
  let formTitle = ''
  let formId: string | null = null
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
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') raw[k] = v
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `Parse failed: ${(e as Error).message}` }), { status: 400 })
  }

  const result = await queueSubmission(supabase, users, {
    submissionId,
    formId,
    formTitle,
    raw,
    evalDate: new Date().toISOString().slice(0, 10),
    apiKey,
  })
  if (!result.queued && result.error) {
    return new Response(JSON.stringify({ ok: false, error: result.error }), { status: 500 })
  }
  return new Response(JSON.stringify({ ok: true, queued: true }), { status: 200 })
})
