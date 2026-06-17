import { computed } from 'vue'
import { useStationsStore } from '@/stores/stations'
import { STATION_EXTRAS_TOP, STATION_EXTRAS_BOTTOM } from '@/constants/stations'

/**
 * Station options for self-edit selects (UserDropdown, UserProfileModal).
 *
 * Merges the static "extras" (S201, S202 buildings + EMS Admin tag)
 * with the live, admin-editable Medic units from the `stations`
 * table. Admin adds a new Medic on /admin/stations → it appears here
 * automatically (next page load, or realtime if the store is already
 * subscribed).
 *
 * Order: extras-top → live medics alphabetical → extras-bottom.
 * Deduped against the extras so a misconfigured DB row can't
 * accidentally clobber S201/S202/EMS Admin.
 */
export function useStationOptions() {
  const stationsStore = useStationsStore()
  void stationsStore.init()

  const options = computed<string[]>(() => {
    const extras = new Set<string>([...STATION_EXTRAS_TOP, ...STATION_EXTRAS_BOTTOM])
    const liveNames = stationsStore.stations
      .filter((s) => s.active && !extras.has(s.name))
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b))
    return [...STATION_EXTRAS_TOP, ...liveNames, ...STATION_EXTRAS_BOTTOM]
  })

  return { options }
}
