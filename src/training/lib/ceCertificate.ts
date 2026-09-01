import jsPDF from 'jspdf'

/**
 * Auto-generated CE certificate for lecture completion.
 *
 * Ports the visual language of the intranet's required-training cert
 * (navy frame, gold inner frame, header band, command-staff signatures,
 * gold ornament under title, tapered double rule under recipient name).
 * The body copy is rewritten for CE: explicit hours + DSHS content area
 * + lecture title + instructor.
 *
 * Returns the jsPDF instance — caller decides whether to `.save()`
 * (download) or `.output('blob')` (upload to Storage).
 */

const NAVY: [number, number, number] = [15, 26, 51]
const NAVY_DEEP: [number, number, number] = [9, 17, 34]
const INK: [number, number, number] = [25, 35, 60]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [120, 130, 150]
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

/** Texas DSHS CE Program Number for Waller County EMS. Surfaced
 *  prominently in the footer of every CE certificate as
 *  "Texas DSHS CE Program No. <number>". */
export const DSHS_CE_PROVIDER_NUMBER = '600588'

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

export interface CeCertificateInput {
  studentName: string
  /** The lecture's `lecture_title` field. */
  lectureTitle: string
  /** Numeric (or numeric-ish string) — printed as "X.X Contact Hours". */
  ceHours: string
  /** DSHS content area (Trauma, Medical, etc.) — optional, prints under
   *  the hours line as a small badge when set. */
  dshsContentArea?: string
  /** Lead instructor's printed name (4th signature column). */
  instructorName: string
  /** Lecture date (uses this rather than today for issuance). */
  lectureDate: Date
  /** Cert number — printed top-right inside the frame. */
  certNumber: string
  /** Optional path to the WCEMS patch PNG; defaults to /wcems-patch.png. */
  logoUrl?: string
}

export async function generateCeCertificate(
  input: CeCertificateInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  const dateStr = input.lectureDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  /* Frame */
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, H, 'F')
  doc.setFillColor(...PAPER)
  doc.rect(14, 14, W - 28, H - 28, 'F')
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.6)
  doc.rect(24, 24, W - 48, H - 48)

  /* Corner marks */
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.5)
  const cornerLen = 18
  doc.line(34, 38, 34 + cornerLen, 38)
  doc.line(34, 38, 34, 38 + cornerLen)
  doc.line(W - 34, 38, W - 34 - cornerLen, 38)
  doc.line(W - 34, 38, W - 34, 38 + cornerLen)
  doc.line(34, H - 38, 34 + cornerLen, H - 38)
  doc.line(34, H - 38, 34, H - 38 - cornerLen)
  doc.line(W - 34, H - 38, W - 34 - cornerLen, H - 38)
  doc.line(W - 34, H - 38, W - 34, H - 38 - cornerLen)

  /* Header band */
  const headerY = 56
  const headerH = 56
  doc.setFillColor(...NAVY_DEEP)
  doc.rect(60, headerY, W - 120, headerH, 'F')
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

  /* Patch */
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

  /* Title */
  const titleY = 230
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(34)
  doc.setTextColor(...NAVY)
  doc.text('Certificate of Continuing Education', W / 2, titleY, { align: 'center' })

  doc.setFillColor(...GOLD)
  const dotSize = 1.8
  ;[-12, 0, 12].forEach((dx) => {
    doc.circle(W / 2 + dx, titleY + 14, dotSize, 'F')
  })

  /* Presented by — small line under the title so the lead instructor
   *  is credited without needing a separate signature column. Sits
   *  well below the gold-dot ornament (titleY + 14) for breathing room. */
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(`Presented by ${input.instructorName}`, W / 2, titleY + 38, {
    align: 'center',
  })

  /* PRESENTED TO */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...MUTED)
  doc.text('PRESENTED TO', W / 2, titleY + 60, { align: 'center', charSpace: 2 })

  /* Name */
  const nameY = titleY + 100
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...NAVY)
  doc.text(input.studentName, W / 2, nameY, { align: 'center' })

  const nameWidth = Math.max(180, doc.getTextWidth(input.studentName) + 60)
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.2)
  doc.line(W / 2 - nameWidth / 2, nameY + 8, W / 2 + nameWidth / 2, nameY + 8)
  doc.setLineWidth(0.4)
  doc.line(W / 2 - nameWidth / 2, nameY + 12, W / 2 + nameWidth / 2, nameY + 12)

  /* Body */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'has successfully completed the continuing education lecture',
    W / 2,
    nameY + 40,
    { align: 'center' },
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...INK)
  doc.text(input.lectureTitle, W / 2, nameY + 66, { align: 'center' })

  /* Hours line — large, gold-highlighted */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...NAVY)
  const hoursTxt = `${input.ceHours} Contact Hours`
  doc.text(hoursTxt, W / 2, nameY + 92, { align: 'center' })

  /* DSHS content area badge */
  if (input.dshsContentArea) {
    const badgeText = `DSHS Content Area · ${input.dshsContentArea}`
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK_SOFT)
    doc.text(badgeText, W / 2, nameY + 110, { align: 'center' })
  }

  /* Texas DSHS CE Program No. — bold navy text sits below the content
   *  area as a clean attestation line. Skipped when the program
   *  number isn't configured. */
  const providerNum = DSHS_CE_PROVIDER_NUMBER.trim()
  if (providerNum) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...NAVY)
    doc.text(
      `Texas DSHS CE Program No. ${providerNum}`,
      W / 2,
      nameY + 140,
      { align: 'center' },
    )
  }

  /* Signatures — 3 command staff (lead instructor is credited under the
   *  title via "Presented by …" instead of a redundant 4th column,
   *  since the lead is often the medical director). Sized a touch
   *  smaller than the original 4-column layout so the program-number
   *  chip above has room to breathe. */
  const sigBottomY = H - 95
  const sigImgH = 38
  const colW = 158
  const gapW = 22
  const sigs: SigDef[] = [...COMMAND_STAFF_SIGS]
  const totalW = colW * sigs.length + gapW * (sigs.length - 1)
  const startX = W / 2 - totalW / 2

  sigs.forEach((s, i) => {
    const lx = startX + i * (colW + gapW)
    const cx = lx + colW / 2

    const imgBottom = sigBottomY - 4
    const img = makeCursiveSig(s.name, colW, sigImgH)
    if (img) doc.addImage(img, 'PNG', lx, imgBottom - sigImgH, colW, sigImgH)

    doc.setDrawColor(...GOLD_SOFT)
    doc.setLineWidth(0.5)
    doc.line(lx, sigBottomY, lx + colW, sigBottomY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(s.title.toUpperCase(), cx, sigBottomY + 14, {
      align: 'center',
      charSpace: 0.6,
    })

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...NAVY)
    doc.text(s.name, cx, sigBottomY + 26, { align: 'center' })
  })

  /* Footer — just the date flourish + per-student cert #. The DSHS
   *  program chip moved up under the content area. */
  const dateY = H - 50
  const certY = H - 32

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

  /* Per-student certificate number — sits centered under the date
   *  rather than tiny in the corner so it's readable on a printed copy. */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(`Certificate #: ${input.certNumber}`, W / 2, certY, {
    align: 'center',
  })

  return doc
}

/** Generate a YYYY-XXXXXX cert number from a session + attendee pair.
 *  Uniqueness comes from the (session, attendee) pair; the year prefix is
 *  human-friendly. Last 6 hex chars of the attendee uuid keep it short. */
export function makeCeCertNumber(year: number, attendeeId: string): string {
  const tail = attendeeId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
  return `${year}-${tail || '000000'}`
}
