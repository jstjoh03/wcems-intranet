import { jsPDF } from 'jspdf'
import type { ClinicalConversation } from '@/composables/useClinicalConversations'

/**
 * Clinical Conversation Record — minimal-letterhead B&W PDF for
 * printing/filing. Same letterhead language as the megacode eval:
 * crest + agency block, double rule, clean typographic sections,
 * signature images when captured, and the employee's comments.
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [55, 55, 55]
const INK_SOFT: [number, number, number] = [110, 110, 110]

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

export async function generateClinicalConversationPdf(c: ClinicalConversation): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const employee = c.participants.find((p) => p.isEmployee)
  const employeeName = employee?.displayName ?? ''
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
    doc.text('Hempstead, Texas   -   Established 1996', tx, top + 34)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
    doc.text('CLINICAL DEVELOPMENT', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(employeeName), W - MARGIN, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text('Clinical Conversation Record', W - MARGIN, top + 33, { align: 'right' })
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

  function sectionTitle(label: string) {
    ensureSpace(30)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(label.toUpperCase(), MARGIN, y, { charSpace: 1 })
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, y + 4, W - MARGIN, y + 4)
    y += 16
  }

  function paragraph(text: string) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(pdfSafe(text || '-'), CONTENT_W) as string[]
    for (const line of lines) {
      ensureSpace(13)
      doc.text(line, MARGIN, y)
      y += 13
    }
    y += 6
  }

  pageHeader()

  /* Title + non-disciplinary line */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...BLACK)
  doc.text('Clinical Conversation Record', MARGIN, y)
  y += 15
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'Documentation that a clinical conversation took place. This record is not disciplinary.',
    MARGIN,
    y,
  )
  y += 20

  /* Meta grid */
  const occurred = new Date(c.occurredAt)
  const meta: [string, string][] = [
    [
      'Date / time',
      occurred.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    ],
    ['Location', c.location || '-'],
    ['Employee', employeeName],
    ['Documented by', c.createdByName || '-'],
    ['Incident number', c.incidentNumber || '-'],
    ['Call type', c.callType || '-'],
  ]
  const colW = CONTENT_W / 2
  doc.setFontSize(9.5)
  for (let i = 0; i < meta.length; i += 2) {
    ensureSpace(16)
    for (let j = 0; j < 2 && i + j < meta.length; j++) {
      const [k, v] = meta[i + j]!
      const x = MARGIN + j * colW
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK_SOFT)
      doc.text(`${k}:`, x, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...INK)
      doc.text(pdfSafe(v), x + 78, y, { maxWidth: colW - 86 })
    }
    y += 16
  }
  const present = c.participants.map((p) => p.displayName + (p.isEmployee ? ' (employee)' : ''))
  ensureSpace(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...INK_SOFT)
  doc.text('Present:', MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...INK)
  const presentLines = doc.splitTextToSize(pdfSafe(present.join(', ')), CONTENT_W - 86) as string[]
  doc.text(presentLines, MARGIN + 78, y)
  y += presentLines.length * 12 + 10

  if (c.callDetails) {
    sectionTitle('Details of the call')
    paragraph(c.callDetails)
  }
  sectionTitle('What the discussion entailed')
  paragraph(c.discussion)

  sectionTitle('Employee comments')
  if (c.response) {
    paragraph(c.response)
    if (c.responseAt) {
      ensureSpace(12)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...INK_SOFT)
      doc.text(
        `Added ${new Date(c.responseAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        MARGIN,
        y,
      )
      y += 16
    }
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    ensureSpace(14)
    doc.text('No comments at the time this record was printed.', MARGIN, y)
    y += 18
  }

  /* Signatures */
  if (c.requireSignatures) {
    sectionTitle('Signatures')
    const SIG_W = (CONTENT_W - 24) / 2
    const SIG_H = 54
    let col = 0
    for (const p of c.participants) {
      if (col === 0) ensureSpace(SIG_H + 34)
      const x = MARGIN + col * (SIG_W + 24)
      if (p.signatureData?.startsWith('data:image')) {
        try {
          doc.addImage(p.signatureData, 'PNG', x, y, SIG_W * 0.72, SIG_H * 0.72)
        } catch {
          /* unreadable signature image — leave the line blank */
        }
      }
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.6)
      doc.line(x, y + SIG_H, x + SIG_W, y + SIG_H)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...INK)
      const label =
        pdfSafe(p.displayName) +
        (p.isEmployee ? ' (employee)' : '') +
        (p.signedAt
          ? `  -  signed ${new Date(p.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : '')
      doc.text(label, x, y + SIG_H + 11)
      col = 1 - col
      if (col === 0) y += SIG_H + 30
    }
    if (col === 1) y += SIG_H + 30
  }

  /* Footer on every page */
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      `Waller County EMS - Clinical Conversation Record - generated ${new Date().toLocaleDateString('en-US')}`,
      MARGIN,
      H - 28,
    )
    doc.text(`Page ${i} of ${pages}`, W - MARGIN, H - 28, { align: 'right' })
  }

  return doc
}
