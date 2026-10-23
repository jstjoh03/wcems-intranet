import jsPDF from 'jspdf'
import type { ProtocolSkillCheckoff, ProtocolSkillVerification } from '@/composables/useProtocolSkills'

/**
 * Protocol skills verification PDFs — the same letterhead B&W register
 * as every other filed form. Two shapes:
 *   blank      — the paper backup: criteria with empty checkboxes,
 *                name/date lines, pass/remediation boxes, signature
 *                lines. Printed per skill for clipboard use.
 *   completed  — the signed digital record, checkmarks + signature
 *                images, for the employee file.
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

const LEVEL_LABELS: Record<string, string> = {
  'EMT-B': 'EMT',
  'ADV EMT': 'Advanced EMT',
  'EMT-P': 'Paramedic',
  LP: 'Licensed Paramedic',
}

interface BaseInput {
  campaignTitle: string
  checkoff: ProtocolSkillCheckoff
}

interface CompletedInput extends BaseInput {
  verification: ProtocolSkillVerification
  candidateName: string
  evaluatorName: string
}

async function buildDoc(
  input: BaseInput,
  completed: CompletedInput | null,
): Promise<jsPDF> {
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
    doc.text('SKILLS VERIFICATION', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(input.campaignTitle), W - MARGIN, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text(completed ? pdfSafe(completed.candidateName) : 'Paper backup form', W - MARGIN, top + 33, { align: 'right' })
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

  pageHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...BLACK)
  const titleLines = doc.splitTextToSize(pdfSafe(input.checkoff.title), CONTENT_W)
  doc.text(titleLines, MARGIN, y)
  y += titleLines.length * 18
  if (input.checkoff.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    const subLines = doc.splitTextToSize(pdfSafe(input.checkoff.subtitle), CONTENT_W)
    doc.text(subLines, MARGIN, y)
    y += subLines.length * 11 + 2
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe(`Levels: ${input.checkoff.requiredLevels.map((l) => LEVEL_LABELS[l] ?? l).join(' · ')}`),
    MARGIN,
    y,
  )
  y += 16

  /* Identity block */
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  if (completed) {
    const d = new Date(`${completed.verification.evalDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
    doc.text(pdfSafe(`Employee: ${completed.candidateName}`), MARGIN, y)
    y += 13
    doc.text(pdfSafe(`Evaluator: ${completed.evaluatorName}   ·   Date: ${d}`), MARGIN, y)
    y += 16
  } else {
    doc.text('Employee: ______________________________________', MARGIN, y)
    doc.text('Date: ____________________', MARGIN + 300, y)
    y += 18
    doc.text('Evaluator: ______________________________________', MARGIN, y)
    y += 18
  }
  if (input.checkoff.note) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    const noteLines = doc.splitTextToSize(pdfSafe(input.checkoff.note), CONTENT_W)
    doc.text(noteLines, MARGIN, y)
    y += noteLines.length * 10.5 + 6
  }

  /* Criteria */
  for (const section of input.checkoff.sections) {
    ensureSpace(26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(section.title.toUpperCase()), MARGIN, y, { charSpace: 0.5 })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
    y += 15
    for (const item of section.items) {
      const lines = doc.splitTextToSize(pdfSafe(item.label), CONTENT_W - 26)
      ensureSpace(lines.length * 11.5 + 6)
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.8)
      doc.rect(MARGIN, y - 7, 9, 9)
      if (completed) {
        const res = completed.verification.items[item.key]?.result
        if (res === 'pass') {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(...BLACK)
          doc.text('X', MARGIN + 2.1, y + 0.5)
        }
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...INK)
      doc.text(lines, MARGIN + 16, y, { lineHeightFactor: 1.2 })
      y += lines.length * 11.5 + 5
    }
    y += 4
  }

  /* Result */
  ensureSpace(26)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...BLACK)
  if (completed) {
    doc.text(
      pdfSafe(`Result: ${completed.verification.overall === 'pass' ? 'VERIFIED — PASS' : 'REMEDIATION REQUIRED'}`),
      MARGIN,
      y,
    )
    if (completed.verification.note) {
      y += 13
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      const nl = doc.splitTextToSize(pdfSafe(`Note: ${completed.verification.note}`), CONTENT_W)
      doc.text(nl, MARGIN, y)
      y += nl.length * 11
    }
  } else {
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.8)
    doc.rect(MARGIN, y - 8, 10, 10)
    doc.text('Verified - Pass', MARGIN + 16, y)
    doc.rect(MARGIN + 150, y - 8, 10, 10)
    doc.text('Remediation required', MARGIN + 166, y)
  }
  y += 22

  /* Signatures */
  ensureSpace(90)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK_SOFT)
  doc.text('SIGNATURES', MARGIN, y, { charSpace: 0.5 })
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
  y += 14
  const sigW = (CONTENT_W - 30) / 2
  const SIG_H = 44
  const sigTop = y
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
    doc.text(pdfSafe(role), x, sigTop + SIG_H + 25)
  }
  sig(
    MARGIN,
    completed?.verification.candidateSignature ?? null,
    completed ? completed.candidateName : 'Employee signature  ·  Date',
    completed ? 'Employee' : '',
  )
  sig(
    MARGIN + sigW + 30,
    completed?.verification.evaluatorSignature ?? null,
    completed ? completed.evaluatorName : 'Evaluator signature  ·  Date',
    completed ? 'Evaluator' : '',
  )

  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe('WCEMS Clinical Development · Protocol-update skills verification · retain in the employee training file'),
    MARGIN,
    H - 30,
  )
  return doc
}

export async function generateProtocolSkillBlankPdf(input: BaseInput): Promise<jsPDF> {
  return buildDoc(input, null)
}

export async function generateProtocolSkillVerificationPdf(input: CompletedInput): Promise<jsPDF> {
  return buildDoc(input, input)
}
