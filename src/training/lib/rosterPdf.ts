// AHA course-roster PDF generation. Ported verbatim from the legacy
// roster-export.html generatePDF() — field names, the course-type
// checkbox logic, the signature image placement, and the
// up-to-10-attendees fill loop are preserved exactly.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Attendee, CourseTemplate } from '@/training/types'
import {
  ROSTER_TEMPLATES,
  b64ToBytes,
  TRAINING_CENTER,
} from './pdfTemplates'

export interface RosterFields {
  courseName: string
  courseDate: string
  startTime: string
  endTime: string
  instructorName: string
  instructorNumber: string
  location: string
  hours: string
  manikinRatio: string
  instructorCardExp: string // yyyy-mm-dd or ''
  assist1Name: string
  assist1Number: string
  assist1Exp: string // yyyy-mm-dd or ''
  assist2Name: string
  assist2Number: string
  assist2Exp: string
}

function sanitizeInstructorId(value: string): string {
  const clean = String(value || '').trim()
  if (!clean) return ''
  if (clean.includes('@')) return ''
  return clean
}

function buildInstructorNameId(name: string, number: string): string {
  return [String(name || '').trim(), sanitizeInstructorId(number)]
    .filter(Boolean)
    .join(' / ')
}

function formatExpirationDisplay(value: string): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${m}/${d}/${y}`
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value
  return value
}

export function rosterTemplateKey(courseName: string): CourseTemplate {
  const up = (courseName || '').toUpperCase()
  if (up.includes('ACLS')) return 'ACLS'
  if (up.includes('PALS')) return 'PALS'
  return 'BLS'
}

/** Fill the AHA roster PDF. `signaturePng` is a data URL from the
 *  signature pad. Returns { bytes, fileName, templateKey }. */
export async function generateRosterPdf(
  fields: RosterFields,
  attendance: Attendee[],
  sessionId: string,
  signaturePng: string,
): Promise<{ bytes: Uint8Array; fileName: string; templateKey: CourseTemplate }> {
  const templateKey = rosterTemplateKey(fields.courseName)

  const pdfBytes = b64ToBytes(ROSTER_TEMPLATES[templateKey])
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const form = pdfDoc.getForm()

  const signatureBytes = b64ToBytes(signaturePng.split(',')[1])
  const signatureImage = await pdfDoc.embedPng(signatureBytes)

  const setField = (name: string, value: string, fontSize?: number) => {
    try {
      const f = form.getTextField(name)
      f.setText(value || '')
      if (fontSize && typeof f.setFontSize === 'function') {
        f.setFontSize(fontSize)
      }
    } catch {
      console.warn(`Roster field not found: ${name}`)
    }
  }
  const setCheckbox = (name: string, checked: boolean) => {
    try {
      const f = form.getCheckBox(name)
      if (checked) f.check()
    } catch {
      console.warn(`Roster checkbox not found: ${name}`)
    }
  }

  const instructorNumber = sanitizeInstructorId(fields.instructorNumber)

  setField('Lead Instructor', fields.instructorName)
  setField('Lead Instructor ID#', instructorNumber)
  setField('Training Center', TRAINING_CENTER.name)
  setField('Training Center ID#', TRAINING_CENTER.id)
  setField('Training Site Name', TRAINING_CENTER.siteName)
  setField('Address', TRAINING_CENTER.address)
  setField('City, State ZIP', TRAINING_CENTER.cityStateZip)
  setField('Course Location', fields.location || TRAINING_CENTER.siteName)

  const assistingInstructor1 = buildInstructorNameId(
    fields.assist1Name,
    fields.assist1Number,
  )
  const assistingInstructor2 = buildInstructorNameId(
    fields.assist2Name,
    fields.assist2Number,
  )
  if (assistingInstructor1) setField('Name-Instructor ID', assistingInstructor1)
  if (fields.assist1Exp) {
    setField('Card Exp Date', formatExpirationDisplay(fields.assist1Exp))
  }
  if (assistingInstructor2) {
    setField('Name-Instructor ID 2', assistingInstructor2)
  }
  if (fields.assist2Exp) {
    setField('Card Exp Date 2', formatExpirationDisplay(fields.assist2Exp))
  }

  // Force a smaller font on these two — the template field's default
  // appearance is too large for "MM/DD/YYYY HH:MM" and truncates the
  // trailing minutes digit otherwise.
  setField('Course Start', `${fields.courseDate} ${fields.startTime}`, 8)
  setField('Course End', `${fields.courseDate} ${fields.endTime}`, 8)
  setField('Total Hours', fields.hours)
  setField('No of Cards', String(attendance.length))
  setField('Student-Manikin Ratio', fields.manikinRatio)
  setField('Issue Date', fields.courseDate)
  setField('Date', fields.courseDate)

  if (fields.instructorCardExp) {
    const [y, m, d] = fields.instructorCardExp.split('-')
    setField('Card Expriation Date', `${m}/${d}/${y}`)
  }

  const courseName2 = fields.courseName.toLowerCase()
  if (templateKey === 'BLS') {
    if (courseName2.includes('renewal') || courseName2.includes('recert')) {
      setCheckbox('Check Box 28', true)
    } else if (courseName2.includes('heartcode')) {
      setCheckbox('Check Box 29', true)
    } else {
      setCheckbox('Check Box 27', true)
    }
  } else if (templateKey === 'ACLS') {
    if (
      courseName2.includes('update') ||
      courseName2.includes('renewal') ||
      courseName2.includes('recert')
    ) {
      setCheckbox('Check Box 2', true)
    } else if (courseName2.includes('heartcode')) {
      setCheckbox('Check Box 5', true)
    } else {
      setCheckbox('Check Box 1', true)
    }
  } else if (templateKey === 'PALS') {
    if (
      courseName2.includes('update') ||
      courseName2.includes('renewal') ||
      courseName2.includes('recert')
    ) {
      setCheckbox('Check Box 2', true)
    } else if (courseName2.includes('heartcode')) {
      setCheckbox('Check Box 4', true)
    } else {
      setCheckbox('Check Box 1', true)
    }
  }

  setField('Date 2', fields.courseDate)
  setField('Course', fields.courseName)
  setField('Lead Instructor 2', fields.instructorName)
  setField('Lead Instructor ID# 2', instructorNumber)

  attendance.slice(0, 10).forEach((a, i) => {
    const suffix = i === 0 ? '' : ` ${i + 1}`
    const name = a.studentName || ''
    const email = a.eCardEmail || a.studentEmail || ''
    const address = a.mailingAddress || ''
    const phone = a.phone || ''
    const psaScore = a.psaScore ?? ''

    setField(`Name${suffix}`, name)
    setField(`Email${suffix}`, email)
    setField(`Mailing Address${suffix}`, address)
    setField(`Telephone${suffix}`, phone)
    if (templateKey === 'ACLS' || templateKey === 'PALS') {
      setField(`PSA${suffix}`, String(psaScore || ''))
    }
    setField(`Complete-Incomplete${suffix}`, 'Complete')
  })

  try {
    form.getTextField('Signature').setText('')
  } catch {
    /* no signature text field on this template */
  }

  form.flatten()

  const page = pdfDoc.getPages()[0]
  page.drawImage(signatureImage, { x: 72, y: 58, width: 180, height: 50 })

  // ── Overflow: append duplicated roster pages for students 11+ ──
  // The AHA template has one roster page with 10 slots. For classes
  // with more than 10 attendees we load a fresh template per batch,
  // fill only its roster page with the next 10 students, flatten,
  // then copy that single page into the main document. Result: one
  // additional roster page per 10 overflow students. Header
  // (Course / Date / Lead Instructor) is repeated on each roster
  // page so every printout is self-identifying.
  for (
    let start = 10;
    start < attendance.length;
    start += 10
  ) {
    const batch = attendance.slice(start, start + 10)
    const extraDoc = await PDFDocument.load(pdfBytes)
    const extraForm = extraDoc.getForm()
    const setExtra = (name: string, value: string, fontSize?: number) => {
      try {
        const f = extraForm.getTextField(name)
        f.setText(value || '')
        if (fontSize && typeof f.setFontSize === 'function') {
          f.setFontSize(fontSize)
        }
      } catch {
        /* silent — some fields differ across AHA templates */
      }
    }

    // Roster-page header (Date 2 / Course / Lead Instructor 2 / ID)
    setExtra('Date 2', fields.courseDate)
    setExtra('Course', fields.courseName)
    setExtra('Lead Instructor 2', fields.instructorName)
    setExtra('Lead Instructor ID# 2', instructorNumber)
    setExtra('No of Cards', String(attendance.length))

    // Student rows for this batch
    batch.forEach((a, i) => {
      const suffix = i === 0 ? '' : ` ${i + 1}`
      setExtra(`Name${suffix}`, a.studentName || '')
      setExtra(`Email${suffix}`, a.eCardEmail || a.studentEmail || '')
      setExtra(`Mailing Address${suffix}`, a.mailingAddress || '')
      setExtra(`Telephone${suffix}`, a.phone || '')
      if (templateKey === 'ACLS' || templateKey === 'PALS') {
        setExtra(`PSA${suffix}`, String(a.psaScore ?? ''))
      }
      setExtra(`Complete-Incomplete${suffix}`, 'Complete')
    })

    // Capture Name-field widget rects BEFORE flattening so we can
    // renumber the pre-printed "1.–10." row labels to the correct
    // global numbers (11–20, 21–30, ...) after copying the page.
    const rowRects: Array<{ x: number; y: number; height: number }> = []
    for (let i = 0; i < batch.length; i++) {
      const fieldName = i === 0 ? 'Name' : `Name ${i + 1}`
      try {
        const widgets = extraForm
          .getTextField(fieldName)
          .acroField.getWidgets()
        if (widgets.length) {
          const rect = widgets[0].getRectangle()
          rowRects.push({ x: rect.x, y: rect.y, height: rect.height })
        } else {
          rowRects.push({ x: 0, y: 0, height: 0 })
        }
      } catch {
        rowRects.push({ x: 0, y: 0, height: 0 })
      }
    }

    extraForm.flatten()

    // Copy the LAST page of the template (the roster page) into the
    // main doc. Assumes the AHA templates put the roster on the final
    // page — true for BLS/ACLS/PALS as shipped.
    const rosterPageIdx = extraDoc.getPageCount() - 1
    const [rosterPage] = await pdfDoc.copyPages(extraDoc, [rosterPageIdx])
    const addedPage = pdfDoc.addPage(rosterPage)

    // Overlay the correct global row numbers over the template's
    // pre-printed "1.–10." labels. The labels sit ~30pt to the left
    // of the Name field's x coordinate on all three AHA templates.
    const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    for (let i = 0; i < rowRects.length; i++) {
      const rect = rowRects[i]
      if (!rect.height) continue
      const globalNum = start + i + 1
      // White out the pre-printed number
      addedPage.drawRectangle({
        x: rect.x - 30,
        y: rect.y - 2,
        width: 26,
        height: rect.height + 4,
        color: rgb(1, 1, 1),
      })
      // Draw the correct global number in its place
      addedPage.drawText(`${globalNum}.`, {
        x: rect.x - 26,
        y: rect.y + 3,
        size: 10,
        font: helvBold,
        color: rgb(0, 0, 0),
      })
    }
  }

  const bytes = await pdfDoc.save()
  return {
    bytes,
    fileName: `AHA_${templateKey}_Roster_${sessionId}.pdf`,
    templateKey,
  }
}
