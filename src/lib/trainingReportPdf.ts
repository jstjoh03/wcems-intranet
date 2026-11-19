import jsPDF from 'jspdf'
import type { ReportRow, ReportSummary } from '@/composables/useTrainingReports'

/**
 * Monthly Training & Education Report — minimal-letterhead B&W PDF for
 * the board packet. Same letterhead language as the compliance report:
 * crest + WALLER COUNTY block, double rule, dated footer. The table
 * mirrors the old spreadsheet exactly: DATE · TRAINING · IN-PERSON ·
 * VIRTUAL · TOTAL · NOTES, then the MONTH SUMMARY box.
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

function fmtDay(iso: string): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function cnt(n: number | null): string {
  return n === null ? '—' : String(n)
}

export interface TrainingReportPdfInput {
  monthLabel: string
  rows: ReportRow[]
  summary: ReportSummary
  filedByName: string | null
  filedAt: string | null
}

export async function generateTrainingReportPdf(input: TrainingReportPdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  let y = 0
  let page = 1

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
    doc.text('EDUCATION & TRAINING', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text('Board of Directors — monthly report', W - MARGIN, top + 23, { align: 'right' })

    doc.setDrawColor(...BLACK)
    doc.setLineWidth(1.2)
    doc.line(MARGIN, top + 46, W - MARGIN, top + 46)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, top + 50, W - MARGIN, top + 50)
    y = top + 70
  }

  function pageFooter() {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_SOFT)
    doc.text('Waller County EMS  ·  Education & Training', MARGIN, H - 30)
    const filed = input.filedAt
      ? `Filed ${new Date(input.filedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${input.filedByName ? ` by ${input.filedByName}` : ''}`
      : `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} from the employee portal`
    doc.text(pdfSafe(`${filed}  ·  page ${page}`), W - MARGIN, H - 30, { align: 'right' })
  }

  function needRoom(h: number) {
    if (y + h > H - 56) {
      pageFooter()
      doc.addPage()
      page += 1
      pageHeader()
    }
  }

  pageHeader()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...BLACK)
  doc.text('MONTHLY TRAINING & EDUCATION REPORT', MARGIN, y, { charSpace: 0.6 })
  y += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(pdfSafe(input.monthLabel), MARGIN, y)
  y += 24

  /* Column geometry (notes get the leftover). */
  const C_DATE = MARGIN
  const C_TITLE = MARGIN + 46
  const C_IP = MARGIN + 268
  const C_V = MARGIN + 318
  const C_TOT = MARGIN + 366
  const C_NOTES = MARGIN + 386
  const NOTES_W = W - MARGIN - C_NOTES

  function tableHead() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...INK_SOFT)
    doc.text('DATE', C_DATE, y, { charSpace: 0.6 })
    doc.text('TRAINING', C_TITLE, y, { charSpace: 0.6 })
    doc.text('IN-PERSON', C_IP, y, { align: 'right', charSpace: 0.6 })
    doc.text('VIRTUAL', C_V, y, { align: 'right', charSpace: 0.6 })
    doc.text('TOTAL', C_TOT, y, { align: 'right', charSpace: 0.6 })
    doc.text('NOTES', C_NOTES, y, { charSpace: 0.6 })
    y += 5
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.8)
    doc.line(MARGIN, y, W - MARGIN, y)
    y += 12
  }

  tableHead()

  for (const row of input.rows) {
    const titleLines = doc.splitTextToSize(pdfSafe(row.title), 212) as string[]
    const noteLines = row.notes ? (doc.splitTextToSize(pdfSafe(row.notes), NOTES_W) as string[]) : []
    const lines = Math.max(titleLines.length, noteLines.length, 1)
    const rowH = lines * 9.5 + 7
    const pageBefore = page
    needRoom(rowH + 4)
    if (page !== pageBefore) tableHead()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    doc.text(fmtDay(row.on), C_DATE, y)
    doc.setFont('helvetica', 'bold')
    doc.text(titleLines, C_TITLE, y)
    doc.setFont('helvetica', 'normal')
    doc.text(cnt(row.inPerson), C_IP, y, { align: 'right' })
    doc.text(cnt(row.virtual), C_V, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(row.total === null ? 'None' : String(row.total), C_TOT, y, { align: 'right' })
    if (noteLines.length) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...INK_SOFT)
      doc.text(noteLines, C_NOTES, y)
    }
    y += lines * 9.5 + 3
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y, W - MARGIN, y)
    y += 10
  }

  if (input.rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    doc.text('No trainings recorded for this month.', MARGIN, y)
    y += 20
  }

  /* MONTH SUMMARY box — the spreadsheet's closing block. */
  needRoom(78)
  y += 8
  const boxH = 58
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(1)
  doc.rect(MARGIN, y, W - MARGIN * 2, boxH)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...BLACK)
  doc.text('MONTH SUMMARY', MARGIN + 14, y + 16, { charSpace: 0.8 })
  const cells: Array<[string, string]> = [
    [String(input.summary.trainings), 'TRAININGS HELD'],
    [String(input.summary.inPerson), 'IN-PERSON'],
    [String(input.summary.virtual), 'VIRTUAL'],
    [String(input.summary.total), 'TOTAL (ALL)'],
  ]
  const cellW = (W - MARGIN * 2 - 28) / 4
  cells.forEach(([n, label], i) => {
    const cx = MARGIN + 14 + cellW * i
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...BLACK)
    doc.text(n, cx, y + 38)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(label, cx, y + 48, { charSpace: 0.6 })
  })
  y += boxH

  pageFooter()
  return doc
}
