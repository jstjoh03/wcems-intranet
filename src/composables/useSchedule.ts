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
export type SchedLevel = 'global_admin' | 'scheduler' | 'supervisor' | 'member' | 'none'

export interface SchedUnit {
  id: string
  code: string
  label: string
  station: string
  sortOrder: number
  active: boolean
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
  type: 'pickup' | 'trade' | 'giveaway' | 'time_off' | 'extra_hours'
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
  title: string | null
  email: string | null
  phone: string | null
  paycomCode: string | null
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
}

/** One special event on a day: its own box under the set schedule. */
export interface DayEventBox {
  label: string
  eventId: string | null
  start: string | null // 'HHmm' when known
  end: string | null
  notes: string | null // hover detail set when the event was created
  rows: SeatRow[] // assigned staff + open event seats
}

/** Row in a labeled day section (Extra Hours / Time Off / Trades). */
export interface LabeledRow {
  entryId: string
  name: string
  credential: string | null
  start: string
  end: string
  sub: string // second line: 'M272 / Paramedic', 'Vacation Time', 'For X'
}

export interface DayModel {
  dateIso: string
  platoon: Platoon
  units: UnitModel[]
  events: DayEventBox[]
  extraHours: LabeledRow[]
  timeOff: LabeledRow[]
  trades: LabeledRow[]
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

/** Which platoon starts its 24-hour work date at 0600 on this date. */
export function platoonFor(dateIso: string): Platoon {
  const d = daysBetweenIso(ROT_ANCHOR, dateIso)
  return ROT_SEQ[((d % 6) + 6) % 6]
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
const settings = ref<Record<string, Record<string, unknown>>>({})
const level = ref<SchedLevel>('member')
const loaded = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const rangeStart = ref('')
const rangeEnd = ref('')

const personById = computed(() => {
  const m = new Map<string, SchedPerson>()
  for (const p of people.value) m.set(p.id, p)
  return m
})

function displayName(userId: string | null): { name: string; credential: string | null } {
  if (!userId) return { name: '', credential: null }
  const p = personById.value.get(userId)
  return p ? { name: p.fullName, credential: p.credential } : { name: 'Unknown', credential: null }
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
  const [uRes, sRes, rRes, pRes, lvlRes, cRes, setRes] = await Promise.all([
    supabase.from('sched_units').select('*').order('sort_order'),
    supabase.from('sched_seats').select('*').order('sort_order'),
    supabase.from('sched_rotation_assignments').select('*'),
    supabase
      .from('app_users')
      .select('id, full_name, shift, role, title, email, phone, account_type, active, employment_type, paycom_employee_code')
      .eq('account_type', 'person')
      .eq('active', true)
      .order('full_name'),
    supabase.rpc('sched_level'),
    supabase.from('sched_credentials').select('user_id, credential'),
    supabase.from('sched_settings').select('key, value'),
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
  people.value = (pRes.data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    shift: r.shift,
    role: r.role,
    credential: credByUser.get(r.id) ?? defaultInternalCredential(r.role, r.title),
    title: r.title,
    email: r.email,
    phone: r.phone,
    paycomCode: r.paycom_employee_code ?? null,
  }))
  const setMap: Record<string, Record<string, unknown>> = {}
  for (const r of (setRes.data ?? []) as { key: string; value: Record<string, unknown> }[]) {
    setMap[r.key] = r.value ?? {}
  }
  settings.value = setMap
  level.value = (lvlRes.data as SchedLevel) ?? 'member'
  loaded.value = true
}

function seedDevStub(): void {
  settings.value = {
    pay: { period_days: 14, period_anchor: PAY_ANCHOR, workday_start: '06:00', ot_week_hours: 40 },
    warnings: { consecutive_warn_hours: 60, consecutive_confirm_hours: 72, weekly_warn_hours: 84 },
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
    { id: 'dev-p-1', fullName: 'Sample Paramedic', shift: 'A', role: 'crew', credential: 'P2', title: 'Paramedic', email: 'sample@wallercountyems.com', phone: '(555) 555-0101', paycomCode: 'A00X' },
    { id: 'dev-p-2', fullName: 'Sample Attendant', shift: 'A', role: 'crew', credential: 'EMT', title: 'EMT', email: 'sample2@wallercountyems.com', phone: '(555) 555-0102', paycomCode: null },
  ]
}

export const INTERNAL_CREDENTIALS = [
  'Supervisor', 'EMT', 'AEMT', 'P1C', 'P1', 'P2', 'P3', 'EMT-FTO', 'P2-FTO', 'P3-FTO',
] as const

/** Which internal credentials satisfy each seat rule for SELF-SERVICE
 *  (pickups, trade claims). Supervisors hold any seat. P1s may cover a
 *  Paramedic-in-charge seat ONLY by Chief assignment — never listed
 *  here for p2, so they cannot pick those up themselves; the Chief's
 *  direct-assign path is the approval and bypasses this list. */
export const QUAL_RULE_CREDENTIALS: Record<string, readonly string[]> = {
  p2: ['P2', 'P3', 'P2-FTO', 'P3-FTO', 'Supervisor'],
  aemt_or_higher: ['AEMT', 'P1C', 'P1', 'P2', 'P3', 'P2-FTO', 'P3-FTO', 'Supervisor'],
  supervisor: ['Supervisor'],
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
): Promise<{ ok: boolean; reason: string | null }> {
  const seat = seats.value.find((s) => s.id === seatId)
  if (!seat) return { ok: true, reason: null }
  const unit = units.value.find((u) => u.id === seat.unitId)
  const person = personById.value.get(userId)
  const settings = await fetchMemberSettings(userId)
  if (unit && settings.unitExclusions.includes(unit.id)) {
    return { ok: false, reason: `You are excluded from ${unit.code}.` }
  }
  const override = settings.qualOverrides[seat.qualRule]
  if (override === 'allow') return { ok: true, reason: null }
  if (override === 'deny') {
    return { ok: false, reason: `You are excluded from ${seat.label} seats.` }
  }
  const allowed = QUAL_RULE_CREDENTIALS[seat.qualRule] ?? []
  const cred = person?.credential ?? null
  if (cred && allowed.includes(cred)) return { ok: true, reason: null }
  return {
    ok: false,
    reason: `Your credential (${cred ?? 'not set'}) does not qualify for this ${seat.label} seat. The Chief can still assign it directly.`,
  }
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

// ── generation: rotation template → day model ────────────────────────

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

export function dayModel(dateIso: string): DayModel {
  const platoon = platoonFor(dateIso)
  const dayEntries = entries.value.filter((e) => e.workDate === dateIso)
  const unitModels: UnitModel[] = []
  let openCount = 0

  for (const unit of units.value.filter((u) => u.active)) {
    const unitSeats = seats.value
      .filter((s) => s.unitId === unit.id && s.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const seatModels: SeatModel[] = []

    for (const seat of unitSeats) {
      const overrides = dayEntries
        .filter((e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off')
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
      let rows: SeatRow[]
      if (overrides.length > 0) {
        rows = overrides.map((e) => {
          const who = displayName(e.userId)
          const open = e.userId === null && e.status === 'open'
          if (open) openCount++
          return {
            entryId: e.id,
            userId: e.userId,
            name: who.name,
            credential: who.credential,
            start: hhmm(e.startAt),
            end: hhmm(e.endAt),
            kind: e.kind,
            open,
            isRotation: false,
            note: null,
          }
        })
      } else {
        const occupant = rotationOccupant(seat.id, platoon, dateIso)
        const who = displayName(occupant)
        const open = occupant === null
        if (open) openCount++
        rows = [
          {
            entryId: null,
            userId: occupant,
            name: who.name,
            credential: who.credential,
            start: '0600',
            end: '0600',
            kind: 'rotation',
            open,
            isRotation: !open,
            note: null,
          },
        ]
      }
      seatModels.push({ seat, rows })
    }

    // Only students ride inside the unit block; approved extra hours get
    // their own labeled section below the schedule (Aladtec style).
    const extras = dayEntries
      .filter((e) => e.unitId === unit.id && e.kind === 'student')
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
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

    const notes = dayNotes.value.filter((n) => n.onDate === dateIso && n.unitId === unit.id)
    unitModels.push({ unit, seats: seatModels, extras, notes })
  }

  const unattached = dayEntries
    .filter((e) => e.unitId === null && e.kind === 'student')
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
    eventBoxes.push({
      label,
      eventId: listing?.id ?? null,
      start: listing ? listing.startTime.replace(':', '') : null,
      end: listing ? listing.endTime.replace(':', '') : null,
      notes: listing?.notes ?? null,
      rows: rows
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .map((e) => {
          const who = displayName(e.userId)
          const open = e.userId === null && e.status === 'open'
          if (open) openCount++
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
        }),
    })
  }
  for (const ev of listings) {
    if (!byLabel.has(ev.label)) {
      eventBoxes.push({
        label: ev.label,
        eventId: ev.id,
        start: ev.startTime.replace(':', ''),
        end: ev.endTime.replace(':', ''),
        notes: ev.notes,
        rows: [],
      })
    }
  }

  // Labeled day sections, Aladtec style.
  const unitCodeById = new Map(units.value.map((u) => [u.id, u.code]))
  const extraHours: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'extra')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      const unitCode = e.unitId ? unitCodeById.get(e.unitId) : null
      const sub = [unitCode, e.note].filter(Boolean).join(' / ')
      return {
        entryId: e.id,
        name: who.name || 'Unknown',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        sub,
      }
    })

  const OFF_LABELS: Record<string, string> = {
    vacation: 'Vacation Time',
    sick: 'Sick Time',
    unpaid: 'Unpaid Time Off',
    bereavement: 'Bereavement',
    other: 'Time Off',
  }
  const timeOff: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'timeoff')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
        name: who.name || 'Unknown',
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        sub: e.note || OFF_LABELS[e.offType ?? 'other'] || 'Time Off',
      }
    })

  const trades: LabeledRow[] = dayEntries
    .filter((e) => e.kind === 'trade' && e.userId !== null)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
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
    unattached,
    notes,
    openCount,
  }
}

/** Lightweight month-cell summary without building full unit models. */
export function daySummary(dateIso: string, myUserId: string | null) {
  const platoon = platoonFor(dateIso)
  const dayEntries = entries.value.filter((e) => e.workDate === dateIso)
  let open = 0
  let mine = false
  let myStart = '0600'
  let myEnd = '0600'

  for (const seat of seats.value.filter((s) => s.active)) {
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
      const occ = rotationOccupant(seat.id, platoon, dateIso)
      if (occ === null) open++
      else if (myUserId && occ === myUserId) mine = true
    }
  }
  // extras/students count as my shift too
  if (myUserId) {
    for (const e of dayEntries) {
      if (e.userId === myUserId && (e.kind === 'extra' || e.kind === 'student')) {
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
    const platoon = platoonFor(iso)
    const dayEntries = entries.value.filter((e) => e.workDate === iso)
    for (const seat of seats.value.filter((s) => s.active)) {
      const overrides = dayEntries.filter(
        (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
      )
      const holds =
        overrides.length > 0
          ? overrides.some((e) => e.userId === userId)
          : rotationOccupant(seat.id, platoon, iso) === userId
      if (holds) {
        const u = unitByid.get(seat.unitId)
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
  code: 'consecutive' | 'consecutive_confirm' | 'weekly' | 'ot' | 'check_failed'
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

/** Thresholds from sched_settings (Chief-editable in Setup). */
function warningThresholds() {
  const w = (settings.value['warnings'] ?? {}) as Record<string, unknown>
  const p = (settings.value['pay'] ?? {}) as Record<string, unknown>
  return {
    consecutiveWarn: Number(w.consecutive_warn_hours ?? 60),
    consecutiveConfirm: Number(w.consecutive_confirm_hours ?? 72),
    weeklyWarn: Number(w.weekly_warn_hours ?? 84),
    otWeek: Number(p.ot_week_hours ?? 40),
  }
}

/** A user's held on-duty segments for one work date, computed from raw
 *  entry rows with the same overlay semantics as dayModel: entry rows on
 *  a seat replace its rotation occupant; extras/events/students add on. */
function segsForUserOnDate(dateIso: string, userId: string, rows: SchedEntry[]): Seg[] {
  const dayRows = rows.filter((e) => e.workDate === dateIso)
  const platoon = platoonFor(dateIso)
  const out: Seg[] = []
  for (const seat of seats.value.filter((s) => s.active)) {
    const seatRows = dayRows.filter(
      (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
    )
    if (seatRows.length > 0) {
      for (const e of seatRows) {
        if (e.userId === userId && e.status === 'scheduled') {
          out.push({ start: tsMs(e.startAt), end: tsMs(e.endAt) })
        }
      }
    } else if (rotationOccupant(seat.id, platoon, dateIso) === userId) {
      out.push({
        start: tsMs(centralTs(dateIso, '06:00')),
        end: tsMs(centralTs(addDaysIso(dateIso, 1), '06:00')),
      })
    }
  }
  for (const e of dayRows) {
    if (
      e.seatId === null &&
      e.userId === userId &&
      e.status === 'scheduled' &&
      (e.kind === 'extra' || e.kind === 'event' || e.kind === 'student')
    ) {
      out.push({ start: tsMs(e.startAt), end: tsMs(e.endAt) })
    }
  }
  return out
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
  if (weekHours >= t.weeklyWarn) {
    warnings.push({
      code: 'weekly',
      hours: wk,
      limit: t.weeklyWarn,
      message: `${subjectName} would reach ${wk} hours this week (warning starts at ${t.weeklyWarn}).`,
    })
  } else if (weekHours > t.otWeek) {
    warnings.push({
      code: 'ot',
      hours: wk,
      limit: t.otWeek,
      message: `${subjectName} would be over ${t.otWeek} hours this week — overtime.`,
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
): Promise<HoursInfo> {
  const w = shiftWindow(dateIso, from, until)
  return hoursCheck(userId, [{ dateIso, startAt: w.reqStart, endAt: w.reqEnd }], subjectName)
}

/** Persist one settings key (global admins only, enforced by RLS). */
async function saveSetting(key: string, value: Record<string, unknown>): Promise<string | null> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return 'Not available in the dev preview.'
  const res = await supabase.from('sched_settings').upsert(
    { key, value, updated_by: auth.appUser?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (res.error) return res.error.message
  settings.value = { ...settings.value, [key]: value }
  return null
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
  const res = await supabase.from('sched_requests').insert(rows)
  if (res.error) return res.error.message
  await loadRequests()
  return null
}

async function createExtraRequest(opts: {
  dateIso: string
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
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const unit = units.value.find((u) => u.id === opts.unitId)
  const res = await supabase.from('sched_requests').insert({
    type: 'extra_hours',
    requester_id: me,
    work_date: opts.dateIso,
    start_at: w.reqStart,
    end_at: w.reqEnd,
    time_type: opts.timeType,
    unit_code: unit?.code ?? null,
    position_label: opts.positionLabel || null,
    comments: opts.comments || null,
    warnings: opts.warnings ?? [],
  })
  if (res.error) return res.error.message
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
  if (opts.seatId) {
    const q = await canFillSeat(me, opts.seatId)
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
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const seat = seats.value.find((s) => s.id === opts.seatId)
  const unit = units.value.find((u) => u.id === seat?.unitId)
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
    warnings: opts.warnings ?? [],
  })
  if (res.error) return res.error.message
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

async function createTradePosting(opts: {
  type: 'giveaway' | 'trade'
  dateIso: string
  seatId: string
  from: string
  until: string
  comments: string
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  const w = shiftWindow(opts.dateIso, opts.from, opts.until)
  const seat = seats.value.find((s) => s.id === opts.seatId)
  const unit = units.value.find((u) => u.id === seat?.unitId)
  const res = await supabase.from('sched_requests').insert({
    type: opts.type,
    requester_id: me,
    seat_id: opts.seatId,
    work_date: opts.dateIso,
    start_at: w.reqStart,
    end_at: w.reqEnd,
    unit_code: unit?.code ?? null,
    position_label: seat?.label ?? null,
    comments: opts.comments || null,
  })
  if (res.error) return res.error.message
  await loadRequests()
  return null
}

async function makeOffer(opts: {
  requestId: string
  offerShift: { dateIso: string; seatId: string } | null
  note: string
}): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id
  if (!me) return 'Not signed in'
  // taking/covering the posted shift means filling the poster's seat
  const posting = requests.value.find((r) => r.id === opts.requestId)
  if (posting?.seatId) {
    const q = await canFillSeat(me, posting.seatId)
    if (!q.ok) return q.reason
  }
  let offerFields: Record<string, unknown> = {}
  if (opts.offerShift) {
    const w = shiftWindow(opts.offerShift.dateIso, '06:00', '06:00')
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
  await loadTradeOffers()
  return null
}

async function withdrawOffer(offerId: string): Promise<string | null> {
  const res = await supabase
    .from('sched_trade_offers')
    .update({ status: 'withdrawn' })
    .eq('id', offerId)
  if (res.error) return res.error.message
  await loadTradeOffers()
  return null
}

/** Poster accepts one offer → request moves to the Chief's queue.
 *  Hour-threshold warnings for whoever GAINS hours are computed here and
 *  stored on the request so the Chief's approval card shows them. */
async function acceptOffer(req: SchedRequest, offer: TradeOffer): Promise<string | null> {
  const warnings: HoursWarning[] = []
  if (req.workDate && req.startAt && req.endAt) {
    const who = personById.value.get(offer.userId)?.fullName ?? 'The claimant'
    const info = await hoursCheck(
      offer.userId,
      [{ dateIso: req.workDate, startAt: req.startAt, endAt: req.endAt }],
      who,
    )
    warnings.push(...info.warnings)
  }
  if (offer.offerWorkDate && offer.offerStartAt && offer.offerEndAt) {
    const who = personById.value.get(req.requesterId)?.fullName ?? 'The poster'
    const info = await hoursCheck(
      req.requesterId,
      [{ dateIso: offer.offerWorkDate, startAt: offer.offerStartAt, endAt: offer.offerEndAt }],
      who,
    )
    warnings.push(...info.warnings)
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
  await Promise.all([loadRequests(), loadTradeOffers()])
  return null
}

async function declineOffer(offerId: string): Promise<string | null> {
  const res = await supabase
    .from('sched_trade_offers')
    .update({ status: 'declined' })
    .eq('id', offerId)
  if (res.error) return res.error.message
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
    if (
      seatEntries.length === 0 &&
      rotationOccupant(seatId, platoonFor(dateIso), dateIso) === userId
    ) {
      const dayStart = tsMs(centralTs(dateIso, '06:00'))
      const dayEnd = tsMs(centralTs(addDaysIso(dateIso, 1), '06:00'))
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
async function applyTimeOff(
  workDate: string,
  seatId: string | null,
  userId: string,
  offType: string | null,
  startAt: string,
  endAt: string,
  sourceRequest: string | null,
): Promise<string | null> {
  const rows: Record<string, unknown>[] = []
  if (seatId) {
    const { segs, error } = await carveSeatWindow(workDate, seatId, userId, tsMs(startAt), tsMs(endAt))
    if (error) return error
    for (const seg of segs) {
      rows.push({
        work_date: workDate, seat_id: seatId, user_id: null,
        start_at: new Date(seg.start).toISOString(), end_at: new Date(seg.end).toISOString(),
        kind: 'giveaway_cover', status: 'open', source_request: sourceRequest,
      })
    }
  }
  rows.push({
    work_date: workDate, seat_id: seatId, user_id: userId,
    start_at: startAt, end_at: endAt, kind: 'timeoff', status: 'off',
    off_type: offType, source_request: sourceRequest,
  })
  const ins = await supabase.from('sched_entries').insert(rows)
  return ins.error ? ins.error.message : null
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
    // Rotation-open seat: verify no rows have appeared on it meanwhile.
    const fres = await supabase
      .from('sched_entries')
      .select('id, status, kind')
      .eq('work_date', opts.dateIso)
      .eq('seat_id', opts.seatId)
    if (fres.error) return fres.error.message
    const liveRows = (fres.data ?? []).filter((r) => r.kind !== 'timeoff' && r.status !== 'off')
    if (liveRows.length > 0) {
      await reloadRangeIfLoaded()
      return STALE
    }
    const rows: Record<string, unknown>[] = [
      { work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.userId,
        start_at: w.reqStart, end_at: w.reqEnd, kind: 'pickup', status: 'scheduled' },
    ]
    if (w.before) {
      rows.push({ work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
        start_at: w.before.start, end_at: w.before.end, kind: 'rotation', status: 'open' })
    }
    if (w.after) {
      rows.push({ work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
        start_at: w.after.start, end_at: w.after.end, kind: 'rotation', status: 'open' })
    }
    const ins = await supabase.from('sched_entries').insert(rows)
    if (ins.error) return ins.error.message
  }
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
  seatId: string
  userId: string
  offType: string
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
  const rows: Record<string, unknown>[] = []
  for (const seg of segs) {
    rows.push({
      work_date: opts.dateIso, seat_id: opts.seatId, user_id: null,
      start_at: new Date(seg.start).toISOString(), end_at: new Date(seg.end).toISOString(),
      kind: 'giveaway_cover', status: 'open',
    })
    rows.push({
      work_date: opts.dateIso, seat_id: opts.seatId, user_id: opts.userId,
      start_at: new Date(seg.start).toISOString(), end_at: new Date(seg.end).toISOString(),
      kind: 'timeoff', status: 'off', off_type: opts.offType,
    })
  }
  const ins = await supabase.from('sched_entries').insert(rows)
  if (ins.error) return ins.error.message
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
  const remErr = await dayRemove({
    dateIso: opts.dateIso,
    seatId: opts.fromSeatId,
    userId: opts.userId,
  })
  if (remErr) {
    return `Moved onto the new seat, but their old seat could not be opened: ${remErr}`
  }
  return null
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
  await reloadRangeIfLoaded()
  return null
}

async function clearUnavailable(id: string): Promise<string | null> {
  const res = await supabase.from('sched_availability').delete().eq('id', id)
  if (res.error) return res.error.message
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

async function addEvent(opts: {
  dateIso: string
  label: string
  from: string
  until: string
  paramedicSlots: number
  attendantSlots: number
  notes: string
}): Promise<string | null> {
  const auth = useAuthStore()
  const ins = await supabase.from('sched_events').insert({
    label: opts.label,
    on_date: opts.dateIso,
    start_time: normTime(opts.from),
    end_time: normTime(opts.until),
    seats_total: opts.paramedicSlots + opts.attendantSlots,
    notes: opts.notes || null,
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
  await reloadRangeIfLoaded()
  return null
}

/** Delete an event box: its staffing/open rows and its listing. */
async function deleteEventBox(dateIso: string, label: string, eventId: string | null): Promise<string | null> {
  const del = await supabase
    .from('sched_entries')
    .delete()
    .eq('work_date', dateIso)
    .eq('kind', 'event')
    .eq('note', label)
  if (del.error) return del.error.message
  if (eventId) {
    const del2 = await supabase.from('sched_events').delete().eq('id', eventId)
    if (del2.error) return del2.error.message
  } else {
    await supabase.from('sched_events').delete().eq('on_date', dateIso).eq('label', label)
  }
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
    .select('id')
  if (res.error) return res.error.message
  if (!res.data || res.data.length === 0) {
    await reloadRangeIfLoaded()
    return 'That slot no longer exists — the board has changed.'
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
  await reloadRangeIfLoaded()
  return null
}

async function removeEntry(entryId: string): Promise<string | null> {
  const res = await supabase.from('sched_entries').delete().eq('id', entryId)
  if (res.error) return res.error.message
  await reloadRangeIfLoaded()
  return null
}

/** Attach/update the hover note on an established event. Boxes that came
 *  from staffing rows alone (no sched_events listing yet, e.g. imported
 *  history) get a listing created so the note has somewhere to live. */
async function setEventNotes(
  dateIso: string,
  label: string,
  eventId: string | null,
  startHHmm: string | null, // box times, 'HHmm' — used only when creating a listing
  endHHmm: string | null,
  notes: string,
): Promise<string | null> {
  const auth = useAuthStore()
  const val = notes.trim() || null
  if (eventId) {
    const res = await supabase.from('sched_events').update({ notes: val }).eq('id', eventId)
    if (res.error) return res.error.message
  } else {
    const res = await supabase.from('sched_events').insert({
      label,
      on_date: dateIso,
      start_time: startHHmm ? normTime(startHHmm) : '06:00',
      end_time: endHHmm ? normTime(endHHmm) : '06:00',
      seats_total: 0,
      notes: val,
      created_by: auth.appUser?.id ?? null,
    })
    if (res.error) return res.error.message
  }
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
  await reloadRangeIfLoaded()
  return null
}

async function deleteDayNote(id: string): Promise<string | null> {
  const res = await supabase.from('sched_day_notes').delete().eq('id', id)
  if (res.error) return res.error.message
  await reloadRangeIfLoaded()
  return null
}

async function cancelRequest(id: string): Promise<string | null> {
  const res = await supabase
    .from('sched_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (res.error) return res.error.message
  await loadRequests()
  return null
}

/** Find the seat a user effectively holds on a date (entry override first,
 *  then rotation), or null if they aren't on the board that day. */
function seatHeldBy(userId: string, dateIso: string): string | null {
  const dayEntries = entries.value.filter((e) => e.workDate === dateIso)
  for (const e of dayEntries) {
    if (e.seatId && e.userId === userId && e.kind !== 'timeoff' && e.status !== 'off') return e.seatId
  }
  const platoon = platoonFor(dateIso)
  for (const seat of seats.value.filter((s) => s.active)) {
    const hasOverride = dayEntries.some(
      (e) => e.seatId === seat.id && e.kind !== 'timeoff' && e.status !== 'off',
    )
    if (!hasOverride && rotationOccupant(seat.id, platoon, dateIso) === userId) return seat.id
  }
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
): Promise<string | null> {
  const auth = useAuthStore()
  const me = auth.appUser?.id ?? null

  if (approve) {
    if (req.type === 'time_off' && req.workDate) {
      const seatId = req.seatId ?? seatHeldBy(req.requesterId, req.workDate)
      const err = await applyTimeOff(
        req.workDate,
        seatId,
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
        // Rotation-open seat (no entry rows yet).
        const dayStart = centralTs(req.workDate, '06:00')
        const dayEnd = centralTs(addDaysIso(req.workDate, 1), '06:00')
        const rows: Record<string, unknown>[] = [
          {
            work_date: req.workDate,
            seat_id: req.seatId,
            user_id: req.requesterId,
            start_at: req.startAt,
            end_at: req.endAt,
            kind: 'pickup',
            status: 'scheduled',
            source_request: req.id,
          },
        ]
        if (req.startAt && req.startAt > dayStart) {
          rows.push({
            work_date: req.workDate,
            seat_id: req.seatId,
            user_id: null,
            start_at: dayStart,
            end_at: req.startAt,
            kind: 'rotation',
            status: 'open',
          })
        }
        if (req.endAt && req.endAt < dayEnd) {
          rows.push({
            work_date: req.workDate,
            seat_id: req.seatId,
            user_id: null,
            start_at: req.endAt,
            end_at: dayEnd,
            kind: 'rotation',
            status: 'open',
          })
        }
        const ins = await supabase.from('sched_entries').insert(rows)
        if (ins.error) return ins.error.message
      }
    }
  }

  const upd = await supabase
    .from('sched_requests')
    .update({
      status: approve ? 'approved' : 'denied',
      decided_by: me,
      decided_at: new Date().toISOString(),
      decision_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.id)
  if (upd.error) return upd.error.message

  await Promise.all([loadRequests(), rangeStart.value ? loadRange(rangeStart.value, rangeEnd.value) : Promise.resolve()])
  return null
}

// ── mutations (editor-gated by RLS; callers re-load after) ──────────

/**
 * Point a seat/platoon at a person from a given date forward. Closes any
 * open-ended assignment that would overlap, so history stays intact and
 * past days keep rendering who actually held the seat.
 */
async function assignRotation(
  seatId: string,
  platoon: Platoon,
  userId: string | null,
  effectiveFrom: string,
): Promise<string | null> {
  // Protection: one person, one seat at a time. Block if they already
  // hold ANY other seat (any platoon) for an overlapping period.
  if (userId !== null) {
    const clash = rotation.value.find(
      (a) =>
        a.userId === userId &&
        !(a.seatId === seatId && a.platoon === platoon) &&
        (a.effectiveTo === null || a.effectiveTo >= effectiveFrom),
    )
    if (clash) {
      const seat = seats.value.find((s) => s.id === clash.seatId)
      const unit = units.value.find((u) => u.id === seat?.unitId)
      const who = personById.value.get(userId)?.fullName ?? 'This person'
      return `${who} already holds ${unit?.code ?? '?'} ${seat?.label ?? ''} on ${clash.platoon} Shift (from ${clash.effectiveFrom}${clash.effectiveTo ? ` to ${clash.effectiveTo}` : ''}). End or reassign that seat first.`
    }
  }
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
  await loadCore()
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
  await loadCore()
  return null
}

async function setAccess(
  userId: string,
  lvl: 'global_admin' | 'scheduler' | 'none' | null,
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
  return null
}

async function fetchMemberSettings(userId: string): Promise<MemberSettings> {
  const empty: MemberSettings = { userId, qualOverrides: {}, unitExclusions: [], notify: {}, smsOptIn: false }
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
  await loadCore()
  return null
}

async function saveMemberSettings(s: MemberSettings): Promise<string | null> {
  const res = await supabase.from('sched_member_settings').upsert(
    {
      user_id: s.userId,
      qual_overrides: s.qualOverrides,
      unit_exclusions: s.unitExclusions,
      notify: s.notify,
      sms_opt_in: s.smsOptIn,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  return res.error ? res.error.message : null
}

async function fetchAccessList(): Promise<{ userId: string; level: string }[]> {
  const auth = useAuthStore()
  if (auth.usingDevStub) return []
  const res = await supabase.from('sched_access').select('user_id, level')
  return (res.data ?? []).map((r) => ({ userId: r.user_id, level: r.level }))
}

// ── public composable ────────────────────────────────────────────────

export function useSchedule() {
  const auth = useAuthStore()

  const canEdit = computed(
    () => level.value === 'global_admin' || level.value === 'scheduler',
  )
  const isGlobalAdmin = computed(() => level.value === 'global_admin')
  const canPageOut = computed(() => canEdit.value || level.value === 'supervisor')
  /** Soft-launch gate: editors always; supervisors added 2026-09-14 so
   *  field sups (Brittany testing the crew-side experience) get in
   *  before the crew-wide opening ~Sep 24. Supervisors get NO edit
   *  tools — they see the crew view: pickups, requests, trades. */
  const canAccessModule = computed(() => canEdit.value || level.value === 'supervisor')

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
    myUserId,
    // loaders
    ensureLoaded,
    loadCore,
    loadRange,
    loadRequests,
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
    removeRotationAssignment,
    addUnit,
    saveUnitOrder,
    setAccess,
    fetchAccessList,
    // requests
    upcomingShiftsFor,
    openSeatsFor,
    createTimeOffRequests,
    createExtraRequest,
    createPickupRequest,
    assignOpenSeat,
    canFillSeat,
    cancelRequest,
    decideRequest,
    // day editor + availability
    dayMarkOff,
    dayOpenWindow,
    dayRemove,
    dayReplace,
    dayMove,
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
    addStudent,
    updateStudentEntry,
    setEventNotes,
    addDayNote,
    deleteDayNote,
    // hours engine + settings
    settings,
    warningThresholds,
    hoursCheck,
    hoursCheckWindow,
    saveSetting,
    // trades
    tradeOffers,
    loadTradeOffers,
    createTradePosting,
    makeOffer,
    withdrawOffer,
    acceptOffer,
    declineOffer,
    // member settings
    fetchMemberSettings,
    saveMemberSettings,
    setCredential,
  }
}
