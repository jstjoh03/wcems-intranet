import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import seed from '@/data/stations.json'
import type { Station } from '@/types'

const STORAGE_KEY = 'wcems:stations'

/**
 * Stations store — mutable runtime copy of the seed data + localStorage
 * overrides so admin edits survive page reloads during the Phase 1 build.
 *
 * Phase 2: replace `load`/`persist` bodies with Supabase queries against
 * the `stations` table. The component contracts (the exposed refs +
 * action functions) do not change.
 */
function load(): Station[] {
  if (typeof localStorage === 'undefined') return JSON.parse(JSON.stringify(seed))
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Station[]
  } catch {
    /* ignore corrupt local copy */
  }
  return JSON.parse(JSON.stringify(seed))
}

function persist(stations: Station[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stations))
}

export const useStationsStore = defineStore('stations', () => {
  const stations = ref<Station[]>(load())

  watch(stations, (val) => persist(val), { deep: true })

  const activeStations = computed(() =>
    stations.value.filter((s) => s.active !== false).sort((a, b) => Number(a.id) - Number(b.id)),
  )
  const allStations = computed(() =>
    [...stations.value].sort((a, b) => Number(a.id) - Number(b.id)),
  )

  function add(station: Station) {
    if (stations.value.some((s) => s.id === station.id)) {
      throw new Error(`A station with id "${station.id}" already exists`)
    }
    stations.value = [...stations.value, station]
  }

  function update(id: string, patch: Partial<Station>) {
    stations.value = stations.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }

  function setActive(id: string, active: boolean) {
    update(id, { active })
  }

  function remove(id: string) {
    stations.value = stations.value.filter((s) => s.id !== id)
  }

  function resetToSeed() {
    stations.value = JSON.parse(JSON.stringify(seed))
  }

  return {
    stations,
    activeStations,
    allStations,
    add,
    update,
    setActive,
    remove,
    resetToSeed,
  }
})
