// supabase/functions/m365-lifecycle/index.ts
//
// Stage 3 of the edit-once chain: turns WCEMS Roster List state into real
// Microsoft 365 account actions, using the DEDICATED "WCEMS Lifecycle
// Automation" app registration (User.ReadWrite.All, Group.ReadWrite.All,
// Organization.Read.All, Mail.Send) — the intranet app's credentials are
// used only to read/write the List itself.
//
//   CREATE  — List row with ProvisionM365 = Yes, Status ≠ Separated, and
//             no 'created' marker in M365State → create the Entra account
//             (first.last@wallercountyems.com), random temp password with
//             forceChangePasswordNextSignIn, assign Business Basic + F3,
//             add to Field Staff / Stations / Supplies, build the WELCOME
//             KIT (per-hire folder under "New Hires" in the Admin Staff
//             library: print-ready welcome PDF + personalized onboarding
//             checklist copied from the template), then email the receipt
//             (temp password + welcome PDF attached) to the recipients.
//   SEPARATE — List row with Status = Separated and no 'disabled' marker
//             → disable account, revoke sessions, strip all licenses,
//             email receipt with a signed one-click UNDO link.
//   UNDO    — GET ?action=undo&token=…  re-enables the account, restores
//             standard licenses, sets Status back to Active.
//
// Guard: if more than MAX_SEPARATIONS_PER_RUN separations are pending in
// a single run, process NONE and email an alert instead (protects against
// a corrupted HR sheet cascading through excel-to-list).
//
// Modes: header `x-sync-secret` required for POST. POST {} dry-run;
// POST {"apply":true} executes. Undo links are self-authenticating (HMAC).

// @ts-expect-error npm specifier resolved by the edge runtime
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
// @ts-expect-error npm specifier resolved by the edge runtime
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1'

// @ts-expect-error Deno global
const env = Deno.env

const SP_HOST = 'wcvems.sharepoint.com'
const SP_SITE_PATH = '/sites/AdminStaff'
const LIST_NAME = 'WCEMS Roster'
const WORK_DOMAIN = 'wallercountyems.com'
const SENDER = 'office@wallercountyems.com'
const RECIPIENTS = [
  'justin.stjohn@wallercountyems.com',
  'rhonda.becvar@wallercountyems.com',
  'tori.bell@wallercountyems.com',
]
const LICENSE_SKUS = ['O365_BUSINESS_ESSENTIALS', 'SPE_F1'] // Business Basic + Microsoft 365 F3
const GROUPS = ['Field Staff', 'Stations', 'Supplies']
const MAX_SEPARATIONS_PER_RUN = 3
// Welcome kit: per-hire folder in the Admin Staff site's Documents library
const NEW_HIRES_FOLDER = 'New Hires'
const TEMPLATE_FILE = 'Onboarding Checklist Template.xlsx'

async function token(clientId: string, secret: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId, client_secret: secret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  })
  const res = await fetch(`https://login.microsoftonline.com/${env.get('GRAPH_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  })
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 250)}`)
  return (await res.json()).access_token
}
const siteToken = () => token(env.get('GRAPH_CLIENT_ID')!, env.get('GRAPH_CLIENT_SECRET')!)
const lifeToken = () => token(env.get('LIFECYCLE_CLIENT_ID')!, env.get('LIFECYCLE_CLIENT_SECRET')!)

async function g(tok: string, method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 404) return { __notFound: true }
  if (!res.ok) throw new Error(`Graph ${res.status} ${method} ${url.split('?')[0].slice(-70)}: ${(await res.text()).slice(0, 250)}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function norm(name: string): string {
  let s = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (s.includes(',')) {
    const last = s.split(',')[0], first = s.split(',')[1]
    s = `${(first ?? '').trim()} ${last.trim()}`
  }
  return s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function workEmail(n: string): string {
  const t = n.split(' ')
  return `${t[0]}.${t.slice(1).join('')}@${WORK_DOMAIN}`
}
function displayFromTitle(title: string): { display: string; given: string; surname: string } {
  if (title.includes(',')) {
    const last = title.split(',')[0].trim(), first = title.split(',')[1].trim()
    return { display: `${first} ${last}`, given: first, surname: last }
  }
  const t = title.trim().split(/\s+/)
  return { display: title.trim(), given: t[0], surname: t.slice(1).join(' ') }
}

function tempPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ', lower = 'abcdefghjkmnpqrstuvwxyz', digits = '23456789'
  const all = upper + lower + digits
  const buf = new Uint32Array(12)
  crypto.getRandomValues(buf)
  let p = 'Wc' + upper[buf[0] % upper.length]
  for (let i = 1; i < 10; i++) p += all[buf[i] % all.length]
  return p + digits[buf[11] % digits.length] + '!'
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.get('ROSTER_SYNC_SECRET')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function makeUndoToken(upn: string, itemId: string): Promise<string> {
  const payload = btoa(JSON.stringify({ u: upn, i: itemId, exp: Date.now() + 7 * 86400_000 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${payload}.${await hmac(payload)}`
}
async function readUndoToken(tok: string): Promise<{ u: string; i: string } | null> {
  const [payload, sig] = tok.split('.')
  if (!payload || !sig) return null
  if ((await hmac(payload)) !== sig) return null
  const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  if (data.exp < Date.now()) return null
  return data
}

async function sendMail(life: string, subject: string, html: string,
  opts?: { attachments?: Array<{ name: string; bytes: Uint8Array }>; to?: string[] }) {
  await g(life, 'POST', `https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`, {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: (opts?.to ?? RECIPIENTS).map((a) => ({ emailAddress: { address: a } })),
      ...(opts?.attachments?.length
        ? {
            attachments: opts.attachments.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.name,
              contentType: a.name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
              contentBytes: b64(a.bytes),
            })),
          }
        : {}),
    },
    saveToSentItems: false,
  })
}

// ── Welcome kit: per-hire folder + welcome PDF + checklist copy ──────

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// Graph drive helpers (binary bodies — g() only speaks JSON)
const drivePath = (siteId: string, path: string) =>
  `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}`
async function gBytes(tok: string, url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
  if (!res.ok) throw new Error(`Graph ${res.status} GET ${url.split('?')[0].slice(-70)}`)
  return new Uint8Array(await res.arrayBuffer())
}
async function putBytes(tok: string, url: string, bytes: Uint8Array, contentType: string): Promise<any> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': contentType },
    body: bytes,
  })
  if (!res.ok) throw new Error(`Graph ${res.status} PUT ${url.split('?')[0].slice(-70)}: ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

// Instrument Serif for the display type; falls back to Times if the font
// CDN is unreachable (the sheet still renders, just less on-brand).
let cachedSerif: Uint8Array | null | undefined
async function fetchSerifFont(): Promise<Uint8Array | null> {
  if (cachedSerif !== undefined) return cachedSerif
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Instrument+Serif')).text()
    const m = css.match(/url\((https:[^)]+\.ttf)\)/)
    if (m) {
      const r = await fetch(m[1])
      if (r.ok) { cachedSerif = new Uint8Array(await r.arrayBuffer()); return cachedSerif }
    }
  } catch (_) { /* fall through */ }
  cachedSerif = null
  return null
}

// WCEMS patch, served by the deployed intranet; welcome sheet renders
// without it if the fetch fails.
let cachedLogo: Uint8Array | null | undefined
async function fetchLogo(): Promise<Uint8Array | null> {
  if (cachedLogo !== undefined) return cachedLogo
  try {
    const r = await fetch('https://employee.wallercountyems.com/wcems-patch.png')
    cachedLogo = r.ok ? new Uint8Array(await r.arrayBuffer()) : null
  } catch (_) { cachedLogo = null }
  return cachedLogo
}

function wrapText(text: string, font: any, size: number, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) > max && cur) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}
function drawTracked(page: any, text: string, x: number, y: number, font: any, size: number, color: any, tracking: number) {
  let cx = x
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + tracking
  }
}

async function buildWelcomePdf(given: string, upn: string, pwd: string): Promise<Uint8Array> {
  const NAVY = rgb(0.106, 0.165, 0.290), GOLD = rgb(0.784, 0.643, 0.302), GOLDBRIGHT = rgb(0.910, 0.796, 0.447)
  const CREAM = rgb(0.980, 0.969, 0.941), INK = NAVY, MUTE = rgb(0.42, 0.44, 0.48), WHITE = rgb(1, 1, 1)
  const HAZE = rgb(0.82, 0.85, 0.91), CARDBORDER = rgb(0.87, 0.83, 0.72)

  const doc = await PDFDocument.create()
  let serif: any
  const serifBytes = await fetchSerifFont()
  if (serifBytes) { doc.registerFontkit(fontkit); serif = await doc.embedFont(serifBytes) }
  else serif = await doc.embedFont(StandardFonts.TimesRomanBold)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: CREAM })

  // header band
  page.drawRectangle({ x: 0, y: 612, width: 612, height: 180, color: NAVY })
  page.drawRectangle({ x: 0, y: 609.5, width: 612, height: 2.5, color: GOLD })
  drawTracked(page, 'WALLER COUNTY EMS  •  NEW EMPLOYEE', 48, 752, sansBold, 8.5, GOLDBRIGHT, 1.7)
  page.drawText(`Welcome, ${given}!`, { x: 46, y: 700, size: 40, font: serif, color: WHITE })
  page.drawText('Empowering health and safety through prompt, compassionate', { x: 48, y: 668, size: 10.5, font: sans, color: HAZE })
  page.drawText('prehospital care in our community.', { x: 48, y: 654, size: 10.5, font: sans, color: HAZE })
  const logoBytes = await fetchLogo()
  if (logoBytes) {
    const logo = await doc.embedPng(logoBytes)
    const lh = 118, lw = (logo.width / logo.height) * lh
    page.drawImage(logo, { x: 612 - 48 - lw, y: 612 + (180 - lh) / 2, width: lw, height: lh })
  }

  // credentials card
  page.drawRectangle({ x: 48, y: 492, width: 516, height: 96, color: WHITE, borderColor: CARDBORDER, borderWidth: 1 })
  page.drawRectangle({ x: 48, y: 492, width: 3, height: 96, color: GOLD })
  drawTracked(page, 'YOUR LOGIN CREDENTIALS', 68, 566, sansBold, 8, GOLD, 1.5)
  page.drawText('Email', { x: 68, y: 546, size: 8.5, font: sans, color: MUTE })
  page.drawText(upn, { x: 68, y: 532, size: 12.5, font: sansBold, color: INK })
  page.drawText('Temporary password', { x: 340, y: 546, size: 8.5, font: sans, color: MUTE })
  page.drawText(pwd, { x: 340, y: 532, size: 12.5, font: sansBold, color: INK })
  page.drawText('You will be prompted to create a new password the first time you sign in.', { x: 68, y: 506, size: 9, font: sans, color: MUTE })

  // left column: getting started
  page.drawText('Getting Started', { x: 48, y: 448, size: 19, font: serif, color: INK })
  page.drawRectangle({ x: 48, y: 440, width: 44, height: 2, color: GOLD })
  const steps = [
    'Go to www.office.com and select Sign in.',
    'Enter your work email and temporary password.',
    'Create a new password and complete Microsoft Authenticator setup.',
    'Once signed in, click Apps in the left sidebar.',
    'Launch Outlook for email and Teams for messaging and meetings.',
  ]
  let sy = 408
  steps.forEach((s, i) => {
    page.drawCircle({ x: 58, y: sy + 3, size: 9, color: GOLD })
    const n = String(i + 1)
    page.drawText(n, { x: 58 - sansBold.widthOfTextAtSize(n, 10) / 2, y: sy - 0.5, size: 10, font: sansBold, color: WHITE })
    const lines = wrapText(s, sans, 10.5, 232)
    lines.forEach((ln, j) => page.drawText(ln, { x: 76, y: sy - j * 13.5, size: 10.5, font: sans, color: INK }))
    sy -= Math.max(lines.length * 13.5, 14) + 17
  })

  // right column: on your phone
  page.drawRectangle({ x: 348, y: 288, width: 216, height: 172, color: NAVY })
  page.drawRectangle({ x: 348, y: 458, width: 216, height: 2, color: GOLD })
  drawTracked(page, 'ON YOUR PHONE', 366, 434, sansBold, 8, GOLDBRIGHT, 1.5)
  const phone = [
    'Download the Outlook and Teams apps from the App Store or Google Play.',
    'Sign in using your work email and your new password.',
    'For Outlook, choose "Sign in with work account" if prompted.',
  ]
  let py = 412
  for (const p of phone) {
    page.drawCircle({ x: 370, y: py + 3, size: 1.8, color: GOLDBRIGHT })
    const lines = wrapText(p, sans, 9.5, 172)
    lines.forEach((ln, j) => page.drawText(ln, { x: 380, y: py - j * 12.5, size: 9.5, font: sans, color: WHITE }))
    py -= lines.length * 12.5 + 10
  }

  // authenticator tip card
  page.drawRectangle({ x: 348, y: 196, width: 216, height: 74, color: WHITE, borderColor: CARDBORDER, borderWidth: 1 })
  page.drawRectangle({ x: 348, y: 196, width: 3, height: 74, color: GOLD })
  drawTracked(page, 'AUTHENTICATOR TIP', 364, 250, sansBold, 8, GOLD, 1.5)
  const tip = wrapText('Keep the Authenticator app on your phone. You may be asked to approve future logins on new devices.', sans, 9.5, 180)
  tip.forEach((ln, j) => page.drawText(ln, { x: 364, y: 232 - j * 12.5, size: 9.5, font: sans, color: MUTE }))

  // footer band
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 64, color: NAVY })
  page.drawRectangle({ x: 0, y: 64, width: 612, height: 2, color: GOLD })
  drawTracked(page, 'NEED ADDITIONAL ASSISTANCE?', 48, 40, sansBold, 8, GOLDBRIGHT, 1.5)
  page.drawText('Clinical Development Officer St. John   •   justin.stjohn@wallercountyems.com   •   281.546.1311', { x: 48, y: 22, size: 10, font: sans, color: WHITE })

  return await doc.save()
}

interface HireKit { folderName: string; folderUrl: string; pdf: Uint8Array; warnings: string[] }
async function buildHireKit(siteTok: string, siteId: string,
  hire: { title: string; display: string; given: string; upn: string; pwd: string }): Promise<HireKit> {
  const warnings: string[] = []
  const folderName = hire.title.replace(/[\\/:*?"<>|#%]/g, '').trim() || hire.display
  const root = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root`

  // ensure "New Hires" + per-hire folder exist (409 name-exists is fine)
  try { await g(siteTok, 'POST', `${root}/children`, { name: NEW_HIRES_FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) } catch (_) { /* exists */ }
  try { await g(siteTok, 'POST', `${drivePath(siteId, NEW_HIRES_FOLDER)}:/children`, { name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) } catch (_) { /* exists */ }
  const folder = await g(siteTok, 'GET', drivePath(siteId, `${NEW_HIRES_FOLDER}/${folderName}`))

  // personalized checklist from the template
  try {
    const tpl = await gBytes(siteTok, `${drivePath(siteId, `${NEW_HIRES_FOLDER}/${TEMPLATE_FILE}`)}:/content`)
    const item = await putBytes(siteTok,
      `${drivePath(siteId, `${NEW_HIRES_FOLDER}/${folderName}/Onboarding - ${folderName}.xlsx`)}:/content`,
      tpl, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    try {
      // explicit workbook session, closed when done — sessionless PATCHes
      // leave a server-side lock that 423s later overwrites of the file
      const wbRoot = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${item.id}/workbook`
      const sess = await g(siteTok, 'POST', `${wbRoot}/createSession`, { persistChanges: true })
      const sh = { 'workbook-session-id': sess.id }
      try {
        await g(siteTok, 'PATCH', `${wbRoot}/worksheets('Onboarding')/range(address='A1')`, { values: [[`New Hire Onboarding  •  ${hire.display}`]] }, sh)
        await g(siteTok, 'PATCH', `${wbRoot}/worksheets('Onboarding')/range(address='A2')`, { values: [[`Microsoft 365 account created ${new Date().toISOString().slice(0, 10)} — sign-in ${hire.upn}`]] }, sh)
      } finally {
        try { await g(siteTok, 'POST', `${wbRoot}/closeSession`, {}, sh) } catch (_) { /* best effort */ }
      }
    } catch (e) { warnings.push(`checklist personalization: ${(e as Error).message}`) }
  } catch (e) { warnings.push(`checklist copy: ${(e as Error).message}`) }

  // welcome PDF
  const pdf = await buildWelcomePdf(hire.given, hire.upn, hire.pwd)
  try {
    await putBytes(siteTok, `${drivePath(siteId, `${NEW_HIRES_FOLDER}/${folderName}/Welcome - ${hire.display}.pdf`)}:/content`, pdf, 'application/pdf')
  } catch (e) { warnings.push(`welcome PDF upload: ${(e as Error).message}`) }

  return { folderName, folderUrl: folder?.webUrl ?? '', pdf, warnings }
}

interface Ctx {
  site: any; listId: string; K: (d: string) => string
  siteTok: string
}
async function listCtx(siteTok: string): Promise<Ctx> {
  const site = await g(siteTok, 'GET', `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`)
  const lists = await g(siteTok, 'GET', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists?$filter=displayName eq '${LIST_NAME}'`)
  const listId = lists.value[0].id
  const cols = await g(siteTok, 'GET', `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${listId}/columns`)
  const internal: Record<string, string> = {}
  for (const c of cols.value ?? []) {
    if (c.readOnly) continue
    if (!(c.displayName in internal)) internal[c.displayName] = c.name
  }
  return { site, listId, K: (d) => internal[d] ?? d, siteTok }
}
async function setFields(ctx: Ctx, itemId: string, fields: Record<string, unknown>) {
  await g(ctx.siteTok, 'PATCH', `https://graph.microsoft.com/v1.0/sites/${ctx.site.id}/lists/${ctx.listId}/items/${itemId}/fields`, fields)
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // ── Undo link (GET, self-authenticated) ────────────────────────────
  if (req.method === 'GET' && url.searchParams.get('action') === 'undo') {
    const data = await readUndoToken(url.searchParams.get('token') ?? '')
    if (!data) return new Response('<h2>Link invalid or expired.</h2>', { status: 400, headers: { 'Content-Type': 'text/html' } })
    try {
      const life = await lifeToken()
      const user = await g(life, 'GET', `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(data.u)}?$select=id,displayName,accountEnabled`)
      if (user.__notFound) return new Response('<h2>Account not found.</h2>', { status: 404, headers: { 'Content-Type': 'text/html' } })
      await g(life, 'PATCH', `https://graph.microsoft.com/v1.0/users/${user.id}`, { accountEnabled: true })
      const skus = await g(life, 'GET', 'https://graph.microsoft.com/v1.0/subscribedSkus')
      const add = (skus.value ?? []).filter((s: any) => LICENSE_SKUS.includes(s.skuPartNumber)).map((s: any) => ({ skuId: s.skuId }))
      if (add.length) {
        try { await g(life, 'POST', `https://graph.microsoft.com/v1.0/users/${user.id}/assignLicense`, { addLicenses: add, removeLicenses: [] }) } catch (_) { /* license pool may be empty */ }
      }
      const ctx = await listCtx(await siteToken())
      await setFields(ctx, data.i, { [ctx.K('Status')]: 'Active', [ctx.K('M365State')]: `re-enabled ${new Date().toISOString().slice(0, 16)}Z via undo` })
      const life2 = await lifeToken()
      await sendMail(life2, `Restored: ${user.displayName}`, `<p><b>${user.displayName}</b> was restored via the undo link. Account re-enabled, standard licenses re-added, roster status set back to Active.</p>`)
      return new Response(`<h2>${user.displayName} restored.</h2><p>Account re-enabled and roster status set back to Active. A confirmation email was sent.</p>`, { headers: { 'Content-Type': 'text/html' } })
    } catch (err) {
      return new Response(`<h2>Restore failed</h2><p>${(err as Error).message}</p>`, { status: 500, headers: { 'Content-Type': 'text/html' } })
    }
  }

  // ── Sync run (POST, secret-gated) ──────────────────────────────────
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || req.headers.get('x-sync-secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  let body: any = {}
  try { body = await req.json() } catch (_) { /* dry run */ }
  const apply = body?.apply === true

  // ── Kit mode: (re)build the welcome kit for an EXISTING account ────
  // POST {"kit": "Last, First"} — for hires created before the kit
  // feature existed, or to regenerate a lost kit. Resets the temp
  // password (forceChangePasswordNextSignIn) so the printed sheet is
  // valid; the receipt goes to the normal recipients.
  if (typeof body?.kit === 'string' && body.kit.trim()) {
    try {
      const [sTok, life] = await Promise.all([siteToken(), lifeToken()])
      const ctx = await listCtx(sTok)
      const wantNorm = norm(body.kit)
      let row: { id: string; title: string } | null = null
      let next2: string | undefined = `https://graph.microsoft.com/v1.0/sites/${ctx.site.id}/lists/${ctx.listId}/items?expand=fields&$top=200`
      while (next2 && !row) {
        const data = await g(sTok, 'GET', next2)
        for (const it of data.value ?? []) {
          const t = it.fields?.[ctx.K('Title')]
          if (t && norm(String(t)) === wantNorm) { row = { id: it.id, title: String(t) }; break }
        }
        next2 = data['@odata.nextLink']
      }
      if (!row) throw new Error(`no List row matches "${body.kit}"`)
      const { display, given } = displayFromTitle(row.title)
      const upn = workEmail(norm(row.title))
      const user = await g(life, 'GET', `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,displayName`)
      if (user.__notFound) throw new Error(`no M365 account at ${upn} — use the normal create flow (ProvisionM365=Yes) instead`)
      const pwd = tempPassword()
      await g(life, 'PATCH', `https://graph.microsoft.com/v1.0/users/${user.id}`, {
        passwordProfile: { password: pwd, forceChangePasswordNextSignIn: true },
      })
      const kit = await buildHireKit(sTok, ctx.site.id, { title: row.title, display, given, upn, pwd })
      await sendMail(life, `Welcome kit: ${display}`,
        `<p><b>${display}</b> — welcome kit generated for the existing account <b>${upn}</b>.</p>
         <ul><li>Temporary password was <b>reset</b> to: <b>${pwd}</b> (must be changed at first sign-in — any earlier temp password no longer works)</li>
         ${kit.folderUrl ? `<li>New-hire folder (welcome sheet + onboarding checklist): <a href="${kit.folderUrl}">New Hires / ${kit.folderName}</a></li>` : ''}</ul>
         <p>The print-ready welcome sheet is attached — hand it out on day 1.</p>
         ${kit.warnings.length ? `<p style="color:#a00"><b>Warnings:</b> ${kit.warnings.join('; ')}</p>` : ''}`,
        { attachments: [{ name: `Welcome - ${display}.pdf`, bytes: kit.pdf }] })
      return new Response(JSON.stringify({ ok: true, kit: row.title, upn, folderUrl: kit.folderUrl, warnings: kit.warnings }, null, 2),
        { headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, kit: body.kit, error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // ── Test mode: build a sample welcome kit, email only Justin ───────
  if (body?.test === 'welcome') {
    try {
      const [sTok, life] = await Promise.all([siteToken(), lifeToken()])
      const site = await g(sTok, 'GET', `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`)
      const kit = await buildHireKit(sTok, site.id, {
        title: '_TEST Hire (safe to delete)', display: 'Test Hire', given: 'Test',
        upn: 'test.hire@wallercountyems.com', pwd: 'Sample-Not-Real-1!',
      })
      await sendMail(life, 'TEST — new-hire welcome kit preview',
        `<p>Preview of the automatic new-hire kit. Folder: <a href="${kit.folderUrl}">New Hires / ${kit.folderName}</a></p>
         ${kit.warnings.length ? `<p style="color:#a00"><b>Warnings:</b> ${kit.warnings.join('; ')}</p>` : ''}`,
        { attachments: [{ name: 'Welcome - Test Hire.pdf', bytes: kit.pdf }], to: ['justin.stjohn@wallercountyems.com'] })
      return new Response(JSON.stringify({ ok: true, test: 'welcome', folderUrl: kit.folderUrl, warnings: kit.warnings }, null, 2),
        { headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, test: 'welcome', error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }

  try {
    const [sTok, life] = await Promise.all([siteToken(), lifeToken()])
    const ctx = await listCtx(sTok)

    // Resolve SKUs + groups up front (also serves as config validation)
    const skus = await g(life, 'GET', 'https://graph.microsoft.com/v1.0/subscribedSkus')
    const skuMap = new Map((skus.value ?? []).map((s: any) => [s.skuPartNumber, s]))
    const resolvedSkus = LICENSE_SKUS.map((p) => {
      const s = skuMap.get(p) as any
      return s ? { part: p, skuId: s.skuId, available: (s.prepaidUnits?.enabled ?? 0) - (s.consumedUnits ?? 0) } : { part: p, missing: true }
    })
    const groupIds: Array<{ name: string; id?: string; missing?: boolean }> = []
    for (const name of GROUPS) {
      const r = await g(life, 'GET', `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${name.replace(/'/g, "''")}'&$select=id,displayName`)
      groupIds.push(r.value?.length ? { name, id: r.value[0].id } : { name, missing: true })
    }

    // Read the List
    interface Row { id: string; title: string; norm: string; status: string; provision: string; state: string }
    const rows: Row[] = []
    let next: string | undefined = `https://graph.microsoft.com/v1.0/sites/${ctx.site.id}/lists/${ctx.listId}/items?expand=fields&$top=200`
    while (next) {
      const data = await g(sTok, 'GET', next)
      for (const it of data.value ?? []) {
        const f = it.fields ?? {}
        const title = f[ctx.K('Title')]
        if (!title || !String(title).includes(',')) continue
        rows.push({
          id: it.id, title: String(title), norm: norm(String(title)),
          status: String(f[ctx.K('Status')] ?? 'Active') || 'Active',
          provision: String(f[ctx.K('ProvisionM365')] ?? ''),
          state: String(f[ctx.K('M365State')] ?? ''),
        })
      }
      next = data['@odata.nextLink']
    }

    const pendingSeparations = rows.filter((r) => r.status === 'Separated' && !r.state.startsWith('disabled') && !r.state.startsWith('separation'))
    const pendingCreates = rows.filter((r) => r.provision === 'Yes' && r.status !== 'Separated' && !r.state.startsWith('created') && !r.state.startsWith('exists'))

    const report: any = {
      ok: true, applied: apply,
      licenses: resolvedSkus, groups: groupIds,
      separations: pendingSeparations.map((r) => ({ name: r.title, upn: workEmail(r.norm) })),
      creates: pendingCreates.map((r) => ({ name: r.title, upn: workEmail(r.norm) })),
      actions: [] as string[],
    }

    if (pendingSeparations.length > MAX_SEPARATIONS_PER_RUN) {
      report.halted = `${pendingSeparations.length} separations pending exceeds guard of ${MAX_SEPARATIONS_PER_RUN} — nothing processed`
      if (apply) {
        await sendMail(life, 'ALERT: roster separation guard tripped',
          `<p><b>${pendingSeparations.length} people</b> are marked Separated and unprocessed — more than the safety limit of ${MAX_SEPARATIONS_PER_RUN} in one pass. No accounts were touched.</p><p>If this is intentional, process them a few at a time (or ask Claude to raise the guard). If not, check HR's Master Roster for accidental deletions.</p>`)
        report.actions.push('alert email sent')
      }
      return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
    }

    if (apply) {
      for (const r of pendingSeparations) {
        const upn = workEmail(r.norm)
        const user = await g(life, 'GET', `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,displayName,accountEnabled,assignedLicenses`)
        if (user.__notFound) {
          await setFields(ctx, r.id, { [ctx.K('M365State')]: `separation: no account found (${upn})` })
          await sendMail(life, `Offboarding: no M365 account found for ${r.title}`,
            `<p><b>${r.title}</b> is marked Separated but no account exists at <b>${upn}</b>. App access is deactivated by the roster sync; check Entra manually if they use a different address.</p>`)
          report.actions.push(`no account: ${upn}`)
          continue
        }
        await g(life, 'PATCH', `https://graph.microsoft.com/v1.0/users/${user.id}`, { accountEnabled: false })
        try { await g(life, 'POST', `https://graph.microsoft.com/v1.0/users/${user.id}/revokeSignInSessions`, {}) } catch (_) { /* non-fatal */ }
        const remove = (user.assignedLicenses ?? []).map((l: any) => l.skuId)
        if (remove.length) {
          try { await g(life, 'POST', `https://graph.microsoft.com/v1.0/users/${user.id}/assignLicense`, { addLicenses: [], removeLicenses: remove }) } catch (_) { /* group-based licenses can't be removed directly */ }
        }
        await setFields(ctx, r.id, { [ctx.K('M365State')]: `disabled ${new Date().toISOString().slice(0, 16)}Z` })
        const undo = await makeUndoToken(upn, r.id)
        const undoUrl = `https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/m365-lifecycle?action=undo&token=${undo}`
        await sendMail(life, `Offboarded: ${user.displayName}`,
          `<p><b>${user.displayName}</b> — offboarded at ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} (Central).</p>
           <ul><li>Microsoft 365 account disabled, sessions revoked</li><li>Licenses reclaimed (${remove.length})</li><li>App access deactivated by roster sync within 5 minutes</li></ul>
           <p>Deleted or flagged by mistake? <a href="${undoUrl}">Restore this account</a> — one-time link, expires in 7 days.</p>`)
        report.actions.push(`disabled: ${upn}`)
      }

      for (const r of pendingCreates) {
        const upn = workEmail(r.norm)
        const existing = await g(life, 'GET', `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,displayName`)
        if (!existing.__notFound) {
          await setFields(ctx, r.id, { [ctx.K('M365State')]: `exists (linked ${new Date().toISOString().slice(0, 10)})`, [ctx.K('ProvisionM365')]: 'No' })
          report.actions.push(`already exists: ${upn}`)
          continue
        }
        const { display, given, surname } = displayFromTitle(r.title)
        const pwd = tempPassword()
        const created = await g(life, 'POST', 'https://graph.microsoft.com/v1.0/users', {
          accountEnabled: true, displayName: display, givenName: given, surname,
          mailNickname: upn.split('@')[0], userPrincipalName: upn, usageLocation: 'US',
          passwordProfile: { password: pwd, forceChangePasswordNextSignIn: true },
        })
        const add = resolvedSkus.filter((s: any) => s.skuId).map((s: any) => ({ skuId: s.skuId }))
        const failures: string[] = []
        if (add.length) {
          try { await g(life, 'POST', `https://graph.microsoft.com/v1.0/users/${created.id}/assignLicense`, { addLicenses: add, removeLicenses: [] }) }
          catch (e) { failures.push(`license assignment: ${(e as Error).message}`) }
        }
        for (const gr of groupIds) {
          if (!gr.id) { failures.push(`group not found: ${gr.name}`); continue }
          try { await g(life, 'POST', `https://graph.microsoft.com/v1.0/groups/${gr.id}/members/$ref`, { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${created.id}` }) }
          catch (e) { failures.push(`group ${gr.name}: ${(e as Error).message}`) }
        }
        let kit: HireKit | null = null
        try {
          kit = await buildHireKit(ctx.siteTok, ctx.site.id, { title: r.title, display, given, upn, pwd })
          failures.push(...kit.warnings)
        } catch (e) { failures.push(`welcome kit: ${(e as Error).message}`) }
        await setFields(ctx, r.id, { [ctx.K('M365State')]: `created ${new Date().toISOString().slice(0, 16)}Z${failures.length ? ' (with warnings)' : ''}`, [ctx.K('ProvisionM365')]: 'No' })
        await sendMail(life, `New account: ${display}`,
          `<p><b>${display}</b> — Microsoft 365 account created.</p>
           <ul><li>Sign-in: <b>${upn}</b></li><li>Temporary password: <b>${pwd}</b> (must be changed at first sign-in)</li>
           <li>Licenses: Business Basic + F3</li><li>Groups: ${GROUPS.join(', ')}</li>
           ${kit?.folderUrl ? `<li>New-hire folder (welcome sheet + onboarding checklist): <a href="${kit.folderUrl}">New Hires / ${kit.folderName}</a></li>` : ''}</ul>
           ${kit ? '<p>The print-ready welcome sheet is attached — hand it out on day 1.</p>' : ''}
           ${failures.length ? `<p style="color:#a00"><b>Warnings:</b> ${failures.join('; ')}</p>` : ''}
           <p>App accounts (intranet, training, uniforms) follow automatically within 5 minutes.</p>`,
          kit ? { attachments: [{ name: `Welcome - ${display}.pdf`, bytes: kit.pdf }] } : undefined)
        report.actions.push(`created: ${upn}${failures.length ? ' (warnings)' : ''}`)
      }
    }

    return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
