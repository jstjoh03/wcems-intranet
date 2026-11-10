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
      const res = await fetch(c.photoUrl)
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        /* 900KB cap: phones choke on multi-MB vCards. The admin uploader
           compresses every photo to ~800px JPEG, so real uploads land
           far under this — the cap only guards strays. */
        if (buf.length > 0 && buf.length <= 900_000) {
          let bin = ''
          for (let i = 0; i < buf.length; i += 0x8000) {
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
          }
          const b64 = btoa(bin)
          const ptype = c.photoUrl.toLowerCase().endsWith('.png') ? 'PNG' : 'JPEG'
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

function page(c: Card): string {
  const cellPretty = c.cell ? prettyPhone(c.cell) : null
  const rows: string[] = []
  if (c.cell) {
    rows.push(`<a class="row" href="tel:${c.cell}"><span class="k">Cell</span><span class="v">${cellPretty}</span></a>`)
    rows.push(`<a class="row" href="sms:${c.cell}"><span class="k">Text</span><span class="v">${cellPretty}</span></a>`)
  }
  if (c.showOffice) {
    rows.push(`<a class="row" href="tel:${ORG.officeE164}"><span class="k">Office</span><span class="v">${ORG.office}</span></a>`)
  }
  // <wbr> before the @ so long addresses wrap there, not mid-word
  rows.push(`<a class="row" href="mailto:${esc(c.email)}"><span class="k">Email</span><span class="v">${esc(c.email).replace('@', '<wbr>@')}</span></a>`)
  rows.push(`<a class="row" href="${ORG.web}" target="_blank" rel="noopener"><span class="k">Web</span><span class="v">wallercountyems.com</span></a>`)
  rows.push(`<a class="row" href="https://maps.google.com/?q=${encodeURIComponent(`${ORG.street}, ${ORG.city}, ${ORG.state} ${ORG.zip}`)}" target="_blank" rel="noopener"><span class="k">Visit</span><span class="v">${ORG.street} · ${ORG.city}, ${ORG.state}</span></a>`)

  /* Mirrors the portal dashboard hero (Hero.vue): the "lit surface"
     navy — three radial highlights over the 135° brand gradient — with
     the gold eyebrow, white Instrument Serif name, a gold-haloed
     photo/patch in the right slot, the feathered gold seam, and the
     content below on the warm canvas. Token values are the portal's
     oklch tokens converted to sRGB (no oklch: older phone browsers
     scanning a printed card must render this). */
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(c.fullName)} — Waller County EMS</title>
<link rel="icon" href="${PATCH_URL}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #fafaf9; color: #0e1218; min-height: 100vh;
         font: 15px/1.5 'Geist', -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .hero { background:
            radial-gradient(ellipse 90% 70% at 15% 0%, rgba(0,72,138,.55), transparent 60%),
            radial-gradient(ellipse 70% 60% at 85% 100%, rgba(0,50,108,.5), transparent 60%),
            radial-gradient(ellipse 50% 45% at 70% 20%, rgba(14,87,148,.28), transparent 65%),
            linear-gradient(135deg, #002760, #000c29); }
  .hero__wrap { max-width: 560px; margin: 0 auto; padding: 38px 22px 30px;
                display: flex; align-items: center; justify-content: space-between; gap: 20px; min-width: 0; }
  .hero__main { flex: 1; min-width: 0; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #c2a86b; }
  .name { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 36px;
          line-height: 1.06; letter-spacing: -.01em; color: #fff; margin-top: 9px; }
  .role { font-size: 12.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #d9b45b; margin-top: 10px; }
  .role2 { font-size: 12.5px; color: #b0c0d1; margin-top: 3px; }
  .mark { position: relative; flex: none; width: 96px; height: 96px; }
  .mark::before { content: ''; position: absolute; inset: -20px; border-radius: 50%; pointer-events: none;
                  background: radial-gradient(circle at center, rgba(200,164,77,.22) 0%, rgba(200,164,77,.07) 40%, transparent 68%); }
  .avatar { position: relative; width: 96px; height: 96px; border-radius: 50%; object-fit: cover;
            border: 2.5px solid #d9b45b; background: #fff;
            box-shadow: 0 1px 1px rgba(0,6,20,.5), 0 10px 24px -8px rgba(0,6,20,.55); }
  .patch { position: relative; width: 96px; height: 96px; object-fit: contain;
           filter: drop-shadow(0 1px 1px rgba(0,6,20,.5)) drop-shadow(0 8px 20px rgba(0,4,16,.45)); }
  .seam { height: 2px; background: linear-gradient(90deg, transparent, rgba(200,164,77,.55) 18%, #e8cb72 50%, rgba(200,164,77,.55) 82%, transparent); }
  main { max-width: 560px; margin: 0 auto; padding: 24px 20px 14px; }
  .blurb { font-size: 14px; color: #5c5244; text-align: center; margin: 0 6px 18px; }
  .save { display: block; text-align: center; font-size: 16px; font-weight: 700; color: #16233f; text-decoration: none;
          background: linear-gradient(180deg, #e8c879, #cfa441); border-radius: 10px; padding: 15px 10px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 10px 26px -14px rgba(146,112,38,.75); margin-bottom: 20px; }
  .save:active { filter: brightness(.96); }
  .rows { background: #fff; border: 1px solid #e7e4dd; border-radius: 12px; overflow: hidden;
          box-shadow: 0 1px 2px rgba(0,12,41,.05), 0 18px 40px -24px rgba(0,12,41,.22); }
  .row { display: flex; align-items: baseline; gap: 14px; padding: 13px 16px; text-decoration: none;
         border-bottom: 1px solid #efece4; }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: #faf8f2; }
  .k { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; color: #8a6d2f; text-transform: uppercase; width: 54px; flex: none; }
  .v { font-size: 15px; color: #16233f; font-weight: 500; overflow-wrap: anywhere; }
  .foot { text-align: center; font-size: 10.5px; letter-spacing: .18em; color: #9a9281; font-weight: 600; padding: 26px 8px 34px; }
  @media (max-width: 374px) { .mark, .avatar, .patch { width: 78px; height: 78px; } .name { font-size: 31px; } }
</style></head><body>
<header class="hero">
  <div class="hero__wrap">
    <div class="hero__main">
      <div class="eyebrow">Waller County EMS</div>
      <h1 class="name">${esc(c.fullName)}</h1>
      ${c.titleLines[c.titleLines.length - 1] ? `<div class="role">${esc(c.titleLines[c.titleLines.length - 1])}</div>` : ''}
      ${c.titleLines.length > 1 ? `<div class="role2">${esc(c.titleLines.slice(0, -1).join(' · '))}</div>` : ''}
    </div>
    <div class="mark">
      ${c.photoUrl ? `<img class="avatar" src="${esc(c.photoUrl)}" alt="">` : `<img class="patch" src="${PATCH_URL}" alt="Waller County EMS">`}
    </div>
  </div>
  <div class="seam"></div>
</header>
<main>
  ${c.blurb ? `<p class="blurb">${esc(c.blurb)}</p>` : ''}
  <a class="save" href="/card/${c.slug}.vcf">Save my contact</a>
  <div class="rows">
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
