/**
 * Tiny rich-text layer for announcement bodies (and any other plain-text
 * column that needs clickable links + light emphasis).
 *
 * Storage stays plain text; this module renders a small, forgiving
 * markdown subset to sanitized HTML at display time:
 *
 *   **bold**         → <strong>
 *   *italic*         → <em>
 *   [label](url)     → <a>           (http/https/mailto/tel, or /internal)
 *   bare https://…   → <a> with a shortened display label
 *   "- item" lines   → <ul><li>      ("• item" works too)
 *   blank line       → new paragraph; single newline → <br>
 *
 * Safety: every character of user text is HTML-escaped before any tags
 * are generated, so a body can never inject markup, and hrefs outside
 * the scheme allowlist render as plain text. No regex lookbehind —
 * older iOS Safari has to parse this file (it's bundled into the
 * service worker too).
 */

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

/* Markdown links take precedence; otherwise bare URLs. Bare matches may
   swallow trailing punctuation ("see https://x.com." ) — trimmed below. */
const LINK_TOKEN_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"']+)/g

/** Peel sentence punctuation off the end of a bare-URL match. A closing
 *  paren only comes off when the URL has no opening one (so Wikipedia-
 *  style "(disambiguation)" paths survive). */
function trimBareUrl(match: string): { url: string; rest: string } {
  let url = match
  let rest = ''
  for (;;) {
    const ch = url.charAt(url.length - 1)
    if ('.,;:!?…"\''.includes(ch) || (ch === ')' && !url.includes('('))) {
      rest = ch + rest
      url = url.slice(0, -1)
    } else {
      break
    }
  }
  return { url, rest }
}

function safeHref(raw: string): string | null {
  const url = raw.trim()
  if (/^https?:\/\//i.test(url)) return url
  if (/^(mailto|tel):/i.test(url)) return url
  // Site-internal route ("/schedule?page=…"). "//" would be scheme-relative.
  if (url.startsWith('/') && !url.startsWith('//')) return url
  return null
}

/** Display label for a bare URL: scheme + www stripped, long tails cut,
 *  so a 200-character tracking link reads as its host. */
function shortLabel(url: string): string {
  let s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  if (s.endsWith('/')) s = s.slice(0, -1)
  return s.length > 48 ? `${s.slice(0, 46)}…` : s
}

function anchor(href: string, label: string, fullUrl: string | null): string {
  const external = /^https?:\/\//i.test(href)
  const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : ''
  const title = fullUrl && fullUrl !== label ? ` title="${escapeHtml(fullUrl)}"` : ''
  return `<a href="${escapeHtml(href)}" class="rt-link"${attrs}${title}>${escapeHtml(label)}</a>`
}

/** Bold + italic on already-escaped text. Italic needs a non-word run-in
 *  so "5*3 and 2*4" stays math (capture-group boundary, not lookbehind). */
function emphasize(escaped: string): string {
  let out = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;<])/g, '$1<em>$2</em>')
  return out
}

function inlineHtml(raw: string): string {
  let out = ''
  let last = 0
  LINK_TOKEN_RE.lastIndex = 0
  for (let m = LINK_TOKEN_RE.exec(raw); m; m = LINK_TOKEN_RE.exec(raw)) {
    out += emphasize(escapeHtml(raw.slice(last, m.index)))
    if (m[3] !== undefined) {
      const { url, rest } = trimBareUrl(m[3])
      const href = safeHref(url)
      out += href ? anchor(href, shortLabel(url), url) : escapeHtml(url)
      out += emphasize(escapeHtml(rest))
    } else {
      const href = safeHref(m[2])
      out += href ? anchor(href, m[1].trim(), m[2]) : escapeHtml(m[0])
    }
    last = m.index + m[0].length
  }
  out += emphasize(escapeHtml(raw.slice(last)))
  return out
}

/** Render a body to sanitized HTML (<p>/<br>/<ul>/<li>/<strong>/<em>/<a>
 *  only). Empty/whitespace input returns ''. */
export function renderRichText(src: string): string {
  const text = (src ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return ''
  const html: string[] = []
  let para: string[] = []
  let list: string[] = []
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.join('<br>')}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (list.length) {
      html.push(`<ul>${list.join('')}</ul>`)
      list = []
    }
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushPara()
      flushList()
      continue
    }
    const bullet = /^[-•]\s+(.*)$/.exec(line)
    if (bullet) {
      flushPara()
      list.push(`<li>${inlineHtml(bullet[1])}</li>`)
    } else {
      flushList()
      para.push(inlineHtml(line))
    }
  }
  flushPara()
  flushList()
  return html.join('')
}

/** Strip the markup for plain-text surfaces (card snippets, push
 *  notification teasers): labeled links become their label, bare URLs
 *  their short host form, emphasis markers drop, bullets normalize to
 *  "•". Also tolerates a link cut mid-URL by an upstream character
 *  truncation (the push teaser is sliced server-side before we see it). */
export function richTextToPlain(src: string): string {
  let s = (src ?? '').replace(/\r\n?/g, '\n')
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
  s = s.replace(/\[([^\]\n]+)\]\([^)\n]*$/, '$1')
  s = s.replace(/https?:\/\/[^\s<>"']+/g, (u) => shortLabel(trimBareUrl(u).url))
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  s = s.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=$|[\s).,!?:;<])/g, '$1$2')
  s = s.replace(/^[-•]\s+/gm, '• ')
  return s.trim()
}
