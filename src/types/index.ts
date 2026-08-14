/* ─────────────────────────────────────────────────────────────────────
   Domain types — shared by mock JSON, composables, and components.
   ───────────────────────────────────────────────────────────────────── */

export type Role = 'crew' | 'supervisor' | 'admin'
export type ShiftLetter = 'A' | 'B' | 'C'
export type EmploymentType = 'full_time' | 'part_time'
/** Distinguishes a real human account from a shared station/rig
 *  mailbox kiosk (medic###@…, s###@…). Kiosks get read-only
 *  treatment — see migration 0051. */
export type AccountType = 'person' | 'kiosk'

export interface AppUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  initials: string
  role: Role
  /** Free-text credential / job title (Paramedic, EMT, Operations Director, …). */
  title: string | null
  /** Employment classification — admin-only; separates FT from PT
   *  staff for audience filtering on Required Training, roster
   *  grouping, and Paycom imports. */
  employmentType: EmploymentType
  /** 'kiosk' for rig/station shared mailboxes — read-only experience.
   *  See migration 0051. Admin-only; auto-tagged on first sign-in for
   *  emails matching ^medic\d+@ or ^s\d+@. */
  accountType: AccountType
  shift: ShiftLetter | null
  station: string | null
  fuelNumber: string | null
  dateOfBirth: string | null
  showBirthday: boolean
  /** Self-editable phone for the Employee Directory. Free text, max 30
   *  chars. Null when the user hasn't entered one. */
  phone: string | null
  /** Self-editable opt-out for the Employee Directory page. Defaults
   *  true; users uncheck to hide themselves. Hidden users are still
   *  visible to admins via /admin/employees. */
  inDirectory: boolean
  /** Public URL of the user's profile photo (Supabase Storage). Null
   *  when not uploaded — the Avatar component falls back to initials. */
  photoUrl: string | null
  /** quick_links.id values (text[]) that the user wants to feature in
   *  the dashboard hero strip. Up to 4 entries; empty falls back to
   *  role-based defaults. */
  featuredQuickLinkIds: string[]
  /** True once the user taps "Don't show again" on the first-run
   *  complete-your-profile prompt. Persists across devices. */
  profilePromptDismissed: boolean
}

/* ── Required Training ─────────────────────────────────────────────
   Compliance training: admin posts a video that crew MUST watch and
   attest to. */

export type VideoSource = 'youtube' | 'cloudflare_stream' | 'direct' | 'sharepoint'

export interface RequiredTraining {
  id: string
  title: string
  description: string
  videoSource: VideoSource
  videoRef: string
  durationSeconds: number | null
  requiredBy: string | null
  /** Empty array = open to everyone. Non-empty narrows. */
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  audienceEmploymentTypes: EmploymentType[]
  attestationStatement: string
  /** Reserved for v1.1 quiz UI. */
  quiz: unknown | null
  /** When true, this required-training entry is also surfaced in the
   *  /training/recordings library (with a "Required" tag and a click
   *  that routes to the compliance flow). */
  showInLibrary: boolean
  active: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface RequiredTrainingOverride {
  id: string
  requiredTrainingId: string
  userId: string
  /** true = force-include even if not in audience filter;
   *  false = force-exclude even if in audience filter. */
  included: boolean
}

export interface RequiredTrainingCompletion {
  id: string
  requiredTrainingId: string
  userId: string
  startedAt: string
  completedAt: string | null
  signatureData: string | null
  signedMethod: 'self' | 'admin_marked'
  markedBy: string | null
  markedNote: string | null
  quizScore: number | null
  attestationSigned: boolean
  certificateStoragePath: string | null
  createdAt: string
  updatedAt: string
}

/* ── Policies ─────────────────────────────────────────────────────
   Document-based acknowledgement system (HCID policy, future
   handbook, HR policies, etc.). Mirrors Required Training's
   audience-filter pattern but content is a PDF and the user signs
   three attestation checkboxes after scrolling to the end. See
   migration 0053. */

export type PolicyCategory = 'clinical' | 'operational' | 'hr' | 'general'
export type PolicyReviewCycle = 'annual' | 'biennial' | 'as_needed'

export interface Policy {
  id: string
  title: string
  summary: string
  category: PolicyCategory
  /** Path within the `policy-documents` Supabase Storage bucket.
   *  Null until admin uploads a PDF for this policy. */
  documentStoragePath: string | null
  documentFilename: string | null
  /** Bumps on every replace-document admin action. Crew see
   *  re-prompt when their latest acknowledgement is for a prior
   *  version. */
  version: number
  effectiveDate: string | null
  reviewCycle: PolicyReviewCycle
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  audienceEmploymentTypes: EmploymentType[]
  attestationStatement: string
  active: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface PolicyAcknowledgement {
  id: string
  policyId: string
  userId: string
  policyVersionAtSigning: number
  acknowledgedAt: string
  signatureData: string | null
  signedMethod: 'self' | 'admin_marked'
  markedBy: string | null
  markedNote: string | null
}

export interface PolicyOverride {
  id: string
  policyId: string
  userId: string
  /** true = force-include, false = force-exclude. Wins over audience filter. */
  included: boolean
}

/* ── Stations ──────────────────────────────────────────────────────── */
export interface Station {
  id: string
  name: string
  address: string
  city: string
  phone: string
  mapUrl: string
  doorCode: string
  active: boolean
  doorCodeUpdatedAt: string | null
  doorCodeUpdatedBy: string | null
}

/* ── Hospitals ─────────────────────────────────────────────────────── */
export type TraumaLevel = 'I' | 'II' | 'III' | 'IV' | 'In Pursuit II' | 'N'
export type StrokeLevel = 'Comprehensive' | 'Primary' | 'N'

export interface Hospital {
  id: string
  name: string
  trauma: TraumaLevel
  stroke: StrokeLevel
  pciCapable: boolean
  maternalLevel: string | null
  nicuLevel: string | null
  isPediatric: boolean
  address: string
  mapUrl: string
  erDoorCode: string | null
  emsRoomCode: string | null
  noDoorCode: boolean
  notes: string | null
  codeEffectiveFrom: string | null
  active: boolean
  doorCodeUpdatedAt: string | null
  doorCodeUpdatedBy: string | null
}

/* ── Quick links ───────────────────────────────────────────────────── */
export interface QuickLink {
  id: string
  label: string
  sub: string | null
  url: string
  iconName: string
  category: string
  visibleTo: Role[]
  defaultSort: number
}

export interface UserLinkPref {
  linkId: string
  pinned: boolean
  hidden: boolean
  customSort: number | null
}

/* ── Code change log (stations + hospitals) ────────────────────────── */
export type CodeEntityType = 'station' | 'hospital'
export type CodeField = 'door' | 'er' | 'ems_room'

export interface CodeChange {
  id: string
  entityType: CodeEntityType
  entityId: string
  codeField: CodeField
  oldValue: string
  newValue: string
  changedBy: string
  changedAt: string
}

/* ── Admin staff + on-call + holidays ──────────────────────────────── */
export interface AdminStaff {
  id: string
  title: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  /** Lower numbers render first. Renumbered 0..N-1 on every reorder. */
  sortOrder: number
  active: boolean
}

export interface OnCallEntry {
  roleLabel: string
  name: string
  phone: string
  meta: string | null
}

export interface Holiday {
  date: string
  name: string
}

/* ── Call volume ───────────────────────────────────────────────────── */
export interface CallVolumeSummary {
  reportMonth: string
  totalCalls: number
  totalPatients: number
  totalTransports: number
  avgResponseSeconds: number
}

export interface CallVolumeUnit {
  reportMonth: string
  unitName: string
  runs: number
  percentage: number
  avgResponseSeconds: number
}

export interface CallVolumeZone {
  reportMonth: string
  zoneName: string
  calls: number
  percentage: number
}

/* ── Announcements + people ────────────────────────────────────────── */
export interface Announcement {
  id: string
  /** Short display date label derived client-side from publishedAt
   *  (e.g. "May 14"). Kept on the type for backward compat with the
   *  existing card markup; new code can format publishedAt directly. */
  date: string
  tag: string
  title: string
  body: string
  /** Optional Storage URL for an attached image (event flyer, etc.). */
  imageUrl: string | null
  authorName: string
  publishedAt: string
  /** Soft-archive flag. False = hidden from crew (RLS) but kept in the
   *  DB so admins can restore. Default true on insert. */
  active: boolean
}

export interface BirthdayEntry {
  name: string
  role: string
  shift: ShiftLetter | string
  date: string
}

export interface SpotlightEntry {
  name: string
  role: string
  tenure: string
  blurb: string
}

export interface TrainingEvent {
  id: string
  title: string
  date: string
  time: string
  filled: number
  total: number
  location: string
}


/* ── Clinical Development pipeline ─────────────────────────────────── */

/** FTEP ladder position. P3 is reachable as a phase value but progress
 *  math uses the 5-rung ladder (P3/FTO is a flag track, not a rung). */
export type PipelinePhase = 'NEOP' | 'FTR' | 'P1' | 'P2' | 'P3' | 'FinalRelease'

/** Which credentialing transition a gate row belongs to. P1_P2_LEGACY
 *  is the pre-FTEP-rebuild requirement set for P1s already mid-track. */
export type PipelineTransition = 'NEOP' | 'P1C_P1' | 'P1_P2' | 'P1_P2_LEGACY' | 'P2_P3' | 'AEMT'

export type GateStatus = 'pending' | 'complete' | 'na'

export interface PipelineRecord {
  id: string
  userId: string
  clearedPhase: PipelinePhase | null
  workingPhase: PipelinePhase | null
  workingStartedAt: string | null
  workingTargetAt: string | null
  /** Awaiting-clearance cohort — renders as a dashed "ghost" row. */
  pending: boolean
  pipActive: boolean
  pipStartedAt: string | null
  pipReason: string | null
  inP3Process: boolean
  inAemtUpgrade: boolean
  /** Pre-FTEP-rebuild P1→P2 requirements (call evals instead of
   *  DORs/ICRs). Set per person; new-program folks stay false. */
  legacyTrack: boolean
  /** Credential badge (P1C, P1, P2, FTO, ADV, EMT…). */
  level: string | null
  isFto: boolean
  ftoName: string | null
  certLevel: string | null
  txLicenseNumber: string | null
  txLicenseExpiresAt: string | null
  txJurisprudenceAt: string | null
  bloodbornePathogenAt: string | null
  /** Access is a held/not-held fact; the grant DATE is optional
   *  detail (credentialed staff predate date-keeping). */
  opIqAccess: boolean
  narcSafeAccess: boolean
  opIqGrantedAt: string | null
  narcSafeGrantedAt: string | null
  estP2ReadyAt: string | null
  coverageNote: string | null
  blockerNote: string | null
  notes: string | null
  updatedAt: string
}

export interface PipelineGateProgress {
  id: string
  recordId: string
  transition: PipelineTransition
  gateKey: string
  status: GateStatus
  value: string | null
  completedAt: string | null
  completedByName: string | null
  note: string | null
}

/** Pipeline record joined with roster identity for the board. */
export interface PipelinePerson {
  record: PipelineRecord
  userId: string
  fullName: string
  shift: ShiftLetter | string | null
  station: string | null
  title: string | null
  photoUrl: string | null
  active: boolean
}

/** Recurrence model for tracked compliance items. */
export type RequirementCycle = 'annual' | 'per_cert_cycle' | 'certification' | 'one_time'

export interface PipelineRequirement {
  id: string
  name: string
  cycle: RequirementCycle
  active: boolean
  sort: number
  notes: string | null
}

export interface PipelineRequirementCompletion {
  id: string
  requirementId: string
  userId: string
  completedAt: string
  /** Card classes carry the card's own expiration. */
  expiresAt: string | null
  source: string
  note: string | null
}
