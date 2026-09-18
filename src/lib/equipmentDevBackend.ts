import { ACTION_RULES, HOME_LOCATION, RESOLVED_KINDS, addDays, todayCentral } from '@/lib/equipment'
import type {
  AssetInput,
  AssetRow,
  CheckoutRow,
  EquipmentBackend,
  EquipmentPerson,
  EventRow,
  TypeRow,
} from '@/lib/equipmentBackend'
import type { EquipmentEventKind } from '@/types'

/**
 * In-memory stand-in for the equipment tables + RPCs, used only when
 * the dev stub is active (local `vite`, no Supabase session). Mirrors
 * the server's transition rules so the flows can be exercised end to
 * end in a browser. State resets on reload.
 */

interface DevUser {
  id: string
  fullName: string
}

const DEV_PEOPLE: EquipmentPerson[] = [
  { id: 'dev-p1', fullName: 'Brianna Smith', title: 'Paramedic' },
  { id: 'dev-p2', fullName: 'Dennis Ho', title: 'EMT' },
  { id: 'dev-p3', fullName: 'Tara Roth', title: 'Paramedic' },
  { id: 'dev-p4', fullName: 'Marcus Lane', title: 'EMT' },
  { id: 'dev-p5', fullName: 'Priya Patel', title: 'Supply Coordinator' },
]

/** Neutral placeholder "photo" for seeded evidence. */
function placeholderPhoto(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e2f6b"/><stop offset="1" stop-color="#0a1230"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<rect x="250" y="210" width="300" height="180" rx="14" fill="none" stroke="#C8A44D" stroke-width="4" stroke-dasharray="14 10"/>
<text x="400" y="440" font-family="Georgia, serif" font-size="30" fill="#e8cb72" text-anchor="middle">${label}</text>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

export function createDevEquipmentBackend(
  me: () => DevUser,
  isHandler: () => boolean,
): EquipmentBackend {
  const today = todayCentral()
  const types: TypeRow[] = [
    { id: 'type-radio', name: 'Radio', sort: 1, active: true },
    { id: 'type-ipad', name: 'iPad', sort: 2, active: true },
  ]
  const assets: AssetRow[] = [
    ...[431, 432, 433, 434, 435, 436, 437, 438].map((n, i) => ({
      id: `a-r${n}`,
      tag: `00${n}`,
      name: `APX 6000 portable #${i + 1}`,
      type_id: 'type-radio',
      notes: '',
      active: true,
      created_at: hoursAgo(900),
    })),
    ...[512, 513, 514].map((n, i) => ({
      id: `a-i${n}`,
      tag: `00${n}`,
      name: `Event iPad ${i + 1}`,
      type_id: 'type-ipad',
      notes: i === 2 ? 'Cracked corner — still works' : '',
      active: true,
      created_at: hoursAgo(900),
    })),
  ]
  const checkouts: CheckoutRow[] = []
  const items: { checkout_id: string; asset_id: string }[] = []
  const events: EventRow[] = []
  const handlers: string[] = []
  const photos = new Map<string, string>()
  let seq = 0

  function push(
    checkoutId: string,
    actionId: string,
    kind: EquipmentEventKind,
    assetIds: string[],
    by: DevUser,
    at: string,
    extra: Partial<EventRow> = {},
  ) {
    const co = checkouts.find((c) => c.id === checkoutId)!
    const toAdmin = kind === 'picked_up' || kind === 'returned' || kind === 'canceled'
    for (const assetId of assetIds) {
      events.push({
        id: `ev-${++seq}`,
        seq,
        asset_id: assetId,
        checkout_id: checkoutId,
        action_id: actionId,
        kind,
        actor_id: by.id,
        actor_name: by.fullName,
        recorded_by: by.id,
        destination: toAdmin ? HOME_LOCATION : co.destination,
        handed_to_id: null,
        handed_to_name: null,
        note: '',
        photo_path: null,
        at,
        ...extra,
      })
    }
  }

  function seedCheckout(
    id: string,
    purpose: string,
    destination: string,
    eventDate: string,
    assetIds: string[],
    by: DevUser,
    at: string,
  ) {
    checkouts.push({
      id,
      purpose,
      destination,
      event_date: eventDate,
      note: '',
      created_by: by.id,
      created_by_name: by.fullName,
      created_at: at,
      closed_at: null,
    })
    for (const a of assetIds) items.push({ checkout_id: id, asset_id: a })
    push(id, `${id}-out`, 'checked_out', assetIds, by, at)
  }

  /* Seed: one of every phase so each screen has something to show —
     inserted oldest first so seq order matches time, as in production. */
  const justin = me()
  const sup = { id: 'dev-sup', fullName: 'Kelly Moreno' }
  const tara = { id: 'dev-p3', fullName: 'Tara Roth' }
  const dennis = { id: 'dev-p2', fullName: 'Dennis Ho' }

  /* A finished check-out from last week, for item history. */
  seedCheckout('co-old', 'Senior Health Fair', 'M221', addDays(today, -6), ['a-r437'], sup, hoursAgo(150))
  push('co-old', 'co-old-del', 'delivered', ['a-r437'], sup, hoursAgo(149), {
    handed_to_id: 'dev-p1',
    handed_to_name: 'Brianna Smith',
  })
  push('co-old', 'co-old-up', 'picked_up', ['a-r437'], sup, hoursAgo(140))
  push('co-old', 'co-old-ret', 'returned', ['a-r437'], sup, hoursAgo(139), {
    handed_to_name: 'Front desk',
  })
  checkouts.find((c) => c.id === 'co-old')!.closed_at = hoursAgo(139)

  photos.set('co-hemp/seed-left.jpg', placeholderPhoto('Left in the jump seat cabinet'))
  seedCheckout(
    'co-hemp',
    'Hempstead HS Football',
    'M231',
    addDays(today, -1),
    ['a-r436', 'a-i513'],
    justin,
    hoursAgo(27),
  )
  photos.set('co-hemp/seed-drop.jpg', placeholderPhoto('Dropped on the stretcher'))
  push('co-hemp', 'co-hemp-del', 'delivered', ['a-r436', 'a-i513'], justin, hoursAgo(26.5), {
    photo_path: 'co-hemp/seed-drop.jpg',
    note: 'Nobody on the truck yet — left on the stretcher.',
  })
  push('co-hemp', 'co-hemp-conf', 'confirmed_present', ['a-r436', 'a-i513'], dennis, hoursAgo(24))
  push('co-hemp', 'co-hemp-close', 'event_closed', ['a-r436', 'a-i513'], dennis, hoursAgo(20), {
    photo_path: 'co-hemp/seed-left.jpg',
  })

  seedCheckout(
    'co-royal',
    'Royal HS Football',
    'M272',
    today,
    ['a-r433', 'a-r434', 'a-r435', 'a-i512'],
    sup,
    hoursAgo(3),
  )
  push('co-royal', 'co-royal-del', 'delivered', ['a-r433', 'a-r434', 'a-r435', 'a-i512'], sup, hoursAgo(2.6), {
    handed_to_id: 'dev-p3',
    handed_to_name: 'Tara Roth',
    note: 'Radios in the grey Pelican case, iPad in the cab.',
  })
  push('co-royal', 'co-royal-conf', 'confirmed_present', ['a-r433', 'a-r434', 'a-i512'], tara, hoursAgo(1.2), {
    note: 'Radio #5 wasn’t in the case.',
  })
  push('co-royal', 'co-royal-conf', 'reported_missing', ['a-r435'], tara, hoursAgo(1.2), {
    note: 'Radio #5 wasn’t in the case.',
  })

  seedCheckout('co-fair', 'Waller County Fair', 'M206', today, ['a-r431', 'a-r432'], justin, hoursAgo(0.4))

  /* ── helpers ── */
  const withItems = (c: CheckoutRow): CheckoutRow => ({
    ...c,
    equipment_checkout_items: items
      .filter((i) => i.checkout_id === c.id)
      .map((i) => ({ asset_id: i.asset_id })),
  })
  const withCheckout = (e: EventRow): EventRow => {
    const c = checkouts.find((x) => x.id === e.checkout_id)
    return { ...e, checkout: c ? { purpose: c.purpose, destination: c.destination } : null }
  }
  const latestFor = (assetId: string, checkoutId?: string) =>
    [...events]
      .reverse()
      .find((e) => e.asset_id === assetId && (!checkoutId || e.checkout_id === checkoutId))
  const delay = () => new Promise((r) => setTimeout(r, 180))
  const requireHandler = () => {
    if (!isHandler())
      throw new Error('Only supervisors, admins, and equipment handlers can do that step.')
  }
  const uuid = () => `dev-${Math.random().toString(36).slice(2, 10)}`

  return {
    async loadBoard() {
      await delay()
      const open = checkouts.filter((c) => !c.closed_at).map(withItems)
      const latest = assets
        .map((a) => latestFor(a.id))
        .filter((e): e is EventRow => !!e)
      return {
        types: [...types].sort((a, b) => a.sort - b.sort),
        assets: [...assets],
        latest,
        open: open.sort((a, b) => b.created_at.localeCompare(a.created_at)),
        openEvents: events.filter((e) => open.some((c) => c.id === e.checkout_id)),
        recent: [...events].reverse().slice(0, 80).map(withCheckout),
        handlers: [...handlers],
      }
    },

    async checkOut(a) {
      await delay()
      requireHandler()
      if (!a.purpose.trim()) throw new Error('Add what the equipment is for.')
      if (!a.destination.trim()) throw new Error('Add the unit it’s going to.')
      const ids = [...new Set(a.assetIds)]
      if (!ids.length) throw new Error('Select at least one item.')
      const busy = ids
        .map((id) => assets.find((x) => x.id === id)!)
        .filter((x) => {
          const k = latestFor(x.id)?.kind
          return k && k !== 'returned' && k !== 'canceled'
        })
      if (busy.length)
        throw new Error(`Already checked out: ${busy.map((b) => b.tag).join(', ')}. Refresh and pick again.`)
      const id = uuid()
      const who = me()
      checkouts.push({
        id,
        purpose: a.purpose.trim(),
        destination: a.destination.trim(),
        event_date: a.eventDate,
        note: a.note.trim(),
        created_by: who.id,
        created_by_name: who.fullName,
        created_at: new Date().toISOString(),
        closed_at: null,
      })
      for (const x of ids) items.push({ checkout_id: id, asset_id: x })
      push(id, uuid(), 'checked_out', ids, who, new Date().toISOString(), { note: a.note.trim() })
      return id
    },

    async record(a) {
      await delay()
      const rule = ACTION_RULES[a.kind]
      if (rule.handlerOnly) requireHandler()
      const co = checkouts.find((c) => c.id === a.checkoutId)
      if (!co) throw new Error('Check-out not found.')
      const all = [...a.assetIds, ...a.missingIds]
      if (!all.length) throw new Error('Select at least one item.')
      if (a.missingIds.length && !a.note.trim()) throw new Error('Add a note about what’s missing.')
      if (a.kind === 'written_off' && !a.note.trim())
        throw new Error('Add a note: what happened, and who was notified.')
      const handed = a.handedToId
        ? DEV_PEOPLE.find((p) => p.id === a.handedToId)?.fullName ?? null
        : a.handedToName?.trim() || null
      if (rule.evidence === 'photo-or-person' && !handed && !a.photoPath)
        throw new Error('Name who you handed the items to, or add a photo of where you left them.')
      if (rule.evidence === 'photo' && !a.photoPath)
        throw new Error('A photo of where the items were left is required.')
      const stale = all.filter((id) => {
        const k = latestFor(id, co.id)?.kind
        return !k || !rule.from.includes(k)
      })
      if (stale.length) throw new Error('Some items have already moved on. Refresh and try again.')
      const actionId = uuid()
      const at = new Date().toISOString()
      const who = me()
      const extra: Partial<EventRow> = {
        note: a.note.trim(),
        photo_path: a.photoPath,
        handed_to_id: a.kind === 'delivered' || a.kind === 'returned' ? a.handedToId : null,
        handed_to_name: a.kind === 'delivered' || a.kind === 'returned' ? handed : null,
      }
      push(co.id, actionId, a.kind, a.assetIds, who, at, extra)
      if (a.missingIds.length)
        push(co.id, actionId, 'reported_missing', a.missingIds, who, at, { note: a.note.trim() })
      const stillOut = items
        .filter((i) => i.checkout_id === co.id)
        .some((i) => {
          const k = latestFor(i.asset_id, co.id)?.kind
          return !k || !RESOLVED_KINDS.includes(k)
        })
      if (!stillOut) co.closed_at = at
      return actionId
    },

    async uploadPhoto(checkoutId, blob) {
      await delay()
      const path = `${checkoutId}/${Date.now()}.jpg`
      photos.set(path, URL.createObjectURL(blob))
      return path
    },

    async signPhotos(paths) {
      const out: Record<string, string> = {}
      for (const p of paths) {
        const url = photos.get(p)
        if (url) out[p] = url
      }
      return out
    },

    async fetchCheckout(id) {
      await delay()
      const c = checkouts.find((x) => x.id === id)
      return {
        checkout: c ? withItems(c) : null,
        events: events.filter((e) => e.checkout_id === id),
      }
    },

    async fetchAssetHistory(assetId) {
      await delay()
      return [...events]
        .reverse()
        .filter((e) => e.asset_id === assetId)
        .map(withCheckout)
    },

    async insertAsset(a) {
      requireHandler()
      if (assets.some((x) => x.tag === a.tag)) throw new Error(`Tag ${a.tag} is already in the registry.`)
      assets.push({ id: uuid(), created_at: new Date().toISOString(), ...a })
    },

    async insertAssets(rows: AssetInput[]) {
      requireHandler()
      const dupe = rows.find((r) => assets.some((x) => x.tag === r.tag))
      if (dupe) throw new Error(`Tag ${dupe.tag} is already in the registry.`)
      for (const r of rows) assets.push({ id: uuid(), created_at: new Date().toISOString(), ...r })
    },

    async updateAsset(id, a) {
      requireHandler()
      if (a.tag && assets.some((x) => x.tag === a.tag && x.id !== id))
        throw new Error(`Tag ${a.tag} is already in the registry.`)
      const row = assets.find((x) => x.id === id)
      if (row) Object.assign(row, a)
    },

    async deleteAsset(id) {
      requireHandler()
      if (events.some((e) => e.asset_id === id))
        throw new Error('This item has custody history, so it can’t be deleted. Retire it instead.')
      assets.splice(
        assets.findIndex((x) => x.id === id),
        1,
      )
    },

    async insertType(t) {
      requireHandler()
      if (types.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase()))
        throw new Error('A type with that name already exists.')
      const row = { id: uuid(), ...t }
      types.push(row)
      return row
    },

    async updateType(id, t) {
      requireHandler()
      const row = types.find((x) => x.id === id)
      if (row) Object.assign(row, t)
    },

    async deleteType(id) {
      requireHandler()
      if (assets.some((a) => a.type_id === id)) throw new Error('That type is still in use. Retire it instead.')
      types.splice(
        types.findIndex((x) => x.id === id),
        1,
      )
    },

    async addHandler(userId) {
      if (!handlers.includes(userId)) handlers.push(userId)
    },

    async removeHandler(userId) {
      const i = handlers.indexOf(userId)
      if (i >= 0) handlers.splice(i, 1)
    },

    async updateCheckout(id, patch) {
      requireHandler()
      const c = checkouts.find((x) => x.id === id)
      if (c) Object.assign(c, patch)
    },

    async loadPeople() {
      return [{ id: me().id, fullName: me().fullName, title: 'Paramedic' }, ...DEV_PEOPLE]
    },

    async loadSuggestions() {
      return {
        events: [
          { label: 'Royal HS Football', date: today },
          { label: 'Waller County Fair', date: addDays(today, 1) },
          { label: 'Senior Health Fair', date: addDays(today, 3) },
          { label: 'City of Waller National Night Out', date: addDays(today, 5) },
        ],
        units: ['M272', 'M206', 'M231', 'M211', 'M221', 'M242', 'M281', 'M271', 'S201', 'S202'],
        recentPurposes: ['Royal HS Football', 'Waller County Fair', 'Hempstead HS Football'],
      }
    },

    subscribe() {
      /* No realtime in the dev stub — mutations refresh the board. */
    },
  }
}
