// Lecture (CE) evaluation PDF generator.
//
// AHA card-class evals get a fillable-PDF template per discipline
// (BLS/ACLS/PALS). Lectures don't have an AHA template — so we render
// our own form from the answers payload that buildLectureSubmissionPayload
// produced. Output mirrors the question order students saw on the public
// form so the record file is recognizable to anyone who took the eval.

import jsPDF from 'jspdf'
import { LIKERT5_LABELS } from './ahaEval'

interface LectureEvalMeta {
  lectureTitle: string
  classDate: string
  dshsContentArea: string
  location: string
  primaryInstructorName: string
  hoursAwarded: string
}

/** Field map driven by the keys that buildLectureSubmissionPayload writes.
 *  Keep these in lockstep with src/lib/lectureEval.ts. */
const LIKERT_QUESTIONS: Array<{ key: string; text: string }> = [
  {
    key: 'Q1_Satisfaction',
    text: '1. Overall, I was satisfied with this lecture.',
  },
  {
    key: 'Q2_KnowledgeGain',
    text: '2. The content increased my knowledge and/or clinical skills.',
  },
  {
    key: 'Q3_Unbiased',
    text: '3. The content was evidence-based, current, and free of commercial bias.',
  },
  {
    key: 'Q4_DshsRelevant',
    text: '4. The content was relevant to my practice as an EMS provider.',
  },
]

const YESNO_QUESTION = {
  key: 'Q5_PracticeImpacted',
  text: '5. My practice will change as a result of something I learned in this lecture.',
}

const FREE_TEXT_QUESTIONS: Array<{ key: string; text: string }> = [
  { key: 'Q8_MostValuable', text: '8. What did you find most valuable? (optional)' },
  { key: 'Q7_Suggestions', text: '7. Suggestions for improving this lecture (optional)' },
]

function likertLabel(raw: string | undefined): string {
  if (!raw) return '—'
  return LIKERT5_LABELS[String(raw).trim()] || String(raw)
}
function yesNoLabel(raw: string | undefined): string {
  if (!raw) return '—'
  const v = String(raw).trim().toLowerCase()
  if (v === 'yes' || v === '5' || v === 'true') return 'Yes'
  if (v === 'no' || v === '1' || v === 'false') return 'No'
  return raw
}
function fmtDate(d: string): string {
  if (!d) return ''
  try {
    const [y, m, day] = d.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return d
  }
}

export function generateLectureEvalPdf(
  answers: Record<string, string>,
  meta: LectureEvalMeta,
): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 48
  let y = margin

  const studentName = String(answers.StudentName || '').trim() || '—'
  const studentEmail = String(answers.StudentEmail || '').trim() || '—'
  const lectureTitle =
    String(answers.Title || '').trim() || meta.lectureTitle || 'CE Lecture'
  const dshs =
    String(answers.DshsContentArea || '').trim() || meta.dshsContentArea || ''
  const classDateRaw = meta.classDate || ''

  // ── Header ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(20, 40, 80)
  doc.text('WALLER COUNTY EMS', W / 2, y, { align: 'center' })
  y += 16
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(70, 80, 95)
  doc.text('Continuing Education Lecture Evaluation', W / 2, y, {
    align: 'center',
  })
  y += 18
  doc.setDrawColor(150, 165, 180)
  doc.setLineWidth(0.5)
  doc.line(margin, y, W - margin, y)
  y += 18

  // ── Course metadata box ──
  doc.setFontSize(10)
  doc.setTextColor(20, 30, 50)
  const labelW = 130
  const writeMeta = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(value || '—', W - margin - labelW - margin)
    doc.text(lines, margin + labelW, y)
    y += 14 * lines.length
  }
  writeMeta('Lecture', lectureTitle)
  writeMeta('Date', fmtDate(classDateRaw))
  if (meta.location) writeMeta('Location', meta.location)
  if (meta.primaryInstructorName) writeMeta('Instructor', meta.primaryInstructorName)
  if (dshs) writeMeta('DSHS Content Area', dshs)
  if (meta.hoursAwarded) writeMeta('Contact Hours', meta.hoursAwarded)
  y += 6
  doc.setDrawColor(220, 225, 232)
  doc.line(margin, y, W - margin, y)
  y += 16

  // ── Student block ──
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(70, 80, 95)
  doc.text('STUDENT', margin, y)
  y += 14
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(20, 30, 50)
  writeMeta('Name', studentName)
  writeMeta('Email', studentEmail)
  y += 6
  doc.setDrawColor(220, 225, 232)
  doc.line(margin, y, W - margin, y)
  y += 18

  // ── Response section ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(70, 80, 95)
  doc.text('RESPONSES', margin, y)
  y += 16

  const ensureSpace = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage()
      y = margin
    }
  }
  const writeQA = (q: string, a: string) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(40, 50, 70)
    const qLines = doc.splitTextToSize(q, W - margin * 2)
    ensureSpace(qLines.length * 13 + 24)
    doc.text(qLines, margin, y)
    y += qLines.length * 13 + 2
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 90, 130)
    const aLines = doc.splitTextToSize(a || '—', W - margin * 2 - 16)
    ensureSpace(aLines.length * 13 + 8)
    doc.text(aLines, margin + 16, y)
    y += aLines.length * 13 + 10
  }

  for (const q of LIKERT_QUESTIONS) {
    writeQA(q.text, likertLabel(answers[q.key]))
  }
  writeQA(YESNO_QUESTION.text, yesNoLabel(answers[YESNO_QUESTION.key]))

  // ── Instructor ratings (up to 4 in payload) ──
  let firstInst = true
  for (let i = 1; i <= 4; i++) {
    const name = answers[`Q6_Inst${i}_Name`] || answers[`Q6_Instructor${i}_Name`] || ''
    const rating =
      answers[`Q6_Inst${i}_Rating`] ||
      answers[`Q6_Instructor${i}_Rating`] ||
      ''
    if (!name && !rating) continue
    if (firstInst) {
      ensureSpace(20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(70, 80, 95)
      doc.text('6. INSTRUCTOR RATINGS', margin, y)
      y += 14
      firstInst = false
    }
    writeQA(
      `${name || `Instructor ${i}`} presented the material clearly and effectively.`,
      likertLabel(rating),
    )
  }

  for (const q of FREE_TEXT_QUESTIONS) {
    const v = String(answers[q.key] || '').trim()
    if (!v) continue
    writeQA(q.text, v)
  }

  // ── Footer ──
  ensureSpace(40)
  y += 8
  doc.setDrawColor(220, 225, 232)
  doc.line(margin, y, W - margin, y)
  y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110, 120, 140)
  const submitted = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
  })
  doc.text(
    `Generated ${submitted}  ·  Waller County EMS Office of Medical Education & Training`,
    W / 2,
    y,
    { align: 'center' },
  )

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}
