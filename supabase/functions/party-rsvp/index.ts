// supabase/functions/party-rsvp/index.ts
//
// Christmas-party RSVP by email (2026-11-09). One personalized email per
// member with tokenized Yes / No buttons; both land on a small branded
// page served by this function, and the SUBMIT (form POST) — never the
// GET, which mail scanners like Outlook SafeLinks prefetch — records the
// answer and writes it straight into Laurel's tracker workbook on her
// OneDrive (row matched by name; C=RSVP Status, D=Total Attending,
// E=Guest Name(s), F=Dietary, G=Portal stamp). Her summary formulas
// (rows 3–5) read those columns, so the top-of-sheet counts stay live.
//
// Actions:
//   POST {action:'send', test?: string[], onlyPending?: bool, resend?: bool}
//        + x-sync-secret — upsert tokens for active person accounts and
//        email them (test limits recipients to those addresses).
//   POST {action:'probe'} + x-sync-secret — token + workbook read + a
//        same-value write to prove the Graph app can edit the file.
//   GET  ?t=<token>[&a=yes|no] — the RSVP page (no writes).
//   POST form (t, attending, headcount, guests, dietary) — save + sync.
//
// Deploy with verify_jwt FALSE — the links open from email with no auth;
// the per-person token is the credential (same model as sched-ics).

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const SB_URL = env.get('SUPABASE_URL')!
const SERVICE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── event + workbook constants (one-off event helper) ────────────────
const EVENT_KEY = 'christmas-2026'
const EVENT_DATE_TEXT = 'Friday, December 4th'
const DEADLINE_TEXT = 'Wednesday, November 19th'
const SENDER = 'office@wallercountyems.com'
// Email links go through the portal-domain proxy (functions/rsvp.js on
// Cloudflare Pages): the Supabase gateway force-rewrites HTML responses
// on *.supabase.co to text/plain + CSP sandbox, so the page must be
// served from our own domain.
const PUBLIC_BASE = 'https://employee.wallercountyems.com/rsvp'
// Laurel's tracker: christmas_party_attendance_tracker_filled.xlsx on her
// OneDrive (resolved via Graph search 2026-11-09).
const DRIVE_ID = 'b!4zU3Cq_yy0q1LsIu4MNfgMNyxkRySxNHiBNcYAYR9zJfKUsHwJO1Rpbvie6IgTEJ'
const ITEM_ID = '01U62DFY67MVSJNOYMWNFJMQB7QSYZSSFM'
const SHEET = 'Christmas Party RSVPs'
const FIRST_DATA_ROW = 7
const MAX_ROW = 106 // the summary formulas range through row 106

// ── Graph ────────────────────────────────────────────────────────────

async function graphToken(kind: 'GRAPH' | 'LIFECYCLE'): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.get(`${kind}_CLIENT_ID`)!,
    client_secret: env.get(`${kind}_CLIENT_SECRET`)!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(
    `https://login.microsoftonline.com/${env.get('GRAPH_TENANT_ID')}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  )
  if (!res.ok) throw new Error(`token(${kind}) ${res.status}: ${(await res.text()).slice(0, 180)}`)
  return (await res.json()).access_token
}

/** Workbook caller — prefers the GRAPH app (the one that already reads
 *  workbooks), falls back to LIFECYCLE once on 401/403. */
let excelTok: string | null = null
let excelKind: 'GRAPH' | 'LIFECYCLE' = 'GRAPH'
async function excelFetch(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!excelTok) excelTok = await graphToken(excelKind)
  const go = async (tok: string) =>
    await fetch(`https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${ITEM_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  let res = await go(excelTok)
  if ((res.status === 401 || res.status === 403) && excelKind === 'GRAPH') {
    excelKind = 'LIFECYCLE'
    excelTok = await graphToken('LIFECYCLE')
    res = await go(excelTok)
  }
  if (!res.ok) throw new Error(`Graph ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 220)}`)
  return res.status === 204 ? null : await res.json()
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const tok = await graphToken('LIFECYCLE')
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  })
  if (!res.ok) throw new Error(`sendMail ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

// ── workbook row sync ────────────────────────────────────────────────

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '')
}
function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
}

function centralStamp(): string {
  const now = new Date()
  const d = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' }).format(now)
  return `Portal RSVP ${d} ${t}`
}

/** Update (or append) the member's row in Laurel's tracker. */
async function syncRowToWorkbook(input: {
  fullName: string
  employmentType: string | null
  attending: boolean
  headcount: number
  guests: string
  dietary: string
}): Promise<void> {
  const rangeRes = (await excelFetch(
    'GET',
    `/workbook/worksheets('${encodeURIComponent(SHEET)}')/range(address='A1:G${MAX_ROW}')?$select=values`,
  )) as { values: unknown[][] }
  const values = rangeRes.values

  const target = normName(input.fullName)
  const tTokens = nameTokens(input.fullName)
  const tFirst = tTokens[0] ?? ''
  const tLast = tTokens[tTokens.length - 1] ?? ''

  let row = -1 // 1-based sheet row
  let firstEmpty = -1
  for (let r = FIRST_DATA_ROW; r <= MAX_ROW; r++) {
    const cell = String(values[r - 1]?.[0] ?? '').trim()
    if (!cell) {
      if (firstEmpty === -1) firstEmpty = r
      continue
    }
    if (normName(cell) === target) {
      row = r
      break
    }
  }
  if (row === -1) {
    // first + last token match covers middle names/suffixes on either
    // side ("Aaron M.D. Buzzard" vs "Aaron Buzzard")
    for (let r = FIRST_DATA_ROW; r <= MAX_ROW; r++) {
      const toks = nameTokens(String(values[r - 1]?.[0] ?? ''))
      if (toks.length >= 2 && toks[0] === tFirst && toks[toks.length - 1] === tLast) {
        row = r
        break
      }
    }
  }

  const status = input.attending ? 'Yes' : 'No'
  const headcount = input.attending ? input.headcount : 0
  const guests = input.attending ? input.guests : ''
  const dietary = input.attending ? input.dietary : ''

  // keep any hand-written note Laurel left; replace only our own stamp
  const prevNote = row !== -1 ? String(values[row - 1]?.[6] ?? '').trim() : ''
  const kept = prevNote.replace(/Portal RSVP [^·]*$/i, '').replace(/·\s*$/, '').trim()
  const note = (kept ? `${kept} · ` : '') + centralStamp()

  if (row !== -1) {
    await excelFetch(
      'PATCH',
      `/workbook/worksheets('${encodeURIComponent(SHEET)}')/range(address='C${row}:G${row}')`,
      { values: [[status, headcount, guests, dietary, note.slice(0, 250)]] },
    )
  } else {
    // not on her sheet (hired after she built it) — take the first empty
    // row inside the formulas' range so the counts still include them
    const r = firstEmpty !== -1 ? firstEmpty : MAX_ROW
    const dept =
      input.employmentType && /part/i.test(input.employmentType)
        ? 'Paid Staff - Part Time'
        : 'Paid Staff - Full Time'
    await excelFetch(
      'PATCH',
      `/workbook/worksheets('${encodeURIComponent(SHEET)}')/range(address='A${r}:G${r}')`,
      { values: [[input.fullName, dept, status, headcount, guests, dietary, note.slice(0, 250)]] },
    )
  }
}

// ── HTML (page + email) ──────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PAGE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1ea; background: linear-gradient(180deg, #f6f3ec, #efe9dd);
         font: 15px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1d2433; }
  .wrap { max-width: 440px; margin: 0 auto; padding: 28px 16px 48px; }
  .card { background: #fff; border: 1px solid #e3ddd0; border-radius: 6px;
          box-shadow: 0 1px 2px rgba(23,32,56,.06), 0 12px 32px -18px rgba(23,32,56,.25); overflow: hidden; }
  .head { background: #16233f; color: #fff; padding: 22px 22px 18px; }
  .eyebrow { font-size: 10.5px; letter-spacing: .22em; color: #d9b45b; font-weight: 600; margin: 0 0 6px; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 500; font-size: 30px; margin: 0 0 4px; }
  .meta { font-size: 12.5px; color: #c6cddd; margin: 0; }
  .body { padding: 20px 22px 24px; }
  .hi { margin: 0 0 14px; }
  .saved { background: #f2f7f1; border: 1px solid #cfe0cc; color: #2c5a33; border-radius: 5px;
           padding: 8px 12px; font-size: 13px; margin: 0 0 14px; }
  .choices { display: flex; gap: 8px; margin: 0 0 16px; }
  .choice { flex: 1; text-align: center; padding: 12px 8px; border: 1.5px solid #d8d2c4; border-radius: 6px;
            font-weight: 600; font-size: 15px; cursor: pointer; background: #fff; color: #444d61; }
  .choice input { position: absolute; opacity: 0; }
  .choice.on-yes { border-color: #1f5c33; background: #1f5c33; color: #fff; }
  .choice.on-no { border-color: #8c2f2f; background: #8c2f2f; color: #fff; }
  .fld { margin: 0 0 14px; }
  .lbl { display: block; font-size: 10.5px; letter-spacing: .14em; font-weight: 700; color: #7a7363; margin: 0 0 5px; text-transform: uppercase; }
  input[type=text] { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid #d8d2c4; border-radius: 5px; background: #fdfcf9; }
  .step { display: flex; align-items: center; gap: 10px; }
  .step button { width: 44px; height: 44px; font-size: 22px; border: 1px solid #d8d2c4; background: #fff;
                 border-radius: 5px; cursor: pointer; color: #16233f; }
  .step .n { font-size: 26px; font-weight: 700; min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; }
  .step .hint { font-size: 12px; color: #7a7363; }
  .go { width: 100%; font: inherit; font-size: 16px; font-weight: 700; color: #16233f; background: #d9b45b;
        background: linear-gradient(180deg, #e3c272, #d0a848); border: 0; border-radius: 6px; padding: 13px; cursor: pointer; }
  .go:disabled { opacity: .6; }
  .foot { font-size: 11.5px; color: #8a8372; text-align: center; margin: 14px 4px 0; }
  .done { text-align: center; padding: 8px 0 4px; }
  .done .big { font-family: Georgia, serif; font-size: 24px; margin: 6px 0 8px; color: #16233f; }
  .done p { color: #444d61; margin: 0 0 6px; }
  .again { display: inline-block; margin-top: 12px; font-size: 13.5px; color: #16233f; }
`

function pageShell(inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>WCEMS Christmas Party RSVP</title>
<style>${PAGE_CSS}</style></head><body><div class="wrap"><div class="card">
<div class="head"><p class="eyebrow">WALLER COUNTY EMS</p><h1>Christmas Party</h1>
<p class="meta">${EVENT_DATE_TEXT} · RSVP by ${DEADLINE_TEXT}</p></div>
<div class="body">${inner}</div></div>
<p class="foot">Your answer updates the party list automatically. Change it any time —
just open this page again from your email.</p></div></body></html>`
}

interface RsvpRow {
  token: string
  user_id: string
  attending: boolean | null
  headcount: number
  guest_names: string | null
  dietary: string | null
}

function formPage(row: RsvpRow, fullName: string, preset: 'yes' | 'no' | null, justSaved: boolean): string {
  const first = (fullName.split(/\s+/)[0] || 'there')
  const attending = preset ? preset === 'yes' : row.attending
  const yesOn = attending === true
  const noOn = attending === false
  const hc = Math.min(Math.max(row.headcount || 1, 1), 12)

  if (justSaved) {
    const inner =
      row.attending
        ? `<div class="done"><div class="big">You're on the list.</div>
           <p><strong>${row.headcount}</strong> attending${row.headcount > 1 ? ' (including you)' : ''}.</p>
           ${row.guest_names ? `<p>Guests: ${escHtml(row.guest_names)}</p>` : ''}
           <p>See you ${EVENT_DATE_TEXT}.</p>
           <a class="again" href="?t=${row.token}">Change my answer</a></div>`
        : `<div class="done"><div class="big">We'll miss you.</div>
           <p>You're marked as not attending.</p>
           <a class="again" href="?t=${row.token}&a=yes">Changed your mind? RSVP yes</a></div>`
    return pageShell(inner)
  }

  const savedLine =
    row.attending === null
      ? ''
      : `<p class="saved">Saved: ${row.attending ? `attending — ${row.headcount} total` : 'not attending'}. You can update it below.</p>`

  const inner = `
  <p class="hi">Hi ${escHtml(first)} — are you coming to the party?</p>
  ${savedLine}
  <form method="post">
    <input type="hidden" name="t" value="${row.token}">
    <div class="choices">
      <label class="choice ${yesOn ? 'on-yes' : ''}" id="cy">
        <input type="radio" name="attending" value="yes" ${yesOn ? 'checked' : ''}>Yes, I'll be there</label>
      <label class="choice ${noOn ? 'on-no' : ''}" id="cn">
        <input type="radio" name="attending" value="no" ${noOn ? 'checked' : ''}>Can't make it</label>
    </div>
    <div id="yesfields" ${yesOn || attending === null ? '' : 'hidden'}>
      <div class="fld">
        <span class="lbl">How many attending, including you</span>
        <div class="step">
          <button type="button" id="dec" aria-label="fewer">−</button>
          <span class="n" id="num">${hc}</span>
          <button type="button" id="inc" aria-label="more">+</button>
          <span class="hint">family welcome</span>
        </div>
        <input type="hidden" name="headcount" id="hc" value="${hc}">
      </div>
      <div class="fld"><label><span class="lbl">Guest name(s) — optional</span>
        <input type="text" name="guests" maxlength="120" value="${escHtml(row.guest_names ?? '')}" placeholder="e.g. Sam, Riley"></label></div>
      <div class="fld"><label><span class="lbl">Dietary needs / allergies — optional</span>
        <input type="text" name="dietary" maxlength="120" value="${escHtml(row.dietary ?? '')}" placeholder="e.g. gluten-free ×2"></label></div>
    </div>
    <button class="go" type="submit">Save my RSVP</button>
  </form>
  <script>
    var hc=document.getElementById('hc'),num=document.getElementById('num');
    function set(n){n=Math.min(Math.max(n,1),12);hc.value=n;num.textContent=n;}
    document.getElementById('dec').onclick=function(){set(+hc.value-1)};
    document.getElementById('inc').onclick=function(){set(+hc.value+1)};
    var cy=document.getElementById('cy'),cn=document.getElementById('cn'),yf=document.getElementById('yesfields');
    function pick(yes){cy.classList.toggle('on-yes',yes);cn.classList.toggle('on-no',!yes);yf.hidden=!yes;}
    cy.onclick=function(){pick(true)};cn.onclick=function(){pick(false)};
  </script>`
  return pageShell(inner)
}

function emailHtml(first: string, baseUrl: string, token: string): string {
  const yes = `${baseUrl}?t=${token}&a=yes`
  const no = `${baseUrl}?t=${token}&a=no`
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1ede3;">
<div style="display:none;max-height:0;overflow:hidden;">RSVP for the WCEMS Christmas Party — one tap updates the list.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ede3;padding:24px 10px;">
<tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background:#ffffff;border:1px solid #e0d9ca;border-radius:6px;overflow:hidden;">
  <tr><td style="background:#16233f;padding:26px 28px 20px;">
    <div style="font:600 10.5px/1 Arial,sans-serif;letter-spacing:3px;color:#d9b45b;">WALLER COUNTY EMS</div>
    <div style="font:500 34px/1.15 Georgia,'Times New Roman',serif;color:#ffffff;margin-top:8px;">Christmas Party</div>
    <div style="font:13px/1.5 Arial,sans-serif;color:#c6cddd;margin-top:6px;">${EVENT_DATE_TEXT}</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;font:15px/1.6 Arial,sans-serif;color:#2a3040;">
    Hi ${escHtml(first)},<br><br>
    Are you joining us for the Christmas party? Tap an answer below — it updates the
    RSVP list automatically, and if you're bringing family you can tell us how many
    on the next screen.
  </td></tr>
  <tr><td style="padding:18px 28px 6px;" align="center">
    <a href="${yes}" style="display:block;background:#1f5c33;border-radius:6px;color:#ffffff;
       font:700 16px/1 Arial,sans-serif;text-decoration:none;padding:16px 10px;">YES — I'll be there</a>
  </td></tr>
  <tr><td style="padding:10px 28px 22px;" align="center">
    <a href="${no}" style="display:block;background:#ffffff;border:1.5px solid #c9c2b2;border-radius:6px;
       color:#5a6170;font:700 15px/1 Arial,sans-serif;text-decoration:none;padding:14px 10px;">Can't make it</a>
  </td></tr>
  <tr><td style="padding:0 28px 26px;font:12.5px/1.6 Arial,sans-serif;color:#8a8372;">
    Please answer by <strong style="color:#5a6170;">${DEADLINE_TEXT}</strong> — you can change
    your RSVP any time before then by tapping either button again.
  </td></tr>
</table>
<div style="font:11px/1.6 Arial,sans-serif;color:#9a9382;padding:14px 8px;">
  Waller County EMS · sent from the Employee Portal</div>
</td></tr></table></body></html>`
}

// ── main ─────────────────────────────────────────────────────────────

function newToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const buf = new Uint32Array(28)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < 28; i++) out += chars[buf[i] % chars.length]
  return out
}

function htmlResp(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  const sb = createClient(SB_URL, SERVICE_KEY)
  const url = new URL(req.url)
  const baseUrl = PUBLIC_BASE

  try {
    // ── system actions (JSON + x-sync-secret) ────────────────────────
    const ct = req.headers.get('content-type') ?? ''
    if (req.method === 'POST' && ct.includes('application/json')) {
      const secret = env.get('ROSTER_SYNC_SECRET')
      if (!secret || req.headers.get('x-sync-secret') !== secret) {
        return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
      }
      const body = await req.json().catch(() => ({}))

      if (body.action === 'probe') {
        const range = (await excelFetch(
          'GET',
          `/workbook/worksheets('${encodeURIComponent(SHEET)}')/range(address='A6:G7')?$select=values`,
        )) as { values: unknown[][] }
        // same-value write proves ReadWrite without changing content
        await excelFetch('PATCH', `/workbook/worksheets('${encodeURIComponent(SHEET)}')/range(address='G6')`, {
          values: [[String(range.values[0]?.[6] ?? 'Notes')]],
        })
        return Response.json({ ok: true, cred: excelKind, header: range.values[0], firstRow: range.values[1] })
      }

      if (body.action === 'send') {
        const test: string[] = Array.isArray(body.test) ? body.test.map((e: unknown) => String(e).toLowerCase()) : []
        const uRes = await sb
          .from('app_users')
          .select('id, full_name, email, active, account_type')
          .eq('active', true)
        if (uRes.error) return Response.json({ ok: false, error: uRes.error.message }, { status: 500 })
        const people = (uRes.data ?? []).filter(
          (u) => (!u.account_type || u.account_type === 'person') && (u.email ?? '').includes('@'),
        )

        const exRes = await sb.from('party_rsvps').select('user_id, token, attending, email_sent_at').eq('event_key', EVENT_KEY)
        if (exRes.error) return Response.json({ ok: false, error: exRes.error.message }, { status: 500 })
        const byUser = new Map((exRes.data ?? []).map((r) => [r.user_id, r]))

        let sent = 0
        let skipped = 0
        const errors: string[] = []
        for (const u of people) {
          let row = byUser.get(u.id)
          if (!row) {
            const ins = await sb
              .from('party_rsvps')
              .insert({ event_key: EVENT_KEY, user_id: u.id, token: newToken() })
              .select('user_id, token, attending, email_sent_at')
              .single()
            if (ins.error) {
              errors.push(`${u.full_name}: ${ins.error.message}`)
              continue
            }
            row = ins.data
            byUser.set(u.id, row)
          }
          const email = String(u.email).toLowerCase()
          if (test.length > 0 && !test.includes(email)) continue
          if (test.length === 0) {
            if (body.onlyPending && row.attending !== null) { skipped++; continue }
            if (!body.resend && row.email_sent_at) { skipped++; continue }
          }
          try {
            const first = (u.full_name ?? '').split(' ')[0] || 'there'
            await sendMail(email, `Christmas Party — RSVP by Nov 19`, emailHtml(first, baseUrl, row.token))
            await sb.from('party_rsvps').update({ email_sent_at: new Date().toISOString() }).eq('token', row.token)
            sent++
          } catch (e) {
            errors.push(`${u.full_name}: ${e instanceof Error ? e.message : 'send failed'}`)
          }
        }
        return Response.json({ ok: true, people: people.length, sent, skipped, errors })
      }

      return Response.json({ ok: false, error: 'unknown action' }, { status: 400 })
    }

    // ── RSVP page (GET renders only — mail scanners prefetch links) ──
    if (req.method === 'GET') {
      const token = (url.searchParams.get('t') ?? '').trim()
      if (!token) return htmlResp(pageShell('<p>This RSVP link is incomplete — open it from your email again.</p>'), 404)
      const r = await sb
        .from('party_rsvps')
        .select('token, user_id, attending, headcount, guest_names, dietary')
        .eq('event_key', EVENT_KEY)
        .eq('token', token)
        .maybeSingle()
      if (r.error || !r.data) {
        return htmlResp(pageShell('<p>This RSVP link isn’t valid any more. Reply to the party email and we’ll sort you out.</p>'), 404)
      }
      const uRes = await sb.from('app_users').select('full_name').eq('id', r.data.user_id).maybeSingle()
      const a = url.searchParams.get('a')
      return htmlResp(formPage(r.data as RsvpRow, uRes.data?.full_name ?? '', a === 'yes' ? 'yes' : a === 'no' ? 'no' : null, false))
    }

    // ── form submit — the only place an answer is recorded ──────────
    if (req.method === 'POST') {
      const form = await req.formData()
      const token = String(form.get('t') ?? '').trim()
      const attending = String(form.get('attending') ?? '') === 'yes'
      const headcount = Math.min(Math.max(parseInt(String(form.get('headcount') ?? '1'), 10) || 1, 1), 12)
      const guests = String(form.get('guests') ?? '').slice(0, 120).trim()
      const dietary = String(form.get('dietary') ?? '').slice(0, 120).trim()

      const r = await sb
        .from('party_rsvps')
        .select('token, user_id')
        .eq('event_key', EVENT_KEY)
        .eq('token', token)
        .maybeSingle()
      if (r.error || !r.data) return htmlResp(pageShell('<p>This RSVP link isn’t valid any more.</p>'), 404)

      const uRes = await sb
        .from('app_users')
        .select('full_name, employment_type')
        .eq('id', r.data.user_id)
        .maybeSingle()
      const fullName = uRes.data?.full_name ?? ''

      const up = await sb
        .from('party_rsvps')
        .update({
          attending,
          headcount: attending ? headcount : 0,
          guest_names: attending ? guests || null : null,
          dietary: attending ? dietary || null : null,
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('token', token)
        .select('token, user_id, attending, headcount, guest_names, dietary')
        .single()
      if (up.error) return htmlResp(pageShell('<p>Saving failed — give it another try in a minute.</p>'), 500)

      // workbook write is best-effort: the DB row is the record, and a
      // transient Graph failure must not eat someone's RSVP
      let synced = true
      try {
        await syncRowToWorkbook({
          fullName,
          employmentType: (uRes.data?.employment_type as string | null) ?? null,
          attending,
          headcount,
          guests,
          dietary,
        })
      } catch (e) {
        synced = false
        console.error('[party-rsvp] workbook sync failed:', e instanceof Error ? e.message : e)
      }
      if (!synced) {
        await sb.from('party_rsvps').update({ sync_error: true }).eq('token', token)
      } else {
        await sb.from('party_rsvps').update({ sync_error: false }).eq('token', token)
      }

      return htmlResp(formPage(up.data as RsvpRow, fullName, null, true))
    }

    return htmlResp(pageShell('<p>Nothing here.</p>'), 405)
  } catch (e) {
    console.error('[party-rsvp]', e instanceof Error ? e.message : e)
    return htmlResp(pageShell('<p>Something went wrong on our end — try the link again in a minute.</p>'), 500)
  }
})
