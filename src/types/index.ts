/* ─────────────────────────────────────────────────────────────────────
   Domain types — shared by mock JSON, composables, and components.
   ───────────────────────────────────────────────────────────────────── */

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
  /** Free-text credential / job title (Paramedic, EMT, Operations Director, …). */
  title: string | null
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
  title: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
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

