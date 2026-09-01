// AHA fillable PDF templates, carried over verbatim from the legacy
// roster-export.html / evals-export.html (extracted out of their inline
// PDF_TEMPLATES object literals). Imported as raw base64 strings.

import rosterBLS from '@/training/assets/pdf-templates/roster_BLS.b64.txt?raw'
import rosterACLS from '@/training/assets/pdf-templates/roster_ACLS.b64.txt?raw'
import rosterPALS from '@/training/assets/pdf-templates/roster_PALS.b64.txt?raw'
import evalBLS from '@/training/assets/pdf-templates/eval_BLS.b64.txt?raw'
import evalACLS from '@/training/assets/pdf-templates/eval_ACLS.b64.txt?raw'
import evalPALS from '@/training/assets/pdf-templates/eval_PALS.b64.txt?raw'

import type { CourseTemplate } from '@/training/types'

const clean = (s: string) => s.replace(/\s+/g, '')

export const ROSTER_TEMPLATES: Record<CourseTemplate, string> = {
  BLS: clean(rosterBLS),
  ACLS: clean(rosterACLS),
  PALS: clean(rosterPALS),
}

export const EVAL_TEMPLATES: Record<CourseTemplate, string> = {
  BLS: clean(evalBLS),
  ACLS: clean(evalACLS),
  PALS: clean(evalPALS),
}

/** atob → Uint8Array, the exact decode the legacy exporters used. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export const TRAINING_CENTER = {
  name: 'Memorial Hermann Texas Medical Center',
  id: 'TX05432',
  siteName: 'Waller County EMS',
  address: '1134 Austin St',
  cityStateZip: 'Hempstead, TX 77445',
}

export function courseTemplateFor(courseName: string): CourseTemplate {
  const up = (courseName || '').toUpperCase()
  if (up.includes('ACLS')) return 'ACLS'
  if (up.includes('PALS')) return 'PALS'
  return 'BLS'
}
