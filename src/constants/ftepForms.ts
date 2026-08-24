/**
 * FTEP form definitions — the DOR and ICR category sets, transcribed
 * 1:1 from the v1.0 paper forms (FTEP - Current Documents (v1.0)).
 * Labels are stamped into each report's payload at submit so records
 * survive future revisions of these lists.
 *
 * DOR rubric (enforced by the form):
 *   1–5 anchored scale · N.O. excluded from the average · any rating
 *   below 3 requires a behavioral comment · any 1 requires the
 *   documented-situation narrative · NRT is a flag beside the score
 *   and notifies the CDO.
 */

export interface FtepCategory {
  no: number
  label: string
}

export interface FtepSection {
  title: string
  categories: FtepCategory[]
}

export const DOR_SECTIONS: FtepSection[] = [
  {
    title: 'Appearance / Preparedness',
    categories: [
      { no: 1, label: 'Punctuality & shift change' },
      { no: 2, label: 'General appearance & uniform' },
      { no: 3, label: 'Equipment readiness & truck check (PSTrax)' },
      { no: 4, label: 'Radio usage' },
      { no: 5, label: 'Non-emergent driving' },
      { no: 6, label: 'Emergent driving' },
      { no: 7, label: 'Mapping / district knowledge' },
    ],
  },
  {
    title: 'Attitude / Relationships',
    categories: [
      { no: 8, label: 'Acceptance of feedback' },
      { no: 9, label: 'Attitude toward EMS work' },
      { no: 10, label: 'With patients & families' },
      { no: 11, label: 'With crews, public safety & hospital staff' },
    ],
  },
  {
    title: 'Knowledge / Application',
    categories: [
      { no: 12, label: 'Department policies & SOPs' },
      { no: 13, label: 'General & medical protocols' },
      { no: 14, label: 'Trauma protocols' },
      { no: 15, label: 'Pediatric / OB protocols' },
      { no: 16, label: 'Pharmacology & drug calculations' },
      { no: 17, label: 'P2-required criteria recognition & escalation' },
    ],
  },
  {
    title: 'Performance / Patient Care',
    categories: [
      { no: 18, label: 'Scene management & safety' },
      { no: 19, label: 'Command presence / call leadership' },
      { no: 20, label: 'Patient assessment (1.19 vitals incl. temp & BGL)' },
      { no: 21, label: 'History gathering' },
      { no: 22, label: 'Clinical impression & protocol selection' },
      { no: 23, label: 'Decision-making under pressure' },
      { no: 24, label: 'BLS skills' },
      { no: 25, label: 'ALS skills & procedures' },
      { no: 26, label: 'Medication administration (3-check · allergies · cross-check)' },
      { no: 27, label: 'ECG monitoring & 12-lead interpretation' },
    ],
  },
  {
    title: 'Communication / Documentation / Operations',
    categories: [
      { no: 28, label: 'Consults & notifications (Supervisor by name · Pulsara/phone)' },
      { no: 29, label: 'ePCR content & narrative quality' },
      { no: 30, label: 'Documentation timeliness (≤ 24 hrs)' },
      { no: 31, label: 'Downtime utilization & protocol study' },
      { no: 32, label: 'Stretcher / ambulance operations & body mechanics' },
    ],
  },
]

export const ICR_SECTIONS: FtepSection[] = [
  {
    title: 'Assessment & Clinical Decision-Making',
    categories: [
      { no: 1, label: 'Scene management & safety' },
      { no: 2, label: 'Patient assessment' },
      { no: 3, label: 'History gathering' },
      { no: 4, label: 'Vitals & diagnostics (incl. temperature, BGL, 12-lead when indicated)' },
      { no: 5, label: 'Field impression & protocol selection' },
      { no: 6, label: 'Treatment plan & reassessment' },
      { no: 7, label: 'Transport decision & destination' },
    ],
  },
  {
    title: 'Skills & Interventions',
    categories: [
      { no: 8, label: 'Airway management' },
      { no: 9, label: 'Vascular access' },
      { no: 10, label: 'Medication prep & calculation (3-check with cross-check)' },
      { no: 11, label: 'Medication administration' },
      { no: 12, label: 'ECG application & interpretation' },
      { no: 13, label: 'Immobilization / wound care / splinting' },
      { no: 14, label: 'Stretcher operations & body mechanics' },
    ],
  },
  {
    title: 'Communication & Professionalism',
    categories: [
      { no: 15, label: 'Command presence & crew leadership' },
      { no: 16, label: 'Communication with patient & family' },
      { no: 17, label: 'Communication with crews, public safety & hospital staff' },
      { no: 18, label: 'Consults & notifications' },
      { no: 19, label: 'Attitude & acceptance of feedback' },
    ],
  },
  {
    title: 'Documentation',
    categories: [
      { no: 20, label: 'ePCR content & narrative' },
      { no: 21, label: 'Documentation timeliness' },
    ],
  },
]

export type FtepKind = 'dor' | 'icr'

export function sectionsFor(kind: FtepKind): FtepSection[] {
  return kind === 'dor' ? DOR_SECTIONS : ICR_SECTIONS
}

export function allCategories(kind: FtepKind): FtepCategory[] {
  return sectionsFor(kind).flatMap((s) => s.categories)
}

/** One rated category inside a report payload. */
export interface FtepRating {
  /** 1–5, or 'NO' for not observed. */
  score: number | 'NO'
  /** DOR only: not-responding-to-training flag (notifies the CDO). */
  nrt?: boolean
  /** Required when score < 3. */
  comment?: string
  /** Stamped at submit. */
  label?: string
}

export interface FtepPayload {
  tierPhase?: string
  unit?: string
  /* DOR */
  trainingDayNo?: string
  shift?: {
    dispatched?: string
    attended?: string
    icrs?: string
    contacts?: string
    scenarios?: string
  }
  narratives?: {
    best?: string
    least?: string
    situation?: string
    remedial?: string
    remedialMinutes?: string
    goal?: string
  }
  /* ICR */
  evaluatorRole?: 'fto' | 'supervisor' | 'clinical'
  incidentNo?: string
  chiefComplaint?: string
  callLevel?: 'bls' | 'als' | 'als_p2'
  countsToward10?: boolean
  explanation?: string
  /* shared */
  ratings?: Record<string, FtepRating>
  /** Mean of numeric scores (N.O. excluded), stamped at submit. */
  average?: number
  /** True when any category carries the NRT flag. */
  nrtFlagged?: boolean
}

export const DOR_SCALE_NOTE =
  'Scale: 5 mastery · 4 above standard · 3 minimally acceptable · 2 unsuccessful · 1 unsafe ' +
  '(documented situation required) · N.O. = not observed (excluded from the average) · ' +
  'NRT = not responding to training — a flag, not a score; marking it notifies the CDO.'

export const ICR_SCALE_NOTE =
  'Scale: 5 mastery · 4 above standard · 3 minimally acceptable (minimum passing for any category) · ' +
  '2 unsuccessful — below standard or intervention required · 1 unsafe — requires a documented ' +
  'explanation · N.O. = not observed on this call.'

/** Mean of numeric scores; null when nothing rated yet. */
export function ratingAverage(ratings: Record<string, FtepRating> | undefined): number | null {
  if (!ratings) return null
  const nums = Object.values(ratings)
    .map((r) => r.score)
    .filter((s): s is number => typeof s === 'number')
  if (nums.length === 0) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

/** Category numbers rated but missing a required below-3 comment. */
export function missingComments(
  kind: FtepKind,
  ratings: Record<string, FtepRating> | undefined,
): number[] {
  if (!ratings) return []
  return allCategories(kind)
    .filter((c) => {
      const r = ratings[String(c.no)]
      return r && typeof r.score === 'number' && r.score < 3 && !r.comment?.trim()
    })
    .map((c) => c.no)
}
