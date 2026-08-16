// supabase/functions/roster-sync/index.ts
//
// Roster fan-out: reads the WCEMS Roster SharePoint List (AdminStaff site)
// via Microsoft Graph app-only auth and syncs employee identity into:
//   1. app_users in THIS project (intranet + training apps)
//   2. employees in the wcems-uniforms Supabase project (via its REST API)
//
// People are ENTERED once — on HR's Master Roster, which feeds the List.
// This function makes every app match the List, ending per-app entry.
//
// Sync semantics (deliberately conservative):
//   - Match on normalized full name (List "Last, First" vs app "First Last").
//     The List holds personal emails; apps hold work emails, so name is the
//     only shared key. Aliases below patch known spelling differences.
//   - Matched rows: update employment_type; fuel # and DOB fill in only
//     when the app value is blank. Shift/station/role are OWNED BY THE
//     APPS (edited live in-app) and never overwritten.
//   - List row with no app match (Category ≠ BOD): INSERT with constructed
//     work email first.last@wallercountyems.com, role 'crew', active.
//   - Active person account with no List row: DEACTIVATE (they left WCEMS).
//   - Never touches kiosk accounts, is_admin, allowances, or photos.
//
// Modes: every call requires header `x-sync-secret: $ROSTER_SYNC_SECRET`.
//   POST {}                → DRY RUN: returns the full plan, changes nothing.
//   POST {"apply": true}   → executes the plan.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET  (already set
//     for sync-wix-training; the app reg additionally needs the
//     Sites.Read.All APPLICATION permission with admin consent)
//   ROSTER_SYNC_SECRET     — shared secret gating this endpoint
//   UNIFORMS_URL           — https://pjvsrhsykghsffhtntjk.supabase.co
//   UNIFORMS_SERVICE_KEY   — service_role key of the uniforms project
//     (uniforms leg is skipped with a warning if these two are absent)
//
// Scheduled hourly via pg_cron + pg_net once consent + secrets are in.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const SP_HOST = 'wcvems.sharepoint.com'
const SP_SITE_PATH = '/sites/AdminStaff'
const LIST_NAME = 'WCEMS Roster'
const WORK_DOMAIN = 'wallercountyems.com'

/* Known name differences between HR's sheet (the List) and app records.
   Keys/values are normalized ("first last", lowercase). */
const ALIASES: Record<string, string> = {
  'joe diaz': 'jose diaz',
  'maddie white': 'madison white',
  'trae ivy': 'travarious ivy',
  'ron thibodeaux': 'ronald thibodeaux',
}

/* Credential/name suffix tokens stripped during normalization so
   "Buzzard, Aaron M.D." matches "Aaron Buzzard". */
const SUFFIX_TOKENS = new Set(['m', 'd', 'md', 'do', 'jr', 'sr', 'ii', 'iii', 'iv', 'rn', 'lp', 'np', 'pa'])

/* Per-leg category scopes. BOD never gets app accounts; volunteers use
   the intranet but do not order uniforms. */
const INTRANET_EXCLUDED = new Set(['BOD'])
const UNIFORMS_EXCLUDED = new Set(['BOD', 'Vol', 'Doc'])
/* Medical director's credentials aren't tracked in Clinical
   Development (Justin, 2026-08-14). */
const PIPELINE_EXCLUDED = new Set(['BOD', 'Doc'])
/* Admin staff who don't order uniforms (Justin, 2026-08-06). Normalized names. */
const UNIFORMS_SKIP_PEOPLE = new Set(['erica adams', 'tori bell'])

interface ListPerson {
  name: string
  norm: string
  category: string
  status: string
  ftpt: string | null
  certLevel: string | null
  shift: string | null
  station: string | null
  mobile: string | null
  txLicenseNumber: string | null
  txLicenseExp: string | null
  fuelNumber: string | null
  dob: string | null
}

function norm(name: string): string {
  let s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2)
    s = `${first.trim()} ${last.trim()}`
  }
  s = s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  const toks = s.split(' ').filter((t, i) => i === 0 || !SUFFIX_TOKENS.has(t))
  s = toks.join(' ')
  return ALIASES[s] ?? s
}

/* HR's sheet says FT/PT; the apps store full_time/part_time. */
function normType(v: string | null): string | null {
  if (!v) return null
  const t = v.trim().toUpperCase()
  return t === 'FT' ? 'full_time' : t === 'PT' ? 'part_time' : v
}

function workEmail(normName: string): string {
  const toks = normName.split(' ')
  const first = toks[0]
  const last = toks.slice(1).join('')
  return `${first}.${last}@${WORK_DOMAIN}`
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
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  )
  if (!res.ok) throw new Error(`Graph token ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).access_token
}

async function gget(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph ${res.status} on ${url.split('?')[0]}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function fetchListPeople(token: string): Promise<ListPerson[]> {
  const site = await gget(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`)
  const lists = await gget(
    token,
    `https://graph.microsoft.com/v1.0/sites/${site.id}/lists?$filter=displayName eq '${LIST_NAME}'`,
  )
  if (!lists.value?.length) throw new Error(`List "${LIST_NAME}" not found on ${SP_SITE_PATH}`)
  const listId = lists.value[0].id

  /* Lists created via "From Excel" get opaque internal column names
     (field_1, field_2, …) while keeping human display names. Resolve the
     display→internal map from the columns endpoint instead of guessing —
     guessed names silently return nothing, which once let BOD members
     slip into an insert plan. */
  const colsRes = await gget(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/columns`)
  const internal: Record<string, string> = {}
  for (const c of colsRes.value ?? []) {
    if (c.readOnly) continue
    if (!(c.displayName in internal)) internal[c.displayName] = c.name
  }
  const K = (display: string) => internal[display] ?? display

  const people: ListPerson[] = []
  const pick = (f: Record<string, unknown>, display: string) => {
    const v = f[K(display)]
    return v != null && v !== '' ? String(v) : null
  }
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/items?expand=fields&$top=200`
  while (url) {
    const data = await gget(token, url)
    for (const item of data.value ?? []) {
      const f = (item.fields ?? {}) as Record<string, unknown>
      const title = pick(f, 'Title')
      if (!title) continue
      people.push({
        name: title,
        norm: norm(title),
        category: (pick(f, 'Category') ?? '').trim(),
        status: (pick(f, 'Status') ?? 'Active').trim() || 'Active',
        ftpt: pick(f, 'FTPT'),
        certLevel: pick(f, 'CertLevel'),
        shift: pick(f, 'Shift'),
        station: pick(f, 'Station'),
        mobile: pick(f, 'Mobile'),
        txLicenseNumber: pick(f, 'TXLicenseNumber'),
        txLicenseExp: pick(f, 'TXLicenseExp'),
        fuelNumber: pick(f, 'FuelNumber'),
        dob: pick(f, 'DOB'),
      })
    }
    url = data['@odata.nextLink']
  }
  return people
}

interface Plan {
  updates: Array<Record<string, unknown>>
  inserts: Array<Record<string, unknown>>
  deactivates: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
  matched: number
}

function emptyPlan(): Plan {
  return { updates: [], inserts: [], deactivates: [], skipped: [], matched: 0 }
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-sync-secret',
        'Access-Control-Allow-Methods': 'POST',
      },
    })
  }

  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let apply = false
  try {
    const body = await req.json()
    apply = body?.apply === true
  } catch (_) { /* empty body = dry run */ }

  try {
    const token = await graphToken()
    const allRows = await fetchListPeople(token)
    /* Rows without a "Last, First" comma are not people (e.g. HR's
       "Administration" shared-mailbox row) — report, never sync. */
    const people = allRows.filter((p) => p.name.includes(','))
    const nonPerson = allRows.filter((p) => !p.name.includes(','))
    /* Status = Separated (set by excel-to-list for planned exits, or by
       Justin directly for emergency terminations) means departed: excluded
       from every eligible set AND from anyoneNorms, so the apps deactivate
       them on this same pass. */
    const active = people.filter((p) => p.status !== 'Separated')
    const eligible = active.filter((p) => !INTRANET_EXCLUDED.has(p.category))
    const excluded = active.filter((p) => INTRANET_EXCLUDED.has(p.category))
    const uniEligible = active.filter((p) => !UNIFORMS_EXCLUDED.has(p.category) && !UNIFORMS_SKIP_PEOPLE.has(p.norm))
    const byNorm = new Map(eligible.map((p) => [p.norm, p]))
    const uniByNorm = new Map(uniEligible.map((p) => [p.norm, p]))
    /* Deactivation checks all ACTIVE people (BOD included): being
       category-excluded means "don't insert", not "treat as departed". */
    const anyoneNorms = new Set(active.map((p) => p.norm))

    // ── Leg 1: app_users (intranet + training) ─────────────────────────
    const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const { data: users, error: uerr } = await supabase
      .from('app_users')
      .select('id, full_name, first_name, last_name, email, active, employment_type, account_type, fuel_number, date_of_birth')
      .eq('account_type', 'person')
    if (uerr) throw new Error(`app_users: ${uerr.message}`)
    const toDob = (v: string | null) => (v ? v.slice(0, 10) : null)

    const intranet = emptyPlan()
    const seenNorms = new Set<string>()
    for (const u of users ?? []) {
      const n = norm(u.full_name ?? `${u.first_name} ${u.last_name}`)
      const match = byNorm.get(n)
      if (match) {
        seenNorms.add(n)
        intranet.matched++
        const patch: Record<string, unknown> = {}
        const t = normType(match.ftpt)
        if (t && u.employment_type !== t) patch.employment_type = t
        /* Fuel # + DOB: HR data fills gaps but never overwrites a value
           someone corrected in-app. */
        if (!u.fuel_number && match.fuelNumber) patch.fuel_number = match.fuelNumber
        if (!u.date_of_birth && match.dob) patch.date_of_birth = toDob(match.dob)
        if (Object.keys(patch).length) {
          intranet.updates.push({ id: u.id, name: u.full_name, ...patch })
        }
      } else if (u.active && !anyoneNorms.has(n)) {
        intranet.deactivates.push({ id: u.id, name: u.full_name, email: u.email })
      }
    }
    for (const p of eligible) {
      if (seenNorms.has(p.norm)) continue
      const toks = p.norm.split(' ')
      intranet.inserts.push({
        name: p.name,
        first_name: toks[0].replace(/^./, (c) => c.toUpperCase()),
        last_name: p.name.includes(',') ? p.name.split(',')[0].trim() : toks.slice(1).join(' '),
        full_name: p.name.includes(',')
          ? `${p.name.split(',')[1].trim()} ${p.name.split(',')[0].trim()}`
          : p.name,
        email: workEmail(p.norm),
        role: 'crew',
        /* app_users.employment_type is NOT NULL; HR often hasn't filled
           FT/PT for brand-new hires yet. Default full_time — the sync
           corrects it automatically once her sheet has the value. */
        employment_type: normType(p.ftpt) ?? 'full_time',
        shift: p.shift ?? null,
        station: p.station ?? null,
        phone: p.mobile ?? null,
        fuel_number: p.fuelNumber ?? null,
        date_of_birth: p.dob ? p.dob.slice(0, 10) : null,
        active: true,
        account_type: 'person',
      })
    }
    intranet.skipped = [
      ...excluded.map((p) => ({ name: p.name, category: p.category })),
      ...nonPerson.map((p) => ({ name: p.name, category: 'non-person row' })),
    ]

    if (apply) {
      for (const up of intranet.updates) {
        const { id, name, ...patch } = up
        const { error } = await supabase.from('app_users').update(patch).eq('id', id)
        if (error) throw new Error(`update ${name}: ${error.message}`)
      }
      for (const d of intranet.deactivates) {
        const { error } = await supabase.from('app_users').update({ active: false }).eq('id', d.id)
        if (error) throw new Error(`deactivate ${d.name}: ${error.message}`)
      }
      for (const ins of intranet.inserts) {
        const { name: _n, ...row } = ins
        const { error } = await supabase.from('app_users').insert(row)
        if (error) throw new Error(`insert ${ins.full_name}: ${error.message}`)
      }
    }

    // ── Leg 1b: pipeline_records cert/license identity ─────────────────
    /* The Clinical Development pipeline lives in pipeline_records. This
       leg keeps ONLY its cert/license identity columns fresh from the
       List (HR edit-once chain): cert_level, tx_license_number,
       tx_license_expires_at. Phase/gate/pending columns are portal-owned
       and NEVER touched here. Blank List values are left alone (no
       null-outs). Matched people without a record get a minimal row so
       new hires appear on the board automatically. */
    const { data: pipeRows, error: perr } = await supabase
      .from('pipeline_records')
      .select('id, user_id, cert_level, tx_license_number, tx_license_expires_at')
    if (perr) throw new Error(`pipeline_records: ${perr.message}`)
    const pipeByUser = new Map((pipeRows ?? []).map((r) => [r.user_id, r]))

    const toDate = (v: string | null) => (v ? v.slice(0, 10) : null)
    const pipeline = { updates: [] as Array<Record<string, unknown>>, inserts: [] as Array<Record<string, unknown>>, matched: 0 }
    for (const u of users ?? []) {
      const n = norm(u.full_name ?? `${u.first_name} ${u.last_name}`)
      const match = byNorm.get(n)
      if (!match || !u.active || PIPELINE_EXCLUDED.has(match.category)) continue
      pipeline.matched++
      const fresh = {
        cert_level: match.certLevel,
        tx_license_number: match.txLicenseNumber,
        tx_license_expires_at: toDate(match.txLicenseExp),
      }
      const existing = pipeByUser.get(u.id)
      if (!existing) {
        pipeline.inserts.push({ user_id: u.id, name: u.full_name, ...fresh })
        continue
      }
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fresh)) {
        if (v != null && (existing as Record<string, unknown>)[k] !== v) patch[k] = v
      }
      if (Object.keys(patch).length) {
        pipeline.updates.push({ id: existing.id, name: u.full_name, ...patch })
      }
    }

    if (apply) {
      for (const up of pipeline.updates) {
        const { id, name, ...patch } = up
        const { error } = await supabase.from('pipeline_records').update(patch).eq('id', id)
        if (error) throw new Error(`pipeline update ${name}: ${error.message}`)
      }
      for (const ins of pipeline.inserts) {
        const { name: _n, ...row } = ins
        const { error } = await supabase.from('pipeline_records').insert(row)
        if (error) throw new Error(`pipeline insert ${_n}: ${error.message}`)
      }
    }

    // ── Leg 2: uniforms employees ──────────────────────────────────────
    const uniUrl = env.get('UNIFORMS_URL')
    const uniKey = env.get('UNIFORMS_SERVICE_KEY')
    let uniforms: Plan | { skippedReason: string } = { skippedReason: 'UNIFORMS_URL / UNIFORMS_SERVICE_KEY not set' }
    if (uniUrl && uniKey) {
      const uni = createClient(uniUrl, uniKey, { auth: { persistSession: false } })
      const { data: emps, error: eerr } = await uni
        .from('employees')
        .select('id, name, email, employee_type, active')
      if (eerr) throw new Error(`uniforms employees: ${eerr.message}`)

      const plan = emptyPlan()
      const uniSeen = new Set<string>()
      for (const e of emps ?? []) {
        const n = norm(e.name ?? '')
        const match = uniByNorm.get(n)
        if (match) {
          uniSeen.add(n)
          plan.matched++
          const t = normType(match.ftpt)
          if (t && e.employee_type !== t) {
            plan.updates.push({ id: e.id, name: e.name, employee_type: t, was: e.employee_type })
          }
        } else if (e.active && !anyoneNorms.has(n)) {
          plan.deactivates.push({ id: e.id, name: e.name, email: e.email })
        }
      }
      for (const p of uniEligible) {
        if (uniSeen.has(p.norm)) continue
        const display = p.name.includes(',')
          ? `${p.name.split(',')[1].trim()} ${p.name.split(',')[0].trim()}`
          : p.name
        plan.inserts.push({ name: display, email: workEmail(p.norm), employee_type: normType(p.ftpt) ?? 'full_time', active: true })
      }

      if (apply) {
        for (const up of plan.updates) {
          const { error } = await uni.from('employees').update({ employee_type: up.employee_type }).eq('id', up.id)
          if (error) throw new Error(`uniforms update ${up.name}: ${error.message}`)
        }
        for (const d of plan.deactivates) {
          const { error } = await uni.from('employees').update({ active: false }).eq('id', d.id)
          if (error) throw new Error(`uniforms deactivate ${d.name}: ${error.message}`)
        }
        if (plan.inserts.length) {
          const { error } = await uni.from('employees').insert(plan.inserts.map(({ ...r }) => r))
          if (error) throw new Error(`uniforms inserts: ${error.message}`)
        }
      }
      uniforms = plan
    }

    return new Response(
      JSON.stringify({ ok: true, applied: apply, listCount: people.length, intranet, pipeline, uniforms }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
