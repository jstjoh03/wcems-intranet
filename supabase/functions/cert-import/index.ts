// supabase/functions/cert-import/index.ts
//
// Certification importers for the Clinical Development pipeline.
// POST a raw .xlsx body with ?mode=paycom|ems1 (&apply=true to write).
//
//   mode=paycom — Paycom "certifications" export (sheet "Report Data").
//     Card classes upsert into pipeline_requirement_completions
//     (source 'paycom'; UNIQUE(req,user,completed_at) makes weekly
//     re-runs idempotent). Expirations SNAP TO END OF MONTH — the
//     physical cards show month/year only; mid-month days in Paycom
//     are start-date artifacts (Justin's rule, 2026-08-19).
//     TX DSHS rows are NEVER written — the license lives on
//     pipeline_records via roster-sync. They're compared and reported,
//     and any specific (non-EOM) DSHS date is flagged for manual
//     verification.
//
//   mode=ems1 — EMS1/Lexipol courses report, xlsx OR csv (the site's
//     native download). Columns are found BY NAME from whichever row
//     carries 'Full Name' (legacy xlsx: row 4; csv: row 1 with
//     Email/Group columns in between). "Passed" rows update
//     pipeline_records.tx_jurisprudence_at / bloodborne_pathogen_at,
//     but only when the stored value is empty, the 2026-07-01
//     jurisprudence placeholder, or older than the report's date.
//     People who completed jurisprudence elsewhere are untouched
//     (their real dates enter via the person modal).
//
// Auth: x-sync-secret, or a signed-in admin's / pipeline editor's JWT.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-expect-error resolved by Edge Runtime
import * as XLSX from 'npm:xlsx@0.18.5'

// @ts-expect-error Deno global
const env = Deno.env

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST',
}

/* Same nickname→legal map as roster-sync: app_users store nickname
   forms; Paycom/EMS1 carry legal names. Normalizing both sides through
   this map makes them meet in the middle. */
const ALIASES: Record<string, string> = {
  'joe diaz': 'jose diaz',
  'maddie white': 'madison white',
  'trae ivy': 'travarious ivy',
  'ron thibodeaux': 'ronald thibodeaux',
  /* Paycom/EMS1 legal names → the portal's nickname forms. */
  'aletha kankel-howell': 'aletha howell',
  /* Paycom still carries Heather Fojt's previous last name. */
  'heather riley': 'heather fojt',
  'darry-davis luther': 'darry luther',
  'edward delany': 'ed delany',
  'joshua webb': 'josh webb',
  'leo gammon': 'trae gammon',
  'mary shannon mcconaty': 'mary mcconaty',
  'timothy friedel': 'tim friedel',
  'tzee kwang perry tong': 'perry tong',
  /* HR/Admin — portal uses the nickname (Justin, 2026-11-12). */
  'victoria bell': 'tori bell',
}
const SUFFIX_TOKENS = new Set(['m', 'd', 'md', 'do', 'jr', 'sr', 'ii', 'iii', 'iv', 'rn', 'lp', 'np', 'pa'])

function normName(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const toks = s.split(' ').filter((t) => !SUFFIX_TOKENS.has(t))
  s = toks.join(' ')
  return ALIASES[s] ?? s
}

/** Paycom cert name → pipeline_requirements.name (null = skip). */
const CERT_MAP: Record<string, string> = {
  'basic life support': 'BLS Provider',
  'advanced cardiac life support': 'ACLS Provider',
  'acls': 'ACLS Provider',
  'pediatric advanced life support': 'PALS Provider',
  'handtevy pediatric emergency': 'HandTevy Pediatric',
  'handtevy pediatric': 'HandTevy Pediatric',
  'emergency vehicle operations course': 'EVOC',
  'emergency vehicle operations': 'EVOC',
  'national registry certification': 'National Registry',
  /* Annual active-attack training (requirement row added 2026-11-03).
     Paycom lists an ALERRT slot for everyone; only rows with a date are
     completions — the rest fall into missingStart and are skipped. */
  'alerrt': 'ALERRT',
  /* HEART training (Justin, 2026-11-12: new in Paycom, rows were
     skipped because this map didn't know the label). Explicit although
     the name-fallback below now catches identical names — the map
     documents every known Paycom label. */
  'heart training': 'HEART Training',
}
const DSHS_NAMES = new Set(['texas department of state health services'])

function toDate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    if (v.getFullYear() < 1990) return null
    return v.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (!s || s.startsWith('0000')) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

function endOfMonth(iso: string): string {
  const [y, mo] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

function isEndOfMonth(iso: string): boolean {
  return iso === endOfMonth(iso)
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

  /* Secret (script path) or admin/pipeline-editor JWT (portal path). */
  const secret = env.get('ROSTER_SYNC_SECRET')
  let authorized = !!secret && req.headers.get('x-sync-secret') === secret
  if (!authorized) {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (jwt) {
      const { data } = await supabase.auth.getUser(jwt)
      if (data.user) {
        const { data: row } = await supabase
          .from('app_users')
          .select('id, role, active')
          .eq('auth_user_id', data.user.id)
          .maybeSingle()
        if (row?.active) {
          if (row.role === 'admin') authorized = true
          else {
            const { data: ed } = await supabase
              .from('pipeline_editors')
              .select('user_id')
              .eq('user_id', row.id)
              .maybeSingle()
            authorized = !!ed
          }
        }
      }
    }
  }
  if (!authorized) return json({ ok: false, error: 'unauthorized' }, 401)

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode')
  const apply = url.searchParams.get('apply') === 'true'
  if (mode !== 'paycom' && mode !== 'ems1') {
    return json({ ok: false, error: 'mode must be paycom or ems1' }, 400)
  }

  let wb: XLSX.WorkBook
  try {
    const buf = await req.arrayBuffer()
    if (buf.byteLength < 100) throw new Error('empty body')
    const bytes = new Uint8Array(buf)
    /* Route by magic bytes instead of SheetJS's sniffing: xlsx is a ZIP
       ("PK…"); anything else is treated as CSV text (EMS1's native
       download — the sniffer mis-read it and the header was "not
       found", Justin 2026-11-12). BOM stripped either way. */
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      wb = XLSX.read(bytes, { type: 'array', cellDates: true })
    } else {
      const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
      wb = XLSX.read(text, { type: 'string', cellDates: true })
    }
  } catch (e) {
    return json({ ok: false, error: `could not parse the file: ${(e as Error).message}` }, 400)
  }

  /* People lookup: legal-normalized full name → app_user id. */
  const { data: users, error: uErr } = await supabase
    .from('app_users')
    .select('id, full_name, active')
    .eq('account_type', 'person')
  if (uErr) return json({ ok: false, error: uErr.message }, 500)
  const byName = new Map<string, { id: string; fullName: string; active: boolean }>()
  for (const u of users ?? []) {
    byName.set(normName(u.full_name), { id: u.id, fullName: u.full_name, active: u.active })
  }

  const { data: recs, error: rErr } = await supabase
    .from('pipeline_records')
    .select('user_id, cert_level, tx_license_expires_at, tx_jurisprudence_at, bloodborne_pathogen_at')
  if (rErr) return json({ ok: false, error: rErr.message }, 500)
  const recByUser = new Map((recs ?? []).map((r) => [r.user_id, r]))

  /* ── mode=paycom ─────────────────────────────────────────────────── */
  if (mode === 'paycom') {
    const ws = wb.Sheets['Report Data'] ?? wb.Sheets[wb.SheetNames[0]]
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null })

    const { data: reqs, error: qErr } = await supabase
      .from('pipeline_requirements')
      .select('id, name, cycle')
    if (qErr) return json({ ok: false, error: qErr.message }, 500)
    const reqByName = new Map((reqs ?? []).map((r) => [r.name, { id: r.id, cycle: r.cycle }]))
    /* Fallback matching: a Paycom label that isn't in CERT_MAP still
       imports when a requirement row carries the SAME name (case-
       insensitive). A cert added to both Paycom and the portal under
       one name needs no code change — the HEART lesson (2026-11-12). */
    const reqNameByLower = new Map((reqs ?? []).map((r) => [r.name.toLowerCase(), r.name]))

    const unmatched = new Set<string>()
    const inactiveSkipped = new Set<string>()
    const skippedCerts = new Set<string>()
    const missingStart: string[] = []
    const dshsManualVerify: string[] = []
    const dshsMismatch: string[] = []
    const upserts: {
      requirement_id: string
      user_id: string
      completed_at: string
      expires_at: string | null
      source: string
      note: string | null
    }[] = []
    const perReq: Record<string, number> = {}

    for (const row of rows) {
      const first = String(row['Legal_Firstname'] ?? '').trim()
      const last = String(row['Legal_Lastname'] ?? '').trim()
      if (!first) continue
      const certRaw = String(row['Certification_Name'] ?? '').trim()
      const certKey = certRaw.toLowerCase()
      const person = byName.get(normName(`${first} ${last}`))
      if (!person) {
        unmatched.add(`${first} ${last}`)
        continue
      }
      /* Former employees linger in Paycom exports (Carothers, 2026-11-12)
         — an inactive portal account neither imports nor makes noise. */
      if (!person.active) {
        inactiveSkipped.add(person.fullName)
        continue
      }
      const start = toDate(row['Start_Date'])
      const endRaw = toDate(row['End_Date'])

      if (DSHS_NAMES.has(certKey)) {
        if (endRaw && !isEndOfMonth(endRaw)) {
          dshsManualVerify.push(`${person.fullName}: Paycom shows ${endRaw} (specific date — verify)`)
        }
        const rec = recByUser.get(person.id)
        if (rec && endRaw) {
          const stored = rec.tx_license_expires_at
          if (stored && stored !== endRaw && endOfMonth(stored) !== endOfMonth(endRaw)) {
            /* NEVER auto-written: the HR roster List owns this field and
               roster-sync re-copies it daily — a Paycom write here would
               silently revert on the next sync. Fix it at the source. */
            dshsMismatch.push(
              `${person.fullName}: pipeline has ${stored}, Paycom has ${endRaw} — if Paycom is right, update the TX license expiration in the HR roster workbook (the List owns this field; roster-sync carries it to the portal)`,
            )
          }
        }
        continue
      }

      const reqName = CERT_MAP[certKey] ?? reqNameByLower.get(certKey)
      if (!reqName) {
        skippedCerts.add(certRaw)
        continue
      }
      const req = reqByName.get(reqName)
      if (!req) {
        skippedCerts.add(`${certRaw} (no requirement row)`)
        continue
      }

      /* The end-of-month snap is a CARD convention (AHA cards print
         month/year). Annual items like ALERRT carry a real completion
         date — and their due date is computed from completed_at anyway —
         so their expiration is stored as-is. */
      const expires = endRaw ? (req.cycle === 'certification' ? endOfMonth(endRaw) : endRaw) : null
      const completed = start ?? endRaw
      if (!completed) {
        missingStart.push(`${person.fullName}: ${certRaw} (no dates at all)`)
        continue
      }
      if (!start) missingStart.push(`${person.fullName}: ${certRaw} (no start date; used expiration)`)

      upserts.push({
        requirement_id: req.id,
        user_id: person.id,
        completed_at: completed,
        expires_at: expires,
        source: 'paycom',
        note: null,
      })
      perReq[reqName] = (perReq[reqName] ?? 0) + 1
    }

    /* Paycom can list the same card under two names (e.g. "ACLS" and
       "Advanced Cardiac Life Support") with the same date — dedupe the
       batch on the conflict key, keeping the later expiration. */
    const dedup = new Map<string, (typeof upserts)[number]>()
    for (const u of upserts) {
      const k = `${u.requirement_id}|${u.user_id}|${u.completed_at}`
      const prev = dedup.get(k)
      if (!prev || (u.expires_at ?? '') > (prev.expires_at ?? '')) dedup.set(k, u)
    }
    const deduped = [...dedup.values()]

    let written = 0
    if (apply && deduped.length) {
      const { error: iErr, count } = await supabase
        .from('pipeline_requirement_completions')
        .upsert(deduped, { onConflict: 'requirement_id,user_id,completed_at', count: 'exact' })
      if (iErr) return json({ ok: false, error: `upsert failed: ${iErr.message}` }, 500)
      written = count ?? deduped.length
    }

    return json({
      ok: true,
      mode,
      apply,
      rows: rows.length,
      toImport: deduped.length,
      written,
      perRequirement: perReq,
      unmatchedPeople: [...unmatched].sort(),
      inactiveSkipped: [...inactiveSkipped].sort(),
      skippedCertTypes: [...skippedCerts].sort(),
      dshsManualVerify,
      dshsMismatch,
      missingStart,
    })
  }

  /* ── mode=ems1 ───────────────────────────────────────────────────── */
  const ws = wb.Sheets['Courses Report'] ?? wb.Sheets[wb.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  /* Columns by NAME from whichever row carries 'Full Name' (2026-11-12):
     the legacy xlsx put the header on row 4 with fixed positions; the
     CSV download puts it on row 1 with Email/Personal ID/Group columns
     in between — fixed indices silently read the wrong cells. */
  const cellStr = (v: unknown) => String(v ?? '').replace(/^﻿/, '').trim()
  const headerIdx = rows.findIndex((r) => (r ?? []).some((c) => cellStr(c) === 'Full Name'))
  if (headerIdx < 0) {
    return json({ ok: false, error: "header row not found — expected a 'Full Name' column (EMS1 courses report, xlsx or csv)" }, 400)
  }
  const header = (rows[headerIdx] ?? []).map(cellStr)
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const cName = col('Full Name')
  const cCourse = col('Course Title')
  const cStatus = col('Completion Status')
  const cDate = col('Date Completed')
  if (cCourse < 0 || cStatus < 0 || cDate < 0) {
    return json({ ok: false, error: `missing expected columns (Course Title / Completion Status / Date Completed) — found: ${header.filter(Boolean).join(', ')}` }, 400)
  }

  const JURIS_PLACEHOLDER = '2026-07-01'
  const unmatched = new Set<string>()
  const inactiveSkipped = new Set<string>()
  const updates: { userId: string; field: string; from: string | null; to: string; who: string }[] = []
  const unchanged: string[] = []
  let passedRows = 0

  for (const r of rows.slice(headerIdx + 1)) {
    const rawName = cellStr(r?.[cName])
    if (!rawName) continue
    const course = cellStr(r?.[cCourse])
    const status = cellStr(r?.[cStatus]).toLowerCase()
    const date = toDate(r?.[cDate])
    if (status !== 'passed' || !date) continue
    passedRows++

    const field = /jurisprudence/i.test(course)
      ? 'tx_jurisprudence_at'
      : /bloodborne/i.test(course)
        ? 'bloodborne_pathogen_at'
        : null
    if (!field) continue

    /* "Last, First" → "First Last" */
    const flipped = rawName.includes(',')
      ? rawName.split(',').reverse().map((s) => s.trim()).join(' ')
      : rawName
    const person = byName.get(normName(flipped))
    if (!person) {
      unmatched.add(rawName)
      continue
    }
    if (!person.active) {
      inactiveSkipped.add(person.fullName)
      continue
    }
    const rec = recByUser.get(person.id)
    if (!rec) {
      unmatched.add(`${rawName} (no pipeline record)`)
      continue
    }

    const stored = rec[field as 'tx_jurisprudence_at'] as string | null
    const isPlaceholder = field === 'tx_jurisprudence_at' && stored === JURIS_PLACEHOLDER
    if (stored && !isPlaceholder && stored >= date) {
      unchanged.push(`${person.fullName}: ${field} already ${stored}`)
      continue
    }
    updates.push({ userId: person.id, field, from: stored, to: date, who: person.fullName })
  }

  let written = 0
  if (apply) {
    for (const u of updates) {
      const { error: eErr } = await supabase
        .from('pipeline_records')
        .update({ [u.field]: u.to })
        .eq('user_id', u.userId)
      if (eErr) return json({ ok: false, error: `update failed for ${u.who}: ${eErr.message}` }, 500)
      written++
    }
  }

  return json({
    ok: true,
    mode,
    apply,
    passedRows,
    toUpdate: updates.length,
    written,
    updates: updates.map((u) => `${u.who}: ${u.field} ${u.from ?? '—'} → ${u.to}`),
    unchanged,
    unmatchedPeople: [...unmatched].sort(),
    inactiveSkipped: [...inactiveSkipped].sort(),
  })
})
