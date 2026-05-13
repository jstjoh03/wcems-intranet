/**
 * Helpers for resolving a `training_recordings.video_ref` into something
 * a `<video>` element or `<iframe>` can consume, regardless of which
 * host the admin pasted.
 *
 * Each `video_source` has its own quirks:
 *
 *  - 'wix' | 'direct': the ref is a direct media URL (a .mp4 or similar).
 *    The crew page renders an HTML5 <video> with src=ref. Looks like a
 *    native, intranet-branded player.
 *  - 'sharepoint': the ref is the embed link copied from SharePoint's
 *    "Embed" dialog (already in iframe form). We render it as-is in an
 *    <iframe>.
 *  - 'youtube': the ref might be a full URL (youtu.be/X, youtube.com/
 *    watch?v=X, youtube.com/embed/X) or just the bare 11-char ID. We
 *    normalize it to the embed URL with sensible params (modestbranding,
 *    no related-videos sidebar at the end).
 *  - 'cloudflare_stream': placeholder for phase 2; ref will be the
 *    Stream video UID once that integration ships.
 */

export type VideoSource =
  | 'wix'
  | 'sharepoint'
  | 'youtube'
  | 'direct'
  | 'cloudflare_stream'

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Extract the 11-character YouTube video ID from any of the URL forms a
 * user is likely to paste. Returns null if we can't find one. Callers
 * should treat that as "this isn't a YouTube URL" and fall back to
 * showing an error to the admin.
 */
export function extractYouTubeId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  // Bare ID — assume the admin pasted just the 11-char ID.
  if (YT_ID_RE.test(s)) return s
  // youtu.be/<id>
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (short) return short[1]
  // youtube.com/watch?v=<id>
  const watch = s.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (watch) return watch[1]
  // youtube.com/embed/<id>
  const embed = s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/)
  if (embed) return embed[1]
  // youtube.com/shorts/<id>
  const shorts = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/)
  if (shorts) return shorts[1]
  return null
}

/**
 * Build the YouTube embed URL with the params we always want on:
 *  - rel=0: no "related videos from other channels" at the end (still
 *    shows other vids from the same channel — YouTube removed the
 *    fully-disable option years ago).
 *  - modestbranding=1: minimal YT logo in the controls.
 *  - playsinline=1: don't full-screen on iOS mid-tap.
 */
export function youTubeEmbedUrl(idOrUrl: string): string | null {
  const id = extractYouTubeId(idOrUrl)
  if (!id) return null
  return `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`
}

/**
 * Auto-generated thumbnail URL for a YouTube video. We try `maxresdefault`
 * first; YouTube falls back to the standard res silently if maxres doesn't
 * exist for the video. The crew library uses this when no thumbnail_url
 * was explicitly set on the row.
 */
export function youTubeThumbnailUrl(idOrUrl: string): string | null {
  const id = extractYouTubeId(idOrUrl)
  if (!id) return null
  return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
}

/**
 * Source-kind detection used by the player to choose between <video> and
 * <iframe>. 'wix' and 'direct' are both treated as "direct file URL" and
 * play through the native HTML5 element.
 */
export function isInlineFileSource(source: VideoSource): boolean {
  return source === 'wix' || source === 'direct'
}

export function isIframeSource(source: VideoSource): boolean {
  return source === 'sharepoint' || source === 'youtube' || source === 'cloudflare_stream'
}

/**
 * Resolve a row to a thumbnail URL, falling back to YouTube's auto-thumb
 * when nothing was uploaded. Returns null if we can't infer one — the UI
 * then shows the placeholder gradient with the title.
 */
export function resolveThumbnail(
  source: VideoSource,
  ref: string,
  uploaded: string | null,
): string | null {
  if (uploaded) return uploaded
  if (source === 'youtube') return youTubeThumbnailUrl(ref)
  return null
}

/**
 * Resolve the URL the player should actually load. For iframe sources,
 * this is the embed URL. For inline files, it's the raw ref. The caller
 * is expected to know which element type to render via the source kind
 * helpers above.
 */
export function resolvePlayUrl(source: VideoSource, ref: string): string | null {
  if (isInlineFileSource(source)) return ref || null
  if (source === 'youtube') return youTubeEmbedUrl(ref)
  if (source === 'sharepoint') return ref || null
  // Placeholder for Cloudflare Stream phase 2: ref will be the video UID,
  // and we'll build the watch/embed URL from CF's documented pattern.
  return null
}
