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
      { no: 10, label: 'Attitude with patients & families' },
      { no: 11, label: 'Attitude with crews, public safety & hospital staff' },
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

/* ── BLS ICR (EC — EMT candidate track, Guide v1.2) ──────────────────
   The ICR reframed to EMT scope: EMTs do not initiate IVs or interpret
   ECGs — they set up and place them when a paramedic/AEMT is present —
   and their medication list is the EMT band of the protocol book. The
   variant is stamped into the report payload (icrVariant: 'bls') at
   save so records always render with the category set they were scored
   on; reports without a stamp are the original ALS form. */

export const ICR_SECTIONS_BLS: FtepSection[] = [
  {
    title: 'Assessment & Clinical Decision-Making',
    categories: [
      { no: 1, label: 'Scene management & safety' },
      { no: 2, label: 'Patient assessment' },
      { no: 3, label: 'History gathering' },
      { no: 4, label: 'Vitals & diagnostics (incl. temperature & BGL)' },
      { no: 5, label: 'Field impression & protocol selection' },
      { no: 6, label: 'Treatment plan & reassessment' },
      { no: 7, label: 'ALS recognition & escalation (identifies ALS needs early)' },
      { no: 8, label: 'Transport decision & destination' },
    ],
  },
  {
    title: 'Skills & Interventions — EMT scope',
    categories: [
      { no: 9, label: 'Airway management & oxygen (BLS adjuncts · suction · BVM · CPAP)' },
      { no: 10, label: 'Medication administration — EMT scope (3-check with cross-check)' },
      { no: 11, label: 'ALS assist — IV setup, ECG & 12-lead placement (paramedic/AEMT present)' },
      { no: 12, label: 'Immobilization / wound care / splinting' },
      { no: 13, label: 'Stretcher operations & body mechanics' },
    ],
  },
  {
    title: 'Communication & Professionalism',
    categories: [
      { no: 14, label: 'Attendant role — call ownership & teamwork' },
      { no: 15, label: 'Communication with patient & family' },
      { no: 16, label: 'Communication with crews, public safety & hospital staff' },
      { no: 17, label: 'Consults & notifications' },
      { no: 18, label: 'Attitude & acceptance of feedback' },
    ],
  },
  {
    title: 'Documentation',
    categories: [
      { no: 19, label: 'ePCR content & narrative' },
      { no: 20, label: 'Documentation timeliness' },
    ],
  },
]

/** Uniform tier & phase choices (per the FTEP Program Guide) — a
 *  dropdown so printed PDFs never depend on FTOs typing them alike. */
export const TIER_PHASE_OPTIONS = [
  'P1C · Phase 0 — NEOP Academy',
  'P1C · Phase 1 — EMT Orientation',
  'P1C · Phase 2 — Clinical Integration',
  'P1C · Phase 3 — Partner Phase',
  'P1C · Phase 4 — Final Evaluation',
  'P1 · Phase 5 — P2 Development',
  'P1 · Phase 6 — Ghost Phase',
  'P1 · Phase 7 — P2 Final Evaluation',
  'P1 · Legacy P2 track',
  'P2 · P3 Ride-up (supervisor rideout)',
  'AEMT upgrade',
] as const

/** EC (EMT-candidate) phase choices — shown in place of the paramedic
 *  list when the trainee is on the EC track (Guide v1.2 §4). */
export const TIER_PHASE_OPTIONS_EC = [
  'EC · Phase 0 — NEOP Academy',
  'EC · Phase 1 — Operations Orientation',
  'EC · Phase 2 — Attendant Development',
  'EC · Phase 3 — Partner Tour & Final Evaluation',
] as const

export const UNIT_OPTIONS = [
  'M211', 'M221', 'M242', 'M281', 'M231', 'M271', 'M272', 'M206',
] as const

/** The Program Guide's phase ladders, rendered as the trainee stepper.
 *  Keys match ftep_phase_progress.phase_key; per-phase FTO assignment
 *  and start/complete dates live in that table. */
export interface FtepProgramPhase {
  key: string
  no: number
  label: string
  hint: string
  /** Run by the Clinical Department — no FTO is assigned, and its
   *  scheduled days complete on the calendar alone (no DORs). */
  noFto?: boolean
  /** Standard number of shift days — pre-fills the day scheduler. */
  tours?: number
}

export const FTEP_PROGRAM_PHASES: Record<'P1C_P1' | 'P1_P2' | 'EC_EMT', FtepProgramPhase[]> = {
  /* P1C → P1 (90-day cap) */
  P1C_P1: [
    { key: 'phase0', no: 0, label: 'NEOP Academy', hint: 'Clinical Department · 4 days', noFto: true, tours: 4 },
    { key: 'phase1', no: 1, label: 'Operations Orientation', hint: '1 tour · EMT FTO', tours: 1 },
    { key: 'phase2', no: 2, label: 'Clinical Integration', hint: '2 tours', tours: 2 },
    { key: 'phase3', no: 3, label: 'Partner Phase', hint: '4 tours', tours: 4 },
    { key: 'phase4', no: 4, label: 'Final Evaluation', hint: '1 tour · primary FTO scores', tours: 1 },
  ],
  /* P1 → P2 (traditional 32 days / accelerated 10 · 6-month cap) */
  P1_P2: [
    { key: 'phase5', no: 5, label: 'P2 Development', hint: 'traditional 28 d · accelerated 6 d' },
    { key: 'phase6', no: 6, label: 'Ghost Phase', hint: '1 tour · FTO rides 3rd' },
    { key: 'phase7', no: 7, label: 'P2 Final Evaluation', hint: '1 tour · primary FTO scores' },
  ],
  /* EC → EMT (90-day cap) — the parallel EMT-candidate track; trains
     with an EMT/AEMT FTO throughout, and the partner tour doubles as
     the final evaluation (Guide v1.2 §4). */
  EC_EMT: [
    { key: 'phase0', no: 0, label: 'NEOP Academy', hint: 'Clinical Department · 4 days', noFto: true, tours: 4 },
    { key: 'phase1', no: 1, label: 'Operations Orientation', hint: '1 tour · EMT FTO', tours: 1 },
    { key: 'phase2', no: 2, label: 'Attendant Development', hint: '3 tours', tours: 3 },
    { key: 'phase3', no: 3, label: 'Partner Tour & Final Evaluation', hint: '1 tour · primary FTO scores', tours: 1 },
  ],
}

/* ── Published training-day counts (FTEP Program Guide v1.2 §4,
   Single-FTO Edition) ─────────────────────────────────────────────────
   One tour = TWO training days; only days scheduled WITH an FTO count
   toward a phase. Phase 0 (NEOP Academy) is classroom — no FTO, no
   schedule linkage. Accelerated P2 is the selective 10-day pathway. */

export interface PhaseDayStandard {
  min: number
  std: number
  max: number
}

export const FTEP_DAY_STANDARDS: Record<
  'P1C_P1' | 'P1_P2' | 'P1_P2_ACCEL' | 'EC_EMT',
  Record<string, PhaseDayStandard>
> = {
  P1C_P1: {
    phase1: { min: 2, std: 2, max: 4 },
    phase2: { min: 2, std: 4, max: 6 },
    phase3: { min: 4, std: 8, max: 12 },
    phase4: { min: 2, std: 2, max: 4 },
  },
  P1_P2: {
    phase5: { min: 24, std: 28, max: 46 },
    phase6: { min: 2, std: 2, max: 4 },
    phase7: { min: 2, std: 2, max: 4 },
  },
  P1_P2_ACCEL: {
    phase5: { min: 6, std: 6, max: 8 },
    phase6: { min: 2, std: 2, max: 2 },
    phase7: { min: 2, std: 2, max: 2 },
  },
  EC_EMT: {
    phase1: { min: 2, std: 2, max: 4 },
    phase2: { min: 4, std: 6, max: 10 },
    phase3: { min: 2, std: 2, max: 4 },
  },
}

/* ── Trainee Evaluation of FTO (paper form v1.0, 1:1) ─────────────────
   Completed at each phase transition · submitted to the CDO — not the
   FTO. Feedback reaches FTOs in aggregate and without attribution
   wherever possible. */

export const FTO_EVAL_AREAS: { no: number; label: string; hint: string }[] = [
  { no: 1, label: 'Teaching quality', hint: 'Explained the why, not just the what; used downtime for scenarios and teach-backs' },
  { no: 2, label: 'Feedback', hint: 'Timely, specific, and behavioral — I knew where I stood before the DOR was written' },
  { no: 3, label: 'Consistency & fairness', hint: 'Held me to the published standards — the same standards every day, no moving targets' },
  { no: 4, label: 'Protocol & clinical knowledge', hint: 'Modeled current WCEMS protocols and answered questions accurately or found the answer' },
  { no: 5, label: 'Professionalism', hint: 'Treated me, patients, families, and crews with respect; modeled the conduct expected of me' },
  { no: 6, label: 'Scenario & skill training', hint: 'Substituted quality scenarios when call volume was low; ran them fully, not passively' },
  { no: 7, label: 'Support & advocacy', hint: 'Invested in my success; created room to perform without abandoning oversight' },
  { no: 8, label: 'Communication of expectations', hint: "I understood each day's goal and how it connected to my phase requirements" },
]

export const FTO_EVAL_NARRATIVES: { key: string; label: string }[] = [
  { key: 'keepDoing', label: 'What should this FTO keep doing?' },
  { key: 'change', label: 'What should this FTO change or improve?' },
  { key: 'inconsistent', label: 'Was anything in your training inconsistent with the Program Guide or workbook? If so, what?' },
  { key: 'other', label: 'Anything else the Clinical Department should know?' },
]

export const FTO_EVAL_SCALE_NOTE =
  'Scale: 5 consistently exceptional · 4 above standard · 3 met the standard · 2 below standard · ' +
  '1 significant concern. Scores of 1 or 2 are most useful with a comment.'

export const FTO_EVAL_HOW_USED =
  'This evaluation goes to the Clinical Development Officer, who reviews it directly. Feedback ' +
  'reaches FTOs in aggregate and without attribution wherever possible; it informs FTO development ' +
  'and program improvement — it is not discipline, and honest feedback will never be held against a trainee.'

export interface FtoEvalPayload {
  ratings?: Record<string, { score?: number; comment?: string; label?: string }>
  narratives?: Record<string, string>
}

export type FtepKind = 'dor' | 'icr'

/** ICR form variant — 'bls' for EC (EMT-candidate) trainees. Absent or
 *  'als' = the original form, so pre-variant reports render unchanged. */
export type IcrVariant = 'als' | 'bls'

export function sectionsFor(kind: FtepKind, variant?: IcrVariant): FtepSection[] {
  if (kind === 'dor') return DOR_SECTIONS
  return variant === 'bls' ? ICR_SECTIONS_BLS : ICR_SECTIONS
}

export function allCategories(kind: FtepKind, variant?: IcrVariant): FtepCategory[] {
  return sectionsFor(kind, variant).flatMap((s) => s.categories)
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
  /** 'bls' = scored on the EMT-scope category set (EC trainees).
   *  Stamped at save; absent = the original ALS form. */
  icrVariant?: IcrVariant
  countsToward10?: boolean
  explanation?: string
  /** Optional FTO narrative — anything relevant to the call. */
  callNotes?: string
  /** The trainee's own words (both kinds) — typed at live review on the
   *  FTO's device, or added with their deferred signature on My
   *  Progress (ftep_sign_report stamps it into the payload). */
  traineeComment?: string
  /* Legacy-track call evals recorded manually from Jotform until the
     webhook lands — no ratings/signatures, just the count + context. */
  legacyManual?: boolean
  /** Which legacy credentialing rung this eval counts toward: 'P1'
   *  (working toward the P1 credential) or 'P2' (P1 → in-charge).
   *  Each rung requires its own 10 — evals never carry across.
   *  Missing on older rows = counts toward whatever rung the trainee
   *  is currently working. */
  legacyPhase?: 'P1' | 'P2'
  note?: string
  /** Clinical triage: why this ICR was excluded from the required 10
   *  (set alongside countsToward10=false from the Submissions inbox). */
  triageNote?: string
  /** Clinical triage (DOR): excluded from the record entirely — out of
   *  the rolling average, rideout counts, and scheduled-day matching
   *  (e.g. a duplicate or erroneous submission). Reason in triageNote. */
  excludedFromRecord?: boolean
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
  variant?: IcrVariant,
): number[] {
  if (!ratings) return []
  return allCategories(kind, variant)
    .filter((c) => {
      const r = ratings[String(c.no)]
      return r && typeof r.score === 'number' && r.score < 3 && !r.comment?.trim()
    })
    .map((c) => c.no)
}
