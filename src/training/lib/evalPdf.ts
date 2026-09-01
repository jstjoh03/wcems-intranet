// Per-student AHA evaluation PDF generation. Ported verbatim from the
// legacy evals-export.html — field names, radio option strings, the
// PALS hand-drawn "X" coordinate grids, and the Q7 action-text rect
// maps are all preserved exactly so the filled forms match what AHA
// expects.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { CourseTemplate } from '@/training/types'
import { EVAL_TEMPLATES, b64ToBytes } from './pdfTemplates'

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function pickValue(
  source: Record<string, unknown>,
  keys: string[],
  fallback = '',
): string {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value)
    }
  }
  return fallback
}

function normalizeLikertValue(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  const map: Record<string, string> = {
    '5': 'SA',
    '4': 'A',
    '3': 'N',
    '2': 'D',
    '1': 'SD',
    'strongly agree': 'SA',
    agree: 'A',
    neutral: 'N',
    disagree: 'D',
    'strongly disagree': 'SD',
  }
  return map[raw] || ''
}

function normalizeYesNoValue(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  if (['yes', 'true', '1'].includes(raw)) return 'Yes'
  if (['no', 'false', '0'].includes(raw)) return 'No'
  return ''
}

function normalizeRatingValue(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  const map: Record<string, string> = {
    excellent: 'Excellent',
    'above average': 'Above Average',
    average: 'Average',
    'below average': 'Below Average',
    poor: 'Poor',
    'n/a': 'N/A',
    na: 'N/A',
  }
  return map[raw] || ''
}

interface NormalizedEval {
  q1: string
  q2: string
  q3: string
  q5: string
  q7: string
  q8Quality: string
  q8Effectiveness: string
  q8Appropriateness: string
  objectives: string[]
  instructors: { name: string; rating: string }[]
}

function normalizeEvaluationRecord(
  evalData: Record<string, unknown>,
  courseType: CourseTemplate,
): NormalizedEval {
  const objectiveCount = courseType === 'ACLS' ? 7 : 10
  const normalized: NormalizedEval = {
    q1: normalizeLikertValue(
      pickValue(evalData, ['Q1_Satisfaction', 'Q1_CourseObjectives']),
    ),
    q2: normalizeLikertValue(
      pickValue(evalData, ['Q2_ScientificRigor', 'Q2_KnowledgeGained']),
    ),
    q3: normalizeLikertValue(
      pickValue(evalData, ['Q3_Unbiased', 'Q3_FreeOfBias']),
    ),
    q5: normalizeYesNoValue(
      pickValue(evalData, ['Q5_PracticeImpacted', 'Q5_PracticeImpact']),
    ),
    q7: String(
      pickValue(evalData, ['Q7_ActionText', 'Q7_ActionPlan'], '') || '',
    ).trim(),
    q8Quality: normalizeRatingValue(
      pickValue(evalData, ['Q8_QualityRating', 'Q8_OverallQuality']),
    ),
    q8Effectiveness: normalizeRatingValue(
      pickValue(evalData, ['Q8_EffectivenessRating', 'Q8_CourseEffectiveness']),
    ),
    q8Appropriateness: normalizeRatingValue(
      pickValue(evalData, [
        'Q8_AppropriatenessRating',
        'Q8_MaterialAppropriateness',
      ]),
    ),
    objectives: [],
    instructors: [],
  }

  normalized.objectives = Array.from({ length: objectiveCount }, (_, index) =>
    normalizeLikertValue(
      pickValue(evalData, [
        `Q4_Obj${index + 1}`,
        `Q4_Objective${index + 1}`,
      ]),
    ),
  )

  normalized.instructors = Array.from({ length: 4 }, (_, index) => ({
    name: String(
      pickValue(
        evalData,
        [`Q6_Inst${index + 1}_Name`, `Q6_Instructor${index + 1}_Name`],
        '',
      ) || '',
    ).trim(),
    rating: normalizeRatingValue(
      pickValue(evalData, [
        `Q6_Inst${index + 1}_Rating`,
        `Q6_Instructor${index + 1}_Rating`,
      ]),
    ),
  }))

  return normalized
}

function getBLSLikertOption(value: string): string {
  const options: Record<string, string> = {
    SA: 'Strongly Agree',
    A: 'Agree',
    N: 'Neutral',
    D: 'Disagree',
    SD: 'Strongly Disagree',
  }
  return options[value] || ''
}

function getACLSLikertOption(fieldName: string, value: string): string {
  const base: Record<string, string> = {
    SA: 'Strongly agree',
    A: 'Agree',
    N: 'Neutral',
    D: 'Disagree',
    SD: 'Strongly disagree',
  }
  if (fieldName === 'Q2_ScientificRigor') {
    return (
      {
        SA: 'Strongly agree_2',
        A: 'Agree_2',
        N: 'Neutral_2',
        D: 'Disagree_2',
        SD: 'Strongly disagree_2',
      }[value] || ''
    )
  }
  if (fieldName === 'Q3_Unbiased') {
    return (
      {
        SA: 'Strongly agree_3',
        A: 'Agree_3',
        N: 'Neutral_3',
        D: 'Disagree_3',
        SD: 'Strongly disagree_3',
      }[value] || ''
    )
  }
  return base[value] || ''
}

function getRatingOption(value: string): string {
  return (
    {
      Excellent: 'Excellent',
      'Above Average': 'Above Average',
      Average: 'Average',
      'Below Average': 'Below Average',
      Poor: 'Poor',
      'N/A': 'N#2fA',
    }[value] || ''
  )
}

function setTextField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any,
  name: string,
  value: string,
  fontSize = 10,
): void {
  try {
    const field = form.getTextField(name)
    field.setText(sanitizeForWinAnsi(String(value || '')))
    if (fontSize && typeof field.setFontSize === 'function') {
      field.setFontSize(fontSize)
    }
  } catch {
    console.warn(`Eval text field not found: ${name}`)
  }
}

/** The AHA fillable eval templates ship with fonts that only cover
 *  WinAnsi. Anything outside that (emoji, curly quotes, em-dashes,
 *  arrows, etc.) makes pdf-lib throw on setText(). Map the common
 *  smart-punctuation to ASCII, then drop any remaining codepoint that
 *  isn't in WinAnsi so student free-text with 👍 doesn't wedge the
 *  whole batch. */
function sanitizeForWinAnsi(input: string): string {
  if (!input) return ''
  const map: Record<string, string> = {
    '‘': "'", '’': "'", '‚': ',', '‛': "'",
    '“': '"', '”': '"', '„': '"', '‟': '"',
    '–': '-', '—': '-', '−': '-', '―': '-',
    '•': '*', '·': '-',
    '…': '...',
    ' ': ' ',
    '→': '->', '←': '<-', '⇒': '=>',
    '✓': 'v', '✗': 'x', '✅': 'v',
  }
  let out = ''
  for (const ch of input) {
    // Fast path for pure ASCII + all of latin-1 supplement.
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) {
      out += ch
      continue
    }
    if (map[ch]) {
      out += map[ch]
      continue
    }
    // Anything else (emoji, CJK, arrows we didn't map) becomes '?' so
    // the surrounding text still lands intact.
    out += '?'
  }
  return out
}

function setRadioField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any,
  name: string,
  value: string,
): void {
  if (!value) return
  try {
    form.getRadioGroup(name).select(value)
  } catch {
    console.warn(`Eval radio not found: ${name} -> ${value}`)
  }
}

function wrapTextToWidth(
  text: string,
  maxCharsPerLine = 95,
  maxLines = 3,
): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let currentLine = ''
  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  })
  if (currentLine) lines.push(currentLine)
  return lines.slice(0, maxLines)
}

function drawTextInRects(
  page: PDFPage,
  rects: number[][],
  text: string,
  font: PDFFont,
  size = 9,
): void {
  // Sanitize BEFORE wrapping so line-breaks aren't off by emoji width.
  const safe = sanitizeForWinAnsi(text)
  const lines = wrapTextToWidth(safe, 95, rects.length)
  rects.forEach((rect, index) => {
    const line = lines[index]
    if (!line) return
    page.drawText(line, {
      x: rect[0] + 4,
      y: rect[1] + 6,
      size,
      font,
      color: rgb(0, 0, 0),
    })
  })
}

function drawActionText(
  pdfDoc: PDFDocument,
  courseType: CourseTemplate,
  text: string,
  font: PDFFont,
): void {
  if (!text) return
  const page = pdfDoc.getPages()[1]
  const rectMap: Record<CourseTemplate, number[][]> = {
    ACLS: [
      [54.0, 274.92, 574.08, 295.8],
      [54.3434, 252.118, 574.423, 272.998],
      [53.9333, 228.344, 574.013, 249.224],
    ],
    BLS: [
      [54.1316, 342.203, 575.695, 364.203],
      [53.4968, 318.779, 575.06, 340.779],
      [54.2558, 295.422, 575.819, 317.422],
    ],
    PALS: [
      [54.0, 328.20001, 574.08002, 349.07999],
      [53.479801, 304.371, 573.56, 325.25101],
      [55.660702, 278.87, 575.74103, 299.75],
    ],
  }
  drawTextInRects(page, rectMap[courseType] || rectMap.BLS, text, font, 9)
}

function drawX(page: PDFPage, x: number, y: number, font: PDFFont): void {
  page.drawText('X', {
    x: x - 4.5,
    y: y - 6,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  })
}

function drawLikertGrid(
  page: PDFPage,
  rowValues: string[],
  yPositions: number[],
  xPositions: number[],
  font: PDFFont,
): void {
  const columnIndex: Record<string, number> = { SA: 0, A: 1, N: 2, D: 3, SD: 4 }
  rowValues.forEach((value, index) => {
    const col = columnIndex[value]
    const y = yPositions[index]
    if (col === undefined || y === undefined) return
    drawX(page, xPositions[col], y, font)
  })
}

function drawRatingGrid(
  page: PDFPage,
  rowValues: string[],
  yPositions: number[],
  xPositions: number[],
  font: PDFFont,
): void {
  const columnIndex: Record<string, number> = {
    Excellent: 0,
    'Above Average': 1,
    Average: 2,
    'Below Average': 3,
    Poor: 4,
    'N/A': 5,
  }
  rowValues.forEach((value, index) => {
    const col = columnIndex[value]
    const y = yPositions[index]
    if (col === undefined || y === undefined) return
    drawX(page, xPositions[col], y, font)
  })
}

function fillPALSMarks(
  pdfDoc: PDFDocument,
  normalized: NormalizedEval,
  font: PDFFont,
): void {
  const pages = pdfDoc.getPages()
  const page1 = pages[0]
  const page2 = pages[1]

  const likertColumnIndex: Record<string, number> = {
    SA: 0,
    A: 1,
    N: 2,
    D: 3,
    SD: 4,
  }
  const drawVerticalLikert = (
    page: PDFPage,
    value: string,
    yPositions: number[],
  ) => {
    const index = likertColumnIndex[value]
    if (index === undefined || yPositions[index] === undefined) return
    drawX(page, 67.92, yPositions[index], font)
  }

  drawVerticalLikert(page1, normalized.q1, [
    582.9, 571.38, 559.86, 548.34, 536.94,
  ])
  drawVerticalLikert(page1, normalized.q2, [
    505.02, 493.62, 482.1, 470.58, 459.06,
  ])
  drawVerticalLikert(page1, normalized.q3, [
    427.26, 415.74, 404.22, 392.7, 381.3,
  ])

  drawLikertGrid(
    page1,
    normalized.objectives.slice(0, 7),
    [295.878, 258.74, 220.737, 183.599, 152.506, 120.549, 89.456],
    [268.971, 337.203, 405.434, 473.666, 541.034],
    font,
  )

  drawLikertGrid(
    page2,
    normalized.objectives.slice(7, 10),
    [693.176, 666.402, 642.218],
    [269.835, 337.203, 404.57, 472.802, 541.034],
    font,
  )

  drawRatingGrid(
    page2,
    normalized.instructors.map((item) => item.rating),
    [508.346, 472.935, 435.796, 399.521],
    [255.152, 313.883, 372.614, 430.481, 490.076, 547.943],
    font,
  )

  drawRatingGrid(
    page2,
    [
      normalized.q8Quality,
      normalized.q8Effectiveness,
      normalized.q8Appropriateness,
    ],
    [199.145, 168.188, 143.869],
    [255.152, 313.019, 371.75, 431.345, 488.348, 547.079],
    font,
  )
}

function fillBLSACLSFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any,
  normalized: NormalizedEval,
  courseType: CourseTemplate,
): void {
  const q1Option =
    courseType === 'ACLS'
      ? getACLSLikertOption('Q1_Satisfaction', normalized.q1)
      : getBLSLikertOption(normalized.q1)
  const q2Option =
    courseType === 'ACLS'
      ? getACLSLikertOption('Q2_ScientificRigor', normalized.q2)
      : getBLSLikertOption(normalized.q2)
  const q3Option =
    courseType === 'ACLS'
      ? getACLSLikertOption('Q3_Unbiased', normalized.q3)
      : getBLSLikertOption(normalized.q3)

  setRadioField(form, 'Q1_Satisfaction', q1Option)
  setRadioField(form, 'Q2_ScientificRigor', q2Option)
  setRadioField(form, 'Q3_Unbiased', q3Option)

  normalized.objectives.forEach((value, index) => {
    if (!value) return
    setRadioField(form, `Q4_Obj${index + 1}`, getBLSLikertOption(value))
  })

  if (normalized.q5) {
    setRadioField(
      form,
      'Q5_PracticeImpacted',
      normalized.q5 === 'Yes' ? 'True' : 'False',
    )
  }

  normalized.instructors.forEach((item, index) => {
    const number = index + 1
    if (item.name) setTextField(form, `Q6_Inst${number}_Name`, item.name, 10)
    if (item.rating) {
      setRadioField(form, `Q6_Inst${number}_Rating`, getRatingOption(item.rating))
    }
  })

  if (normalized.q8Quality) {
    setRadioField(form, 'Q8_QualityRating', getRatingOption(normalized.q8Quality))
  }
  if (normalized.q8Effectiveness) {
    setRadioField(
      form,
      'Q8_EffectivenessRating',
      getRatingOption(normalized.q8Effectiveness),
    )
  }
  if (normalized.q8Appropriateness) {
    setRadioField(
      form,
      'Q8_AppropriatenessRating',
      getRatingOption(normalized.q8Appropriateness),
    )
  }
}

function fillPALSFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any,
  normalized: NormalizedEval,
): void {
  if (normalized.q5) {
    setRadioField(
      form,
      '5 My research or practice will be impacted or changed as a result of something I learned in this offering',
      normalized.q5 === 'Yes' ? 'True' : 'False',
    )
  }
  const nameFields = ['Text15', 'Text16', 'Text17', 'Text18']
  normalized.instructors.forEach((item, index) => {
    if (item.name) setTextField(form, nameFields[index], item.name, 10)
  })
}

export interface EvalSessionMeta {
  classDate: string
  location: string
  primaryInstructorName: string
}

/** Generate one student's evaluation PDF. Returns the PDF bytes. */
export async function generateSingleEvalPdf(
  evalData: Record<string, unknown>,
  courseType: CourseTemplate,
  session: EvalSessionMeta,
): Promise<Uint8Array> {
  const pdfBytes = b64ToBytes(EVAL_TEMPLATES[courseType])
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const form = pdfDoc.getForm()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const normalized = normalizeEvaluationRecord(evalData, courseType)

  const instructorHeader =
    normalized.instructors
      .map((item) => item.name)
      .filter(Boolean)
      .join(', ') ||
    session.primaryInstructorName ||
    ''

  setTextField(form, 'Date', formatDate(session.classDate), 10)
  setTextField(form, 'Instructors', instructorHeader, 10)
  setTextField(form, 'Training Center', 'Waller County EMS', 10)
  setTextField(form, 'Location', session.location || 'Waller County EMS', 10)

  if (courseType === 'PALS') {
    fillPALSFields(form, normalized)
  } else {
    fillBLSACLSFields(form, normalized, courseType)
  }

  try {
    form.updateFieldAppearances(font)
  } catch {
    /* best effort */
  }

  form.flatten()

  drawActionText(pdfDoc, courseType, normalized.q7, font)
  if (courseType === 'PALS') {
    fillPALSMarks(pdfDoc, normalized, font)
  }

  return pdfDoc.save()
}
