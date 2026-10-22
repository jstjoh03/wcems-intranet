import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Per-date corrections to the schedule-derived training-day ledger
 * (ftep_day_overrides): force-count an edge case (e.g. a legitimate
 * training day with no FTO pairing on the schedule) or exclude a day
 * that shouldn't count (e.g. rode as a third). One row per record+date;
 * editors write, the trainee's visibility circle reads. The timeline
 * builder applies these after its schedule pass, so totals and the
 * eligibility projections recompute immediately.
 *
 * Module-level singleton per house convention.
 */

export interface FtepDayOverride {
  id: string
  recordId: string
  onDate: string
  counts: boolean
  reason: string
}

const overrides = ref<FtepDayOverride[]>([])
const ready = ref(false)
let loadStarted = false
let loadPromise: Promise<void> | null = null

async function load() {
  if (loadStarted) return loadPromise ?? undefined
  loadStarted = true
  loadPromise = doLoad()
  return loadPromise
}

async function doLoad() {
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('ftep_day_overrides')
    .select('id, record_id, on_date, counts, reason')
  if (error) console.error('[ftep-overrides] load:', error.message)
  overrides.value = (data ?? []).map((r) => ({
    id: r.id as string,
    recordId: r.record_id as string,
    onDate: r.on_date as string,
    counts: r.counts as boolean,
    reason: (r.reason ?? '') as string,
  }))
  ready.value = true
}

export function useFtepDayOverrides() {
  const auth = useAuthStore()
  void load()

  /** Await the first load — the timeline builder needs rows in hand. */
  async function ensureLoaded() {
    await load()
  }

  function overridesFor(recordId: string): FtepDayOverride[] {
    return overrides.value.filter((o) => o.recordId === recordId)
  }

  /** Upsert one date's correction (editors only — RLS enforces). */
  async function setOverride(
    recordId: string,
    onDate: string,
    counts: boolean,
    reason: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) {
      overrides.value = [
        ...overrides.value.filter((o) => !(o.recordId === recordId && o.onDate === onDate)),
        { id: `dev-${Date.now()}`, recordId, onDate, counts, reason },
      ]
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('ftep_day_overrides')
      .upsert(
        {
          record_id: recordId,
          on_date: onDate,
          counts,
          reason: reason.trim(),
          created_by: auth.appUser?.id ?? null,
        },
        { onConflict: 'record_id,on_date' },
      )
      .select('id, record_id, on_date, counts, reason')
      .single()
    if (error) return { ok: false, error: error.message }
    const row: FtepDayOverride = {
      id: data.id as string,
      recordId: data.record_id as string,
      onDate: data.on_date as string,
      counts: data.counts as boolean,
      reason: (data.reason ?? '') as string,
    }
    overrides.value = [
      ...overrides.value.filter((o) => !(o.recordId === recordId && o.onDate === onDate)),
      row,
    ]
    return { ok: true }
  }

  /** Remove a correction — the day falls back to its schedule-derived state. */
  async function clearOverride(
    recordId: string,
    onDate: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!auth.usingDevStub) {
      const { error } = await supabase
        .from('ftep_day_overrides')
        .delete()
        .match({ record_id: recordId, on_date: onDate })
      if (error) return { ok: false, error: error.message }
    }
    overrides.value = overrides.value.filter(
      (o) => !(o.recordId === recordId && o.onDate === onDate),
    )
    return { ok: true }
  }

  return { ready, overrides, overridesFor, ensureLoaded, setOverride, clearOverride }
}
