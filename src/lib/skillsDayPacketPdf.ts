import jsPDF from 'jspdf'
import type { SkillsCheckoff, SkillsEvaluation } from '@/types'

/**
 * Per-candidate Skills Day packet: one PDF containing every completed
 * check-off — item results, comments, both signatures, and any
 * second-attempt recheck log. Each check-off starts on a fresh page so
 * the packet files cleanly (this is the "print then file for each
 * employee" step the Jotform workflow required, reduced to one click).
 *
 * Styled as a PRINTABLE BLACK-AND-WHITE document matching the WCEMS
 * letterhead (grayscale crest + WALLER COUNTY / EMERGENCY MEDICAL
 * SERVICES / Hempstead, Texas · Established 1996) on every page —
 * per Justin 2026-08-19, these go straight to the laser printer for
 * the paper personnel file.
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [35, 35, 35]
const INK_SOFT: [number, number, number] = [85, 85, 85]
const MUTED: [number, number, number] = [130, 130, 130]
const LINE: [number, number, number] = [200, 200, 200]
const SOFT_BG: [number, number, number] = [243, 243, 243]

/** Shown in the runner's sign step and printed above the signatures on
 *  the PDF — the signatures attest to this exact statement. */
export const SKILLS_ATTESTATION =
  'By signing below, the candidate attests that they personally performed each skill ' +
  'recorded above, and the evaluator attests that they directly observed and evaluated ' +
  'each demonstration, that the results recorded are accurate, and that any items marked ' +
  'for remediation were reviewed with the candidate for second attempt.'

export interface SkillsPacketInput {
  candidateName: string
  checkoffs: SkillsCheckoff[]
  evaluations: SkillsEvaluation[]
  nameFor: (userId: string) => string
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDateLong(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Fetch the image file's own bytes (no canvas re-encode — keeps the
 *  pre-optimized PNG small; the crest repeats on every page). */
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

export async function generateSkillsDayPacketPdf(input: SkillsPacketInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  /* Grayscale crest, loaded once — jsPDF dedupes identical image data,
     so repeating it in every page header costs one embed. */
  const crest = await loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`)
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  const ordered = [...input.checkoffs].sort((a, b) => a.sort - b.sort)
  const completed = ordered.filter((c) =>
    input.evaluations.some((e) => e.checkoffId === c.id),
  )

  /* Packet date(s) from the evaluations themselves. */
  const evalDates = [...new Set(input.evaluations.map((e) => e.evalDate))].sort()
  const packetDate =
    evalDates.length === 0
      ? formatDateLong(new Date().toISOString().slice(0, 10))
      : evalDates.length === 1
        ? formatDateLong(evalDates[0])
        : `${formatDateLong(evalDates[0])} – ${formatDateLong(evalDates[evalDates.length - 1])}`

  let y = 0

  /* ── WCEMS letterhead — every page ─────────────────────────────── */
  function pageHeader(context: string) {
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
    doc.text('NEOP SKILLS DAY', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text(input.candidateName, W - MARGIN, top + 22, { align: 'right' })
    if (context) {
      doc.setFontSize(7.5)
      doc.text(context, W - MARGIN, top + 33, { align: 'right' })
    }

    /* Formal double rule under the letterhead */
    const ruleY = top + CREST_H
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(1.4)
    doc.line(MARGIN, ruleY, W - MARGIN, ruleY)
    doc.setLineWidth(0.4)
    doc.line(MARGIN, ruleY + 3, W - MARGIN, ruleY + 3)
    y = ruleY + 24
  }

  function ensureSpace(needed: number, context: string) {
    if (y + needed > H - 46) {
      doc.addPage()
      pageHeader(context)
    }
  }

  /* ── Cover page ────────────────────────────────────────────────── */
  pageHeader('Trainee')
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...BLACK)
  doc.text('Skills Competency Check-Off Record', MARGIN, y)
  y += 22
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  doc.text(`Candidate: ${input.candidateName}`, MARGIN, y)
  y += 16
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(`Date: ${packetDate}`, MARGIN, y)
  y += 14
  doc.text('New Employee Orientation · Skills Competency Check-Offs', MARGIN, y)
  y += 26

  for (const c of ordered) {
    const e = input.evaluations.find((ev) => ev.checkoffId === c.id)
    const redo = e
      ? Object.values(e.items).filter((v) => v.result === 'redo').length
      : 0
    doc.setFillColor(...SOFT_BG)
    doc.rect(MARGIN, y - 11, CONTENT_W, 24, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...INK)
    doc.text(c.title, MARGIN + 8, y + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    if (!e) {
      doc.setTextColor(...MUTED)
      doc.text('NOT RECORDED', W - MARGIN - 8, y + 4, { align: 'right' })
    } else if (redo > 0) {
      doc.setTextColor(...BLACK)
      doc.text(`REMEDIATION — ${redo} ITEM${redo === 1 ? '' : 'S'}`, W - MARGIN - 8, y + 4, {
        align: 'right',
      })
    } else {
      doc.setTextColor(...BLACK)
      doc.text('PASS', W - MARGIN - 8, y + 4, { align: 'right' })
    }
    y += 30
  }

  /* ── One section per completed check-off ───────────────────────── */
  for (const checkoff of completed) {
    const e = input.evaluations.find((ev) => ev.checkoffId === checkoff.id)!
    const context = checkoff.title
    doc.addPage()
    pageHeader(context)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...BLACK)
    doc.text(checkoff.title, MARGIN, y)
    y += 14
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      `${checkoff.subtitle ? checkoff.subtitle + '   ·   ' : ''}Evaluator: ${input.nameFor(e.evaluatorId)}   ·   Submitted ${formatDateTime(e.submittedAt)}`,
      MARGIN,
      y,
    )
    y += 18

    function itemRow(label: string, res?: { result: string; comment?: string }) {
      const comment = res?.comment
      const rowH = comment ? 26 : 15
      ensureSpace(rowH, context)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...INK)
      doc.text(label, MARGIN + 16, y)

      if (!res) {
        doc.setTextColor(...MUTED)
        doc.text('—', MARGIN + 3, y)
      } else if (res.result === 'pass') {
        doc.setDrawColor(...BLACK)
        doc.setLineWidth(1.3)
        doc.line(MARGIN + 2, y - 3, MARGIN + 4.5, y - 0.5)
        doc.line(MARGIN + 4.5, y - 0.5, MARGIN + 9, y - 6.5)
      } else {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...BLACK)
        doc.text('REDO', MARGIN, y)
      }

      if (comment) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK_SOFT)
        const lines = doc.splitTextToSize(comment, CONTENT_W - 24)
        doc.text(lines[0] ?? comment, MARGIN + 16, y + 10)
        y += 11
      }
      y += 15
    }

    for (const section of checkoff.sections) {
      ensureSpace(34, context)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_SOFT)
      doc.text(section.title.toUpperCase(), MARGIN, y, { charSpace: 0.5 })
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.5)
      doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
      y += 15

      for (const item of section.items) {
        itemRow(item.label, e.items[item.key])
      }
      y += 6
    }

    /* Items recorded on this evaluation that the current checkoff
       definition no longer lists (or that were added ad hoc) — the
       record must show every skill actually covered at the station. */
    const definedKeys = new Set(
      checkoff.sections.flatMap((s) => s.items.map((it) => it.key)),
    )
    const extraEntries = Object.entries(e.items).filter(([k]) => !definedKeys.has(k))
    if (extraEntries.length) {
      ensureSpace(20 + extraEntries.length * 15, context)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_SOFT)
      doc.text('ADDITIONAL ITEMS EVALUATED AT THIS STATION', MARGIN, y, { charSpace: 0.5 })
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.5)
      doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
      y += 15
      for (const [key, res] of extraEntries) {
        const label =
          res.label ??
          key.replace(/^cw_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        itemRow(label, res)
      }
      y += 6
    }

    /* Recheck log */
    if (e.rechecks.length) {
      ensureSpace(20 + e.rechecks.length * 14, context)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_SOFT)
      doc.text('SECOND ATTEMPTS', MARGIN, y, { charSpace: 0.5 })
      doc.setDrawColor(...LINE)
      doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
      y += 15
      for (const r of e.rechecks) {
        const labels = r.items.map(
          (k) =>
            checkoff.sections.flatMap((s) => s.items).find((it) => it.key === k)?.label ?? k,
        )
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(...INK_SOFT)
        const text = `${formatDateTime(r.at)} — ${input.nameFor(r.evaluatorId)} — passed: ${labels.join(', ')}`
        const lines = doc.splitTextToSize(text, CONTENT_W)
        for (const line of lines) {
          ensureSpace(12, context)
          doc.text(line, MARGIN, y)
          y += 12
        }
        y += 3
      }
    }

    /* Attestation + signatures */
    const overall = Object.values(e.items).some((v) => v.result === 'redo')
      ? 'REMEDIATION IN PROGRESS'
      : 'PASS'
    const attestationLines = doc.splitTextToSize(SKILLS_ATTESTATION, CONTENT_W - 20)
    ensureSpace(160 + attestationLines.length * 11, context)
    y += 8

    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.6)
    doc.rect(MARGIN, y - 10, CONTENT_W, attestationLines.length * 11 + 26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_SOFT)
    doc.text('ATTESTATION', MARGIN + 10, y + 2, { charSpace: 0.5 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(attestationLines, MARGIN + 10, y + 14, { lineHeightFactor: 1.25 })
    y += attestationLines.length * 11 + 28
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BLACK)
    doc.text(`Overall result: ${overall}`, MARGIN, y)
    y += 12

    const sigW = (CONTENT_W - 30) / 2
    const sigH = 46
    const sigs: Array<{ label: string; name: string; data: string | null; proxy?: string }> = [
      { label: 'CANDIDATE', name: input.candidateName, data: e.candidateSignature },
      {
        label: 'EVALUATOR',
        name: input.nameFor(e.evaluatorId),
        data: e.evaluatorSignature,
        proxy:
          !e.evaluatorSignature && e.recordedBy
            ? `Training verified — recorded on the evaluator's behalf by ${input.nameFor(e.recordedBy)}`
            : undefined,
      },
    ]
    sigs.forEach((s, i) => {
      const x = MARGIN + i * (sigW + 30)
      if (s.data) {
        try {
          doc.addImage(s.data, 'PNG', x, y, sigW, sigH)
        } catch {
          /* corrupted signature data — leave the line blank */
        }
      } else if (s.proxy) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK_SOFT)
        const proxyLines = doc.splitTextToSize(s.proxy, sigW - 4)
        doc.text(proxyLines, x + 2, y + sigH - 18, { lineHeightFactor: 1.3 })
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
    y += sigH + 40

    if (e.recordedNote) {
      const noteLines = doc.splitTextToSize(`Note: ${e.recordedNote}`, CONTENT_W)
      ensureSpace(noteLines.length * 11 + 8, context)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_SOFT)
      doc.text(noteLines, MARGIN, y, { lineHeightFactor: 1.3 })
      y += noteLines.length * 11 + 8
    }
  }

  /* Footer on every page */
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
      'Recorded electronically in the WCEMS Employee Portal · retained in the employee’s training file',
      MARGIN,
      H - 20,
    )
  }

  return doc
}
