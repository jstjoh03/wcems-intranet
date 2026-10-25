// Live-lookup tools for the Ask WCEMS assistant.
//
// Every tool runs its queries through the CALLER's Supabase client, so
// RLS applies exactly as it does in the app — the assistant can never
// show someone data the portal itself wouldn't. Door/gate codes are
// structurally excluded: no tool selects those columns.
//
// SCHEDULE DERIVATION (fixed 2026-10-24 after the Erica Torr miss):
// sched_entries holds only DEVIATIONS — pickups, trades, time off,
// events, students, retimed seats. The regular crew comes from the
// rotation template: per-unit platoon pattern (or the agency 48/96
// default) + effective-dated seat assignments, with entry overrides
// replacing a seat's day and time off carved out of occupants'
// windows. buildDay() below is a faithful port of dayModel() in
// src/composables/useSchedule.ts — change them together.

interface SupabaseLike {
  from: (table: string) => any
  rpc: (fn: string, args?: Record<string, unknown>) => any
}

export interface ToolCtx {
  user: SupabaseLike
  userId: string
  role: string
}

/* ── Central-time helpers (shift change is 0600 Central) ───────────── */

function centralTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function centralHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  )
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The work_date whose crew is on duty right now (before 0600 Central,
 *  yesterday's shift still holds the county). */
function dutyDayISO(): string {
  const today = centralTodayISO()
  return centralHour() < 6 ? addDaysISO(today, -1) : today
}

function daysBetweenIso(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T12:00:00Z`) - Date.parse(`${aIso}T12:00:00Z`)) / 86400000)
}

/** B,B,C,C,A,A agency rotation anchored Monday 2026-04-06 = B Day 1. */
const ROT_ANCHOR = '2026-04-06'
const ROT_SEQ = ['B', 'B', 'C', 'C', 'A', 'A'] as const
type Platoon = 'A' | 'B' | 'C'

function platoonFor(iso: string): Platoon {
  const d = daysBetweenIso(ROT_ANCHOR, iso)
  return ROT_SEQ[((d % 6) + 6) % 6] as Platoon
}

function rotationDay(iso: string): 1 | 2 {
  const d = daysBetweenIso(ROT_ANCHOR, iso)
  return ((((d % 6) + 6) % 6) % 2 === 0 ? 1 : 2) as 1 | 2
}

/** Which platoon works THIS UNIT on this date — the unit's own repeating
 *  pattern when it has one (null = unit not staffed that day), else the
 *  agency default. Mirrors unitPlatoonFor in useSchedule.ts. */
function unitPlatoonFor(unit: Unit, iso: string): Platoon | null {
  if (!unit.rotation_pattern || unit.rotation_pattern.length === 0) return platoonFor(iso)
  const anchor = unit.rotation_anchor ?? ROT_ANCHOR
  const len = unit.rotation_pattern.length
  const d = daysBetweenIso(anchor, iso)
  const tok = String(unit.rotation_pattern[((d % len) + len) % len] ?? '').toUpperCase()
  return tok === 'A' || tok === 'B' || tok === 'C' ? (tok as Platoon) : null
}

const hhmmFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
})
function hhmm(ms: number): string {
  return hhmmFmt.format(new Date(ms))
}

/** Central UTC offset ("-05:00") on a given date — DST-correct per day. */
const offsetCache = new Map<string, string>()
function centralOffset(iso: string): string {
  let o = offsetCache.get(iso)
  if (!o) {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(`${iso}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value
    o = (part ?? 'GMT-06:00').replace('GMT', '') || '-06:00'
    offsetCache.set(iso, o)
  }
  return o
}

/** ms timestamp for HH:mm Central on a date (next day when addDay). */
function tsFor(iso: string, hm: string, addDay = false): number {
  const day = addDay ? addDaysISO(iso, 1) : iso
  return Date.parse(`${day}T${hm}:00${centralOffset(day)}`)
}

function j(v: unknown): string {
  return JSON.stringify(v)
}

/* ── Protocols project access ────────────────────────────────────────
   The protocol book content (protocols/protocol_steps/medication_
   details) lives in its own Supabase project — carried over when the
   standalone protocols PWA was absorbed (src/lib/supabaseProtocols.ts).
   Its publishable key ships in the portal's public JS bundle, so
   embedding it here reveals nothing new; tables are open-read to anon
   by design. Move these if the content ever consolidates. */
const PROTO_URL = 'https://ycahnwxzfyjfrgdavril.supabase.co'
const PROTO_KEY = 'sb_publishable_duljrqQ6P3BAqkvyusibXg_Lzdxor89'

async function protoGet(path: string): Promise<Record<string, any>[]> {
  const res = await fetch(`${PROTO_URL}/rest/v1/${path}`, {
    headers: { apikey: PROTO_KEY, Authorization: `Bearer ${PROTO_KEY}` },
  })
  if (!res.ok) throw new Error(`protocols ${res.status}`)
  return (await res.json()) as Record<string, any>[]
}

/* ── Schedule core (units / seats / rotation template / names) ─────── */

interface Unit {
  id: string
  code: string
  label: string
  sort_order: number
  rotation_pattern: string[] | null
  rotation_anchor: string | null
  shift_start: string | null
  shift_end: string | null
}
interface Seat {
  id: string
  unit_id: string
  label: string
  sort_order: number
}
interface RotAssign {
  seat_id: string
  user_id: string | null
  platoon: string
  effective_from: string
  effective_to: string | null
}
interface Entry {
  work_date: string
  kind: string
  status: string
  off_type: string | null
  start_at: string
  end_at: string
  user_id: string | null
  seat_id: string | null
  unit_id: string | null
  event_id: string | null
}

interface SchedCore {
  units: Unit[]
  seats: Seat[]
  rotation: RotAssign[]
}

async function loadSchedCore(ctx: ToolCtx): Promise<SchedCore> {
  const [u, s, r] = await Promise.all([
    ctx.user
      .from('sched_units')
      .select('id, code, label, sort_order, rotation_pattern, rotation_anchor, shift_start, shift_end')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    ctx.user.from('sched_seats').select('id, unit_id, label, sort_order').eq('active', true),
    ctx.user
      .from('sched_rotation_assignments')
      .select('seat_id, user_id, platoon, effective_from, effective_to'),
  ])
  if (u.error) throw new Error(u.error.message)
  if (s.error) throw new Error(s.error.message)
  if (r.error) throw new Error(r.error.message)
  return { units: (u.data ?? []) as Unit[], seats: (s.data ?? []) as Seat[], rotation: (r.data ?? []) as RotAssign[] }
}

async function fetchEntries(ctx: ToolCtx, from: string, to: string): Promise<Entry[]> {
  const { data, error } = await ctx.user
    .from('sched_entries')
    .select('work_date, kind, status, off_type, start_at, end_at, user_id, seat_id, unit_id, event_id')
    .gte('work_date', from)
    .lte('work_date', to)
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as Entry[]
}

async function namesFor(ctx: ToolCtx, ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)].filter(Boolean)
  if (!list.length) return new Map()
  const { data, error } = await ctx.user.from('app_users').select('id, full_name').in('id', list)
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((r) => [r.id, r.full_name]))
}

/** Latest effective-dated assignment for a seat+platoon on a date. */
function rotationOccupant(rotation: RotAssign[], seatId: string, platoon: Platoon, iso: string): string | null {
  let best: RotAssign | null = null
  for (const a of rotation) {
    if (a.seat_id !== seatId || a.platoon !== platoon) continue
    if (a.effective_from > iso) continue
    if (a.effective_to !== null && a.effective_to < iso) continue
    if (best === null || a.effective_from > best.effective_from) best = a
  }
  return best?.user_id ?? null
}

const MIN_SEG_MS = 60_000 // ignore sub-minute slivers (matches the app)

const KIND_LABEL: Record<string, string> = {
  rotation: 'rotation',
  pickup: 'pickup',
  trade: 'trade',
  giveaway_cover: 'covering a giveaway',
  extra: 'extra hours',
  event: 'event',
  student: 'student rider',
  timeoff: 'time off',
}

interface DayRow {
  userId: string | null
  unit: string
  seat: string
  s: number
  e: number
  kind: string
  open: boolean
}

interface DayModel {
  date: string
  rotation: { shift: Platoon; day: 1 | 2 }
  staffed: DayRow[]
  open: DayRow[]
  off: { userId: string; type: string; s: number; e: number }[]
  extras: Entry[] // events / students / extra-hours (not seat-derived)
}

/** Faithful port of dayModel(): rotation base per unit pattern, entry
 *  overrides replace a seat's day, occupants' time off carved to OPEN. */
function buildDay(iso: string, core: SchedCore, entries: Entry[]): DayModel {
  const dayEntries = entries.filter((e) => e.work_date === iso)
  const staffed: DayRow[] = []
  const open: DayRow[] = []

  const offWindows = new Map<string, { s: number; e: number }[]>()
  const off: DayModel['off'] = []
  for (const e of dayEntries) {
    if (e.kind !== 'timeoff' || !e.user_id) continue
    const w = { s: Date.parse(e.start_at), e: Date.parse(e.end_at) }
    const l = offWindows.get(e.user_id) ?? []
    l.push(w)
    offWindows.set(e.user_id, l)
    off.push({ userId: e.user_id, type: e.off_type ?? 'time off', ...w })
  }

  for (const unit of core.units) {
    const unitPlatoon = unitPlatoonFor(unit, iso)
    const unitSeats = core.seats
      .filter((s) => s.unit_id === unit.id)
      .sort((a, b) => a.sort_order - b.sort_order)
    for (const seat of unitSeats) {
      const overrides = dayEntries
        .filter((e) => e.seat_id === seat.id && e.kind !== 'timeoff' && e.status !== 'off')
        .sort((a, b) => a.start_at.localeCompare(b.start_at))

      let raw: { userId: string | null; s: number; e: number; kind: string; open: boolean }[]
      if (overrides.length > 0) {
        raw = overrides.map((e) => ({
          userId: e.user_id,
          s: Date.parse(e.start_at),
          e: Date.parse(e.end_at),
          kind: e.kind,
          open: e.user_id === null && e.status === 'open',
        }))
      } else if (unitPlatoon === null) {
        raw = [] // unit not staffed this day under its own pattern
      } else {
        const occupant = rotationOccupant(core.rotation, seat.id, unitPlatoon, iso)
        const sHm = unit.shift_start ? unit.shift_start.slice(0, 5) : '06:00'
        const eHm = unit.shift_end ? unit.shift_end.slice(0, 5) : '06:00'
        const s = tsFor(iso, sHm)
        const e = tsFor(iso, eHm, eHm <= sHm)
        raw = [{ userId: occupant, s, e, kind: 'rotation', open: occupant === null }]
      }

      /* Carve occupied windows against the occupant's time off — the
         overlap renders as an OPEN row, like the board. */
      for (const r of raw) {
        const target = { unit: unit.label || unit.code, seat: seat.label }
        const offs = r.userId && !r.open ? (offWindows.get(r.userId) ?? []) : []
        if (!offs.length) {
          ;(r.open ? open : staffed).push({ ...r, ...target })
          continue
        }
        let pieces = [{ s: r.s, e: r.e }]
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
        for (const p of pieces) staffed.push({ ...r, s: p.s, e: p.e, ...target })
        for (const o of opens)
          open.push({ userId: null, s: o.s, e: o.e, kind: 'rotation', open: true, ...target })
      }
    }
  }

  const extras = dayEntries.filter(
    (e) => (e.kind === 'event' || e.kind === 'student' || e.kind === 'extra') && !e.seat_id,
  )
  return { date: iso, rotation: { shift: platoonFor(iso), day: rotationDay(iso) }, staffed, open, off, extras }
}

function rowOut(r: DayRow, names: Map<string, string>) {
  return {
    unit: r.unit,
    seat: r.seat,
    name: r.userId ? (names.get(r.userId) ?? 'unknown') : null,
    times: `${hhmm(r.s)}–${hhmm(r.e)}`,
    ...(r.kind !== 'rotation' ? { via: KIND_LABEL[r.kind] ?? r.kind } : {}),
  }
}

function extraOut(e: Entry, names: Map<string, string>, unitLabel: (id: string | null) => string | null) {
  return {
    kind: KIND_LABEL[e.kind] ?? e.kind,
    name: e.user_id ? (names.get(e.user_id) ?? 'unknown') : null,
    open: e.status === 'open',
    unit: unitLabel(e.unit_id),
    times: `${hhmm(Date.parse(e.start_at))}–${hhmm(Date.parse(e.end_at))}`,
  }
}

function collectDayIds(d: DayModel): string[] {
  return [
    ...d.staffed.map((r) => r.userId),
    ...d.off.map((o) => o.userId),
    ...d.extras.map((e) => e.user_id),
  ].filter((x): x is string => !!x)
}

/* ── Tool definitions (static — part of the cached prompt prefix) ──── */

export const TOOL_DEFS = [
  {
    name: 'who_is_on_duty',
    description:
      'The live roster for one duty day, derived exactly like the schedule board: rotation seats per unit (with trades, pickups, and time off applied), open seats, time off, events, and student riders. Defaults to the CURRENT duty day (before 0600 Central that is yesterday\'s work date — shifts run 0600 to 0600). Use for "who is working", "who is on shift", "who is the supervisor today".',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: "Work date YYYY-MM-DD (the day the 24h shift STARTS). Omit for the current duty day." },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'person_schedule',
    description:
      'One person\'s schedule for the next N days (default 14), rotation seats included: which days they work, unit, seat, times, plus any time off. Use for "is NAME working today/tomorrow", "when does NAME work next". Matches the name loosely; returns candidates if ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial name of the employee' },
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 14, max 30)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'my_schedule',
    description:
      "The ASKER's own upcoming schedule for the next N days (default 14), rotation seats included: working days, unit, times, approved time off. Use for \"when do I work next\", \"am I on this weekend\".",
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 14, max 30)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'my_leave_balances',
    description:
      "The ASKER's vacation and sick balances in hours (credited, used, current balance). Full-time employees only — part-timers have no leave ledger.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'my_pending_requests',
    description:
      "The ASKER's open scheduling requests (time off, trades, pickups, extra hours) still waiting on a partner or the Chief, with status.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'open_shifts',
    description:
      'Open (unfilled) seats on the schedule for the next N days (default 14), vacant rotation seats and time-off gaps included — date, unit, seat, times. Use for "any open shifts", "what can I pick up".',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 14, max 30)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'upcoming_events',
    description:
      'Special events on the schedule for the next N days (default 30): name, dates, times, notes, and how many seats are filled vs total. Use for standbys, game coverage, fair details.',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 30, max 90)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'my_outstanding_items',
    description:
      "What the ASKER still owes: required-training modules not yet completed (with due dates) and policies awaiting acknowledgement (including re-acknowledgements after a version bump).",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'my_clinical_snapshot',
    description:
      "The ASKER's clinical development record: current working/cleared phase, certification level, FTO status, TX license number expiration, jurisprudence and bloodborne-pathogen dates. Use for \"when does my license expire\", \"what phase am I in\".",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_person',
    description:
      'Employee directory lookup: name, title, station, shift letter, phone, email. Only shows people who opted into the directory. Use for contact info or "what shift is NAME on".',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Full or partial name' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_hospitals',
    description:
      'The live hospital directory: trauma level, stroke level, PCI, pediatric, maternal/NICU, address, notes. Never includes door codes. Omit query to get the full list; the asker can filter from it.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional name fragment to narrow the list' } },
      additionalProperties: false,
    },
  },
  {
    name: 'upcoming_classes',
    description:
      'Scheduled training classes for the next N days (default 45): title, date/time, location, instructor, seats remaining. Use for "when is the next CPR class", "any classes this month".',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 45, max 120)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'latest_announcements',
    description: 'The most recent active announcements (default 3): category, title, date, and the start of the body.',
    input_schema: {
      type: 'object',
      properties: { count: { type: 'number', description: 'How many (default 3, max 6)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'equipment_lookup',
    description:
      'Where a piece of event equipment is right now, by tag number or name: on the shelf at Admin, or out on which check-out (event, truck). Use for "where is the LUCAS", "who has item 0421".',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Tag number or item name fragment' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'protocol_lookup',
    description:
      'The live WCEMS protocol book. Finds one protocol or procedure by number ("2.11") or name/keyword ("anaphylaxis", "behavioral emergency") and returns its VERBATIM text: inclusion criteria (adult + pediatric), notes, and the treatment steps for every certification tier, exactly as signed. Use whenever someone asks what a protocol says, allows, or requires. Quote the returned text word-for-word with the protocol number and name — never paraphrase it into advice.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Protocol number or name/keyword' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'medication_reference',
    description:
      "The WCEMS drug reference from the protocol app: a medication's verbatim indications, contraindications, side effects, dosage & routes, notes, and minimum certification level. Use for drug or dose questions; quote the dosage text exactly as returned.",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Medication name, e.g. "epinephrine", "fentanyl"' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
]

/* ── Executors ─────────────────────────────────────────────────────── */

async function resolvePeople(ctx: ToolCtx, name: string) {
  const { data, error } = await ctx.user
    .from('app_users')
    .select('id, full_name')
    .eq('account_type', 'person')
    .eq('active', true)
    .ilike('full_name', `%${name.trim().replace(/\s+/g, '%')}%`)
    .limit(6)
  if (error) throw new Error(error.message)
  return (data ?? []) as { id: string; full_name: string }[]
}

/** Shared engine for person_schedule / my_schedule. */
async function scheduleFor(ctx: ToolCtx, personId: string, days: number) {
  const from = dutyDayISO()
  const to = addDaysISO(from, days)
  const [core, entries] = await Promise.all([loadSchedCore(ctx), fetchEntries(ctx, from, to)])
  const working: Record<string, unknown>[] = []
  const offs: Record<string, unknown>[] = []
  let onDutyToday = false
  for (let i = 0; i <= days; i++) {
    const iso = addDaysISO(from, i)
    const day = buildDay(iso, core, entries)
    for (const r of day.staffed) {
      if (r.userId !== personId) continue
      working.push({
        date: iso,
        unit: r.unit,
        seat: r.seat,
        times: `${hhmm(r.s)}–${hhmm(r.e)}`,
        ...(r.kind !== 'rotation' ? { via: KIND_LABEL[r.kind] ?? r.kind } : {}),
      })
      if (iso === from) onDutyToday = true
    }
    for (const e of day.extras) {
      if (e.user_id !== personId) continue
      working.push({
        date: iso,
        unit: null,
        seat: null,
        times: `${hhmm(Date.parse(e.start_at))}–${hhmm(Date.parse(e.end_at))}`,
        via: KIND_LABEL[e.kind] ?? e.kind,
      })
      if (iso === from) onDutyToday = true
    }
    for (const o of day.off) {
      if (o.userId !== personId) continue
      offs.push({ date: iso, type: o.type, times: `${hhmm(o.s)}–${hhmm(o.e)}` })
    }
  }
  return { window: `${from} → ${to}`, duty_day: from, working, time_off: offs, on_duty_today: onDutyToday }
}

type Executor = (input: Record<string, any>, ctx: ToolCtx) => Promise<string>

const executors: Record<string, Executor> = {
  async who_is_on_duty(input, ctx) {
    const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dutyDayISO()
    const [core, entries] = await Promise.all([loadSchedCore(ctx), fetchEntries(ctx, date, date)])
    const day = buildDay(date, core, entries)
    const names = await namesFor(ctx, collectDayIds(day))
    const unitLabel = (id: string | null) => {
      const u = id ? core.units.find((x) => x.id === id) : null
      return u ? u.label || u.code : null
    }
    return j({
      duty_day: date,
      rotation: `${day.rotation.shift} Shift, Day ${day.rotation.day} (0600–0600 Central)`,
      staffed: day.staffed.map((r) => rowOut(r, names)),
      open_seats: day.open.map((r) => rowOut(r, names)),
      time_off: day.off.map((o) => ({ name: names.get(o.userId) ?? 'unknown', type: o.type })),
      events_and_riders: day.extras.map((e) => extraOut(e, names, unitLabel)),
    })
  },

  async person_schedule(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 30)
    const people = await resolvePeople(ctx, String(input.name ?? ''))
    if (!people.length) return j({ error: 'no_match', note: 'No active employee matches that name.' })
    if (people.length > 1) {
      return j({ ambiguous: people.map((p) => p.full_name), note: 'Ask which person they mean, or retry with a fuller name.' })
    }
    const p = people[0]
    const result = await scheduleFor(ctx, p.id, days)
    return j({ person: p.full_name, ...result })
  },

  async my_schedule(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 30)
    return j(await scheduleFor(ctx, ctx.userId, days))
  },

  async my_leave_balances(_input, ctx) {
    const { data, error } = await ctx.user
      .from('sched_leave_balances')
      .select('kind, credited, used, balance')
      .eq('user_id', ctx.userId)
    if (error) throw new Error(error.message)
    if (!data?.length) {
      return j({ balances: [], note: 'No leave ledger — balances are tracked for full-time employees only.' })
    }
    return j({ balances: data, units: 'hours' })
  },

  async my_pending_requests(_input, ctx) {
    const { data, error } = await ctx.user
      .from('sched_requests')
      .select('type, status, work_date, start_at, end_at, created_at')
      .or(`requester_id.eq.${ctx.userId},counterparty_id.eq.${ctx.userId}`)
      .in('status', ['pending', 'partner_accepted'])
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw new Error(error.message)
    return j({
      pending: (data ?? []).map((r: Record<string, any>) => ({
        type: r.type,
        status: r.status === 'partner_accepted' ? 'agreed — awaiting Chief approval' : 'pending',
        date: r.work_date ?? (r.start_at ? String(r.start_at).slice(0, 10) : null),
      })),
    })
  },

  async open_shifts(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 30)
    const from = dutyDayISO()
    const to = addDaysISO(from, days)
    const [core, entries] = await Promise.all([loadSchedCore(ctx), fetchEntries(ctx, from, to)])
    const out: Record<string, unknown>[] = []
    for (let i = 0; i <= days && out.length < 40; i++) {
      const iso = addDaysISO(from, i)
      const day = buildDay(iso, core, entries)
      for (const r of day.open) {
        out.push({ date: iso, unit: r.unit, seat: r.seat, times: `${hhmm(r.s)}–${hhmm(r.e)}` })
      }
      for (const e of day.extras) {
        if (e.status !== 'open') continue
        out.push({
          date: iso,
          unit: null,
          seat: KIND_LABEL[e.kind] ?? e.kind,
          times: `${hhmm(Date.parse(e.start_at))}–${hhmm(Date.parse(e.end_at))}`,
        })
      }
    }
    return j({ window: `${from} → ${to}`, open_seats: out.slice(0, 40) })
  },

  async upcoming_events(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 30, 1), 90)
    const from = centralTodayISO()
    const { data, error } = await ctx.user
      .from('sched_events')
      .select('id, label, on_date, end_date, start_time, end_time, seats_total, notes')
      .gte('on_date', from)
      .lte('on_date', addDaysISO(from, days))
      .order('on_date', { ascending: true })
      .limit(25)
    if (error) throw new Error(error.message)
    const events = (data ?? []) as Record<string, any>[]
    const ids = events.map((e) => e.id)
    const filled: Record<string, number> = {}
    if (ids.length) {
      const { data: ent } = await ctx.user
        .from('sched_entries')
        .select('event_id, status')
        .in('event_id', ids)
        .eq('kind', 'event')
      for (const e of (ent ?? []) as Record<string, any>[]) {
        if (e.status === 'scheduled') filled[e.event_id] = (filled[e.event_id] ?? 0) + 1
      }
    }
    return j({
      events: events.map((e) => ({
        name: e.label,
        date: e.end_date && e.end_date !== e.on_date ? `${e.on_date} → ${e.end_date}` : e.on_date,
        times: `${String(e.start_time).slice(0, 5)}–${String(e.end_time).slice(0, 5)}`,
        staffed: `${filled[e.id] ?? 0}/${e.seats_total}`,
        notes: e.notes ?? null,
      })),
    })
  },

  async my_outstanding_items(_input, ctx) {
    const { data: meRow, error: meErr } = await ctx.user
      .from('app_users')
      .select('role, shift, employment_type')
      .eq('id', ctx.userId)
      .maybeSingle()
    if (meErr) throw new Error(meErr.message)
    const me = meRow ?? { role: ctx.role, shift: null, employment_type: null }
    const hit = (arr: string[] | null, v: string | null) => !arr?.length || (v != null && arr.includes(v))

    const [{ data: rts, error: e1 }, { data: comps, error: e2 }, { data: ovr, error: e3 }] = await Promise.all([
      ctx.user
        .from('required_trainings')
        .select('id, title, required_by, audience_roles, audience_shifts, audience_employment_types, audience_event_label')
        .eq('active', true),
      ctx.user
        .from('required_training_completions')
        .select('required_training_id, attestation_signed')
        .eq('user_id', ctx.userId),
      ctx.user
        .from('required_training_user_overrides')
        .select('required_training_id, included')
        .eq('user_id', ctx.userId),
    ])
    if (e1 || e2 || e3) throw new Error((e1 ?? e2 ?? e3)!.message)
    const done = new Set((comps ?? []).filter((c: any) => c.attestation_signed).map((c: any) => c.required_training_id))
    const ovrMap = new Map((ovr ?? []).map((o: any) => [o.required_training_id, o.included]))
    const owedTraining = ((rts ?? []) as Record<string, any>[])
      .filter((t) => {
        const o = ovrMap.get(t.id)
        if (o === false) return false
        if (o === true) return !done.has(t.id)
        if (t.audience_event_label) return false
        return (
          hit(t.audience_roles, me.role) &&
          hit(t.audience_shifts, me.shift) &&
          hit(t.audience_employment_types, me.employment_type) &&
          !done.has(t.id)
        )
      })
      .map((t) => ({ title: t.title, due: t.required_by ?? 'no deadline' }))

    const [{ data: pols, error: e4 }, { data: acks, error: e5 }, { data: povr, error: e6 }] = await Promise.all([
      ctx.user
        .from('policies')
        .select('id, title, category, version, audience_roles, audience_shifts, audience_employment_types')
        .eq('active', true),
      ctx.user.from('policy_acknowledgements').select('policy_id, version').eq('user_id', ctx.userId),
      ctx.user.from('policy_user_overrides').select('policy_id, included').eq('user_id', ctx.userId),
    ])
    if (e4 || e5 || e6) throw new Error((e4 ?? e5 ?? e6)!.message)
    const bestAck = new Map<string, number>()
    for (const a of (acks ?? []) as Record<string, any>[]) {
      bestAck.set(a.policy_id, Math.max(bestAck.get(a.policy_id) ?? 0, Number(a.version) || 0))
    }
    const pOvr = new Map((povr ?? []).map((o: any) => [o.policy_id, o.included]))
    const owedPolicies = ((pols ?? []) as Record<string, any>[])
      .filter((p) => {
        const o = pOvr.get(p.id)
        if (o === false) return false
        const inAudience =
          o === true ||
          (hit(p.audience_roles, me.role) && hit(p.audience_shifts, me.shift) && hit(p.audience_employment_types, me.employment_type))
        return inAudience && (bestAck.get(p.id) ?? 0) < Number(p.version)
      })
      .map((p) => ({
        title: p.title,
        category: p.category,
        status: bestAck.has(p.id) ? 'updated — re-acknowledge' : 'not yet signed',
      }))

    return j({ required_training_outstanding: owedTraining, policies_outstanding: owedPolicies })
  },

  async my_clinical_snapshot(_input, ctx) {
    const { data, error } = await ctx.user
      .from('pipeline_records')
      .select(
        'working_phase, cleared_phase, cert_level, is_fto, tx_license_number, tx_license_expires_at, tx_jurisprudence_at, bloodborne_pathogen_at',
      )
      .eq('user_id', ctx.userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return j({ note: 'No clinical record on file yet — it appears automatically once on the roster.' })
    return j({
      working_phase: data.working_phase,
      cleared_phase: data.cleared_phase,
      cert_level: data.cert_level,
      is_fto: data.is_fto,
      tx_license_expires: data.tx_license_expires_at,
      jurisprudence_completed: data.tx_jurisprudence_at,
      bloodborne_pathogen_completed: data.bloodborne_pathogen_at,
      note: 'Full gate detail is on My Progress (/clinical-development).',
    })
  },

  async find_person(input, ctx) {
    const { data, error } = await ctx.user.rpc('get_employee_directory')
    if (error) throw new Error(error.message)
    const q = String(input.name ?? '').trim().toLowerCase()
    const rows = ((data ?? []) as Record<string, any>[]).filter((r) =>
      String(r.full_name ?? r.name ?? '').toLowerCase().includes(q),
    )
    if (!rows.length) return j({ matches: [], note: 'No directory match — they may have opted out of the directory.' })
    return j({
      matches: rows.slice(0, 5).map((r) => ({
        name: r.full_name ?? r.name,
        title: r.title ?? null,
        station: r.station ?? null,
        shift: r.shift ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
      })),
    })
  },

  async find_hospitals(input, ctx) {
    // Door-code columns are deliberately never selected here.
    const { data, error } = await ctx.user
      .from('hospitals')
      .select('name, trauma, stroke, pci_capable, is_pediatric, maternal_level, nicu_level, address, notes')
      .eq('active', true)
      .limit(40)
    if (error) throw new Error(error.message)
    let rows = (data ?? []) as Record<string, any>[]
    const q = String(input.query ?? '').trim().toLowerCase()
    if (q) rows = rows.filter((r) => `${r.name} ${r.address} ${r.notes ?? ''}`.toLowerCase().includes(q))
    return j({
      hospitals: rows.map((r) => ({
        name: r.name,
        trauma: r.trauma ?? 'none',
        stroke: r.stroke ?? null,
        pci: !!r.pci_capable,
        pediatric: !!r.is_pediatric,
        maternal: r.maternal_level ?? null,
        nicu: r.nicu_level ?? null,
        address: r.address,
      })),
      note: 'Door codes live on each hospital card in the app (/hospitals), never through the assistant.',
    })
  },

  async upcoming_classes(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 45, 1), 120)
    const now = new Date().toISOString()
    const { data, error } = await ctx.user
      .from('training_sessions')
      .select('title, local_start, location, instructor, total_capacity, remaining_capacity, source, registration_url')
      .gte('local_start', now)
      .order('local_start', { ascending: true })
      .limit(30)
    if (error) throw new Error(error.message)
    const cutoff = Date.parse(now) + days * 86400000
    return j({
      classes: ((data ?? []) as Record<string, any>[])
        .filter((s) => Date.parse(s.local_start) <= cutoff)
        .map((s) => ({
          title: s.title,
          when: new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(new Date(s.local_start)),
          location: s.location ?? null,
          instructor: s.instructor ?? null,
          seats: s.total_capacity ? `${s.total_capacity - (s.remaining_capacity ?? 0)}/${s.total_capacity} filled` : null,
          registerable: !!(s.registration_url || s.source === 'wix'),
        })),
    })
  },

  async latest_announcements(input, ctx) {
    const n = Math.min(Math.max(Number(input.count) || 3, 1), 6)
    const { data, error } = await ctx.user
      .from('announcements')
      .select('tag, title, body, published_at')
      .eq('active', true)
      .order('published_at', { ascending: false })
      .limit(n)
    if (error) throw new Error(error.message)
    return j({
      announcements: ((data ?? []) as Record<string, any>[]).map((a) => ({
        tag: a.tag,
        title: a.title,
        date: String(a.published_at).slice(0, 10),
        body: String(a.body ?? '').slice(0, 400),
      })),
    })
  },

  async equipment_lookup(input, ctx) {
    // Commas/parens are structural in PostgREST or() filters — strip them.
    const q = String(input.query ?? '').trim().replace(/[(),]/g, ' ').trim()
    const { data, error } = await ctx.user
      .from('equipment_assets')
      .select('id, tag, name, active, equipment_types(label)')
      .or(`tag.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(5)
    if (error) throw new Error(error.message)
    const assets = (data ?? []) as Record<string, any>[]
    if (!assets.length) return j({ matches: [], note: 'No equipment item matches that tag or name.' })
    const out = []
    for (const a of assets) {
      const { data: links } = await ctx.user
        .from('equipment_checkout_items')
        .select('equipment_checkouts(purpose, destination, event_date, closed_at)')
        .eq('asset_id', a.id)
      const openCo = ((links ?? []) as Record<string, any>[])
        .map((l) => l.equipment_checkouts)
        .find((c) => c && !c.closed_at)
      out.push({
        tag: a.tag,
        name: a.name,
        type: a.equipment_types?.label ?? null,
        retired: !a.active,
        status: openCo
          ? `out — checked out to ${openCo.destination} for "${openCo.purpose}"${openCo.event_date ? ` (${openCo.event_date})` : ''}`
          : 'at Admin (on the shelf)',
      })
    }
    return j({ matches: out, note: 'Full custody detail is on the Equipment board (/equipment).' })
  },

  async protocol_lookup(input, _ctx) {
    const q = String(input.query ?? '').trim().replace(/[(),]/g, ' ').trim()
    if (!q) return j({ error: 'empty_query' })
    const e = encodeURIComponent
    // Exact number first, then number/name/full-text contains.
    let rows = await protoGet(`protocols?select=id,number,name,category&number=eq.${e(q)}`)
    if (!rows.length) {
      rows = await protoGet(
        `protocols?select=id,number,name,category&or=(number.ilike.*${e(q)}*,name.ilike.*${e(q)}*,search_text.ilike.*${e(q)}*)&order=number&limit=6`,
      )
    }
    if (!rows.length) {
      return j({ matches: [], note: 'No protocol matches that — suggest browsing or searching in /protocols.' })
    }
    if (rows.length > 1) {
      return j({
        ambiguous: rows.map((r) => ({ number: r.number, name: r.name, category: r.category })),
        note: 'Several protocols match — pick the right one and call protocol_lookup again with its exact number.',
      })
    }
    const p = rows[0]
    const [fullRows, steps] = await Promise.all([
      protoGet(`protocols?select=number,name,category,criteria_adult,criteria_pediatric,notes&id=eq.${e(p.id)}`),
      protoGet(`protocol_steps?select=patient_type,tier,steps,medical_control&protocol_id=eq.${e(p.id)}&order=patient_type,tier`),
    ])
    const full = fullRows[0] ?? p
    const out = JSON.stringify({
      reference: `Protocol ${full.number} — ${full.name}`,
      category: full.category,
      link: `/protocols/protocol/${p.id}`,
      criteria_adult: full.criteria_adult,
      criteria_pediatric: full.criteria_pediatric,
      notes: full.notes || null,
      treatment: steps,
      note: 'This is the signed protocol text — quote it VERBATIM with the reference.',
    })
    return out.length > 9500
      ? out.slice(0, 9500) + ' …TRUNCATED — quote what fits and point to the full protocol page.'
      : out
  },

  async medication_reference(input, _ctx) {
    const q = String(input.name ?? '').trim().replace(/[(),]/g, ' ').trim()
    if (!q) return j({ error: 'empty_query' })
    const e = encodeURIComponent
    const rows = await protoGet(
      `medication_details?select=name,alt_name,type,indications,contraindications,side_effects,dosage_routes,notes,min_certification&or=(name.ilike.*${e(q)}*,alt_name.ilike.*${e(q)}*)&order=sort_order&limit=4`,
    )
    if (!rows.length) {
      return j({ matches: [], note: 'No medication matches in the drug reference — point to /protocols → More → Medications.' })
    }
    return j({
      medications: rows,
      link: '/protocols',
      note: 'This is the protocol drug reference — quote dosage text verbatim; it is not medical direction.',
    })
  },
}

export async function runTool(name: string, input: Record<string, any>, ctx: ToolCtx): Promise<{ ok: boolean; content: string }> {
  const exec = executors[name]
  if (!exec) return { ok: false, content: j({ error: `unknown tool ${name}` }) }
  try {
    return { ok: true, content: await exec(input ?? {}, ctx) }
  } catch (err) {
    console.error(`ask-assistant tool ${name} failed:`, err)
    return { ok: false, content: j({ error: 'lookup_failed', note: 'The lookup hit an error — point the user at the right page instead.' }) }
  }
}
