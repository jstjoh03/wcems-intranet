import jsPDF from 'jspdf'
import { GREAT_VIBES_TTF_B64 } from '@/lib/greatVibesFont'

/**
 * Certificate of completion for a passed protocol examination — filed
 * into the employee's Documents automatically on a clean pass. Full
 * color (brand navy + gold, color crest) with signature blocks for the
 * Clinical Development Officer and Assistant Chief rendered in a
 * script face (Great Vibes, OFL).
 */

const NAVY: [number, number, number] = [24, 38, 68]
const NAVY_DEEP: [number, number, number] = [15, 26, 48]
const GOLD: [number, number, number] = [168, 132, 44]
const GOLD_SOFT: [number, number, number] = [201, 162, 75]
const INK_SOFT: [number, number, number] = [85, 90, 100]
const MUTED: [number, number, number] = [140, 144, 152]

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

const SIGNERS = [
  { signature: 'Justin St John, RN, LP', title: 'Clinical Development Officer' },
  { signature: 'Heather Fojt, LP', title: 'Assistant Chief' },
] as const

export async function generateExamCertPdf(input: ExamCertInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const CX = W / 2

  doc.addFileToVFS('GreatVibes-Regular.ttf', GREAT_VIBES_TTF_B64)
  doc.addFont('GreatVibes-Regular.ttf', 'GreatVibes', 'normal')

  /* Frame — navy outer rule, gold inner rule. */
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(2.5)
  doc.rect(28, 28, W - 56, H - 56)
  doc.setDrawColor(...GOLD)
  doc.setLineWidth(1)
  doc.rect(36, 36, W - 72, H - 72)

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch.png`)
  const CREST_W = 66
  const CREST_H = CREST_W * (280 / 262)
  const TOP = 64
  if (crest) doc.addImage(crest, 'PNG', CX - CREST_W / 2, TOP, CREST_W, CREST_H, 'wcems-crest')

  let y = TOP + CREST_H + 26
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...NAVY_DEEP)
  doc.text('WALLER COUNTY', CX, y, { align: 'center', charSpace: 2 })
  y += 17
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK_SOFT)
  doc.text('EMERGENCY MEDICAL SERVICES', CX, y, { align: 'center', charSpace: 2.4 })
  y += 28

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GOLD)
  doc.text('CERTIFICATE OF COMPLETION', CX, y, { align: 'center', charSpace: 3 })
  y += 30

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text('This certifies that', CX, y, { align: 'center' })
  y += 30

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...NAVY_DEEP)
  doc.text(input.candidateName, CX, y, { align: 'center' })
  doc.setDrawColor(...GOLD_SOFT)
  doc.setLineWidth(1)
  const nameW = doc.getTextWidth(input.candidateName)
  doc.line(CX - nameW / 2 - 22, y + 8, CX + nameW / 2 + 22, y + 8)
  y += 32

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text('has successfully completed the', CX, y, { align: 'center' })
  y += 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...NAVY)
  doc.text(input.examTitle, CX, y, { align: 'center' })
  y += 24

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.setTextColor(...NAVY)
  doc.text(
    `Score: ${input.scorePct.toFixed(1)}%   ·   Passing standard: ${input.passingPct}%`,
    CX,
    y,
    { align: 'center' },
  )
  y += 22

  const dateStr = new Date(input.submittedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  doc.setFontSize(11)
  doc.setTextColor(...INK_SOFT)
  doc.text(dateStr, CX, y, { align: 'center' })

  /* Signature blocks — script signature over a rule, title beneath. */
  const sigLineY = H - 118
  const sigW = 200
  const centers = [W * 0.3, W * 0.7]
  SIGNERS.forEach((s, i) => {
    const cx = centers[i]
    doc.setFont('GreatVibes', 'normal')
    doc.setFontSize(24)
    doc.setTextColor(...NAVY_DEEP)
    doc.text(s.signature, cx, sigLineY - 10, { align: 'center' })
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.8)
    doc.line(cx - sigW / 2, sigLineY, cx + sigW / 2, sigLineY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(s.title, cx, sigLineY + 14, { align: 'center' })
  })

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
