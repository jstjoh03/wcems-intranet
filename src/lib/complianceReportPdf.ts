import jsPDF from 'jspdf'

/**
 * Internal compliance report — the Action Center's queues (missing
 * required certs, expiring/lapsed cards, jurisprudence & recurring
 * trainings, licenses) laid out on agency letterhead for printing or
 * filing. Same grayscale treatment as the FTEP report PDFs.
 */

export interface ComplianceReportRow {
  name: string
  item: string
  status: string
  when: string | null
}

export interface ComplianceReportSection {
  title: string
  hint: string
  rows: ComplianceReportRow[]
}

const BLACK: [number, number, number] = [20, 22, 26]
const INK: [number, number, number] = [45, 50, 60]
const INK_SOFT: [number, number, number] = [110, 115, 125]
const LINE: [number, number, number] = [205, 202, 194]

/** jsPDF's built-in Helvetica only covers cp1252 — dashes, middots and
 *  curly quotes are fine; ≤/≥ and anything else outside it are not. */
function pdfSafe(s: string): string {
  return s
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[^\x00-\xFF‘’“”–—·]/g, '')
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function generateComplianceReportPdf(
  sections: ComplianceReportSection[],
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
    doc.text('CLINICAL DEVELOPMENT', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text('Internal — not for distribution', W - MARGIN, top + 23, { align: 'right' })

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
    doc.text(`Compliance Report — page ${page}`, MARGIN, H - 30)
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} from the employee portal`,
      W - MARGIN,
      H - 30,
      { align: 'right' },
    )
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
  doc.setFontSize(16)
  doc.setTextColor(...BLACK)
  doc.text('Compliance Report', MARGIN, y)
  y += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_SOFT)
  const total = sections.reduce((n, s) => n + s.rows.length, 0)
  doc.text(
    pdfSafe(
      `${total} open item${total === 1 ? '' : 's'} across ${sections.length} categor${sections.length === 1 ? 'y' : 'ies'} · as of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    ),
    MARGIN,
    y,
  )
  y += 22

  const COL_NAME = MARGIN
  const COL_ITEM = MARGIN + 150
  const COL_WHEN = W - MARGIN

  for (const sec of sections) {
    if (sec.rows.length === 0) continue
    needRoom(46)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...BLACK)
    doc.text(pdfSafe(`${sec.title.toUpperCase()}  (${sec.rows.length})`), MARGIN, y, {
      charSpace: 0.5,
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(sec.hint), W - MARGIN, y, { align: 'right' })
    y += 6
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.7)
    doc.line(MARGIN, y, W - MARGIN, y)
    y += 13

    for (const row of sec.rows) {
      needRoom(15)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK)
      doc.text(pdfSafe(row.name), COL_NAME, y, { maxWidth: 140 })
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...INK)
      doc.text(pdfSafe(`${row.item} — ${row.status}`), COL_ITEM, y, {
        maxWidth: CONTENT_W - 150 - 78,
      })
      doc.setTextColor(...INK_SOFT)
      doc.text(fmtWhen(row.when), COL_WHEN, y, { align: 'right' })
      y += 6.5
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, W - MARGIN, y)
      y += 8.5
    }
    y += 10
  }

  if (total === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK_SOFT)
    doc.text('Nothing outstanding — all tracked items are current.', MARGIN, y)
  }

  pageFooter()
  return doc
}
