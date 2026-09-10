import jsPDF from 'jspdf'
import type { ExamAssignment, ExamDefinition, ExamQuestion } from '@/composables/useExams'

/**
 * Admin printout of a completed examination: every question with the
 * candidate's chosen answer(s) marked and incorrect questions flagged.
 * The answer KEY is never part of this document — correct answers stay
 * server-side so the question bank can be reused — an incorrect
 * question shows what was chosen, not what was right.
 */

const BLACK: [number, number, number] = [20, 22, 26]
const INK: [number, number, number] = [45, 50, 60]
const INK_SOFT: [number, number, number] = [110, 115, 125]
const LINE: [number, number, number] = [205, 202, 194]
const RED: [number, number, number] = [178, 58, 48]
const GREEN: [number, number, number] = [46, 125, 79]

function pdfSafe(s: string): string {
  return s
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[^\x00-\xFF‘’“”–—·°]/g, '')
}

async function loadImageAsBase64(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const data = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
    if (!data) return null
    const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve(null)
      img.src = data
    })
    if (!dims) return null
    return { data, w: dims.w, h: dims.h }
  } catch {
    return null
  }
}

export interface CompletedExamPdfInput {
  definition: ExamDefinition
  assignment: ExamAssignment
  candidateName: string
  /** Question numbers answered incorrectly (from the exam_review RPC). */
  missed: Set<number>
  /** Resolves a question's image filename to a fetchable (signed) URL. */
  imageUrlFor?: (q: ExamQuestion) => Promise<string | null>
}

export async function generateCompletedExamPdf(input: CompletedExamPdfInput): Promise<jsPDF> {
  const { definition, assignment, candidateName, missed } = input

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const crestRes = await fetch(`${window.location.origin}/wcems-patch-bw.jpg`).catch(() => null)
  let crest: string | null = null
  if (crestRes?.ok) {
    const blob = await crestRes.blob()
    crest = await new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  }
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
    doc.text('Completed examination record', W - MARGIN, top + 23, { align: 'right' })
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
    doc.text(pdfSafe(`${candidateName} — ${definition.title}`), MARGIN, H - 30)
    doc.text(`Page ${page}`, W - MARGIN, H - 30, { align: 'right' })
  }

  function needRoom(h: number) {
    if (y + h > H - 52) {
      pageFooter()
      doc.addPage()
      page += 1
      pageHeader()
    }
  }

  pageHeader()

  /* ── Cover block ─────────────────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...BLACK)
  doc.text(pdfSafe(definition.title), MARGIN, y, { maxWidth: CONTENT_W })
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  const when = assignment.submittedAt
    ? new Date(assignment.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—'
  doc.text(pdfSafe(`Candidate: ${candidateName}`), MARGIN, y)
  y += 14
  doc.text(pdfSafe(`Submitted: ${when}`), MARGIN, y)
  y += 14
  const critN = assignment.criticalMissed?.length ?? 0
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...(assignment.passed ? GREEN : RED))
  doc.text(
    pdfSafe(
      `Score: ${assignment.scorePct?.toFixed(1) ?? '—'}%  ·  ${assignment.passed ? 'PASSED' : 'NOT PASSED'} (standard ${definition.passingPct}%)  ·  ${missed.size} incorrect`,
    ),
    MARGIN,
    y,
  )
  y += 13
  if (critN > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_SOFT)
    doc.text(
      pdfSafe(`${critN} flagged medication-dose item${critN === 1 ? '' : 's'} among the incorrect answers — noted for review.`),
      MARGIN,
      y,
    )
    y += 12
  }
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...INK_SOFT)
  doc.text(
    'Shows the answers as chosen; incorrect questions are marked. Correct answers are not printed — the question bank remains in service.',
    MARGIN,
    y,
    { maxWidth: CONTENT_W },
  )
  y += 22

  /* ── Questions ──────────────────────────────────────────────────── */
  let section: string | null = null
  for (const q of definition.questions) {
    const wrong = missed.has(q.no)
    const raw = assignment.answers[String(q.no)]
    const chosen = new Set<string>(Array.isArray(raw) ? raw : raw ? [raw] : [])

    if (q.section && q.section !== section) {
      section = q.section
      needRoom(30)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text(pdfSafe(section.toUpperCase()), MARGIN, y, { charSpace: 0.5 })
      y += 5
      doc.setDrawColor(...BLACK)
      doc.setLineWidth(0.6)
      doc.line(MARGIN, y, W - MARGIN, y)
      y += 14
    }

    /* Measure the whole block roughly so a question never splits. */
    doc.setFontSize(9.5)
    const qLines = doc.splitTextToSize(pdfSafe(`Q${q.no}. ${q.text}`), CONTENT_W - 60)
    let blockH = qLines.length * 11.5 + 8
    const optEntries = Object.entries(q.options ?? {})
    const optLineCounts: string[][] = []
    doc.setFontSize(9)
    for (const [letter, text] of optEntries) {
      const lines = doc.splitTextToSize(pdfSafe(`${letter}. ${text}`), CONTENT_W - 46)
      optLineCounts.push(lines)
      blockH += lines.length * 10.5 + 3
    }
    let img: { data: string; w: number; h: number } | null = null
    if (q.image && input.imageUrlFor) {
      const url = await input.imageUrlFor(q)
      if (url) img = await loadImageAsBase64(url)
    }
    const imgW = img ? Math.min(250, CONTENT_W) : 0
    const imgH = img ? (img.h / img.w) * imgW : 0
    blockH += img ? imgH + 10 : 0
    needRoom(Math.min(blockH + 12, H - 140))

    /* Incorrect flag + question stem */
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    if (wrong) {
      doc.setTextColor(...RED)
      doc.text('X', MARGIN - 14, y)
    }
    doc.setTextColor(...(wrong ? RED : BLACK))
    doc.text(qLines, MARGIN, y)
    if (wrong) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text('INCORRECT', W - MARGIN, y, { align: 'right', charSpace: 0.6 })
    }
    if (q.critical) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...INK_SOFT)
      doc.text('CRITICAL ITEM', W - MARGIN, y + (wrong ? 9 : 0), { align: 'right', charSpace: 0.5 })
    }
    y += qLines.length * 11.5 + 4

    if (img) {
      needRoom(imgH + 8)
      const fmt = img.data.includes('image/png') ? 'PNG' : 'JPEG'
      try {
        doc.addImage(img.data, fmt, MARGIN, y, imgW, imgH)
        y += imgH + 8
      } catch {
        /* corrupt/unsupported image — note it instead */
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(...INK_SOFT)
        doc.text(pdfSafe(`[Exam figure: ${q.image}]`), MARGIN, y)
        y += 12
      }
    } else if (q.image) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...INK_SOFT)
      doc.text(pdfSafe(`[Exam figure: ${q.image}]`), MARGIN, y)
      y += 12
    }

    /* Options with the candidate's choices marked */
    optEntries.forEach(([letter], i) => {
      const picked = chosen.has(letter)
      const lines = optLineCounts[i]
      needRoom(lines.length * 10.5 + 3)
      doc.setFont('helvetica', picked ? 'bold' : 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...(picked ? (wrong ? RED : GREEN) : INK))
      if (picked) {
        doc.setDrawColor(...(wrong ? RED : GREEN))
        doc.setLineWidth(0.9)
        doc.rect(MARGIN + 2, y - 6.5, 6.5, 6.5)
        doc.line(MARGIN + 2, y - 6.5, MARGIN + 8.5, y)
        doc.line(MARGIN + 8.5, y - 6.5, MARGIN + 2, y)
      } else {
        doc.setDrawColor(...LINE)
        doc.setLineWidth(0.6)
        doc.rect(MARGIN + 2, y - 6.5, 6.5, 6.5)
      }
      doc.text(lines, MARGIN + 16, y)
      y += lines.length * 10.5 + 3
    })
    if (chosen.size === 0) {
      needRoom(12)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8.5)
      doc.setTextColor(...RED)
      doc.text('No answer recorded.', MARGIN + 16, y)
      y += 11
    }
    y += 9
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y - 5, W - MARGIN, y - 5)
    y += 5
  }

  pageFooter()
  return doc
}
