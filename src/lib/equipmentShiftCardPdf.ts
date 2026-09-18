import jsPDF from 'jspdf'
import QRCode from 'qrcode'
import { compareTags, placeName } from '@/lib/equipment'
import type { EquipmentAsset, EquipmentCheckout } from '@/types'

/**
 * The card that rides with the gear: a printable, black-and-white page
 * (WCEMS letterhead, same as the Skills Day packet) that tells whoever is
 * on the truck what to do, with a QR code straight to this check-out.
 * Crews arriving for an extended assignment never got the texted link —
 * this is how they find it.
 */

const BLACK: [number, number, number] = [20, 20, 20]
const INK: [number, number, number] = [35, 35, 35]
const INK_SOFT: [number, number, number] = [85, 85, 85]
const MUTED: [number, number, number] = [130, 130, 130]
const LINE: [number, number, number] = [200, 200, 200]
const SOFT_BG: [number, number, number] = [243, 243, 243]

/** 'YYYY-MM-DD' pair → "Sep 18 – Oct 3, 2026" (or a single date). */
function absoluteSpan(start: string | null, end: string | null): string {
  const fmt = (iso: string, withYear: boolean) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    })
  }
  if (!start && !end) return ''
  if (!start) return `Through ${fmt(end!, true)}`
  if (!end || end === start) return fmt(start, true)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`
}

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

export interface ShiftCardInput {
  checkout: EquipmentCheckout
  items: EquipmentAsset[]
  typeName: (typeId: string | null) => string
  url: string
}

export async function generateShiftCardPdf(input: ShiftCardInput): Promise<jsPDF> {
  const { checkout } = input
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MARGIN = 52
  const CONTENT_W = W - MARGIN * 2

  const [crest, qr] = await Promise.all([
    loadImageAsBase64(`${window.location.origin}/wcems-patch-bw.jpg`),
    QRCode.toDataURL(input.url, {
      width: 640,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }),
  ])
  const CREST_W = 40
  const CREST_H = CREST_W * (280 / 262)

  /* ── Letterhead ─────────────────────────────────────────────────── */
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
  doc.text('EVENT EQUIPMENT', W - MARGIN, top + 10, { align: 'right', charSpace: 0.8 })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...INK_SOFT)
  doc.text(checkout.extended ? 'Shift-check card' : 'Equipment card', W - MARGIN, top + 22, {
    align: 'right',
  })

  const ruleY = top + CREST_H
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(1.4)
  doc.line(MARGIN, ruleY, W - MARGIN, ruleY)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, ruleY + 3, W - MARGIN, ruleY + 3)
  let y = ruleY + 34

  /* ── Event + truck ──────────────────────────────────────────────── */
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.setTextColor(...BLACK)
  const titleLines = doc.splitTextToSize(checkout.purpose, CONTENT_W) as string[]
  doc.text(titleLines, MARGIN, y)
  y += titleLines.length * 24

  const truck = placeName(checkout.destination)
  /* Absolute dates: this card rides on the truck for weeks, so "Today"
     would be wrong by tomorrow. */
  const span = absoluteSpan(checkout.eventDate, checkout.extended ? checkout.endDate : null)
  const meta = [truck.charAt(0).toUpperCase() + truck.slice(1), span, checkout.extended ? 'Extended assignment' : '']
    .filter(Boolean)
    .join('   ·   ')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11.5)
  doc.setTextColor(...INK)
  doc.text(meta, MARGIN, y)
  y += 26

  /* ── Instructions box with the QR code ──────────────────────────── */
  const QR = 150
  const boxTop = y
  doc.addImage(qr, 'PNG', W - MARGIN - QR - 18, boxTop + 18, QR, QR, 'equipment-qr')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text('Scan with your phone camera', W - MARGIN - 18 - QR / 2, boxTop + QR + 30, {
    align: 'center',
  })

  const textW = CONTENT_W - QR - 60
  let ty = boxTop + 30
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13.5)
  doc.setTextColor(...BLACK)
  const headline = checkout.extended
    ? 'Check this equipment at the START and END of every shift.'
    : 'Confirm this equipment is on the truck when your shift starts.'
  const headLines = doc.splitTextToSize(headline, textW) as string[]
  doc.text(headLines, MARGIN + 18, ty)
  ty += headLines.length * 16 + 8

  const steps = checkout.extended
    ? [
        'Scan the code, or open the Equipment page in the portal.',
        'Sign in with your WCEMS Microsoft account.',
        'Tap Start-of-shift check when you take the truck.',
        'Before you hand it over, tap End-of-shift check and photograph where you’re leaving the gear.',
        'Tap anything you can’t find and add a note.',
      ]
    : [
        'Scan the code, or open the Equipment page in the portal.',
        'Sign in with your WCEMS Microsoft account.',
        'Tap Confirm it’s here — tap anything you can’t find and add a note.',
        'When the event wraps, tap Close out the event and photograph where it’s left.',
      ]
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  steps.forEach((step, i) => {
    const lines = doc.splitTextToSize(step, textW - 16) as string[]
    doc.setFont('helvetica', 'bold')
    doc.text(`${i + 1}.`, MARGIN + 18, ty)
    doc.setFont('helvetica', 'normal')
    doc.text(lines, MARGIN + 34, ty)
    ty += lines.length * 13 + 5
  })
  /* The box grows with the steps; never shorter than the QR block. */
  const boxH = Math.max(QR + 46, ty - boxTop + 30)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...BLACK)
  doc.text('Missing something? Tell your supervisor right away.', MARGIN + 18, boxTop + boxH - 16)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(1.6)
  doc.roundedRect(MARGIN, boxTop, CONTENT_W, boxH, 6, 6)
  y = boxTop + boxH + 30

  /* ── Item list ──────────────────────────────────────────────────── */
  const items = [...input.items].sort((a, b) => compareTags(a.tag, b.tag))
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...BLACK)
  doc.text(`EQUIPMENT ON THIS TRUCK  (${items.length})`, MARGIN, y, { charSpace: 0.8 })
  y += 10

  const COL_BOX = MARGIN + 10
  const COL_TAG = MARGIN + 34
  const COL_ITEM = MARGIN + 104
  const COL_TYPE = W - MARGIN - 110
  const ROW_H = 22
  doc.setFillColor(...SOFT_BG)
  doc.rect(MARGIN, y, CONTENT_W, ROW_H, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_SOFT)
  doc.text('TAG', COL_TAG, y + 14.5)
  doc.text('ITEM', COL_ITEM, y + 14.5)
  doc.text('TYPE', COL_TYPE, y + 14.5)
  y += ROW_H

  doc.setFontSize(10)
  for (const a of items) {
    if (y + ROW_H > H - 70) {
      doc.addPage()
      y = 60
    }
    doc.setDrawColor(...INK_SOFT)
    doc.setLineWidth(0.8)
    doc.rect(COL_BOX, y + 6, 10, 10)
    doc.setFont('courier', 'bold')
    doc.setTextColor(...BLACK)
    doc.text(a.tag, COL_TAG, y + 15)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...INK)
    const name = doc.splitTextToSize(a.name, COL_TYPE - COL_ITEM - 12) as string[]
    doc.text(name[0] ?? '', COL_ITEM, y + 15)
    doc.setTextColor(...INK_SOFT)
    doc.text(input.typeName(a.typeId), COL_TYPE, y + 15)
    y += ROW_H
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y, W - MARGIN, y)
  }

  /* ── Footer ─────────────────────────────────────────────────────── */
  const printed = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.text(
    `Keep this card with the equipment.   Checked out by ${checkout.createdByName || '—'}   ·   Printed ${printed}`,
    MARGIN,
    H - 40,
  )
  doc.text(input.url.replace(/^https?:\/\//, ''), MARGIN, H - 28)

  return doc
}
