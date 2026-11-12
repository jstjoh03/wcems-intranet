// supabase/functions/contact-card/index.ts
//
// Public digital business cards (2026-11-10) — the page behind the QR
// on printed cards. GET /<slug> renders a branded contact page; GET
// /<slug>.vcf returns a live vCard (name/title/phones built from
// app_users + contact_cards overrides at scan time, so reprints are
// never needed for an info change). Photos ride the public
// contact-cards bucket and are embedded into the vCard when small
// enough, so saved contacts carry the face.
//
// Served through the Cloudflare Pages proxy at
// employee.wallercountyems.com/card/<slug> (functions/card/[[path]].js)
// because the Supabase gateway rewrites HTML on *.supabase.co to
// text/plain + CSP sandbox. Deploy verify_jwt FALSE — scanners are
// anonymous; cards are public by design.

// @ts-expect-error resolved at runtime by the Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

const SB_URL = env.get('SUPABASE_URL')!
const SERVICE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SB_URL, SERVICE_KEY)

const ORG = {
  name: 'Waller County EMS',
  office: '(979) 826-6063',
  officeE164: '+19798266063',
  fax: '+19792707170',
  street: '1134 Austin St',
  city: 'Hempstead',
  state: 'TX',
  zip: '77445',
  web: 'https://www.wallercountyems.com',
}
const PATCH_URL = 'https://employee.wallercountyems.com/wcems-patch.png'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function e164(phone: string | null): string | null {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^1/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone
}

/** vCard text values: escape backslash, comma, semicolon, newlines. */
function vEsc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

interface Card {
  slug: string
  fullName: string
  email: string
  titleLines: string[]
  vcardTitle: string
  cell: string | null
  showOffice: boolean
  blurb: string | null
  photoUrl: string | null
}

async function loadCard(slug: string): Promise<Card | null> {
  const { data: row } = await sb
    .from('contact_cards')
    .select('slug, active, title_override, show_cell, cell_override, show_office, blurb, photo_path, user_id')
    .eq('slug', slug)
    .maybeSingle()
  if (!row || !row.active) return null
  const { data: u } = await sb
    .from('app_users')
    .select('full_name, email, phone, title, active')
    .eq('id', row.user_id)
    .maybeSingle()
  if (!u || !u.active) return null
  const rawTitle = (row.title_override as string | null) ?? (u.title as string | null) ?? ''
  // roster titles read "Licensed Paramedic | Clinical Development
  // Officer" — the pipe is a display line break on the card
  const titleLines = rawTitle.split('|').map((t: string) => t.trim()).filter(Boolean)
  const cellRaw = row.show_cell ? ((row.cell_override as string | null) || (u.phone as string | null)) : null
  return {
    slug: row.slug as string,
    fullName: u.full_name as string,
    email: (u.email as string) ?? '',
    titleLines,
    vcardTitle: titleLines.join(' · '),
    cell: cellRaw ? e164(cellRaw) : null,
    showOffice: row.show_office !== false,
    blurb: (row.blurb as string | null) || null,
    photoUrl: row.photo_path
      ? `${SB_URL}/storage/v1/object/public/contact-cards/${row.photo_path}`
      : null,
  }
}

async function buildVcf(c: Card): Promise<string> {
  const [first, ...rest] = c.fullName.split(/\s+/)
  const last = rest.join(' ')
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEsc(last)};${vEsc(first)};;;`,
    `FN:${vEsc(c.fullName)}`,
    `ORG:${vEsc(ORG.name)}`,
  ]
  if (c.vcardTitle) lines.push(`TITLE:${vEsc(c.vcardTitle)}`)
  if (c.cell) lines.push(`TEL;TYPE=CELL:${c.cell}`)
  if (c.showOffice) {
    lines.push(`TEL;TYPE=WORK,VOICE:${ORG.officeE164}`)
    lines.push(`TEL;TYPE=WORK,FAX:${ORG.fax}`)
  }
  if (c.email) lines.push(`EMAIL;TYPE=WORK:${c.email}`)
  lines.push(`ADR;TYPE=WORK:;;${vEsc(ORG.street)};${vEsc(ORG.city)};${ORG.state};${ORG.zip};United States`)
  lines.push(`URL:${ORG.web}`)
  if (c.photoUrl) {
    try {
      /* Server-side downscale via Supabase image transforms (verified
         enabled on this project, 2026-11-12): a 480px render of ANY
         upload fits the embed cap — Justin's original 1.7MB roster PNG
         served a vCard with no photo at all, and relying on members
         re-uploading was the gap. Raw object stays the fallback if the
         render endpoint ever refuses. */
      let res = await fetch(photoRender(c.photoUrl, 480))
      if (!res.ok) res = await fetch(c.photoUrl)
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        // 900KB cap: phones choke on multi-MB vCards.
        if (buf.length > 0 && buf.length <= 900_000) {
          let bin = ''
          for (let i = 0; i < buf.length; i += 0x8000) {
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
          }
          const b64 = btoa(bin)
          // type from the actual bytes — the render keeps the origin
          // format, so the file extension can lie
          const ptype = buf[0] === 0x89 && buf[1] === 0x50 ? 'PNG' : 'JPEG'
          // fold the base64 payload (75-char lines, space continuation)
          const folded = (`PHOTO;TYPE=${ptype};ENCODING=b:${b64}`).replace(/(.{75})/g, '$1\r\n ')
          lines.push(folded.replace(/\r\n $/, ''))
        }
      }
    } catch {
      /* photo embed is a nicety — the card still saves without it */
    }
  }
  lines.push('END:VCARD')
  return lines.join('\r\n') + '\r\n'
}

/** Supabase image-transform URL for a public storage object — the
 *  render endpoint downscales on the fly; format=origin keeps PNG/JPEG
 *  (the auto format can hand back WebP, which contact apps reject).
 *  BOTH dimensions + resize=contain, always: width alone DISTORTS
 *  (1600×2000 came back 240×2000 — squeezed width, original height;
 *  verified live 2026-11-12). contain in a square box keeps the ratio. */
function photoRender(publicUrl: string, box: number): string {
  return `${publicUrl.replace('/object/public/', '/render/image/public/')}?width=${box}&height=${box}&resize=contain&quality=80&format=origin`
}

/* Hand-rolled lucide-style outlines (24-grid, stroke 1.8) — the page is
   standalone HTML with no icon library, and bare text rows read flat
   (Justin, 2026-11-12: "the buttons need to look more polished"). */
const ICONS: Record<string, string> = {
  cell: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  text: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.37-.25-3.4-.7L3 21l1.7-5.1A8.5 8.5 0 1 1 21 11.5Z"/>',
  office: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  save: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
}

function icon(k: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`
}

function page(c: Card): string {
  const cellPretty = c.cell ? prettyPhone(c.cell) : null
  /* Ledger rows, Sortren register: label eyebrow · value · a small
     muted utility glyph at the right (no badge circles — gold lives in
     rules, not fills). valueHtml arrives pre-escaped by the caller. */
  const row = (href: string, ic: string, label: string, valueHtml: string, ext = false) =>
    `<a class="row" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}><span class="k">${label}</span><span class="v">${valueHtml}</span><span class="ric" aria-hidden="true">${icon(ic)}</span></a>`
  const rows: string[] = []
  if (c.cell) {
    rows.push(row(`tel:${c.cell}`, 'cell', 'Cell', cellPretty!))
    rows.push(row(`sms:${c.cell}`, 'text', 'Text', cellPretty!))
  }
  if (c.showOffice) {
    rows.push(row(`tel:${ORG.officeE164}`, 'office', 'Office', ORG.office))
  }
  // <wbr> before the @ so long addresses wrap there, not mid-word
  rows.push(row(`mailto:${esc(c.email)}`, 'email', 'Email', esc(c.email).replace('@', '<wbr>@')))
  rows.push(row(ORG.web, 'web', 'Web', 'wallercountyems.com', true))
  rows.push(row(`https://maps.google.com/?q=${encodeURIComponent(`${ORG.street}, ${ORG.city}, ${ORG.state} ${ORG.zip}`)}`, 'map', 'Visit', `${ORG.street} · ${ORG.city}, ${ORG.state}`, true))

  /* Sortren register (supply portal LoginView/main.css, Justin
     2026-11-12: "sortren style enterprise"): editorial masthead — patch
     + tracked gold eyebrow, one-direction gold hairline, serif name
     with the gold-period accent — over the lit navy (gold spotlight +
     two cool radials on the 135° brand base), framed by the feathered
     3px top rule and 1px soft bottom wash. Below: flat NAVY primary
     button (gold is for rules, never fills), hairline ledger rows,
     Geist with 'cv11'/'ss01' + antialiasing. All oklch tokens
     pre-converted to sRGB — old phone browsers must render this. */
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(c.fullName)} — Waller County EMS</title>
<link rel="icon" href="${PATCH_URL}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
         text-rendering: optimizeLegibility; font-feature-settings: 'cv11', 'ss01'; }
  body { background: #fafaf9; color: #0e1218; min-height: 100vh;
         font: 15px/1.55 'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .hero { position: relative;
          background:
            radial-gradient(ellipse 60% 55% at 72% 40%, rgba(200,164,77,.16), rgba(200,164,77,.07) 35%, transparent 70%),
            radial-gradient(circle at 15% 18%, rgba(0,67,131,.55), transparent 50%),
            radial-gradient(circle at 85% 85%, rgba(0,50,108,.65), transparent 55%),
            linear-gradient(135deg, #002760, #000c29); }
  .rule-top { position: absolute; top: 0; left: 0; right: 0; height: 3px; pointer-events: none;
              background: linear-gradient(90deg, transparent 0%, #c8a44d 18%, #e8cb72 50%, #c8a44d 82%, transparent 100%); }
  .rule-soft { position: absolute; bottom: 0; left: 0; right: 0; height: 1px; pointer-events: none;
               background: linear-gradient(90deg, transparent, rgba(200,164,77,.38), transparent); }
  .hero__wrap { max-width: 560px; margin: 0 auto; padding: 32px 22px 34px; min-width: 0; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand__patch { width: 40px; height: 40px; object-fit: contain;
                  filter: drop-shadow(0 4px 12px rgba(0,0,0,.45)); }
  .brand__word { font-size: 10.5px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
                 color: #c8a44d; opacity: .88; }
  .brand__rule { width: 64px; height: 1px; margin: 16px 0 0;
                 background: linear-gradient(90deg, #c8a44d, rgba(200,164,77,.15) 80%, transparent); }
  .hero__row { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 22px; min-width: 0; }
  .hero__main { flex: 1; min-width: 0; }
  .name { font-family: 'Instrument Serif', ui-serif, Georgia, serif; font-weight: 400; font-size: 42px;
          line-height: 0.98; letter-spacing: -.02em; color: #fff; }
  .name i { font-style: normal; color: #c8a44d; font-weight: 500; }
  .role { font-size: 10.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
          color: #c8a44d; opacity: .88; margin-top: 16px; }
  .role2 { font-size: 13px; color: rgba(255,255,255,.62); margin-top: 5px; letter-spacing: .005em; }
  .mark { flex: none; }
  .avatar { display: block; width: 92px; height: 92px; border-radius: 50%; object-fit: cover; background: #fff;
            border: 1px solid rgba(200,164,77,.55); box-shadow: 0 6px 18px rgba(0,0,0,.55); }
  main { max-width: 560px; margin: 0 auto; padding: 26px 20px 8px; }
  .blurb { font-family: 'Instrument Serif', ui-serif, Georgia, serif; font-style: italic; font-size: 18px;
           color: #373b41; text-align: center; margin: 2px 8px 16px; line-height: 1.4; letter-spacing: -.01em; }
  .blurb-rule { width: 120px; height: 1.5px; margin: 0 auto 22px;
                background: linear-gradient(90deg, transparent 0%, #c8a44d 25%, #e8cb72 50%, #c8a44d 75%, transparent 100%); }
  .save { display: flex; align-items: center; justify-content: center; gap: 9px;
          font-size: 15px; font-weight: 500; letter-spacing: -.005em; color: #fff; text-decoration: none;
          background: #00397f; border-radius: 8px; padding: 13px 16px; margin-bottom: 18px;
          box-shadow: 0 1px 2px -1px rgba(14,18,24,.08);
          transition: background 150ms cubic-bezier(.16,1,.3,1), box-shadow 150ms cubic-bezier(.16,1,.3,1); }
  .save svg { width: 18px; height: 18px; }
  .save:hover { background: #002760;
                box-shadow: 0 2px 4px -2px rgba(14,18,24,.06), 0 4px 8px -2px rgba(14,18,24,.08); }
  .save:active { background: #002760; box-shadow: 0 1px 2px -1px rgba(14,18,24,.08); }
  .card { background: #fff; border: 1px solid #d5d8db; border-radius: 12px; overflow: hidden;
          box-shadow: 0 1px 2px -1px rgba(14,18,24,.08); }
  .row { display: grid; grid-template-columns: 64px 1fr 20px; align-items: center; gap: 14px;
         padding: 13px 16px; text-decoration: none; border-bottom: 1px solid #e6e8ea;
         transition: background 120ms cubic-bezier(.16,1,.3,1); }
  .row:last-child { border-bottom: 0; }
  .row:hover, .row:active { background: #f6f5f2; }
  .k { font-size: 11px; font-weight: 600; letter-spacing: .08em; color: #606369; text-transform: uppercase; }
  .v { font-size: 15px; color: #0e1218; font-weight: 500; letter-spacing: -.005em;
       overflow-wrap: anywhere; line-height: 1.35; font-variant-numeric: tabular-nums; }
  .ric { display: flex; color: #95989d; transition: color 120ms; }
  .ric svg { width: 17px; height: 17px; }
  .row:hover .ric { color: #00397f; }
  .foot { text-align: center; font-size: 10px; font-weight: 600; letter-spacing: .18em;
          text-transform: uppercase; color: #95989d; padding: 26px 8px 34px; }
  @media (max-width: 374px) { .avatar { width: 76px; height: 76px; } .name { font-size: 34px; } }
</style></head><body>
<header class="hero">
  <div class="rule-top" aria-hidden="true"></div>
  <div class="hero__wrap">
    <div class="brand">
      <img class="brand__patch" src="${PATCH_URL}" alt="Waller County EMS patch">
      <span class="brand__word">Waller County EMS</span>
    </div>
    <div class="brand__rule" aria-hidden="true"></div>
    <div class="hero__row">
      <div class="hero__main">
        <h1 class="name">${esc(c.fullName)}<i>.</i></h1>
        ${c.titleLines[c.titleLines.length - 1] ? `<div class="role">${esc(c.titleLines[c.titleLines.length - 1])}</div>` : ''}
        ${c.titleLines.length > 1 ? `<div class="role2">${esc(c.titleLines.slice(0, -1).join(' · '))}</div>` : ''}
      </div>
      ${c.photoUrl ? `<div class="mark"><img class="avatar" src="${esc(photoRender(c.photoUrl, 240))}" onerror="this.onerror=null;this.src='${esc(c.photoUrl)}'" alt=""></div>` : ''}
    </div>
  </div>
  <div class="rule-soft" aria-hidden="true"></div>
</header>
<main>
  ${c.blurb ? `<p class="blurb">${esc(c.blurb)}</p><div class="blurb-rule" aria-hidden="true"></div>` : ''}
  <a class="save" href="/card/${c.slug}.vcf">${icon('save')} Save my contact</a>
  <div class="card">
    ${rows.join('\n    ')}
  </div>
</main>
<div class="foot">EST 1996 · HEMPSTEAD, TEXAS</div>
</body></html>`
}

// @ts-expect-error Deno.serve available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('GET only', { status: 405 })
  try {
    const url = new URL(req.url)
    // path after the function name: /contact-card/<slug>[.vcf]
    const tail = url.pathname.split('/contact-card/')[1] ?? ''
    const wantVcf = tail.endsWith('.vcf')
    const slug = (wantVcf ? tail.slice(0, -4) : tail).toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!slug) return new Response('Not found', { status: 404 })

    const card = await loadCard(slug)
    if (!card) {
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:sans-serif;padding:40px;text-align:center;"><p>This card isn't active.</p><p><a href="${ORG.web}">wallercountyems.com</a></p></body>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }

    if (wantVcf) {
      const vcf = await buildVcf(card)
      return new Response(vcf, {
        status: 200,
        headers: {
          'Content-Type': 'text/vcard; charset=utf-8',
          'Content-Disposition': `inline; filename="${card.slug}.vcf"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return new Response(page(card), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    })
  } catch (e) {
    console.error('[contact-card]', e instanceof Error ? e.message : e)
    return new Response('Error', { status: 500 })
  }
})
