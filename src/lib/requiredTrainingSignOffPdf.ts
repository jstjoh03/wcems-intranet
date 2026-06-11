import jsPDF from 'jspdf'

/**
 * Multi-page sign-off-sheet PDF for a single required-training module.
 *
 * Layout philosophy (rewritten 2026-06-01):
 *   • The CSV export is the wide audit format (role/shift/station/method/
 *     notes/etc.). This PDF is the "Rhonda-prints-it-for-HR" format —
 *     name, signature, completion date, end of story.
 *   • Each person gets ONE compact row (~36pt). On 72-pt margins that
 *     fits ~17 rows / page after the page-1 header band, so a 36-person
 *     audience lands in 3 pages instead of 8.
 *   • FT employees come first, then PT — each group alphabetized by
 *     LAST name (Wix used last-name sort and it's what Rhonda expects).
 *   • Signatures (self-attested) embed inline. Admin-marked rows show
 *     "Marked by <Admin>" in italics in the signature slot.
 *   • Unsigned rows stay in the doc so it's still a true sign-off
 *     sheet — they just show "—" in the signature + date columns.
 */

const NAVY: [number, number, number] = [15, 26, 51]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [100, 116, 139]
const PALE: [number, number, number] = [180, 192, 210]
const SUCCESS: [number, number, number] = [22, 163, 74]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT_BG: [number, number, number] = [248, 250, 252]
const GOLD: [number, number, number] = [201, 167, 92]

export interface SignOffEntry {
  fullName: string
  /** Used to drive the FT / PT grouping in the PDF. */
  employmentType: 'full_time' | 'part_time'
  status: 'signed' | 'in_progress' | 'not_started'
  signedMethod: 'self' | 'admin_marked' | null
  completedAt: string | null
  signatureDataUrl: string | null
  markedByName: string | null
}

export interface SignOffLabels {
  /** Top navy banner text — shown on every page. */
  headerTitle: string
  /** Column header above the signature timestamp column. */
  dateColumnHeader: string
  /** Verb used in "X of Y <verb> (Z%)" subtitle. */
  completedVerb: string
}

export const DEFAULT_TRAINING_LABELS: SignOffLabels = {
  headerTitle: 'WCEMS · REQUIRED TRAINING SIGN-OFF',
  dateColumnHeader: 'COMPLETION DATE',
  completedVerb: 'completed',
}

export const DEFAULT_POLICY_LABELS: SignOffLabels = {
  headerTitle: 'WCEMS · POLICY ACKNOWLEDGEMENT SIGN-OFF',
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

  const MARGIN_X = 40
  const MARGIN_TOP = 48
  const MARGIN_BOTTOM = 40
  const CONTENT_W = W - MARGIN_X * 2

  const generatedAt = input.generatedAt ?? new Date()
  const generatedStr = generatedAt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

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
  const COL_NAME_W = 180
  const COL_SIG_X = COL_NAME_X + COL_NAME_W + 10
  const COL_SIG_W = 220
  const COL_DATE_X = COL_SIG_X + COL_SIG_W + 10
  const ROW_H = 36
  const SIG_H = 28 // image height inside the signature column

  const labels = input.labels ?? DEFAULT_TRAINING_LABELS

  /* ── Page header — slim navy band ────────────────────────────────── */
  function drawHeader() {
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 34, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.text(labels.headerTitle, MARGIN_X, 22)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GOLD)
    doc.text(input.moduleTitle, W - MARGIN_X, 22, { align: 'right' })
  }

  /* ── Compact title block (page 1 only) ───────────────────────────── */
  function drawTitleBlock(): number {
    let y = MARGIN_TOP + 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...NAVY)
    doc.text(input.moduleTitle, MARGIN_X, y)
    y += 14

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(
      `${signedCount} of ${totalCount} ${labels.completedVerb} (${pct}%)  ·  Generated ${generatedStr}`,
      MARGIN_X,
      y,
    )
    y += 16
    return y
  }

  /* ── Column header strip ─────────────────────────────────────────── */
  function drawColumnHeader(y: number): number {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text('NAME', COL_NAME_X + 2, y)
    doc.text('SIGNATURE', COL_SIG_X + 2, y)
    doc.text(labels.dateColumnHeader, COL_DATE_X + 2, y)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN_X, y + 4, MARGIN_X + CONTENT_W, y + 4)
    return y + 12
  }

  /* ── Group label ("Full-Time" / "Part-Time") ─────────────────────── */
  function drawGroupLabel(label: string, count: number, y: number): number {
    doc.setFillColor(...SOFT_BG)
    doc.rect(MARGIN_X, y - 10, CONTENT_W, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...NAVY)
    doc.text(label.toUpperCase(), MARGIN_X + 6, y + 2)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...MUTED)
    doc.text(`(${count})`, MARGIN_X + 6 + doc.getTextWidth(label.toUpperCase()) + 6, y + 2)
    return y + 18
  }

  /* ── One compact row ─────────────────────────────────────────────── */
  function drawRow(entry: SignOffEntry, y: number, zebra: boolean): number {
    if (zebra) {
      doc.setFillColor(252, 253, 255)
      doc.rect(MARGIN_X, y - 2, CONTENT_W, ROW_H, 'F')
    }

    /* Name */
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...NAVY)
    /* Truncate aggressively if the name's wider than the column.
       splitTextToSize handles word-wrap; we only want one line. */
    const nameLines = doc.splitTextToSize(entry.fullName, COL_NAME_W - 4)
    doc.text(nameLines[0] ?? entry.fullName, COL_NAME_X + 2, y + 18)

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
        doc.setTextColor(...MUTED)
        doc.text('[signature on file]', COL_SIG_X + 2, y + 18)
      }
    } else if (entry.status === 'signed' && entry.signedMethod === 'admin_marked') {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(...INK_SOFT)
      const text = `Marked by ${entry.markedByName ?? 'admin'}`
      const wrapped = doc.splitTextToSize(text, COL_SIG_W - 4)
      doc.text(wrapped[0] ?? text, COL_SIG_X + 2, y + 18)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...PALE)
      doc.text('—', COL_SIG_X + 2, y + 18)
    }

    /* Date */
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    if (entry.completedAt) {
      doc.setTextColor(...SUCCESS)
      doc.text(formatDate(entry.completedAt), COL_DATE_X + 2, y + 18)
    } else {
      doc.setTextColor(...PALE)
      doc.text('—', COL_DATE_X + 2, y + 18)
    }

    /* Row separator */
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN_X, y + ROW_H - 1, MARGIN_X + CONTENT_W, y + ROW_H - 1)

    return y + ROW_H
  }

  /* ── Layout pass ─────────────────────────────────────────────────── */
  drawHeader()
  let y = drawTitleBlock()
  y = drawColumnHeader(y)
  let pageNum = 1
  let zebra = false

  function ensureSpace(needed: number) {
    if (y + needed > H - MARGIN_BOTTOM) {
      doc.addPage()
      pageNum += 1
      drawHeader()
      y = MARGIN_TOP + 4
      y = drawColumnHeader(y)
      zebra = false
    }
  }

  if (ftEntries.length) {
    ensureSpace(18 + ROW_H)
    y = drawGroupLabel('Full-Time', ftEntries.length, y + 8) + 4
    for (const entry of ftEntries) {
      ensureSpace(ROW_H)
      y = drawRow(entry, y, zebra)
      zebra = !zebra
    }
  }

  if (ptEntries.length) {
    ensureSpace(18 + ROW_H)
    zebra = false
    y = drawGroupLabel('Part-Time', ptEntries.length, y + 12) + 4
    for (const entry of ptEntries) {
      ensureSpace(ROW_H)
      y = drawRow(entry, y, zebra)
      zebra = !zebra
    }
  }

  const pageCount = pageNum

  /* ── Page footer (Page X of Y, signed count) ─────────────────────── */
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`Page ${i} of ${pageCount}`, W - MARGIN_X, H - 20, { align: 'right' })
    doc.text(
      `${signedCount} of ${totalCount} ${labels.completedVerb}`,
      MARGIN_X,
      H - 20,
    )
  }

  return doc
}
