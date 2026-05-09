import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import seed from '@/data/hospitals.json'
import type { Hospital } from '@/types'

const STORAGE_KEY = 'wcems:hospitals'

/**
 * Hospitals store — same swappable shape as `useStationsStore`.
 *
 * Phase 1: localStorage-backed dev stub. Phase 2: replace `load`/`persist`
 * bodies with Supabase queries against the `hospitals` + `hospital_codes`
 * tables. The action surface (add/update/setActive/remove) does not change.
 */
function load(): Hospital[] {
  if (typeof localStorage === 'undefined') return JSON.parse(JSON.stringify(seed))
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Hospital[]
  } catch {
    /* ignore corrupt local copy */
  }
  return JSON.parse(JSON.stringify(seed))
}

function persist(hospitals: Hospital[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hospitals))
}

export const useHospitalsStore = defineStore('hospitals', () => {
  const hospitals = ref<Hospital[]>(load())
  watch(hospitals, (val) => persist(val), { deep: true })

  const activeHospitals = computed(() =>
    hospitals.value.filter((h) => h.active !== false),
  )

  function add(hospital: Hospital) {
    if (hospitals.value.some((h) => h.id === hospital.id)) {
      throw new Error(`A hospital with id "${hospital.id}" already exists`)
    }
    hospitals.value = [...hospitals.value, hospital]
  }

  function update(id: string, patch: Partial<Hospital>) {
    hospitals.value = hospitals.value.map((h) => (h.id === id ? { ...h, ...patch } : h))
  }

  function setActive(id: string, active: boolean) {
    update(id, { active })
  }

  function remove(id: string) {
    hospitals.value = hospitals.value.filter((h) => h.id !== id)
  }

  function resetToSeed() {
    hospitals.value = JSON.parse(JSON.stringify(seed))
  }

  return {
    hospitals,
    activeHospitals,
    add,
    update,
    setActive,
    remove,
    resetToSeed,
  }
})
