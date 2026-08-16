// supabase/functions/excel-to-list/index.ts
//
// Stage 1 of the edit-once chain: reads HR's Master Roster workbook
// (AdminStaff site › Documents › Admin › Master Roster 102225.xlsx,
// Active sheet) via the Graph workbook API — NO Excel Table required,
// HR's file is never modified — and upserts identity columns into the
// WCEMS Roster List. Stage 2 (roster-sync, hourly at :05) then fans the
// List out to the intranet/training and uniforms apps.
//
// Column rules (per Justin's merge decisions):
//   - Excel wins: Title, EmpNumber, Category, PersonalEmail, Mobile,
//     City, CertLevel, TXLicenseNumber, TDL
//   - TXLicenseExp: LATER date wins (the List carries renewal dates that
//     HR's sheet may lag behind; never regress to an older expiration)
//   - Pipeline/ops columns on the List are NEVER touched here.
//   - People on the List but missing from Excel are REPORTED as
//     removals, not auto-deleted. Deleting the List row (manually, for
//     now) is what triggers app deactivation downstream.
//
// Modes: header `x-sync-secret: $ROSTER_SYNC_SECRET` required.
//   POST {}              → DRY RUN: report the plan
//   POST {"apply":true}  → write creates/updates to the List
//
// Graph permissions (application, admin-consented, on WCEMS Intranet app):
//   Sites.Read.All       — read workbook + List (already granted)
//   Sites.ReadWrite.All  — write List items (required for apply)

// @ts-expect-error Deno global
const env = Deno.env

/* New hires awaiting Justin's clearance decision (2026-08-07): present on
   HR's sheet but NOT created on the List until cleared. Remove names from
   this set as clearances come in — future hires auto-create normally. */
const HOLD_CREATES = new Set([
  'caleb fenter', // WITHDREW 2026-08 — never create; remove from this set only if HR's sheet drops him first
  // cowan, ho, marin, parlor, roth, ruiz, vernon — CLEARED 2026-08-11
  // 'brianna smith' — CLEARED 2026-08-07 (pilot)
])

const SP_HOST = 'wcvems.sharepoint.com'
const SP_SITE_PATH = '/sites/AdminStaff'
const XLSX_PATH = '/Admin/Master Roster 102225.xlsx'
const SHEET = 'Active'
const LIST_NAME = 'WCEMS Roster'

async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.get('GRAPH_CLIENT_ID')!,
    client_secret: env.get('GRAPH_CLIENT_SECRET')!,
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

async function g(token: string, method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Graph ${res.status} ${method} ${url.split('?')[0].slice(-60)}: ${(await res.text()).slice(0, 250)}`)
  return res.status === 204 ? null : res.json()
}

function norm(name: string): string {
  let s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (s.includes(',')) {
    const [last, , first] = [s.split(',')[0], null, s.split(',')[1]]
    s = `${(first ?? '').trim()} ${last.trim()}`
  }
  return s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/* Excel date serial → ISO yyyy-mm-dd (UTC). Default floor of 20000
   (~1954) suits license expirations; DOBs pass a lower floor since
   staff born in the 1950s sit well below it. */
function serialToIso(v: unknown, min = 20000): string | null {
  const n = Number(v)
  if (!isFinite(n) || n < min || n > 80000) return null
  const ms = Math.round((n - 25569) * 86400 * 1000)
  return new Date(ms).toISOString().slice(0, 10)
}

interface ExcelRow {
  emp: number | null; name: string; norm: string; category: string
  city: string | null; mobile: string | null; email: string | null
  cert: string | null; lic: string | null; exp: string | null; tdl: string | null
  fuel: string | null; dob: string | null
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  let apply = false
  try { apply = (await req.json())?.apply === true } catch (_) { /* dry run */ }

  try {
    const token = await graphToken()
    const site = await g(token, 'GET', `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`)

    // ── Read HR's workbook (no table needed, file untouched) ───────────
    const item = await g(token, 'GET',
      `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/root:${encodeURI(XLSX_PATH)}`)
    const used = await g(token, 'GET',
      `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/items/${item.id}/workbook/worksheets('${SHEET}')/usedRange?$select=values`)
    const rows: unknown[][] = used.values ?? []
    if (String(rows?.[1]?.[1] ?? '') !== 'Name') {
      throw new Error(`Sheet layout changed: expected header "Name" at B2, got "${rows?.[1]?.[1]}" — sync halted, nothing written`)
    }

    const excel: ExcelRow[] = []
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r]
      const name = String(row?.[1] ?? '').trim()
      if (!name || !name.includes(',')) continue // section headers, blanks, non-person rows
      excel.push({
        emp: Number(row[0]) > 0 ? Number(row[0]) : null,
        name, norm: norm(name),
        category: String(row[2] ?? '').trim(),
        city: row[4] ? String(row[4]).trim() : null,
        mobile: row[6] ? String(row[6]).trim() : null,
        email: row[7] ? String(row[7]).trim() : null,
        cert: row[8] ? String(row[8]).trim() : null,
        lic: row[9] != null && row[9] !== '' ? String(row[9]).trim() : null,
        exp: serialToIso(row[10]),
        fuel: row[11] != null && row[11] !== '' ? String(row[11]).trim() : null,
        tdl: row[12] != null && row[12] !== '' ? String(row[12]).trim() : null,
        /* Column N has no header on HR's sheet but holds DOB. */
        dob: serialToIso(row[13], 10000),
      })
    }

    // ── Read the List with resolved internal column names ──────────────
    const lists = await g(token, 'GET',
      `https://graph.microsoft.com/v1.0/sites/${site.id}/lists?$filter=displayName eq '${LIST_NAME}'`)
    if (!lists.value?.length) throw new Error(`List "${LIST_NAME}" not found`)
    const listId = lists.value[0].id
    const colsRes = await g(token, 'GET', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/columns`)
    const internal: Record<string, string> = {}
    /* Skip read-only system columns — several share the display name
       "Title" (LinkTitle, LinkTitleNoMenu) and would shadow the real,
       writable Title column in this map. */
    for (const c of colsRes.value ?? []) {
      if (c.readOnly) continue
      if (!(c.displayName in internal)) internal[c.displayName] = c.name
    }
    const K = (d: string) => internal[d] ?? d

    /* Self-healing: create the FuelNumber / DOB columns if the List
       predates them (added 2026-08-14 so new hires carry both into the
       apps). New columns get internal name = the name we provide. */
    if (apply) {
      const ensure: Array<[string, Record<string, unknown>]> = [
        ['FuelNumber', { text: {} }],
        ['DOB', { dateTime: { format: 'dateOnly' } }],
      ]
      for (const [name, type] of ensure) {
        if (internal[name]) continue
        await g(token, 'POST', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/columns`,
          { name, ...type })
        internal[name] = name
      }
    }

    interface ListRow { id: string; norm: string; emp: number | null; status: string; f: Record<string, unknown> }
    const listRows: ListRow[] = []
    let url: string | undefined = `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/items?expand=fields&$top=200`
    while (url) {
      const data = await g(token, 'GET', url)
      for (const it of data.value ?? []) {
        const f = it.fields ?? {}
        const title = f[K('Title')]
        if (!title || !String(title).includes(',')) continue
        listRows.push({
          id: it.id, norm: norm(String(title)),
          emp: Number(f[K('EmpNumber')]) > 0 ? Number(f[K('EmpNumber')]) : null,
          status: String(f[K('Status')] ?? 'Active') || 'Active', f,
        })
      }
      url = data['@odata.nextLink']
    }
    const byEmp = new Map(listRows.filter((r) => r.emp).map((r) => [r.emp, r]))
    const byName = new Map(listRows.map((r) => [r.norm, r]))

    // ── Diff ───────────────────────────────────────────────────────────
    const updates: Array<{ id: string; name: string; set: Record<string, unknown> }> = []
    const creates: Array<Record<string, unknown>> = []
    const removals: Array<{ id: string; name: string }> = []
    const seen = new Set<string>()

    for (const e of excel) {
      /* Name-first matching. EmpNumber is only a FALLBACK (covers name
         changes) and only if that row isn't already claimed — HR's sheet
         has duplicate employee numbers, and emp-first matching once
         paired a person with someone else's row. */
      let match = byName.get(e.norm)
      if (!match && e.emp) {
        const cand = byEmp.get(e.emp)
        if (cand && !seen.has(cand.id)) match = cand
      }
      if (match) {
        seen.add(match.id)
        const set: Record<string, unknown> = {}
        const want: Array<[string, unknown]> = [
          ['Title', e.name], ['Category', e.category || null], ['PersonalEmail', e.email],
          ['Mobile', e.mobile], ['City', e.city], ['CertLevel', e.cert],
          ['TXLicenseNumber', e.lic], ['TDL', e.tdl], ['FuelNumber', e.fuel],
        ]
        if (e.emp && Number(match.f[K('EmpNumber')]) !== e.emp) set[K('EmpNumber')] = e.emp
        for (const [disp, v] of want) {
          if (v == null) continue // Excel blank never clears a List value
          const cur = match.f[K(disp)]
          /* Numeric columns (TDL, license #) can't hold leading zeros —
             compare numerically when both sides parse, else re-writing
             "05789191" into a Number column loops forever. */
          const bothNum = String(v).trim() !== '' && isFinite(Number(v)) &&
            cur != null && String(cur).trim() !== '' && isFinite(Number(cur))
          if (bothNum ? Number(cur) === Number(v) : String(cur ?? '') === String(v)) continue
          set[K(disp)] = bothNum ? Number(v) : v
        }
        // TXLicenseExp: later date wins
        if (e.exp) {
          const cur = match.f[K('TXLicenseExp')]
          const curIso = cur ? String(cur).slice(0, 10) : null
          if (!curIso || e.exp > curIso) set[K('TXLicenseExp')] = e.exp
        }
        // DOB: Excel wins (date-compare so SP's datetime never loops)
        if (e.dob) {
          const cur = match.f[K('DOB')]
          const curIso = cur ? String(cur).slice(0, 10) : null
          if (curIso !== e.dob) set[K('DOB')] = e.dob
        }
        if (Object.keys(set).length) {
          updates.push({ id: match.id, name: e.name, set })
        }
      } else {
        /* New hire: mark Active and flag for M365 provisioning — the
           lifecycle function creates the account, licenses, and groups. */
        const set: Record<string, unknown> = { [K('Title')]: e.name, [K('Status')]: 'Active', [K('ProvisionM365')]: 'Yes' }
        if (e.emp) set[K('EmpNumber')] = e.emp
        if (e.category) set[K('Category')] = e.category
        if (e.email) set[K('PersonalEmail')] = e.email
        if (e.mobile) set[K('Mobile')] = e.mobile
        if (e.city) set[K('City')] = e.city
        if (e.cert) set[K('CertLevel')] = e.cert
        if (e.lic) set[K('TXLicenseNumber')] = e.lic
        if (e.exp) set[K('TXLicenseExp')] = e.exp
        if (e.tdl) set[K('TDL')] = e.tdl
        if (e.fuel) set[K('FuelNumber')] = e.fuel
        if (e.dob) set[K('DOB')] = e.dob
        creates.push({ name: e.name, set })
      }
    }
    /* People gone from HR's Active sheet: auto-mark Separated (planned
       separations need no one to touch the List). Rows already Separated
       (e.g. an emergency termination Justin flagged directly) are left
       alone. Guard: >3 new separations in one pass = halt, likely a
       damaged sheet, not a real exodus. */
    const autoSeparate: Array<{ id: string; name: string }> = []
    for (const r of listRows) {
      if (!seen.has(r.id) && r.status !== 'Separated') {
        autoSeparate.push({ id: r.id, name: String(r.f[K('Title')]) })
      }
    }
    const separationHalt = autoSeparate.length > 3

    const held = creates.filter((c) => HOLD_CREATES.has(norm(String(c.name))))
    const toCreate = creates.filter((c) => !HOLD_CREATES.has(norm(String(c.name))))

    if (apply) {
      for (const u of updates) {
        await g(token, 'PATCH', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/items/${u.id}/fields`, u.set)
      }
      for (const c of toCreate) {
        await g(token, 'POST', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/items`, { fields: c.set })
      }
      if (!separationHalt) {
        for (const s of autoSeparate) {
          await g(token, 'PATCH', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/items/${s.id}/fields`, { [K('Status')]: 'Separated' })
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, applied: apply, excelPeople: excel.length, listPeople: listRows.length,
      updates: updates.map((u) => ({ name: u.name, fields: Object.keys(u.set) })),
      creates: toCreate.map((c) => c.name),
      heldPendingClearance: held.map((c) => c.name),
      autoSeparated: separationHalt ? [] : autoSeparate.map((r) => r.name),
      separationHalt: separationHalt ? `${autoSeparate.length} pending separations exceeds guard of 3 — none applied: ${autoSeparate.map((r) => r.name).join(', ')}` : null,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
