import jsPDF from 'jspdf'

/**
 * Phase Advancement Record — letterhead B&W PDF mirroring the v1.0
 * paper form: four certifications of completion with their evidence,
 * any documented rule waiver, the next phase opening, and the three
 * signatures (employee + FTO drawn on-device; the CDO signs
 * electronically by saving). Files into the employee's documents.
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

export interface AdvancementCertLine {
  label: string
  checked: boolean
  evidence: string
}

export interface AdvancementPdfInput {
  traineeName: string
  certLevel: string
  programLabel: string
  fromPhaseLabel: string
  toPhaseLabel: string | null
  effectiveDate: string
  certs: AdvancementCertLine[]
  waivers: { rule: string; reason: string }[]
  nextStartDate: string | null
  nextFtoName: string | null
  note: string
  employeeSignature: string | null
  ftoSignature: string | null
  ftoName: string | null
  cdoName: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function generateAdvancementRecordPdf(input: AdvancementPdfInput): Promise<jsPDF> {
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
    doc.text('Phase Advancement Record · Confidential', W - MARGIN, top + 33, { align: 'right' })

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

  pageHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...BLACK)
  doc.text('Phase Advancement Record', MARGIN, y)
  y += 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  const metaBits = [
    `Employee: ${input.traineeName} (${input.certLevel})`,
    `Program: ${input.programLabel}`,
    `Advancement: ${input.fromPhaseLabel} -> ${input.toPhaseLabel ?? 'program complete (credentialing packet follows)'}`,
    `Effective date: ${fmtDate(input.effectiveDate)}`,
  ]
  for (const bit of metaBits) {
    doc.text(pdfSafe(bit), MARGIN, y)
    y += 13
  }
  y += 4

  /* ── Certifications ──────────────────────────────────────────────── */
  sectionRule('Certification of completion')
  for (const c of input.certs) {
    const lines = doc.splitTextToSize(pdfSafe(c.label), CONTENT_W - 120)
    ensureSpace(lines.length * 12 + 10)
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.8)
    doc.rect(MARGIN, y - 7, 9, 9)
    if (c.checked) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('X', MARGIN + 2.1, y + 0.5)
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, MARGIN + 16, y, { lineHeightFactor: 1.2 })
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(pdfSafe(c.evidence), W - MARGIN, y, { align: 'right' })
    y += lines.length * 12 + 7
  }
  y += 4

  /* ── Waivers ─────────────────────────────────────────────────────── */
  if (input.waivers.length) {
    sectionRule('Documented exceptions (this advancement only)')
    for (const w of input.waivers) {
      const lines = doc.splitTextToSize(pdfSafe(`${w.rule} — ${w.reason}`), CONTENT_W)
      ensureSpace(lines.length * 12 + 6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      doc.text(lines, MARGIN, y, { lineHeightFactor: 1.2 })
      y += lines.length * 12 + 4
    }
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(
      pdfSafe('One-time, documented exception on this record only - the program rule is unchanged.'),
      MARGIN,
      y,
    )
    y += 16
  }

  /* ── Next phase ──────────────────────────────────────────────────── */
  if (input.toPhaseLabel) {
    sectionRule(`${input.toPhaseLabel} opens`)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(pdfSafe(`Start date: ${fmtDate(input.nextStartDate)}`), MARGIN, y)
    y += 13
    doc.text(pdfSafe(`Field Training Officer: ${input.nextFtoName ?? '—'}`), MARGIN, y)
    y += 18
  }

  if (input.note.trim()) {
    sectionRule('Notes')
    const lines = doc.splitTextToSize(pdfSafe(input.note.trim()), CONTENT_W)
    ensureSpace(lines.length * 12 + 8)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, MARGIN, y, { lineHeightFactor: 1.25 })
    y += lines.length * 12 + 8
  }

  /* ── Signatures ──────────────────────────────────────────────────── */
  sectionRule('Signatures')
  const sigW = (CONTENT_W - 40) / 3
  const SIG_H = 46
  ensureSpace(SIG_H + 46)
  const sigTop = y + 2

  function sigBlock(x: number, img: string | null, name: string, role: string, extra?: string) {
    if (img) {
      try {
        doc.addImage(img, 'PNG', x, sigTop, sigW, SIG_H, undefined, 'FAST')
      } catch {
        /* a malformed data URL shouldn't kill the record */
      }
    } else if (extra) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(pdfSafe(extra), x, sigTop + SIG_H - 6)
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

  sigBlock(
    MARGIN,
    input.employeeSignature,
    input.traineeName,
    'Employee — acknowledgement',
    'signature to be collected on the printed copy',
  )
  sigBlock(
    MARGIN + sigW + 20,
    input.ftoSignature,
    input.ftoName ?? 'Field Training Officer',
    'Field Training Officer',
    'signature to be collected on the printed copy',
  )
  /* CDO signs electronically by saving the record. */
  const cx = MARGIN + (sigW + 20) * 2
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text(pdfSafe(input.cdoName), cx, sigTop + SIG_H - 8)
  sigBlock(cx, null, input.cdoName, 'Clinical Development Officer', undefined)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe(`Signed electronically in the WCEMS portal · ${fmtDate(new Date().toISOString().slice(0, 10))}`),
    cx,
    sigTop + SIG_H + 34,
  )

  /* Footer */
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text(
    pdfSafe('WCEMS Field Training & Evaluation Program · Phase Advancement Record (portal) · retain in the employee training file'),
    MARGIN,
    H - 30,
  )

  return doc
}
