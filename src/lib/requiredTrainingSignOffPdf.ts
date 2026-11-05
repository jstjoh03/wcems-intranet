import jsPDF from 'jspdf'

/**
 * Multi-page sign-off-sheet PDF for a single required-training module
 * (also drives policy acknowledgement sheets via the labels input).
 *
 * Restyled 2026-11-04 (Justin): the old navy web-band header is gone —
 * this now carries the same minimal B&W letterhead as the clinical
 * conversation / megacode documents (crest + agency block + double
 * rule), so everything filed on paper reads as one family.
 *
 * Layout philosophy (2026-06-01, unchanged):
 *   • The CSV export is the wide audit format. This PDF is the
 *     "Rhonda-prints-it-for-HR" format — name, signature, date.
 *   • One compact row per person; FT first then PT, last-name alpha.
 *   • Self-attested signatures embed inline; admin-marked rows show
 *     "Marked by <Admin>"; unsigned rows stay with "—" so the sheet
 *     is a true sign-off roster.
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

export interface SignOffEntry {
  fullName: string
  /** Used to drive the FT / PT grouping in the PDF. */
  employmentType: 'full_time' | 'part_time'
  status: 'signed' | 'in_progress' | 'not_started'
  signedMethod: 'self' | 'admin_marked' | null
  completedAt: string | null
  signatureDataUrl: string | null
  markedByName: string | null
  /** Knowledge-test score (0–100) when the module has one; null = no
   *  test or not yet passed. Rendered under the completion date. */
  quizScore?: number | null
}

export interface SignOffLabels {
  /** Letterhead right-block department line (uppercase). */
  deptLine: string
  /** Letterhead right-block document name. */
  docName: string
  /** Column header above the signature timestamp column. */
  dateColumnHeader: string
  /** Verb used in "X of Y <verb> (Z%)" subtitle. */
  completedVerb: string
}

export const DEFAULT_TRAINING_LABELS: SignOffLabels = {
  deptLine: 'REQUIRED TRAINING',
  docName: 'Sign-off sheet',
  dateColumnHeader: 'COMPLETION DATE',
  completedVerb: 'completed',
}

export const DEFAULT_POLICY_LABELS: SignOffLabels = {
  deptLine: 'POLICY ACKNOWLEDGEMENT',
  docName: 'Acknowledgement sheet',
  dateColumnHeader: 'ACKNOWLEDGED ON',
  completedVerb: 'acknowledged',
}

export interface SignOffPdfInput {
  moduleTitle: string
  generatedAt?: Date
  entries: SignOffEntry[]
  /** Optional label overrides. Defaults to training labels for back-compat. */
  labels?: SignOffLabels
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Sort key: last word of the full name (lowercased). Falls back to the
 *  whole name if there's no space. */
function lastNameKey(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return (parts[parts.length - 1] ?? fullName).toLowerCase()
}

export async function generateRequiredTrainingSignOffPdf(
  input: SignOffPdfInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth() // 612
  const H = doc.internal.pageSize.getHeight() // 792

  const MARGIN_X = 52
  const MARGIN_BOTTOM = 44
  const CONTENT_W = W - MARGIN_X * 2

  const labels = input.labels ?? DEFAULT_TRAINING_LABELS
  const generatedAt = input.generatedAt ?? new Date()
  const generatedStr = generatedAt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  /* ── Sort: FT first then PT, last-name alpha inside each group. ──── */
  const ftEntries = input.entries
    .filter((e) => e.employmentType === 'full_time')
    .sort((a, b) => lastNameKey(a.fullName).localeCompare(lastNameKey(b.fullName)))
  const ptEntries = input.entries
    .filter((e) => e.employmentType === 'part_time')
    .sort((a, b) => lastNameKey(a.fullName).localeCompare(lastNameKey(b.fullName)))

  const signedCount = input.entries.filter((e) => e.status === 'signed').length
  const totalCount = input.entries.length
  const pct = totalCount === 0 ? 0 : Math.round((signedCount / totalCount) * 100)

  /* Column geometry — one horizontal row per person. */
  const COL_NAME_X = MARGIN_X
  const COL_NAME_W = 170
  const COL_SIG_X = COL_NAME_X + COL_NAME_W + 10
  const COL_SIG_W = 200
  const COL_DATE_X = COL_SIG_X + COL_SIG_W + 10
  const ROW_H = 36
  const SIG_H = 28 // image height inside the signature column

  let y = 0

  /* ── Minimal letterhead — crest + agency block + double rule ─────── */
  function pageHeader() {
    const top = 34
    if (crest) doc.addImage(crest, 'JPEG', MARGIN_X, top - 6, CREST_W, CREST_H, 'wcems-crest-bw')
    const tx = MARGIN_X + CREST_W + 14
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
    doc.text(pdfSafe(labels.deptLine), W - MARGIN_X, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(pdfSafe(labels.docName), W - MARGIN_X, top + 22, { align: 'right' })
    doc.setFontSize(7.5)
    doc.text(pdfSafe(`Generated ${generatedStr}`), W - MARGIN_X, top + 33, { align: 'right' })
    const ruleY = top + CREST_H
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(1.4)
    doc.line(MARGIN_X, ruleY, W - MARGIN_X, ruleY)
    doc.setLineWidth(0.4)
    doc.line(MARGIN_X, ruleY + 3, W - MARGIN_X, ruleY + 3)
    y = ruleY + 26
  }

  /* ── Title block (page 1 only) ───────────────────────────────────── */
  function drawTitleBlock() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...BLACK)
    doc.text(pdfSafe(input.moduleTitle), MARGIN_X, y)
    y += 15
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      pdfSafe(`${signedCount} of ${totalCount} ${labels.completedVerb} (${pct}%)`),
      MARGIN_X,
      y,
    )
    y += 18
  }

  /* ── Column header strip ─────────────────────────────────────────── */
  function drawColumnHeader() {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text('NAME', COL_NAME_X + 2, y, { charSpace: 0.6 })
    doc.text('SIGNATURE', COL_SIG_X + 2, y, { charSpace: 0.6 })
    doc.text(labels.dateColumnHeader, COL_DATE_X + 2, y, { charSpace: 0.6 })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN_X, y + 4, MARGIN_X + CONTENT_W, y + 4)
    y += 14
  }

  /* ── Group label ("Full-Time" / "Part-Time") ─────────────────────── */
  function drawGroupLabel(label: string, count: number) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK_SOFT)
    doc.text(`${label.toUpperCase()}  (${count})`, MARGIN_X, y, { charSpace: 1 })
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.4)
    doc.line(MARGIN_X, y + 4, W - MARGIN_X, y + 4)
    y += 14
  }

  /* ── One compact row ─────────────────────────────────────────────── */
  function drawRow(entry: SignOffEntry) {
    /* Name */
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...BLACK)
    const nameLines = doc.splitTextToSize(pdfSafe(entry.fullName), COL_NAME_W - 4)
    doc.text(nameLines[0] ?? pdfSafe(entry.fullName), COL_NAME_X + 2, y + 18)

    /* Signature column */
    if (entry.status === 'signed' && entry.signedMethod === 'self' && entry.signatureDataUrl) {
      try {
        doc.addImage(
          entry.signatureDataUrl,
          'PNG',
          COL_SIG_X + 2,
          y + 2,
          COL_SIG_W - 4,
          SIG_H,
        )
      } catch {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(9)
        doc.setTextColor(...INK_SOFT)
        doc.text('[signature on file]', COL_SIG_X + 2, y + 18)
      }
    } else if (entry.status === 'signed' && entry.signedMethod === 'admin_marked') {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      const text = pdfSafe(`Marked by ${entry.markedByName ?? 'admin'}`)
      const wrapped = doc.splitTextToSize(text, COL_SIG_W - 4)
      doc.text(wrapped[0] ?? text, COL_SIG_X + 2, y + 18)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...PALE)
      doc.text('—', COL_SIG_X + 2, y + 18)
    }

    /* Date (+ knowledge-test score when the module has one) */
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    if (entry.completedAt) {
      doc.setTextColor(...INK)
      doc.text(formatDate(entry.completedAt), COL_DATE_X + 2, y + 18)
      if (entry.quizScore != null) {
        doc.setFontSize(7.5)
        doc.setTextColor(...INK_SOFT)
        doc.text(`Test ${entry.quizScore}%`, COL_DATE_X + 2, y + 28)
      }
    } else {
      doc.setTextColor(...PALE)
      doc.text('—', COL_DATE_X + 2, y + 18)
    }

    /* Row separator */
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN_X, y + ROW_H - 1, MARGIN_X + CONTENT_W, y + ROW_H - 1)

    y += ROW_H
  }

  /* ── Layout pass ─────────────────────────────────────────────────── */
  pageHeader()
  drawTitleBlock()
  drawColumnHeader()
  let pageNum = 1

  function ensureSpace(needed: number) {
    if (y + needed > H - MARGIN_BOTTOM) {
      doc.addPage()
      pageNum += 1
      pageHeader()
      drawColumnHeader()
    }
  }

  if (ftEntries.length) {
    ensureSpace(18 + ROW_H)
    y += 4
    drawGroupLabel('Full-Time', ftEntries.length)
    for (const entry of ftEntries) {
      ensureSpace(ROW_H)
      drawRow(entry)
    }
  }

  if (ptEntries.length) {
    ensureSpace(22 + ROW_H)
    y += 10
    drawGroupLabel('Part-Time', ptEntries.length)
    for (const entry of ptEntries) {
      ensureSpace(ROW_H)
      drawRow(entry)
    }
  }

  const pageCount = pageNum

  /* ── Page footer (Page X of Y, signed count) ─────────────────────── */
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(`Page ${i} of ${pageCount}`, W - MARGIN_X, H - 20, { align: 'right' })
    doc.text(
      pdfSafe(`${signedCount} of ${totalCount} ${labels.completedVerb}`),
      MARGIN_X,
      H - 20,
    )
  }

  return doc
}
