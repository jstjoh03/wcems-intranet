import jsPDF from 'jspdf'
import {
  sectionsFor,
  DOR_SCALE_NOTE,
  ICR_SCALE_NOTE,
  ratingAverage,
} from '@/constants/ftepForms'
import type { FtepReport } from '@/types'

/**
 * Letterhead B&W PDF for a submitted DOR or ICR — same printable
 * letterhead treatment as the skills packet (grayscale crest,
 * WALLER COUNTY / EMERGENCY MEDICAL SERVICES, double rule), laid out
 * to mirror the v1.0 paper forms for the physical file.
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [35, 35, 35]
const INK_SOFT: [number, number, number] = [85, 85, 85]
const MUTED: [number, number, number] = [130, 130, 130]
const LINE: [number, number, number] = [200, 200, 200]
const SOFT_BG: [number, number, number] = [243, 243, 243]

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

export interface FtepPdfInput {
  report: FtepReport
  traineeName: string
  evaluatorName: string
}

export async function generateFtepReportPdf(input: FtepPdfInput): Promise<jsPDF> {
  const { report } = input
  const p = report.payload
  const isDor = report.kind === 'dor'
  const title = isDor ? 'Daily Observation Report' : 'Individual Call Report'

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
    doc.text(input.traineeName, W - MARGIN, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text(`${title} · Confidential`, W - MARGIN, top + 33, { align: 'right' })

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
    doc.text(label.toUpperCase(), MARGIN, y, { charSpace: 0.5 })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
    y += 15
  }

  function para(label: string, text: string | undefined) {
    const body = (text ?? '').trim() || '—'
    const lines = doc.splitTextToSize(body, CONTENT_W)
    ensureSpace(16 + lines.length * 11)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(label, MARGIN, y)
    y += 12
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(lines, MARGIN, y, { lineHeightFactor: 1.25 })
    y += lines.length * 11 + 8
  }

  /* ── Cover header ────────────────────────────────────────────────── */
  pageHeader()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...BLACK)
  doc.text(title, MARGIN, y)
  y += 20

  const dateStr = new Date(`${report.evalDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  const metaBits = [
    `Trainee: ${input.traineeName}`,
    `Evaluator: ${input.evaluatorName}${p.evaluatorRole ? ` (${{ fto: 'FTO', supervisor: 'Supervisor', clinical: 'Clinical' }[p.evaluatorRole]})` : ''}`,
    `Date: ${dateStr}`,
    p.tierPhase ? `Tier & phase: ${p.tierPhase}` : null,
    p.unit ? `Unit: ${p.unit}` : null,
    isDor && p.trainingDayNo ? `Training day ${p.trainingDayNo} of phase` : null,
  ].filter(Boolean) as string[]
  for (const bit of metaBits) {
    doc.text(bit, MARGIN, y)
    y += 13
  }
  y += 4

  /* ── Shift / call data ───────────────────────────────────────────── */
  if (isDor) {
    sectionRule('Shift data')
    const s = p.shift ?? {}
    const cells = [
      [`${s.dispatched ?? '—'}`, 'Calls dispatched'],
      [`${s.attended ?? '—'}`, 'Attended by trainee'],
      [`${s.icrs ?? '—'}`, 'ICRs completed'],
      [`${s.contacts ?? '—'}`, 'P2-required contacts'],
      [`${s.scenarios ?? '—'}`, 'Scenarios substituted'],
    ]
    const cw = CONTENT_W / cells.length
    ensureSpace(36)
    cells.forEach(([v, l], i) => {
      const x = MARGIN + i * cw
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(...BLACK)
      doc.text(v, x, y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(l.toUpperCase(), x, y + 10)
    })
    y += 28
  } else {
    sectionRule('Call data')
    const lvl = { bls: 'BLS', als: 'ALS', als_p2: 'ALS — P2-required' }[p.callLevel ?? 'bls']
    para('Incident', `#${p.incidentNo ?? '—'} · ${p.chiefComplaint ?? '—'} · ${lvl}` +
      (p.countsToward10 ? ' · counts toward the 10 required scored ALS evaluations' : ''))
  }

  /* ── Ratings table ───────────────────────────────────────────────── */
  const ratings = p.ratings ?? {}
  for (const section of sectionsFor(report.kind)) {
    sectionRule(section.title)
    for (const cat of section.categories) {
      const r = ratings[String(cat.no)]
      const comment = r?.comment?.trim()
      ensureSpace(comment ? 26 : 14)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      doc.text(`${cat.no} · ${cat.label}`, MARGIN, y, { maxWidth: CONTENT_W - 90 })

      const scoreX = W - MARGIN
      if (!r) {
        doc.setTextColor(...MUTED)
        doc.text('—', scoreX, y, { align: 'right' })
      } else if (r.score === 'NO') {
        doc.setTextColor(...MUTED)
        doc.text('N.O.', scoreX, y, { align: 'right' })
      } else {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9.5)
        doc.setTextColor(...BLACK)
        doc.text(String(r.score) + (r.nrt ? '  · NRT' : ''), scoreX, y, { align: 'right' })
      }
      if (comment) {
        y += 10
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK_SOFT)
        const lines = doc.splitTextToSize(comment, CONTENT_W - 16)
        doc.text(lines[0] ?? comment, MARGIN + 12, y)
      }
      y += 13
    }
    y += 4
  }

  const avg = p.average ?? ratingAverage(ratings)
  ensureSpace(30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...BLACK)
  doc.text(
    `Shift average: ${avg !== null && avg !== undefined ? avg.toFixed(2) : '—'} (N.O. excluded)` +
      (p.nrtFlagged ? '   ·   NRT FLAGGED — CDO NOTIFIED' : ''),
    MARGIN,
    y,
  )
  y += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  const scaleLines = doc.splitTextToSize(isDor ? DOR_SCALE_NOTE : ICR_SCALE_NOTE, CONTENT_W)
  doc.text(scaleLines, MARGIN, y, { lineHeightFactor: 1.3 })
  y += scaleLines.length * 9 + 10

  /* ── Narratives ──────────────────────────────────────────────────── */
  if (isDor) {
    sectionRule('Narrative')
    const n = p.narratives ?? {}
    para('Most acceptable performance today', n.best)
    para('Least acceptable performance today', n.least)
    if (n.situation?.trim()) para('Documented situation (required for any rating of 1)', n.situation)
    para(
      `Remedial training delivered today${n.remedialMinutes ? ` — ${n.remedialMinutes} minutes` : ''}`,
      n.remedial,
    )
    para('Goal for the next training day', n.goal)
  } else {
    if (p.explanation?.trim()) {
      sectionRule('Explanation — categories below 3')
      para('', p.explanation)
    }
    if (p.callNotes?.trim()) {
      sectionRule('Additional call notes')
      para('', p.callNotes)
    }
  }

  /* ── Signatures ──────────────────────────────────────────────────── */
  ensureSpace(130)
  y += 6
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.6)
  doc.rect(MARGIN, y - 10, CONTENT_W, 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(
    isDor
      ? 'This DOR was reviewed with the trainee, who had the opportunity to respond.'
      : 'This ICR was reviewed with the trainee.',
    MARGIN + 10,
    y + 6,
  )
  y += 34

  const sigW = (CONTENT_W - 30) / 2
  const sigH = 44
  const sigs: Array<{ label: string; name: string; data: string | null }> = [
    { label: 'TRAINEE', name: input.traineeName, data: report.traineeSignature },
    { label: 'FTO / EVALUATOR', name: input.evaluatorName, data: report.evaluatorSignature },
  ]
  sigs.forEach((s, i) => {
    const x = MARGIN + i * (sigW + 30)
    if (s.data) {
      try {
        doc.addImage(s.data, 'PNG', x, y, sigW, sigH)
      } catch { /* leave line blank */ }
    }
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.8)
    doc.line(x, y + sigH + 4, x + sigW, y + sigH + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(s.label, x, y + sigH + 15)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...BLACK)
    doc.text(s.name, x, y + sigH + 27)
  })
  y += sigH + 36

  /* ── Footer ──────────────────────────────────────────────────────── */
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, H - 32, W - MARGIN, H - 32)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(`Page ${i} of ${pageCount}`, W - MARGIN, H - 20, { align: 'right' })
    doc.text(
      'Recorded electronically in the WCEMS Employee Portal · Confidential · retained in the employee’s training file',
      MARGIN,
      H - 20,
    )
  }

  void SOFT_BG
  return doc
}
