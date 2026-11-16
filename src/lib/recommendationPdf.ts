import jsPDF from 'jspdf'

/**
 * Advancement Recommendation — letterhead B&W PDF mirroring the v1.0
 * "Final Release Recommendation (Standalone)" paper form, generalized
 * to the credential being recommended. One page: the attestation
 * checkbox pairs, the boxed "only question that matters", the
 * recommendation, the narrative basis, and the recommender's
 * signature drawn on-device. Files into the employee's documents.
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

export interface RecommendationPdfInput {
  traineeName: string
  certLevel: string
  /** The credential recommended, e.g. "P2" / "P1". */
  toLabel: string
  transitionLabel: string
  recommenderName: string
  recommenderRole: string
  knowledge: boolean
  safeEthical: boolean
  comfortable: boolean
  recommendation: 'release' | 'extend' | 'separate'
  basis: string
  signature: string | null
  evalDate: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function generateRecommendationPdf(input: RecommendationPdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

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
  doc.text('Advancement Recommendation · Confidential', W - MARGIN, top + 33, { align: 'right' })

  const ruleY = top + CREST_H
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(1.4)
  doc.line(MARGIN, ruleY, W - MARGIN, ruleY)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, ruleY + 3, W - MARGIN, ruleY + 3)
  let y = ruleY + 26

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...BLACK)
  doc.text('Advancement Recommendation', MARGIN, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    pdfSafe(
      `${input.transitionLabel} · completed independently by each recommender · two letters required on file`,
    ),
    MARGIN,
    y,
  )
  y += 22

  function sectionRule(label: string) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(label.toUpperCase()), MARGIN, y, { charSpace: 0.5 })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
    y += 16
  }

  function metaLine(k: string, v: string) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(pdfSafe(k), MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(pdfSafe(v), MARGIN + 150, y)
    y += 14
  }

  sectionRule('Trainee & recommender')
  metaLine('Trainee', `${input.traineeName} (${input.certLevel})`)
  metaLine('Recommender', `${input.recommenderName} — ${input.recommenderRole}`)
  metaLine('Date', fmtDate(input.evalDate))
  y += 8

  /* Checkbox pair, paper-form style: [X] has   [ ] has not */
  function pair(checkedFirst: boolean, firstWord: string, secondWord: string, rest: string) {
    const lines = doc.splitTextToSize(pdfSafe(rest), CONTENT_W - 150)
    const draw = (x: number, on: boolean, word: string): number => {
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.8)
      doc.rect(x, y - 7, 9, 9)
      if (on) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor(...BLACK)
        doc.text('X', x + 2.1, y + 0.5)
      }
      doc.setFont('helvetica', on ? 'bold' : 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...INK)
      doc.text(pdfSafe(word), x + 13, y)
      return x + 13 + doc.getTextWidth(pdfSafe(word)) + 12
    }
    let x = draw(MARGIN, checkedFirst, firstWord)
    x = draw(x, !checkedFirst, secondWord)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, x, y, { lineHeightFactor: 1.25 })
    y += Math.max(1, lines.length) * 12 + 8
  }

  sectionRule('Attestations')
  pair(
    input.knowledge,
    'has',
    'has not',
    'demonstrated acceptable knowledge of Waller County EMS operational policies and clinical protocols.',
  )
  pair(input.safeEthical, 'does', 'does not', 'operate in a safe, team-based, and ethical manner.')
  y += 2

  /* The boxed question. */
  const qLines = doc.splitTextToSize(
    pdfSafe(
      `I ${input.comfortable ? 'WOULD' : 'WOULD NOT'} be comfortable with this provider responding to my own home and caring for a member of my family.`,
    ),
    CONTENT_W - 30,
  )
  const boxH = qLines.length * 12 + 26
  doc.setFillColor(242, 242, 242)
  doc.rect(MARGIN, y - 4, CONTENT_W, boxH, 'F')
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(2)
  doc.line(MARGIN, y - 4, MARGIN, y - 4 + boxH)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK_SOFT)
  doc.text('THE ONLY QUESTION THAT MATTERS', MARGIN + 14, y + 8, { charSpace: 0.8 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...BLACK)
  doc.text(qLines, MARGIN + 14, y + 22, { lineHeightFactor: 1.25 })
  y += boxH + 14

  sectionRule('Recommendation')
  const options: { key: RecommendationPdfInput['recommendation']; label: string }[] = [
    {
      key: 'release',
      label: `Release as ${input.toLabel} — field duty, overtime, and special events within ${input.toLabel} authorizations`,
    },
    { key: 'extend', label: 'Extend training (phase and days specified on Phase Transition Record)' },
    { key: 'separate', label: 'Recommend separation from the program' },
  ]
  for (const o of options) {
    const on = input.recommendation === o.key
    const lines = doc.splitTextToSize(pdfSafe(o.label), CONTENT_W - 20)
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.8)
    doc.rect(MARGIN, y - 7, 9, 9)
    if (on) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('X', MARGIN + 2.1, y + 0.5)
    }
    doc.setFont('helvetica', on ? 'bold' : 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, MARGIN + 16, y, { lineHeightFactor: 1.2 })
    y += lines.length * 12 + 6
  }
  y += 8

  sectionRule('Basis for this recommendation')
  const basisLines = doc.splitTextToSize(pdfSafe(input.basis.trim() || '—'), CONTENT_W)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...INK)
  doc.text(basisLines, MARGIN, y, { lineHeightFactor: 1.3 })
  y += basisLines.length * 12.5 + 16

  /* Signature */
  sectionRule('Recommender')
  const SIG_W = 200
  const SIG_H = 46
  if (y + SIG_H + 60 > H - 40) y = H - 40 - SIG_H - 60
  if (input.signature) {
    try {
      doc.addImage(input.signature, 'PNG', MARGIN, y, SIG_W, SIG_H, undefined, 'FAST')
    } catch {
      /* a malformed data URL shouldn't kill the letter */
    }
  }
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.7)
  doc.line(MARGIN, y + SIG_H + 4, MARGIN + SIG_W, y + SIG_H + 4)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BLACK)
  doc.text(pdfSafe(input.recommenderName), MARGIN, y + SIG_H + 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK_SOFT)
  doc.text(pdfSafe(`${input.recommenderRole} · signed in the WCEMS portal · ${fmtDate(input.evalDate)}`), MARGIN, y + SIG_H + 25)

  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe(
      'WCEMS Field Training & Evaluation Program · Advancement Recommendation (portal) · retain in the employee training file',
    ),
    MARGIN,
    H - 30,
  )

  return doc
}
