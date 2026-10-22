import jsPDF from 'jspdf'
import {
  MEGACODE_SECTION1,
  MEGACODE_RHYTHMS,
  MEGACODE_SECTION3,
  MEGACODE_AUTOFAILS,
  megacodeScore,
  type MegacodeChecks,
} from '@/constants/megacodeScenarios'

/**
 * Megacode Evaluation — letterhead B&W PDF mirroring the v1.0 paper
 * form (Sections 1–3, the automatic-fail box, result, signatures),
 * stamped with the scenario the examiner ran. Files to the employee's
 * documents as the signed record.
 */

function pdfSafe(s: string): string {
  return s
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/[−]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[^ -ÿ–—‘’“”•·…]/g, '')
}

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [35, 35, 35]
const INK_SOFT: [number, number, number] = [85, 85, 85]
const MUTED: [number, number, number] = [130, 130, 130]
const LINE: [number, number, number] = [200, 200, 200]

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

export interface MegacodePdfInput {
  traineeName: string
  examinerName: string
  scenarioTitle: string
  scenarioNo: number
  dateIso: string
  checks: MegacodeChecks
  comments: string
  examinerSignature: string | null
  candidateSignature: string | null
}

export async function generateMegacodeEvalPdf(input: MegacodePdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  let y = 0

  function pageHeader() {
    const top = 34
    if (crest) doc.addImage(crest, 'JPEG', MARGIN, top - 6, CREST_W, CREST_H, 'wcems-crest-bw')
    const tx = MARGIN + CREST_W + 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...BLACK)
    doc.text('WALLER COUNTY', tx, top + 10, { charSpace: 1.2 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text('EMERGENCY MEDICAL SERVICES', tx, top + 23, { charSpace: 1.6 })
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_SOFT)
    doc.text('Hempstead, Texas   ·   Established 1996', tx, top + 34)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
    doc.text('FIELD TRAINING & EVALUATION', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(input.traineeName), W - MARGIN, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text('Megacode Evaluation · Confidential', W - MARGIN, top + 33, { align: 'right' })
    const ruleY = top + CREST_H
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(1.4)
    doc.line(MARGIN, ruleY, W - MARGIN, ruleY)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, ruleY + 3, W - MARGIN, ruleY + 3)
    y = ruleY + 24
  }

  function ensureSpace(needed: number) {
    if (y + needed > H - 46) {
      doc.addPage()
      pageHeader()
    }
  }

  function sectionRule(label: string) {
    ensureSpace(28)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(label.toUpperCase()), MARGIN, y, { charSpace: 0.5 })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
    y += 15
  }

  function checkRow(label: string, checked: boolean, mutedWhenUnchecked = false) {
    const lines = doc.splitTextToSize(pdfSafe(label), CONTENT_W - 26)
    ensureSpace(lines.length * 11.5 + 6)
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.8)
    doc.rect(MARGIN, y - 7, 9, 9)
    if (checked) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('X', MARGIN + 2.1, y + 0.5)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...(checked || !mutedWhenUnchecked ? INK : MUTED))
    doc.text(lines, MARGIN + 16, y, { lineHeightFactor: 1.2 })
    y += lines.length * 11.5 + 5
  }

  const score = megacodeScore(input.checks)

  pageHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...BLACK)
  doc.text('Megacode Evaluation', MARGIN, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_SOFT)
  doc.text('Simulated cardiac arrest management — required for credentialing release', MARGIN, y)
  y += 16

  const dateStr = new Date(`${input.dateIso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  for (const bit of [
    `Trainee: ${input.traineeName}`,
    `Examiner: ${input.examinerName}`,
    `Date: ${dateStr}   ·   Attempt: ${input.checks.attempt}${['st', 'nd', 'rd'][input.checks.attempt - 1]}`,
    `Scenario ${input.scenarioNo} — "${input.scenarioTitle}" (examiner sheet v1.0)`,
  ]) {
    doc.text(pdfSafe(bit), MARGIN, y)
    y += 13
  }
  y += 4

  sectionRule('Section 1 — Arrest management (one point each)')
  for (const i of MEGACODE_SECTION1) checkRow(i.label, !!input.checks.s1[i.key])
  y += 4

  sectionRule('Section 2 — Rhythm management (examiner runs at least three)')
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text('Point awarded when the rhythm is correctly identified AND treated per protocol.', MARGIN, y)
  y += 12
  for (const i of MEGACODE_RHYTHMS) checkRow(i.label, !!input.checks.rhythms[i.key], true)
  y += 4

  sectionRule('Section 3 — Post-resuscitation (one point each)')
  for (const i of MEGACODE_SECTION3) checkRow(i.label, !!input.checks.s3[i.key])
  y += 6

  ensureSpace(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...BLACK)
  doc.text(pdfSafe(`Total score: ${score.points} / 12 minimum`), MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_SOFT)
  doc.text('(all Section 1 and 3 items plus at least three rhythms)', MARGIN + 150, y)
  y += 18

  /* Automatic fails */
  const anyAf = MEGACODE_AUTOFAILS.some((i) => input.checks.autofails[i.key])
  ensureSpace(60)
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.8)
  const afTop = y - 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BLACK)
  doc.text('AUTOMATIC FAIL — any one results in an Unsuccessful evaluation regardless of score:', MARGIN + 8, y)
  y += 12
  for (const i of MEGACODE_AUTOFAILS) {
    doc.setFont('helvetica', input.checks.autofails[i.key] ? 'bold' : 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...(input.checks.autofails[i.key] ? BLACK : INK_SOFT))
    doc.text(pdfSafe(`${input.checks.autofails[i.key] ? '[X]' : '[  ]'}  ${i.label}`), MARGIN + 8, y)
    y += 11.5
  }
  doc.rect(MARGIN, afTop, CONTENT_W, y - afTop + 2)
  y += 16

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BLACK)
  doc.text(
    pdfSafe(`Result: ${score.passed ? 'PASS' : 'UNSUCCESSFUL'}${!score.passed && anyAf ? ' (automatic fail)' : ''}`),
    MARGIN,
    y,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_SOFT)
  doc.text('Re-evaluation per the FTEP Program Guide.', MARGIN + 220, y)
  y += 16

  if (input.comments.trim()) {
    sectionRule('Comments')
    const lines = doc.splitTextToSize(pdfSafe(input.comments.trim()), CONTENT_W)
    ensureSpace(lines.length * 12 + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, MARGIN, y, { lineHeightFactor: 1.25 })
    y += lines.length * 12 + 6
  }

  /* Signatures */
  sectionRule('Signatures')
  const sigW = (CONTENT_W - 30) / 2
  const SIG_H = 46
  ensureSpace(SIG_H + 40)
  const sigTop = y + 2
  function sig(x: number, img: string | null, name: string, role: string) {
    if (img) {
      try {
        doc.addImage(img, 'PNG', x, sigTop, sigW, SIG_H, undefined, 'FAST')
      } catch {
        /* keep the record even if the image is malformed */
      }
    }
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.7)
    doc.line(x, sigTop + SIG_H + 4, x + sigW, sigTop + SIG_H + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...BLACK)
    doc.text(pdfSafe(name), x, sigTop + SIG_H + 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(`${role}  ·  ${dateStr}`), x, sigTop + SIG_H + 25)
  }
  sig(MARGIN, input.examinerSignature, input.examinerName, 'Examiner signature')
  sig(MARGIN + sigW + 30, input.candidateSignature, input.traineeName, 'Trainee signature')

  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe('WCEMS Field Training & Evaluation Program · Megacode Evaluation (portal) · retain in the employee training file'),
    MARGIN,
    H - 30,
  )

  return doc
}
