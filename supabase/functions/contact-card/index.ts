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
  /* valueHtml arrives pre-escaped by the caller */
  const row = (href: string, ic: string, label: string, valueHtml: string, ext = false) =>
    `<a class="row" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ''}><span class="rbadge">${icon(ic)}</span><span class="rtxt"><span class="k">${label}</span><span class="v">${valueHtml}</span></span><span class="chev" aria-hidden="true">›</span></a>`
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

  /* Mirrors the portal dashboard hero (Hero.vue): the "lit surface"
     navy — radial highlights over the 135° brand gradient — with the
     patch + wordmark lockup, white Instrument Serif name, a gold-haloed
     photo at right, the feathered gold seam, and the content below on
     the warm canvas. Token values are the portal's oklch tokens
     converted to sRGB (no oklch: older phone browsers scanning a
     printed card must render this). */
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
  body { background: #f8f5ee; color: #0e1218; min-height: 100vh;
         font: 15px/1.5 'Geist', -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .hero { background:
            radial-gradient(ellipse 90% 70% at 15% 0%, rgba(0,72,138,.62), transparent 60%),
            radial-gradient(ellipse 70% 60% at 85% 100%, rgba(0,50,108,.55), transparent 60%),
            radial-gradient(ellipse 45% 55% at 86% 14%, rgba(200,164,77,.15), transparent 62%),
            radial-gradient(ellipse 50% 45% at 70% 20%, rgba(14,87,148,.34), transparent 65%),
            linear-gradient(135deg, #002760, #000c29); }
  .hero__wrap { max-width: 560px; margin: 0 auto; padding: 26px 22px 30px; min-width: 0; }
  .brand { display: flex; align-items: center; gap: 11px; }
  .brand__patch { width: 38px; height: 38px; object-fit: contain;
                  filter: drop-shadow(0 1px 1px rgba(0,6,20,.5)) drop-shadow(0 4px 10px rgba(0,4,16,.4)); }
  .brand__word { font-size: 11.5px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #c2a86b; }
  .hero__row { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 20px; min-width: 0; }
  .hero__main { flex: 1; min-width: 0; }
  .name { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 37px;
          line-height: 1.06; letter-spacing: -.01em; color: #fff; }
  .role { font-size: 12.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #d9b45b; margin-top: 10px; }
  .role2 { font-size: 12.5px; color: #b0c0d1; margin-top: 3px; }
  .mark { position: relative; flex: none; width: 100px; height: 100px; }
  .mark::before { content: ''; position: absolute; inset: -22px; border-radius: 50%; pointer-events: none;
                  background: radial-gradient(circle at center, rgba(200,164,77,.26) 0%, rgba(200,164,77,.08) 42%, transparent 68%); }
  .avatar { position: relative; width: 100px; height: 100px; border-radius: 50%; object-fit: cover;
            border: 2.5px solid #d9b45b; background: #fff;
            box-shadow: 0 0 0 5px rgba(200,164,77,.14), 0 1px 1px rgba(0,6,20,.5), 0 10px 26px -8px rgba(0,6,20,.6); }
  .seam { height: 3px; background: linear-gradient(90deg, transparent, rgba(200,164,77,.6) 15%, #f0d488 50%, rgba(200,164,77,.6) 85%, transparent); }
  main { max-width: 560px; margin: 0 auto; padding: 24px 20px 10px; }
  .blurb { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-size: 17px;
           color: #4c4536; text-align: center; margin: 0 10px 18px; line-height: 1.45; }
  .save { display: flex; align-items: center; justify-content: center; gap: 10px;
          font-size: 16px; font-weight: 750; color: #1b2440; text-decoration: none;
          background: linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,0) 42%),
                      linear-gradient(180deg, #ecca76, #c89b3c);
          border: 1px solid #a8842c; border-radius: 13px; padding: 15px 12px; margin-bottom: 20px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(118,88,24,.35),
                      0 2px 4px rgba(120,92,30,.22), 0 14px 30px -12px rgba(146,112,38,.65);
          transition: transform 80ms ease, box-shadow 80ms ease; }
  .save svg { width: 19px; height: 19px; }
  .save:active { transform: translateY(1px);
                 box-shadow: inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(118,88,24,.3),
                             0 1px 2px rgba(120,92,30,.2), 0 8px 18px -10px rgba(146,112,38,.55); }
  .rows { background: #fff; border: 1px solid #e7dfcc; border-radius: 15px; overflow: hidden;
          box-shadow: 0 1px 2px rgba(32,26,10,.05), 0 20px 46px -26px rgba(32,26,10,.3); }
  .row { display: grid; grid-template-columns: 38px 1fr auto; align-items: center; gap: 13px;
         padding: 11px 15px; text-decoration: none; border-bottom: 1px solid #f0ead9; }
  .row:last-child { border-bottom: 0; }
  .row:hover, .row:active { background: #faf6ea; }
  .rbadge { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
            background: linear-gradient(180deg, #fdf7e6, #f3e6c6); border: 1px solid #e6d5a4; color: #8a6d2f; }
  .rbadge svg { width: 17px; height: 17px; }
  .rtxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .k { font-size: 10px; font-weight: 750; letter-spacing: .13em; color: #9b7c36; text-transform: uppercase; }
  .v { font-size: 15px; color: #16233f; font-weight: 600; overflow-wrap: anywhere; line-height: 1.3; }
  .chev { color: #cdbf98; font-size: 19px; font-weight: 600; line-height: 1; padding-right: 2px; }
  .foot { text-align: center; font-size: 10.5px; letter-spacing: .18em; color: #9a8c6e; font-weight: 650; padding: 26px 8px 34px; }
  @media (max-width: 374px) { .mark, .avatar { width: 82px; height: 82px; } .name { font-size: 31px; } }
</style></head><body>
<header class="hero">
  <div class="hero__wrap">
    <div class="brand">
      <img class="brand__patch" src="${PATCH_URL}" alt="Waller County EMS patch">
      <span class="brand__word">Waller County EMS</span>
    </div>
    <div class="hero__row">
      <div class="hero__main">
        <h1 class="name">${esc(c.fullName)}</h1>
        ${c.titleLines[c.titleLines.length - 1] ? `<div class="role">${esc(c.titleLines[c.titleLines.length - 1])}</div>` : ''}
        ${c.titleLines.length > 1 ? `<div class="role2">${esc(c.titleLines.slice(0, -1).join(' · '))}</div>` : ''}
      </div>
      ${c.photoUrl ? `<div class="mark"><img class="avatar" src="${esc(photoRender(c.photoUrl, 240))}" onerror="this.onerror=null;this.src='${esc(c.photoUrl)}'" alt=""></div>` : ''}
    </div>
  </div>
  <div class="seam"></div>
</header>
<main>
  ${c.blurb ? `<p class="blurb">${esc(c.blurb)}</p>` : ''}
  <a class="save" href="/card/${c.slug}.vcf">${icon('save')} Save my contact</a>
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
