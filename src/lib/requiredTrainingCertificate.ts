import jsPDF from 'jspdf'

/**
 * Auto-generated PDF certificate for required-training completion.
 *
 * Layout philosophy:
 *  - Navy outer frame + a thin gold inner frame. No bisecting red
 *    lines (the old design had a continuous bottom red line that cut
 *    straight through the cursive signatures).
 *  - Header band at the top with the agency / office branding.
 *  - WCEMS patch as a focal element under the header.
 *  - Clean typographic hierarchy: title → recipient → module → date.
 *  - Per-column gold rule UNDER each signature with breathing room
 *    above, so the cursive strokes never touch the rule.
 *  - Three command-staff cursive signatures rendered to canvas then
 *    embedded as PNG. Same source-of-truth name+title pairs as before.
 *
 * Returns the jsPDF instance — caller decides whether to .save()
 * (auto-download) or .output('datauristring') (POST to a backend).
 */

/* ── Palette (WCEMS) ─────────────────────────────────────────────── */
const NAVY: [number, number, number] = [15, 26, 51]
const NAVY_DEEP: [number, number, number] = [9, 17, 34]
const INK: [number, number, number] = [25, 35, 60]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [120, 130, 150]
const PALE: [number, number, number] = [185, 195, 215]
const GOLD: [number, number, number] = [201, 167, 92]
const GOLD_SOFT: [number, number, number] = [225, 205, 152]
const PAPER: [number, number, number] = [253, 252, 248]

interface SigDef {
  name: string
  title: string
}

const COMMAND_STAFF_SIGS: SigDef[] = [
  { name: 'Rhonda Getschman', title: 'Chief / EMS Director' },
  { name: 'Heather Fojt', title: 'Assistant Chief' },
  { name: 'Aaron Buzzard, MD', title: 'Medical Director' },
]

/* Render a cursive name to a transparent canvas and return a PNG data
   URL. Bottom-anchored baseline with 8pt of clearance below it so
   descenders never touch whatever the certificate places under it. */
function makeCursiveSig(name: string, w = 280, h = 56): string {
  const c = document.createElement('canvas')
  c.width = w * 2
  c.height = h * 2
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.scale(2, 2)
  ctx.clearRect(0, 0, w, h)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = `rgb(${NAVY.join(',')})`
  const fonts = 'Brush Script MT, Segoe Script, Lucida Handwriting, Comic Sans MS, cursive'
  let sz = Math.round(h * 0.78)
  ctx.font = `italic ${sz}px ${fonts}`
  while (ctx.measureText(name).width > w - 12 && sz > 12) {
    sz -= 1
    ctx.font = `italic ${sz}px ${fonts}`
  }
  /* Baseline at h - 10: leaves room for descenders without clipping
     them AND gives the certificate space to draw a line BELOW the
     canvas without the strokes touching it. */
  ctx.fillText(name, 6, h - 10)
  return c.toDataURL('image/png')
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export interface CertificateInput {
  employeeName: string
  moduleTitle: string
  /** Optional override; defaults to today. */
  completionDate?: Date
  /** Optional logo URL — defaults to the WCEMS patch at the site root. */
  logoUrl?: string
  /** Optional verification id printed in the corner (e.g. last-8 of
   *  the completion row's UUID). */
  verificationId?: string
}

export async function generateRequiredTrainingCertificate(
  input: CertificateInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth() // 792
  const H = doc.internal.pageSize.getHeight() // 612

  const now = input.completionDate ?? new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  /* ── Frame ────────────────────────────────────────────────────── */
  /* Outer navy band (acts as the "border") */
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, H, 'F')

  /* Paper field */
  doc.setFillColor(...PAPER)
  doc.rect(14, 14, W - 28, H - 28, 'F')

  /* Thin gold inner frame */
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.6)
  doc.rect(24, 24, W - 48, H - 48)

  /* Subtle gold corner marks (top-left, top-right, bottom-left, bottom-right) */
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.5)
  const cornerLen = 18
  // top-left
  doc.line(34, 38, 34 + cornerLen, 38)
  doc.line(34, 38, 34, 38 + cornerLen)
  // top-right
  doc.line(W - 34, 38, W - 34 - cornerLen, 38)
  doc.line(W - 34, 38, W - 34, 38 + cornerLen)
  // bottom-left
  doc.line(34, H - 38, 34 + cornerLen, H - 38)
  doc.line(34, H - 38, 34, H - 38 - cornerLen)
  // bottom-right
  doc.line(W - 34, H - 38, W - 34 - cornerLen, H - 38)
  doc.line(W - 34, H - 38, W - 34, H - 38 - cornerLen)

  /* ── Header band ──────────────────────────────────────────────── */
  const headerY = 56
  const headerH = 56
  doc.setFillColor(...NAVY_DEEP)
  doc.rect(60, headerY, W - 120, headerH, 'F')
  /* Thin gold rule above + below the header band for elegance. */
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.5)
  doc.line(60, headerY, W - 60, headerY)
  doc.line(60, headerY + headerH, W - 60, headerY + headerH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GOLD)
  doc.text('WALLER COUNTY EMERGENCY MEDICAL SERVICES', W / 2, headerY + 22, {
    align: 'center',
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(225, 225, 235)
  doc.text('Office of Medical Education & Training', W / 2, headerY + 40, {
    align: 'center',
  })

  /* ── Patch ────────────────────────────────────────────────────── */
  const logoUrl =
    input.logoUrl ??
    (typeof window !== 'undefined' ? `${window.location.origin}/wcems-patch.png` : null)
  if (logoUrl) {
    const logoB64 = await loadImageAsBase64(logoUrl)
    if (logoB64) {
      const lSize = 64
      doc.addImage(logoB64, 'PNG', W / 2 - lSize / 2, headerY + headerH + 14, lSize, lSize)
    }
  }

  /* ── Title ────────────────────────────────────────────────────── */
  const titleY = 230
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(36)
  doc.setTextColor(...NAVY)
  doc.text('Certificate of Completion', W / 2, titleY, { align: 'center' })

  /* Gold ornament under title — three dots */
  doc.setFillColor(...GOLD)
  const dotSize = 1.8
  ;[-12, 0, 12].forEach((dx) => {
    doc.circle(W / 2 + dx, titleY + 14, dotSize, 'F')
  })

  /* ── Presented-to label ───────────────────────────────────────── */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...MUTED)
  /* Tracked letter-spacing fake via padding spaces. */
  doc.text('PRESENTED TO', W / 2, titleY + 36, { align: 'center', charSpace: 2 })

  /* ── Recipient name ───────────────────────────────────────────── */
  const nameY = titleY + 78
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...NAVY)
  doc.text(input.employeeName, W / 2, nameY, { align: 'center' })

  /* Gold tapered underline under the name */
  const nameWidth = Math.max(180, doc.getTextWidth(input.employeeName) + 60)
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.2)
  doc.line(W / 2 - nameWidth / 2, nameY + 8, W / 2 + nameWidth / 2, nameY + 8)
  doc.setLineWidth(0.4)
  doc.line(W / 2 - nameWidth / 2, nameY + 12, W / 2 + nameWidth / 2, nameY + 12)

  /* ── Body copy ────────────────────────────────────────────────── */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'has successfully completed the required training module',
    W / 2,
    nameY + 40,
    { align: 'center' },
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...INK)
  doc.text(input.moduleTitle, W / 2, nameY + 68, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'and has attested to reviewing and understanding the content presented.',
    W / 2,
    nameY + 92,
    { align: 'center' },
  )

  /* ── Signature block ──────────────────────────────────────────── */
  /* Three columns, centered. Per-column gold rule UNDER the
     signature image (with breathing room) — no continuous line that
     could cut through anything. */
  const sigBottomY = H - 90 // baseline of the gold rule under the signatures
  const sigImgH = 48
  const colW = 200
  const gapW = 28
  const totalW = colW * 3 + gapW * 2
  const startX = W / 2 - totalW / 2

  COMMAND_STAFF_SIGS.forEach((s, i) => {
    const lx = startX + i * (colW + gapW)
    const cx = lx + colW / 2

    /* Cursive image. Bottom of canvas sits 4pt ABOVE the rule so the
       gold line has visible breathing room — no descender crosses. */
    const imgBottom = sigBottomY - 4
    const img = makeCursiveSig(s.name, colW, sigImgH)
    if (img) doc.addImage(img, 'PNG', lx, imgBottom - sigImgH, colW, sigImgH)

    /* Hairline gold rule per column */
    doc.setDrawColor(...GOLD_SOFT)
    doc.setLineWidth(0.5)
    doc.line(lx, sigBottomY, lx + colW, sigBottomY)

    /* Title (caps small) */
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(s.title.toUpperCase(), cx, sigBottomY + 14, {
      align: 'center',
      charSpace: 0.6,
    })

    /* Printed name */
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...NAVY)
    doc.text(s.name, cx, sigBottomY + 28, { align: 'center' })
  })

  /* ── Date footer with ornamental flourishes ───────────────────── */
  const dateY = H - 44
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  const dateText = `Issued ${dateStr}`
  const dateW = doc.getTextWidth(dateText)
  const flourishLen = 28
  const flourishGap = 10
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.5)
  doc.line(
    W / 2 - dateW / 2 - flourishGap - flourishLen,
    dateY - 3,
    W / 2 - dateW / 2 - flourishGap,
    dateY - 3,
  )
  doc.line(
    W / 2 + dateW / 2 + flourishGap,
    dateY - 3,
    W / 2 + dateW / 2 + flourishGap + flourishLen,
    dateY - 3,
  )
  doc.text(dateText, W / 2, dateY, { align: 'center' })

  /* ── Verification id (tiny, bottom-right inside the frame) ────── */
  if (input.verificationId) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...PALE)
    doc.text(`Verification ID: ${input.verificationId}`, W - 44, H - 30, {
      align: 'right',
    })
  }

  return doc
}
