import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Scheduling module data layer (Aladtec replacement).
 *
 * Architecture: the schedule is GENERATED, not stored. The effective-dated
 * rotation template (sched_rotation_assignments) plus the platoon pattern
 * (B,B,C,C,A,A anchored 2026-04-06) produce every day's default crew.
 * sched_entries stores only DEVIATIONS — time off, pickups, trades, open
 * seats, extra hours, events, students. dayModel() overlays entries on the
 * generated base, so there is no materializer job to drift out of sync.
 *
 * Entry overlay semantics:
 *   - An entry with (seat_id, work_date) REPLACES the rotation occupant for
 *     that seat that day. Several timed entries on one seat = a split.
 *     user_id null + status 'open' = open seat.
 *   - kind 'timeoff' + status 'off' rows (seat_id kept for context) record
 *     the absent person's hours off for reports; they never render a seat row.
 *   - kind 'extra' | 'student' | 'event' rows attach to a unit (unit_id) as
 *     additional rows below the unit's seats.
 */

// ── types ────────────────────────────────────────────────────────────

export type Platoon = 'A' | 'B' | 'C'
export type SchedLevel =
  | 'global_admin'
  | 'scheduler'
  | 'supervisor'
  | 'hr'
  | 'view_only'
  | 'member'
  | 'none'

export interface SchedUnit {
  id: string
  code: string
  label: string
  station: string
  sortOrder: number
  active: boolean
  /** Custom repeating day pattern of platoon letters ('' = unit not
   *  staffed that day); null = agency default 48/96. */
  rotationPattern: string[] | null
  rotationAnchor: string | null
  /** Daily shift window 'HH:MM' for rotation coverage; null = the
   *  standard 06:00 → 06:00 24-hour shift. */
  shiftStart: string | null
  shiftEnd: string | null
}

export interface SchedSeat {
  id: string
  unitId: string
  label: string
  qualRule: string
  sortOrder: number
  active: boolean
}

export interface RotationAssignment {
  id: string
  seatId: string
  platoon: Platoon
  userId: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

export interface SchedEntry {
  id: string
  workDate: string
  seatId: string | null
  userId: string | null
  startAt: string
  endAt: string
  kind: string
  status: string
  offType: string | null
  timeType: string
  eventId: string | null
  studentProgram: string | null
  unitId: string | null
  note: string | null
  sourceRequest: string | null
}

export interface SchedRequest {
  id: string
  type: 'pickup' | 'trade' | 'giveaway' | 'time_off' | 'extra_hours' | 'discrepancy'
  status: 'pending' | 'partner_accepted' | 'approved' | 'denied' | 'cancelled'
  requesterId: string
  counterpartyId: string | null
  entryId: string | null
  counterEntryId: string | null
  counterSeatId: string | null
  counterWorkDate: string | null
  counterStartAt: string | null
  counterEndAt: string | null
  seatId: string | null
  workDate: string | null
  startAt: string | null
  endAt: string | null
  offType: string | null
  timeType: string | null
  unitCode: string | null
  positionLabel: string | null
  comments: string | null
  warnings: unknown[]
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

export interface SchedPerson {
  id: string
  fullName: string
  shift: string | null
  role: string
  credential: string | null
  /** What the credential resolves to with no manual row (role / pipeline / title). */
  credentialAuto: string | null
  credentialSource: 'manual' | 'role' | 'pipeline' | 'title' | null
  title: string | null
  email: string | null
  phone: string | null
  paycomCode: string | null
  employmentType: string | null
  hireDate?: string | null
  /** manual accrual-rate overrides (HR) — null = automatic */
  vacRateOverride?: number | null
  sickRateOverride?: number | null
  /** false = deactivated on the roster (quit/terminated). Kept in
   *  allPeople so past schedule days and payroll still show the name;
   *  excluded from `people` (pickers) and the Members tab. */
  active: boolean
}

export interface TradeOffer {
  id: string
  requestId: string
  userId: string
  offerSeatId: string | null
  offerWorkDate: string | null
  offerStartAt: string | null
  offerEndAt: string | null
  note: string | null
  status: string
}

export interface MemberSettings {
  userId: string
  qualOverrides: Record<string, 'allow' | 'deny'>
  unitExclusions: string[]
  notify: Record<string, unknown>
  smsOptIn: boolean
  /** Number texts go to — entered on the same form as the consent
   *  checkbox (A2P requirement); prefilled from the roster phone. */
  smsPhone: string | null
  /** Personal shift-highlight color (CSS color string); null = default gold. */
  highlightColor: string | null
}

/** Message types × channels for the per-member notification matrix
 *  (Aladtec's My Requests / My Alerts grids). Stored in
 *  sched_member_settings.notify as {key: {push,email,sms}} — a missing
 *  key or channel means ON. The notifications/page-out build consumes
 *  these; until then the matrix records preferences ahead of delivery. */
export const NOTIFY_TYPES: { key: string; label: string; editorOnly?: boolean; noSms?: boolean }[] = [
  { key: 'request_decision', label: 'A request of mine is approved or denied' },
  { key: 'schedule_change', label: 'My schedule is changed by a scheduler' },
  { key: 'open_shift', label: 'Open shifts & page-outs' },
  { key: 'trade_activity', label: 'Trades — offers and claims on my postings' },
  { key: 'reminders', label: 'Shift reminders' },
  /* Verification prompts NEVER text — push + email only (Justin,
     2026-09-28: routine nags would run up Twilio). The edge function
     hard-disables the SMS lane for these regardless of matrix state. */
  { key: 'verify', label: 'Time verification — end of shift & pay period', noSms: true },
  { key: 'announcements', label: 'Announcements from the scheduler' },
  { key: 'approvals', label: 'A request needs approval', editorOnly: true },
]

export type NotifyChannel = 'push' | 'email' | 'sms'

export const NOTIFY_CHANNELS: { key: NotifyChannel; label: string }[] = [
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'Text' },
]

/** Read one cell of the notify matrix — absent means ON. */
export function notifyOn(
  notify: Record<string, unknown>,
  type: string,
  ch: NotifyChannel,
): boolean {
  const t = notify?.[type] as Record<string, unknown> | undefined
  return t?.[ch] !== false
}

export interface DayNote {
  id: string
  onDate: string
  unitId: string | null
  note: string
  includeInReminders: boolean
}

export interface Availability {
  id: string
  userId: string
  onDate: string
  startAt: string | null
  endAt: string | null
  reason: string | null
}

/** One rendered row on a seat (regular or split segment). */
export interface SeatRow {
  entryId: string | null
  userId: string | null
  name: string
  credential: string | null
  start: string // 'HHmm' display
  end: string
  kind: string // 'rotation' | 'pickup' | ...
  open: boolean
  isRotation: boolean // circled-R marker: on regular rotation
  note: string | null // free-text note (students carry theirs here)
  posLabel?: string | null // rider rows: the extra seat's position label
}

export interface SeatModel {
  seat: SchedSeat
  rows: SeatRow[]
}

export interface UnitModel {
  unit: SchedUnit
  seats: SeatModel[]
  extras: SeatRow[] // extra hours / students attached to this unit
  notes: DayNote[]
}

export interface SchedEventRec {
  id: string
  label: string
  onDate: string
  startTime: string
  endTime: string
  notes: string | null
  location: string | null
  doubleTime: boolean
}

/** One special event on a day: its own box under the set schedule. */
export interface DayEventBox {
  label: string
  eventId: string | null
  start: string | null // 'HHmm' when known
  end: string | null
  notes: string | null // hover detail set when the event was created
  location: string | null // where the event happens (Aladtec-style detail)
  doubleTime: boolean // staffed events default to double time
  rows: SeatRow[] // assigned staff + open event seats
}

/** Row in a labeled day section (Extra Hours / Time Off / Trades). */
export interface LabeledRow {
  entryId: string
  userId: string | null
  name: string
  credential: string | null
  start: string
  end: string
  sub: string // second line: 'M272 / Paramedic', 'Vacation Time', 'For X'
  /** the seat a time-off entry vacated — lets boards open the person
   *  editor straight from the Time Off box (Justin, 2026-09-24) */
  seatId?: string | null
  /** raw off_type for time-off rows — the edit drawer preselects it */
  offType?: string | null
}

/** A request awaiting decision, surfaced on its work date. */
export interface PendingRow {
  id: string
  type: string
  userId: string | null // whose schedule this side of the request affects
  name: string
  credential: string | null
  start: string
  end: string
  sub: string // 'Pickup · M211 Paramedic · pending approval'
}

export interface DayModel {
  dateIso: string
  platoon: Platoon
  units: UnitModel[]
  events: DayEventBox[]
  extraHours: LabeledRow[]
  timeOff: LabeledRow[]
  trades: LabeledRow[]
  pending: PendingRow[] // undecided requests targeting this date
  unattached: SeatRow[] // students with no unit
  notes: DayNote[] // day-level notes (no unit)
  openCount: number
}

// ── rotation math (Central Time, mirrors useShift) ───────────────────

const ROT_ANCHOR = '2026-04-06'
const ROT_SEQ: Platoon[] = ['B', 'B', 'C', 'C', 'A', 'A']

function daysBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00`)
  const b = new Date(`${bIso}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Which platoon starts its 24-hour work date at 0600 on this date
 *  under the AGENCY default 48/96 rotation. */
export function platoonFor(dateIso: string): Platoon {
  const d = daysBetweenIso(ROT_ANCHOR, dateIso)
  return ROT_SEQ[((d % 6) + 6) % 6]
}

/** Which platoon works this unit on this date — the unit's own
 *  repeating pattern when it has one (null = not staffed that day),
 *  otherwise the agency default. */
export function unitPlatoonFor(unit: SchedUnit | undefined | null, dateIso: string): Platoon | null {
  if (!unit || !unit.rotationPattern || unit.rotationPattern.length === 0) {
    return platoonFor(dateIso)
  }
  const anchor = unit.rotationAnchor ?? ROT_ANCHOR
  const len = unit.rotationPattern.length
  const d = daysBetweenIso(anchor, dateIso)
  const tok = (unit.rotationPattern[((d % len) + len) % len] ?? '').toUpperCase()
  return tok === 'A' || tok === 'B' || tok === 'C' ? (tok as Platoon) : null
}

export function todayCentralIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Chicago',
  }).format(new Date())
  return parts // en-CA gives YYYY-MM-DD
}

export function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ── pay periods (14 days anchored 2026-09-01) ────────────────────────

// Sunday–Saturday biweekly periods: Aug 30 – Sep 12, Sep 13 – 26, …
const PAY_ANCHOR = '2026-08-30'
const PAY_DAYS = 14

export interface PayPeriod {
  start: string
  end: string // inclusive last date
  label: string
}

export function payPeriodFor(dateIso: string): PayPeriod {
  const diff = daysBetweenIso(PAY_ANCHOR, dateIso)
  const idx = Math.floor(diff / PAY_DAYS)
  const start = addDaysIso(PAY_ANCHOR, idx * PAY_DAYS)
  const end = addDaysIso(start, PAY_DAYS - 1)
  return { start, end, label: periodLabel(start, end) }
}

/** Payday: checks land PAYDAY_LAG_DAYS after a period closes (Sat end
 *  + 6 → the following Friday, every other week on this grid). The
 *  boards mark these dates with a gold $ chip. */
export function isPaydayIso(dateIso: string): boolean {
  const diff = daysBetweenIso(PAY_ANCHOR, dateIso)
  const paydayOffset = (PAY_DAYS - 1 + PAYDAY_LAG_DAYS) % PAY_DAYS
  return ((diff % PAY_DAYS) + PAY_DAYS) % PAY_DAYS === paydayOffset
}

export function payPeriodList(centerIso: string, before = 6, after = 3): PayPeriod[] {
  const current = payPeriodFor(centerIso)
  const list: PayPeriod[] = []
  for (let i = -before; i <= after; i++) {
    const start = addDaysIso(current.start, i * PAY_DAYS)
    const end = addDaysIso(start, PAY_DAYS - 1)
    list.push({ start, end, label: periodLabel(start, end) })
  }
  return list
}

function periodLabel(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const yr = end.slice(0, 4)
  return `${fmt(start)} – ${fmt(end)}, ${yr}`
}

// ── observed paid holidays (handbook 5.5, eff. 04-17-2017) ───────────
// A holiday runs 0600 the day of until 0600 the next day — exactly one
// work date — and pays double time (holiday earning code in Setup).

/** Easter Sunday (Anonymous Gregorian computus). */
function easterSundayIso(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nthWeekdayIso(year: number, monthIdx: number, weekday: number, nth: number): string {
  const first = new Date(year, monthIdx, 1)
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface HolidayRec {
  dateIso: string
  name: string
}

export function holidaysForYear(year: number): HolidayRec[] {
  return [
    { dateIso: `${year}-01-01`, name: "New Year's Day" },
    { dateIso: easterSundayIso(year), name: 'Easter Sunday' },
    { dateIso: `${year}-07-04`, name: 'Independence Day' },
    { dateIso: nthWeekdayIso(year, 8, 1, 1), name: 'Labor Day' }, // 1st Mon of Sep
    { dateIso: nthWeekdayIso(year, 10, 4, 4), name: 'Thanksgiving Day' }, // 4th Thu of Nov
    { dateIso: `${year}-12-24`, name: 'Christmas Eve' },
    { dateIso: `${year}-12-25`, name: 'Christmas Day' },
    { dateIso: `${year}-12-31`, name: "New Year's Eve" },
  ].sort((a, b) => a.dateIso.localeCompare(b.dateIso))
}

const holidayCache = new Map<number, Map<string, string>>()

/** The holiday observed on this WORK DATE, or null. */
export function holidayName(dateIso: string): string | null {
  const year = Number(dateIso.slice(0, 4))
  if (!holidayCache.has(year)) {
    holidayCache.set(year, new Map(holidaysForYear(year).map((h) => [h.dateIso, h.name])))
  }
  return holidayCache.get(year)!.get(dateIso) ?? null
}

// ── display helpers ──────────────────────────────────────────────────

/** '2026-09-12T11:00:00+00:00' → '0600' in Central time. */
export function hhmm(ts: string): string {
  const d = new Date(ts)
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Chicago',
  }).format(d)
  return parts.replace(':', '')
}

/** Build a Central-time timestamp for date + 'HH:mm'. Central is UTC-5 (CDT)
 *  or UTC-6 (CST); resolve by probing the offset for that date. */
export function centralTs(dateIso: string, time: string): string {
  // Probe: what UTC instant renders as dateIso T time in Chicago?
  for (const off of ['-05:00', '-06:00']) {
    const candidate = new Date(`${dateIso}T${time}:00${off}`)
    const check = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Chicago',
    })
      .format(candidate)
      .replace(', ', 'T')
    if (check === `${dateIso}T${time}`) return candidate.toISOString()
  }
  return new Date(`${dateIso}T${time}:00-05:00`).toISOString()
}

export function hoursBetween(startTs: string, endTs: string): number {
  return (new Date(endTs).getTime() - new Date(startTs).getTime()) / 3_600_000
}

/** Epoch millis for comparisons. NEVER compare timestamp STRINGS from
 *  mixed sources: PostgREST returns '+00:00' while toISOString() gives
 *  '.000Z', and at the same instant '+00:00' < '.000Z' lexically. */
export function tsMs(ts: string): number {
  return new Date(ts).getTime()
}

const MIN_SEG_MS = 60_000 // ignore sub-minute slivers

// ── module state (singleton across views) ────────────────────────────

const units = ref<SchedUnit[]>([])
const seats = ref<SchedSeat[]>([])
const rotation = ref<RotationAssignment[]>([])
const entries = ref<SchedEntry[]>([]) // loaded range
const requests = ref<SchedRequest[]>([])
const availability = ref<Availability[]>([])
const dayNotes = ref<DayNote[]>([])
const schedEvents = ref<SchedEventRec[]>([])
const people = ref<SchedPerson[]>([])
/** Full roster incl. members hidden from scheduling (Members tab needs
 *  them so a hide can be undone). Everything else uses `people`. */
const allPeople = ref<SchedPerson[]>([])
const settings = ref<Record<string, Record<string, unknown>>>({})
/** The signed-in member's personal shift-highlight color (null = gold). */
const myHighlight = ref<string | null>(null)

/** Roster sort key: surname = everything AFTER the first name, so
 *  multi-word surnames file where people look ("Justin St John" under
 *  St John, not John). Exported — every people list sorts with this. */
export function personSortKey(full: string): string {
  const parts = full.trim().split(/\s+/)
  const surname = parts.length > 1 ? parts.slice(1).join(' ') : full
  return `${surname.toLowerCase()} ${full.toLowerCase()}`
}

function rosterHiddenIds(): Set<string> {
  const v = (settings.value['roster'] ?? {}) as { exclude_user_ids?: unknown }
  const ids = Array.isArray(v.exclude_user_ids) ? (v.exclude_user_ids as unknown[]) : []
  return new Set(ids.filter((x): x is string => typeof x === 'string'))
}

/** Re-derive the visible roster from allPeople + the hide list — called
 *  by loadCore and after the Members tab edits the hide list. */
function applyRosterVisibility(): void {
  const hidden = rosterHiddenIds()
  people.value = allPeople.value.filter((p) => p.active && !hidden.has(p.id))
}
const level = ref<SchedLevel>('member')
const loaded = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const rangeStart = ref('')
const rangeEnd = ref('')

/* Display lookup — built from the FULL roster (inactive + hidden
   members included) so names on past days, history, and payroll always
   resolve. Anything assignable lists from `people` instead. */
const personById = computed(() => {
  const m = new Map<string, SchedPerson>()
  for (const p of allPeople.value) m.set(p.id, p)
  return m
})

function displayName(userId: string | null): { name: string; credential: string | null } {
  if (!userId) return { name: '', credential: null }
  const p = personById.value.get(userId)
  return p ? { name: p.fullName, credential: p.credential } : { name: 'Unknown', credential: null }
}

// ── audit trail ──────────────────────────────────────────────────────

export interface AuditRow {
  id: number
  at: string
  actorId: string | null
  action: string
  summary: string
}

/** Fire-and-forget action record — never blocks or fails the calling
 *  mutation; a failed write only logs to the console. Editors read the
 *  log on the Setup tab. */
function audit(
  action: string,
  summary: string,
  opts?: { entity?: string; entityId?: string | null; detail?: Record<string, unknown> },
): void {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  const actorId = auth.appUser?.id ?? null
  if (!actorId) return
  void supabase
    .from('sched_audit')
    .insert({
      actor_id: actorId,
      action,
      entity: opts?.entity ?? 'schedule',
      entity_id: opts?.entityId ?? null,
      detail: { summary, ...(opts?.detail ?? {}) },
    })
    .then(({ error }) => {
      if (error) console.warn('[sched] audit write failed:', error.message)
    })
}

/** Editors: page through the action log, newest first. */
async function fetchAuditLog(beforeId?: number): Promise<AuditRow[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  let q = supabase
    .from('sched_audit')
    .select('id, at, actor_id, action, detail')
    .order('id', { ascending: false })
    .limit(80)
  if (beforeId !== undefined) q = q.lt('id', beforeId)
  const res = await q
  if (res.error) return []
  return (res.data ?? []).map((r) => ({
    id: r.id as number,
    at: r.at as string,
    actorId: (r.actor_id as string | null) ?? null,
    action: r.action as string,
    summary: (r.detail as { summary?: string } | null)?.summary ?? (r.action as string),
  }))
}

/** Fire-and-forget call to the sched-notify edge function — push /
 *  email / text fan-out with recipients resolved server-side against
 *  each member's notification matrix. Never blocks the mutation. */
function notify(kind: string, payload: Record<string, unknown>): void {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  void supabase.functions
    .invoke('sched-notify', { body: { kind, ...payload } })
    .then(({ error }) => {
      if (error) console.warn('[sched] notify failed:', error.message)
    })
    .catch((e: unknown) => console.warn('[sched] notify failed:', e))
}

// ── loading ──────────────────────────────────────────────────────────

async function loadCore(): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    // Dev stub: anon can't read the RLS'd sched_* tables, so seed the
    // real unit/seat layout locally. Rotation stays empty (all open).
    level.value = auth.isAdmin ? 'global_admin' : auth.isSupervisor ? 'supervisor' : 'member'
    if (units.value.length === 0) seedDevStub()
    loaded.value = true
    return
  }
  // Post any missing pay-period accruals / anniversary write-offs
  // (idempotent, SECURITY DEFINER) — balances stay current on any load.
  void supabase.rpc('sched_leave_catchup')
  const [uRes, sRes, rRes, pRes, lvlRes, cRes, setRes, pipeRes, hlRes] = await Promise.all([
    supabase.from('sched_units').select('*').order('sort_order'),
    supabase.from('sched_seats').select('*').order('sort_order'),
    supabase.from('sched_rotation_assignments').select('*'),
    supabase
      .from('app_users')
      /* Inactive (quit/terminated) members load too: their PAST shifts
         and payroll rows must keep showing the name — dropping them
         here rendered "Unknown" (Tara Roth, 2026-09-20). Pickers and
         the Members tab filter on .active instead. */
      .select('id, full_name, shift, role, title, email, phone, account_type, active, employment_type, paycom_employee_code, hire_date, vac_rate_override, sick_rate_override')
      .eq('account_type', 'person')
      .order('full_name'),
    supabase.rpc('sched_level'),
    supabase.from('sched_credentials').select('user_id, credential'),
    supabase.from('sched_settings').select('key, value'),
    supabase.rpc('sched_pipeline_credentials'),
    supabase
      .from('sched_member_settings')
      .select('highlight_color')
      .eq('user_id', auth.appUser?.id ?? '')
      .maybeSingle(),
  ])
  const err = uRes.error ?? sRes.error ?? rRes.error ?? pRes.error ?? lvlRes.error
  if (err) {
    loadError.value = err.message
    return
  }
  units.value = (uRes.data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    station: r.station,
    sortOrder: r.sort_order,
    active: r.active,
    rotationPattern: r.rotation_pattern ?? null,
    rotationAnchor: r.rotation_anchor ?? null,
    shiftStart: r.shift_start ? String(r.shift_start).slice(0, 5) : null,
    shiftEnd: r.shift_end ? String(r.shift_end).slice(0, 5) : null,
  }))
  seats.value = (sRes.data ?? []).map((r) => ({
    id: r.id,
    unitId: r.unit_id,
    label: r.label,
    qualRule: r.qual_rule,
    sortOrder: r.sort_order,
    active: r.active,
  }))
  rotation.value = (rRes.data ?? []).map((r) => ({
    id: r.id,
    seatId: r.seat_id,
    platoon: r.platoon,
    userId: r.user_id,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }))
  const credByUser = new Map<string, string>(
    ((cRes.data ?? []) as { user_id: string; credential: string }[]).map((r) => [r.user_id, r.credential]),
  )
  // Pipeline-derived credentials (security-definer fn — same view for
  // crew and editors). A failed read just falls back to title defaults.
  const pipeCredByUser = new Map<string, string>()
  if (!pipeRes.error) {
    for (const r of (pipeRes.data ?? []) as { user_id: string; credential: string | null }[]) {
      if (r.credential) pipeCredByUser.set(r.user_id, r.credential)
    }
  }
  const mapped = (pRes.data ?? []).map((r) => {
    const explicit = credByUser.get(r.id) ?? null
    const pipeline = pipeCredByUser.get(r.id) ?? null
    const titleCred = defaultInternalCredential(r.role, r.title)
    const auto = r.role === 'supervisor' ? 'Supervisor' : (pipeline ?? titleCred)
    const source =
      explicit !== null ? ('manual' as const)
      : r.role === 'supervisor' ? ('role' as const)
      : pipeline !== null ? ('pipeline' as const)
      : titleCred !== null ? ('title' as const)
      : null
    return {
      id: r.id,
      fullName: r.full_name,
      shift: r.shift,
      role: r.role,
      credential: explicit ?? auto,
      credentialAuto: auto,
      credentialSource: source,
      title: r.title,
      email: r.email,
      phone: r.phone,
      paycomCode: r.paycom_employee_code ?? null,
      hireDate: r.hire_date ?? null,
      vacRateOverride: r.vac_rate_override == null ? null : Number(r.vac_rate_override),
      sickRateOverride: r.sick_rate_override == null ? null : Number(r.sick_rate_override),
      employmentType: r.employment_type ?? null,
      active: r.active as boolean,
    }
  })
  const setMap: Record<string, Record<string, unknown>> = {}
  for (const r of (setRes.data ?? []) as { key: string; value: Record<string, unknown> }[]) {
    setMap[r.key] = r.value ?? {}
  }
  settings.value = setMap
  myHighlight.value = ((hlRes.data as { highlight_color?: string | null } | null)?.highlight_color) ?? null
  /* Roster ordering + visibility: every list in the module goes by last
     name (matching the rest of the portal's rosters), and members on
     the Setup-managed hide list (roster.exclude_user_ids — e.g. the
     medical director) drop out of scheduling pickers entirely.
     allPeople keeps the full set so the Members tab can un-hide. */
  mapped.sort((a, b) => personSortKey(a.fullName).localeCompare(personSortKey(b.fullName)))
  allPeople.value = mapped
  applyRosterVisibility()
  level.value = (lvlRes.data as SchedLevel) ?? 'member'
  loaded.value = true
}

function seedDevStub(): void {
  settings.value = {
    pay: { period_days: 14, period_anchor: PAY_ANCHOR, workday_start: '06:00', ot_week_hours: 40 },
    warnings: { consecutive_warn_hours: 60, consecutive_confirm_hours: 72, weekly_warn_hours: 72 },
  }
  const DEV_UNITS: [string, string, string][] = [
    ['S201', 'Station 201 Supervisor', 'Station 201 · Hempstead'],
    ['M211', 'Medic 211', 'Station 201 · Hempstead'],
    ['M221', 'Medic 221', 'Station 201 · Hempstead'],
    ['M242', 'Medic 242', 'Station 201 · Hempstead'],
    ['M281', 'Medic 281', 'Station 201 · Hempstead'],
    ['S202', 'Station 202 Supervisor', 'Station 202 · Waller'],
    ['M231', 'Medic 231', 'Station 202 · Waller'],
    ['M271', 'Medic 271', 'Station 202 · Waller'],
    ['M272', 'Medic 272', 'Station 202 · Waller'],
    ['M206', 'Medic 206', 'Station 202 · Waller'],
  ]
  units.value = DEV_UNITS.map(([code, label, station], i) => ({
    id: `dev-u-${code}`,
    code,
    label,
    station,
    sortOrder: i,
    active: true,
    rotationPattern: null,
    rotationAnchor: null,
    shiftStart: null,
    shiftEnd: null,
  }))
  const out: SchedSeat[] = []
  for (const u of units.value) {
    if (u.code.startsWith('S')) {
      out.push({ id: `dev-s-${u.code}-0`, unitId: u.id, label: 'Supervisor', qualRule: 'supervisor', sortOrder: 0, active: true })
    } else {
      const lead = u.code === 'M231' ? 'AIC / Medic' : 'Paramedic'
      out.push({ id: `dev-s-${u.code}-0`, unitId: u.id, label: lead, qualRule: u.code === 'M231' ? 'aemt_or_higher' : 'p2', sortOrder: 0, active: true })
      out.push({ id: `dev-s-${u.code}-1`, unitId: u.id, label: 'Attendant', qualRule: 'any_field', sortOrder: 1, active: true })
    }
  }
  seats.value = out
  people.value = [
    { id: 'dev-p-1', fullName: 'Sample Paramedic', shift: 'A', role: 'crew', credential: 'P2', credentialAuto: 'P2', credentialSource: 'pipeline', title: 'Paramedic', email: 'sample@wallercountyems.com', phone: '(555) 555-0101', paycomCode: 'A00X', employmentType: 'full_time', active: true },
    { id: 'dev-p-2', fullName: 'Sample Attendant', shift: 'A', role: 'crew', credential: 'EMT', credentialAuto: 'EMT', credentialSource: 'title', title: 'EMT', email: 'sample2@wallercountyems.com', phone: '(555) 555-0102', paycomCode: null, employmentType: 'part_time', active: true },
  ]
  allPeople.value = people.value
}

/** Default "my shift" gold + the curated highlight palette members
 *  pick from in My settings — light enough for ink text, saturated
 *  enough to pop (Justin, 2026-09-22). */
export const DEFAULT_HIGHLIGHT = 'oklch(0.94 0.13 102)'
export const HIGHLIGHT_SWATCHES: { value: string | null; label: string }[] = [
  { value: null, label: 'Yellow (default)' },
  { value: 'oklch(0.9 0.12 86.8)', label: 'Gold' },
  { value: 'oklch(0.9 0.11 65)', label: 'Amber' },
  { value: 'oklch(0.9 0.08 30)', label: 'Coral' },
  { value: 'oklch(0.91 0.08 350)', label: 'Pink' },
  { value: 'oklch(0.9 0.07 300)', label: 'Lavender' },
  { value: 'oklch(0.9 0.07 262)', label: 'Periwinkle' },
  { value: 'oklch(0.92 0.07 220)', label: 'Sky' },
  { value: 'oklch(0.91 0.08 180)', label: 'Teal' },
  { value: 'oklch(0.92 0.09 145)', label: 'Green' },
]

export const INTERNAL_CREDENTIALS = [
  'Chief', 'Assistant Chief', 'CDO', 'Supervisor',
  'EMT', 'AEMT', 'P1C', 'P1', 'P2', 'P3', 'P4', 'EMT-FTO', 'AEMT-FTO', 'P2-FTO', 'P3-FTO',
] as const

/** Command staff + P4 hold any seat (Justin, 2026-09-17). */
const ANY_SEAT_CREDENTIALS = ['Chief', 'Assistant Chief', 'CDO', 'P4', 'Supervisor'] as const

/** Cleared-at-P2 set — carries narcotics safe access. NOT a request
 *  gate anymore (see below); it drives the Chief's warning chip when
 *  someone outside it lands on a Paramedic-in-charge seat. */
export const P2_CLEARED_CREDENTIALS: readonly string[] = [
  'P2', 'P3', 'P2-FTO', 'P3-FTO', ...ANY_SEAT_CREDENTIALS,
]

/** AEMT-or-higher — the M231 crew-minimum bar (one aboard at all times). */
export const AEMT_PLUS_CREDENTIALS: readonly string[] = [
  'AEMT', 'AEMT-FTO', 'P1C', 'P1', 'P2', 'P3', 'P2-FTO', 'P3-FTO', ...ANY_SEAT_CREDENTIALS,
]

/** Which internal credentials satisfy each seat rule for SELF-SERVICE
 *  (pickups, trade claims). Command staff/Supervisor/P4 hold any seat.
 *  Chief's rule (2026-10-01): ANY paramedic — P1C/P1 included — may
 *  REQUEST a Paramedic-in-charge or attendant spot before they are
 *  P2-cleared; her approval queue shows a not-P2-cleared warning chip
 *  instead of the old hard block. AEMT/EMT still cannot self-request
 *  p2 seats. The M231 exception (any level when the other seat holds
 *  an AEMT-or-higher) lives in canFillSeat, not in this map. */
export const QUAL_RULE_CREDENTIALS: Record<string, readonly string[]> = {
  p2: ['P1C', 'P1', 'P2', 'P3', 'P2-FTO', 'P3-FTO', ...ANY_SEAT_CREDENTIALS],
  aemt_or_higher: [...AEMT_PLUS_CREDENTIALS],
  supervisor: [...ANY_SEAT_CREDENTIALS],
  any_field: [...INTERNAL_CREDENTIALS],
  any: [...INTERNAL_CREDENTIALS],
}

/**
 * Can this member fill this seat on their own (request a pickup, claim
 * a giveaway)? Honors Members-tab overrides: an explicit "Qualified"
 * grant opens a seat their credential wouldn't, "Excluded" closes one
 * it would; unit exclusions always block.
 */
async function canFillSeat(
  userId: string,
  seatId: string,
  subjectName = 'You',
  /** Shift context — lets the M231 crew-minimum exception look at who
   *  covers the unit's other seat for that window. */
  ctx?: { dateIso: string; startAt?: string | null; endAt?: string | null },
): Promise<{ ok: boolean; reason: string | null }> {
  const seat = seats.value.find((s) => s.id === seatId)
  if (!seat) return { ok: true, reason: null }
  const unit = units.value.find((u) => u.id === seat.unitId)
  const person = personById.value.get(userId)
  const auth = useAuthStore()
  /* Overrides/exclusions come from a narrow SECURITY DEFINER rpc, not
     fetchMemberSettings: members can't read OTHER people's settings
     rows (RLS protects sms_phone/notify), so a directed trade's
     target check silently missed saved qualification overrides —
     the Kim/Fulton bug, 2026-09-17. */
  let overrides: Record<string, 'allow' | 'deny'> = {}
  let exclusions: string[] = []
  if (!auth.usingDevStub) {
    const res = await supabase.rpc('sched_qual_info', { target: userId })
    const v = (res.data ?? {}) as {
      qual_overrides?: Record<string, 'allow' | 'deny'>
      unit_exclusions?: string[]
    }
    overrides = v.qual_overrides ?? {}
    exclusions = v.unit_exclusions ?? []
  }
  const self = subjectName === 'You'
  const isAre = self ? 'are' : 'is'
  const poss = self ? 'Your' : `${subjectName}'s`
  if (unit && exclusions.includes(unit.id)) {
    return { ok: false, reason: `${subjectName} ${isAre} excluded from ${unit.code}.` }
  }
  const override = overrides[seat.qualRule]
  if (override === 'allow') return { ok: true, reason: null }
  if (override === 'deny') {
    return { ok: false, reason: `${subjectName} ${isAre} excluded from ${seat.label} seats.` }
  }
  const allowed = QUAL_RULE_CREDENTIALS[seat.qualRule] ?? []
  const cred = person?.credential ?? null
  if (cred && allowed.includes(cred)) return { ok: true, reason: null }
  /* M231 rule (Chief, 2026-10-01): the AIC seat may be covered by ANY
     level when the unit's other seat has an AEMT-or-higher aboard for
     the whole requested window — the truck still meets the AEMT/EMT
     crew minimum (1.51). */
  if (seat.qualRule === 'aemt_or_higher' && unit && ctx?.dateIso) {
    const win = ctxWindowMs(ctx, unit)
    const cover = await unitAemtPlusCoverage(ctx.dateIso, unit.id, seat.id)
    if (!cover.error && windowCovered(cover.segs, win.start, win.end)) {
      return { ok: true, reason: null }
    }
    return {
      ok: false,
      reason:
        `${poss} credential (${cred ?? 'not set'}) can only take this ${seat.label} seat when an ` +
        `AEMT or paramedic covers ${unit.code}'s other seat for the whole window — right now it ` +
        `isn't. The Chief can still assign it directly.`,
    }
  }
  return {
    ok: false,
    reason: `${poss} credential (${cred ?? 'not set'}) does not qualify for this ${seat.label} seat. The Chief can still assign it directly.`,
  }
}

/** Resolve a request window to epoch ms, defaulting to the unit's day
 *  window when explicit times are missing. */
function ctxWindowMs(
  ctx: { dateIso: string; startAt?: string | null; endAt?: string | null },
  unit: SchedUnit | null,
): { start: number; end: number } {
  if (ctx.startAt && ctx.endAt) return { start: tsMs(ctx.startAt), end: tsMs(ctx.endAt) }
  const uw = unitDayWindow(unit ?? null, ctx.dateIso)
  return { start: tsMs(uw.startTs), end: tsMs(uw.endTs) }
}

/** Do the merged segments fully cover [start, end)? Sliver-tolerant. */
function windowCovered(segs: Seg[], start: number, end: number): boolean {
  let left: Seg[] = [{ start, end }]
  for (const s of mergeSegs(segs)) left = cutSegs(left, s.start, s.end)
  return left.every((s) => s.end - s.start < MIN_SEG_MS)
}

/**
 * AEMT-or-higher standing coverage across a unit's OTHER seats on a
 * date (read-only twin of claimSeatWindow's standing math: scheduled
 * rows minus each holder's own time off; a rowless seat falls back to
 * its rotation occupant inside the unit window). Fresh-fetched — the
 * Trades board files against dates far outside the loaded range.
 */
async function unitAemtPlusCoverage(
  dateIso: string,
  unitId: string,
  excludeSeatId: string,
): Promise<{ segs: Seg[]; error: string | null }> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { segs: [], error: null }
  const otherSeats = seats.value.filter(
    (s) => s.unitId === unitId && s.id !== excludeSeatId && s.active,
  )
  if (otherSeats.length === 0) return { segs: [], error: null }
  const unit = units.value.find((u) => u.id === unitId) ?? null
  const [rowsRes, offsRes] = await Promise.all([
    supabase
      .from('sched_entries')
      .select('*')
      .eq('work_date', dateIso)
      .in('seat_id', otherSeats.map((s) => s.id)),
    supabase.from('sched_entries').select('*').eq('work_date', dateIso).eq('kind', 'timeoff'),
  ])
  if (rowsRes.error) return { segs: [], error: rowsRes.error.message }
  if (offsRes.error) return { segs: [], error: offsRes.error.message }
  const offs = (offsRes.data ?? []).map(mapEntry)
  const offsFor = (uid: string | null): Seg[] =>
    uid
      ? offs
          .filter((o) => o.userId === uid)
          .map((o) => ({ start: tsMs(o.startAt), end: tsMs(o.endAt) }))
      : []
  const isAemtPlus = (uid: string | null): boolean => {
    const cred = uid ? (personById.value.get(uid)?.credential ?? null) : null
    return !!cred && AEMT_PLUS_CREDENTIALS.includes(cred)
  }
  const segs: Seg[] = []
  for (const seat of otherSeats) {
    const seatRows = (rowsRes.data ?? [])
      .map(mapEntry)
      .filter((r) => r.seatId === seat.id && r.kind !== 'timeoff' && r.status !== 'off')
    for (const r of seatRows) {
      if (r.status !== 'scheduled' || !r.userId || !isAemtPlus(r.userId)) continue
      let s: Seg[] = [{ start: tsMs(r.startAt), end: tsMs(r.endAt) }]
      for (const o of offsFor(r.userId)) s = cutSegs(s, o.start, o.end)
      segs.push(...s)
    }
    if (seatRows.length === 0) {
      const occ = seatRotationOccupant(seat.id, dateIso)
      if (occ && isAemtPlus(occ)) {
        const uw = unitDayWindow(unit, dateIso)
        let s: Seg[] = [{ start: tsMs(uw.startTs), end: tsMs(uw.endTs) }]
        for (const o of offsFor(occ)) s = cutSegs(s, o.start, o.end)
        segs.push(...s)
      }
    }
  }
  return { segs: mergeSegs(segs), error: null }
}

/**
 * Advisory chips for the approval queue — NEVER blocking. Today:
 *  - not_p2_cleared: someone outside the P2-cleared set landing on a
 *    Paramedic-in-charge seat (no narcotics safe access yet) — the
 *    Chief asked to see this at approval time (2026-10-01).
 *  - crew_minimum: a below-AEMT member filling a non-AIC seat on a
 *    unit with an AIC seat (M231) while no AEMT-or-higher covers the
 *    in-charge side for the whole window.
 */
async function qualWarnings(
  userId: string,
  seatId: string | null | undefined,
  ctx?: { dateIso?: string | null; startAt?: string | null; endAt?: string | null },
  subjectName?: string,
): Promise<HoursWarning[]> {
  if (!seatId) return []
  const seat = seats.value.find((s) => s.id === seatId)
  if (!seat) return []
  const person = personById.value.get(userId)
  const cred = person?.credential ?? null
  const name = subjectName ?? person?.fullName ?? 'This member'
  const out: HoursWarning[] = []
  if (seat.qualRule === 'p2' && (!cred || !P2_CLEARED_CREDENTIALS.includes(cred))) {
    out.push({
      code: 'not_p2_cleared',
      hours: 0,
      limit: 0,
      message: `${name} (${cred ?? 'no credential set'}) is not cleared at P2 yet — no narcotics safe access.`,
    })
  }
  if (
    seat.qualRule !== 'aemt_or_higher' &&
    (!cred || !AEMT_PLUS_CREDENTIALS.includes(cred)) &&
    ctx?.dateIso
  ) {
    const unit = units.value.find((u) => u.id === seat.unitId) ?? null
    const hasAicSeat = seats.value.some(
      (s) => s.unitId === seat.unitId && s.active && s.qualRule === 'aemt_or_higher',
    )
    if (unit && hasAicSeat) {
      const win = ctxWindowMs({ dateIso: ctx.dateIso, startAt: ctx.startAt, endAt: ctx.endAt }, unit)
      const cover = await unitAemtPlusCoverage(ctx.dateIso, unit.id, seat.id)
      if (!cover.error && !windowCovered(cover.segs, win.start, win.end)) {
        out.push({
          code: 'crew_minimum',
          hours: 0,
          limit: 0,
          message:
            `${name} is below AEMT and no AEMT or paramedic covers ${unit.code}'s in-charge seat ` +
            `for the whole window — the truck would fall under the AEMT/EMT minimum (1.51).`,
        })
      }
    }
  }
  return out
}

/** Best-effort default when no internal credential has been set on the
 *  Members tab: supervisors by role, otherwise mapped from title. */
function defaultInternalCredential(role: string, title: string | null): string | null {
  if (role === 'supervisor') return 'Supervisor'
  if (!title) return null
  const t = title.toLowerCase()
  if (t.includes('paramedic')) return 'P2'
  if (t.includes('aemt') || t.includes('adv')) return 'AEMT'
  if (t.includes('emt')) return 'EMT'
  return null
}

async function loadRange(startIso: string, endIso: string): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    rangeStart.value = startIso
    rangeEnd.value = endIso
    return
  }
  const [eRes, nRes, aRes, evRes] = await Promise.all([
    supabase
      .from('sched_entries')
      .select('*')
      .gte('work_date', startIso)
      .lte('work_date', endIso),
    supabase.from('sched_day_notes').select('*').gte('on_date', startIso).lte('on_date', endIso),
    supabase.from('sched_availability').select('*').gte('on_date', startIso).lte('on_date', endIso),
    supabase.from('sched_events').select('*').gte('on_date', startIso).lte('on_date', endIso),
  ])
  const err = eRes.error ?? nRes.error ?? aRes.error ?? evRes.error
  if (err) {
    loadError.value = err.message
    return
  }
  schedEvents.value = (evRes.data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    onDate: r.on_date,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
    notes: r.notes,
    location: r.location ?? null,
    doubleTime: r.double_time ?? true,
  }))
  entries.value = (eRes.data ?? []).map(mapEntry)
  dayNotes.value = (nRes.data ?? []).map((r) => ({
    id: r.id,
    onDate: r.on_date,
    unitId: r.unit_id,
    note: r.note,
    includeInReminders: r.include_in_reminders,
  }))
  availability.value = (aRes.data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    onDate: r.on_date,
    startAt: r.start_at,
    endAt: r.end_at,
    reason: r.reason,
  }))
  rangeStart.value = startIso
  rangeEnd.value = endIso
}

function mapEntry(r: Record<string, unknown>): SchedEntry {
  return {
    id: r.id as string,
    workDate: r.work_date as string,
    seatId: r.seat_id as string | null,
    userId: r.user_id as string | null,
    startAt: r.start_at as string,
    endAt: r.end_at as string,
    kind: r.kind as string,
    status: r.status as string,
    offType: r.off_type as string | null,
    timeType: r.time_type as string,
    eventId: r.event_id as string | null,
    studentProgram: r.student_program as string | null,
    unitId: (r.unit_id as string | null) ?? null,
    note: r.note as string | null,
    sourceRequest: r.source_request as string | null,
  }
}

async function loadRequests(): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  const res = await supabase
    .from('sched_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(400)
  if (res.error) {
    loadError.value = res.error.message
    return
  }
  requests.value = (res.data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    requesterId: r.requester_id,
    counterpartyId: r.counterparty_id,
    entryId: r.entry_id,
    counterEntryId: r.counter_entry_id,
    counterSeatId: r.counter_seat_id,
    counterWorkDate: r.counter_work_date,
    counterStartAt: r.counter_start_at,
    counterEndAt: r.counter_end_at,
    seatId: r.seat_id,
    workDate: r.work_date,
    startAt: r.start_at,
    endAt: r.end_at,
    offType: r.off_type,
    timeType: r.time_type,
    unitCode: r.unit_code,
    positionLabel: r.position_label,
    comments: r.comments,
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
  }))
}

// ── live updates ─────────────────────────────────────────────────────

let liveChannel: ReturnType<typeof supabase.channel> | null = null
let entriesReloadTimer: number | undefined
let requestsReloadTimer: number | undefined
let offersReloadTimer: number | undefined

/** Subscribe once per session: entry/request changes made anywhere —
 *  another device, another member — reload the open boards and the
 *  request queue, so pending work and board changes appear live.
 *  Events are only a "something changed" signal; the reloads re-query
 *  under RLS as usual. */
function startRealtime(): void {
  const auth = useAuthStore()
  if (auth.usingDevStub || liveChannel) return
  liveChannel = supabase
    .channel('sched-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sched_entries' },
      () => {
        window.clearTimeout(entriesReloadTimer)
        entriesReloadTimer = window.setTimeout(() => {
          void reloadRangeIfLoaded()
        }, 400)
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sched_requests' },
      () => {
        window.clearTimeout(requestsReloadTimer)
        requestsReloadTimer = window.setTimeout(() => {
          void loadRequests()
        }, 400)
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sched_trade_offers' },
      () => {
        window.clearTimeout(offersReloadTimer)
        offersReloadTimer = window.setTimeout(() => {
          void loadTradeOffers()
        }, 400)
      },
    )
    .subscribe()
}

// ── generation: rotation template → day model ────────────────────────

export const OFF_LABELS: Record<string, string> = {
  vacation: 'Vacation Time',
  sick: 'Sick Time',
  unpaid: 'Unpaid Time Off',
  bereavement: 'Bereavement',
  deployment: 'Deployment',
  other: 'Time Off',
}

export const REQ_TYPE_LABELS: Record<string, string> = {
  pickup: 'Pickup',
  time_off: 'Time off',
  extra_hours: 'Extra hours',
  giveaway: 'Giveaway',
  trade: 'Trade',
  discrepancy: 'Time discrepancy',
}

/** Undecided requests targeting a date — the Chief sees them ON the
 *  board, not just in the queue. A trade surfaces on both its dates. */
function pendingRowsFor(dateIso: string, onlyFor?: string | null): PendingRow[] {
  const out: PendingRow[] = []
  for (const r of requests.value) {
    if (r.status !== 'pending' && r.status !== 'partner_accepted') continue
    const onMain = r.workDate === dateIso
    const onCounter = r.counterWorkDate === dateIso
    if (!onMain && !onCounter) continue
    if (onlyFor && r.requesterId !== onlyFor && r.counterpartyId !== onlyFor) continue
    const requester = displayName(r.requesterId)
    const partner = r.counterpartyId ? displayName(r.counterpartyId) : null
    const who = onCounter && partner ? partner : requester
    const whoId = onCounter && r.counterpartyId ? r.counterpartyId : r.requesterId
    const startAt = onCounter ? r.counterStartAt : r.startAt
    const endAt = onCounter ? r.counterEndAt : r.endAt
    const bits: string[] = []
    if (r.type === 'time_off') {
      bits.push(`${OFF_LABELS[r.offType ?? 'other'] ?? 'Time Off'} request`)
    } else {
      bits.push(REQ_TYPE_LABELS[r.type] ?? r.type)
    }
    const pos = [r.unitCode, r.positionLabel].filter(Boolean).join(' ')
    if (pos && r.type !== 'time_off') bits.push(pos)
    if (r.type === 'trade' && partner) {
      bits.push(onCounter ? `with ${requester.name}` : `with ${partner.name}`)
    }
    if (r.type === 'giveaway' && r.status === 'partner_accepted' && partner) {
      bits.push(`to ${partner.name}`)
    }
    bits.push(r.status === 'partner_accepted' ? 'awaiting Chief approval' : 'pending approval')
    out.push({
      id: r.id + (onCounter ? ':c' : ''),
      type: r.type,
      userId: whoId,
      name: who.name || 'Unknown',
      credential: who.credential,
      start: startAt ? hhmm(startAt) : '0600',
      end: endAt ? hhmm(endAt) : '0600',
      sub: bits.join(' · '),
    })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

function rotationOccupant(seatId: string, platoon: Platoon, dateIso: string): string | null {
  let best: RotationAssignment | null = null
  for (const a of rotation.value) {
    if (a.seatId !== seatId || a.platoon !== platoon) continue
    if (a.effectiveFrom > dateIso) continue
    if (a.effectiveTo !== null && a.effectiveTo < dateIso) continue
    if (best === null || a.effectiveFrom > best.effectiveFrom) best = a
  }
  return best ? best.userId : null
}

/** Rotation occupant of a seat on a date under its UNIT's pattern
 *  (agency default when the unit has none); null when the unit is
 *  inactive, not staffed that day, or the seat is vacant. */
function seatRotationOccupant(seatId: string, dateIso: string): string | null {
  const seat = seats.value.find((s) => s.id === seatId)
  const unit = seat ? units.value.find((u) => u.id === seat.unitId) : null
  if (unit && !unit.active) return null
  const platoon = unitPlatoonFor(unit, dateIso)
  return platoon ? rotationOccupant(seatId, platoon, dateIso) : null
}

/** Active seats on ACTIVE units — the only seats the generators walk. */
function activeSeatList(): SchedSeat[] {
  const activeUnits = new Set(units.value.filter((u) => u.active).map((u) => u.id))
  return seats.value.filter((s) => s.active && activeUnits.has(s.unitId))
}

/** A unit's rotation shift window on a date, as timestamps clamped
 *  inside the 0600-anchored work date, plus 'HHmm' display strings.
 *  Default units: the full 0600 → 0600 shift. */
function unitDayWindow(unit: SchedUnit | undefined | null, dateIso: string) {
  const from = unit?.shiftStart ?? '06:00'
  const until = unit?.shiftEnd ?? '06:00'
  const w = shiftWindow(dateIso, from, until)
  return {
    startTs: w.reqStart,
    endTs: w.reqEnd,
    startHm: hhmm(w.reqStart),
    endHm: hhmm(w.reqEnd),
  }
}

/** hideOpen (only meaningful with onlyFor): personal calendar with the
 *  "Show open seats" box unticked — just that member's rows, no opens. */
export function dayModel(dateIso: string, onlyFor?: string | null, hideOpen = false): DayModel {
  const platoon = platoonFor(dateIso)
  const dayEntries = entries.value.filter((e) => e.workDate === dateIso)
  const unitModels: UnitModel[] = []
  let openCount = 0

  /* TIME OFF FOLLOWS THE PERSON (2026-09-25): time-off records are
     user-level; any window where a seat's occupant has one renders
     OPEN, derived live. Off hours travel with the member through
     swaps instead of living as rows pinned to whatever seat they
     held when it was approved — a swap-and-swap-back stranded the
     open on the wrong seat and re-seated a member who was off. */
  const offWindowsByUser = new Map<string, { s: number; e: number }[]>()
  for (const e of dayEntries) {
    if (e.kind !== 'timeoff' || !e.userId) continue
    const l = offWindowsByUser.get(e.userId) ?? []
    l.push({ s: tsMs(e.startAt), e: tsMs(e.endAt) })
    offWindowsByUser.set(e.userId, l)
  }

  for (const unit of units.value.filter((u) => u.active)) {
    const unitPlatoon = unitPlatoonFor(unit, dateIso)
    const unitSeats = seats.value
      .filter((s) => s.unitId === unit.id && s.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const seatModels: SeatModel[] = []

    for (const seat of unitSeats) {
      const overrides = dayEntries
        .filter((e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off')
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
      /* raw coverage in ms first, so occupant time off can be carved
         out before the display mapping */
      interface RawRow {
        entryId: string | null
        userId: string | null
        s: number
        e: number
        kind: string
        open: boolean
        isRotation: boolean
      }
      let raw: RawRow[]
      if (overrides.length > 0) {
        raw = overrides.map((e) => ({
          entryId: e.id,
          userId: e.userId,
          s: tsMs(e.startAt),
          e: tsMs(e.endAt),
          kind: e.kind,
          open: e.userId === null && e.status === 'open',
          isRotation: false,
        }))
      } else if (unitPlatoon === null) {
        // unit not staffed this day under its own pattern — no rows,
        // no open seats
        raw = []
      } else {
        const occupant = rotationOccupant(seat.id, unitPlatoon, dateIso)
        const uw = unitDayWindow(unit, dateIso)
        raw = [
          {
            entryId: null,
            userId: occupant,
            s: tsMs(uw.startTs),
            e: tsMs(uw.endTs),
            kind: 'rotation',
            open: occupant === null,
            isRotation: occupant !== null,
          },
        ]
      }
      /* carve each occupied window against the occupant's time off:
         the overlap renders as an OPEN row (claimable like any other
         open — entryId null takes the seat+window pickup path) */
      const carved: RawRow[] = []
      for (const r of raw) {
        const offs = r.userId && !r.open ? (offWindowsByUser.get(r.userId) ?? []) : []
        if (offs.length === 0) {
          carved.push(r)
          continue
        }
        let pieces: { s: number; e: number }[] = [{ s: r.s, e: r.e }]
        const opens: { s: number; e: number }[] = []
        for (const o of offs) {
          const next: { s: number; e: number }[] = []
          for (const p of pieces) {
            const os = Math.max(p.s, o.s)
            const oe = Math.min(p.e, o.e)
            if (oe - os < MIN_SEG_MS) {
              next.push(p)
              continue
            }
            if (os - p.s >= MIN_SEG_MS) next.push({ s: p.s, e: os })
            if (p.e - oe >= MIN_SEG_MS) next.push({ s: oe, e: p.e })
            opens.push({ s: os, e: oe })
          }
          pieces = next
        }
        for (const p of pieces) carved.push({ ...r, s: p.s, e: p.e })
        for (const o of opens)
          carved.push({ entryId: null, userId: null, s: o.s, e: o.e, kind: 'rotation', open: true, isRotation: false })
      }
      carved.sort((a, b) => a.s - b.s)
      /* BLOCKED overlay (Rhonda, 2026-09-28): a 'blocked' entry paints
         any OPEN window it overlaps as "Covered — no extra punch" (a
         call-out handled by someone already punched elsewhere, so no
         person entry exists on purpose). Scheduled coverage is never
         painted — only open pieces. */
      const blockedWins = dayEntries
        .filter((e) => e.seatId === seat.id && e.kind === 'blocked')
        .map((e) => ({ id: e.id, s: tsMs(e.startAt), e: tsMs(e.endAt), note: e.note }))
      let final = carved
      if (blockedWins.length > 0) {
        final = []
        for (const r of carved) {
          if (!r.open) {
            final.push(r)
            continue
          }
          let pieces: { s: number; e: number }[] = [{ s: r.s, e: r.e }]
          for (const b of blockedWins) {
            const next: { s: number; e: number }[] = []
            for (const p of pieces) {
              const os = Math.max(p.s, b.s)
              const oe = Math.min(p.e, b.e)
              if (oe - os < MIN_SEG_MS) {
                next.push(p)
                continue
              }
              if (os - p.s >= MIN_SEG_MS) next.push({ s: p.s, e: os })
              if (p.e - oe >= MIN_SEG_MS) next.push({ s: oe, e: p.e })
              final.push({ entryId: b.id, userId: null, s: os, e: oe, kind: 'blocked', open: false, isRotation: false })
            }
            pieces = next
          }
          for (const p of pieces) final.push({ ...r, s: p.s, e: p.e })
        }
        final.sort((a, b) => a.s - b.s)
      }
      /* SAME-SEAT DEDUPE (Rhonda's 9/30 S201, 2026-09-28): a window
         someone is SCHEDULED on this seat is not open — stray open
         markers and carved-out coverage that later got refilled were
         double-listing three opens beside a fully covered day. Open
         pieces shrink to the true gaps only. */
      const coveredWins = final
        .filter((r) => !r.open && r.kind !== 'blocked' && r.userId)
        .map((r) => ({ s: r.s, e: r.e }))
      if (coveredWins.length > 0 && final.some((r) => r.open)) {
        const dedup: RawRow[] = []
        for (const r of final) {
          if (!r.open) {
            dedup.push(r)
            continue
          }
          let pieces: { s: number; e: number }[] = [{ s: r.s, e: r.e }]
          for (const c of coveredWins) {
            const next: { s: number; e: number }[] = []
            for (const p of pieces) {
              const os = Math.max(p.s, c.s)
              const oe = Math.min(p.e, c.e)
              if (oe - os < MIN_SEG_MS) {
                next.push(p)
                continue
              }
              if (os - p.s >= MIN_SEG_MS) next.push({ s: p.s, e: os })
              if (p.e - oe >= MIN_SEG_MS) next.push({ s: oe, e: p.e })
            }
            pieces = next
          }
          for (const p of pieces) dedup.push({ ...r, s: p.s, e: p.e })
        }
        dedup.sort((a, b) => a.s - b.s)
        final = dedup
      }
      const blockedNote = new Map(blockedWins.map((b) => [b.id, b.note]))
      let rows: SeatRow[] = final.map((r) => {
        const who = displayName(r.userId)
        const bNote = r.kind === 'blocked' && r.entryId ? blockedNote.get(r.entryId) : null
        return {
          entryId: r.entryId,
          userId: r.userId,
          name: r.kind === 'blocked' ? `Covered — ${bNote || 'no extra punch'}` : who.name,
          credential: r.kind === 'blocked' ? null : who.credential,
          start: hhmm(new Date(r.s).toISOString()),
          end: hhmm(new Date(r.e).toISOString()),
          kind: r.kind,
          open: r.open,
          isRotation: r.isRotation,
          note: null,
        }
      })
      if (onlyFor) {
        rows = rows.filter((r) => (r.open && !hideOpen) || r.userId === onlyFor)
      }
      openCount += rows.filter((r) => r.open).length
      seatModels.push({ seat, rows })
    }

    // Students and extra RIDER seats ride inside the unit block;
    // approved extra hours get their own labeled section below the
    // schedule (Aladtec style). An open rider row is an extra open
    // seat — claim/assign like any open seat.
    let extras = dayEntries
      .filter((e) => e.unitId === unit.id && (e.kind === 'student' || e.kind === 'rider'))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((e) => {
        const who = displayName(e.userId)
        const open = e.kind === 'rider' && e.userId === null && e.status === 'open'
        return {
          entryId: e.id,
          userId: e.userId,
          name: open
            ? e.studentProgram || 'Rider'
            : who.name || e.studentProgram || 'Open slot',
          credential: who.credential,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          kind: e.kind,
          open,
          isRotation: false,
          note: e.note,
          posLabel: e.kind === 'rider' ? (e.studentProgram ?? 'Rider') : null,
        }
      })
    if (onlyFor) {
      extras = extras.filter(
        (r) => r.userId === onlyFor || (r.kind === 'rider' && r.open && !hideOpen),
      )
    }
    openCount += extras.filter((r) => r.open).length

    const notes = dayNotes.value.filter((n) => n.onDate === dateIso && n.unitId === unit.id)
    // A unit with nothing to show (its pattern is dark today, or the
    // "just me" filter emptied it) drops off the board entirely. On a
    // personal calendar a note alone doesn't earn the unit a block.
    const hasContent =
      seatModels.some((sm) => sm.rows.length > 0) ||
      extras.length > 0 ||
      (!onlyFor && notes.length > 0)
    if (hasContent) unitModels.push({ unit, seats: seatModels, extras, notes })
  }

  const unattached = dayEntries
    .filter((e) => e.unitId === null && e.kind === 'student')
    .filter((e) => !onlyFor || e.userId === onlyFor)
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
        userId: e.userId,
        name: who.name || e.studentProgram || 'Open slot',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        kind: e.kind,
        open: false,
        isRotation: false,
        note: e.note,
      }
    })

  // Special events: their own boxes under the set schedule. Staffing
  // entries group by label (note); listed sched_events with no staffing
  // that day still get a box.
  const eventBoxes: DayEventBox[] = []
  const staffing = dayEntries.filter((e) => e.kind === 'event')
  const byLabel = new Map<string, SchedEntry[]>()
  for (const e of staffing) {
    const label = e.note || 'Special event'
    if (!byLabel.has(label)) byLabel.set(label, [])
    byLabel.get(label)!.push(e)
  }
  const listings = schedEvents.value.filter((ev) => ev.onDate === dateIso)
  for (const [label, rows] of byLabel) {
    const listing = listings.find((ev) => ev.label === label)
    let boxRows = rows
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((e) => {
        const who = displayName(e.userId)
        const open = e.userId === null && e.status === 'open'
        return {
          entryId: e.id,
          userId: e.userId,
          name: open ? (e.studentProgram || 'Open') : (who.name || e.studentProgram || 'Open'),
          credential: who.credential,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          kind: e.kind,
          open,
          isRotation: false,
          note: null,
        }
      })
    if (onlyFor) boxRows = boxRows.filter((r) => (r.open && !hideOpen) || r.userId === onlyFor)
    openCount += boxRows.filter((r) => r.open).length
    if (onlyFor && boxRows.length === 0) continue
    eventBoxes.push({
      label,
      eventId: listing?.id ?? null,
      start: listing ? listing.startTime.replace(':', '') : null,
      end: listing ? listing.endTime.replace(':', '') : null,
      notes: listing?.notes ?? null,
      location: listing?.location ?? null,
      doubleTime: listing?.doubleTime ?? true,
      rows: boxRows,
    })
  }
  for (const ev of listings) {
    if (!byLabel.has(ev.label) && !onlyFor) {
      eventBoxes.push({
        label: ev.label,
        eventId: ev.id,
        start: ev.startTime.replace(':', ''),
        end: ev.endTime.replace(':', ''),
        notes: ev.notes,
        location: ev.location,
        doubleTime: ev.doubleTime,
        rows: [],
      })
    }
  }

  // Labeled day sections, Aladtec style.
  const unitCodeById = new Map(units.value.map((u) => [u.id, u.code]))
  const extraHours: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'extra')
    .filter((e) => !onlyFor || e.userId === onlyFor)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      const unitCode = e.unitId ? unitCodeById.get(e.unitId) : null
      const sub = [unitCode, e.note].filter(Boolean).join(' / ')
      return {
        entryId: e.id,
        userId: e.userId,
        name: who.name || 'Unknown',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        sub,
      }
    })

  const timeOff: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'timeoff')
    .filter((e) => !onlyFor || e.userId === onlyFor)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
        userId: e.userId,
        name: who.name || 'Unknown',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        sub: e.note || OFF_LABELS[e.offType ?? 'other'] || 'Time Off',
        seatId: e.seatId ?? null,
        offType: e.offType ?? null,
      }
    })

  const trades: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'trade' && e.userId !== null)
    .filter((e) => !onlyFor || e.userId === onlyFor)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
        userId: e.userId,
        name: who.name || 'Unknown',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        sub: (e.note ?? '').replace(/^Trade for /, 'For '),
      }
    })

  const notes = dayNotes.value.filter((n) => n.onDate === dateIso && n.unitId === null)
  return {
    dateIso,
    platoon,
    units: unitModels,
    events: eventBoxes,
    extraHours,
    timeOff,
    trades,
    pending: pendingRowsFor(dateIso, onlyFor),
    unattached,
    notes,
    openCount,
  }
}

/** 'HH:MM' or 'HHmm' → minutes since the 0600 changeover. */
function hmAnchored(hm: string): number {
  const digits = hm.replace(':', '')
  const mins = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))
  return (mins - 360 + 1440) % 1440
}

export interface DayOverlap {
  label: string
  window: string
}

/**
 * Everywhere `userId` already works on `dateIso` that overlaps the
 * window — the double-booking guard for editor assignments. Built from
 * dayModel so overrides count (someone marked off / already covered
 * doesn't false-positive). `until <= from` means it runs to next day.
 */
export function dayOverlaps(
  userId: string,
  dateIso: string,
  fromHm: string,
  untilHm: string,
): DayOverlap[] {
  const s2 = hmAnchored(fromHm)
  let e2 = hmAnchored(untilHm)
  if (e2 <= s2) e2 += 1440
  const out: DayOverlap[] = []
  const push = (label: string, start: string, end: string) => {
    const s1 = hmAnchored(start)
    let e1 = hmAnchored(end)
    if (e1 <= s1) e1 += 1440
    if (s1 < e2 && s2 < e1) out.push({ label, window: `${start}–${end}` })
  }
  const m = dayModel(dateIso, userId)
  for (const um of m.units) {
    for (const sm of um.seats)
      for (const r of sm.rows)
        if (!r.open && r.userId === userId) push(`${um.unit.code} ${sm.seat.label}`, r.start, r.end)
    for (const r of um.extras)
      if (!r.open && r.userId === userId)
        push(`${um.unit.code} ${r.posLabel ?? r.kind}`, r.start, r.end)
  }
  for (const box of m.events)
    for (const r of box.rows)
      if (!r.open && r.userId === userId) push(box.label, r.start, r.end)
  for (const r of m.extraHours)
    if (r.userId === userId) push(r.sub ? `Extra hours (${r.sub})` : 'Extra hours', r.start, r.end)
  for (const r of m.trades) if (r.userId === userId) push('Trade coverage', r.start, r.end)
  for (const r of m.unattached) if (r.userId === userId) push('Student rider', r.start, r.end)
  return out
}

/** Lightweight month-cell summary without building full unit models. */
export function daySummary(dateIso: string, myUserId: string | null) {
  const platoon = platoonFor(dateIso)
  const dayEntries = entries.value.filter((e) => e.workDate === dateIso)
  const unitById = new Map(units.value.map((u) => [u.id, u]))
  let open = 0
  let mine = false
  let myStart = '0600'
  let myEnd = '0600'

  for (const seat of activeSeatList()) {
    const overrides = dayEntries.filter(
      (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
    )
    if (overrides.length > 0) {
      for (const e of overrides) {
        if (e.userId === null && e.status === 'open') open++
        if (myUserId && e.userId === myUserId) {
          mine = true
          myStart = hhmm(e.startAt)
          myEnd = hhmm(e.endAt)
        }
      }
    } else {
      const unit = unitById.get(seat.unitId)
      const unitPlatoon = unitPlatoonFor(unit, dateIso)
      if (unitPlatoon === null) continue // unit not staffed this day
      const occ = rotationOccupant(seat.id, unitPlatoon, dateIso)
      if (occ === null) open++
      else if (myUserId && occ === myUserId) {
        mine = true
        const uw = unitDayWindow(unit, dateIso)
        myStart = uw.startHm
        myEnd = uw.endHm
      }
    }
  }
  // extras/students/riders count as my shift too
  if (myUserId) {
    for (const e of dayEntries) {
      if (
        e.userId === myUserId &&
        (e.kind === 'extra' || e.kind === 'student' || e.kind === 'rider')
      ) {
        mine = true
        myStart = hhmm(e.startAt)
        myEnd = hhmm(e.endAt)
      }
    }
  }
  return { platoon, open, mine, myStart, myEnd }
}

// ── shift lookups for request forms ─────────────────────────────────

export interface UpcomingShift {
  dateIso: string
  seatId: string
  unitCode: string
  seatLabel: string
}

/** Days in [fromIso, fromIso+days) where the user holds a seat. */
function upcomingShiftsFor(userId: string, fromIso: string, days = 45): UpcomingShift[] {
  const out: UpcomingShift[] = []
  const unitByid = new Map(units.value.map((u) => [u.id, u]))
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(fromIso, i)
    const dayEntries = entries.value.filter((e) => e.workDate === iso)
    for (const seat of activeSeatList()) {
      const overrides = dayEntries.filter(
        (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
      )
      const u = unitByid.get(seat.unitId)
      const unitPlatoon = unitPlatoonFor(u, iso)
      const holds =
        overrides.length > 0
          ? overrides.some((e) => e.userId === userId)
          : unitPlatoon !== null && rotationOccupant(seat.id, unitPlatoon, iso) === userId
      if (holds) {
        out.push({ dateIso: iso, seatId: seat.id, unitCode: u?.code ?? '', seatLabel: seat.label })
      }
    }
  }
  return out
}

export interface OpenSeatInfo {
  seatId: string
  unitCode: string
  seatLabel: string
  entryId: string | null
  start: string
  end: string
}

// ── My schedule (the signed-in member's own list) ────────────────────

export interface MyScheduleItem {
  dateIso: string
  kind: 'shift' | 'extra' | 'event' | 'timeoff' | 'unavailable'
  label: string // 'M211 Paramedic', 'Extra hours', event name, off type
  sub: string | null
  start: string // 'HHmm'; '' for all-day markers
  end: string
  hours: number
}

/**
 * The signed-in member's own upcoming schedule: seat shifts (rotation +
 * overrides, same overlay semantics as the boards), extra hours, event
 * assignments, approved time off, and marked-unavailable days. Fetched
 * FRESH for the window, independent of what range the boards loaded.
 */
async function fetchMySchedule(
  days = 60,
): Promise<{ items: MyScheduleItem[]; error: string | null }> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return { items: [], error: 'Not signed in' }
  if (auth.usingDevStub) return { items: [], error: null }
  const fromIso = todayCentralIso()
  const endIso = addDaysIso(fromIso, days - 1)
  const [eRes, aRes] = await Promise.all([
    supabase.from('sched_entries').select('*').gte('work_date', fromIso).lte('work_date', endIso),
    supabase
      .from('sched_availability')
      .select('*')
      .eq('user_id', me)
      .gte('on_date', fromIso)
      .lte('on_date', endIso),
  ])
  if (eRes.error) return { items: [], error: eRes.error.message }
  const rows = (eRes.data ?? []).map(mapEntry)
  const unitById = new Map(units.value.map((u) => [u.id, u]))
  const items: MyScheduleItem[] = []
  for (let iso = fromIso; iso <= endIso; iso = addDaysIso(iso, 1)) {
    const dayRows = rows.filter((e) => e.workDate === iso)
    for (const seat of activeSeatList()) {
      const unit = unitById.get(seat.unitId)
      const label = `${unit?.code ?? ''} ${seat.label}`.trim()
      const seatRows = dayRows.filter(
        (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
      )
      const unitPlatoon = unitPlatoonFor(unit, iso)
      if (seatRows.length > 0) {
        for (const e of seatRows) {
          if (e.userId === me && e.status === 'scheduled') {
            items.push({
              dateIso: iso,
              kind: 'shift',
              label,
              sub: e.kind === 'trade' || e.kind === 'giveaway_cover' ? e.note : null,
              start: hhmm(e.startAt),
              end: hhmm(e.endAt),
              hours: hoursBetween(e.startAt, e.endAt),
            })
          }
        }
      } else if (unitPlatoon !== null && rotationOccupant(seat.id, unitPlatoon, iso) === me) {
        const uw = unitDayWindow(unit, iso)
        items.push({
          dateIso: iso,
          kind: 'shift',
          label,
          sub: null,
          start: uw.startHm,
          end: uw.endHm,
          hours: hoursBetween(uw.startTs, uw.endTs),
        })
      }
    }
    for (const e of dayRows) {
      if (e.userId !== me || e.seatId !== null) continue
      if (e.kind === 'extra' && e.status === 'scheduled') {
        const unit = e.unitId ? unitById.get(e.unitId) : null
        items.push({
          dateIso: iso,
          kind: 'extra',
          label: 'Extra hours',
          sub: [unit?.code, e.note].filter(Boolean).join(' / ') || null,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          hours: hoursBetween(e.startAt, e.endAt),
        })
      } else if (e.kind === 'event' && e.status === 'scheduled') {
        items.push({
          dateIso: iso,
          kind: 'event',
          label: e.note ?? 'Special event',
          sub: e.studentProgram,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          hours: hoursBetween(e.startAt, e.endAt),
        })
      } else if (e.kind === 'rider' && e.status === 'scheduled') {
        const rUnit = e.unitId ? unitById.get(e.unitId) : null
        items.push({
          dateIso: iso,
          kind: 'shift',
          label: `${rUnit?.code ?? ''} ${e.studentProgram ?? 'Rider'} (extra seat)`.trim(),
          sub: null,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          hours: hoursBetween(e.startAt, e.endAt),
        })
      }
    }
    // time off can sit on a seat or stand alone — report either way
    for (const e of dayRows) {
      if (e.userId === me && e.kind === 'timeoff' && e.status === 'off') {
        items.push({
          dateIso: iso,
          kind: 'timeoff',
          label: OFF_LABELS[e.offType ?? 'other'] ?? 'Time Off',
          sub: null,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          hours: 0,
        })
      }
    }
  }
  for (const a of aRes.data ?? []) {
    items.push({
      dateIso: a.on_date as string,
      kind: 'unavailable',
      label: 'Marked unavailable',
      sub: (a.reason as string | null) ?? null,
      start: '',
      end: '',
      hours: 0,
    })
  }
  items.sort((x, y) => x.dateIso.localeCompare(y.dateIso) || x.start.localeCompare(y.start))
  return { items, error: null }
}

// ── scheduled-time report (payroll verification) ─────────────────────

export interface TimeSegment {
  userId: string
  dateIso: string // work date (0600 anchor)
  startMs: number
  endMs: number
  hours: number
  unitId: string | null
  source: string // 'M211 Paramedic' | 'Extra — …' | 'Event — …' | rider/student
  kind: string // worked kinds + 'timeoff' (approved time off, not worked)
  timeType: string // regular | instructor | meeting
  offType: string | null // set on kind 'timeoff' rows only
  eventDouble?: boolean // kind 'event' rows: does this event pay double?
}

/**
 * Every member's held coverage in [startIso, endIso] (work dates),
 * entries fetched FRESH, same overlay semantics as the boards: entry
 * rows on a seat replace its rotation occupant; rotation coverage uses
 * each unit's own pattern and daily window; extras, events, students,
 * and rider seats add on. This is the payroll-verification ground
 * truth — the Time tab and the Paycom export are built on it.
 */
async function fetchTimeSegments(
  startIso: string,
  endIso: string,
): Promise<{ segs: TimeSegment[]; error: string | null }> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { segs: [], error: null }
  const [res, evRes] = await Promise.all([
    supabase
      .from('sched_entries')
      .select('*')
      .gte('work_date', startIso)
      .lte('work_date', endIso),
    supabase
      .from('sched_events')
      .select('label, on_date, double_time')
      .gte('on_date', startIso)
      .lte('on_date', endIso),
  ])
  if (res.error) return { segs: [], error: res.error.message }
  if (evRes.error) return { segs: [], error: evRes.error.message }
  const rows = (res.data ?? []).map(mapEntry)
  const eventDoubleByKey = new Map(
    ((evRes.data ?? []) as { label: string; on_date: string; double_time: boolean | null }[]).map(
      (r) => [`${r.on_date}|${r.label}`, r.double_time ?? true] as [string, boolean],
    ),
  )
  const unitById = new Map(units.value.map((u) => [u.id, u]))
  const segs: TimeSegment[] = []
  for (let iso = startIso; iso <= endIso; iso = addDaysIso(iso, 1)) {
    const dayRows = rows.filter((e) => e.workDate === iso)
    for (const seat of activeSeatList()) {
      const unit = unitById.get(seat.unitId)
      const source = `${unit?.code ?? ''} ${seat.label}`.trim()
      const seatRows = dayRows.filter(
        (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
      )
      if (seatRows.length > 0) {
        for (const e of seatRows) {
          if (!e.userId || e.status !== 'scheduled') continue
          const s = tsMs(e.startAt)
          const en = tsMs(e.endAt)
          if (en - s < MIN_SEG_MS) continue
          segs.push({
            userId: e.userId,
            dateIso: iso,
            startMs: s,
            endMs: en,
            hours: (en - s) / 3_600_000,
            unitId: seat.unitId,
            source,
            kind: e.kind,
            timeType: e.timeType || 'regular',
            offType: null,
          })
        }
      } else {
        const unitPlatoon = unitPlatoonFor(unit, iso)
        const occ = unitPlatoon ? rotationOccupant(seat.id, unitPlatoon, iso) : null
        if (occ) {
          const uw = unitDayWindow(unit, iso)
          const s = tsMs(uw.startTs)
          const en = tsMs(uw.endTs)
          segs.push({
            userId: occ,
            dateIso: iso,
            startMs: s,
            endMs: en,
            hours: (en - s) / 3_600_000,
            unitId: seat.unitId,
            source,
            kind: 'rotation',
            timeType: 'regular',
            offType: null,
          })
        }
      }
    }
    for (const e of dayRows) {
      if (e.seatId !== null || !e.userId || e.status !== 'scheduled') continue
      if (!['extra', 'event', 'student', 'rider'].includes(e.kind)) continue
      const s = tsMs(e.startAt)
      const en = tsMs(e.endAt)
      if (en - s < MIN_SEG_MS) continue
      const unit = e.unitId ? unitById.get(e.unitId) : null
      const source =
        e.kind === 'event'
          ? `Event — ${e.note ?? 'Special event'}`
          : e.kind === 'student'
            ? `Student — ${e.studentProgram ?? ''}`.trim()
            : e.kind === 'rider'
              ? `${unit?.code ?? ''} ${e.studentProgram ?? 'Rider'} (extra seat)`.trim()
              : `Extra — ${[unit?.code, e.note].filter(Boolean).join(' / ') || 'hours'}`
      segs.push({
        userId: e.userId,
        dateIso: iso,
        startMs: s,
        endMs: en,
        hours: (en - s) / 3_600_000,
        unitId: e.unitId ?? null,
        source,
        kind: e.kind,
        timeType: e.timeType || 'regular',
        offType: null,
        eventDouble:
          e.kind === 'event'
            ? (eventDoubleByKey.get(`${iso}|${e.note ?? 'Special event'}`) ?? true)
            : undefined,
      })
    }
    // approved time off — not worked hours, carried for the Paycom
    // export (vacation/sick/etc. hours rows) and off accounting
    for (const e of dayRows) {
      if (e.kind !== 'timeoff' || e.status !== 'off' || !e.userId) continue
      const s2 = tsMs(e.startAt)
      const en2 = tsMs(e.endAt)
      if (en2 - s2 < MIN_SEG_MS) continue
      const ot = e.offType ?? 'other'
      segs.push({
        userId: e.userId,
        dateIso: iso,
        startMs: s2,
        endMs: en2,
        hours: (en2 - s2) / 3_600_000,
        unitId: null,
        source: OFF_LABELS[ot] ?? 'Time Off',
        kind: 'timeoff',
        timeType: 'regular',
        offType: ot,
      })
    }
  }
  return { segs, error: null }
}

function openSeatsFor(dateIso: string): OpenSeatInfo[] {
  const model = dayModel(dateIso)
  const out: OpenSeatInfo[] = []
  for (const um of model.units) {
    for (const sm of um.seats) {
      for (const row of sm.rows) {
        if (row.open) {
          out.push({
            seatId: sm.seat.id,
            unitCode: um.unit.code,
            seatLabel: sm.seat.label,
            entryId: row.entryId,
            start: row.start,
            end: row.end,
          })
        }
      }
    }
  }
  return out
}

/** 'HHmm' or 'HH:mm' → 'HH:mm'. */
function normTime(t: string): string {
  const clean = t.replace(':', '').padStart(4, '0')
  return `${clean.slice(0, 2)}:${clean.slice(2)}`
}

/**
 * Split the 0600→0600 work date around a requested window. `until` at or
 * before `from` rolls to the next day (0600–0600 = full shift), and the
 * window is always clamped inside the work date.
 */
function shiftWindow(dateIso: string, from: string, until: string) {
  const f = normTime(from)
  const u = normTime(until)
  const dayStart = centralTs(dateIso, '06:00')
  const dayEnd = centralTs(addDaysIso(dateIso, 1), '06:00')
  const reqStart = f >= '06:00' ? centralTs(dateIso, f) : centralTs(addDaysIso(dateIso, 1), f)
  let reqEnd = u > '06:00' && u > f && f >= '06:00'
    ? centralTs(dateIso, u)
    : centralTs(addDaysIso(dateIso, 1), u)
  if (u === '06:00' || tsMs(reqEnd) <= tsMs(reqStart)) reqEnd = dayEnd
  if (tsMs(reqEnd) > tsMs(dayEnd)) reqEnd = dayEnd
  const before = tsMs(reqStart) > tsMs(dayStart) ? { start: dayStart, end: reqStart } : null
  const after = tsMs(reqEnd) < tsMs(dayEnd) ? { start: reqEnd, end: dayEnd } : null
  return { dayStart, dayEnd, reqStart, reqEnd, before, after }
}

// ── hours engine (threshold warnings) ────────────────────────────────

interface Seg {
  start: number
  end: number
}

export interface HoursWarning {
  code:
    | 'consecutive'
    | 'consecutive_confirm'
    | 'weekly'
    | 'ot'
    | 'check_failed'
    | 'leave_short'
    | 'started'
    | 'not_p2_cleared'
    | 'crew_minimum'
  hours: number
  limit: number
  message: string
}

export interface HoursInfo {
  weekHours: number // Sun–Sat week of the added shift, would-be total
  periodHours: number // pay period, would-be total
  consecutiveHours: number // longest continuous on-duty run touching the addition
  warnings: HoursWarning[]
}

export const DEFAULT_RIDER_POSITIONS = [
  'Attendant',
  'Paramedic',
  'Observer',
  'FTO Trainee',
  '3rd Rider',
]

/** Paycom earning-code map from Setup: category key → code. Reads the
 *  row-based `codes` map, falling back to the older single fields. */
function paycomCodes(): Record<string, string> {
  const p = (settings.value['paycom'] ?? {}) as Record<string, unknown>
  const codes = (p.codes ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(codes)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  const legacy: [string, string][] = [
    ['instructor', 'instructor_code'],
    ['meeting', 'meeting_code'],
    ['holiday', 'holiday_code'],
  ]
  for (const [k, lk] of legacy) {
    const v = p[lk]
    if (!out[k] && typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

/** Rider-seat position presets (Chief-editable in Setup). */
function riderPositions(): string[] {
  const v = settings.value['rider_positions'] as { options?: unknown } | undefined
  const opts = Array.isArray(v?.options)
    ? (v.options as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '')
    : []
  return opts.length > 0 ? opts : DEFAULT_RIDER_POSITIONS
}

/** Thresholds from sched_settings (Chief-editable in Setup). */
function warningThresholds() {
  const w = (settings.value['warnings'] ?? {}) as Record<string, unknown>
  const p = (settings.value['pay'] ?? {}) as Record<string, unknown>
  return {
    consecutiveWarn: Number(w.consecutive_warn_hours ?? 60),
    consecutiveConfirm: Number(w.consecutive_confirm_hours ?? 72),
    weeklyWarn: Number(w.weekly_warn_hours ?? 72),
    otWeek: Number(p.ot_week_hours ?? 40),
  }
}

/** A user's held on-duty segments for one work date, computed from raw
 *  entry rows with the same overlay semantics as dayModel: entry rows on
 *  a seat replace its rotation occupant; extras/events/students add on. */
function segsForUserOnDate(dateIso: string, userId: string, rows: SchedEntry[]): Seg[] {
  const dayRows = rows.filter((e) => e.workDate === dateIso)
  const out: Seg[] = []
  for (const seat of activeSeatList()) {
    const seatRows = dayRows.filter(
      (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
    )
    if (seatRows.length > 0) {
      for (const e of seatRows) {
        if (e.userId === userId && e.status === 'scheduled') {
          out.push({ start: tsMs(e.startAt), end: tsMs(e.endAt) })
        }
      }
    } else if (seatRotationOccupant(seat.id, dateIso) === userId) {
      const unit = units.value.find((u) => u.id === seat.unitId)
      const uw = unitDayWindow(unit, dateIso)
      out.push({ start: tsMs(uw.startTs), end: tsMs(uw.endTs) })
    }
  }
  for (const e of dayRows) {
    if (
      e.seatId === null &&
      e.userId === userId &&
      e.status === 'scheduled' &&
      (e.kind === 'extra' || e.kind === 'event' || e.kind === 'student' || e.kind === 'rider')
    ) {
      out.push({ start: tsMs(e.startAt), end: tsMs(e.endAt) })
    }
  }
  /* TIME OFF FOLLOWS THE PERSON (2026-09-25): subtract the member's
     own time-off windows so hours checks, My-schedule counts, and the
     reminder sweep (edge-function twin — keep in lockstep) never count
     hours they're booked off. */
  const offs = dayRows
    .filter((e) => e.kind === 'timeoff' && e.userId === userId)
    .map((e) => ({ start: tsMs(e.startAt), end: tsMs(e.endAt) }))
  if (offs.length === 0) return out
  let result = out
  for (const o of offs) {
    const next: Seg[] = []
    for (const s of result) {
      const os = Math.max(s.start, o.start)
      const oe = Math.min(s.end, o.end)
      if (oe - os < MIN_SEG_MS) {
        next.push(s)
        continue
      }
      if (os - s.start >= MIN_SEG_MS) next.push({ start: s.start, end: os })
      if (s.end - oe >= MIN_SEG_MS) next.push({ start: oe, end: s.end })
    }
    result = next
  }
  return result
}

/** Merge overlapping/abutting segments (sub-minute gaps count as joined). */
function mergeSegs(segs: Seg[]): Seg[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  const out: Seg[] = []
  for (const seg of sorted) {
    if (seg.end - seg.start < MIN_SEG_MS) continue
    const last = out[out.length - 1]
    if (last && seg.start <= last.end + MIN_SEG_MS) last.end = Math.max(last.end, seg.end)
    else out.push({ ...seg })
  }
  return out
}

function segHours(segs: Seg[]): number {
  return segs.reduce((t, s) => t + (s.end - s.start), 0) / 3_600_000
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Would-be hours if `adds` (extra shift windows, ISO timestamps on their
 * work dates) land on this person's schedule: weekly (Sun–Sat), pay
 * period, and longest consecutive on-duty run touching the addition.
 * Entries are fetched FRESH for the surrounding weeks so the numbers
 * hold regardless of what range the boards have loaded. Warnings come
 * from the Chief-set thresholds; a query failure returns a visible
 * 'check_failed' warning instead of silently passing.
 */
async function hoursCheck(
  userId: string,
  adds: { dateIso: string; startAt: string; endAt: string }[],
  subjectName = 'They',
): Promise<HoursInfo> {
  const zero: HoursInfo = { weekHours: 0, periodHours: 0, consecutiveHours: 0, warnings: [] }
  const auth = useAuthStore()
  if (auth.usingDevStub || adds.length === 0) return zero
  const t = warningThresholds()
  const anchor = adds[0].dateIso
  const weekStart = addDaysIso(anchor, -new Date(`${anchor}T00:00:00`).getDay())
  const weekEnd = addDaysIso(weekStart, 6)
  const period = payPeriodFor(anchor)
  const sortedDates = adds.map((a) => a.dateIso).sort()
  const fetchStart = [weekStart, period.start, addDaysIso(sortedDates[0], -5)].sort()[0]
  const fetchEnd = [weekEnd, period.end, addDaysIso(sortedDates[sortedDates.length - 1], 5)]
    .sort()
    .pop()!
  const res = await supabase
    .from('sched_entries')
    .select('*')
    .gte('work_date', fetchStart)
    .lte('work_date', fetchEnd)
  if (res.error) {
    return {
      ...zero,
      warnings: [
        {
          code: 'check_failed',
          hours: 0,
          limit: 0,
          message: 'Hour totals could not be verified (connection error) — thresholds were not checked.',
        },
      ],
    }
  }
  const rows = (res.data ?? []).map(mapEntry)
  // union of existing + added segments, bucketed by work date
  const byDate = new Map<string, Seg[]>()
  for (let iso = fetchStart; iso <= fetchEnd; iso = addDaysIso(iso, 1)) {
    byDate.set(iso, segsForUserOnDate(iso, userId, rows))
  }
  for (const a of adds) {
    const list = byDate.get(a.dateIso) ?? []
    list.push({ start: tsMs(a.startAt), end: tsMs(a.endAt) })
    byDate.set(a.dateIso, list)
  }
  let weekHours = 0
  let periodHours = 0
  const all: Seg[] = []
  for (const [iso, segs] of byDate) {
    const merged = mergeSegs(segs)
    const h = segHours(merged)
    if (iso >= weekStart && iso <= weekEnd) weekHours += h
    if (iso >= period.start && iso <= period.end) periodHours += h
    all.push(...merged)
  }
  const runs = mergeSegs(all)
  let consecutiveHours = 0
  for (const a of adds) {
    const s = tsMs(a.startAt)
    const en = tsMs(a.endAt)
    for (const r of runs) {
      if (s < r.end && en > r.start) {
        consecutiveHours = Math.max(consecutiveHours, (r.end - r.start) / 3_600_000)
      }
    }
  }
  const cons = round1(consecutiveHours)
  const wk = round1(weekHours)
  const warnings: HoursWarning[] = []
  if (consecutiveHours >= t.consecutiveConfirm) {
    warnings.push({
      code: 'consecutive_confirm',
      hours: cons,
      limit: t.consecutiveConfirm,
      message: `${subjectName} would be on duty ${cons} consecutive hours — at or past the ${t.consecutiveConfirm}-hour mark that needs admin sign-off.`,
    })
  } else if (consecutiveHours >= t.consecutiveWarn) {
    warnings.push({
      code: 'consecutive',
      hours: cons,
      limit: t.consecutiveWarn,
      message: `${subjectName} would be on duty ${cons} consecutive hours (warning starts at ${t.consecutiveWarn}).`,
    })
  }
  /* No "overtime" nag at 40 — normal rotation weeks run 48+ here. One
     weekly warning past the threshold (72 by default), showing the
     actual total (Justin, 2026-09-17). */
  if (weekHours > t.weeklyWarn) {
    warnings.push({
      code: 'weekly',
      hours: wk,
      limit: t.weeklyWarn,
      message: `${subjectName} would be at ${wk} hours that week (over ${t.weeklyWarn}).`,
    })
  }
  return { weekHours: wk, periodHours: round1(periodHours), consecutiveHours: cons, warnings }
}

/** hoursCheck for a 'HH:mm' window on a work date (rolls past midnight
 *  and clamps like every other window in the module). */
async function hoursCheckWindow(
  userId: string,
  dateIso: string,
  from: string,
  until: string,
  subjectName = 'They',
  /** explicit end date for overnight windows (2345–0600 the next day) —
   *  when given, the exact dates are used instead of the 0600-tour
   *  convention (Justin, 2026-09-27) */
  endDateIso?: string | null,
): Promise<HoursInfo> {
  if (endDateIso) {
    const startAt = centralTs(dateIso, from)
    const endAt = centralTs(endDateIso, until)
    if (tsMs(endAt) > tsMs(startAt)) {
      return hoursCheck(userId, [{ dateIso, startAt, endAt }], subjectName)
    }
  }
  const w = shiftWindow(dateIso, from, until)
  return hoursCheck(userId, [{ dateIso, startAt: w.reqStart, endAt: w.reqEnd }], subjectName)
}

/** Persist one settings key (global admins only, enforced by RLS). */
/** Re-pull sched_settings fresh. Settings otherwise load once per
 *  session, so a long-lived tab exports payroll with earning codes
 *  saved from another device — the Time tab calls this on every range
 *  load (Justin, 2026-09-21: codes added in Setup missing from the
 *  Paycom CSV downloaded elsewhere). */
async function reloadSettings(): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  const res = await supabase.from('sched_settings').select('key, value')
  if (res.error) return // keep what we have — fail quiet, next load retries
  const setMap: Record<string, Record<string, unknown>> = {}
  for (const r of (res.data ?? []) as { key: string; value: Record<string, unknown> }[]) {
    setMap[r.key] = r.value ?? {}
  }
  settings.value = setMap
}

async function saveSetting(key: string, value: Record<string, unknown>): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  const res = await supabase.from('sched_settings').upsert(
    { key, value, updated_by: auth.appUser?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (res.error) return res.error.message
  settings.value = { ...settings.value, [key]: value }
  audit('settings.save', `Updated ${key} settings`, { entity: 'settings', entityId: key, detail: { value } })
  return null
}

// ── leave balances ───────────────────────────────────────────────────
// Vacation + sick live HERE (HR decision 2026-09-23): the ledger holds
// credits (opening import, accruals, adjustments, write-offs) and paid
// time-off entries deduct live through the sched_leave_balances view —
// approvals, cancels, and edits all move balances with no extra writes.

export interface LeaveBalance {
  userId: string
  kind: 'vacation' | 'sick'
  credited: number
  used: number
  balance: number
}

/** Matches sched_leave_opening_asof() in SQL — time off before this
 *  date lives in Paycom's history and never deducts here. */
export const LEAVE_OPENING_ASOF = '2026-09-23'

export interface LeaveTaken {
  userId: string
  kind: 'vacation' | 'sick'
  dateIso: string
  hours: number
}

/** Full years of service as of an ISO date. */
export function serviceYears(hireDateIso: string | null | undefined, onIso: string): number {
  if (!hireDateIso) return 0
  const h = new Date(hireDateIso + 'T12:00:00')
  const o = new Date(onIso + 'T12:00:00')
  let y = o.getFullYear() - h.getFullYear()
  if (o.getMonth() < h.getMonth() || (o.getMonth() === h.getMonth() && o.getDate() < h.getDate())) y--
  return Math.max(0, y)
}

/** Vacation accrual per pay period — Paycom's field-staff table. */
export function vacationRate(hireDateIso: string | null | undefined, onIso: string): number {
  if (!hireDateIso) return 0
  const y = serviceYears(hireDateIso, onIso)
  return y >= 6 ? 8.62 : y >= 3 ? 6.47 : 4.31
}
export const SICK_RATE = 2.77

async function fetchLeaveBalances(userId?: string): Promise<LeaveBalance[]> {
  let q = supabase.from('sched_leave_balances').select('*')
  if (userId) q = q.eq('user_id', userId)
  const res = await q
  if (res.error) return []
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    kind: r.kind as 'vacation' | 'sick',
    credited: Number(r.credited),
    used: Number(r.used),
    balance: Number(r.balance),
  }))
}

async function fetchLeaveLedger(userId: string): Promise<{ kind: string; hours: number; reason: string; effectiveOn: string; note: string | null }[]> {
  const res = await supabase
    .from('sched_leave_ledger')
    .select('kind, hours, reason, effective_on, note')
    .eq('user_id', userId)
    .order('effective_on', { ascending: false })
    .limit(80)
  if (res.error) return []
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as string,
    hours: Number(r.hours),
    reason: r.reason as string,
    effectiveOn: r.effective_on as string,
    note: (r.note as string | null) ?? null,
  }))
}

/** The deduction side of the ledger, itemized: every paid time-off
 *  entry on the schedule after the opening as-of — exactly what the
 *  sched_leave_used view sums. One member's history, or the whole
 *  roster when userId is omitted (the HR Balances table). */
async function fetchLeaveTaken(userId?: string): Promise<LeaveTaken[]> {
  let q = supabase
    .from('sched_entries')
    .select('user_id, off_type, work_date, start_at, end_at')
    .eq('kind', 'timeoff')
    .in('off_type', ['vacation', 'sick'])
    .not('user_id', 'is', null)
    .gt('work_date', LEAVE_OPENING_ASOF)
    .order('work_date', { ascending: true })
  if (userId) q = q.eq('user_id', userId)
  const res = await q
  if (res.error) return []
  return ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    kind: r.off_type as 'vacation' | 'sick',
    dateIso: r.work_date as string,
    hours:
      Math.round(((tsMs(r.end_at as string) - tsMs(r.start_at as string)) / 3600e3) * 100) / 100,
  }))
}

/** Accrual that will post from pay periods closing after today and
 *  strictly before byDateIso — anniversary rate bumps included. Pure
 *  math, so roster-wide projections don't need a query per person. */
export function accruingBy(
  hireDateIso: string | null | undefined,
  fullTime: boolean,
  kind: 'vacation' | 'sick',
  byDateIso: string,
  /** HR rate overrides — null/undefined falls back to the formula */
  overrides?: { vac?: number | null; sick?: number | null },
): number {
  if (!fullTime || !hireDateIso) return 0
  let acc = 0
  let end = payPeriodFor(todayCentralIso()).end
  while (end < byDateIso) {
    acc +=
      kind === 'sick'
        ? (overrides?.sick ?? SICK_RATE)
        : (overrides?.vac ?? vacationRate(hireDateIso, end))
    end = addDaysIso(end, 14)
  }
  return Math.round(acc * 100) / 100
}

/** Matches sched_leave_catchup() in SQL — the last pay period Paycom
 *  paid out before the module took over. Catch-up accruals post for
 *  every period closing after this; hire date → this date is what an
 *  opening balance has to cover. */
export const LEAVE_PAID_THROUGH = '2026-09-12'

/** Paydays land 6 days after the period closes (Aug 2–15 paid Aug 21).
 *  Paycom awards an accrual on every payday on/after the hire date, so
 *  a hire at the start of a period banks the period that closed just
 *  before them (Justin, 2026-09-24: the 8/17 class was awarded the
 *  8/21 payday's accrual without receiving a check). */
export const PAYDAY_LAG_DAYS = 6

/** What a new full-timer should already have banked when they were
 *  never in the Paycom opening import: one accrual per pay period
 *  whose PAYDAY falls on or after their hire date, through
 *  LEAVE_PAID_THROUGH — the same period grid and payday rule as
 *  sched_leave_catchup(), which owns every period after that. */
export function openingAccrual(
  hireDateIso: string | null | undefined,
  fullTime: boolean,
  overrides?: { vac?: number | null; sick?: number | null },
): { vac: number; sick: number; periods: number } {
  if (!hireDateIso || !fullTime) return { vac: 0, sick: 0, periods: 0 }
  const cutoff = addDaysIso(hireDateIso, -PAYDAY_LAG_DAYS)
  let vac = 0
  let periods = 0
  let end = LEAVE_PAID_THROUGH
  while (end >= cutoff) {
    vac += overrides?.vac ?? vacationRate(hireDateIso, end)
    periods++
    end = addDaysIso(end, -PAY_DAYS)
  }
  const sick = periods * (overrides?.sick ?? SICK_RATE)
  return { vac: Math.round(vac * 100) / 100, sick: Math.round(sick * 100) / 100, periods }
}

/** A person's effective accrual rate today — override first, formula
 *  otherwise. */
export function effectiveRates(p: {
  hireDate?: string | null
  vacRateOverride?: number | null
  sickRateOverride?: number | null
}): { vac: number; sick: number } {
  return {
    vac: p.vacRateOverride ?? vacationRate(p.hireDate ?? null, todayCentralIso()),
    sick: p.sickRateOverride ?? SICK_RATE,
  }
}

/** HR/editor: hire date + manual accrual-rate overrides — the leave
 *  profile drawer (Justin, 2026-09-24). Null override = automatic. */
async function setLeaveProfile(
  userId: string,
  hireDate: string | null,
  vacOverride: number | null,
  sickOverride: number | null,
): Promise<string | null> {
  const res = await supabase.rpc('sched_set_leave_profile', {
    p_user: userId,
    p_hire: hireDate,
    p_vac: vacOverride,
    p_sick: sickOverride,
  })
  if (res.error) return res.error.message
  const p = personById.value.get(userId)
  if (p) {
    p.hireDate = hireDate
    p.vacRateOverride = vacOverride
    p.sickRateOverride = sickOverride
  }
  audit('leave.profile', `Updated ${displayName(userId).name} leave profile — hired ${hireDate ?? '—'}${vacOverride != null ? `, vac rate ${vacOverride}` : ''}${sickOverride != null ? `, sick rate ${sickOverride}` : ''}`, { entity: 'leave', entityId: userId })
  return null
}

/** HR/editor: opening balances for someone with no import — puts them
 *  on the Balances board; accruals start from their hire date. */
async function openLeaveBalances(userId: string, vacHours: number, sickHours: number, note?: string): Promise<string | null> {
  const auth = useAuthStore()
  const rows = [
    { kind: 'vacation', hours: vacHours },
    { kind: 'sick', hours: sickHours },
  ].map((r) => ({
    user_id: userId,
    kind: r.kind,
    hours: r.hours,
    reason: 'opening',
    effective_on: todayCentralIso(),
    note: note ?? 'Opening balance (manual — no Paycom import)',
    created_by: auth.appUser?.id ?? null,
  }))
  const ins = await supabase.from('sched_leave_ledger').insert(rows)
  if (ins.error) return ins.error.message
  // any pay periods already closed since the cutover post right away
  await supabase.rpc('sched_leave_catchup')
  audit('leave.open', `Opened leave balances for ${displayName(userId).name} — vac ${vacHours}, sick ${sickHours}`, { entity: 'leave', entityId: userId })
  return null
}

/** HR/editor: manual adjustment — true-ups and corrections. */
async function adjustLeave(userId: string, kind: 'vacation' | 'sick', hours: number, note: string): Promise<string | null> {
  const auth = useAuthStore()
  const ins = await supabase.from('sched_leave_ledger').insert({
    user_id: userId,
    kind,
    hours,
    reason: 'adjustment',
    effective_on: todayCentralIso(),
    note: note.trim() || null,
    created_by: auth.appUser?.id ?? null,
  })
  if (ins.error) return ins.error.message
  audit('leave.adjust', `Adjusted ${displayName(userId).name} ${kind} by ${hours > 0 ? '+' : ''}${hours} hrs${note ? ` — ${note}` : ''}`, { entity: 'leave', entityId: userId })
  return null
}

/** Balance projected to a future date: today's number plus the accrual
 *  from every pay period that will close before that date (rate bumps
 *  at anniversaries included). A request months out is judged against
 *  what the employee will actually have by then, not just today. */
async function projectedLeaveBalance(
  userId: string,
  kind: 'vacation' | 'sick',
  byDateIso: string,
): Promise<{ today: number; accruing: number; projected: number }> {
  const today = (await fetchLeaveBalances(userId)).find((b) => b.kind === kind)?.balance ?? 0
  const p = personById.value.get(userId)
  const accruing = accruingBy(p?.hireDate, p?.employmentType === 'full_time', kind, byDateIso, {
    vac: p?.vacRateOverride,
    sick: p?.sickRateOverride,
  })
  return { today, accruing, projected: Math.round((today + accruing) * 100) / 100 }
}

/** Hours already committed to PENDING paid time-off requests. */
function pendingLeaveHours(userId: string, kind: string): number {
  return requests.value
    .filter((r) => r.requesterId === userId && r.type === 'time_off' && r.status === 'pending' && r.offType === kind && r.startAt && r.endAt)
    .reduce((k, r) => k + (tsMs(r.endAt as string) - tsMs(r.startAt as string)) / 3600e3, 0)
}

// ── request mutations ────────────────────────────────────────────────

interface TimeOffDay {
  dateIso: string
  from: string // 'HH:mm' | '06:00' for full
  until: string
  seatId: string | null
}

async function createTimeOffRequests(
  offType: string,
  daysReq: TimeOffDay[],
  comments: string,
): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  const rows = daysReq.map((d) => {
    const w = shiftWindow(d.dateIso, d.from, d.until)
    return {
      type: 'time_off',
      requester_id: me,
      seat_id: d.seatId,
      work_date: d.dateIso,
      start_at: w.reqStart,
      end_at: w.reqEnd,
      off_type: offType,
      comments: comments || null,
    }
  })
  /* Paid time off is hard-blocked past the balance (HR rule, 9/23) —
     admins can still assign over the line from the day editors, which
     warns and goes negative deliberately. */
  if (offType === 'vacation' || offType === 'sick') {
    const reqHrs = daysReq.reduce((k, d) => {
      const w = shiftWindow(d.dateIso, d.from, d.until)
      return k + (tsMs(w.reqEnd) - tsMs(w.reqStart)) / 3600e3
    }, 0)
    const lastDay = daysReq.reduce((m, d) => (d.dateIso > m ? d.dateIso : m), daysReq[0].dateIso)
    const proj = await projectedLeaveBalance(me, offType, lastDay)
    const pending = pendingLeaveHours(me, offType)
    if (reqHrs > proj.projected - pending + 0.01) {
      return `Not enough ${OFF_LABELS[offType] ?? offType}: your balance is ${proj.today.toFixed(1)} hrs${proj.accruing > 0 ? ` (${proj.projected.toFixed(1)} by ${lastDay} counting accruals)` : ''}${pending > 0 ? ` with ${pending.toFixed(1)} already pending` : ''} and this request needs ${reqHrs.toFixed(1)}. Shorten it or request Unpaid Time Off.`
    }
  }
  const res = await supabase.from('sched_requests').insert(rows).select('id')
  if (res.error) return res.error.message
  notify('request_submitted', { requestIds: ((res.data ?? []) as { id: string }[]).map((r) => r.id) })
  audit('request.time_off', `Requested ${OFF_LABELS[offType] ?? offType} time off — ${daysReq.length === 1 ? daysReq[0].dateIso : `${daysReq.length} days from ${daysReq[0].dateIso}`}`, { entity: 'request' })
  await loadRequests()
  return null
}

async function createExtraRequest(opts: {
  dateIso: string
  /** explicit end date so overnight windows are unambiguous — 2345 to
   *  0600 THE NEXT DAY carries its own date (Justin, 2026-09-27);
   *  omitted/equal dates fall back to the 0600-tour convention */
  endDateIso?: string | null
  from: string
  until: string
  unitId: string | null
  positionLabel: string
  timeType: string
  comments: string
  warnings?: HoursWarning[]
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  let reqStart: string
  let reqEnd: string
  if (opts.endDateIso && opts.endDateIso !== opts.dateIso) {
    reqStart = centralTs(opts.dateIso, opts.from)
    reqEnd = centralTs(opts.endDateIso, opts.until)
    const span = tsMs(reqEnd) - tsMs(reqStart)
    if (span <= 0) return 'The end date/time lands before the start — check the dates.'
    if (span > 48 * 3600e3) return 'That window is longer than 48 hours — check the end date.'
  } else {
    const w = shiftWindow(opts.dateIso, opts.from, opts.until)
    reqStart = w.reqStart
    reqEnd = w.reqEnd
  }
  const unit = units.value.find((u) => u.id === opts.unitId)
  const res = await supabase.from('sched_requests').insert({
    type: 'extra_hours',
    requester_id: me,
    work_date: opts.dateIso,
    start_at: reqStart,
    end_at: reqEnd,
    time_type: opts.timeType,
    unit_code: unit?.code ?? null,
    position_label: opts.positionLabel || null,
    comments: opts.comments || null,
    warnings: opts.warnings ?? [],
  }).select('id')
  if (res.error) return res.error.message
  notify('request_submitted', { requestIds: ((res.data ?? []) as { id: string }[]).map((r) => r.id) })
  audit('request.extra', `Requested extra hours ${opts.dateIso} ${opts.from}–${opts.until}${unit ? ` on ${unit.code}` : ''} (${opts.timeType})`, { entity: 'request' })
  await loadRequests()
  return null
}

async function createPickupRequest(opts: {
  dateIso: string
  seatId: string | null // null = special-event slot (entryId required)
  entryId: string | null
  from: string
  until: string
  comments: string
  positionLabel?: string
  warnings?: HoursWarning[]
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  const w0 = shiftWindow(opts.dateIso, opts.from, opts.until)
  if (opts.seatId) {
    const q = await canFillSeat(me, opts.seatId, 'You', {
      dateIso: opts.dateIso,
      startAt: w0.reqStart,
      endAt: w0.reqEnd,
    })
    if (!q.ok) return q.reason
  }
  // Re-validate a referenced open entry FRESH: a board left open while
  // the shift got filled or reshaped elsewhere would otherwise file a
  // request against a deleted row (raw FK error from Postgres).
  if (opts.entryId) {
    const fres = await supabase
      .from('sched_entries')
      .select('id, status')
      .eq('id', opts.entryId)
      .maybeSingle()
    if (fres.error) return fres.error.message
    if (!fres.data || fres.data.status !== 'open') {
      await reloadRangeIfLoaded()
      return 'That open shift is no longer available — the board has changed (it may have just been filled). The board has refreshed; try again from the current view.'
    }
  }
  const w = w0
  const seat = seats.value.find((s) => s.id === opts.seatId)
  const unit = units.value.find((u) => u.id === seat?.unitId)
  const qw = await qualWarnings(
    me,
    opts.seatId,
    { dateIso: opts.dateIso, startAt: w.reqStart, endAt: w.reqEnd },
    displayName(me).name || 'The requester',
  )
  const res = await supabase.from('sched_requests').insert({
    type: 'pickup',
    requester_id: me,
    seat_id: opts.seatId,
    entry_id: opts.entryId,
    work_date: opts.dateIso,
    start_at: w.reqStart,
    end_at: w.reqEnd,
    unit_code: unit?.code ?? null,
    position_label: seat?.label ?? opts.positionLabel ?? null,
    comments: opts.comments || null,
    warnings: [...(opts.warnings ?? []), ...qw],
  }).select('id')
  if (res.error) return res.error.message
  notify('request_submitted', { requestIds: ((res.data ?? []) as { id: string }[]).map((r) => r.id) })
  audit('request.pickup', `Requested pickup — ${unit?.code ?? 'event/rider slot'}${seat ? ` ${seat.label}` : ''} ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'request' })
  await loadRequests()
  return null
}

// ── trades board (giveaways + swaps) ─────────────────────────────────

const tradeOffers = ref<TradeOffer[]>([])

async function loadTradeOffers(): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return
  const res = await supabase
    .from('sched_trade_offers')
    .select('*')
    .order('created_at')
    .limit(500)
  if (res.error) {
    loadError.value = res.error.message
    return
  }
  tradeOffers.value = (res.data ?? []).map((r) => ({
    id: r.id,
    requestId: r.request_id,
    userId: r.user_id,
    offerSeatId: r.offer_seat_id,
    offerWorkDate: r.offer_work_date,
    offerStartAt: r.offer_start_at,
    offerEndAt: r.offer_end_at,
    note: r.note,
    status: r.status,
  }))
}

/** Trades and giveaways close at shift start — once the hours are being
 *  worked there is nothing left to swap. A 0900 giveaway accepted at
 *  1602 sent the Chief an URGENT same-day text for a shift that was
 *  mostly over (Justin, 2026-09-25). */
function tradeClosedReason(startAt?: string | null, workDate?: string | null): string | null {
  const ms = startAt ? tsMs(startAt) : workDate ? tsMs(centralTs(workDate, '06:00')) : null
  return ms !== null && ms <= Date.now()
    ? 'This shift has already started — trades and giveaways close at shift start.'
    : null
}

async function createTradePosting(opts: {
  type: 'giveaway' | 'trade'
  dateIso: string
  seatId: string
  from: string
  until: string
  comments: string
  /** Send directly to one member instead of the public board — they
   *  accept/decline (or offer a swap shift back) before the Chief. */
  toUserId?: string | null
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  if (opts.toUserId) {
    if (opts.toUserId === me) return 'Pick someone other than yourself.'
    // The target ends up covering the poster's seat either way — check
    // the qualification up front, not after they've agreed.
    const q = await canFillSeat(
      opts.toUserId,
      opts.seatId,
      displayName(opts.toUserId).name || 'They',
      { dateIso: opts.dateIso, startAt: w.reqStart, endAt: w.reqEnd },
    )
    if (!q.ok) return q.reason
  }
  const closed = tradeClosedReason(w.reqStart, null)
  if (closed) return closed
  const seat = seats.value.find((s) => s.id === opts.seatId)
  const unit = units.value.find((u) => u.id === seat?.unitId)
  const res = await supabase
    .from('sched_requests')
    .insert({
      type: opts.type,
      requester_id: me,
      counterparty_id: opts.toUserId ?? null,
      seat_id: opts.seatId,
      work_date: opts.dateIso,
      start_at: w.reqStart,
      end_at: w.reqEnd,
      unit_code: unit?.code ?? null,
      position_label: seat?.label ?? null,
      comments: opts.comments || null,
    })
    .select('id')
    .single()
  if (res.error) return res.error.message
  const label = opts.type === 'trade' ? 'swap' : 'giveaway'
  if (opts.toUserId) {
    audit(`request.${opts.type}`, `Sent a ${label} directly to ${displayName(opts.toUserId).name} — ${unit?.code ?? ''} ${seat?.label ?? ''} ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'request', entityId: res.data.id })
    notify('trade_activity', { requestId: res.data.id, event: 'direct_request' })
  } else {
    audit(`request.${opts.type}`, `Posted a ${label} — ${unit?.code ?? ''} ${seat?.label ?? ''} ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'request', entityId: res.data.id })
  }
  await loadRequests()
  return null
}

/** The member a giveaway/swap was sent to answers it. Accepting a
 *  giveaway moves it straight to the Chief's queue; declining either
 *  kind hands it back to the poster (cancelled, with the reason on the
 *  card). A directed SWAP is accepted by offering a shift back
 *  (makeOffer), not here. */
async function respondToDirect(req: SchedRequest, accept: boolean): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  if (req.counterpartyId !== me) return 'This request was sent to someone else.'
  if (req.status !== 'pending') return 'This request has already been resolved.'
  if (accept) {
    if (req.type !== 'giveaway') return 'Accept a swap by offering one of your shifts back.'
    const closed = tradeClosedReason(req.startAt, req.workDate)
    if (closed) return closed
    const warnings: HoursWarning[] = []
    if (req.workDate && req.startAt && req.endAt) {
      const info = await hoursCheck(
        me,
        [{ dateIso: req.workDate, startAt: req.startAt, endAt: req.endAt }],
        displayName(me).name || 'The claimant',
      )
      warnings.push(...info.warnings)
      warnings.push(
        ...(await qualWarnings(
          me,
          req.seatId,
          { dateIso: req.workDate, startAt: req.startAt, endAt: req.endAt },
          displayName(me).name || 'The claimant',
        )),
      )
    }
    const res = await supabase
      .from('sched_requests')
      .update({ status: 'partner_accepted', warnings, updated_at: new Date().toISOString() })
      .eq('id', req.id)
      .eq('status', 'pending')
    if (res.error) return res.error.message
    audit('trade.accept', `Accepted ${displayName(req.requesterId).name}'s giveaway sent to them directly`, { entity: 'request', entityId: req.id })
    notify('request_submitted', { requestIds: [req.id] })
    notify('trade_activity', { requestId: req.id, event: 'direct_accepted' })
  } else {
    const res = await supabase
      .from('sched_requests')
      .update({
        status: 'cancelled',
        decision_note: `Declined by ${displayName(me).name}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.id)
      .eq('status', 'pending')
    if (res.error) return res.error.message
    audit('trade.decline', `Declined a ${req.type === 'trade' ? 'swap' : 'giveaway'} ${displayName(req.requesterId).name} sent them directly`, { entity: 'request', entityId: req.id })
    notify('trade_activity', { requestId: req.id, event: 'direct_declined' })
  }
  await loadRequests()
  return null
}

async function makeOffer(opts: {
  requestId: string
  offerShift: { dateIso: string; seatId: string; from?: string; until?: string } | null
  note: string
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  // taking/covering the posted shift means filling the poster's seat
  const posting = requests.value.find((r) => r.id === opts.requestId)
  if (posting?.counterpartyId && posting.counterpartyId !== me && posting.status === 'pending') {
    return 'That request was sent directly to someone else.'
  }
  if (posting?.seatId) {
    const q = await canFillSeat(
      me,
      posting.seatId,
      'You',
      posting.workDate
        ? { dateIso: posting.workDate, startAt: posting.startAt, endAt: posting.endAt }
        : undefined,
    )
    if (!q.ok) return q.reason
  }
  if (posting) {
    const closed = tradeClosedReason(posting.startAt, posting.workDate)
    if (closed) return closed
  }
  /* GIVEAWAYS SKIP THE POSTER-ACCEPT STEP (Justin, 2026-09-28): the
     poster already said "anyone take it" — there's nothing for them to
     weigh, so the first claim goes STRAIGHT to the Chief's queue.
     Swaps keep the offer/accept dance (the poster must judge what's
     offered back). RLS: the "giveaway claim" policy admits exactly
     this pending→partner_accepted self-claim transition. */
  if (posting && posting.type === 'giveaway' && !opts.offerShift) {
    const warnings: HoursWarning[] = []
    if (posting.workDate && posting.startAt && posting.endAt) {
      const info = await hoursCheck(
        me,
        [{ dateIso: posting.workDate, startAt: posting.startAt, endAt: posting.endAt }],
        displayName(me).name || 'The claimant',
      )
      warnings.push(...info.warnings)
      warnings.push(
        ...(await qualWarnings(
          me,
          posting.seatId,
          { dateIso: posting.workDate, startAt: posting.startAt, endAt: posting.endAt },
          displayName(me).name || 'The claimant',
        )),
      )
    }
    const res = await supabase
      .from('sched_requests')
      .update({
        counterparty_id: me,
        status: 'partner_accepted',
        warnings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', posting.id)
      .eq('status', 'pending')
      .select('id')
    if (res.error) return res.error.message
    if (!res.data || res.data.length === 0) {
      await loadRequests()
      return 'Someone beat you to this giveaway — it has already been claimed.'
    }
    audit('trade.claim', `Claimed ${displayName(posting.requesterId).name}'s giveaway — straight to the Chief's queue`, { entity: 'request', entityId: posting.id })
    notify('request_submitted', { requestIds: [posting.id] })
    notify('trade_activity', { requestId: posting.id, event: 'direct_accepted' })
    await Promise.all([loadRequests(), loadTradeOffers()])
    return null
  }
  let offerFields: Record<string, unknown> = {}
  if (opts.offerShift) {
    // The offerer picks which part of their shift they're putting up —
    // dates AND times (defaults to the whole 0600 tour).
    const w = shiftWindow(
      opts.offerShift.dateIso,
      opts.offerShift.from ?? '06:00',
      opts.offerShift.until ?? '06:00',
    )
    offerFields = {
      offer_seat_id: opts.offerShift.seatId,
      offer_work_date: opts.offerShift.dateIso,
      offer_start_at: w.reqStart,
      offer_end_at: w.reqEnd,
    }
  }
  const res = await supabase.from('sched_trade_offers').insert({
    request_id: opts.requestId,
    user_id: me,
    note: opts.note || null,
    ...offerFields,
  })
  if (res.error) {
    return res.error.message.includes('duplicate')
      ? 'You already have an offer on this posting.'
      : res.error.message
  }
  audit('trade.offer', opts.offerShift ? `Offered a swap shift (${opts.offerShift.dateIso}) on a posting` : 'Offered to take a posted shift', { entity: 'request', entityId: opts.requestId })
  notify('trade_activity', { requestId: opts.requestId, event: 'offer' })
  await loadTradeOffers()
  return null
}

async function withdrawOffer(offerId: string): Promise<string | null> {
  const res = await supabase
    .from('sched_trade_offers')
    .update({ status: 'withdrawn' })
    .eq('id', offerId)
  if (res.error) return res.error.message
  audit('trade.withdraw', 'Withdrew a swap offer', { entity: 'request' })
  await loadTradeOffers()
  return null
}

/** Poster accepts one offer → request moves to the Chief's queue.
 *  Hour-threshold warnings for whoever GAINS hours are computed here and
 *  stored on the request so the Chief's approval card shows them. */
async function acceptOffer(req: SchedRequest, offer: TradeOffer): Promise<string | null> {
  const closed = tradeClosedReason(req.startAt, req.workDate)
  if (closed) return closed
  /* BOTH legs of a swap get the eligibility check (the claimant was
     vetted at offer time against the poster's seat; the poster covers
     the OFFERED seat and was never checked before 2026-10-01). */
  if (offer.offerSeatId && offer.offerWorkDate) {
    // acceptOffer runs as the poster — 'You' addresses them correctly
    const q = await canFillSeat(req.requesterId, offer.offerSeatId, 'You', {
      dateIso: offer.offerWorkDate,
      startAt: offer.offerStartAt,
      endAt: offer.offerEndAt,
    })
    if (!q.ok) return q.reason
  }
  const warnings: HoursWarning[] = []
  if (req.workDate && req.startAt && req.endAt) {
    const who = personById.value.get(offer.userId)?.fullName ?? 'The claimant'
    const info = await hoursCheck(
      offer.userId,
      [{ dateIso: req.workDate, startAt: req.startAt, endAt: req.endAt }],
      who,
    )
    warnings.push(...info.warnings)
    warnings.push(
      ...(await qualWarnings(
        offer.userId,
        req.seatId,
        { dateIso: req.workDate, startAt: req.startAt, endAt: req.endAt },
        who,
      )),
    )
  }
  if (offer.offerWorkDate && offer.offerStartAt && offer.offerEndAt) {
    const who = personById.value.get(req.requesterId)?.fullName ?? 'The poster'
    const info = await hoursCheck(
      req.requesterId,
      [{ dateIso: offer.offerWorkDate, startAt: offer.offerStartAt, endAt: offer.offerEndAt }],
      who,
    )
    warnings.push(...info.warnings)
    warnings.push(
      ...(await qualWarnings(
        req.requesterId,
        offer.offerSeatId,
        { dateIso: offer.offerWorkDate, startAt: offer.offerStartAt, endAt: offer.offerEndAt },
        who,
      )),
    )
  }
  const up1 = await supabase
    .from('sched_trade_offers')
    .update({ status: 'accepted' })
    .eq('id', offer.id)
  if (up1.error) return up1.error.message
  const up2 = await supabase
    .from('sched_requests')
    .update({
      counterparty_id: offer.userId,
      counter_seat_id: offer.offerSeatId,
      counter_work_date: offer.offerWorkDate,
      counter_start_at: offer.offerStartAt,
      counter_end_at: offer.offerEndAt,
      status: 'partner_accepted',
      warnings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.id)
  if (up2.error) return up2.error.message
  audit('trade.accept', `Accepted ${displayName(offer.userId).name}'s offer on their ${req.type === 'trade' ? 'swap' : 'giveaway'} posting`, { entity: 'request', entityId: req.id })
  notify('request_submitted', { requestIds: [req.id] })
  notify('trade_activity', { requestId: req.id, event: 'accepted', offerUserId: offer.userId })
  await Promise.all([loadRequests(), loadTradeOffers()])
  return null
}

async function declineOffer(offerId: string): Promise<string | null> {
  const offer = tradeOffers.value.find((o) => o.id === offerId)
  const res = await supabase
    .from('sched_trade_offers')
    .update({ status: 'declined' })
    .eq('id', offerId)
  if (res.error) return res.error.message
  audit('trade.decline', 'Declined a swap offer', { entity: 'request' })
  if (offer) notify('trade_activity', { requestId: offer.requestId, event: 'declined', offerUserId: offer.userId })
  await loadTradeOffers()
  return null
}

/**
 * Remove a person's coverage on a seat for a window [winStart, winEnd)
 * (epoch ms). Their overlapping override rows are deleted and re-inserted
 * trimmed to the parts outside the window; when they hold the seat via
 * bare rotation (no overrides on the seat at all), the held window is the
 * whole work date and explicit remainder rows are written. Returns the
 * segments of the window they ACTUALLY held — callers write open / off /
 * cover rows only for those, never for hours someone else covers.
 */
async function carveSeatWindow(
  dateIso: string,
  seatId: string,
  userId: string,
  winStart: number,
  winEnd: number,
): Promise<{ segs: Seg[]; error: string | null }> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { segs: [], error: 'Not available in the dev preview.' }
  // Read the seat's rows FRESH — approvals can target dates outside the
  // loaded range, and a stale view must never decide what gets deleted.
  const fres = await supabase
    .from('sched_entries')
    .select('*')
    .eq('work_date', dateIso)
    .eq('seat_id', seatId)
  if (fres.error) return { segs: [], error: fres.error.message }
  const seatEntries = (fres.data ?? [])
    .map(mapEntry)
    .filter((e) => e.kind !== 'timeoff' && e.status !== 'off')
  const mine = seatEntries.filter((e) => e.userId === userId)
  const segs: Seg[] = []

  if (mine.length === 0) {
    // Bare rotation holder only when the seat has NO overrides at all.
    if (seatEntries.length === 0 && seatRotationOccupant(seatId, dateIso) === userId) {
      const seatRec = seats.value.find((s2) => s2.id === seatId)
      const unit = seatRec ? units.value.find((u) => u.id === seatRec.unitId) : null
      const uw = unitDayWindow(unit, dateIso)
      const dayStart = tsMs(uw.startTs)
      const dayEnd = tsMs(uw.endTs)
      const s = Math.max(dayStart, winStart)
      const en = Math.min(dayEnd, winEnd)
      if (en - s >= MIN_SEG_MS) {
        const keep: Record<string, unknown>[] = []
        if (s - dayStart >= MIN_SEG_MS) {
          keep.push({ work_date: dateIso, seat_id: seatId, user_id: userId,
            start_at: new Date(dayStart).toISOString(), end_at: new Date(s).toISOString(),
            kind: 'rotation', status: 'scheduled' })
        }
        if (dayEnd - en >= MIN_SEG_MS) {
          keep.push({ work_date: dateIso, seat_id: seatId, user_id: userId,
            start_at: new Date(en).toISOString(), end_at: new Date(dayEnd).toISOString(),
            kind: 'rotation', status: 'scheduled' })
        }
        if (keep.length > 0) {
          const ins = await supabase.from('sched_entries').insert(keep)
          if (ins.error) return { segs: [], error: ins.error.message }
        }
        segs.push({ start: s, end: en })
      }
    }
    return { segs, error: null }
  }

  for (const e of mine) {
    const es = tsMs(e.startAt)
    const ee = tsMs(e.endAt)
    const s = Math.max(es, winStart)
    const en = Math.min(ee, winEnd)
    if (en - s < MIN_SEG_MS) continue // no real overlap — leave the row alone
    const del = await supabase.from('sched_entries').delete().eq('id', e.id)
    if (del.error) return { segs, error: del.error.message }
    const keep: Record<string, unknown>[] = []
    if (s - es >= MIN_SEG_MS) {
      keep.push({ work_date: dateIso, seat_id: seatId, user_id: userId,
        start_at: e.startAt, end_at: new Date(s).toISOString(),
        kind: e.kind, status: e.status, note: e.note })
    }
    if (ee - en >= MIN_SEG_MS) {
      keep.push({ work_date: dateIso, seat_id: seatId, user_id: userId,
        start_at: new Date(en).toISOString(), end_at: e.endAt,
        kind: e.kind, status: e.status, note: e.note })
    }
    if (keep.length > 0) {
      const ins = await supabase.from('sched_entries').insert(keep)
      if (ins.error) return { segs, error: ins.error.message }
    }
    segs.push({ start: s, end: en })
  }
  return { segs, error: null }
}

/**
 * Put a person off for a window of their work date. Their coverage in
 * the window is carved out (splits and partials handled) and each hour
 * they actually held posts as an OPEN entry; an off-record row for the
 * requested window is written for reports either way. Used by time-off
 * approval and the Chief's day editor.
 */
/** TIME OFF FOLLOWS THE PERSON (2026-09-25): one user-level record —
 *  no seat pin, no materialized open rows. The boards derive the open
 *  window from it live (dayModel), so swaps can move people freely and
 *  the off hours travel with them; deleting the record restores their
 *  original coverage automatically because nothing was carved away. */
async function applyTimeOff(
  workDate: string,
  userId: string,
  offType: string | null,
  startAt: string,
  endAt: string,
  sourceRequest: string | null,
): Promise<string | null> {
  const ins = await supabase.from('sched_entries').insert({
    work_date: workDate, seat_id: null, user_id: userId,
    start_at: startAt, end_at: endAt, kind: 'timeoff', status: 'off',
    off_type: offType, source_request: sourceRequest,
  })
  return ins.error ? ins.error.message : null
}

/** Editor: record time off for a member directly — no request to
 *  approve and NO seat/board changes. Built for "left sick mid-shift,
 *  the seat's already covered" (Chief, 2026-09-25): the cover stays
 *  exactly as assigned; this books the hours so the balance deducts,
 *  the day's Time Off list shows it, and the member is notified. When
 *  the seat SHOULD open up for pickup instead, use Mark off on the
 *  person's row. */
async function assignTimeOff(
  userId: string,
  dateIso: string,
  offType: string,
  from: string,
  until: string,
): Promise<string | null> {
  const w = shiftWindow(dateIso, from, until)
  const err = await applyTimeOff(dateIso, userId, offType, w.reqStart, w.reqEnd, null)
  if (err) return err
  const who = displayName(userId).name
  const label = OFF_LABELS[offType] ?? 'Time off'
  audit('timeoff.assign', `Recorded ${label.toLowerCase()} time off for ${who} — ${dateIso} ${from}–${until} (entered directly, no request)`, { entity: 'leave', entityId: userId })
  notify('schedule_change', { userId, summary: `${label} time off recorded for you — ${dateIso}, ${from}–${until}.` })
  await reloadRangeIfLoaded()
  return null
}

/** Hand a shift window from one person to another on a seat. The
 *  outgoing person's coverage in the window is carved out (splits and
 *  override rows handled — nothing left behind), and the new person
 *  covers exactly the hours that were carved. */
async function coverShift(
  workDate: string,
  seatId: string,
  fromUserId: string,
  toUserId: string,
  startAt: string,
  endAt: string,
  kind: string,
  note: string,
  sourceRequest: string | null,
): Promise<string | null> {
  const { segs, error } = await carveSeatWindow(
    workDate, seatId, fromUserId, tsMs(startAt), tsMs(endAt),
  )
  if (error) return error
  if (segs.length === 0) {
    return 'They no longer hold that shift window — the board has changed.'
  }
  const rows = segs.map((seg) => ({
    work_date: workDate,
    seat_id: seatId,
    user_id: toUserId,
    start_at: new Date(seg.start).toISOString(),
    end_at: new Date(seg.end).toISOString(),
    kind,
    status: 'scheduled',
    note,
    source_request: sourceRequest,
  }))
  const ins = await supabase.from('sched_entries').insert(rows)
  return ins.error ? ins.error.message : null
}

/** Editor path: put someone straight onto an open seat (no request).
 *  The open entry is re-validated FRESH from the database so a stale
 *  view errors loudly instead of silently dropping or double-booking. */
/** Cut [cutS,cutE) out of a segment list (MIN_SEG_MS slivers drop). */
function cutSegs(segs: Seg[], cutS: number, cutE: number): Seg[] {
  const next: Seg[] = []
  for (const s of segs) {
    const os = Math.max(s.start, cutS)
    const oe = Math.min(s.end, cutE)
    if (oe - os < MIN_SEG_MS) {
      next.push(s)
      continue
    }
    if (os - s.start >= MIN_SEG_MS) next.push({ start: s.start, end: os })
    if (s.end - oe >= MIN_SEG_MS) next.push({ start: oe, end: s.end })
  }
  return next
}

/**
 * Claim a window on a seat whose "open" is DERIVED — a time-off carve,
 * a dedupe leftover, or a bare gap — rather than backed by an open row.
 * Claimable = the requested window minus everyone's STANDING coverage
 * (scheduled rows minus each holder's own time off): the same math the
 * boards draw, so whatever renders open (or sits as an invisible gap)
 * is exactly what can be claimed. A bare-rotation seat carves the
 * occupant's remainder first so their kept hours stay explicit; a
 * truly unheld rotation seat keeps its leftover window visible as
 * open rows.
 * Born of Fulton's covered day (9/22, fixed 2026-09-29): Dodd worked
 * the off-carved half but the old guard refused because "rows exist
 * on the seat" — which is true of every derived open ever.
 */
async function claimSeatWindow(
  dateIso: string,
  seatId: string,
  userId: string,
  reqStart: number,
  reqEnd: number,
  meta: { kind?: string; note?: string | null; sourceRequest?: string | null } = {},
): Promise<{ claimed: Seg[]; error: null } | { claimed: null; error: string }> {
  const [rowsRes, offsRes] = await Promise.all([
    supabase.from('sched_entries').select('*').eq('work_date', dateIso).eq('seat_id', seatId),
    supabase.from('sched_entries').select('*').eq('work_date', dateIso).eq('kind', 'timeoff'),
  ])
  if (rowsRes.error) return { claimed: null, error: rowsRes.error.message }
  if (offsRes.error) return { claimed: null, error: offsRes.error.message }
  const seatRows = (rowsRes.data ?? [])
    .map(mapEntry)
    .filter((r) => r.kind !== 'timeoff' && r.status !== 'off')
  const offs = (offsRes.data ?? []).map(mapEntry)
  const offsFor = (uid: string | null): Seg[] =>
    uid
      ? offs
          .filter((o) => o.userId === uid)
          .map((o) => ({ start: tsMs(o.startAt), end: tsMs(o.endAt) }))
      : []

  const seatRec = seats.value.find((s2) => s2.id === seatId)
  const unit = seatRec ? units.value.find((u) => u.id === seatRec.unitId) : null
  const uw = unitDayWindow(unit, dateIso)
  const uS = tsMs(uw.startTs)
  const uE = tsMs(uw.endTs)
  /* Bounds: a bare seat claims inside its unit window; once rows exist
     the day may legitimately hold anything inside the 0600 work date. */
  const boundS = seatRows.length > 0 ? tsMs(centralTs(dateIso, '06:00')) : uS
  const boundE = seatRows.length > 0 ? tsMs(centralTs(addDaysIso(dateIso, 1), '06:00')) : uE

  let standing: Seg[] = []
  for (const r of seatRows) {
    if (r.status !== 'scheduled' || !r.userId) continue
    let segs: Seg[] = [{ start: tsMs(r.startAt), end: tsMs(r.endAt) }]
    for (const o of offsFor(r.userId)) segs = cutSegs(segs, o.start, o.end)
    standing.push(...segs)
  }
  const rotOcc = seatRows.length === 0 ? seatRotationOccupant(seatId, dateIso) : null
  if (rotOcc) {
    let segs: Seg[] = [{ start: uS, end: uE }]
    for (const o of offsFor(rotOcc)) segs = cutSegs(segs, o.start, o.end)
    standing.push(...segs)
  }
  standing = mergeSegs(standing)

  let claim: Seg[] = [{ start: Math.max(boundS, reqStart), end: Math.min(boundE, reqEnd) }]
  claim = claim.filter((s) => s.end - s.start >= MIN_SEG_MS)
  for (const s of standing) claim = cutSegs(claim, s.start, s.end)
  if (claim.length === 0) {
    await reloadRangeIfLoaded()
    return { claimed: null, error: 'That whole window is already covered on this seat — refresh and check the day.' }
  }

  if (rotOcc) {
    // keep the occupant's remaining hours as explicit rows before the
    // claim lands (once rows exist, bare rotation stops rendering)
    for (const cseg of claim) {
      const cv = await carveSeatWindow(dateIso, seatId, rotOcc, cseg.start, cseg.end)
      if (cv.error) return { claimed: null, error: cv.error }
    }
  }

  const inserts: Record<string, unknown>[] = claim.map((s) => ({
    work_date: dateIso,
    seat_id: seatId,
    user_id: userId,
    start_at: new Date(s.start).toISOString(),
    end_at: new Date(s.end).toISOString(),
    kind: meta.kind ?? 'pickup',
    status: 'scheduled',
    note: meta.note ?? null,
    source_request: meta.sourceRequest ?? null,
  }))
  if (seatRows.length === 0 && !rotOcc) {
    // truly unheld rotation seat: keep the unclaimed leftovers visible
    const first = claim[0]
    const last = claim[claim.length - 1]
    if (first.start - uS >= MIN_SEG_MS)
      inserts.push({ work_date: dateIso, seat_id: seatId, user_id: null,
        start_at: uw.startTs, end_at: new Date(first.start).toISOString(),
        kind: 'rotation', status: 'open' })
    if (uE - last.end >= MIN_SEG_MS)
      inserts.push({ work_date: dateIso, seat_id: seatId, user_id: null,
        start_at: new Date(last.end).toISOString(), end_at: uw.endTs,
        kind: 'rotation', status: 'open' })
  }
  const ins = await supabase.from('sched_entries').insert(inserts)
  if (ins.error) return { claimed: null, error: ins.error.message }
  return { claimed: claim, error: null }
}

async function assignOpenSeat(opts: {
  dateIso: string
  seatId: string
  entryId: string | null
  userId: string
  from: string
  until: string
}): Promise<string | null> {
  const STALE = 'That open shift is no longer available — the board has changed. Refresh and try again.'
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  let actualFrom = opts.from.replace(':', '')
  let actualUntil = opts.until.replace(':', '')
  if (opts.entryId) {
    const fres = await supabase
      .from('sched_entries')
      .select('*')
      .eq('id', opts.entryId)
      .maybeSingle()
    if (fres.error) return fres.error.message
    if (!fres.data || fres.data.status !== 'open') {
      await reloadRangeIfLoaded()
      return STALE
    }
    const openEntry = mapEntry(fres.data)
    const oStart = tsMs(openEntry.startAt)
    const oEnd = tsMs(openEntry.endAt)
    const rStart = Math.max(oStart, tsMs(w.reqStart))
    const rEnd = Math.min(oEnd, tsMs(w.reqEnd))
    if (rEnd - rStart < MIN_SEG_MS) {
      return 'The requested window does not overlap that open shift.'
    }
    actualFrom = hhmm(new Date(rStart).toISOString())
    actualUntil = hhmm(new Date(rEnd).toISOString())
    if (rStart - oStart < MIN_SEG_MS && oEnd - rEnd < MIN_SEG_MS) {
      // full window: claim the open row in place
      const upd = await supabase
        .from('sched_entries')
        .update({
          user_id: opts.userId,
          status: 'scheduled',
          kind: 'pickup',
          updated_at: new Date().toISOString(),
        })
        .eq('id', opts.entryId)
      if (upd.error) return upd.error.message
    } else {
      const rows: Record<string, unknown>[] = [
        { work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.userId,
          start_at: new Date(rStart).toISOString(), end_at: new Date(rEnd).toISOString(),
          kind: 'pickup', status: 'scheduled' },
      ]
      if (rStart - oStart >= MIN_SEG_MS) {
        rows.push({ work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
          start_at: openEntry.startAt, end_at: new Date(rStart).toISOString(),
          kind: openEntry.kind, status: 'open' })
      }
      if (oEnd - rEnd >= MIN_SEG_MS) {
        rows.push({ work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
          start_at: new Date(rEnd).toISOString(), end_at: openEntry.endAt,
          kind: openEntry.kind, status: 'open' })
      }
      const ins = await supabase.from('sched_entries').insert(rows)
      if (ins.error) return ins.error.message
      const del = await supabase.from('sched_entries').delete().eq('id', opts.entryId)
      if (del.error) return del.error.message
    }
  } else {
    /* Seat-derived open — a time-off carve, a dedupe leftover, or a
       bare gap. No backing row exists, so claim against the STANDING
       coverage math instead of demanding an empty seat (the old guard
       failed the moment any live row existed — which is every derived
       open: Fulton's covered day, 2026-09-22). The claim clamps to
       what's genuinely unheld, so "0600–0600" over a half-covered day
       assigns exactly the uncovered hours. */
    const res = await claimSeatWindow(
      opts.dateIso, opts.seatId, opts.userId,
      tsMs(w.reqStart), tsMs(w.reqEnd),
      { kind: 'pickup' },
    )
    if (res.error !== null) return res.error
    actualFrom = hhmm(new Date(res.claimed[0].start).toISOString())
    actualUntil = hhmm(new Date(res.claimed[res.claimed.length - 1].end).toISOString())
  }
  const seatA = seats.value.find((s2) => s2.id === opts.seatId)
  const unitA = units.value.find((u) => u.id === seatA?.unitId)
  audit('assign.seat', `Assigned ${displayName(opts.userId).name} to ${unitA?.code ?? '?'} ${seatA?.label ?? 'seat'} on ${opts.dateIso} ${actualFrom}–${actualUntil}`, { entity: 'entry' })
  notify('schedule_change', { userId: opts.userId, summary: `You were assigned to ${unitA?.code ?? 'a unit'} ${seatA?.label ?? 'seat'} on ${opts.dateIso}, ${actualFrom}–${actualUntil}.` })
  await reloadRangeIfLoaded()
  return null
}

// ── Chief day editor ─────────────────────────────────────────────────

/** Does this person hold this seat on this date via override ROWS (as
 *  opposed to bare rotation)? Used to decide whether a permanent-scope
 *  template change also needs a day-scope entry fix for today. */
function holdsViaOverride(userId: string, seatId: string, dateIso: string): boolean {
  return entries.value.some(
    (e) =>
      e.workDate === dateIso &&
      e.seatId === seatId &&
      e.userId === userId &&
      e.kind !== 'timeoff' &&
      e.status !== 'off',
  )
}

/** Chief: mark an assigned person off for (part of) a day. */
async function dayMarkOff(opts: {
  dateIso: string
  seatId: string // kept for the caller's context; time off is user-level now
  userId: string
  offType: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  /* TIME OFF FOLLOWS THE PERSON (2026-09-25): no more carving the seat
     and pinning rows to it — one user-level record, and the boards
     derive the open window live. Deleting the record later restores
     their coverage automatically because nothing was carved away. */
  const working = segsForUserOnDate(opts.dateIso, opts.userId, entries.value)
  const overlaps = working.some(
    (s) => Math.max(s.start, tsMs(w.reqStart)) < Math.min(s.end, tsMs(w.reqEnd)),
  )
  if (!overlaps) return 'They are not scheduled during that window.'
  const ins = await supabase.from('sched_entries').insert({
    work_date: opts.dateIso, seat_id: null, user_id: opts.userId,
    start_at: w.reqStart, end_at: w.reqEnd,
    kind: 'timeoff', status: 'off', off_type: opts.offType,
  })
  if (ins.error) return ins.error.message
  audit('day.mark_off', `Marked ${displayName(opts.userId).name} off (${OFF_LABELS[opts.offType] ?? opts.offType}) ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'entry' })
  notify('schedule_change', { userId: opts.userId, summary: `You were marked off (${OFF_LABELS[opts.offType] ?? opts.offType}) on ${opts.dateIso} ${opts.from}–${opts.until}; that window is posted open.` })
  await reloadRangeIfLoaded()
  return null
}

/** Editor: paint an open window as covered WITHOUT a second punch — a
 *  call-out handled by someone already on the clock elsewhere (the
 *  S201 supervisor rides the open seat). No person entry is written,
 *  so payroll never sees duplicate punches, but the board stops
 *  showing a gap: the window renders "Covered — <note>". status 'off'
 *  keeps blocked rows out of coverage, hours, reminders and exports
 *  everywhere; remove one via the day view's ✕ (Rhonda, 2026-09-28). */
async function blockOpenWindow(
  dateIso: string,
  seatId: string,
  from: string,
  until: string,
  note: string,
): Promise<string | null> {
  const w = shiftWindow(dateIso, from, until)
  const ins = await supabase.from('sched_entries').insert({
    work_date: dateIso, seat_id: seatId, user_id: null,
    start_at: w.reqStart, end_at: w.reqEnd,
    kind: 'blocked', status: 'off', note: note.trim() || null,
  })
  if (ins.error) return ins.error.message
  audit('seat.block', `Blocked ${seatTitle(seatId)} ${dateIso} ${from}–${until} — covered, no extra punch${note.trim() ? ` (${note.trim()})` : ''}`, { entity: 'entry' })
  await reloadRangeIfLoaded()
  return null
}

/** Chief: open (part of) a person's day with no off record — used by
 *  remove-from-day and the conflict flow's "post the seat open". */
async function dayOpenWindow(opts: {
  dateIso: string
  seatId: string
  userId: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const { segs, error } = await carveSeatWindow(
    opts.dateIso, opts.seatId, opts.userId, tsMs(w.reqStart), tsMs(w.reqEnd),
  )
  if (error) return error
  if (segs.length === 0) {
    await reloadRangeIfLoaded()
    return 'They are not scheduled on that seat during that window.'
  }
  const rows = segs.map((seg) => ({
    work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
    start_at: new Date(seg.start).toISOString(), end_at: new Date(seg.end).toISOString(),
    kind: 'rotation', status: 'open',
  }))
  const ins = await supabase.from('sched_entries').insert(rows)
  if (ins.error) return ins.error.message
  // a freshly opened window next to an existing open reads as ONE seat
  const co = await coalesceSeatOpens(opts.dateIso, opts.seatId)
  if (co) return co
  audit('day.open', `Opened ${displayName(opts.userId).name}'s seat ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'entry' })
  notify('schedule_change', { userId: opts.userId, summary: `You were taken off your seat on ${opts.dateIso} ${opts.from}–${opts.until}; the window is posted open.` })
  await reloadRangeIfLoaded()
  return null
}

/** Chief: pull an assigned person off a seat for the whole day (no off
 *  record) — the hours they held post as open. */
async function dayRemove(opts: {
  dateIso: string
  seatId: string
  userId: string
}): Promise<string | null> {
  return dayOpenWindow({ ...opts, from: '06:00', until: '06:00' })
}

/** Chief: set a person's coverage on a seat to EXACTLY from–until for
 *  the day — the answer to "she actually worked 0600–1800, not the
 *  whole 24" without remove/reassign gymnastics (Justin, 2026-09-29).
 *  Hours they give up post as OPEN on the seat (merging with adjacent
 *  opens); extending is allowed only into hours nobody else covers,
 *  consuming any explicit open rows it lands on. Handles entry-backed
 *  holders and bare rotation occupants alike. */
async function dayRetime(opts: {
  dateIso: string
  seatId: string
  userId: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const newS = tsMs(w.reqStart)
  const newE = tsMs(w.reqEnd)
  if (newE - newS < MIN_SEG_MS) return 'Set a real time window.'

  // Fresh rows — a stale view must never decide what gets rewritten.
  const fres = await supabase
    .from('sched_entries')
    .select('*')
    .eq('work_date', opts.dateIso)
    .eq('seat_id', opts.seatId)
  if (fres.error) return fres.error.message
  const seatRows = (fres.data ?? [])
    .map(mapEntry)
    .filter((e) => e.kind !== 'timeoff' && e.status !== 'off')
  const mine = seatRows.filter((e) => e.userId === opts.userId && e.status === 'scheduled')
  const bare =
    mine.length === 0 &&
    seatRows.length === 0 &&
    seatRotationOccupant(opts.seatId, opts.dateIso) === opts.userId

  let held: Seg[]
  if (mine.length > 0) {
    held = mergeSegs(mine.map((e) => ({ start: tsMs(e.startAt), end: tsMs(e.endAt) })))
  } else if (bare) {
    const seatRec = seats.value.find((s2) => s2.id === opts.seatId)
    const unit = seatRec ? units.value.find((u) => u.id === seatRec.unitId) : null
    const uw = unitDayWindow(unit, opts.dateIso)
    held = [{ start: tsMs(uw.startTs), end: tsMs(uw.endTs) }]
  } else {
    return 'They are not scheduled on that seat that day.'
  }

  let gained: Seg[] = [{ start: newS, end: newE }]
  for (const h of held) gained = cutSegs(gained, h.start, h.end)
  const vacated = cutSegs(
    held.map((h) => ({ ...h })),
    newS,
    newE,
  )
  if (gained.length === 0 && vacated.length === 0) {
    return 'Their scheduled times already match that window. If part of the shift shows open, a time-off record is carving it — remove that record instead.'
  }

  // Extending only works into hours nobody else covers.
  if (gained.length > 0) {
    const offsRes = await supabase
      .from('sched_entries')
      .select('*')
      .eq('work_date', opts.dateIso)
      .eq('kind', 'timeoff')
    if (offsRes.error) return offsRes.error.message
    const offs = (offsRes.data ?? []).map(mapEntry)
    for (const r of seatRows) {
      if (r.status !== 'scheduled' || !r.userId || r.userId === opts.userId) continue
      let segs: Seg[] = [{ start: tsMs(r.startAt), end: tsMs(r.endAt) }]
      for (const o of offs.filter((o2) => o2.userId === r.userId)) {
        segs = cutSegs(segs, tsMs(o.startAt), tsMs(o.endAt))
      }
      for (const s of segs) {
        const hit = gained.find((g) => Math.min(g.end, s.end) - Math.max(g.start, s.start) >= MIN_SEG_MS)
        if (hit) {
          const os = Math.max(hit.start, s.start)
          const oe = Math.min(hit.end, s.end)
          return `${hhmm(new Date(os).toISOString())}–${hhmm(new Date(oe).toISOString())} is already covered by ${displayName(r.userId).name} on this seat — retime or remove them first.`
        }
      }
    }
  }

  if (bare) {
    // Materialize the hours they keep BEFORE anything else lands on the
    // seat — once any row exists, bare rotation stops rendering.
    const kept: Seg[] = []
    for (const h of held) {
      const s = Math.max(h.start, newS)
      const en = Math.min(h.end, newE)
      if (en - s >= MIN_SEG_MS) kept.push({ start: s, end: en })
    }
    if (kept.length > 0) {
      const ins = await supabase.from('sched_entries').insert(
        kept.map((k) => ({
          work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.userId,
          start_at: new Date(k.start).toISOString(), end_at: new Date(k.end).toISOString(),
          kind: 'rotation', status: 'scheduled',
        })),
      )
      if (ins.error) return ins.error.message
    }
  } else {
    // Trim their rows down to the kept window (splits handled per row).
    for (const v of vacated) {
      const cv = await carveSeatWindow(opts.dateIso, opts.seatId, opts.userId, v.start, v.end)
      if (cv.error) return cv.error
    }
  }

  // The extension consumes any explicit open rows it lands on — the
  // pieces outside the new window survive as open.
  for (const r of seatRows) {
    if (r.status !== 'open') continue
    const os = tsMs(r.startAt)
    const oe = tsMs(r.endAt)
    if (Math.min(oe, newE) - Math.max(os, newS) < MIN_SEG_MS) continue
    const del = await supabase.from('sched_entries').delete().eq('id', r.id)
    if (del.error) return del.error.message
    const rest = cutSegs([{ start: os, end: oe }], newS, newE)
    if (rest.length > 0) {
      const ins = await supabase.from('sched_entries').insert(
        rest.map((p) => ({
          work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
          start_at: new Date(p.start).toISOString(), end_at: new Date(p.end).toISOString(),
          kind: r.kind, status: 'open',
        })),
      )
      if (ins.error) return ins.error.message
    }
  }

  // Hours they now cover that they didn't before.
  if (gained.length > 0) {
    const kindFor = (g: Seg): string => {
      const touch = mine.find(
        (e) => Math.abs(tsMs(e.endAt) - g.start) < MIN_SEG_MS || Math.abs(tsMs(e.startAt) - g.end) < MIN_SEG_MS,
      )
      return touch?.kind ?? mine[0]?.kind ?? 'rotation'
    }
    const ins = await supabase.from('sched_entries').insert(
      gained.map((g) => ({
        work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.userId,
        start_at: new Date(g.start).toISOString(), end_at: new Date(g.end).toISOString(),
        kind: kindFor(g), status: 'scheduled',
      })),
    )
    if (ins.error) return ins.error.message
  }

  // Hours they gave up post open, then merge with any neighbors.
  if (vacated.length > 0) {
    const ins = await supabase.from('sched_entries').insert(
      vacated.map((v) => ({
        work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
        start_at: new Date(v.start).toISOString(), end_at: new Date(v.end).toISOString(),
        kind: 'rotation', status: 'open',
      })),
    )
    if (ins.error) return ins.error.message
  }
  const co = await coalesceSeatOpens(opts.dateIso, opts.seatId)
  if (co) return co

  const fromLbl = normTime(opts.from).replace(':', '')
  const untilLbl = normTime(opts.until).replace(':', '')
  audit('day.retime', `Changed ${displayName(opts.userId).name}'s times on ${seatTitle(opts.seatId)} ${opts.dateIso} to ${fromLbl}–${untilLbl}`, { entity: 'entry' })
  notify('schedule_change', {
    userId: opts.userId,
    summary: `Your times on ${seatTitle(opts.seatId)} for ${opts.dateIso} were corrected to ${fromLbl}–${untilLbl}.${vacated.length > 0 ? ' The hours you gave up are posted open.' : ''}`,
  })
  await reloadRangeIfLoaded()
  return null
}

/** Chief: replace the person on a seat for a window of the day. The
 *  outgoing person's coverage is carved (never left behind), and the
 *  replacement covers exactly the hours that were carved. */
async function dayReplace(opts: {
  dateIso: string
  seatId: string
  fromUserId: string
  toUserId: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const { segs, error } = await carveSeatWindow(
    opts.dateIso, opts.seatId, opts.fromUserId, tsMs(w.reqStart), tsMs(w.reqEnd),
  )
  if (error) return error
  if (segs.length === 0) {
    await reloadRangeIfLoaded()
    return 'They are not scheduled on that seat during that window.'
  }
  const rows = segs.map((seg) => ({
    work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.toUserId,
    start_at: new Date(seg.start).toISOString(), end_at: new Date(seg.end).toISOString(),
    kind: 'pickup', status: 'scheduled', note: 'Assigned by scheduler',
  }))
  const ins = await supabase.from('sched_entries').insert(rows)
  if (ins.error) return ins.error.message
  audit('day.replace', `Replaced ${displayName(opts.fromUserId).name} with ${displayName(opts.toUserId).name} ${opts.dateIso} ${opts.from}–${opts.until}`, { entity: 'entry' })
  notify('schedule_change', { userId: opts.fromUserId, summary: `You were replaced by ${displayName(opts.toUserId).name} on ${opts.dateIso} ${opts.from}–${opts.until}.` })
  notify('schedule_change', { userId: opts.toUserId, summary: `You were assigned to cover ${displayName(opts.fromUserId).name}'s seat on ${opts.dateIso} ${opts.from}–${opts.until}.` })
  await reloadRangeIfLoaded()
  return null
}

/** Chief: move a person onto an open seat for the day. The target is
 *  validated fresh and assigned FIRST (for its actual open window); only
 *  then does their own seat post open — a failed assign changes nothing. */
async function dayMove(opts: {
  dateIso: string
  fromSeatId: string
  toSeatId: string
  toEntryId: string | null
  userId: string
  from: string
  until: string
}): Promise<string | null> {
  const assignErr = await assignOpenSeat({
    dateIso: opts.dateIso,
    seatId: opts.toSeatId,
    entryId: opts.toEntryId,
    userId: opts.userId,
    from: opts.from,
    until: opts.until,
  })
  if (assignErr) return assignErr
  /* Carve ONLY the moved window off their old seat — the rest of the
     shift stays put. Moving Ashley to S201 for 12 hours used to take
     three tools: full remove, partial assign, re-assign the remainder
     (Justin/Rhonda, 2026-09-28). */
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const { segs, error } = await carveSeatWindow(
    opts.dateIso, opts.fromSeatId, opts.userId, tsMs(w.reqStart), tsMs(w.reqEnd),
  )
  if (error) {
    return `Moved onto the new seat, but their old window could not be cleared: ${error}`
  }
  if (segs.length === 0) {
    return 'Moved onto the new seat — but they were not on the old seat during that window, so nothing was cleared there. Check the day.'
  }
  return null
}

// ── day balance ledger (Justin, 2026-09-29) ──────────────────────────
/* "If someone is on a normal rotation, they either need 24 hrs on one
   of the units that day, or a time-off event logged" — a rotation
   holder's worked hours (any unit) + time off + hours traded away
   should cover their template window. 9/15 slipped through with only
   12 h of unpaid off logged while the whole day was hand-covered. */

export const BALANCE_TOL_MS = 15 * 60_000 // ignore shortfalls under 15 min

/** The radar only looks at the last pay period and beyond — September's
 *  hand-seeded Aladtec days have no trade trail to honor, so flagging
 *  them is pure noise (Justin, 2026-09-29). */
export const BALANCE_FLOOR_ISO = '2026-09-13'

/** Verification prompts only surface on the boards/nudge from the
 *  chain's go-live period — nobody gets chased for approvals that
 *  didn't exist yet (Justin, 2026-09-29). */
export const VERIFY_SURFACE_FLOOR_ISO = '2026-09-27'

export interface DayLedger {
  userId: string
  expectedMs: number
  workedMs: number
  offMs: number
  tradedMs: number
  shortMs: number
  gaps: Seg[]
  /** display 'HHMM–HHMM' per gap */
  gapLabels: string[]
}

/** null = no rotation-template expectation for them that day (pickups,
 *  admin staff, unstaffed units — nothing owed, nothing flagged). */
function dayLedgerFor(userId: string, dateIso: string): DayLedger | null {
  const dayS = tsMs(centralTs(dateIso, '06:00'))
  const dayE = tsMs(centralTs(addDaysIso(dateIso, 1), '06:00'))
  let expected: Seg[] = []
  const tSeatIds: string[] = []
  for (const seat of activeSeatList()) {
    if (seatRotationOccupant(seat.id, dateIso) !== userId) continue
    const unit = units.value.find((u) => u.id === seat.unitId) ?? null
    const uw = unitDayWindow(unit, dateIso)
    tSeatIds.push(seat.id)
    expected.push({ start: tsMs(uw.startTs), end: tsMs(uw.endTs) })
  }
  if (expected.length === 0) return null
  expected = mergeSegs(expected)

  const dayRows = entries.value.filter((e) => e.workDate === dateIso)
  const worked = segsForUserOnDate(dateIso, userId, entries.value)
  const offs = mergeSegs(
    dayRows
      .filter((e) => e.kind === 'timeoff' && e.userId === userId)
      .map((e) => ({ start: Math.max(tsMs(e.startAt), dayS), end: Math.min(tsMs(e.endAt), dayE) }))
      .filter((s) => s.end - s.start >= MIN_SEG_MS),
  )
  // hours of their template day covered by someone else THROUGH A TRADE
  // OR GIVEAWAY are documented by the trade record — accounted. A plain
  // hand-assigned cover is not: the holder still owes an off record.
  // Belt and suspenders: the APPROVED swap/giveaway request itself also
  // accounts the window, even when later hand edits changed the cover
  // rows' kinds (chained trades, re-covers).
  const traded = mergeSegs([
    ...dayRows
      .filter(
        (e) =>
          e.seatId !== null &&
          tSeatIds.includes(e.seatId) &&
          !!e.userId &&
          e.userId !== userId &&
          e.status === 'scheduled' &&
          (e.kind === 'trade' || e.kind === 'giveaway_cover'),
      )
      .map((e) => ({ start: tsMs(e.startAt), end: tsMs(e.endAt) })),
    ...requests.value
      .filter(
        (r) =>
          r.status === 'approved' &&
          (r.type === 'trade' || r.type === 'giveaway') &&
          r.requesterId === userId &&
          r.workDate === dateIso &&
          !!r.startAt &&
          !!r.endAt,
      )
      .map((r) => ({
        start: Math.max(tsMs(r.startAt as string), dayS),
        end: Math.min(tsMs(r.endAt as string), dayE),
      }))
      .filter((s) => s.end - s.start >= MIN_SEG_MS),
  ])
  let gaps = expected.map((s) => ({ ...s }))
  for (const a of [...worked, ...offs, ...traded]) gaps = cutSegs(gaps, a.start, a.end)
  gaps = gaps.filter((g) => g.end - g.start >= MIN_SEG_MS)
  const sum = (l: Seg[]): number => l.reduce((t, s) => t + (s.end - s.start), 0)
  return {
    userId,
    expectedMs: sum(expected),
    workedMs: sum(worked),
    offMs: sum(offs),
    tradedMs: sum(traded),
    shortMs: sum(gaps),
    gaps,
    gapLabels: gaps.map(
      (g) => `${hhmm(new Date(g.start).toISOString())}–${hhmm(new Date(g.end).toISOString())}`,
    ),
  }
}

export interface DayImbalance extends DayLedger {
  name: string
}

/** Every rotation holder whose day doesn't balance (editor radar). */
function dayImbalances(dateIso: string): DayImbalance[] {
  if (dateIso < BALANCE_FLOOR_ISO) return []
  const seen = new Set<string>()
  const out: DayImbalance[] = []
  for (const seat of activeSeatList()) {
    const occ = seatRotationOccupant(seat.id, dateIso)
    if (!occ || seen.has(occ)) continue
    seen.add(occ)
    const led = dayLedgerFor(occ, dateIso)
    if (led && led.shortMs >= BALANCE_TOL_MS) {
      out.push({ ...led, name: displayName(occ).name })
    }
  }
  return out.sort((a, b) => b.shortMs - a.shortMs || a.name.localeCompare(b.name))
}

// ── availability (protected days off; no approval) ───────────────────

async function markUnavailable(dateIso: string, reason: string): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  const res = await supabase.from('sched_availability').insert({
    user_id: me,
    on_date: dateIso,
    reason: reason || null,
  })
  if (res.error) {
    return res.error.message.includes('duplicate')
      ? 'That day is already marked unavailable.'
      : res.error.message
  }
  audit('availability.mark', `Marked unavailable on ${dateIso}`, { entity: 'availability' })
  await reloadRangeIfLoaded()
  return null
}

async function clearUnavailable(id: string): Promise<string | null> {
  const res = await supabase.from('sched_availability').delete().eq('id', id)
  if (res.error) return res.error.message
  audit('availability.clear', 'Removed an unavailable day', { entity: 'availability', entityId: id })
  await reloadRangeIfLoaded()
  return null
}

async function listMyUnavailable(): Promise<Availability[]> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me || auth.usingDevStub) return []
  const res = await supabase
    .from('sched_availability')
    .select('*')
    .eq('user_id', me)
    .gte('on_date', todayCentralIso())
    .order('on_date')
  return (res.data ?? []).map((r) => ({
    id: r.id, userId: r.user_id, onDate: r.on_date,
    startAt: r.start_at, endAt: r.end_at, reason: r.reason,
  }))
}

/** Is this person marked unavailable on this date? (queried live so it
 *  works outside the loaded range). FAIL-CLOSED: a query error returns a
 *  synthetic conflict so the guard is never silently skipped — the Chief
 *  can still override from the warning. */
async function checkUnavailable(userId: string, dateIso: string): Promise<Availability | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return null
  const res = await supabase
    .from('sched_availability')
    .select('*')
    .eq('user_id', userId)
    .eq('on_date', dateIso)
    .maybeSingle()
  if (res.error) {
    return {
      id: '', userId, onDate: dateIso, startAt: null, endAt: null,
      reason: 'availability could not be verified (connection error)',
    }
  }
  if (!res.data) return null
  return {
    id: res.data.id, userId: res.data.user_id, onDate: res.data.on_date,
    startAt: res.data.start_at, endAt: res.data.end_at, reason: res.data.reason,
  }
}

// ── editor tools: events, students, notes ────────────────────────────

async function reloadRangeIfLoaded(): Promise<void> {
  if (rangeStart.value) await loadRange(rangeStart.value, rangeEnd.value)
}

/** Hover snippet for an event, Aladtec-style: name, date and times,
 *  location, description — used as the native title on event rows. */
function eventTooltip(dateIso: string, ev: DayEventBox): string {
  const hm = (t: string | null) => (t && t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) : (t ?? ''))
  const d = new Date(dateIso + 'T12:00:00')
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const lines = [ev.label, ev.start ? `${day} ${hm(ev.start)} \u2013 ${hm(ev.end)}` : day]
  if (ev.location) lines.push(ev.location)
  if (ev.notes) lines.push(ev.notes)
  return lines.join('\n')
}

async function addEvent(opts: {
  dateIso: string
  label: string
  from: string
  until: string
  paramedicSlots: number
  attendantSlots: number
  notes: string
  location: string
  doubleTime: boolean
}): Promise<string | null> {
  const auth = useAuthStore()
  const ins = await supabase.from('sched_events').insert({
    label: opts.label,
    on_date: opts.dateIso,
    start_time: normTime(opts.from),
    end_time: normTime(opts.until),
    seats_total: opts.paramedicSlots + opts.attendantSlots,
    notes: opts.notes || null,
    location: opts.location.trim() || null,
    double_time: opts.doubleTime,
    created_by: auth.appUser?.id ?? null,
  })
  if (ins.error) return ins.error.message
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < opts.paramedicSlots; i++) {
    rows.push({ work_date: opts.dateIso, user_id: null, start_at: w.reqStart, end_at: w.reqEnd,
      kind: 'event', status: 'open', student_program: 'Paramedic', note: opts.label })
  }
  for (let i = 0; i < opts.attendantSlots; i++) {
    rows.push({ work_date: opts.dateIso, user_id: null, start_at: w.reqStart, end_at: w.reqEnd,
      kind: 'event', status: 'open', student_program: 'Attendant', note: opts.label })
  }
  if (rows.length > 0) {
    const eres = await supabase.from('sched_entries').insert(rows)
    if (eres.error) return eres.error.message
  }
  audit('event.add', `Added event "${opts.label}" ${opts.dateIso} ${opts.from}–${opts.until} (${opts.paramedicSlots}P/${opts.attendantSlots}A${opts.doubleTime ? ', double time' : ''})`, { entity: 'event' })
  await reloadRangeIfLoaded()
  return null
}

/** Delete an event box: its staffing/open rows and its listing. Any
 *  approved pickups that filled its slots get voided too. */
async function deleteEventBox(dateIso: string, label: string, eventId: string | null): Promise<string | null> {
  const del = await supabase
    .from('sched_entries')
    .delete()
    .eq('work_date', dateIso)
    .eq('kind', 'event')
    .eq('note', label)
    .select('source_request')
  if (del.error) return del.error.message
  const reqIds = [
    ...new Set(
      ((del.data ?? []) as { source_request: string | null }[])
        .map((r) => r.source_request)
        .filter((x): x is string => !!x),
    ),
  ]
  for (const id of reqIds) await voidRequestIfOrphaned(id)
  if (eventId) {
    const del2 = await supabase.from('sched_events').delete().eq('id', eventId)
    if (del2.error) return del2.error.message
  } else {
    await supabase.from('sched_events').delete().eq('on_date', dateIso).eq('label', label)
  }
  audit('event.delete', `Deleted event "${label}" on ${dateIso}`, { entity: 'event' })
  await reloadRangeIfLoaded()
  return null
}

async function assignEventSlot(entryId: string, userId: string | null): Promise<string | null> {
  const res = await supabase
    .from('sched_entries')
    .update({
      user_id: userId,
      status: userId ? 'scheduled' : 'open',
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .select('id, work_date, note, student_program')
  if (res.error) return res.error.message
  if (!res.data || res.data.length === 0) {
    await reloadRangeIfLoaded()
    return 'That slot no longer exists — the board has changed.'
  }
  audit(userId ? 'slot.assign' : 'slot.unassign', userId ? `Assigned ${displayName(userId).name} to an event/rider slot` : 'Unassigned an event/rider slot', { entity: 'entry', entityId: entryId })
  if (userId) {
    const slot = res.data[0] as { work_date: string; note: string | null; student_program: string | null }
    notify('schedule_change', { userId, summary: `You were assigned: ${slot.student_program ?? 'slot'}${slot.note ? ` — ${slot.note}` : ''} on ${slot.work_date}.` })
  }
  await reloadRangeIfLoaded()
  return null
}

async function addEventSlot(dateIso: string, label: string, title: string, from: string, until: string): Promise<string | null> {
  const w = shiftWindow(dateIso, from, until)
  const res = await supabase.from('sched_entries').insert({
    work_date: dateIso, user_id: null, start_at: w.reqStart, end_at: w.reqEnd,
    kind: 'event', status: 'open', student_program: title, note: label,
  })
  if (res.error) return res.error.message
  audit('event.add_slot', `Added a ${title} slot to "${label}" ${dateIso}`, { entity: 'event' })
  await reloadRangeIfLoaded()
  return null
}

/** An approved request whose resulting shift was later deleted no
 *  longer reflects reality — cancel it with a note so the Requests
 *  tab, history, and payroll stay honest. Only fires when no other
 *  entries still reference the request (trades write two). */
async function voidRequestIfOrphaned(requestId: string): Promise<void> {
  const left = await supabase
    .from('sched_entries')
    .select('id', { count: 'exact', head: true })
    .eq('source_request', requestId)
  if (left.error || (left.count ?? 0) > 0) return
  const upd = await supabase
    .from('sched_requests')
    .update({
      status: 'cancelled',
      decision_note: 'Removed from the calendar after approval',
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'approved')
    .select('id')
  if (!upd.error && (upd.data?.length ?? 0) > 0) {
    audit('request.auto_void', 'Auto-cancelled an approved request whose calendar entry was removed', { entity: 'request', entityId: requestId })
  }
  await loadRequests()
}

/** Merge a seat-day's contiguous/overlapping OPEN rows into one row —
 *  so deleting the 0600–1100 half next to an 1100–0600 leftover reads
 *  as ONE 0600–0600 open seat again, not a jigsaw (Justin, 2026-09-29). */
async function coalesceSeatOpens(dateIso: string, seatId: string): Promise<string | null> {
  const res = await supabase
    .from('sched_entries')
    .select('*')
    .eq('work_date', dateIso)
    .eq('seat_id', seatId)
    .eq('status', 'open')
  if (res.error) return res.error.message
  const opens = (res.data ?? []).map(mapEntry).sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt))
  if (opens.length < 2) return null
  const groups: (typeof opens)[] = []
  for (const o of opens) {
    const g = groups[groups.length - 1]
    if (g && tsMs(o.startAt) <= tsMs(g[g.length - 1].endAt) + MIN_SEG_MS) g.push(o)
    else groups.push([o])
  }
  for (const g of groups) {
    if (g.length < 2) continue
    const start = new Date(Math.min(...g.map((o) => tsMs(o.startAt)))).toISOString()
    const end = new Date(Math.max(...g.map((o) => tsMs(o.endAt)))).toISOString()
    const del = await supabase.from('sched_entries').delete().in('id', g.map((o) => o.id))
    if (del.error) return del.error.message
    const ins = await supabase.from('sched_entries').insert({
      work_date: dateIso, seat_id: seatId, user_id: null,
      start_at: start, end_at: end, kind: 'rotation', status: 'open',
    })
    if (ins.error) return ins.error.message
  }
  return null
}

/** Seat-coverage kinds — rows that hold a seat (vs riders, extras,
 *  events, students, time off, blocked overlays). */
const SEAT_COVER_KINDS = new Set(['rotation', 'pickup', 'trade', 'giveaway_cover'])

async function removeEntry(entryId: string): Promise<string | null> {
  const res = await supabase
    .from('sched_entries')
    .delete()
    .eq('id', entryId)
    .select('source_request, user_id, work_date, kind, status, seat_id, start_at, end_at')
  if (res.error) return res.error.message
  const gone = res.data?.[0] as
    | { source_request: string | null; user_id: string | null; work_date: string; kind: string;
        status: string; seat_id: string | null; start_at: string; end_at: string }
    | undefined
  const reqId = gone?.source_request ?? null
  if (reqId) await voidRequestIfOrphaned(reqId)

  /* Deleting someone's seat coverage REOPENS their window (merged with
     any adjacent opens) instead of leaving an invisible gap. Only when
     other rows remain on the seat — a seat gone rowless falls back to
     bare rotation on its own, and writing opens there would fight it.
     Windows another row already spans (standing coverage OR an offed
     holder's row, whose carve derives its own open) are skipped. */
  if (
    gone && gone.seat_id && gone.user_id && gone.status === 'scheduled' &&
    SEAT_COVER_KINDS.has(gone.kind)
  ) {
    const rem = await supabase
      .from('sched_entries')
      .select('*')
      .eq('work_date', gone.work_date)
      .eq('seat_id', gone.seat_id)
    if (!rem.error) {
      const others = (rem.data ?? [])
        .map(mapEntry)
        .filter((r) => r.kind !== 'timeoff' && r.status !== 'off')
      if (others.length > 0) {
        let pieces: Seg[] = [{ start: tsMs(gone.start_at), end: tsMs(gone.end_at) }]
        for (const r of others) pieces = cutSegs(pieces, tsMs(r.startAt), tsMs(r.endAt))
        if (pieces.length > 0) {
          const ins = await supabase.from('sched_entries').insert(
            pieces.map((s) => ({
              work_date: gone.work_date, seat_id: gone.seat_id, user_id: null,
              start_at: new Date(s.start).toISOString(), end_at: new Date(s.end).toISOString(),
              kind: 'rotation', status: 'open',
            })),
          )
          if (ins.error) return ins.error.message
        }
        const co = await coalesceSeatOpens(gone.work_date, gone.seat_id)
        if (co) return co
      }
    }
  }

  audit('entry.remove', `Removed a ${gone?.kind ?? 'schedule'} entry${gone?.user_id ? ` for ${displayName(gone.user_id).name}` : ''}${gone?.work_date ? ` on ${gone.work_date}` : ''}`, { entity: 'entry', entityId: entryId })
  if (gone?.user_id) {
    const what = gone.kind === 'extra' ? 'extra-hours entry' : gone.kind === 'timeoff' ? 'time-off record' : 'shift entry'
    notify('schedule_change', { userId: gone.user_id, summary: `Your ${what} on ${gone.work_date ?? 'the schedule'} was removed.` })
  }
  await reloadRangeIfLoaded()
  return null
}

/** Editor: change an entry's window in place (approved extra hours,
 *  event rows, and similar standalone entries). */
async function updateEntryWindow(
  entryId: string,
  dateIso: string,
  from: string,
  until: string,
): Promise<string | null> {
  const w = shiftWindow(dateIso, from, until)
  const res = await supabase
    .from('sched_entries')
    .update({ start_at: w.reqStart, end_at: w.reqEnd, updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .select('id, user_id, work_date')
  if (res.error) return res.error.message
  if (!res.data || res.data.length === 0) {
    await reloadRangeIfLoaded()
    return 'That entry no longer exists — the board has changed.'
  }
  audit('entry.retime', `Retimed an entry to ${from}–${until} (${dateIso})`, { entity: 'entry', entityId: entryId })
  const touched = res.data[0] as { user_id: string | null; work_date: string }
  if (touched.user_id) notify('schedule_change', { userId: touched.user_id, summary: `Your hours on ${touched.work_date} were changed to ${from}–${until}.` })
  await reloadRangeIfLoaded()
  return null
}

/** Editor: fix an existing time-off record in place — window and/or
 *  type. Clicked straight from any board's Time Off box (Chief,
 *  2026-09-25); deleting instead goes through removeEntry, which also
 *  auto-voids the approved request it came from. */
async function updateTimeOff(
  entryId: string,
  dateIso: string,
  offType: string,
  from: string,
  until: string,
): Promise<string | null> {
  const w = shiftWindow(dateIso, from, until)
  const res = await supabase
    .from('sched_entries')
    .update({ off_type: offType, start_at: w.reqStart, end_at: w.reqEnd, updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('kind', 'timeoff')
    .select('id, user_id, work_date')
  if (res.error) return res.error.message
  if (!res.data || res.data.length === 0) {
    await reloadRangeIfLoaded()
    return 'That time-off record no longer exists — the board has changed.'
  }
  const label = OFF_LABELS[offType] ?? 'Time off'
  audit('timeoff.update', `Updated a time-off record — ${label.toLowerCase()}, ${dateIso} ${from}–${until}`, { entity: 'entry', entityId: entryId })
  const t = res.data[0] as { user_id: string | null; work_date: string }
  if (t.user_id) notify('schedule_change', { userId: t.user_id, summary: `Your time off on ${t.work_date} is now ${label.toLowerCase()}, ${from}–${until}.` })
  await reloadRangeIfLoaded()
  return null
}

/** Update an established event's listing — hover note and/or the
 *  double-time flag. Boxes that came from staffing rows alone (no
 *  sched_events listing yet, e.g. imported history) get a listing
 *  created so the fields have somewhere to live. */
async function updateEventListing(
  dateIso: string,
  label: string,
  eventId: string | null,
  startHHmm: string | null, // box times, 'HHmm' — used only when creating a listing
  endHHmm: string | null,
  patch: { notes?: string; location?: string; doubleTime?: boolean },
): Promise<string | null> {
  const auth = useAuthStore()
  const fields: Record<string, unknown> = {}
  if (patch.notes !== undefined) fields.notes = patch.notes.trim() || null
  if (patch.location !== undefined) fields.location = patch.location.trim() || null
  if (patch.doubleTime !== undefined) fields.double_time = patch.doubleTime
  if (eventId) {
    const res = await supabase.from('sched_events').update(fields).eq('id', eventId)
    if (res.error) return res.error.message
  } else {
    const res = await supabase.from('sched_events').insert({
      label,
      on_date: dateIso,
      start_time: startHHmm ? normTime(startHHmm) : '06:00',
      end_time: endHHmm ? normTime(endHHmm) : '06:00',
      seats_total: 0,
      notes: (patch.notes ?? '').trim() || null,
      location: (patch.location ?? '').trim() || null,
      double_time: patch.doubleTime ?? true,
      created_by: auth.appUser?.id ?? null,
    })
    if (res.error) return res.error.message
  }
  audit('event.update', `Updated event "${label}" on ${dateIso}`, { entity: 'event', detail: { patch } })
  await reloadRangeIfLoaded()
  return null
}

/** Edit a student ride-along in place: label, note, and times. */
async function updateStudentEntry(opts: {
  entryId: string
  dateIso: string
  label: string
  note: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const res = await supabase
    .from('sched_entries')
    .update({
      student_program: opts.label.trim() || null,
      note: opts.note.trim() || null,
      start_at: w.reqStart,
      end_at: w.reqEnd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.entryId)
  if (res.error) return res.error.message
  audit('student.update', `Updated student rider (${opts.label}) on ${opts.dateIso}`, { entity: 'entry', entityId: opts.entryId })
  await reloadRangeIfLoaded()
  return null
}

async function addStudent(opts: {
  dateIso: string
  unitId: string
  program: string
  comment: string
  from: string
  until: string
}): Promise<string | null> {
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const res = await supabase.from('sched_entries').insert({
    work_date: opts.dateIso,
    unit_id: opts.unitId,
    user_id: null,
    start_at: w.reqStart,
    end_at: w.reqEnd,
    kind: 'student',
    status: 'scheduled',
    student_program: opts.comment ? `${opts.program} (${opts.comment})` : opts.program,
  })
  if (res.error) return res.error.message
  audit('student.add', `Added a ${opts.program} student to ${units.value.find((u) => u.id === opts.unitId)?.code ?? 'a unit'} on ${opts.dateIso}`, { entity: 'entry' })
  await reloadRangeIfLoaded()
  return null
}

/** Add extra rider seats to a unit for a date or date range — "M272
 *  runs a Paramedic and TWO Attendants this week". Each day gets
 *  `count` OPEN rider rows that claim/assign like open seats. */
async function addRiderSeats(opts: {
  unitId: string
  label: string // position label: 'Attendant', 'Observer', 'FTO Trainee'…
  from: string // daily window 'HH:mm'
  until: string
  startDate: string
  endDate: string
  count: number
}): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  if (!opts.unitId) return 'Pick the unit the seat rides on.'
  if (opts.endDate < opts.startDate) return 'The end date is before the start date.'
  const span = daysBetweenIso(opts.startDate, opts.endDate) + 1
  if (span > 62) return 'Keep a rider-seat range within two months — add another range after that.'
  const count = Math.max(1, Math.min(4, Math.round(opts.count)))
  const label = opts.label.trim() || 'Rider'
  const rows: Record<string, unknown>[] = []
  for (let iso = opts.startDate; iso <= opts.endDate; iso = addDaysIso(iso, 1)) {
    const w = shiftWindow(iso, opts.from, opts.until)
    for (let i = 0; i < count; i++) {
      rows.push({
        work_date: iso,
        unit_id: opts.unitId,
        user_id: null,
        start_at: w.reqStart,
        end_at: w.reqEnd,
        kind: 'rider',
        status: 'open',
        student_program: label,
      })
    }
  }
  const res = await supabase.from('sched_entries').insert(rows)
  if (res.error) return res.error.message
  audit('rider.add', `Added ${count} ${label} seat${count > 1 ? 's' : ''} on ${units.value.find((u) => u.id === opts.unitId)?.code ?? '?'} ${opts.startDate}${opts.endDate !== opts.startDate ? `–${opts.endDate}` : ''}`, { entity: 'entry' })
  await reloadRangeIfLoaded()
  return null
}

async function addDayNote(opts: {
  dateIso: string
  unitId: string | null
  note: string
  includeInReminders: boolean
}): Promise<string | null> {
  const auth = useAuthStore()
  const res = await supabase.from('sched_day_notes').insert({
    on_date: opts.dateIso,
    unit_id: opts.unitId,
    note: opts.note,
    include_in_reminders: opts.includeInReminders,
    created_by: auth.appUser?.id ?? null,
  })
  if (res.error) return res.error.message
  audit('note.add', `Added a day note on ${opts.dateIso}`, { entity: 'note' })
  await reloadRangeIfLoaded()
  return null
}

async function deleteDayNote(id: string): Promise<string | null> {
  const res = await supabase.from('sched_day_notes').delete().eq('id', id)
  if (res.error) return res.error.message
  audit('note.delete', 'Deleted a day note', { entity: 'note', entityId: id })
  await reloadRangeIfLoaded()
  return null
}

async function updateDayNote(id: string, note: string): Promise<string | null> {
  const res = await supabase.from('sched_day_notes').update({ note }).eq('id', id)
  if (res.error) return res.error.message
  audit('note.update', 'Updated a day note', { entity: 'note', entityId: id })
  await reloadRangeIfLoaded()
  return null
}

/** Cancel a pending request. `forMember` is the editor path — clearing
 *  a member's own posting that reality has passed by (e.g. the Chief
 *  already fixed the day by hand, so the giveaway sits on the boards
 *  forever "waiting on the members"). That path also notifies the
 *  requester (sched-notify words a cancelled row as "Request
 *  cancelled"); self-cancels stay silent as always. */
async function cancelRequest(
  id: string,
  opts?: { forMember?: boolean },
): Promise<string | null> {
  const res = await supabase
    .from('sched_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (res.error) return res.error.message
  audit(
    'request.cancel',
    opts?.forMember
      ? "Cancelled a member's pending request (scheduler — posting was moot)"
      : 'Cancelled a pending request',
    { entity: 'request', entityId: id },
  )
  if (opts?.forMember) notify('request_decided', { requestId: id })
  await loadRequests()
  return null
}

/** Editors: adjust a PENDING request's window before deciding it — the
 *  "times were close but not quite right" fix without making the member
 *  refile. */
async function updateRequestWindow(
  req: SchedRequest,
  from: string,
  until: string,
): Promise<string | null> {
  if (!req.workDate) return 'This request has no date to anchor the times to.'
  if (req.status !== 'pending') return 'Only pending requests can be re-timed.'
  const w = shiftWindow(req.workDate, from, until)
  const res = await supabase
    .from('sched_requests')
    .update({ start_at: w.reqStart, end_at: w.reqEnd, updated_at: new Date().toISOString() })
    .eq('id', req.id)
    .eq('status', 'pending')
  if (res.error) return res.error.message
  audit('request.retime', `Adjusted request times to ${from}–${until} (${req.workDate}) before deciding`, { entity: 'request', entityId: req.id })
  await loadRequests()
  return null
}

/** Editors: reopen a decided request so the decision (or its times) can
 *  be redone. Reopening an APPROVED request first deletes every calendar
 *  row the approval wrote (rows tagged with this request id) —
 *  rotation-backed seats re-render on their own, but if the approval had
 *  reshaped existing override rows, check the day afterward. Agreed
 *  trades/giveaways go back to partner_accepted (the deal still stands);
 *  everything else returns to pending. */
async function reopenRequest(req: SchedRequest): Promise<string | null> {
  if (req.status === 'pending' || req.status === 'partner_accepted') return 'Already open.'
  let removed = 0
  if (req.status === 'approved') {
    const del = await supabase
      .from('sched_entries')
      .delete()
      .eq('source_request', req.id)
      .select('id')
    if (del.error) return del.error.message
    removed = del.data?.length ?? 0
  }
  const backTo =
    (req.type === 'trade' || req.type === 'giveaway') &&
    req.counterpartyId &&
    req.status !== 'cancelled'
      ? 'partner_accepted'
      : 'pending'
  const res = await supabase
    .from('sched_requests')
    .update({
      status: backTo,
      decided_by: null,
      decided_at: null,
      decision_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.id)
  if (res.error) return res.error.message
  audit(
    'request.reopen',
    `Reopened a ${req.status} ${REQ_TYPE_LABELS[req.type] ?? req.type} request${removed ? ` — removed ${removed} calendar row${removed === 1 ? '' : 's'} the approval had written` : ''}`,
    { entity: 'request', entityId: req.id },
  )
  await Promise.all([loadRequests(), reloadRangeIfLoaded()])
  return null
}

/**
 * Approve a request and apply it to the calendar. Denial just records the
 * decision. Approval writes deviation entries:
 *  - time_off: requested window becomes an OPEN entry on the seat, any
 *    remainder stays with the person; plus an off-record row for reports.
 *  - pickup: the requester fills the open window (existing open entry is
 *    claimed when it matches, otherwise entries are written around it).
 *  - extra_hours: a standalone extra entry on the unit.
 */
async function decideRequest(
  req: SchedRequest,
  approve: boolean,
  note: string,
  /** The Chief already made the change by hand — close the request as
   *  approved WITHOUT touching the calendar. Her only out used to be
   *  Deny, which reads wrong to the requester (Chief, 2026-09-25). */
  alreadyHandled = false,
): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id ?? null

  if (approve && !alreadyHandled) {
    if (req.type === 'time_off' && req.workDate) {
      const err = await applyTimeOff(
        req.workDate,
        req.requesterId,
        req.offType,
        req.startAt ?? centralTs(req.workDate, '06:00'),
        req.endAt ?? centralTs(addDaysIso(req.workDate, 1), '06:00'),
        req.id,
      )
      if (err) return err
    } else if (req.type === 'extra_hours' && req.workDate) {
      const unit = units.value.find((u) => u.code === req.unitCode)
      const ins = await supabase.from('sched_entries').insert({
        work_date: req.workDate,
        unit_id: unit?.id ?? null,
        user_id: req.requesterId,
        start_at: req.startAt,
        end_at: req.endAt,
        kind: 'extra',
        status: 'scheduled',
        time_type: req.timeType ?? 'regular',
        note: req.positionLabel,
        source_request: req.id,
      })
      if (ins.error) return ins.error.message
    } else if (req.type === 'giveaway' && req.workDate && req.seatId) {
      if (!req.counterpartyId) return 'No accepted claimant on this giveaway yet.'
      const giver = personById.value.get(req.requesterId)?.fullName ?? 'requester'
      const err = await coverShift(
        req.workDate, req.seatId, req.requesterId, req.counterpartyId,
        req.startAt ?? centralTs(req.workDate, '06:00'),
        req.endAt ?? centralTs(addDaysIso(req.workDate, 1), '06:00'),
        'giveaway_cover', `Covering for ${giver}`, req.id,
      )
      if (err) return err
    } else if (req.type === 'trade' && req.workDate && req.seatId) {
      if (!req.counterpartyId || !req.counterWorkDate || !req.counterSeatId) {
        return 'No accepted swap partner on this trade yet.'
      }
      const a = personById.value.get(req.requesterId)?.fullName ?? 'requester'
      const b = personById.value.get(req.counterpartyId)?.fullName ?? 'partner'
      let err = await coverShift(
        req.workDate, req.seatId, req.requesterId, req.counterpartyId,
        req.startAt ?? centralTs(req.workDate, '06:00'),
        req.endAt ?? centralTs(addDaysIso(req.workDate, 1), '06:00'),
        'trade', `Trade for ${a}`, req.id,
      )
      if (err) return err
      err = await coverShift(
        req.counterWorkDate, req.counterSeatId, req.counterpartyId, req.requesterId,
        req.counterStartAt ?? centralTs(req.counterWorkDate, '06:00'),
        req.counterEndAt ?? centralTs(addDaysIso(req.counterWorkDate, 1), '06:00'),
        'trade', `Trade for ${b}`, req.id,
      )
      if (err) return err
    } else if (req.type === 'pickup' && req.entryId && !req.seatId) {
      // special-event slot claim — verify the slot still exists (a raw
      // update on a deleted row would "succeed" touching nothing and the
      // request would be marked approved with no calendar change)
      const upd = await supabase
        .from('sched_entries')
        .update({
          user_id: req.requesterId,
          status: 'scheduled',
          source_request: req.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.entryId)
        .eq('status', 'open')
        .select('id')
      if (upd.error) return upd.error.message
      if (!upd.data || upd.data.length === 0) {
        await reloadRangeIfLoaded()
        return 'That event slot is no longer open — the board has changed since this request was filed.'
      }
    } else if (req.type === 'pickup' && req.workDate && req.seatId) {
      if (req.entryId) {
        // An explicit open entry was referenced. Read it FRESH — the
        // board may have been reshaped since the request was filed —
        // then claim it when the window matches, or claim the
        // overlapping slice and leave the rest open.
        const fres = await supabase
          .from('sched_entries')
          .select('*')
          .eq('id', req.entryId)
          .maybeSingle()
        if (fres.error) return fres.error.message
        const openEntry = fres.data ? mapEntry(fres.data) : null
        if (!openEntry || openEntry.status !== 'open') {
          await reloadRangeIfLoaded()
          return 'That open shift is no longer on the board — it may have been filled or reshaped since the request was filed. Check the day and assign directly if it should still happen.'
        }
        const oS = tsMs(openEntry.startAt)
        const oE = tsMs(openEntry.endAt)
        const rS = req.startAt ? tsMs(req.startAt) : oS
        const rE = req.endAt ? tsMs(req.endAt) : oE
        const cS = Math.max(oS, rS) // clamp to what is actually open
        const cE = Math.min(oE, rE)
        if (cE - cS < MIN_SEG_MS) {
          await reloadRangeIfLoaded()
          return 'The requested window no longer overlaps the open shift — the board has changed since this request was filed.'
        }
        if (cS - oS < MIN_SEG_MS && oE - cE < MIN_SEG_MS) {
          const upd = await supabase
            .from('sched_entries')
            .update({
              user_id: req.requesterId,
              status: 'scheduled',
              kind: 'pickup',
              source_request: req.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', req.entryId)
          if (upd.error) return upd.error.message
        } else {
          const rows: Record<string, unknown>[] = [
            {
              work_date: req.workDate,
              seat_id: req.seatId,
              user_id: req.requesterId,
              start_at: new Date(cS).toISOString(),
              end_at: new Date(cE).toISOString(),
              kind: 'pickup',
              status: 'scheduled',
              source_request: req.id,
            },
          ]
          if (cS - oS >= MIN_SEG_MS) {
            rows.push({
              work_date: req.workDate,
              seat_id: req.seatId,
              user_id: null,
              start_at: openEntry.startAt,
              end_at: new Date(cS).toISOString(),
              kind: openEntry.kind,
              status: 'open',
            })
          }
          if (oE - cE >= MIN_SEG_MS) {
            rows.push({
              work_date: req.workDate,
              seat_id: req.seatId,
              user_id: null,
              start_at: new Date(cE).toISOString(),
              end_at: openEntry.endAt,
              kind: openEntry.kind,
              status: 'open',
            })
          }
          const ins = await supabase.from('sched_entries').insert(rows)
          if (ins.error) return ins.error.message
          const del = await supabase.from('sched_entries').delete().eq('id', req.entryId)
          if (del.error) return del.error.message
        }
      } else {
        /* Seat-derived / rotation-open pickup — approve with the same
           coverage-aware claim the Chief's direct assign uses (the old
           unit-window remainder writes displaced any occupant and knew
           nothing about time-off carves — Fulton's day, 9/22). */
        const rS = req.startAt ? tsMs(req.startAt) : tsMs(centralTs(req.workDate, '06:00'))
        const rE = req.endAt ? tsMs(req.endAt) : tsMs(centralTs(addDaysIso(req.workDate, 1), '06:00'))
        const res = await claimSeatWindow(req.workDate, req.seatId, req.requesterId, rS, rE, {
          kind: 'pickup',
          sourceRequest: req.id,
        })
        if (res.error) return res.error
      }
    }
  }
  const upd = await supabase
    .from('sched_requests')
    .update({
      status: approve ? 'approved' : 'denied',
      decided_by: me,
      decided_at: new Date().toISOString(),
      decision_note: note || (alreadyHandled ? 'Already handled — the schedule was updated directly.' : null),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.id)
  if (upd.error) return upd.error.message

  audit(alreadyHandled ? 'request.handled' : approve ? 'request.approve' : 'request.deny', `${alreadyHandled ? 'Marked handled (schedule already updated by hand)' : approve ? 'Approved' : 'Denied'} ${displayName(req.requesterId).name}'s ${(REQ_TYPE_LABELS[req.type] ?? req.type).toLowerCase()}${req.workDate ? ` for ${req.workDate}` : ''}${note ? ` — ${note}` : ''}`, { entity: 'request', entityId: req.id })
  notify('request_decided', { requestId: req.id })
  await Promise.all([loadRequests(), rangeStart.value ? loadRange(rangeStart.value, rangeEnd.value) : Promise.resolve()])
  return null
}

// ── mutations (editor-gated by RLS; callers re-load after) ──────────

/**
 * Point a seat/platoon at a person from a given date forward. Closes any
 * open-ended assignment that would overlap, so history stays intact and
 * past days keep rendering who actually held the seat.
 */
/** "M242 Paramedic" for messages. */
function seatTitle(seatId: string): string {
  const seat = seats.value.find((s) => s.id === seatId)
  const unit = units.value.find((u) => u.id === seat?.unitId)
  return `${unit?.code ?? '?'} ${seat?.label ?? ''}`.trim()
}

export interface RotationClash {
  seatId: string
  platoon: Platoon
  seatTitle: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** Every OTHER rotation seat `userId` holds on/after `effectiveFrom` —
 *  the one-person-one-seat rule. Empty array = clear to assign. */
function findRotationClashes(
  userId: string,
  seatId: string,
  platoon: Platoon,
  effectiveFrom: string,
): RotationClash[] {
  return rotation.value
    .filter(
      (a) =>
        a.userId === userId &&
        !(a.seatId === seatId && a.platoon === platoon) &&
        (a.effectiveTo === null || a.effectiveTo >= effectiveFrom),
    )
    .map((a) => ({
      seatId: a.seatId,
      platoon: a.platoon,
      seatTitle: seatTitle(a.seatId),
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
    }))
}

/** One seat/platoon chain write: trim or delete whatever overlaps from
 *  `effectiveFrom`, insert the new row. No clash guard, no reload —
 *  composition pieces for assignRotation / assignRotationResolved. */
async function applyRotationRow(
  seatId: string,
  platoon: Platoon,
  userId: string | null,
  effectiveFrom: string,
): Promise<string | null> {
  const overlapping = rotation.value.filter(
    (a) =>
      a.seatId === seatId &&
      a.platoon === platoon &&
      (a.effectiveTo === null || a.effectiveTo >= effectiveFrom),
  )
  for (const a of overlapping) {
    if (a.effectiveFrom >= effectiveFrom) {
      const del = await supabase.from('sched_rotation_assignments').delete().eq('id', a.id)
      if (del.error) return del.error.message
    } else {
      const upd = await supabase
        .from('sched_rotation_assignments')
        .update({ effective_to: addDaysIso(effectiveFrom, -1) })
        .eq('id', a.id)
      if (upd.error) return upd.error.message
    }
  }
  const auth = useAuthStore()
  const ins = await supabase.from('sched_rotation_assignments').insert({
    seat_id: seatId,
    platoon,
    user_id: userId,
    effective_from: effectiveFrom,
    created_by: auth.appUser?.id ?? null,
  })
  if (ins.error) return ins.error.message
  return null
}

async function assignRotation(
  seatId: string,
  platoon: Platoon,
  userId: string | null,
  effectiveFrom: string,
): Promise<string | null> {
  // Protection: one person, one seat at a time. Block if they already
  // hold ANY other seat (any platoon) for an overlapping period — the
  // UIs catch this first via findRotationClashes and offer swap/open.
  if (userId !== null) {
    const clash = findRotationClashes(userId, seatId, platoon, effectiveFrom)[0]
    if (clash) {
      const who = personById.value.get(userId)?.fullName ?? 'This person'
      return `${who} already holds ${clash.seatTitle} on ${clash.platoon} Shift (from ${clash.effectiveFrom}${clash.effectiveTo ? ` to ${clash.effectiveTo}` : ''}). End or reassign that seat first.`
    }
  }
  const e = await applyRotationRow(seatId, platoon, userId, effectiveFrom)
  if (e) return e
  audit('rotation.assign', `Rotation: ${userId ? displayName(userId).name : 'OPEN'} → ${seatTitle(seatId)} (${platoon} Shift) from ${effectiveFrom}`, { entity: 'rotation' })
  await loadCore()
  return null
}

/**
 * Put `userId` on a rotation seat they'd otherwise clash into, resolving
 * their current seat in the same stroke: 'swap' backfills it with the
 * person this assignment displaces (if any), 'open' leaves it vacant.
 * Extra clash seats beyond the first (shouldn't exist under the guard)
 * are opened.
 */
async function assignRotationResolved(
  seatId: string,
  platoon: Platoon,
  userId: string,
  effectiveFrom: string,
  resolution: 'swap' | 'open',
): Promise<string | null> {
  const clashes = findRotationClashes(userId, seatId, platoon, effectiveFrom)
  if (clashes.length === 0) return assignRotation(seatId, platoon, userId, effectiveFrom)
  const displaced = rotationOccupant(seatId, platoon, effectiveFrom)
  let e = await applyRotationRow(seatId, platoon, userId, effectiveFrom)
  if (e) return e
  for (let i = 0; i < clashes.length; i++) {
    const backfill = i === 0 && resolution === 'swap' ? displaced : null
    e = await applyRotationRow(clashes[i].seatId, clashes[i].platoon, backfill, effectiveFrom)
    if (e) {
      await loadCore()
      return e
    }
  }
  const who = displayName(userId).name
  const other = clashes[0]
  audit(
    'rotation.assign',
    resolution === 'swap' && displaced
      ? `Rotation swap from ${effectiveFrom}: ${who} → ${seatTitle(seatId)} (${platoon} Shift), ${displayName(displaced).name} → ${other.seatTitle} (${other.platoon} Shift)`
      : `Rotation: ${who} → ${seatTitle(seatId)} (${platoon} Shift) from ${effectiveFrom}; ${other.seatTitle} (${other.platoon} Shift) opened`,
    { entity: 'rotation' },
  )
  await loadCore()
  return null
}

/**
 * Cancel a scheduled (or standing) assignment, then repair the chain for
 * that seat/platoon so effective_to always points at the next change
 * minus one day (open-ended on the last).
 */
async function removeRotationAssignment(id: string): Promise<string | null> {
  const target = rotation.value.find((a) => a.id === id)
  if (!target) return 'Assignment not found'
  const del = await supabase.from('sched_rotation_assignments').delete().eq('id', id)
  if (del.error) return del.error.message
  const chain = rotation.value
    .filter((a) => a.seatId === target.seatId && a.platoon === target.platoon && a.id !== id)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  for (let i = 0; i < chain.length; i++) {
    const want = i + 1 < chain.length ? addDaysIso(chain[i + 1].effectiveFrom, -1) : null
    if (chain[i].effectiveTo !== want) {
      const upd = await supabase
        .from('sched_rotation_assignments')
        .update({ effective_to: want })
        .eq('id', chain[i].id)
      if (upd.error) return upd.error.message
    }
  }
  const seatR = seats.value.find((s) => s.id === target.seatId)
  const unitR = units.value.find((u) => u.id === seatR?.unitId)
  audit('rotation.cancel', `Cancelled a scheduled rotation change on ${unitR?.code ?? '?'} ${seatR?.label ?? ''} (${target.platoon} Shift, eff. ${target.effectiveFrom})`, { entity: 'rotation' })
  await loadCore()
  return null
}

export type UnitPreset = 'medic' | 'aic' | 'supervisor'

async function addUnit(opts: {
  code: string
  label: string
  station: string
  preset: UnitPreset
}): Promise<string | null> {
  const maxOrder = Math.max(0, ...units.value.map((u) => u.sortOrder))
  const ins = await supabase
    .from('sched_units')
    .insert({ code: opts.code, label: opts.label, station: opts.station, sort_order: maxOrder + 1 })
    .select('id')
    .single()
  if (ins.error) return ins.error.message
  const unitId = ins.data.id as string
  const seatsToAdd =
    opts.preset === 'supervisor'
      ? [{ label: 'Supervisor', qual_rule: 'supervisor', sort_order: 0 }]
      : opts.preset === 'aic'
        ? [
            { label: 'AIC / Medic', qual_rule: 'aemt_or_higher', sort_order: 0 },
            { label: 'Attendant', qual_rule: 'any_field', sort_order: 1 },
          ]
        : [
            { label: 'Paramedic', qual_rule: 'p2', sort_order: 0 },
            { label: 'Attendant', qual_rule: 'any_field', sort_order: 1 },
          ]
  const sres = await supabase
    .from('sched_seats')
    .insert(seatsToAdd.map((s) => ({ ...s, unit_id: unitId })))
  if (sres.error) return sres.error.message
  audit('unit.add', `Added unit ${opts.code} (${opts.preset})`, { entity: 'unit', entityId: unitId })
  await loadCore()
  return null
}

/** Show/hide a unit everywhere. Deactivating keeps every bit of its
 *  history in the database — boards, pickers, and counts just stop
 *  walking it; reactivate to bring it back exactly as it was. */
async function setUnitActive(unitId: string, isActive: boolean): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  const res = await supabase.from('sched_units').update({ active: isActive }).eq('id', unitId)
  if (res.error) return res.error.message
  audit(isActive ? 'unit.reactivate' : 'unit.deactivate', `${isActive ? 'Reactivated' : 'Deactivated'} unit ${units.value.find((u) => u.id === unitId)?.code ?? '?'}`, { entity: 'unit', entityId: unitId })
  await loadCore()
  await reloadRangeIfLoaded()
  return null
}

/** Permanently delete a unit + its seats and rotation template rows.
 *  Refused when any schedule entries reference the unit or its seats —
 *  real history is protected; deactivate those units instead. */
async function deleteUnit(unitId: string): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  const seatIds = seats.value.filter((s) => s.unitId === unitId).map((s) => s.id)
  const c1 = await supabase
    .from('sched_entries')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', unitId)
  if (c1.error) return c1.error.message
  let seatEntryCount = 0
  if (seatIds.length > 0) {
    const c2 = await supabase
      .from('sched_entries')
      .select('id', { count: 'exact', head: true })
      .in('seat_id', seatIds)
    if (c2.error) return c2.error.message
    seatEntryCount = c2.count ?? 0
  }
  const total = (c1.count ?? 0) + seatEntryCount
  if (total > 0) {
    return `This unit has ${total} schedule ${total === 1 ? 'entry' : 'entries'} on the books — deactivate it instead so history stays intact.`
  }
  if (seatIds.length > 0) {
    const dr = await supabase.from('sched_rotation_assignments').delete().in('seat_id', seatIds)
    if (dr.error) return dr.error.message
    const ds = await supabase.from('sched_seats').delete().in('id', seatIds)
    if (ds.error) return ds.error.message
  }
  const dn = await supabase.from('sched_day_notes').delete().eq('unit_id', unitId)
  if (dn.error) return dn.error.message
  const du = await supabase.from('sched_units').delete().eq('id', unitId)
  if (du.error) return du.error.message
  audit('unit.delete', `Deleted unit ${units.value.find((u) => u.id === unitId)?.code ?? '?'} (no history)`, { entity: 'unit', entityId: unitId })
  await loadCore()
  await reloadRangeIfLoaded()
  return null
}

/** Set a unit's repeating rotation pattern (null = agency 48/96) and
 *  its daily shift window (null/06:00 pair = the standard 24-hour
 *  0600 → 0600 shift). Pattern tokens are 'A'/'B'/'C' or '' for an
 *  unstaffed day, anchored to `anchor` (agency anchor when null). */
async function saveUnitRotation(
  unitId: string,
  pattern: string[] | null,
  anchor: string | null,
  shiftStart: string | null,
  shiftEnd: string | null,
): Promise<string | null> {
  if (pattern) {
    if (pattern.length === 0) return 'The pattern needs at least one day.'
    const bad = pattern.find((t) => !['A', 'B', 'C', ''].includes(t))
    if (bad !== undefined) return `"${bad}" is not a valid day — use A, B, C, or leave blank for off.`
    if (!pattern.some((t) => t !== '')) return 'The pattern never staffs the unit — every day is off.'
  }
  const defaultHours =
    (!shiftStart || shiftStart === '06:00') && (!shiftEnd || shiftEnd === '06:00')
  const res = await supabase
    .from('sched_units')
    .update({
      rotation_pattern: pattern,
      rotation_anchor: pattern ? anchor : null,
      shift_start: defaultHours ? null : shiftStart,
      shift_end: defaultHours ? null : shiftEnd,
    })
    .eq('id', unitId)
  if (res.error) return res.error.message
  audit('unit.rotation', `Updated ${units.value.find((u) => u.id === unitId)?.code ?? '?'} rotation & shift hours`, { entity: 'unit', entityId: unitId, detail: { pattern, anchor, shiftStart, shiftEnd } })
  await loadCore()
  await reloadRangeIfLoaded()
  return null
}

async function saveUnitOrder(orderedIds: string[]): Promise<string | null> {
  for (let i = 0; i < orderedIds.length; i++) {
    const res = await supabase
      .from('sched_units')
      .update({ sort_order: i })
      .eq('id', orderedIds[i])
    if (res.error) return res.error.message
  }
  audit('unit.reorder', 'Reordered unit display', { entity: 'unit' })
  await loadCore()
  return null
}

// ── page-outs ────────────────────────────────────────────────────────

export interface OpenShiftItem {
  entryId: string | null
  dateIso: string
  /** Unit code when the shift rides a unit (null for event slots). */
  unit: string | null
  /** Seat/position label — what's needed ("Paramedic", "Attendant"). */
  position: string | null
  window: string // '0600–0600'
  text: string
}

/** Open coverage in a date range: open ENTRY rows (carved vacancies,
 *  event slots, rider seats) plus template seats with nobody assigned
 *  that day. Fresh-fetched — never trusts the loaded board range. */
async function findOpenShifts(startIso: string, endIso: string): Promise<OpenShiftItem[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  const res = await supabase
    .from('sched_entries')
    .select('id, work_date, seat_id, unit_id, user_id, kind, status, start_at, end_at, student_program, note')
    .gte('work_date', startIso)
    .lte('work_date', endIso)
  if (res.error) return []
  const rows = (res.data ?? []).filter((r) => r.kind !== 'timeoff' && r.status !== 'off')
  const out: OpenShiftItem[] = []
  const fmtD = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  for (const r of rows) {
    if (r.status !== 'open') continue
    const w = `${hhmm(r.start_at)}–${hhmm(r.end_at)}`
    if (r.seat_id) {
      const seat = seats.value.find((s) => s.id === r.seat_id)
      const unit = seat ? units.value.find((u) => u.id === seat.unitId) : null
      if (unit && !unit.active) continue
      out.push({ entryId: r.id, dateIso: r.work_date, unit: unit?.code ?? null, position: seat?.label ?? null, window: w, text: `${fmtD(r.work_date)} · ${unit?.code ?? '?'} ${seat?.label ?? 'seat'} · ${w}` })
    } else if (r.kind === 'event') {
      out.push({ entryId: r.id, dateIso: r.work_date, unit: null, position: r.student_program ?? null, window: w, text: `${fmtD(r.work_date)} · ${r.note ?? 'Event'} — ${r.student_program ?? 'slot'} · ${w}` })
    } else if (r.kind === 'rider') {
      const unit = units.value.find((u) => u.id === r.unit_id)
      if (unit && !unit.active) continue
      out.push({ entryId: r.id, dateIso: r.work_date, unit: unit?.code ?? null, position: r.student_program ?? null, window: w, text: `${fmtD(r.work_date)} · ${unit?.code ?? '?'} extra ${r.student_program ?? 'seat'} · ${w}` })
    }
  }
  const rowsBySeatDate = new Set(rows.filter((r) => r.seat_id).map((r) => `${r.work_date}|${r.seat_id}`))
  for (let iso = startIso; iso <= endIso; iso = addDaysIso(iso, 1)) {
    for (const seat of activeSeatList()) {
      if (rowsBySeatDate.has(`${iso}|${seat.id}`)) continue
      const unit = units.value.find((u) => u.id === seat.unitId)
      if (!unit || unitPlatoonFor(unit, iso) === null) continue
      if (seatRotationOccupant(seat.id, iso) !== null) continue
      const uw = unitDayWindow(unit, iso)
      out.push({ entryId: null, dateIso: iso, unit: unit.code, position: seat.label, window: `${uw.startHm}–${uw.endHm}`, text: `${fmtD(iso)} · ${unit.code} ${seat.label} · ${uw.startHm}–${uw.endHm}` })
    }
  }
  out.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.text.localeCompare(b.text))
  return out
}

/** Everyone with ANY coverage on a work date (entry rows override
 *  rotation per seat, matching the board's occupancy rules). Used by
 *  the page-out composer's "only people off duty" filter. */
async function assignedUserIdsOn(dateIso: string): Promise<Set<string>> {
  const out = new Set<string>()
  const auth = useAuthStore()
  if (auth.usingDevStub) return out
  const res = await supabase
    .from('sched_entries')
    .select('seat_id, user_id, kind, status')
    .eq('work_date', dateIso)
  const rows = (res.data ?? []).filter((r) => r.kind !== 'timeoff' && r.status !== 'off')
  const overridden = new Set(rows.filter((r) => r.seat_id).map((r) => r.seat_id as string))
  for (const r of rows) if (r.user_id) out.add(r.user_id)
  for (const seat of activeSeatList()) {
    if (overridden.has(seat.id)) continue
    const occ = seatRotationOccupant(seat.id, dateIso)
    if (occ) out.add(occ)
  }
  return out
}

/** Fresh lookup for a page-out deep link (?pickup=<entryId>): enough
 *  to open the slot modal if the entry is STILL open, null otherwise. */
async function fetchOpenEntryInfo(entryId: string): Promise<{
  dateIso: string
  seatId: string | null
  label: string
  start: string
  end: string
} | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return null
  const res = await supabase
    .from('sched_entries')
    .select('id, work_date, seat_id, unit_id, kind, status, start_at, end_at, student_program, note')
    .eq('id', entryId)
    .maybeSingle()
  if (res.error || !res.data || res.data.status !== 'open') return null
  const r = res.data
  let label = 'Open shift'
  if (r.seat_id) {
    const seat = seats.value.find((s) => s.id === r.seat_id)
    const unit = seat ? units.value.find((u) => u.id === seat.unitId) : null
    label = `${unit?.code ?? ''} ${seat?.label ?? 'Open seat'}`.trim()
  } else if (r.kind === 'event') {
    label = `${r.note ?? 'Event'} — ${r.student_program ?? 'slot'}`
  } else if (r.kind === 'rider') {
    const unit = units.value.find((u) => u.id === r.unit_id)
    label = `${unit?.code ?? ''} extra ${r.student_program ?? 'seat'}`.trim()
  }
  return {
    dateIso: r.work_date,
    seatId: r.seat_id,
    label,
    start: hhmm(r.start_at),
    end: hhmm(r.end_at),
  }
}

export interface PageShift {
  entryId: string | null
  dateIso: string
  unit: string | null
  position: string | null
  window: string
  text: string
}

export interface PageLogRow {
  id: string
  message: string
  messageType: 'scheduling' | 'announcement'
  urgent: boolean
  shifts: PageShift[]
  channels: { push?: boolean; email?: boolean; sms?: boolean }
  recipients: string[]
  delivery: { push?: number; email?: number; sms?: number; skipped_sms?: number; errors?: string[] } | null
  entryIds: string[]
  sentBy: string | null
  sentAt: string
  entriesOpen: number
}

async function fetchPageLog(): Promise<PageLogRow[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  const res = await supabase
    .from('sched_pages')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(20)
  if (res.error) return []
  const pages = res.data ?? []
  const allIds = [...new Set(pages.flatMap((p) => (p.entry_ids ?? []) as string[]))]
  const openById = new Map<string, boolean>()
  if (allIds.length > 0) {
    const eres = await supabase.from('sched_entries').select('id, status').in('id', allIds)
    for (const r of eres.data ?? []) openById.set(r.id, r.status === 'open')
  }
  return pages.map((p) => ({
    id: p.id,
    message: p.message,
    messageType: (p.message_type === 'announcement' ? 'announcement' : 'scheduling') as 'scheduling' | 'announcement',
    urgent: !!p.urgent,
    shifts: (Array.isArray(p.shifts) ? p.shifts : []) as PageShift[],
    channels: p.channels ?? {},
    recipients: (p.recipients ?? []) as string[],
    delivery: p.delivery && Object.keys(p.delivery).length > 0 ? p.delivery : null,
    entryIds: (p.entry_ids ?? []) as string[],
    sentBy: p.sent_by,
    sentAt: p.sent_at,
    entriesOpen: ((p.entry_ids ?? []) as string[]).filter((id) => openById.get(id) === true).length,
  }))
}

async function createPageOut(opts: {
  message: string
  messageType: 'scheduling' | 'announcement'
  urgent: boolean
  shifts: PageShift[]
  channels: { push: boolean; email: boolean; sms: boolean }
  audience: Record<string, unknown>
  recipients: string[]
}): Promise<{ id: string | null; error: string | null }> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { id: null, error: 'Not available in the dev preview.' }
  const res = await supabase
    .from('sched_pages')
    .insert({
      message: opts.message,
      message_type: opts.messageType,
      urgent: opts.urgent,
      shifts: opts.shifts,
      channels: opts.channels,
      audience: opts.audience,
      entry_ids: opts.shifts.map((s) => s.entryId).filter((x): x is string => !!x),
      recipients: opts.recipients,
      sent_by: auth.appUser?.id ?? null,
    })
    .select('id')
    .single()
  if (res.error) return { id: null, error: res.error.message }
  audit('pageout.send', `${opts.urgent ? 'URGENT ' : ''}${opts.messageType === 'announcement' ? 'Announcement' : 'Page-out'} to ${opts.recipients.length} ${opts.recipients.length === 1 ? 'person' : 'people'}: "${opts.message.slice(0, 80)}"`, { entity: 'page', entityId: res.data.id as string })
  return { id: res.data.id as string, error: null }
}

async function sendPageOut(pageId: string): Promise<{
  delivery: { push?: number; email?: number; sms?: number; skippedSms?: number; errors?: string[] } | null
  error: string | null
}> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { delivery: null, error: 'Not available in the dev preview.' }
  const { data, error } = await supabase.functions.invoke('sched-notify', {
    body: { kind: 'pageout', pageId },
  })
  if (error) return { delivery: null, error: error.message }
  const d = data as { ok?: boolean; delivery?: { push?: number; email?: number; sms?: number; skippedSms?: number; errors?: string[] }; error?: string } | null
  if (!d?.ok) return { delivery: null, error: d?.error ?? 'Send failed' }
  return { delivery: d.delivery ?? null, error: null }
}

async function setAccess(
  userId: string,
  lvl: 'global_admin' | 'scheduler' | 'supervisor' | 'hr' | 'view_only' | 'none' | null,
): Promise<string | null> {
  if (lvl === null) {
    const res = await supabase.from('sched_access').delete().eq('user_id', userId)
    if (res.error) return res.error.message
  } else {
    const res = await supabase
      .from('sched_access')
      .upsert({ user_id: userId, level: lvl }, { onConflict: 'user_id' })
    if (res.error) return res.error.message
  }
  audit('access.set', `Set ${displayName(userId).name}'s access to ${lvl ?? 'default'}`, { entity: 'access', entityId: userId })
  return null
}

async function fetchMemberSettings(userId: string): Promise<MemberSettings> {
  const empty: MemberSettings = { userId, qualOverrides: {}, unitExclusions: [], notify: {}, smsOptIn: false, smsPhone: null, highlightColor: null }
  const auth = useAuthStore()
  if (auth.usingDevStub) return empty
  const res = await supabase
    .from('sched_member_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (res.error || !res.data) return empty
  return {
    userId,
    qualOverrides: (res.data.qual_overrides ?? {}) as Record<string, 'allow' | 'deny'>,
    unitExclusions: res.data.unit_exclusions ?? [],
    notify: res.data.notify ?? {},
    smsOptIn: !!res.data.sms_opt_in,
    smsPhone: (res.data.sms_phone as string | null) ?? null,
    highlightColor: (res.data.highlight_color as string | null) ?? null,
  }
}

async function setCredential(userId: string, credential: string | null): Promise<string | null> {
  const auth = useAuthStore()
  if (credential === null) {
    const res = await supabase.from('sched_credentials').delete().eq('user_id', userId)
    if (res.error) return res.error.message
  } else {
    const res = await supabase.from('sched_credentials').upsert(
      { user_id: userId, credential, updated_by: auth.appUser?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    if (res.error) return res.error.message
  }
  audit('credential.set', `Set ${displayName(userId).name}'s credential to ${credential ?? 'Auto'}`, { entity: 'member', entityId: userId })
  await loadCore()
  return null
}

async function saveMemberSettings(s: MemberSettings): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  const res = await supabase.from('sched_member_settings').upsert(
    {
      user_id: s.userId,
      qual_overrides: s.qualOverrides,
      unit_exclusions: s.unitExclusions,
      notify: s.notify,
      sms_opt_in: s.smsOptIn,
      sms_phone: s.smsPhone?.trim() || null,
      highlight_color: s.highlightColor || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (res.error) return res.error.message
  if (s.userId === auth.appUser?.id) myHighlight.value = s.highlightColor ?? null
  /* Self-saves can come from the profile modal, where the people map
     isn't loaded — fall back to the signed-in name over 'Unknown'. */
  let who = displayName(s.userId).name
  if (who === 'Unknown' && s.userId === auth.appUser?.id && auth.appUser?.fullName) {
    who = auth.appUser.fullName
  }
  audit('member.settings', `Updated ${who}'s scheduler settings`, { entity: 'member', entityId: s.userId })
  return null
}

async function fetchAccessList(): Promise<{ userId: string; level: string }[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  const res = await supabase.from('sched_access').select('user_id, level')
  return (res.data ?? []).map((r) => ({ userId: r.user_id, level: r.level }))
}

// ── time verification (end-of-shift · truck attest · pay-period) ────
// Three-layer attestation chain (Justin, 2026-09-28): members confirm
// their own times when a shift block ends, the on-duty supervisors
// attest each truck's roster the morning after (per truck — S201 may
// not know about a change on S202's side of the county), and everyone
// signs off their pay-period hours before HR keys Paycom Monday
// morning (crew deadline: 10:00 Sunday). Discrepancies ride
// sched_requests as type 'discrepancy' so the existing queue and
// "Already handled" close them. The sched-notify cron sends the
// prompts — push + email ONLY, never SMS.

export interface VerificationRow {
  id: string
  kind: 'shift_confirm' | 'shift_attest' | 'period_signoff'
  userId: string
  workDate: string | null
  unitId: string | null
  periodEnd: string | null
  status: 'confirmed' | 'flagged' | 'approved' | 'disputed'
  note: string | null
  snapshot: Record<string, unknown>
  createdAt: string
}

function mapVerification(r: Record<string, unknown>): VerificationRow {
  return {
    id: r.id as string,
    kind: r.kind as VerificationRow['kind'],
    userId: r.user_id as string,
    workDate: (r.work_date as string | null) ?? null,
    unitId: (r.unit_id as string | null) ?? null,
    periodEnd: (r.period_end as string | null) ?? null,
    status: r.status as VerificationRow['status'],
    note: (r.note as string | null) ?? null,
    snapshot: (r.snapshot as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
  }
}

/** One ended-but-unconfirmed run of shifts on my schedule. */
export interface VerifyBlock {
  dates: string[] // work dates the run covers, oldest first
  lines: { dateIso: string; window: string; hours: number }[]
  endMs: number
  hours: number
}

export interface SignoffPending {
  period: PayPeriod
  dueText: string
  overdue: boolean
}

async function fetchEntriesFresh(startIso: string, endIso: string): Promise<SchedEntry[] | null> {
  const res = await supabase
    .from('sched_entries')
    .select('*')
    .gte('work_date', startIso)
    .lte('work_date', endIso)
  if (res.error) return null
  return (res.data ?? []).map(mapEntry)
}

/** The most recently CLOSED pay period — the one sign-off targets. */
export function lastClosedPeriod(todayIso: string): PayPeriod {
  const cur = payPeriodFor(todayIso)
  return payPeriodFor(addDaysIso(cur.start, -1))
}

/**
 * Everything the signed-in member still owes: shift runs that ended
 * without a confirmation, and the last closed period's sign-off.
 * Fresh-fetched; call after ensureLoaded().
 */
async function fetchMyVerifyPending(): Promise<{
  blocks: VerifyBlock[]
  signoff: SignoffPending | null
}> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (auth.usingDevStub || !me) return { blocks: [], signoff: null }
  const today = todayCentralIso()
  const start = addDaysIso(today, -4)
  const rows = await fetchEntriesFresh(start, today)
  if (rows === null) return { blocks: [], signoff: null }

  // per-date segments → merged runs (a 48 abuts at 0600 and joins)
  const dates: string[] = []
  for (let d = start; d <= today; d = addDaysIso(d, 1)) dates.push(d)
  const perDate = new Map<string, Seg[]>()
  const all: Seg[] = []
  for (const d of dates) {
    const segs = segsForUserOnDate(d, me, rows)
    perDate.set(d, segs)
    all.push(...segs)
  }
  const now = Date.now()
  const ended = mergeSegs(all).filter((r) => r.end <= now)

  let blocks: VerifyBlock[] = []
  if (ended.length > 0) {
    const cRes = await supabase
      .from('sched_verifications')
      .select('work_date')
      .eq('kind', 'shift_confirm')
      .eq('user_id', me)
      .gte('work_date', start)
    const confirmed = new Set(
      ((cRes.data ?? []) as { work_date: string }[]).map((r) => r.work_date),
    )
    for (const run of ended) {
      const covered = dates.filter((d) => {
        const dayStart = tsMs(centralTs(d, '06:00'))
        const dayEnd = tsMs(centralTs(addDaysIso(d, 1), '06:00'))
        return Math.min(run.end, dayEnd) - Math.max(run.start, dayStart) >= MIN_SEG_MS
      })
      if (covered.length === 0 || covered.every((d) => confirmed.has(d))) continue
      const lines = covered.map((d) => {
        const segs = (perDate.get(d) ?? []).filter(
          (s) => Math.min(s.end, run.end) - Math.max(s.start, run.start) >= MIN_SEG_MS,
        )
        const window = segs
          .map((s) => `${hhmm(new Date(s.start).toISOString())} – ${hhmm(new Date(s.end).toISOString())}`)
          .join(', ')
        return { dateIso: d, window, hours: round1(segHours(segs)) }
      })
      blocks.push({
        dates: covered,
        lines,
        endMs: run.end,
        hours: round1((run.end - run.start) / 3_600_000),
      })
    }
    blocks = blocks.sort((a, b) => a.endMs - b.endMs)
  }

  // pay-period sign-off: pending until answered, only if they had hours
  let signoff: SignoffPending | null = null
  const period = lastClosedPeriod(today)
  const sRes = await supabase
    .from('sched_verifications')
    .select('id')
    .eq('kind', 'period_signoff')
    .eq('user_id', me)
    .eq('period_end', period.end)
    .maybeSingle()
  if (!sRes.error && !sRes.data) {
    const pRows = await fetchEntriesFresh(period.start, period.end)
    if (pRows) {
      let total = 0
      for (let d = period.start; d <= period.end; d = addDaysIso(d, 1)) {
        total += segHours(segsForUserOnDate(d, me, pRows))
      }
      if (total >= 0.1) {
        const dueIso = addDaysIso(period.end, 1)
        const dueMs = tsMs(centralTs(dueIso, '10:00'))
        const dueText = `${new Date(`${dueIso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} 10:00`
        signoff = { period, dueText, overdue: now > dueMs }
      }
    }
  }
  return { blocks, signoff }
}

/** "My times are right" — one confirm row per covered work date. */
async function confirmMyTimes(block: VerifyBlock): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (auth.usingDevStub || !me) return 'Not available in the dev preview.'
  for (const d of block.dates) {
    const res = await supabase.from('sched_verifications').insert({
      kind: 'shift_confirm',
      user_id: me,
      work_date: d,
      status: 'confirmed',
      snapshot: { lines: block.lines.filter((l) => l.dateIso === d) },
    })
    // 23505 = already confirmed (double-tap, or a prior partial run)
    if (res.error && res.error.code !== '23505') return res.error.message
  }
  audit('verify.confirm', `Confirmed shift times for ${block.dates.join(', ')}`, { entity: 'verification' })
  return null
}

/** A "something's off" note → the approval queue as a discrepancy. */
async function fileDiscrepancy(opts: {
  workDate: string
  note: string
  unitCode?: string | null
  subjectUserId?: string | null
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (auth.usingDevStub || !me) return 'Not available in the dev preview.'
  const note = opts.note.trim()
  if (!note) return 'Say what was off — the note is what the schedulers act on.'
  const res = await supabase
    .from('sched_requests')
    .insert({
      type: 'discrepancy',
      requester_id: me,
      counterparty_id: opts.subjectUserId ?? null,
      work_date: opts.workDate,
      unit_code: opts.unitCode ?? null,
      comments: note.slice(0, 500),
    })
    .select('id')
  if (res.error) return res.error.message
  notify('request_submitted', {
    requestIds: ((res.data ?? []) as { id: string }[]).map((r) => r.id),
  })
  audit(
    'verify.discrepancy',
    `Flagged a time discrepancy on ${opts.workDate}${opts.unitCode ? ` (${opts.unitCode})` : ''}: "${note.slice(0, 80)}"`,
    { entity: 'request' },
  )
  await loadRequests()
  return null
}

/** Attest rows for one work date (all trucks). */
async function fetchAttestDay(dateIso: string): Promise<VerificationRow[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  const res = await supabase
    .from('sched_verifications')
    .select('*')
    .eq('kind', 'shift_attest')
    .eq('work_date', dateIso)
  if (res.error) return []
  return (res.data ?? []).map(mapVerification)
}

/**
 * One truck, one verdict: roster matched, or a flag with a note. A
 * flag also files the note as a discrepancy so the queue carries it
 * to the schedulers.
 */
async function attestTruck(
  dateIso: string,
  unitId: string,
  flagged: boolean,
  note: string,
): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (auth.usingDevStub || !me) return 'Not available in the dev preview.'
  const unit = units.value.find((u) => u.id === unitId)
  if (flagged && !note.trim())
    return 'Say what changed — the note is what payroll and the schedulers act on.'
  // freeze what the board showed at attest time
  const um = dayModel(dateIso).units.find((x) => x.unit.id === unitId)
  const snapRows =
    um?.seats.flatMap((sm) =>
      sm.rows.map((r) => `${sm.seat.label}: ${r.open ? 'OPEN' : r.name} ${r.start}–${r.end}`),
    ) ?? []
  const res = await supabase.from('sched_verifications').insert({
    kind: 'shift_attest',
    user_id: me,
    work_date: dateIso,
    unit_id: unitId,
    status: flagged ? 'flagged' : 'confirmed',
    note: note.trim() || null,
    snapshot: { rows: snapRows },
  })
  if (res.error) {
    if (res.error.code === '23505')
      return `${unit?.code ?? 'This truck'} is already attested — another supervisor beat you to it.`
    return res.error.message
  }
  if (flagged) await fileDiscrepancy({ workDate: dateIso, note, unitCode: unit?.code ?? null })
  audit(
    'verify.attest',
    `${flagged ? 'Flagged' : 'Attested'} ${unit?.code ?? 'unit'} for ${dateIso}${flagged ? ` — "${note.trim().slice(0, 80)}"` : ''}`,
    { entity: 'verification' },
  )
  return null
}

/** Editors: unwind a mistaken verification row. */
async function deleteVerification(id: string): Promise<string | null> {
  const res = await supabase.from('sched_verifications').delete().eq('id', id)
  if (res.error) return res.error.message
  audit('verify.delete', 'Removed a verification record', { entity: 'verification', entityId: id })
  return null
}

/** Per-day hours in a period — the sign-off review table. Worked
 *  windows count toward the total; time-off rows show labeled. */
async function fetchMyPeriodBreakdown(
  period: PayPeriod,
  userId?: string,
): Promise<{
  rows: { dateIso: string; window: string; hours: number; label?: string }[]
  total: number
  error: string | null
}> {
  const auth = useAuthStore()
  const me = userId ?? auth.appUser?.id
  if (auth.usingDevStub || !me) return { rows: [], total: 0, error: null }
  const pRows = await fetchEntriesFresh(period.start, period.end)
  if (pRows === null) return { rows: [], total: 0, error: 'Could not load the period.' }
  const out: { dateIso: string; window: string; hours: number; label?: string }[] = []
  let total = 0
  for (let d = period.start; d <= period.end; d = addDaysIso(d, 1)) {
    const segs = segsForUserOnDate(d, me, pRows)
    if (segs.length > 0) {
      const window = segs
        .map((s) => `${hhmm(new Date(s.start).toISOString())} – ${hhmm(new Date(s.end).toISOString())}`)
        .join(', ')
      const hrs = round1(segHours(segs))
      total += hrs
      out.push({ dateIso: d, window, hours: hrs })
    }
    for (const o of pRows.filter(
      (e) => e.kind === 'timeoff' && e.userId === me && e.workDate === d,
    )) {
      out.push({
        dateIso: d,
        window: `${hhmm(o.startAt)} – ${hhmm(o.endAt)}`,
        hours: round1((tsMs(o.endAt) - tsMs(o.startAt)) / 3_600_000),
        label: OFF_LABELS[o.offType ?? ''] ?? 'Time off',
      })
    }
  }
  return { rows: out, total: round1(total), error: null }
}

/** Approve (or dispute) my pay-period hours. */
async function signoffPeriod(
  period: PayPeriod,
  total: number,
  disputed = false,
  note = '',
): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (auth.usingDevStub || !me) return 'Not available in the dev preview.'
  const res = await supabase.from('sched_verifications').insert({
    kind: 'period_signoff',
    user_id: me,
    period_end: period.end,
    status: disputed ? 'disputed' : 'approved',
    note: note.trim() || null,
    snapshot: { total },
  })
  if (res.error) {
    if (res.error.code === '23505') return 'This period is already signed off.'
    return res.error.message
  }
  audit(
    disputed ? 'verify.dispute' : 'verify.signoff',
    `${disputed ? 'Disputed' : 'Approved'} pay-period hours ${period.label}${note ? ` — "${note.trim().slice(0, 80)}"` : ''}`,
    { entity: 'verification' },
  )
  return null
}

/** Editors/HR: the whole verification picture for one pay period. */
async function fetchVerifyBoard(period: PayPeriod): Promise<{
  signoffs: VerificationRow[]
  attests: VerificationRow[]
  confirms: VerificationRow[]
  error: string | null
}> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return { signoffs: [], attests: [], confirms: [], error: null }
  const [sRes, aRes, cRes] = await Promise.all([
    supabase
      .from('sched_verifications')
      .select('*')
      .eq('kind', 'period_signoff')
      .eq('period_end', period.end),
    supabase
      .from('sched_verifications')
      .select('*')
      .eq('kind', 'shift_attest')
      .gte('work_date', period.start)
      .lte('work_date', period.end),
    supabase
      .from('sched_verifications')
      .select('*')
      .eq('kind', 'shift_confirm')
      .gte('work_date', period.start)
      .lte('work_date', period.end),
  ])
  const err = sRes.error ?? aRes.error ?? cRes.error
  if (err) return { signoffs: [], attests: [], confirms: [], error: err.message }
  return {
    signoffs: (sRes.data ?? []).map(mapVerification),
    attests: (aRes.data ?? []).map(mapVerification),
    confirms: (cRes.data ?? []).map(mapVerification),
    error: null,
  }
}

// ── public composable ────────────────────────────────────────────────

export function useSchedule() {
  const auth = useAuthStore()

  const canEdit = computed(
    () => level.value === 'global_admin' || level.value === 'scheduler',
  )
  const isGlobalAdmin = computed(() => level.value === 'global_admin')
  const canPageOut = computed(() => canEdit.value || level.value === 'supervisor')
  /** HR: payroll surfaces (Time Reports export + Paycom setup card),
   *  no rotation/day editing. */
  const isHr = computed(() => level.value === 'hr')
  /** View-only: every board, zero self-service (no requests/trades). */
  const isViewOnly = computed(() => level.value === 'view_only')
  /** COMPANY-WIDE since 2026-09-17 (Justin: "swap on for company"):
   *  everyone except explicit 'none' is in. The pilot list no longer
   *  gates anything. KEEP IN STEP with useScheduleAccess (nav probe). */
  const canAccessModule = computed(() => level.value !== 'none')
  /** May file requests / offers / claims — everyone in the module
   *  except view-only (RLS enforces the same rule server-side). */
  const canRequest = computed(() => canAccessModule.value && !isViewOnly.value)

  const myUserId = computed(() => auth.appUser?.id ?? null)

  async function ensureLoaded() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      await loadCore()
    } finally {
      loading.value = false
    }
  }

  return {
    // state
    units,
    seats,
    rotation,
    entries,
    requests,
    availability,
    dayNotes,
    people,
    allPeople,
    myHighlight,
    applyRosterVisibility,
    personById,
    level,
    loaded,
    loading,
    loadError,
    rangeStart,
    rangeEnd,
    // access
    canEdit,
    isGlobalAdmin,
    canPageOut,
    canAccessModule,
    isHr,
    isViewOnly,
    canRequest,
    myUserId,
    // loaders
    ensureLoaded,
    loadCore,
    loadRange,
    loadRequests,
    startRealtime,
    // engine
    platoonFor,
    dayModel,
    daySummary,
    payPeriodFor,
    payPeriodList,
    todayCentralIso,
    addDaysIso,
    hhmm,
    centralTs,
    hoursBetween,
    displayName,
    // mutations
    assignRotation,
    assignRotationResolved,
    findRotationClashes,
    rotationOccupantAt: rotationOccupant,
    dayOverlaps,
    removeRotationAssignment,
    addUnit,
    saveUnitOrder,
    saveUnitRotation,
    setUnitActive,
    deleteUnit,
    setAccess,
    eventTooltip,
    fetchLeaveBalances,
    fetchLeaveLedger,
    fetchLeaveTaken,
    adjustLeave,
    setLeaveProfile,
    openLeaveBalances,
    assignTimeOff,
    pendingLeaveHours,
    projectedLeaveBalance,
    fetchAccessList,
    fetchAuditLog,
    findOpenShifts,
    assignedUserIdsOn,
    fetchOpenEntryInfo,
    fetchPageLog,
    createPageOut,
    sendPageOut,
    // requests
    upcomingShiftsFor,
    openSeatsFor,
    fetchMySchedule,
    fetchTimeSegments,
    createTimeOffRequests,
    createExtraRequest,
    createPickupRequest,
    assignOpenSeat,
    canFillSeat,
    qualWarnings,
    cancelRequest,
    decideRequest,
    updateRequestWindow,
    reopenRequest,
    // day editor + availability
    dayMarkOff,
    dayOpenWindow,
    blockOpenWindow,
    dayRemove,
    dayRetime,
    dayReplace,
    dayMove,
    dayLedgerFor,
    dayImbalances,
    seatTitle,
    holdsViaOverride,
    markUnavailable,
    clearUnavailable,
    listMyUnavailable,
    checkUnavailable,
    // editor tools
    schedEvents,
    addEvent,
    deleteEventBox,
    assignEventSlot,
    addEventSlot,
    removeEntry,
    updateEntryWindow,
    updateTimeOff,
    addStudent,
    addRiderSeats,
    updateStudentEntry,
    updateEventListing,
    addDayNote,
    deleteDayNote,
    updateDayNote,
    // hours engine + settings
    settings,
    warningThresholds,
    riderPositions,
    paycomCodes,
    hoursCheck,
    hoursCheckWindow,
    saveSetting,
    reloadSettings,
    // trades
    tradeOffers,
    loadTradeOffers,
    createTradePosting,
    respondToDirect,
    makeOffer,
    withdrawOffer,
    acceptOffer,
    declineOffer,
    // member settings
    fetchMemberSettings,
    saveMemberSettings,
    setCredential,
    // time verification
    fetchMyVerifyPending,
    confirmMyTimes,
    fileDiscrepancy,
    fetchAttestDay,
    attestTruck,
    deleteVerification,
    fetchMyPeriodBreakdown,
    signoffPeriod,
    fetchVerifyBoard,
  }
}
