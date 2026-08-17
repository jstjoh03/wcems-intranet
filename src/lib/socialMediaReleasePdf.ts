import jsPDF from 'jspdf'
import type { SocialMediaRelease } from '@/types'

/**
 * Personnel-file PDF for a signed Social Media Photo & Video Release.
 *
 * Unlike the landscape award-style certificates, this is a portrait
 * document that reads like the form it replaces: header band, employee
 * info, the authorization statement, the YES/NO election, restrictions,
 * and the signature block. Same navy/gold palette as the other PDFs.
 *
 * Admin-marked rows (paper form on file) render an italic note in the
 * signature slot instead of an image.
 */

const NAVY: [number, number, number] = [15, 26, 51]
const NAVY_DEEP: [number, number, number] = [9, 17, 34]
const INK: [number, number, number] = [25, 35, 60]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [120, 130, 150]
const GOLD: [number, number, number] = [201, 167, 92]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT_BG: [number, number, number] = [248, 250, 252]
const SUCCESS: [number, number, number] = [22, 163, 74]
const DANGER: [number, number, number] = [190, 50, 50]

export const RELEASE_STATEMENT =
  'I, the undersigned, hereby authorize Waller County EMS to use my name, photograph, ' +
  'likeness, image, voice, and/or video on its official social media accounts, websites, ' +
  'publications, and promotional materials — including but not limited to Facebook, ' +
  'Instagram, X (Twitter), and YouTube. This may include images or videos from training, ' +
  'emergency responses, and community events. I understand that content shared may be ' +
  'viewed by the general public.'

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

export interface ReleasePdfInput {
  employeeName: string
  employeeTitle: string | null
  release: SocialMediaRelease
  markedByName?: string | null
}

export async function generateSocialMediaReleasePdf(
  input: ReleasePdfInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth() // 612
  const MARGIN = 56
  const CONTENT_W = W - MARGIN * 2

  const signedDate = new Date(input.release.signedAt)
  const dateStr = signedDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  /* ── Header band ─────────────────────────────────────────────────── */
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 96, 'F')
  doc.setFillColor(...NAVY_DEEP)
  doc.rect(0, 0, W, 8, 'F')

  const logoB64 = await loadImageAsBase64(`${window.location.origin}/wcems-patch.png`)
  if (logoB64) doc.addImage(logoB64, 'PNG', MARGIN, 22, 52, 52)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(255, 255, 255)
  doc.text('WALLER COUNTY EMS', MARGIN + 68, 44)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...GOLD)
  doc.text('Social Media Photo & Video Release', MARGIN + 68, 62)

  /* Gold seam under the band */
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1.5)
  doc.line(0, 96, W, 96)

  let y = 132

  /* ── Employee info ───────────────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('EMPLOYEE INFORMATION', MARGIN, y)
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y + 6, MARGIN + CONTENT_W, y + 6)
  y += 26

  function infoRow(label: string, value: string) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...MUTED)
    doc.text(label, MARGIN, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11.5)
    doc.setTextColor(...INK)
    doc.text(value, MARGIN + 130, y)
    y += 22
  }

  infoRow('Full name', input.employeeName)
  infoRow('Job title / position', input.employeeTitle ?? '—')
  infoRow('Date of form', dateStr)
  y += 10

  /* ── Authorization statement ─────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('SOCIAL MEDIA AUTHORIZATION', MARGIN, y)
  doc.setDrawColor(...LINE)
  doc.line(MARGIN, y + 6, MARGIN + CONTENT_W, y + 6)
  y += 24

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK_SOFT)
  const statementLines = doc.splitTextToSize(RELEASE_STATEMENT, CONTENT_W)
  doc.text(statementLines, MARGIN, y, { lineHeightFactor: 1.45 })
  y += statementLines.length * 10.5 * 1.45 + 20

  /* ── Election (YES / NO) ─────────────────────────────────────────── */
  const boxSize = 12
  function electionRow(checked: boolean, color: [number, number, number], text: string) {
    doc.setDrawColor(...INK_SOFT)
    doc.setLineWidth(1)
    doc.rect(MARGIN, y - boxSize + 2, boxSize, boxSize)
    if (checked) {
      doc.setDrawColor(...color)
      doc.setLineWidth(1.8)
      doc.line(MARGIN + 2.5, y - 4, MARGIN + 5, y - 1.5)
      doc.line(MARGIN + 5, y - 1.5, MARGIN + 10, y - 8)
    }
    doc.setFont('helvetica', checked ? 'bold' : 'normal')
    doc.setFontSize(10.5)
    if (checked) doc.setTextColor(...color)
    else doc.setTextColor(...MUTED)
    const lines = doc.splitTextToSize(text, CONTENT_W - boxSize - 12)
    doc.text(lines, MARGIN + boxSize + 12, y)
    y += lines.length * 14 + 10
  }

  electionRow(
    input.release.authorized,
    SUCCESS,
    'YES — I authorize Waller County EMS to use my photo/video on official social media channels.',
  )
  electionRow(
    !input.release.authorized,
    DANGER,
    'NO — I do not authorize Waller County EMS to use my photo/video on official social media channels.',
  )
  y += 8

  /* ── Restrictions ────────────────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('ADDITIONAL NOTES / RESTRICTIONS', MARGIN, y)
  doc.setDrawColor(...LINE)
  doc.line(MARGIN, y + 6, MARGIN + CONTENT_W, y + 6)
  y += 24

  doc.setFont('helvetica', input.release.restrictions ? 'normal' : 'italic')
  doc.setFontSize(10.5)
  doc.setTextColor(...(input.release.restrictions ? INK : MUTED))
  const restrictionLines = doc.splitTextToSize(
    input.release.restrictions || 'None noted.',
    CONTENT_W,
  )
  doc.text(restrictionLines, MARGIN, y, { lineHeightFactor: 1.45 })
  y += Math.max(restrictionLines.length * 10.5 * 1.45, 16) + 26

  /* ── Signature block ─────────────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('SIGNATURE', MARGIN, y)
  doc.setDrawColor(...LINE)
  doc.line(MARGIN, y + 6, MARGIN + CONTENT_W, y + 6)
  y += 18

  const sigColW = 300
  const sigH = 56
  if (input.release.signedMethod === 'self' && input.release.signatureData) {
    try {
      doc.addImage(input.release.signatureData, 'PNG', MARGIN, y, sigColW, sigH)
    } catch {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(10)
      doc.setTextColor(...MUTED)
      doc.text('[signature on file]', MARGIN, y + sigH - 12)
    }
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(10)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      `Paper form on file — recorded by ${input.markedByName ?? 'admin'}`,
      MARGIN,
      y + sigH - 12,
    )
  }
  y += sigH + 6

  doc.setDrawColor(...GOLD)
  doc.setLineWidth(0.8)
  doc.line(MARGIN, y, MARGIN + sigColW, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text('EMPLOYEE SIGNATURE', MARGIN, y + 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...NAVY)
  doc.text(input.employeeName, MARGIN, y + 30)

  const dateX = MARGIN + sigColW + 40
  doc.setDrawColor(...GOLD)
  doc.line(dateX, y, MARGIN + CONTENT_W, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text('DATE', dateX, y + 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...NAVY)
  doc.text(dateStr, dateX, y + 30)
  y += 56

  /* ── Verification footer ─────────────────────────────────────────── */
  doc.setFillColor(...SOFT_BG)
  doc.rect(MARGIN, y, CONTENT_W, 44, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_SOFT)
  const signedTimestamp = signedDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const verifyText =
    input.release.signedMethod === 'self'
      ? `Signed electronically via the WCEMS Employee Portal on ${signedTimestamp} by the employee's ` +
        'authenticated Microsoft Entra account. This form is retained in the employee’s personnel file.'
      : `Recorded in the WCEMS Employee Portal on ${signedTimestamp} from a paper form on file. ` +
        'This form is retained in the employee’s personnel file.'
  const verifyLines = doc.splitTextToSize(verifyText, CONTENT_W - 24)
  doc.text(verifyLines, MARGIN + 12, y + 17, { lineHeightFactor: 1.4 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    `Verification ID: ${input.release.id.slice(0, 8)}`,
    W - MARGIN,
    y + 60,
    { align: 'right' },
  )

  return doc
}
