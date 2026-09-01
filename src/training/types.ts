// ─── Identity (reused from the WCEMS intranet app_users model) ──────────

export type Role = 'crew' | 'supervisor' | 'admin'
export type ShiftLetter = 'A' | 'B' | 'C'

export interface AppUser {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  initials: string
  role: Role
  title: string | null
  station: string | null
}

// ─── Instructor allowlist (training-specific access control) ────────────

/** Catalog of disciplines an instructor can be authorized for. Phase 1
 *  seeds BLS / ACLS / PALS / LECTURE. Phase 2 will add Handtevy / EVOC /
 *  PHTLS / etc. via the admin UI, no schema change required. */
export type DisciplineCategory = 'aha_card' | 'inhouse_card' | 'lecture'

export interface Discipline {
  id: string
  code: string
  name: string
  category: DisciplineCategory
  usesAppCheckin: boolean
  wixServiceId: string | null
  wixScheduleId: string | null
  active: boolean
  sortOrder: number
}

/** An entry in the training-instructor allowlist. Email matches the
 *  signed-in Entra UPN. `disciplineCodes` is hydrated from the junction
 *  table for fast UI filtering. */
export interface Instructor {
  id: string
  email: string
  fullName: string
  instructorNumber: string | null
  isAdmin: boolean
  active: boolean
  /** Codes the instructor is authorized for (e.g. ['BLS','LECTURE']). */
  disciplineCodes: string[]
  /** Per-discipline card expiration (auto-fills the per-session field). */
  cardExpByCode: Record<string, string | null>
  createdAt: string
}

// ─── Training domain ────────────────────────────────────────────────────

export type SessionType = 'CardClass' | 'Lecture'
export type AttendanceMode = 'InPerson' | 'Virtual'
export type AttendanceStatus = 'CheckedIn' | 'Approved' | 'Pending'
export type OpenClosed = 'Open' | 'Closed'
export type SessionStatus = 'Active' | 'Closed' | 'Canceled'
export type CourseTemplate = 'BLS' | 'ACLS' | 'PALS'

/** A bookable Card Course in the catalog (replaces the SP "Courses"
 *  list + the COURSE_MAP in createsession.jsw). */
export interface TrainingCourse {
  id: string
  name: string
  defaultHours: string | null
  wixServiceId: string | null
  wixScheduleId: string | null
  active: boolean
  sortOrder: number
}

/** A created training session (replaces the SP "CourseSessions" list). */
export interface CourseSession {
  id: string
  sessionId: string
  sessionType: SessionType
  title: string
  classDate: string
  startTime: string
  endTime: string
  location: string
  cardCourseName: string
  lectureTitle: string
  dshsContentArea: string
  hoursAwarded: string
  maxSeats: number | null
  verificationPointsRequired: number | null
  primaryInstructorName: string
  primaryInstructorEmail: string
  primaryInstructorNumber: string
  primaryInstructorCardExp: string
  secondaryInstructorName: string
  secondaryInstructorEmail: string
  secondaryInstructorNumber: string
  secondaryInstructorCardExp: string
  tertiaryInstructorName: string
  tertiaryInstructorEmail: string
  tertiaryInstructorNumber: string
  tertiaryInstructorCardExp: string
  quaternaryInstructorName: string
  registrationType: 'Wix' | 'Internal' | ''
  registrationUrl: string
  status: SessionStatus
  checkInStatus: OpenClosed
  evalStatus: OpenClosed
  requireRegistration: boolean
  /** Lecture-only — true when the lecture accepts virtual (Teams) attendance. */
  virtualEnabled: boolean
  /** Lecture-only — Teams meeting URL surfaced on the success / confirmation pages. */
  teamsMeetingUrl: string
  checkInToken: string
  evalToken: string
  /** Lecture only — public token for the /quiz?t=... QR. */
  quizToken: string
  /** Lecture only — 'Open' once the instructor opens the quiz. */
  quizStatus: OpenClosed
  wixEventId: string | null
  wixServiceId: string | null
  wixScheduleId: string | null
  wixServiceName: string | null
  /** Lecture only — minimum % of issued engagement codes a virtual
   *  attendee must respond to in order to qualify for a CE certificate.
   *  Null falls back to ENGAGEMENT_DEFAULT_PCT in the UI. */
  engagementThresholdPct: number | null
  createdAt: string
}

/** A student check-in / registration row (replaces SP "Attendance"). */
export interface Attendee {
  id: string
  sessionId: string
  studentName: string
  studentEmail: string
  attendanceMode: AttendanceMode | ''
  /** Lecture-only — Paramedic / EMT / null. Captured at registration so
   *  the instructor can split rosters and the quiz page can match. */
  certLevel: CertLevel | null
  eCardEmail: string
  mailingAddress: string
  phone: string
  status: AttendanceStatus
  psaScore: number | null
  phase: 'registered' | 'checkedin'
  ecardIssuedAt: string | null
  /** Lecture-only — CE certificate issuance metadata. Populated when the
   *  instructor clicks "Award CE Credits" on the session controls page. */
  ceCertIssuedAt: string | null
  ceCertNumber: string | null
  ceCertPath: string | null
  /** Manual eval-credit override. When an eval submission's email
   *  doesn't match the attendee row (typed a different address on the
   *  eval form), the instructor flips this from the roster to credit
   *  them without a re-submission. Award CE Credits honors it. */
  evalCredited: boolean
  /** Manual quiz-pass override. Mirror of evalCredited for the quiz
   *  side — instructor credits the attendee as passed when the auto
   *  match (email + name) misses. */
  quizCredited: boolean
  /** Lecture-only — per-attendee CE hours override. Falls back to
   *  course_sessions.hoursAwarded when null. Used when someone leaves
   *  early or attends a partial session (e.g., Virtual attendees skip
   *  the hands-on portion). */
  ceHoursOverride: string | null
  createdAt: string
}

/** A row surfaced on the Dashboard's Pending eCards tile — a checked-in
 *  card-class student who hasn't been marked as having received their
 *  eCard yet. Carries enough session context to act on without a
 *  second lookup. */
export interface PendingEcard {
  id: string
  sessionId: string
  studentName: string
  studentEmail: string
  eCardEmail: string
  course: string
  classDate: string | null
  primaryInstructorName: string
  createdAt: string
}

/** A submitted evaluation (replaces SP "Evals"). The AHA answer set is
 *  stored as a flat record so the PDF mapper's pickValue() fallbacks
 *  keep working unchanged. */
export interface EvalRecord {
  id: string
  sessionId: string
  studentName: string
  studentEmail: string
  title: string
  courseType: CourseTemplate
  answers: Record<string, string>
  createdAt: string
}

/** An archived roster / evaluation / exam / CE file in the
 *  training-archives bucket. Exam + CE files live under
 *  `{sessionId}/{Exam|CE}/{safeEmail}/...`, so we also surface the
 *  studentEmail (parsed from the path) for grouping in the Archive view. */
export interface ArchiveFile {
  recordType: 'Roster' | 'Evaluation' | 'Exam' | 'CE'
  fileName: string
  path: string
  createdAt: string
  signedUrl: string
  studentEmail?: string
}

// ─── Quizzes (lecture only, optional, per cert level) ──────────────────

export type CertLevel = 'Paramedic' | 'EMT'

export interface QuizQuestion {
  id: string
  prompt: string
  options: string[]
  /** index into options[] */
  correctIndex: number
  /** Optional plain-text explanation shown to the student after submit. */
  rationale: string
  sortOrder: number
}

export interface LectureQuiz {
  id: string
  courseSessionId: string
  certLevel: CertLevel
  passingPct: number
  /** Max attempts a student may take this quiz. 0 = unlimited. */
  attemptsAllowed: number
  status: OpenClosed
  questions: QuizQuestion[]
}

export interface QuizSubmission {
  id: string
  quizId: string
  sessionId: string
  studentName: string
  studentEmail: string
  answers: number[]
  scorePct: number
  passed: boolean
  attemptsUsed: number
  submittedAt: string
}

// ─── Training pipeline (W1: employees + phases + tests + files) ───────

export type EmployeeRole = 'EMT' | 'AEMT' | 'Paramedic'
/** Ordered phase chain. P3 is an OPTIONAL add-on after FinalRelease
 *  for senior paramedics with ride-up supervisor capability — tracked
 *  via the `inP3Process` flag on the employee, not as a chain step. */
export type EmployeePhase =
  | 'NEOP'
  | 'FTR'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'FinalRelease'
export type PhaseHistoryPhase = EmployeePhase
export type PhaseEndReason = 'Cleared' | 'Failed' | 'Reset' | 'Other'
export type EmployeeFileType =
  | 'PhaseTransition'
  | 'FTOEval'
  | 'Megacode'
  | 'ProtocolTest'
  | 'SkillSheet'
  | 'PIP'
  | 'Recommendation'
  | 'ALSCallEval'
  | 'Other'

/** A row in `training_employees`. Joined with `app_users` for the
 *  human-readable name + email + photo. */
export interface TrainingEmployee {
  id: string
  appUserId: string
  fullName: string
  email: string
  photoUrl: string | null
  role: EmployeeRole
  clearedPhase: EmployeePhase
  workingPhase: EmployeePhase | null
  workingStartedAt: string | null
  workingTargetAt: string | null
  hireDate: string | null
  pipActive: boolean
  pipStartedAt: string | null
  pipEndedAt: string | null
  pipReason: string | null
  inP3Process: boolean
  p3StartedAt: string | null
  p3TargetAt: string | null
  /** True when this EMT is currently going through AEMT clearance
   *  (they got their state cert; now need WCEMS sign-off). Parallel
   *  to inP3Process. Cleared by flipping role EMT → AEMT + unsetting
   *  the flag. */
  inAemtUpgrade: boolean
  aemtUpgradeStartedAt: string | null
  aemtUpgradeTargetAt: string | null
  opIqGrantedAt: string | null
  narcSafeGrantedAt: string | null
  bloodbornePathogenCompletedAt: string | null
  jurisprudenceCompletedAt: string | null
  /** Texas DSHS EMS certification number. Every certified field
   *  employee has one. */
  txLicenseNumber: string | null
  /** Current TX cert expiration date (YYYY-MM-DD). */
  txLicenseExpiresAt: string | null
  /** Start of the current 4-year TX recert cycle. Stored explicitly so
   *  the per-person Jurisprudence due date doesn't drift across renewals.
   *  When backfilled from license expiration, this is expires - 4 years. */
  txCycleStartedAt: string | null
  /** Last time the Jurisprudence exam was completed. TX requires it once
   *  per 4-year cycle, so this is "still current" iff this is on or
   *  after `txCycleStartedAt`. */
  txJurisprudenceCompletedAt: string | null
  /** NREMT cert number — nullable; some paramedics/AEMTs also hold
   *  National Registry on top of TX state cert. */
  nremtNumber: string | null
  /** NREMT cert expiration date (2-year cycle). */
  nremtExpiresAt: string | null
  notes: string | null
  /** Soft-delete flag. False = former employee — kept for historical
   *  training records but hidden from default rosters. */
  active: boolean
  /** When the row was marked inactive. Null when active. */
  deactivatedAt: string | null
  /** Free-text reason captured on deactivation. */
  deactivatedReason: string | null
  /** ALS call evaluations on file for this attendee. Only populated by
   *  loadAll/loadOne via a separate count query — not in the DB row. */
  alsCallEvalCount: number
  createdAt: string
  updatedAt: string
}

/** True when the employee owes a TX Jurisprudence exam for the current
 *  cycle — used to flag the licensure card + dashboard. */
export function needsJurisprudence(e: {
  txCycleStartedAt: string | null
  txJurisprudenceCompletedAt: string | null
}): boolean {
  if (!e.txCycleStartedAt) return false
  if (!e.txJurisprudenceCompletedAt) return true
  return e.txJurisprudenceCompletedAt < e.txCycleStartedAt
}

/** Target P2 attendees must hit before promotion. From Heather Fojt's
 *  6/24 personnel-training summary: P2 trainees complete 10 ALS call
 *  evaluations during their accelerated P2 shifts. */
export const ALS_CALL_EVALS_REQUIRED = 10

export interface TrainingPhaseHistory {
  id: string
  employeeId: string
  phase: PhaseHistoryPhase
  workingStartedAt: string | null
  workingTargetAt: string | null
  clearedAt: string | null
  endedReason: PhaseEndReason | null
  transitionedByUserId: string | null
  notes: string | null
  createdAt: string
}

export interface TrainingEmployeeFile {
  id: string
  employeeId: string
  phaseId: string | null
  fileType: EmployeeFileType
  storagePath: string
  fileName: string
  signedUrl?: string
  uploadedByUserId: string | null
  notes: string | null
  createdAt: string
}

export interface TrainingTestQuestion {
  prompt: string
  options: string[]
  /** When true, the question is "select all that apply" — grade against
   *  `correctIndices` (set equality) and render checkbox inputs. When
   *  false (default), grade against `correctIndex` and render radios. */
  multiSelect: boolean
  /** Index of the correct option when `multiSelect` is false. Unused
   *  when `multiSelect` is true (kept on the object for type uniformity
   *  but not persisted in that case). */
  correctIndex: number
  /** Set of correct option indices when `multiSelect` is true. Order is
   *  not significant — grading compares as a set. */
  correctIndices: number[]
  rationale: string
  sortOrder: number
  needsReview?: boolean
  /** Optional inline image rendered above the prompt. URL is either a
   *  Supabase Storage public URL (training-test-images bucket) or a
   *  repo-relative path like /test-images/p1/foo.jpeg served by
   *  Cloudflare Pages. */
  imageUrl?: string | null
}

export interface TrainingTestDefinition {
  id: string
  slug: string
  name: string
  description: string | null
  passingPct: number
  attemptsAllowed: number
  questions: TrainingTestQuestion[]
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface TrainingEmployeeTestAssignment {
  id: string
  employeeId: string
  testId: string
  testSlug?: string
  testName?: string
  assignedAt: string
  assignedByUserId: string | null
  dueAt: string | null
  notes: string | null
  completedAt: string | null
}

export interface TrainingEmployeeTest {
  id: string
  employeeId: string
  testId: string
  testSlug?: string
  testName?: string
  attemptNumber: number
  scorePct: number
  correctCount: number
  totalCount: number
  passed: boolean
  /** Per-question answer. number for single-select, number[] for
   *  multi-select. Order matches the test definition's questions array. */
  answers: (number | number[])[]
  evaluatorUserId: string | null
  notes: string | null
  submittedAt: string
}

// ─── Engagement codes (lecture-only, virtual attendee gating) ──────────

/** A short numeric code issued by the instructor mid-lecture. Virtual
 *  attendees must enter the code on /engage to attest presence. */
export interface EngagementCode {
  id: string
  sessionId: string
  code: string
  expiresAt: string
  createdAt: string
}

/** A response from a (virtual) attendee against an issued code. */
export interface EngagementResponse {
  id: string
  codeId: string
  sessionId: string
  attendeeEmail: string
  attendeeName: string | null
  submittedAt: string
}

/** Shape returned to the public check-in / eval / register pages by the
 *  `training-public` Edge Function — only what a student needs to see. */
export interface PublicSession {
  sessionId: string
  sessionType: SessionType
  title: string
  cardCourseName: string
  lectureTitle: string
  classDate: string
  startTime: string
  endTime: string
  location: string
  hoursAwarded: string
  dshsContentArea: string
  status: SessionStatus
  checkInStatus: OpenClosed
  evalStatus: OpenClosed
  registrationType: 'Wix' | 'Internal' | ''
  registrationUrl: string
  maxSeats: number | null
  registeredCount: number
  primaryInstructorName: string
  secondaryInstructorName: string
  tertiaryInstructorName: string
  quaternaryInstructorName: string
  /** Lecture only — whether registrants may join via Teams. */
  virtualEnabled: boolean
  /** Lecture + virtual — Teams meeting URL surfaced on the success page. */
  teamsMeetingUrl: string
}
