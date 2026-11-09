// Cloudflare Pages Function: employee.wallercountyems.com/rsvp
//
// The party-rsvp edge function renders the RSVP page, but Supabase's
// gateway refuses to serve HTML from *.supabase.co functions URLs — it
// force-rewrites the response to text/plain + CSP sandbox (anti-phishing),
// so browsers show raw source. This proxy serves the same page from the
// portal domain with its real content type. It forwards ONLY to the fixed
// upstream, and never forwards auth headers, so the edge function's
// x-sync-secret admin actions stay unreachable through it.
const UPSTREAM = 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/party-rsvp'

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url)
  const init = { method: ctx.request.method }
  if (ctx.request.method === 'POST') {
    init.body = await ctx.request.arrayBuffer()
    init.headers = {
      'content-type': ctx.request.headers.get('content-type') || 'application/x-www-form-urlencoded',
    }
  }
  const res = await fetch(UPSTREAM + url.search, init)
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
}
