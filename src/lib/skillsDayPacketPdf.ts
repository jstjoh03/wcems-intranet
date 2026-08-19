import jsPDF from 'jspdf'
import type { SkillsCheckoff, SkillsEvaluation } from '@/types'

/**
 * Per-candidate Skills Day packet: one PDF containing every completed
 * check-off — item results, comments, both signatures, and any
 * second-attempt recheck log. Each check-off starts on a fresh page so
 * the packet files cleanly (this is the "print then file for each
 * employee" step the Jotform workflow required, reduced to one click).
 */

const NAVY: [number, number, number] = [15, 26, 51]
const INK: [number, number, number] = [25, 35, 60]
const INK_SOFT: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [120, 130, 150]
const GOLD: [number, number, number] = [201, 167, 92]
const LINE: [number, number, number] = [226, 232, 240]
const SOFT_BG: [number, number, number] = [248, 250, 252]
const SUCCESS: [number, number, number] = [22, 163, 74]
const AMBER: [number, number, number] = [180, 120, 30]

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

export async function generateSkillsDayPacketPdf(input: SkillsPacketInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 48
  const CONTENT_W = W - MARGIN * 2

  const ordered = [...input.checkoffs].sort((a, b) => a.sort - b.sort)
  const completed = ordered.filter((c) =>
    input.evaluations.some((e) => e.checkoffId === c.id),
  )

  let firstPage = true
  let y = 0

  function pageHeader(title: string, sub: string) {
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, W, 58, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(255, 255, 255)
    doc.text('WCEMS · NEOP SKILLS DAY', MARGIN, 24)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GOLD)
    doc.text(input.candidateName, W - MARGIN, 24, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(255, 255, 255)
    doc.text(title, MARGIN, 45)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GOLD)
    doc.text(sub, W - MARGIN, 45, { align: 'right' })
    doc.setDrawColor(...GOLD)
    doc.setLineWidth(1.2)
    doc.line(0, 58, W, 58)
    y = 80
  }

  function ensureSpace(needed: number, title: string, sub: string) {
    if (y + needed > H - 46) {
      doc.addPage()
      pageHeader(title, sub)
    }
  }

  /* Cover summary page */
  pageHeader('Skills Day Packet', 'Competency check-off record')
  firstPage = false
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...NAVY)
  doc.text(input.candidateName, MARGIN, y + 14)
  y += 34
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'New Employee Orientation · Skills Competency Check-Offs',
    MARGIN,
    y,
  )
  y += 24

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
      doc.setTextColor(...AMBER)
      doc.text(`REMEDIATION — ${redo} ITEM${redo === 1 ? '' : 'S'}`, W - MARGIN - 8, y + 4, {
        align: 'right',
      })
    } else {
      doc.setTextColor(...SUCCESS)
      doc.text('PASS', W - MARGIN - 8, y + 4, { align: 'right' })
    }
    y += 30
  }

  /* One section per completed check-off */
  for (const checkoff of completed) {
    const e = input.evaluations.find((ev) => ev.checkoffId === checkoff.id)!
    doc.addPage()
    pageHeader(checkoff.title, checkoff.subtitle)
    void firstPage

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      `Evaluator: ${input.nameFor(e.evaluatorId)}   ·   Submitted ${formatDateTime(e.submittedAt)}`,
      MARGIN,
      y,
    )
    y += 18

    for (const section of checkoff.sections) {
      ensureSpace(34, checkoff.title, checkoff.subtitle)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...MUTED)
      doc.text(section.title.toUpperCase(), MARGIN, y)
      doc.setDrawColor(...LINE)
      doc.setLineWidth(0.5)
      doc.line(MARGIN, y + 4, MARGIN + CONTENT_W, y + 4)
      y += 15

      for (const item of section.items) {
        const res = e.items[item.key]
        const comment = res?.comment
        const rowH = comment ? 26 : 15
        ensureSpace(rowH, checkoff.title, checkoff.subtitle)

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9.5)
        doc.setTextColor(...INK)
        doc.text(item.label, MARGIN + 14, y)

        if (!res) {
          doc.setTextColor(...MUTED)
          doc.text('—', MARGIN + 2, y)
        } else if (res.result === 'pass') {
          doc.setDrawColor(...SUCCESS)
          doc.setLineWidth(1.4)
          doc.line(MARGIN + 1, y - 3, MARGIN + 3.5, y - 0.5)
          doc.line(MARGIN + 3.5, y - 0.5, MARGIN + 8, y - 6.5)
        } else {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8)
          doc.setTextColor(...AMBER)
          doc.text('REDO', MARGIN, y)
        }

        if (comment) {
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(8.5)
          doc.setTextColor(...INK_SOFT)
          const lines = doc.splitTextToSize(comment, CONTENT_W - 24)
          doc.text(lines[0] ?? comment, MARGIN + 14, y + 10)
          y += 11
        }
        y += 15
      }
      y += 6
    }

    /* Recheck log */
    if (e.rechecks.length) {
      ensureSpace(20 + e.rechecks.length * 14, checkoff.title, checkoff.subtitle)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...MUTED)
      doc.text('SECOND ATTEMPTS', MARGIN, y)
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
          ensureSpace(12, checkoff.title, checkoff.subtitle)
          doc.text(line, MARGIN, y)
          y += 12
        }
        y += 3
      }
    }

    /* Signatures */
    const overall = Object.values(e.items).some((v) => v.result === 'redo')
      ? 'REMEDIATION IN PROGRESS'
      : 'PASS'
    ensureSpace(120, checkoff.title, checkoff.subtitle)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...(overall === 'PASS' ? SUCCESS : AMBER))
    doc.text(`Overall result: ${overall}`, MARGIN, y)
    y += 12

    const sigW = (CONTENT_W - 30) / 2
    const sigH = 46
    const sigs: Array<{ label: string; name: string; data: string | null }> = [
      { label: 'CANDIDATE', name: input.candidateName, data: e.candidateSignature },
      { label: 'EVALUATOR', name: input.nameFor(e.evaluatorId), data: e.evaluatorSignature },
    ]
    sigs.forEach((s, i) => {
      const x = MARGIN + i * (sigW + 30)
      if (s.data) {
        try {
          doc.addImage(s.data, 'PNG', x, y, sigW, sigH)
        } catch {
          /* corrupted signature data — leave the line blank */
        }
      }
      doc.setDrawColor(...GOLD)
      doc.setLineWidth(0.8)
      doc.line(x, y + sigH + 4, x + sigW, y + sigH + 4)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(s.label, x, y + sigH + 15)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(...NAVY)
      doc.text(s.name, x, y + sigH + 27)
    })
    y += sigH + 40
  }

  /* Footer on every page */
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i)
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
