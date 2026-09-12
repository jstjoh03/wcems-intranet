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
export type SchedLevel = 'global_admin' | 'scheduler' | 'supervisor' | 'member'

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

export interface DayModel {
  dateIso: string
  platoon: Platoon
  units: UnitModel[]
  unattached: SeatRow[] // extras/students/events with no unit
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

const PAY_ANCHOR = '2026-09-01'
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

// ── module state (singleton across views) ────────────────────────────

const units = ref<SchedUnit[]>([])
const seats = ref<SchedSeat[]>([])
const rotation = ref<RotationAssignment[]>([])
const entries = ref<SchedEntry[]>([]) // loaded range
const requests = ref<SchedRequest[]>([])
const availability = ref<Availability[]>([])
const dayNotes = ref<DayNote[]>([])
const people = ref<SchedPerson[]>([])
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
  const [uRes, sRes, rRes, pRes, lvlRes] = await Promise.all([
    supabase.from('sched_units').select('*').order('sort_order'),
    supabase.from('sched_seats').select('*').order('sort_order'),
    supabase.from('sched_rotation_assignments').select('*'),
    supabase
      .from('app_users')
      .select('id, full_name, shift, role, title, account_type, active, employment_type')
      .eq('account_type', 'person')
      .eq('active', true)
      .order('full_name'),
    supabase.rpc('sched_level'),
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
  people.value = (pRes.data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    shift: r.shift,
    role: r.role,
    credential: credentialFromTitle(r.title),
  }))
  level.value = (lvlRes.data as SchedLevel) ?? 'member'
  loaded.value = true
}

function seedDevStub(): void {
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
      out.push({ id: `dev-s-${u.code}-0`, unitId: u.id, label: lead, qualRule: u.code === 'M231' ? 'aic_or_p2' : 'p2', sortOrder: 0, active: true })
      out.push({ id: `dev-s-${u.code}-1`, unitId: u.id, label: 'Attendant', qualRule: 'any_field', sortOrder: 1, active: true })
    }
  }
  seats.value = out
  people.value = [
    { id: 'dev-p-1', fullName: 'Sample Paramedic', shift: 'A', role: 'crew', credential: 'EMT-P' },
    { id: 'dev-p-2', fullName: 'Sample Attendant', shift: 'A', role: 'crew', credential: 'EMT-B' },
  ]
}

/** 'Paramedic' → 'EMT-P' style suffix shown after names, from app_users.title. */
function credentialFromTitle(title: string | null): string | null {
  if (!title) return null
  const t = title.toLowerCase()
  if (t.includes('paramedic')) return 'EMT-P'
  if (t.includes('aemt') || t.includes('advanced')) return 'AEMT'
  if (t.includes('emt')) return 'EMT-B'
  return null
}

async function loadRange(startIso: string, endIso: string): Promise<void> {
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    rangeStart.value = startIso
    rangeEnd.value = endIso
    return
  }
  const [eRes, nRes, aRes] = await Promise.all([
    supabase
      .from('sched_entries')
      .select('*')
      .gte('work_date', startIso)
      .lte('work_date', endIso),
    supabase.from('sched_day_notes').select('*').gte('on_date', startIso).lte('on_date', endIso),
    supabase.from('sched_availability').select('*').gte('on_date', startIso).lte('on_date', endIso),
  ])
  const err = eRes.error ?? nRes.error ?? aRes.error
  if (err) {
    loadError.value = err.message
    return
  }
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
          },
        ]
      }
      seatModels.push({ seat, rows })
    }

    const extras = dayEntries
      .filter((e) => e.unitId === unit.id && (e.kind === 'extra' || e.kind === 'student'))
      .sort((a, b) => a.startAt.localeCompare(b.startAt))
      .map((e) => {
        const who = displayName(e.userId)
        return {
          entryId: e.id,
          userId: e.userId,
          name: who.name,
          credential: who.credential,
          start: hhmm(e.startAt),
          end: hhmm(e.endAt),
          kind: e.kind,
          open: false,
          isRotation: false,
        }
      })

    const notes = dayNotes.value.filter((n) => n.onDate === dateIso && n.unitId === unit.id)
    unitModels.push({ unit, seats: seatModels, extras, notes })
  }

  const unattached = dayEntries
    .filter((e) => e.unitId === null && (e.kind === 'extra' || e.kind === 'student' || e.kind === 'event'))
    .map((e) => {
      const who = displayName(e.userId)
      return {
        entryId: e.id,
        userId: e.userId,
        name: who.name,
        credential: who.credential,
        start: hhmm(e.startAt),
        end: hhmm(e.endAt),
        kind: e.kind,
        open: false,
        isRotation: false,
      }
    })

  const notes = dayNotes.value.filter((n) => n.onDate === dateIso && n.unitId === null)
  return { dateIso, platoon, units: unitModels, unattached, notes, openCount }
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

async function setAccess(userId: string, lvl: 'global_admin' | 'scheduler' | null): Promise<string | null> {
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
  /** Soft-launch gate: only editors see /schedule while the module is built out. */
  const canAccessModule = computed(() => canEdit.value)

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
    saveUnitOrder,
    setAccess,
    fetchAccessList,
  }
}
