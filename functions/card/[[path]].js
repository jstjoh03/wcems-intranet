// Cloudflare Pages Function: employee.wallercountyems.com/card/<slug>
// (and /card/<slug>.vcf). Proxies the contact-card edge function and
// restores real content types — the Supabase gateway force-rewrites
// HTML on *.supabase.co to text/plain + CSP sandbox (same reason the
// /rsvp proxy exists). Fixed upstream only; no headers forwarded.
const UPSTREAM = 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/contact-card'

export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url)
  const tail = url.pathname.replace(/^\/card\/?/, '')
  const res = await fetch(`${UPSTREAM}/${tail}`, { method: 'GET' })
  const body = await res.arrayBuffer()
  const isVcf = tail.endsWith('.vcf')
  return new Response(body, {
    status: res.status,
    headers: isVcf
      ? {
          'content-type': 'text/vcard; charset=utf-8',
          'content-disposition': `inline; filename="${tail.split('/').pop()}"`,
          'cache-control': 'no-store',
        }
      : {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'x-robots-tag': 'noindex',
        },
  })
}
