// uniforms-sync — keeps the Uniforms PWA (separate Supabase account,
// pjvsrhsykghsffhtntjk) in step with the intranet roster.
//
// Hourly via pg_cron ('uniforms-sync-hourly'), four passes:
//   1. LINK      uniforms employees ↔ roster rows by exact email (once;
//                stamped on employees.roster_user_id).
//   2. ONBOARD   active roster people (role ≠ admin, account_type
//                person) created on/after 2026-10-27 get a uniforms row
//                with the standard allowance (part_time $150 /
//                full_time $250). Earlier hires stay manual — the NEOP
//                backfill was done by hand and the rest are under
//                audit.
//   3. OFFBOARD  uniforms rows whose linked roster person went
//                inactive are deactivated. One-way: reactivation is a
//                deliberate admin action in the uniforms app.
//   4. RESET     on/after Jan 1 2027 (America/Chicago), every active
//                uniforms employee missing an allowance_resets row for
//                the new year is reset: type re-read from the roster
//                (locked during the year per Justin), balance set to
//                the full new-year amount, the prior balance archived
//                on the reset row (use it or lose it). The unique
//                (employee_id, year) index is the idempotency claim, so
//                repeat or concurrent runs can't double-reset. 2026 is
//                never touched.
//
// Dry run by default; the cron job sends {"apply": true}.
// Auth: x-sync-secret. Writes to the uniforms project with its
// publishable key (already public in the PWA bundle; that project has
// no RLS) — set UNIFORMS_SERVICE_KEY to override if it's ever locked
// down.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

const UNIFORMS_URL = env.get('UNIFORMS_URL') ?? 'https://pjvsrhsykghsffhtntjk.supabase.co'
/* The publishable key ships in the uniforms PWA bundle, so it is not a
   secret; the project has no RLS, so it can read and write these
   tables. UNIFORMS_SERVICE_KEY overrides it if that ever changes. */
const UNIFORMS_KEY = env.get('UNIFORMS_SERVICE_KEY') ?? 'sb_publishable_kTASQ_-lWskwyb7XXgIuiQ_WIlscHhI'

/* Roster rows created before this date never auto-onboard. */
const ONBOARD_WATERMARK = '2026-10-27'

const AMOUNTS: Record<string, number> = { part_time: 150, full_time: 250 }
const typeFor = (t: string | null | undefined) => (t === 'part_time' ? 'part_time' : 'full_time')
const amountFor = (t: string | null | undefined) => AMOUNTS[typeFor(t)]

interface RosterRow {
  id: string
  full_name: string
  email: string | null
  role: string
  active: boolean
  employment_type: string | null
  created_at: string
}

interface UniEmployee {
  id: string
  name: string
  email: string | null
  employee_type: string | null
  annual_allowance: number | null
  current_balance: number | null
  active: boolean
  roster_user_id: string | null
}

function centralYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date()),
  )
}

async function uni(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${UNIFORMS_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: UNIFORMS_KEY,
      Authorization: `Bearer ${UNIFORMS_KEY}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

async function uniGet<T>(path: string): Promise<T> {
  const res = await uni(path)
  if (!res.ok) throw new Error(`uniforms GET ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'POST only' }, { status: 405 })
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret)
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let flags: { apply?: boolean } = {}
  try {
    flags = await req.json()
  } catch {
    /* empty body = dry run */
  }
  const apply = flags.apply === true

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data: rosterData, error } = await supabase
    .from('app_users')
    .select('id, full_name, email, role, active, employment_type, created_at')
    .eq('account_type', 'person')
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  const roster = rosterData as RosterRow[]

  let emps: UniEmployee[]
  try {
    emps = await uniGet<UniEmployee[]>(
      '/employees?select=id,name,email,employee_type,annual_allowance,current_balance,active,roster_user_id&limit=10000',
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: `uniforms read failed — has the 2026-10-27 migration been run there? ${(e as Error).message}` },
      { status: 502 },
    )
  }

  const linked: string[] = []
  const onboarded: string[] = []
  const deactivated: string[] = []
  const resets: string[] = []
  const skipped: string[] = []

  const rosterById = new Map(roster.map((r) => [r.id, r]))
  const rosterByEmail = new Map<string, RosterRow[]>()
  for (const r of roster) {
    const e = (r.email ?? '').trim().toLowerCase()
    if (e) rosterByEmail.set(e, [...(rosterByEmail.get(e) ?? []), r])
  }
  const linkedRosterIds = new Set(emps.filter((e) => e.roster_user_id).map((e) => e.roster_user_id!))
  const uniEmails = new Set(emps.map((e) => (e.email ?? '').trim().toLowerCase()).filter(Boolean))

  /* 1 — LINK unlinked uniforms rows to roster rows by exact email. */
  for (const emp of emps) {
    if (emp.roster_user_id) continue
    const email = (emp.email ?? '').trim().toLowerCase()
    const matches = email ? (rosterByEmail.get(email) ?? []) : []
    if (matches.length !== 1) continue
    const r = matches[0]
    if (linkedRosterIds.has(r.id)) {
      skipped.push(`link ${emp.name}: roster row already linked to another uniforms row`)
      continue
    }
    if (apply) {
      const res = await uni(`/employees?id=eq.${emp.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ roster_user_id: r.id }),
      })
      if (!res.ok) {
        skipped.push(`link ${emp.name}: ${res.status} ${(await res.text()).slice(0, 120)}`)
        continue
      }
    }
    emp.roster_user_id = r.id
    linkedRosterIds.add(r.id)
    linked.push(`${emp.name} ↔ ${r.full_name}`)
  }

  /* 2 — ONBOARD new roster hires (created on/after the watermark). */
  for (const r of roster) {
    if (!r.active || r.role === 'admin') continue
    if ((r.created_at ?? '') < ONBOARD_WATERMARK) continue
    if (linkedRosterIds.has(r.id)) continue
    const email = (r.email ?? '').trim().toLowerCase()
    if (!email) {
      skipped.push(`onboard ${r.full_name}: no email on the roster row`)
      continue
    }
    /* A uniforms row with this email exists but could not be linked
       (ambiguous match) — leave it to the audit rather than duplicate. */
    if (uniEmails.has(email)) continue
    const type = typeFor(r.employment_type)
    const amount = amountFor(r.employment_type)
    if (apply) {
      const res = await uni('/employees', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          name: r.full_name,
          email,
          employee_type: type,
          annual_allowance: amount,
          current_balance: amount,
          is_admin: false,
          active: true,
          roster_user_id: r.id,
        }),
      })
      if (!res.ok) {
        skipped.push(`onboard ${r.full_name}: ${res.status} ${(await res.text()).slice(0, 120)}`)
        continue
      }
    }
    uniEmails.add(email)
    linkedRosterIds.add(r.id)
    onboarded.push(`${r.full_name} (${type} $${amount})`)
  }

  /* 3 — OFFBOARD: linked roster person went inactive. */
  for (const emp of emps) {
    if (!emp.active || !emp.roster_user_id) continue
    const r = rosterById.get(emp.roster_user_id)
    if (!r || r.active) continue
    if (apply) {
      const res = await uni(`/employees?id=eq.${emp.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ active: false }),
      })
      if (!res.ok) {
        skipped.push(`offboard ${emp.name}: ${res.status} ${(await res.text()).slice(0, 120)}`)
        continue
      }
    }
    emp.active = false
    deactivated.push(emp.name)
  }

  /* 4 — RESET: January 1st, use it or lose it. 2027 onward only. */
  const year = centralYear()
  if (year >= 2027) {
    let claimedRows: { employee_id: string }[] = []
    try {
      claimedRows = await uniGet(`/allowance_resets?select=employee_id&year=eq.${year}&limit=10000`)
    } catch (e) {
      skipped.push(`reset: could not read allowance_resets — ${(e as Error).message}`)
      claimedRows = []
    }
    const claimed = new Set(claimedRows.map((d) => d.employee_id))
    for (const emp of emps) {
      if (!emp.active || claimed.has(emp.id)) continue
      const r = emp.roster_user_id ? rosterById.get(emp.roster_user_id) : undefined
      const type = typeFor(r?.employment_type ?? emp.employee_type)
      const amount = amountFor(type)
      if (apply) {
        const claim = await uni('/allowance_resets', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            employee_id: emp.id,
            year,
            employee_type: type,
            amount,
            prev_balance: emp.current_balance,
          }),
        })
        if (claim.status === 409) continue /* another run already reset them */
        if (!claim.ok) {
          skipped.push(`reset ${emp.name}: ${claim.status} ${(await claim.text()).slice(0, 120)}`)
          continue
        }
        const res = await uni(`/employees?id=eq.${emp.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ employee_type: type, annual_allowance: amount, current_balance: amount }),
        })
        if (!res.ok) {
          skipped.push(`reset ${emp.name}: balance update failed ${res.status}`)
          continue
        }
      }
      resets.push(`${emp.name} → ${type} $${amount} (carried-off balance $${Number(emp.current_balance ?? 0).toFixed(2)})`)
    }
  }

  return Response.json({
    ok: true,
    apply,
    year,
    counts: {
      linked: linked.length,
      onboarded: onboarded.length,
      deactivated: deactivated.length,
      resets: resets.length,
      skipped: skipped.length,
    },
    linked,
    onboarded,
    deactivated,
    resets,
    skipped,
  })
})
