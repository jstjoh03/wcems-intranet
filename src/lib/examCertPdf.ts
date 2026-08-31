import jsPDF from 'jspdf'

/**
 * Certificate of completion for a passed protocol examination —
 * letterhead treatment matching the FTEP report PDFs (grayscale crest,
 * WALLER COUNTY / EMERGENCY MEDICAL SERVICES, double rule), filed into
 * the employee's Documents automatically on a clean pass.
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [35, 35, 35]
const INK_SOFT: [number, number, number] = [85, 85, 85]
const MUTED: [number, number, number] = [130, 130, 130]

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export interface ExamCertInput {
  candidateName: string
  examTitle: string
  scorePct: number
  passingPct: number
  /** ISO timestamp of submission. */
  submittedAt: string
}

export async function generateExamCertPdf(input: ExamCertInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const CX = W / 2

  /* Frame — double rule, certificate-style. */
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(2)
  doc.rect(28, 28, W - 56, H - 56)
  doc.setLineWidth(0.6)
  doc.rect(34, 34, W - 68, H - 68)

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 64
  const CREST_H = CREST_W * (280 / 262)
  /* Content block starts low enough that the certificate reads
     vertically balanced inside the frame. */
  const TOP = 92
  if (crest) doc.addImage(crest, 'JPEG', CX - CREST_W / 2, TOP, CREST_W, CREST_H, 'wcems-crest-bw')

  let y = TOP + CREST_H + 26
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...BLACK)
  doc.text('WALLER COUNTY', CX, y, { align: 'center', charSpace: 2 })
  y += 17
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text('EMERGENCY MEDICAL SERVICES', CX, y, { align: 'center', charSpace: 2.4 })
  y += 30

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.setTextColor(...INK_SOFT)
  doc.text('CERTIFICATE OF COMPLETION', CX, y, { align: 'center', charSpace: 3 })
  y += 34

  doc.setFontSize(11)
  doc.text('This certifies that', CX, y, { align: 'center' })
  y += 30

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...BLACK)
  doc.text(input.candidateName, CX, y, { align: 'center' })
  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.6)
  const nameW = doc.getTextWidth(input.candidateName)
  doc.line(CX - nameW / 2 - 20, y + 8, CX + nameW / 2 + 20, y + 8)
  y += 34

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text('has successfully completed the', CX, y, { align: 'center' })
  y += 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...BLACK)
  doc.text(input.examTitle, CX, y, { align: 'center' })
  y += 26

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text(
    `Score: ${input.scorePct.toFixed(1)}%   ·   Passing standard: ${input.passingPct}%`,
    CX,
    y,
    { align: 'center' },
  )
  y += 24

  const dateStr = new Date(input.submittedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text(dateStr, CX, y, { align: 'center' })

  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text(
    'Administered and recorded electronically in the WCEMS Employee Portal · Clinical Development',
    CX,
    H - 52,
    { align: 'center' },
  )

  return doc
}
