import jsPDF from 'jspdf'
import type { DailySummary } from '@/composables/useCommand'

/**
 * Supervisor Daily Summary — minimal-letterhead B&W PDF. Generated at
 * submit, archived in storage, and emailed to every supervisor
 * (parity with the retired Jotform's PDF email).
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [55, 55, 55]
const INK_SOFT: [number, number, number] = [110, 110, 110]
const PALE: [number, number, number] = [185, 185, 185]
const LINE: [number, number, number] = [225, 225, 225]

function pdfSafe(s: string): string {
  return (s ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .replace(/–/g, '-')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '')
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const SIDE_LABEL: Record<string, string> = {
  north: 'North -- S201',
  south: 'South -- S202',
  all: 'County-wide',
}

export async function generateDailySummaryPdf(s: DailySummary): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  const dateStr = new Date(`${s.shiftDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

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
    doc.text('Hempstead, Texas   -   Established 1996', tx, top + 34)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
    doc.text('OPERATIONS', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text('Supervisor Daily Summary', W - MARGIN, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text(pdfSafe(`${SIDE_LABEL[s.side] ?? s.side} - ${s.shiftLetter ?? ''} Shift`), W - MARGIN, top + 33, { align: 'right' })
    const ruleY = top + CREST_H
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(1.4)
    doc.line(MARGIN, ruleY, W - MARGIN, ruleY)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, ruleY + 3, W - MARGIN, ruleY + 3)
    y = ruleY + 26
  }

  function ensureSpace(needed: number) {
    if (y + needed > H - 54) {
      doc.addPage()
      pageHeader()
    }
  }

  function sectionRule(label: string) {
    ensureSpace(34)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(label.toUpperCase(), MARGIN, y, { charSpace: 1 })
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, y + 4, W - MARGIN, y + 4)
    y += 16
  }

  function kv(label: string, value: string) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(pdfSafe(label), MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(pdfSafe(value || '--'), CONTENT_W - 150) as string[]
    doc.text(lines, MARGIN + 150, y)
    y += Math.max(13, lines.length * 12 + 1)
  }

  function para(text: string) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(pdfSafe(text || '--'), CONTENT_W) as string[]
    for (const line of lines) {
      ensureSpace(12)
      doc.text(line, MARGIN, y)
      y += 12
    }
    y += 6
  }

  pageHeader()

  /* Title */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...BLACK)
  doc.text('Supervisor Daily Summary', MARGIN, y)
  y += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...INK_SOFT)
  doc.text(pdfSafe(`${dateStr}  -  ${SIDE_LABEL[s.side] ?? s.side}  -  ${s.shiftLetter ?? '?'} Shift`), MARGIN, y)
  y += 20

  const d = s.data
  const sups = (d.supervisors ?? [])
    .filter((x) => x.name.trim())
    .map((x) => (x.from || x.until ? `${x.name} (${x.from ?? '?'}-${x.until ?? '?'})` : x.name))
    .join(', ')
  const totalCalls = Object.values(d.units ?? {}).reduce(
    (t, u) => t + (Number(u.calls.post) || 0) + (Number(u.calls.transport) || 0) + (Number(u.calls.non) || 0),
    0,
  )
  kv('Supervisor', sups)
  kv('Chart audits', s.chartAudits != null ? String(s.chartAudits) : '--')
  kv('Total calls', String(totalCalls))
  y += 6

  /* Units */
  sectionRule('Units -- crew & calls')
  const UNIT_COL = [90, 150, 150, 0]
  for (const [unit, u] of Object.entries(d.units ?? {})) {
    ensureSpace(58)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BLACK)
    doc.text(pdfSafe(unit), MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      pdfSafe(`post ${u.calls.post ?? 0} - transport ${u.calls.transport ?? 0} - non-transport ${u.calls.non ?? 0}`),
      W - MARGIN, y, { align: 'right' },
    )
    y += 12
    const rows: Array<[string, string, string]> = [
      ['In charge', u.am.ic, u.pm.ic],
      ['Attendant', u.am.at, u.pm.at],
    ]
    if (u.hasThird || u.am.third || u.pm.third) rows.push(['NEOP / 3rd', u.am.third, u.pm.third])
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text('', MARGIN + UNIT_COL[0], y)
    for (const [label, am, pm] of rows) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...INK_SOFT)
      doc.text(pdfSafe(label), MARGIN + 8, y)
      doc.setTextColor(...INK)
      doc.text(pdfSafe(am || '--'), MARGIN + UNIT_COL[0], y)
      doc.text(pdfSafe(pm || '--'), MARGIN + UNIT_COL[0] + UNIT_COL[1], y)
      y += 11
    }
    doc.setFontSize(7)
    doc.setTextColor(...PALE)
    doc.text('AM', MARGIN + UNIT_COL[0], y - rows.length * 11 - 11 + 2)
    doc.text('PM', MARGIN + UNIT_COL[0] + UNIT_COL[1], y - rows.length * 11 - 11 + 2)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y + 2, W - MARGIN, y + 2)
    y += 12
  }

  /* Fleet */
  const fleetRows = Object.entries(d.fleet ?? {})
  if (fleetRows.length) {
    sectionRule('Fleet')
    doc.setFontSize(8.5)
    for (const [veh, f] of fleetRows) {
      ensureSpace(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK)
      doc.text(pdfSafe(veh), MARGIN, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(f.status === 'oos' ? BLACK[0] : INK_SOFT[0], f.status === 'oos' ? 20 : 110, f.status === 'oos' ? 20 : 110)
      const bits = [
        f.status === 'oos' ? 'OOS' : 'In service',
        f.location || null,
        f.pstrax ? 'PSTrax updated' : 'PSTrax NOT updated',
        f.notes || null,
      ].filter(Boolean)
      doc.text(pdfSafe(bits.join('  -  ')), MARGIN + 80, y)
      y += 12
    }
    y += 6
  }

  /* Downtime */
  sectionRule('Unit downtime')
  if (!d.downtime.first.used) {
    para('No units placed on downtime.')
  } else {
    kv('Unit on downtime', `${d.downtime.first.unit} ${d.downtime.first.from}-${d.downtime.first.until} -- ${d.downtime.first.reason}`)
    if (d.downtime.second.used) {
      kv('Second unit', `${d.downtime.second.unit} ${d.downtime.second.from}-${d.downtime.second.until} -- ${d.downtime.second.reason}`)
    }
    y += 4
  }

  /* ESD */
  sectionRule('ESD reporting')
  kv('Another agency posted for us', d.esd.postedForUs.answer ? `Yes -- ${d.esd.postedForUs.agency} ${d.esd.postedForUs.details}` : 'No')
  kv('We posted for another agency', d.esd.wePosted.answer ? `Yes -- ${d.esd.wePosted.agency} ${d.esd.wePosted.details}` : 'No')
  if (!d.esd.lateCalls.answer || !d.esd.lateCalls.rows.length) {
    kv('En-route times > 10 minutes', 'No')
  } else {
    kv('En-route times > 10 minutes', `Yes -- ${d.esd.lateCalls.rows.length} call${d.esd.lateCalls.rows.length === 1 ? '' : 's'}`)
    doc.setFontSize(8.5)
    for (const r of d.esd.lateCalls.rows) {
      ensureSpace(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK)
      doc.text(pdfSafe(r.incident || '--'), MARGIN + 8, y)
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(pdfSafe(r.reason || '--'), CONTENT_W - 110) as string[]
      doc.text(lines, MARGIN + 110, y)
      y += Math.max(12, lines.length * 11 + 1)
    }
    y += 4
  }

  /* Notes */
  const noteBlocks: Array<[string, string]> = [
    ['Equipment notes', d.notes.equipment],
    ['Personnel notes', d.notes.personnel],
    ['Supplies notes', d.notes.supplies],
    ['Other notes', d.notes.other],
  ]
  for (const [label, text] of noteBlocks) {
    if (!text?.trim()) continue
    sectionRule(label)
    para(text)
  }

  /* Footer on every page */
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(`Page ${i} of ${pages}`, W - MARGIN, H - 20, { align: 'right' })
    doc.text(pdfSafe(`Supervisor Daily Summary -- ${s.shiftDate}`), MARGIN, H - 20)
  }

  return doc
}
