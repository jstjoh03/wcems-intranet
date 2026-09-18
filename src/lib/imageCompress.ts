/**
 * Downscale a phone photo before upload. Cameras hand us 3–12 MB
 * originals; evidence photos only need to show where something was
 * left, so the longest edge is capped (default 1600px) and re-encoded
 * as JPEG — typically 250–500 KB, which matters on a parking-lot
 * signal. Decoding through an <img> keeps the EXIF orientation that
 * modern browsers apply by default.
 *
 * Falls back to the original file whenever the browser can't decode it
 * (e.g. HEIC on desktop Chrome) or re-encoding doesn't actually shrink
 * it — callers upload whatever comes back.
 */
export async function compressImage(
  file: Blob,
  maxEdge = 1600,
  quality = 0.82,
): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return file
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) return file
    return blob.size < file.size ? blob : file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** File extension for an image blob's MIME type. */
export function imageExtension(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/heic') return 'heic'
  if (type === 'image/heif') return 'heif'
  return 'jpg'
}
