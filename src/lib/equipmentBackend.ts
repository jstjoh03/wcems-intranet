import { supabase } from '@/lib/supabase'
import { imageExtension } from '@/lib/imageCompress'
import { addDays, todayCentral } from '@/lib/equipment'
import type {
  EquipmentActionKind,
  EquipmentAsset,
  EquipmentCheckout,
  EquipmentCustodyEvent,
  EquipmentEventKind,
  EquipmentTruck,
  EquipmentType,
} from '@/types'

/**
 * Data access for the equipment check-out module. The composable talks
 * to this interface so the dev stub (no sign-in, local `vite`) can swap
 * in an in-memory implementation — see equipmentDevBackend.ts.
 *
 * Writes to the custody log only ever go through the two RPCs; the
 * registry (types/assets), handler grants, and check-out detail edits
 * are plain table writes guarded by RLS.
 */

export const PHOTO_BUCKET = 'equipment-photos'

/* ── Row shapes (snake_case, as stored) ──────────────────────────────── */

export interface TypeRow {
  id: string
  name: string
  sort: number
  active: boolean
}

export interface TruckRow {
  id: string
  label: string
  sort: number
  active: boolean
}

export interface AssetRow {
  id: string
  tag: string
  name: string
  type_id: string | null
  notes: string
  active: boolean
  created_at: string
}

export interface CheckoutRow {
  id: string
  purpose: string
  destination: string
  event_date: string | null
  extended: boolean
  end_date: string | null
  note: string
  created_by: string | null
  created_by_name: string
  created_at: string
  closed_at: string | null
  equipment_checkout_items?: { asset_id: string }[]
}

export interface EventRow {
  id: string
  seq: number
  asset_id: string
  checkout_id: string
  action_id: string
  kind: EquipmentEventKind
  actor_id: string | null
  actor_name: string
  recorded_by: string | null
  destination: string
  handed_to_id: string | null
  handed_to_name: string | null
  note: string
  photo_path: string | null
  signature_path: string | null
  at: string
  checkout?: { purpose: string; destination: string } | null
}

export interface BoardRows {
  types: TypeRow[]
  trucks: TruckRow[]
  assets: AssetRow[]
  /** Latest custody event per asset (equipment_asset_status). */
  latest: EventRow[]
  /** Check-outs with at least one item still out. */
  open: CheckoutRow[]
  /** Every event on the open check-outs (step ladders on the board). */
  openEvents: EventRow[]
  /** Newest events across all check-outs (activity feed). */
  recent: EventRow[]
  handlers: string[]
}

export interface CheckOutArgs {
  assetIds: string[]
  purpose: string
  destination: string
  eventDate: string | null
  note: string
  extended: boolean
  endDate: string | null
}

export interface RecordArgs {
  checkoutId: string
  kind: EquipmentActionKind
  assetIds: string[]
  missingIds: string[]
  note: string
  photoPath: string | null
  handedToId: string | null
  handedToName: string | null
  signaturePath: string | null
}

export interface EquipmentPerson {
  id: string
  fullName: string
  title: string | null
}

export interface EventSuggestion {
  label: string
  /** First date of the run. */
  date: string
  /** Last date when the same event repeats (a multi-night run). */
  endDate: string | null
  /** How many scheduled dates the run covers. */
  count: number
}

export interface EquipmentSuggestions {
  /** Upcoming events from the schedule (read-only), soonest first. */
  events: EventSuggestion[]
  recentPurposes: string[]
}

export interface AssetInput {
  tag: string
  name: string
  type_id: string | null
  notes: string
  active: boolean
}

export interface TypeInput {
  name: string
  sort: number
  active: boolean
}

export interface CheckoutPatch {
  purpose: string
  destination: string
  event_date: string | null
  extended: boolean
  end_date: string | null
  note: string
}

export interface TruckInput {
  label: string
  sort: number
  active: boolean
}

export interface EquipmentBackend {
  loadBoard(): Promise<BoardRows>
  checkOut(a: CheckOutArgs): Promise<string>
  record(a: RecordArgs): Promise<string>
  uploadPhoto(checkoutId: string, blob: Blob): Promise<string>
  signPhotos(paths: string[]): Promise<Record<string, string>>
  fetchCheckout(id: string): Promise<{ checkout: CheckoutRow | null; events: EventRow[] }>
  fetchAssetHistory(assetId: string): Promise<EventRow[]>
  insertAsset(a: AssetInput): Promise<void>
  insertAssets(rows: AssetInput[]): Promise<void>
  updateAsset(id: string, a: Partial<AssetInput>): Promise<void>
  deleteAsset(id: string): Promise<void>
  insertType(t: TypeInput): Promise<TypeRow>
  updateType(id: string, t: Partial<TypeInput>): Promise<void>
  deleteType(id: string): Promise<void>
  insertTruck(t: TruckInput): Promise<TruckRow>
  updateTruck(id: string, t: Partial<TruckInput>): Promise<void>
  deleteTruck(id: string): Promise<void>
  addHandler(userId: string): Promise<void>
  removeHandler(userId: string): Promise<void>
  updateCheckout(id: string, patch: CheckoutPatch): Promise<void>
  loadPeople(): Promise<EquipmentPerson[]>
  loadSuggestions(): Promise<EquipmentSuggestions>
  subscribe(onChange: () => void): void
}

/* ── Mappers ────────────────────────────────────────────────────────── */

export function typeFromRow(r: TypeRow): EquipmentType {
  return { id: r.id, name: r.name, sort: r.sort, active: r.active }
}

export function truckFromRow(r: TruckRow): EquipmentTruck {
  return { id: r.id, label: r.label, sort: r.sort, active: r.active }
}

export function assetFromRow(r: AssetRow): EquipmentAsset {
  return {
    id: r.id,
    tag: r.tag,
    name: r.name,
    typeId: r.type_id,
    notes: r.notes ?? '',
    active: r.active,
    createdAt: r.created_at,
  }
}

export function checkoutFromRow(r: CheckoutRow): EquipmentCheckout {
  return {
    id: r.id,
    purpose: r.purpose,
    destination: r.destination,
    eventDate: r.event_date,
    extended: !!r.extended,
    endDate: r.end_date ?? null,
    note: r.note ?? '',
    createdBy: r.created_by,
    createdByName: r.created_by_name ?? '',
    createdAt: r.created_at,
    closedAt: r.closed_at,
    assetIds: (r.equipment_checkout_items ?? []).map((i) => i.asset_id),
  }
}

export function eventFromRow(r: EventRow): EquipmentCustodyEvent {
  return {
    id: r.id,
    seq: Number(r.seq),
    assetId: r.asset_id,
    checkoutId: r.checkout_id,
    actionId: r.action_id,
    kind: r.kind,
    actorId: r.actor_id,
    actorName: r.actor_name ?? '',
    recordedBy: r.recorded_by,
    destination: r.destination ?? '',
    handedToId: r.handed_to_id,
    handedToName: r.handed_to_name,
    note: r.note ?? '',
    photoPath: r.photo_path,
    signaturePath: r.signature_path ?? null,
    at: r.at,
    checkoutPurpose: r.checkout?.purpose,
    checkoutDestination: r.checkout?.destination,
  }
}

/**
 * Group scheduled dates into runs per event label: dates of the same event
 * no more than a week apart form one run (the fair's nights, a weekend
 * tournament). A run of 2+ dates suggests an extended assignment.
 */
export function eventRuns(rows: { label: string; on_date: string }[]): EventSuggestion[] {
  const byLabel = new Map<string, { label: string; dates: string[] }>()
  for (const r of rows) {
    const label = r.label.trim()
    if (!label) continue
    const key = label.toLowerCase()
    const entry = byLabel.get(key) ?? { label, dates: [] }
    if (!entry.dates.includes(r.on_date)) entry.dates.push(r.on_date)
    byLabel.set(key, entry)
  }
  const runs: EventSuggestion[] = []
  for (const { label, dates } of byLabel.values()) {
    dates.sort()
    let start = dates[0]
    let prev = dates[0]
    let count = 1
    for (const d of dates.slice(1)) {
      if (d <= addDays(prev, 7)) {
        prev = d
        count++
        continue
      }
      runs.push({ label, date: start, endDate: count > 1 ? prev : null, count })
      start = d
      prev = d
      count = 1
    }
    runs.push({ label, date: start, endDate: count > 1 ? prev : null, count })
  }
  return runs.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
}

/* ── Supabase implementation ────────────────────────────────────────── */

const EVENT_COLUMNS =
  'id, seq, asset_id, checkout_id, action_id, kind, actor_id, actor_name, recorded_by, destination, handed_to_id, handed_to_name, note, photo_path, signature_path, at'
const CHECKOUT_COLUMNS =
  'id, purpose, destination, event_date, extended, end_date, note, created_by, created_by_name, created_at, closed_at, equipment_checkout_items(asset_id)'

interface PgError {
  message: string
  code?: string
  details?: string | null
}

/** Turn a PostgREST error into a sentence a supervisor can act on. */
function friendly(
  err: PgError,
  context: 'asset' | 'type' | 'truck' | 'handler' | 'general' = 'general',
): Error {
  if (err.code === '23505') {
    if (context === 'asset') {
      const m = /\(tag\)=\((.*)\)/.exec(err.details ?? '')
      return new Error(
        m ? `Tag ${m[1]} is already in the registry.` : 'That tag is already in the registry.',
      )
    }
    if (context === 'type') return new Error('A type with that name already exists.')
    if (context === 'truck') return new Error('That truck is already on the list.')
    if (context === 'handler') return new Error('They already have check-out access.')
  }
  if (err.code === '23503') {
    if (context === 'asset')
      return new Error('This item has custody history, so it can’t be deleted. Retire it instead.')
    if (context === 'type') return new Error('That type is still in use. Retire it instead.')
  }
  if (err.code === '42501' && !/equipment|supervisor|sign in/i.test(err.message)) {
    return new Error('You don’t have permission to do that.')
  }
  return new Error(err.message)
}

function must<T>(res: { data: T | null; error: PgError | null }, context?: Parameters<typeof friendly>[1]): T {
  if (res.error) throw friendly(res.error, context)
  return res.data as T
}

export const supabaseEquipmentBackend: EquipmentBackend = {
  async loadBoard() {
    const [t, tr, a, l, o, h, r] = await Promise.all([
      supabase.from('equipment_types').select('id, name, sort, active').order('sort').order('name'),
      supabase.from('equipment_trucks').select('id, label, sort, active').order('sort').order('label'),
      supabase.from('equipment_assets').select('id, tag, name, type_id, notes, active, created_at'),
      supabase.from('equipment_asset_status').select(EVENT_COLUMNS),
      supabase
        .from('equipment_checkouts')
        .select(CHECKOUT_COLUMNS)
        .is('closed_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('equipment_handlers').select('user_id'),
      supabase
        .from('equipment_custody_events')
        .select(`${EVENT_COLUMNS}, checkout:equipment_checkouts(purpose, destination)`)
        .order('seq', { ascending: false })
        .limit(80),
    ])
    const open = must(o) as unknown as CheckoutRow[]
    let openEvents: EventRow[] = []
    if (open.length) {
      openEvents = must(
        await supabase
          .from('equipment_custody_events')
          .select(EVENT_COLUMNS)
          .in(
            'checkout_id',
            open.map((c) => c.id),
          )
          .order('seq'),
      ) as unknown as EventRow[]
    }
    return {
      types: must(t) as TypeRow[],
      trucks: must(tr) as TruckRow[],
      assets: must(a) as AssetRow[],
      latest: must(l) as unknown as EventRow[],
      open,
      openEvents,
      recent: must(r) as unknown as EventRow[],
      handlers: (must(h) as { user_id: string }[]).map((x) => x.user_id),
    }
  },

  async checkOut(a) {
    return must(
      await supabase.rpc('equipment_check_out', {
        p_asset_ids: a.assetIds,
        p_purpose: a.purpose,
        p_destination: a.destination,
        p_event_date: a.eventDate,
        p_note: a.note,
        p_extended: a.extended,
        p_end_date: a.extended ? a.endDate : null,
      }),
    ) as string
  },

  async record(a) {
    return must(
      await supabase.rpc('equipment_record', {
        p_checkout_id: a.checkoutId,
        p_kind: a.kind,
        p_asset_ids: a.assetIds,
        p_note: a.note,
        p_photo_path: a.photoPath,
        p_handed_to_id: a.handedToId,
        p_handed_to_name: a.handedToName,
        p_missing_ids: a.missingIds.length ? a.missingIds : null,
        p_signature_path: a.signaturePath,
      }),
    ) as string
  },

  async uploadPhoto(checkoutId, blob) {
    const type = blob.type || 'image/jpeg'
    const path = `${checkoutId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${imageExtension(type)}`
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: type, upsert: false })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    return path
  },

  async signPhotos(paths) {
    if (!paths.length) return {}
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, 60 * 60)
    if (error) throw new Error(error.message)
    const out: Record<string, string> = {}
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
    return out
  },

  async fetchCheckout(id) {
    const [c, e] = await Promise.all([
      supabase.from('equipment_checkouts').select(CHECKOUT_COLUMNS).eq('id', id).maybeSingle(),
      supabase.from('equipment_custody_events').select(EVENT_COLUMNS).eq('checkout_id', id).order('seq'),
    ])
    return {
      checkout: must(c) as unknown as CheckoutRow | null,
      events: must(e) as unknown as EventRow[],
    }
  },

  async fetchAssetHistory(assetId) {
    return must(
      await supabase
        .from('equipment_custody_events')
        .select(`${EVENT_COLUMNS}, checkout:equipment_checkouts(purpose, destination)`)
        .eq('asset_id', assetId)
        .order('seq', { ascending: false }),
    ) as unknown as EventRow[]
  },

  async insertAsset(a) {
    must(await supabase.from('equipment_assets').insert(a), 'asset')
  },

  async insertAssets(rows) {
    must(await supabase.from('equipment_assets').insert(rows), 'asset')
  },

  async updateAsset(id, a) {
    must(await supabase.from('equipment_assets').update(a).eq('id', id), 'asset')
  },

  async deleteAsset(id) {
    must(await supabase.from('equipment_assets').delete().eq('id', id), 'asset')
  },

  async insertType(t) {
    return must(
      await supabase.from('equipment_types').insert(t).select('id, name, sort, active').single(),
      'type',
    ) as TypeRow
  },

  async updateType(id, t) {
    must(await supabase.from('equipment_types').update(t).eq('id', id), 'type')
  },

  async deleteType(id) {
    const inUse = await supabase
      .from('equipment_assets')
      .select('id', { count: 'exact', head: true })
      .eq('type_id', id)
    if ((inUse.count ?? 0) > 0) throw new Error('That type is still in use. Retire it instead.')
    must(await supabase.from('equipment_types').delete().eq('id', id), 'type')
  },

  async insertTruck(t) {
    return must(
      await supabase.from('equipment_trucks').insert(t).select('id, label, sort, active').single(),
      'truck',
    ) as TruckRow
  },

  async updateTruck(id, t) {
    must(await supabase.from('equipment_trucks').update(t).eq('id', id), 'truck')
  },

  async deleteTruck(id) {
    must(await supabase.from('equipment_trucks').delete().eq('id', id), 'truck')
  },

  async addHandler(userId) {
    must(await supabase.from('equipment_handlers').insert({ user_id: userId }), 'handler')
  },

  async removeHandler(userId) {
    must(await supabase.from('equipment_handlers').delete().eq('user_id', userId), 'handler')
  },

  async updateCheckout(id, patch) {
    must(await supabase.from('equipment_checkouts').update(patch).eq('id', id))
  },

  async loadPeople() {
    const rows = must(
      await supabase
        .from('app_users')
        .select('id, full_name, title')
        .eq('active', true)
        .eq('account_type', 'person')
        .order('full_name'),
    ) as { id: string; full_name: string; title: string | null }[]
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, title: r.title }))
  },

  async loadSuggestions() {
    const today = todayCentral()
    /* Schedule events are read-only here, and optional: if the reader
       can't see them the chips fall back to recent history. Look 60 days
       out so a multi-night run (the fair) shows its whole span. */
    const [ev, recent] = await Promise.all([
      supabase
        .from('sched_events')
        .select('label, on_date')
        .gte('on_date', today)
        .lte('on_date', addDays(today, 60))
        .order('on_date')
        .limit(300),
      supabase
        .from('equipment_checkouts')
        .select('purpose')
        .order('created_at', { ascending: false })
        .limit(60),
    ])
    const rows = (ev.error ? [] : ev.data ?? []) as { label: string; on_date: string }[]
    const events = eventRuns(rows).filter((r) => r.date <= addDays(today, 10))
    const purposes: string[] = []
    for (const r of (recent.error ? [] : recent.data ?? []) as { purpose: string }[]) {
      const v = r.purpose.trim()
      if (v && !purposes.some((x) => x.toLowerCase() === v.toLowerCase())) purposes.push(v)
    }
    return { events, recentPurposes: purposes }
  },

  subscribe(onChange) {
    const channel = supabase.channel('equipment-board')
    for (const table of [
      'equipment_types',
      'equipment_trucks',
      'equipment_assets',
      'equipment_handlers',
      'equipment_checkouts',
      'equipment_custody_events',
    ]) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
    }
    channel.subscribe()
  },
}
