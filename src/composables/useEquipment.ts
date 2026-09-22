import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  assetFromRow,
  checkoutFromRow,
  eventFromRow,
  supabaseEquipmentBackend,
  truckFromRow,
  typeFromRow,
  type AssetInput,
  type CheckOutArgs,
  type EquipmentBackend,
  type EquipmentPerson,
  type EquipmentSuggestions,
} from '@/lib/equipmentBackend'
import { createDevEquipmentBackend } from '@/lib/equipmentDevBackend'
import { HOME_LOCATION, compareTags, statusFromKind } from '@/lib/equipment'
import type {
  EquipmentActionKind,
  EquipmentAsset,
  EquipmentAssetState,
  EquipmentCheckout,
  EquipmentCustodyEvent,
  EquipmentStatus,
  EquipmentTruck,
  EquipmentType,
} from '@/types'

/**
 * Event equipment check-out: the registry (types + assets), the live
 * "where is everything" board, and the custody actions.
 *
 * Module-singleton state, loaded once and fresh-fetched after every
 * mutation. Realtime on the five equipment tables triggers a debounced
 * refetch, so every open board stays live. Status is never stored — it
 * comes from each asset's latest custody event (equipment_asset_status).
 *
 * Handler = supervisor/admin by role, or a person on the grant list;
 * kiosk accounts are read-only. The server enforces the same rules.
 */

type Fail = { ok: false; error: string }
type Ok = { ok: true }

const types = ref<EquipmentType[]>([])
const trucks = ref<EquipmentTruck[]>([])
const assets = ref<EquipmentAsset[]>([])
const latestByAsset = ref<Record<string, EquipmentCustodyEvent>>({})
const openCheckouts = ref<EquipmentCheckout[]>([])
const openEvents = ref<EquipmentCustodyEvent[]>([])
const recentEvents = ref<EquipmentCustodyEvent[]>([])
const handlerIds = ref<string[]>([])
const ready = ref(false)
const loadError = ref<string | null>(null)
/** Bumps after every refetch — detail views watch it to reload. */
const version = ref(0)
const photoUrls = ref<Record<string, string>>({})
const photoExpiry: Record<string, number> = {}
const people = ref<EquipmentPerson[]>([])
let peoplePromise: Promise<void> | null = null

let devBackend: EquipmentBackend | null = null
let loadPromise: Promise<void> | null = null
let subscribed = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshToken = 0

function computeCanHandle(): boolean {
  const auth = useAuthStore()
  const u = auth.appUser
  if (!u || auth.isKiosk) return false
  if (auth.isSupervisor) return true
  return handlerIds.value.includes(u.id)
}

function backend(): EquipmentBackend {
  const auth = useAuthStore()
  /* import.meta.env.DEV is false in production builds, so the in-memory
     dev backend is dropped from the bundle entirely. */
  if (!import.meta.env.DEV || !auth.usingDevStub) return supabaseEquipmentBackend
  devBackend ??= createDevEquipmentBackend(
    () => ({ id: auth.appUser?.id ?? 'dev', fullName: auth.appUser?.fullName ?? 'Dev User' }),
    computeCanHandle,
  )
  return devBackend
}

function fail(e: unknown): Fail {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

async function refresh(): Promise<void> {
  const token = ++refreshToken
  try {
    const rows = await backend().loadBoard()
    if (token !== refreshToken) return
    types.value = rows.types.map(typeFromRow)
    trucks.value = rows.trucks.map(truckFromRow)
    assets.value = rows.assets.map(assetFromRow).sort((a, b) => compareTags(a.tag, b.tag))
    latestByAsset.value = Object.fromEntries(rows.latest.map((r) => [r.asset_id, eventFromRow(r)]))
    openCheckouts.value = rows.open.map(checkoutFromRow)
    openEvents.value = rows.openEvents.map(eventFromRow)
    recentEvents.value = rows.recent.map(eventFromRow)
    handlerIds.value = rows.handlers
    loadError.value = null
  } catch (e) {
    if (token !== refreshToken) return
    loadError.value = e instanceof Error ? e.message : String(e)
    console.error('[equipment] load failed:', loadError.value)
  }
  version.value++
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refresh()
  }, 250)
}

function load(): Promise<void> {
  if (!loadPromise) {
    loadPromise = refresh().finally(() => {
      ready.value = true
    })
    if (!subscribed) {
      subscribed = true
      backend().subscribe(scheduleRefresh)
    }
  }
  return loadPromise
}

/** Route-guard helper: resolves once the grant list is loaded. */
export async function canHandleEquipment(): Promise<boolean> {
  await load()
  return computeCanHandle()
}

export function useEquipment() {
  const auth = useAuthStore()
  void load()

  const canHandle = computed(() => computeCanHandle())
  /** Anyone signed in with their own account (kiosks are read-only). */
  const canRecord = computed(() => !!auth.appUser && !auth.isKiosk)
  const isAdmin = computed(() => auth.isAdmin)

  const typeById = computed<Record<string, EquipmentType>>(() =>
    Object.fromEntries(types.value.map((t) => [t.id, t])),
  )
  const activeTypes = computed(() => types.value.filter((t) => t.active))
  const activeTrucks = computed(() =>
    [...trucks.value].filter((t) => t.active).sort((a, b) => a.sort - b.sort),
  )
  const assetById = computed<Record<string, EquipmentAsset>>(() =>
    Object.fromEntries(assets.value.map((a) => [a.id, a])),
  )
  const openCheckoutById = computed<Record<string, EquipmentCheckout>>(() =>
    Object.fromEntries(openCheckouts.value.map((c) => [c.id, c])),
  )

  function typeName(typeId: string | null): string {
    return (typeId && typeById.value[typeId]?.name) || 'Uncategorized'
  }

  /** Exact tag match, else a unique match ignoring leading zeros
   *  ("436" finds "00436" — hand-typed links, Excel-mangled tags). */
  function assetByTag(tag: string): EquipmentAsset | null {
    const t = tag.trim().toLowerCase()
    const exact = assets.value.find((a) => a.tag.toLowerCase() === t)
    if (exact) return exact
    const strip = (s: string) => s.replace(/^0+(?=\d)/, '')
    const loose = assets.value.filter((a) => strip(a.tag.toLowerCase()) === strip(t))
    return loose.length === 1 ? loose[0] : null
  }

  function stateOf(assetId: string): EquipmentAssetState {
    const ev = latestByAsset.value[assetId] ?? null
    const status = statusFromKind(ev?.kind)
    let location = HOME_LOCATION
    if (ev && status !== 'available' && status !== 'returning') {
      /* The live check-out wins over the event snapshot, so a fixed
         typo in the destination shows everywhere at once. */
      location = openCheckoutById.value[ev.checkoutId]?.destination ?? ev.destination
    }
    return {
      status,
      location,
      since: ev?.at ?? null,
      checkoutId: status === 'available' ? null : (ev?.checkoutId ?? null),
      lastEvent: ev,
    }
  }

  /** Active items, plus any retired item that's somehow still out
   *  (a retired item written off as lost has left the building). */
  const boardAssets = computed(() =>
    assets.value.filter((a) => {
      if (a.active) return true
      const st = stateOf(a.id).status
      return st !== 'available' && st !== 'lost'
    }),
  )

  const counts = computed<Record<EquipmentStatus, number>>(() => {
    const c: Record<EquipmentStatus, number> = {
      available: 0,
      in_transit: 0,
      on_unit: 0,
      missing: 0,
      returning: 0,
      lost: 0,
    }
    for (const a of boardAssets.value) c[stateOf(a.id).status]++
    return c
  })

  function eventsForCheckout(checkoutId: string): EquipmentCustodyEvent[] {
    return openEvents.value.filter((e) => e.checkoutId === checkoutId)
  }

  /* ── Photos (private bucket → short-lived signed URLs) ─────────────── */
  async function ensurePhotoUrls(paths: (string | null | undefined)[]) {
    const now = Date.now()
    const need = [...new Set(paths.filter((p): p is string => !!p))].filter(
      (p) => !photoUrls.value[p] || (photoExpiry[p] ?? 0) < now,
    )
    if (!need.length) return
    try {
      const urls = await backend().signPhotos(need)
      photoUrls.value = { ...photoUrls.value, ...urls }
      for (const p of Object.keys(urls)) photoExpiry[p] = now + 50 * 60_000
    } catch (e) {
      console.warn('[equipment] photo links failed:', e)
    }
  }

  /* ── People (handed-to picker, handler grants) ─────────────────────── */
  function loadPeople(): Promise<void> {
    peoplePromise ??= backend()
      .loadPeople()
      .then((rows) => {
        people.value = rows
      })
      .catch((e) => {
        peoplePromise = null
        console.warn('[equipment] people load failed:', e)
      })
    return peoplePromise
  }

  function personName(id: string): string {
    return people.value.find((p) => p.id === id)?.fullName ?? 'Unknown'
  }

  async function loadSuggestions(): Promise<EquipmentSuggestions> {
    try {
      return await backend().loadSuggestions()
    } catch {
      return { events: [], recentPurposes: [] }
    }
  }

  /* ── Custody actions ───────────────────────────────────────────────── */
  async function checkOut(input: CheckOutArgs): Promise<{ ok: true; id: string } | Fail> {
    try {
      const id = await backend().checkOut(input)
      await refresh()
      return { ok: true, id }
    } catch (e) {
      void refresh()
      return fail(e)
    }
  }

  async function recordAction(input: {
    checkoutId: string
    kind: EquipmentActionKind
    assetIds: string[]
    missingIds?: string[]
    note?: string
    /** Already downscaled by the photo field. */
    photo?: Blob | null
    handedToId?: string | null
    handedToName?: string | null
    /** The receiver's signature (PNG data URL) for a hand-off. */
    signature?: string | null
  }): Promise<Ok | Fail> {
    try {
      const photoPath = input.photo
        ? await backend().uploadPhoto(input.checkoutId, input.photo)
        : null
      const signaturePath = input.signature
        ? await backend().uploadPhoto(input.checkoutId, await (await fetch(input.signature)).blob())
        : null
      await backend().record({
        checkoutId: input.checkoutId,
        kind: input.kind,
        assetIds: input.assetIds,
        missingIds: input.missingIds ?? [],
        note: input.note?.trim() ?? '',
        photoPath,
        handedToId: input.handedToId ?? null,
        handedToName: input.handedToName?.trim() || null,
        signaturePath,
      })
      await refresh()
      return { ok: true }
    } catch (e) {
      void refresh()
      return fail(e)
    }
  }

  async function fetchCheckout(
    id: string,
  ): Promise<{ checkout: EquipmentCheckout | null; events: EquipmentCustodyEvent[] }> {
    const res = await backend().fetchCheckout(id)
    return {
      checkout: res.checkout ? checkoutFromRow(res.checkout) : null,
      events: res.events.map(eventFromRow),
    }
  }

  async function fetchAssetHistory(assetId: string): Promise<EquipmentCustodyEvent[]> {
    return (await backend().fetchAssetHistory(assetId)).map(eventFromRow)
  }

  async function updateCheckoutDetails(
    id: string,
    patch: {
      purpose: string
      destination: string
      eventDate: string | null
      extended: boolean
      endDate: string | null
      note: string
    },
  ): Promise<Ok | Fail> {
    if (!patch.purpose.trim()) return { ok: false, error: 'Add what the equipment is for.' }
    if (!patch.destination.trim()) return { ok: false, error: 'Pick the truck it’s on.' }
    const endDate = patch.extended ? patch.endDate || null : null
    if (endDate && patch.eventDate && endDate < patch.eventDate)
      return { ok: false, error: 'The assignment can’t end before it starts.' }
    try {
      await backend().updateCheckout(id, {
        purpose: patch.purpose.trim(),
        destination: patch.destination.trim(),
        event_date: patch.eventDate || null,
        extended: patch.extended,
        end_date: endDate,
        note: patch.note.trim(),
      })
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  /** Admin-only: erase a check-out entirely — custody log, items, and
   *  photos. For test runs and mistakes, not real history. */
  async function deleteCheckout(id: string): Promise<Ok | Fail> {
    try {
      await backend().deleteCheckout(id)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  /** Admin-only: sweep photo folders whose check-out no longer exists. */
  async function cleanOrphanedPhotos(): Promise<{ ok: true; removed: number } | Fail> {
    try {
      const removed = await backend().cleanOrphanedPhotos()
      return { ok: true, removed }
    } catch (e) {
      return fail(e)
    }
  }

  /* ── Registry ──────────────────────────────────────────────────────── */
  async function saveAsset(
    id: string | null,
    input: { tag: string; name: string; typeId: string | null; notes: string; active: boolean },
  ): Promise<Ok | Fail> {
    const row: AssetInput = {
      tag: input.tag.trim(),
      name: input.name.trim(),
      type_id: input.typeId,
      notes: input.notes.trim(),
      active: input.active,
    }
    if (!row.tag) return { ok: false, error: 'Add the PSTrax asset tag.' }
    if (!row.name) return { ok: false, error: 'Add a name or description.' }
    try {
      if (id) await backend().updateAsset(id, row)
      else await backend().insertAsset(row)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function importAssets(
    rows: { tag: string; name: string; typeName: string }[],
  ): Promise<{ ok: true; added: number } | Fail> {
    try {
      /* Create any type the paste names that doesn't exist yet. */
      const byName = new Map(types.value.map((t) => [t.name.trim().toLowerCase(), t.id]))
      let nextSort = Math.max(0, ...types.value.map((t) => t.sort)) + 1
      for (const r of rows) {
        const key = r.typeName.trim().toLowerCase()
        if (key && !byName.has(key)) {
          const created = await backend().insertType({
            name: r.typeName.trim(),
            sort: nextSort++,
            active: true,
          })
          byName.set(key, created.id)
        }
      }
      await backend().insertAssets(
        rows.map((r) => ({
          tag: r.tag.trim(),
          name: r.name.trim(),
          type_id: byName.get(r.typeName.trim().toLowerCase()) ?? null,
          notes: '',
          active: true,
        })),
      )
      await refresh()
      return { ok: true, added: rows.length }
    } catch (e) {
      void refresh()
      return fail(e)
    }
  }

  async function deleteAsset(id: string): Promise<Ok | Fail> {
    try {
      await backend().deleteAsset(id)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function saveType(id: string | null, input: { name: string; active: boolean }): Promise<Ok | Fail> {
    const name = input.name.trim()
    if (!name) return { ok: false, error: 'Give the type a name.' }
    try {
      if (id) await backend().updateType(id, { name, active: input.active })
      else
        await backend().insertType({
          name,
          active: input.active,
          sort: Math.max(0, ...types.value.map((t) => t.sort)) + 1,
        })
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function moveType(id: string, dir: -1 | 1): Promise<Ok | Fail> {
    const list = [...types.value].sort((a, b) => a.sort - b.sort)
    const i = list.findIndex((t) => t.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return { ok: true }
    try {
      /* Renumber the whole list so ties from older rows can't stick. */
      const reordered = [...list]
      ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
      await Promise.all(
        reordered.map((t, idx) =>
          t.sort === idx + 1 ? null : backend().updateType(t.id, { sort: idx + 1 }),
        ),
      )
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function deleteType(id: string): Promise<Ok | Fail> {
    try {
      await backend().deleteType(id)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  /* ── Trucks ────────────────────────────────────────────────────────── */
  async function saveTruck(id: string | null, input: { label: string; active: boolean }): Promise<
    { ok: true; truck?: EquipmentTruck } | Fail
  > {
    const label = input.label.trim()
    if (!label) return { ok: false, error: 'Add the truck number.' }
    try {
      if (id) {
        await backend().updateTruck(id, { label, active: input.active })
        await refresh()
        return { ok: true }
      }
      const row = await backend().insertTruck({
        label,
        active: input.active,
        sort: Math.max(0, ...trucks.value.map((t) => t.sort)) + 1,
      })
      await refresh()
      return { ok: true, truck: truckFromRow(row) }
    } catch (e) {
      return fail(e)
    }
  }

  async function moveTruck(id: string, dir: -1 | 1): Promise<Ok | Fail> {
    const list = [...trucks.value].sort((a, b) => a.sort - b.sort)
    const i = list.findIndex((t) => t.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return { ok: true }
    try {
      const reordered = [...list]
      ;[reordered[i], reordered[j]] = [reordered[j], reordered[i]]
      await Promise.all(
        reordered.map((t, idx) =>
          t.sort === idx + 1 ? null : backend().updateTruck(t.id, { sort: idx + 1 }),
        ),
      )
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function deleteTruck(id: string): Promise<Ok | Fail> {
    try {
      await backend().deleteTruck(id)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function addHandler(userId: string): Promise<Ok | Fail> {
    try {
      await backend().addHandler(userId)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  async function removeHandler(userId: string): Promise<Ok | Fail> {
    try {
      await backend().removeHandler(userId)
      await refresh()
      return { ok: true }
    } catch (e) {
      return fail(e)
    }
  }

  return {
    ready,
    loadError,
    version,
    types,
    activeTypes,
    trucks,
    activeTrucks,
    assets,
    boardAssets,
    openCheckouts,
    recentEvents,
    handlerIds,
    people,
    photoUrls,
    canHandle,
    canRecord,
    isAdmin,
    counts,
    typeById,
    assetById,
    openCheckoutById,
    typeName,
    assetByTag,
    stateOf,
    eventsForCheckout,
    ensurePhotoUrls,
    loadPeople,
    personName,
    loadSuggestions,
    refresh,
    checkOut,
    recordAction,
    fetchCheckout,
    fetchAssetHistory,
    updateCheckoutDetails,
    deleteCheckout,
    cleanOrphanedPhotos,
    saveAsset,
    importAssets,
    deleteAsset,
    saveType,
    moveType,
    deleteType,
    saveTruck,
    moveTruck,
    deleteTruck,
    addHandler,
    removeHandler,
  }
}
