import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import seed from '@/data/hospitals.json'
import type { Hospital, TraumaLevel, StrokeLevel } from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'

/**
 * Hospitals store — Supabase-backed in real-session mode, JSON-seed-backed
 * in dev-stub mode. Same shape as `useStationsStore`. Door-code stamps
 * (door_code_updated_at / _by) are server-stamped via DB trigger and the
 * audit row in `code_edit_history` is appended automatically.
 */

interface HospitalRow {
  id: string
  name: string
  trauma: TraumaLevel
  stroke: StrokeLevel
  pci_capable: boolean
  maternal_level: string | null
  nicu_level: string | null
  is_pediatric: boolean
  address: string
  map_url: string
  er_door_code: string | null
  ems_room_code: string | null
  no_door_code: boolean
  notes: string | null
  code_effective_from: string | null
  active: boolean
  door_code_updated_at: string | null
  door_code_updated_by: string | null
}

function rowToHospital(r: HospitalRow): Hospital {
  return {
    id: r.id,
    name: r.name,
    trauma: r.trauma,
    stroke: r.stroke,
    pciCapable: r.pci_capable,
    maternalLevel: r.maternal_level,
    nicuLevel: r.nicu_level,
    isPediatric: r.is_pediatric,
    address: r.address,
    mapUrl: r.map_url,
    erDoorCode: r.er_door_code,
    emsRoomCode: r.ems_room_code,
    noDoorCode: r.no_door_code,
    notes: r.notes,
    codeEffectiveFrom: r.code_effective_from,
    active: r.active,
    doorCodeUpdatedAt: r.door_code_updated_at,
    doorCodeUpdatedBy: r.door_code_updated_by,
  }
}

function hospitalToRowPatch(h: Partial<Hospital>): Record<string, unknown> {
  const r: Record<string, unknown> = {}
  if (h.id !== undefined) r.id = h.id
  if (h.name !== undefined) r.name = h.name
  if (h.trauma !== undefined) r.trauma = h.trauma
  if (h.stroke !== undefined) r.stroke = h.stroke
  if (h.pciCapable !== undefined) r.pci_capable = h.pciCapable
  if (h.maternalLevel !== undefined) r.maternal_level = h.maternalLevel
  if (h.nicuLevel !== undefined) r.nicu_level = h.nicuLevel
  if (h.isPediatric !== undefined) r.is_pediatric = h.isPediatric
  if (h.address !== undefined) r.address = h.address
  if (h.mapUrl !== undefined) r.map_url = h.mapUrl
  if (h.erDoorCode !== undefined) r.er_door_code = h.erDoorCode
  if (h.emsRoomCode !== undefined) r.ems_room_code = h.emsRoomCode
  if (h.noDoorCode !== undefined) r.no_door_code = h.noDoorCode
  if (h.notes !== undefined) r.notes = h.notes
  if (h.codeEffectiveFrom !== undefined) r.code_effective_from = h.codeEffectiveFrom
  if (h.active !== undefined) r.active = h.active
  // doorCodeUpdatedAt / By server-stamped — never sent.
  return r
}

export const useHospitalsStore = defineStore('hospitals', () => {
  const hospitals = ref<Hospital[]>([])
  const ready = ref(false)

  const activeHospitals = computed(() =>
    hospitals.value.filter((h) => h.active !== false),
  )

  async function init() {
    if (ready.value) return
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('wcems:hospitals')
    }
    const auth = useAuthStore()
    if (auth.usingDevStub || !auth.appUser) {
      hospitals.value = JSON.parse(JSON.stringify(seed)) as Hospital[]
      ready.value = true
      return
    }
    const { data, error } = await supabase
      .from('hospitals')
      .select(
        'id, name, trauma, stroke, pci_capable, maternal_level, nicu_level, is_pediatric, address, map_url, er_door_code, ems_room_code, no_door_code, notes, code_effective_from, active, door_code_updated_at, door_code_updated_by',
      )
      .order('name')
    if (error) {
      console.error('[hospitals] failed to load:', error.message)
      hospitals.value = JSON.parse(JSON.stringify(seed)) as Hospital[]
      ready.value = true
      return
    }
    hospitals.value = (data ?? []).map((d) => rowToHospital(d as HospitalRow))
    ready.value = true
    subscribeRealtime()
  }

  /**
   * Live updates from the `hospitals` table — same idempotent pattern
   * as the stations store.
   */
  function subscribeRealtime() {
    supabase
      .channel('hospitals')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hospitals' },
        (payload) => {
          const row = rowToHospital(payload.new as HospitalRow)
          if (hospitals.value.some((h) => h.id === row.id)) return
          hospitals.value = [...hospitals.value, row]
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'hospitals' },
        (payload) => {
          const row = rowToHospital(payload.new as HospitalRow)
          hospitals.value = hospitals.value.map((h) => (h.id === row.id ? row : h))
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'hospitals' },
        (payload) => {
          const old = payload.old as { id?: string }
          if (!old.id) return
          hospitals.value = hospitals.value.filter((h) => h.id !== old.id)
        },
      )
      .subscribe()
  }

  async function refetchOne(id: string) {
    const { data } = await supabase
      .from('hospitals')
      .select(
        'id, name, trauma, stroke, pci_capable, maternal_level, nicu_level, is_pediatric, address, map_url, er_door_code, ems_room_code, no_door_code, notes, code_effective_from, active, door_code_updated_at, door_code_updated_by',
      )
      .eq('id', id)
      .maybeSingle()
    if (data) {
      hospitals.value = hospitals.value.map((h) =>
        h.id === id ? rowToHospital(data as HospitalRow) : h,
      )
    }
  }

  async function add(hospital: Hospital) {
    if (hospitals.value.some((h) => h.id === hospital.id)) {
      throw new Error(`A hospital with id "${hospital.id}" already exists`)
    }
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      hospitals.value = [...hospitals.value, hospital]
      return
    }
    const { error } = await supabase.from('hospitals').insert(hospitalToRowPatch(hospital))
    if (error) throw error
    hospitals.value = [...hospitals.value, hospital]
  }

  async function update(id: string, patch: Partial<Hospital>) {
    const before = hospitals.value
    hospitals.value = hospitals.value.map((h) => (h.id === id ? { ...h, ...patch } : h))
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    const dbPatch = hospitalToRowPatch(patch)
    if (Object.keys(dbPatch).length === 0) return
    const { error } = await supabase.from('hospitals').update(dbPatch).eq('id', id)
    if (error) {
      hospitals.value = before
      throw error
    }
    await refetchOne(id)
  }

  async function setActive(id: string, active: boolean) {
    await update(id, { active })
  }

  async function remove(id: string) {
    const before = hospitals.value
    hospitals.value = hospitals.value.filter((h) => h.id !== id)
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    const { error } = await supabase.from('hospitals').delete().eq('id', id)
    if (error) {
      hospitals.value = before
      throw error
    }
  }

  void init()

  return {
    hospitals,
    ready,
    activeHospitals,
    init,
    add,
    update,
    setActive,
    remove,
  }
})
