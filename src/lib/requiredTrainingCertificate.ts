import jsPDF from 'jspdf'

/**
 * Auto-generated PDF certificate for required-training completion.
 * Mirrors the WCEMS Wix flow: navy/red color scheme, centered patch
 * logo, employee name with underline, module title, and three
 * pre-rendered cursive command-staff signatures.
 *
 * Returns the jsPDF instance — caller decides whether to .save()
 * (auto-download) or .output('datauristring') (POST to a backend).
 */

const NAVY: [number, number, number] = [15, 26, 51]
const NAVY_INK: [number, number, number] = [50, 65, 85]
const MUTED: [number, number, number] = [100, 116, 139]
const PALE: [number, number, number] = [148, 163, 184]
const RED: [number, number, number] = [239, 68, 68]
const GOLD: [number, number, number] = [201, 167, 92]

interface SigDef {
  name: string
  title: string
}

const COMMAND_STAFF_SIGS: SigDef[] = [
  { name: 'Rhonda Getschman', title: 'Chief / EMS Director' },
  { name: 'Heather Fojt', title: 'Assistant Chief' },
  { name: 'Aaron Buzzard, MD', title: 'Medical Director' },
]

function makeCursiveSig(name: string, w = 280, h = 46): string {
  const c = document.createElement('canvas')
  c.width = w * 2
  c.height = h * 2
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.scale(2, 2)
  ctx.clearRect(0, 0, w, h)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgb(${NAVY.join(',')})`
  const fonts = 'Brush Script MT, Segoe Script, Comic Sans MS, cursive'
  let sz = Math.round(h * 0.6)
  ctx.font = `italic ${sz}px ${fonts}`
  while (ctx.measureText(name).width > w - 8 && sz > 10) {
    sz -= 1
    ctx.font = `italic ${sz}px ${fonts}`
  }
  ctx.fillText(name, 4, h / 2 + 2)
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

  // Border layers (navy → white → navy → white)
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, H, 'F')
  doc.setFillColor(255, 255, 255)
  doc.rect(12, 12, W - 24, H - 24, 'F')
  doc.setFillColor(...NAVY)
  doc.rect(20, 20, W - 40, H - 40, 'F')
  doc.setFillColor(255, 255, 255)
  doc.rect(28, 28, W - 56, H - 56, 'F')

  // Red accent lines top + bottom
  doc.setFillColor(...RED)
  doc.rect(28, 108, W - 56, 3, 'F')
  doc.rect(28, H - 111, W - 56, 3, 'F')

  // Gold thin band under header (WCEMS palette nod)
  doc.setFillColor(...GOLD)
  doc.rect(28, 105, W - 56, 1, 'F')

  // Header bar
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('WALLER COUNTY EMERGENCY MEDICAL SERVICES', W / 2, 68, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('OFFICE OF MEDICAL EDUCATION & TRAINING', W / 2, 86, { align: 'center' })

  // Logo
  const logoUrl =
    input.logoUrl ??
    (typeof window !== 'undefined' ? `${window.location.origin}/wcems-patch.png` : null)
  if (logoUrl) {
    const logoB64 = await loadImageAsBase64(logoUrl)
    if (logoB64) {
      const lSize = 72
      doc.addImage(logoB64, 'PNG', W / 2 - lSize / 2, 116, lSize, lSize)
    }
  }

  // Certificate title
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(34)
  doc.text('Certificate of Completion', W / 2, 218, { align: 'center' })

  // Body
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(...MUTED)
  doc.text('This certifies that', W / 2, 252, { align: 'center' })

  // Employee name + underline
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(...NAVY)
  doc.text(input.employeeName, W / 2, 292, { align: 'center' })
  const nameWidth = doc.getTextWidth(input.employeeName)
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(1)
  doc.line(W / 2 - nameWidth / 2, 300, W / 2 + nameWidth / 2, 300)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(...MUTED)
  doc.text('has successfully completed the required training module', W / 2, 328, {
    align: 'center',
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...NAVY)
  doc.text(input.moduleTitle, W / 2, 355, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...MUTED)
  doc.text(
    'and has attested to reviewing and understanding the content presented.',
    W / 2,
    382,
    { align: 'center' },
  )

  // Signature section — 3 columns centered
  const sigLineY = H - 96
  const sigImgH = 44
  const colW = 210
  const totalW = colW * 3 + 20
  const startX = W / 2 - totalW / 2

  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.5)

  COMMAND_STAFF_SIGS.forEach((s, i) => {
    const lx = startX + i * (colW + 10)
    const cx = lx + colW / 2
    const img = makeCursiveSig(s.name, colW, sigImgH)
    if (img) doc.addImage(img, 'PNG', lx, sigLineY - sigImgH - 2, colW, sigImgH)
    doc.line(lx, sigLineY, lx + colW, sigLineY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(s.title, cx, sigLineY + 13, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...NAVY_INK)
    doc.text(s.name, cx, sigLineY + 25, { align: 'center' })
  })

  // Date footer
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...PALE)
  doc.text(dateStr, W / 2, H - 42, { align: 'center' })

  return doc
}
