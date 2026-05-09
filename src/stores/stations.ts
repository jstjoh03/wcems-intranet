import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import seed from '@/data/stations.json'
import type { Station } from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

/**
 * Stations store — Supabase-backed in real-session mode, JSON-seed-backed
 * in dev-stub mode. The Phase 1 localStorage layer is gone; the legacy
 * key (`wcems:stations`) is removed on init for tidiness.
 *
 * Mutations (add/update/setActive/remove) update the in-memory cache
 * optimistically, then hit Supabase. On error we roll back the local
 * change and re-throw so callers can surface the failure. The DB stamps
 * door_code_updated_at / _by automatically via trigger and appends to
 * code_edit_history — clients no longer send those fields.
 */

interface StationRow {
  id: string
  name: string
  address: string
  city: string
  phone: string
  map_url: string
  door_code: string
  active: boolean
  door_code_updated_at: string | null
  door_code_updated_by: string | null
}

function rowToStation(r: StationRow): Station {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    phone: r.phone,
    mapUrl: r.map_url,
    doorCode: r.door_code,
    active: r.active,
    doorCodeUpdatedAt: r.door_code_updated_at,
    doorCodeUpdatedBy: r.door_code_updated_by,
  }
}

function stationToRowPatch(s: Partial<Station>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  if (s.id !== undefined) r.id = s.id
  if (s.name !== undefined) r.name = s.name
  if (s.address !== undefined) r.address = s.address
  if (s.city !== undefined) r.city = s.city
  if (s.phone !== undefined) r.phone = s.phone
  if (s.mapUrl !== undefined) r.map_url = s.mapUrl
  if (s.doorCode !== undefined) r.door_code = s.doorCode
  if (s.active !== undefined) r.active = s.active
  // doorCodeUpdatedAt / By are server-stamped via trigger — never sent.
  return r
}

export const useStationsStore = defineStore('stations', () => {
  const stations = ref<Station[]>([])
  const ready = ref(false)

  const activeStations = computed(() =>
    stations.value
      .filter((s) => s.active !== false)
      .sort((a, b) => Number(a.id) - Number(b.id)),
  )
  const allStations = computed(() =>
    [...stations.value].sort((a, b) => Number(a.id) - Number(b.id)),
  )

  async function init() {
    if (ready.value) return
    /* Clean up Phase 1 localStorage so it doesn't linger on user devices. */
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('wcems:stations')
    }
    const auth = useAuthStore()
    if (auth.usingDevStub || !auth.appUser) {
      stations.value = JSON.parse(JSON.stringify(seed)) as Station[]
      ready.value = true
      return
    }
    const { data, error } = await supabase
      .from('stations')
      .select(
        'id, name, address, city, phone, map_url, door_code, active, door_code_updated_at, door_code_updated_by',
      )
      .order('id')
    if (error) {
      console.error('[stations] failed to load:', error.message)
      stations.value = JSON.parse(JSON.stringify(seed)) as Station[]
      ready.value = true
      return
    }
    stations.value = (data ?? []).map((d) => rowToStation(d as StationRow))
    ready.value = true
  }

  async function refetchOne(id: string) {
    const { data } = await supabase
      .from('stations')
      .select(
        'id, name, address, city, phone, map_url, door_code, active, door_code_updated_at, door_code_updated_by',
      )
      .eq('id', id)
      .maybeSingle()
    if (data) {
      stations.value = stations.value.map((s) =>
        s.id === id ? rowToStation(data as StationRow) : s,
      )
    }
  }

  async function add(station: Station) {
    if (stations.value.some((s) => s.id === station.id)) {
      throw new Error(`A station with id "${station.id}" already exists`)
    }
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      stations.value = [...stations.value, station]
      return
    }
    const { error } = await supabase.from('stations').insert(stationToRowPatch(station))
    if (error) throw error
    stations.value = [...stations.value, station]
  }

  async function update(id: string, patch: Partial<Station>) {
    const before = stations.value
    stations.value = stations.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    const dbPatch = stationToRowPatch(patch)
    if (Object.keys(dbPatch).length === 0) return
    const { error } = await supabase.from('stations').update(dbPatch).eq('id', id)
    if (error) {
      stations.value = before
      throw error
    }
    await refetchOne(id)
  }

  async function setActive(id: string, active: boolean) {
    await update(id, { active })
  }

  async function remove(id: string) {
    const before = stations.value
    stations.value = stations.value.filter((s) => s.id !== id)
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    const { error } = await supabase.from('stations').delete().eq('id', id)
    if (error) {
      stations.value = before
      throw error
    }
  }

  /* Lazy init on first store access. By the time any component reads the
     store the auth bootstrap has already run, so usingDevStub is settled. */
  void init()

  return {
    stations,
    ready,
    activeStations,
    allStations,
    init,
    add,
    update,
    setActive,
    remove,
  }
})
