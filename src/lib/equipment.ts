import type {
  EquipmentActionKind,
  EquipmentAssetState,
  EquipmentCheckout,
  EquipmentCustodyEvent,
  EquipmentEventKind,
  EquipmentStatus,
} from '@/types'

/**
 * Equipment check-out rules + display helpers. Pure functions shared
 * by the views, the composable, and the dev-stub backend. The server
 * enforces the same transition table in equipment_record() — keep the
 * two in sync (migrations 20260918010000_equipment_checkout.sql,
 * 20260918020000_equipment_write_off.sql, and
 * 20260918040000_equipment_trucks_extended_signatures.sql).
 */

/** Where the gear lives when it isn't out. */
export const HOME_LOCATION = 'Admin'

/** A roster pick, or a free-typed name (id null) for someone off-roster. */
export interface PickedPerson {
  id: string | null
  name: string
}

export const ON_UNIT_KINDS: EquipmentEventKind[] = [
  'delivered',
  'confirmed_present',
  'reported_missing',
  'event_closed',
  'shift_start',
  'shift_end',
]

/** Equipment checks: the crew marks each item here or not found. */
export const CHECK_KINDS: EquipmentActionKind[] = ['confirmed_present', 'shift_start', 'shift_end']

export function isCheckKind(kind: EquipmentEventKind | EquipmentActionKind | null | undefined): boolean {
  return kind === 'confirmed_present' || kind === 'shift_start' || kind === 'shift_end'
}

/** An item is done with a check-out once its latest event is one of these. */
export const RESOLVED_KINDS: EquipmentEventKind[] = ['returned', 'canceled', 'written_off']

export interface ActionRule {
  /** An item's latest event (on this check-out) must be one of these. */
  from: EquipmentEventKind[]
  /** Supervisors, admins, and granted handlers only. */
  handlerOnly: boolean
  /** photo = always required; photo-or-person = a photo, or a named
   *  person who signs to receive; optional-photo = offered, not needed. */
  evidence: 'photo' | 'photo-or-person' | 'optional-photo' | 'none'
}

export const ACTION_RULES: Record<EquipmentActionKind, ActionRule> = {
  delivered: { from: ['checked_out'], handlerOnly: true, evidence: 'photo-or-person' },
  canceled: { from: ['checked_out'], handlerOnly: true, evidence: 'none' },
  confirmed_present: { from: ON_UNIT_KINDS, handlerOnly: false, evidence: 'none' },
  event_closed: { from: ON_UNIT_KINDS, handlerOnly: false, evidence: 'photo' },
  picked_up: { from: ON_UNIT_KINDS, handlerOnly: true, evidence: 'none' },
  /* From written_off too: a lost item that turned up comes home. */
  returned: { from: ['picked_up', 'written_off'], handlerOnly: true, evidence: 'photo-or-person' },
  written_off: { from: ['reported_missing'], handlerOnly: true, evidence: 'none' },
  /* Extended assignments: every crew checks the gear as they take the
     truck and again as they hand it over. */
  shift_start: { from: ON_UNIT_KINDS, handlerOnly: false, evidence: 'none' },
  shift_end: { from: ON_UNIT_KINDS, handlerOnly: false, evidence: 'optional-photo' },
}

export function statusFromKind(kind: EquipmentEventKind | null | undefined): EquipmentStatus {
  switch (kind) {
    case 'checked_out':
      return 'in_transit'
    case 'picked_up':
      return 'returning'
    case 'reported_missing':
      return 'missing'
    case 'written_off':
      return 'lost'
    case 'delivered':
    case 'confirmed_present':
    case 'event_closed':
    case 'shift_start':
    case 'shift_end':
      return 'on_unit'
    default:
      return 'available'
  }
}

export const STATUS_LABEL: Record<EquipmentStatus, string> = {
  available: 'Available',
  in_transit: 'In transit',
  on_unit: 'On a truck',
  missing: 'Not found',
  returning: 'Returning',
  lost: 'Lost',
}

/** A destination in a sentence: truck numbers read "truck 8751"; named
 *  vehicles ("Vannie Mae") and older free-text entries stay as-is. */
export function placeName(dest: string): string {
  return /^\d+$/.test(dest) ? `truck ${dest}` : dest
}

/** One-line location phrase: "On truck 8751", "In transit to truck 0081", … */
export function statusLine(state: Pick<EquipmentAssetState, 'status' | 'location'>): string {
  switch (state.status) {
    case 'available':
      return `On the shelf at ${HOME_LOCATION}`
    case 'in_transit':
      return `In transit to ${placeName(state.location)}`
    case 'on_unit':
      return `On ${placeName(state.location)}`
    case 'missing':
      return `Not found on ${placeName(state.location)}`
    case 'returning':
      return `Headed back to ${HOME_LOCATION}`
    case 'lost':
      return `Written off — last on ${placeName(state.location)}`
  }
}

/** Compact chip text: "Available", "To 8751", "On 8751", … */
export function statusChip(state: Pick<EquipmentAssetState, 'status' | 'location'>): string {
  switch (state.status) {
    case 'available':
      return 'Available'
    case 'in_transit':
      return `To ${state.location}`
    case 'on_unit':
      return `On ${state.location}`
    case 'missing':
      return 'Not found'
    case 'returning':
      return `To ${HOME_LOCATION}`
    case 'lost':
      return 'Lost'
  }
}

/** Timeline phrasing per custody event. */
export const KIND_LABEL: Record<EquipmentEventKind, string> = {
  checked_out: 'Checked out',
  delivered: 'Delivered to the truck',
  confirmed_present: 'Confirmed on shift',
  reported_missing: 'Reported not found',
  event_closed: 'Event closed out',
  picked_up: 'Picked up from the truck',
  returned: `Returned to ${HOME_LOCATION}`,
  canceled: 'Check-out canceled',
  written_off: 'Written off as lost',
  shift_start: 'Start-of-shift check',
  shift_end: 'End-of-shift check',
}

/** Button + sheet titles per action. */
export const ACTION_LABEL: Record<EquipmentActionKind, string> = {
  delivered: 'Mark delivered',
  canceled: 'Cancel check-out',
  confirmed_present: 'Confirm it’s here',
  event_closed: 'Close out the event',
  picked_up: 'Pick up',
  returned: `Drop off at ${HOME_LOCATION}`,
  written_off: 'Write off as lost',
  shift_start: 'Start-of-shift check',
  shift_end: 'End-of-shift check',
}

/** The six custody steps a check-out walks through. */
export const STEPS: { kind: EquipmentEventKind; label: string }[] = [
  { kind: 'checked_out', label: 'Checked out' },
  { kind: 'delivered', label: 'Delivered' },
  { kind: 'confirmed_present', label: 'Confirmed' },
  { kind: 'event_closed', label: 'Event closed' },
  { kind: 'picked_up', label: 'Picked up' },
  { kind: 'returned', label: 'Returned' },
]

export type StepState = 'done' | 'partial' | 'skipped' | 'pending'

export interface CheckoutStep {
  kind: EquipmentEventKind
  label: string
  state: StepState
  at: string | null
  by: string | null
}

export type CheckoutPhase =
  | 'in_transit'
  | 'delivered'
  | 'confirmed'
  | 'assignment'
  | 'closed'
  | 'returning'
  | 'missing'
  | 'complete'
  | 'canceled'

export interface LastCheck {
  kind: EquipmentEventKind
  at: string
  by: string
  missing: number
}

export interface CheckoutSummary {
  /** Latest event kind per item on this check-out. */
  itemKinds: Record<string, EquipmentEventKind>
  /** Items not yet resolved (latest isn't returned/canceled/written off). */
  openAssetIds: string[]
  missing: number
  /** Items written off as lost. */
  lost: number
  phase: CheckoutPhase
  phaseLabel: string
  nextHint: string
  steps: CheckoutStep[]
  /** Most recent equipment check (confirmation or shift check). */
  lastCheck: LastCheck | null
  /** Extended assignments: which shift check is due next. */
  nextShiftCheck: 'shift_start' | 'shift_end'
}

const PHASE_LABEL: Record<CheckoutPhase, string> = {
  in_transit: 'In transit',
  delivered: 'Delivered',
  confirmed: 'Confirmed on shift',
  assignment: 'On assignment',
  closed: 'Event closed',
  returning: 'Headed back',
  missing: 'Not found',
  complete: 'Returned',
  canceled: 'Canceled',
}

const PHASE_HINT: Record<CheckoutPhase, string> = {
  in_transit: 'Waiting on delivery to the truck',
  delivered: 'Waiting on the on-shift crew to confirm',
  confirmed: 'Photo of where it’s left when the event wraps',
  assignment: 'Every crew checks the gear at the start and end of their shift',
  closed: 'Ready for pickup',
  returning: `Waiting on drop-off at ${HOME_LOCATION}`,
  missing: 'Still unaccounted for — pick it up if it turns up',
  complete: 'Everything is back on the shelf',
  canceled: 'Nothing left the building',
}

/** Roll a check-out's events up into per-item state, a phase, and the
 *  honest step ladder (done / partial / skipped / pending). */
export function summarizeCheckout(
  checkout: Pick<EquipmentCheckout, 'id' | 'assetIds'> & { extended?: boolean },
  events: EquipmentCustodyEvent[],
): CheckoutSummary {
  const evs = events
    .filter((e) => e.checkoutId === checkout.id)
    .sort((a, b) => a.seq - b.seq)

  const itemKinds: Record<string, EquipmentEventKind> = {}
  const seen: Record<string, Set<EquipmentEventKind>> = {}
  for (const e of evs) {
    itemKinds[e.assetId] = e.kind
    ;(seen[e.assetId] ??= new Set()).add(e.kind)
  }

  const ids = checkout.assetIds.length ? checkout.assetIds : Object.keys(itemKinds)
  const live = ids.filter((id) => itemKinds[id] !== 'canceled')
  const openAssetIds = ids.filter((id) => !RESOLVED_KINDS.includes(itemKinds[id]))
  const openKinds = openAssetIds.map((id) => itemKinds[id])
  const missing = openKinds.filter((k) => k === 'reported_missing').length
  const lost = ids.filter((id) => itemKinds[id] === 'written_off').length

  let phase: CheckoutPhase
  if (openAssetIds.length === 0) {
    phase = live.length === 0 ? 'canceled' : 'complete'
  } else if (openKinds.includes('checked_out')) {
    phase = 'in_transit'
  } else if (openKinds.some((k) => ON_UNIT_KINDS.includes(k))) {
    /* Items the crew couldn't find don't hold the batch back — the
       phase follows what's actually there; `missing` flags the rest. */
    const present = openKinds.filter((k) => ON_UNIT_KINDS.includes(k) && k !== 'reported_missing')
    if (!present.length) phase = openKinds.includes('picked_up') ? 'returning' : 'missing'
    else if (present.every((k) => k === 'event_closed')) phase = 'closed'
    else if (checkout.extended) phase = 'assignment'
    else if (present.some((k) => isCheckKind(k)) || missing) phase = 'confirmed'
    else phase = 'delivered'
  } else {
    phase = 'returning'
  }

  /* A step counts for an item when that item has the step's event on
     this check-out. Any equipment check — a confirmation, a shift check,
     even a not-found report — counts toward the "Confirmed" step. */
  const CHECK_STEP: EquipmentEventKind[] = [
    'confirmed_present',
    'shift_start',
    'shift_end',
    'reported_missing',
  ]
  const reached = (id: string, kind: EquipmentEventKind) =>
    kind === 'confirmed_present'
      ? CHECK_STEP.some((k) => seen[id]?.has(k))
      : !!seen[id]?.has(kind)
  const stepIndexReached = (id: string) =>
    STEPS.reduce((max, s, i) => (reached(id, s.kind) ? i : max), -1)

  const steps: CheckoutStep[] = STEPS.map((s, i) => {
    const count = live.filter((id) => reached(id, s.kind)).length
    const first = evs.find((e) =>
      s.kind === 'confirmed_present' ? CHECK_STEP.includes(e.kind) : e.kind === s.kind,
    )
    let state: StepState
    if (live.length > 0 && count === live.length) state = 'done'
    else if (count > 0) state = 'partial'
    else if (live.some((id) => stepIndexReached(id) > i)) state = 'skipped'
    else state = 'pending'
    return {
      kind: s.kind,
      label: s.kind === 'confirmed_present' && checkout.extended ? 'Shift checks' : s.label,
      state,
      at: first?.at ?? null,
      by: first?.actorName ?? null,
    }
  })

  /* The latest check, counted per action (one check covers many items). */
  let lastCheck: LastCheck | null = null
  const checkRows = evs.filter((e) => CHECK_STEP.includes(e.kind))
  const lastRow = checkRows[checkRows.length - 1]
  if (lastRow) {
    const rows = checkRows.filter((e) => e.actionId === lastRow.actionId)
    const primary = rows.find((e) => e.kind !== 'reported_missing')
    lastCheck = {
      kind: primary?.kind ?? 'reported_missing',
      at: lastRow.at,
      by: lastRow.actorName,
      missing: rows.filter((e) => e.kind === 'reported_missing').length,
    }
  }

  return {
    itemKinds,
    openAssetIds,
    missing,
    lost,
    phase,
    phaseLabel: phase === 'complete' && lost ? 'Closed' : PHASE_LABEL[phase],
    nextHint:
      phase === 'complete' && lost
        ? `Closed — ${pluralize(lost, 'item')} written off as lost`
        : PHASE_HINT[phase],
    steps,
    lastCheck,
    nextShiftCheck: lastCheck?.kind === 'shift_start' ? 'shift_end' : 'shift_start',
  }
}

/** Items on a check-out eligible for an action right now. */
export function eligibleFor(
  kind: EquipmentActionKind,
  itemKinds: Record<string, EquipmentEventKind>,
  assetIds: string[],
): string[] {
  const from = ACTION_RULES[kind].from
  return assetIds.filter((id) => itemKinds[id] && from.includes(itemKinds[id]))
}

/* ── Timeline grouping ─────────────────────────────────────────────── */

export interface CustodyAction {
  actionId: string
  /** The action's primary kind (a confirmation that found nothing is
   *  reported_missing). */
  kind: EquipmentEventKind
  seq: number
  at: string
  actorId: string | null
  actorName: string
  destination: string
  handedToName: string | null
  note: string
  photoPath: string | null
  /** The receiver's signature for a hand-off. */
  signaturePath: string | null
  checkoutId: string
  checkoutPurpose?: string
  checkoutDestination?: string
  assetIds: string[]
  /** Items the crew reported not found under the same confirmation. */
  missingAssetIds: string[]
}

/** Group per-item custody rows into one entry per action, newest first. */
export function groupActions(events: EquipmentCustodyEvent[]): CustodyAction[] {
  const byAction = new Map<string, CustodyAction>()
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    let a = byAction.get(e.actionId)
    if (!a) {
      a = {
        actionId: e.actionId,
        kind: e.kind,
        seq: e.seq,
        at: e.at,
        actorId: e.actorId,
        actorName: e.actorName,
        destination: e.destination,
        handedToName: e.handedToName,
        note: e.note,
        photoPath: e.photoPath,
        signaturePath: e.signaturePath,
        checkoutId: e.checkoutId,
        checkoutPurpose: e.checkoutPurpose,
        checkoutDestination: e.checkoutDestination,
        assetIds: [],
        missingAssetIds: [],
      }
      byAction.set(e.actionId, a)
    }
    if (e.kind === 'reported_missing' && a.kind !== 'reported_missing') {
      a.missingAssetIds.push(e.assetId)
    } else {
      if (a.kind === 'reported_missing' && e.kind !== 'reported_missing') {
        /* A confirmation row arrived after its not-found siblings —
           promote the action to the confirmation. */
        a.missingAssetIds.push(...a.assetIds)
        a.assetIds = []
        a.kind = e.kind
      }
      a.assetIds.push(e.assetId)
      a.photoPath ??= e.photoPath
      a.signaturePath ??= e.signaturePath
    }
    a.seq = Math.max(a.seq, e.seq)
  }
  return [...byAction.values()].sort(
    (x, y) => Date.parse(y.at) - Date.parse(x.at) || y.seq - x.seq,
  )
}

/* ── Formatting ────────────────────────────────────────────────────── */

const TZ = 'America/Chicago'

/** Today's date in Central time as YYYY-MM-DD. */
export function todayCentral(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** "Today 3:02 PM" · "Yesterday 6:40 PM" · "Sep 18, 3:02 PM". */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
  const day = d.toLocaleDateString('en-CA', { timeZone: TZ })
  const today = todayCentral()
  if (day === today) return `Today ${time}`
  if (day === addDays(today, -1)) return `Yesterday ${time}`
  const sameYear = day.slice(0, 4) === today.slice(0, 4)
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: TZ,
  })
  return `${date}, ${time}`
}

/** An event's dates: "Today", or "Sep 18 – Oct 3" for a span. */
export function formatEventSpan(start: string | null | undefined, end?: string | null): string {
  if (!start) return end ? `Through ${formatEventDate(end)}` : ''
  if (!end || end === start) return formatEventDate(start)
  const short = (iso: string) => {
    const today = todayCentral()
    if (iso === today) return 'Today'
    if (iso === addDays(today, 1)) return 'Tomorrow'
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${short(start)} – ${short(end)}`
}

/** 'YYYY-MM-DD' → "Fri, Sep 18" (or "Today" / "Tomorrow"). */
export function formatEventDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const today = todayCentral()
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  if (iso === addDays(today, -1)) return 'Yesterday'
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(y === Number(today.slice(0, 4)) ? {} : { year: 'numeric' }),
  })
}

/** Tag search that forgives dropped leading zeros ("432" finds "00432"). */
export function tagMatches(tag: string, query: string): boolean {
  const t = tag.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (t.includes(q)) return true
  const strip = (s: string) => s.replace(/^0+(?=\d)/, '')
  return strip(t).startsWith(strip(q))
}

export function itemMatches(
  asset: { tag: string; name: string; notes?: string },
  typeName: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    tagMatches(asset.tag, q) ||
    asset.name.toLowerCase().includes(q) ||
    typeName.toLowerCase().includes(q) ||
    (asset.notes ?? '').toLowerCase().includes(q)
  )
}

/** Natural tag order: numeric tags by value, then text. */
export function compareTags(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/* ── Bulk import (paste from Excel / CSV / a PSTrax export) ────────── */

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim())
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

export interface ParsedImport {
  rows: { line: number; tag: string; name: string; typeName: string }[]
  /** True when a header row was found and used to map columns. */
  usedHeader: boolean
}

/**
 * Parse pasted rows into tag / name / type. Tab-separated (an Excel or
 * Sheets copy) or CSV. A header row maps columns by name (Tag / Asset #,
 * Name / Description, Type / Category) so a PSTrax export can be pasted
 * as-is; without one, columns are read as tag, name, type.
 */
export function parseAssetImport(text: string): ParsedImport {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l, i) => ({ cells: splitLine(l), line: i + 1 }))
    .filter((l) => l.cells.some((c) => c))
  if (!lines.length) return { rows: [], usedHeader: false }

  let tagCol = 0
  let nameCol = 1
  let typeCol = 2
  let usedHeader = false
  const head = lines[0].cells.map((c) => c.toLowerCase())
  const find = (re: RegExp) => head.findIndex((c) => re.test(c))
  const hTag = find(/^(asset\s*)?(tag|#|no\.?|number|id)$|asset\s*tag|pstrax/)
  const hName = find(/name|desc/)
  if (hTag >= 0 && hName >= 0) {
    tagCol = hTag
    nameCol = hName
    typeCol = find(/type|category|kind|class/)
    usedHeader = true
    lines.shift()
  }

  return {
    usedHeader,
    rows: lines.map((l) => ({
      line: l.line,
      tag: (l.cells[tagCol] ?? '').trim(),
      name: (l.cells[nameCol] ?? '').trim(),
      typeName: typeCol >= 0 ? (l.cells[typeCol] ?? '').trim() : '',
    })),
  }
}

/** Longest all-digit tag, when numeric tags have different lengths —
 *  the telltale of Excel stripping leading zeros ("00432" → "432"). */
export function suggestedTagWidth(tags: string[]): number | null {
  const numeric = tags.filter((t) => /^\d+$/.test(t))
  if (numeric.length < 1) return null
  const max = Math.max(...numeric.map((t) => t.length))
  return numeric.some((t) => t.length < max) ? max : null
}

export function padTag(tag: string, width: number | null): string {
  return width && /^\d+$/.test(tag) ? tag.padStart(width, '0') : tag
}
