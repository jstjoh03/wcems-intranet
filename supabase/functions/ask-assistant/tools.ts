// Live-lookup tools for the Ask WCEMS assistant (Phase 3 of the handoff).
//
// Every tool runs its queries through the CALLER's Supabase client, so
// RLS applies exactly as it does in the app — the assistant can never
// show someone data the portal itself wouldn't. Door/gate codes are
// structurally excluded: no tool selects those columns.
//
// Results are compact JSON strings for the model; truncated hard so a
// big roster can't blow the token budget.

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

/** B,B,C,C,A,A rotation anchored Monday 2026-04-06 = B Day 1. */
const ROT_SEQ = ['B', 'B', 'C', 'C', 'A', 'A'] as const
function platoonFor(iso: string): { shift: string; day: 1 | 2 } {
  const days = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse('2026-04-06T12:00:00Z')) / 86400000)
  const idx = ((days % 6) + 6) % 6
  return { shift: ROT_SEQ[idx], day: (idx % 2 === 0 ? 1 : 2) as 1 | 2 }
}

function hhmm(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts))
}

function j(v: unknown): string {
  return JSON.stringify(v)
}

/* ── Tool definitions (static — part of the cached prompt prefix) ──── */

export const TOOL_DEFS = [
  {
    name: 'who_is_on_duty',
    description:
      'The live schedule for one duty day: on-duty platoon, every staffed seat by unit with times, open seats, approved time off, extra hours, and special-event assignments. Defaults to the CURRENT duty day (before 0600 Central that is yesterday\'s work date — shifts run 0600 to 0600). Use for "who is working", "who is on shift", "is the county covered".',
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
      'One person\'s schedule entries for the next N days (default 14): working days with unit and times, time off, events. Use for "is NAME working today/tomorrow", "when does NAME work next". Matches the name loosely; returns candidates if ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial name of the employee' },
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 14, max 45)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'my_schedule',
    description:
      "The ASKER's own upcoming schedule for the next N days (default 14): working days, unit, times, approved time off, events. Use for \"when do I work next\", \"am I on this weekend\".",
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 14, max 45)' },
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
      'Open (unfilled) seats on the schedule for the next N days (default 14) — date, unit, seat, times. Use for "any open shifts", "what can I pick up".',
    input_schema: {
      type: 'object',
      properties: {
        days_ahead: { type: 'number', description: 'How many days ahead (default 14, max 60)' },
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
      'The live hospital directory: trauma level, stroke level, PCI, pediatric, maternal/NICU, address, notes. Never includes door codes. Omit query to get the full list (sorted by trauma level); the asker can filter from it.',
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
]

/* ── Executors ─────────────────────────────────────────────────────── */

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

async function entriesBetween(ctx: ToolCtx, from: string, to: string, userId?: string) {
  let q = ctx.user
    .from('sched_entries')
    .select(
      'work_date, kind, status, off_type, start_at, end_at, user_id, event_id, note, app_users(full_name), sched_units(code, label), sched_seats(label, sched_units(code, label))',
    )
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: true })
    .limit(400)
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Record<string, any>[]
}

function entryLine(e: Record<string, any>): Record<string, unknown> {
  /* Most entries carry their unit through the seat; the entry's own
     unit_id is only set for unit-level rows (students, notes). */
  const seatUnit = e.sched_seats?.sched_units
  const unit =
    e.sched_units?.label || e.sched_units?.code || seatUnit?.label || seatUnit?.code || null
  const base: Record<string, unknown> = {
    date: e.work_date,
    kind: KIND_LABEL[e.kind] ?? e.kind,
    unit,
    seat: e.sched_seats?.label ?? null,
    times: `${hhmm(e.start_at)}–${hhmm(e.end_at)}`,
  }
  if (e.status === 'open') base.open = true
  if (e.kind === 'timeoff') base.off_type = e.off_type ?? 'time off'
  if (e.app_users?.full_name) base.name = e.app_users.full_name
  return base
}

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

type Executor = (input: Record<string, any>, ctx: ToolCtx) => Promise<string>

const executors: Record<string, Executor> = {
  async who_is_on_duty(input, ctx) {
    const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dutyDayISO()
    const rows = await entriesBetween(ctx, date, date)
    const rot = platoonFor(date)
    const staffed = rows.filter((e) => e.status === 'scheduled' && e.kind !== 'timeoff' && e.kind !== 'event')
    const open = rows.filter((e) => e.status === 'open')
    const off = rows.filter((e) => e.kind === 'timeoff')
    const events = rows.filter((e) => e.kind === 'event' && e.status !== 'open')
    return j({
      duty_day: date,
      rotation: `${rot.shift} Shift, Day ${rot.day} (0600–0600 Central)`,
      staffed: staffed.map(entryLine),
      open_seats: open.map(entryLine),
      time_off: off.map((e) => ({ name: e.app_users?.full_name ?? 'unknown', type: e.off_type ?? 'time off' })),
      event_assignments: events.map(entryLine),
      note: 'This is the live board — trades and time off are already applied.',
    })
  },

  async person_schedule(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 45)
    const people = await resolvePeople(ctx, String(input.name ?? ''))
    if (!people.length) return j({ error: 'no_match', note: 'No active employee matches that name.' })
    if (people.length > 1) {
      return j({ ambiguous: people.map((p) => p.full_name), note: 'Ask which person they mean, or retry with a fuller name.' })
    }
    const p = people[0]
    const from = dutyDayISO()
    const rows = await entriesBetween(ctx, from, addDaysISO(from, days), p.id)
    return j({
      person: p.full_name,
      window: `${from} → ${addDaysISO(from, days)}`,
      entries: rows.map(entryLine),
      on_duty_now: rows.some((e) => e.work_date === dutyDayISO() && e.status === 'scheduled' && e.kind !== 'timeoff'),
    })
  },

  async my_schedule(input, ctx) {
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 45)
    const from = dutyDayISO()
    const rows = await entriesBetween(ctx, from, addDaysISO(from, days), ctx.userId)
    return j({ window: `${from} → ${addDaysISO(from, days)}`, entries: rows.map(entryLine) })
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
    const days = Math.min(Math.max(Number(input.days_ahead) || 14, 1), 60)
    const from = dutyDayISO()
    const rows = await entriesBetween(ctx, from, addDaysISO(from, days))
    const open = rows.filter((e) => e.status === 'open')
    return j({ window: `${from} → ${addDaysISO(from, days)}`, open_seats: open.map(entryLine) })
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
    let filled: Record<string, number> = {}
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
    // Caller profile for audience matching
    const { data: meRow, error: meErr } = await ctx.user
      .from('app_users')
      .select('role, shift, employment_type')
      .eq('id', ctx.userId)
      .maybeSingle()
    if (meErr) throw new Error(meErr.message)
    const me = meRow ?? { role: ctx.role, shift: null, employment_type: null }
    const hit = (arr: string[] | null, v: string | null) => !arr?.length || (v != null && arr.includes(v))

    // Required training
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
        if (t.audience_event_label) return false // event-scoped: reminders handle those crews
        return (
          hit(t.audience_roles, me.role) &&
          hit(t.audience_shifts, me.shift) &&
          hit(t.audience_employment_types, me.employment_type) &&
          !done.has(t.id)
        )
      })
      .map((t) => ({ title: t.title, due: t.required_by ?? 'no deadline' }))

    // Policies (stale acknowledgement = outstanding again)
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
      note: 'Door codes are on each hospital card in the app (/hospitals), never through the assistant.',
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
