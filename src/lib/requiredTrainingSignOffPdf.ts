import jsPDF from 'jspdf'

/**
 * Multi-page sign-off-sheet PDF for a single required-training module.
 * One row per person in the audience, with the captured signature
 * embedded inline for anyone who self-attested. Admin-marked rows show
 * the marker's name + the note text in place of a signature image.
 *
 * Designed as a compliance record an admin can hand to HR / send to
 * Rhonda / attach to a corrective-action file — single archivable PDF
 * with everyone's status and signed name visible.
 */

const NAVY: [number, number, number] = [15, 26, 51]
const NAVY_INK: [number, number, number] = [50, 65, 85]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [100, 116, 139]
const PALE: [number, number, number] = [148, 163, 184]
const SUCCESS: [number, number, number] = [22, 163, 74]
const AMBER: [number, number, number] = [217, 119, 6]
const RED: [number, number, number] = [220, 38, 38]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT_BG: [number, number, number] = [248, 250, 252]

export interface SignOffEntry {
  fullName: string
  role: string
  shift: string | null
  station: string | null
  status: 'signed' | 'in_progress' | 'not_started'
  signedMethod: 'self' | 'admin_marked' | null
  completedAt: string | null
  signatureDataUrl: string | null
  markedByName: string | null
  markedNote: string | null
}

export interface SignOffPdfInput {
  moduleTitle: string
  moduleDescription: string
  audienceLabel: string
  generatedAt?: Date
  entries: SignOffEntry[]
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export async function generateRequiredTrainingSignOffPdf(
  input: SignOffPdfInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth() // 612
  const H = doc.internal.pageSize.getHeight() // 792

  const MARGIN_X = 40
  const MARGIN_TOP = 40
  const MARGIN_BOTTOM = 50
  const CONTENT_W = W - MARGIN_X * 2

  const generatedAt = input.generatedAt ?? new Date()
  const generatedStr = generatedAt.toLocaleString('en-US')

  const signedCount = input.entries.filter((e) => e.status === 'signed').length
  const totalCount = input.entries.length

  /* ── Page chrome — draws title + summary on every page ───────────── */
  function drawHeader(pageNum: number, totalPages: number | null) {
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 56, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(255, 255, 255)
    doc.text('WALLER COUNTY EMS · REQUIRED TRAINING SIGN-OFF', MARGIN_X, 24)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(201, 167, 92)
    doc.text(input.moduleTitle, MARGIN_X, 42)

    /* Right side: page # and generated date */
    doc.setTextColor(220, 220, 220)
    doc.setFontSize(8)
    const pageLabel = totalPages
      ? `Page ${pageNum} of ${totalPages}`
      : `Page ${pageNum}`
    doc.text(pageLabel, W - MARGIN_X, 24, { align: 'right' })
    doc.text(`Generated ${generatedStr}`, W - MARGIN_X, 38, { align: 'right' })
  }

  /* ── Page 1 cover block (sits below the header) ──────────────────── */
  function drawCoverBlock() {
    let y = 80
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...NAVY)
    doc.text(input.moduleTitle, MARGIN_X, y)
    y += 24

    if (input.moduleDescription) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...INK_SOFT)
      const wrapped = doc.splitTextToSize(input.moduleDescription, CONTENT_W)
      doc.text(wrapped, MARGIN_X, y)
      y += wrapped.length * 14
    }
    y += 10

    /* Audience pill */
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(`AUDIENCE: ${input.audienceLabel.toUpperCase()}`, MARGIN_X, y)
    y += 14

    /* Completion stat banner */
    doc.setFillColor(...SOFT_BG)
    doc.setDrawColor(...LINE)
    doc.roundedRect(MARGIN_X, y, CONTENT_W, 36, 6, 6, 'FD')
    const pct = totalCount === 0 ? 0 : Math.round((signedCount / totalCount) * 100)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...NAVY)
    doc.text(`${signedCount} of ${totalCount}`, MARGIN_X + 14, y + 24)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK_SOFT)
    doc.text('completed', MARGIN_X + 14 + 80, y + 24)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...SUCCESS)
    doc.text(`${pct}%`, MARGIN_X + CONTENT_W - 14, y + 24, { align: 'right' })

    y += 50
    return y
  }

  /* ── Status badge ────────────────────────────────────────────────── */
  function drawStatusBadge(status: SignOffEntry['status'], x: number, y: number) {
    const labels: Record<SignOffEntry['status'], string> = {
      signed: 'SIGNED',
      in_progress: 'IN PROGRESS',
      not_started: 'NOT STARTED',
    }
    const colors: Record<SignOffEntry['status'], [number, number, number]> = {
      signed: SUCCESS,
      in_progress: AMBER,
      not_started: RED,
    }
    const label = labels[status]
    const color = colors[status]

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    const w = doc.getTextWidth(label) + 14
    doc.setFillColor(color[0], color[1], color[2])
    doc.roundedRect(x, y - 9, w, 14, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.text(label, x + 7, y)
  }

  /* ── One row per person. Returns the y after the row. ────────────── */
  const SIG_W = 180
  const SIG_H = 44
  const ROW_MIN_H = 64

  function rowHeight(entry: SignOffEntry): number {
    /* Signed self-attest rows reserve space for the signature image.
       Admin-marked rows reserve a few lines of text instead. Other
       statuses just get the metadata block. */
    if (entry.status === 'signed' && entry.signedMethod === 'self') {
      return Math.max(ROW_MIN_H, SIG_H + 36)
    }
    if (entry.status === 'signed' && entry.signedMethod === 'admin_marked') {
      const noteLines = entry.markedNote
        ? doc.splitTextToSize(entry.markedNote, CONTENT_W - 12).length
        : 0
      return Math.max(ROW_MIN_H, 30 + 14 * (1 + noteLines))
    }
    return ROW_MIN_H
  }

  function drawRow(entry: SignOffEntry, y: number): number {
    const h = rowHeight(entry)
    /* Card background */
    doc.setFillColor(...SOFT_BG)
    doc.setDrawColor(...LINE)
    doc.roundedRect(MARGIN_X, y, CONTENT_W, h, 6, 6, 'FD')

    /* Name + caption */
    let cursorY = y + 18
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11.5)
    doc.setTextColor(...NAVY)
    doc.text(entry.fullName, MARGIN_X + 12, cursorY)

    const captionParts: string[] = []
    captionParts.push(`Role: ${entry.role}`)
    if (entry.shift) captionParts.push(`Shift: ${entry.shift}`)
    if (entry.station) captionParts.push(`Station: ${entry.station}`)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(captionParts.join('  ·  '), MARGIN_X + 12, cursorY + 12)

    /* Status badge on the right */
    const badgeRightX = MARGIN_X + CONTENT_W - 12
    /* Roughly: draw badge with right-anchored x. */
    const tempLabel = entry.status === 'signed' ? 'SIGNED' : entry.status === 'in_progress' ? 'IN PROGRESS' : 'NOT STARTED'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    const badgeW = doc.getTextWidth(tempLabel) + 14
    drawStatusBadge(entry.status, badgeRightX - badgeW, cursorY)

    /* Completed date below the badge */
    if (entry.completedAt) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_SOFT)
      doc.text(
        `Completed ${formatDate(entry.completedAt)}`,
        badgeRightX,
        cursorY + 12,
        { align: 'right' },
      )
    }

    cursorY += 30

    /* Signature region */
    if (entry.status === 'signed' && entry.signedMethod === 'self' && entry.signatureDataUrl) {
      try {
        doc.addImage(entry.signatureDataUrl, 'PNG', MARGIN_X + 12, cursorY - 2, SIG_W, SIG_H)
      } catch {
        /* If the data URL is malformed for some reason, fall back to text. */
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(9)
        doc.setTextColor(...MUTED)
        doc.text('[Signature on file]', MARGIN_X + 12, cursorY + 8)
      }
      /* Signature line below the image */
      doc.setDrawColor(...PALE)
      doc.setLineWidth(0.5)
      doc.line(MARGIN_X + 12, cursorY + SIG_H + 1, MARGIN_X + 12 + SIG_W, cursorY + SIG_H + 1)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...PALE)
      doc.text('Electronic signature', MARGIN_X + 12, cursorY + SIG_H + 11)
    } else if (entry.status === 'signed' && entry.signedMethod === 'admin_marked') {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...NAVY_INK)
      doc.text(`Marked complete by ${entry.markedByName ?? '(admin)'}`, MARGIN_X + 12, cursorY + 4)
      if (entry.markedNote) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK_SOFT)
        const wrapped = doc.splitTextToSize(`Note: ${entry.markedNote}`, CONTENT_W - 24)
        doc.text(wrapped, MARGIN_X + 12, cursorY + 18)
      }
    } else if (entry.status === 'in_progress') {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(...AMBER)
      doc.text('Started the video — has not yet signed off.', MARGIN_X + 12, cursorY + 6)
    } else {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(...MUTED)
      doc.text('Not started.', MARGIN_X + 12, cursorY + 6)
    }

    return y + h + 8
  }

  /* Single layout pass. We don't know total page count ahead of time,
     so the header paints a placeholder "Page N" label; the backfill
     loop below overwrites it with the correct "Page X of Y" once we
     know the total. */
  drawHeader(1, null)
  let y = drawCoverBlock()
  let pageNum = 1

  for (const entry of input.entries) {
    const needed = rowHeight(entry) + 8
    if (y + needed > H - MARGIN_BOTTOM) {
      doc.addPage()
      pageNum += 1
      drawHeader(pageNum, null)
      y = MARGIN_TOP + 30
    }
    y = drawRow(entry, y)
  }
  const pageCount = pageNum

  /* Backfill "Page X of Y" labels now that we know Y. jsPDF lets us
     rewrite specific pages; cheaper than a full second pass. */
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
    doc.setFillColor(...NAVY)
    doc.rect(W - MARGIN_X - 110, 14, 110, 18, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(220, 220, 220)
    doc.text(`Page ${i} of ${pageCount}`, W - MARGIN_X, 24, { align: 'right' })
    doc.text(`Generated ${generatedStr}`, W - MARGIN_X, 38, { align: 'right' })
  }

  return doc
}
