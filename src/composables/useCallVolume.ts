import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import seed from '@/data/call-volume.json'

/**
 * Call-volume data: monthly summary + per-unit + per-zone breakdowns.
 *
 * Real-session: backed by three tables — `call_volume_summaries`,
 * `call_volume_units`, `call_volume_zones`. Loaded once on first
 * import; saveMonth / deleteMonth update the local cache after a
 * successful round-trip so InsightsView stays in sync without a
 * reload.
 *
 * Dev-stub: reads the existing call-volume.json fixture so dev
 * iteration keeps working without a real session. Mutations in
 * dev-stub are in-memory only.
 *
 * Percentages are NOT stored — they're computed in the InsightsView
 * from raw runs / calls and the column sum, so they always reconcile
 * even when admins add or remove a row.
 */

export interface CallVolumeSummary {
  reportMonth: string
  totalCalls: number
  totalPatients: number
  totalTransports: number
  avgResponseSeconds: number
  /** Calls inside our service-area district. */
  callsInDistrict: number
  /** Calls outside our district (mutual aid, transports across county lines). */
  callsOutOfDistrict: number
  /** Unit Hour Utilization — decimal like 0.091. */
  unitHourUtilization: number
  /** Air transport handoffs (LZ assists). */
  airTransports: number
}

export interface CallVolumeUnit {
  reportMonth: string
  unitName: string
  runs: number
  /** Average response time for this unit, in seconds. 0 when not tracked. */
  avgResponseSeconds: number
}

export interface CallVolumeZone {
  reportMonth: string
  zoneName: string
  calls: number
}

interface SummaryRow {
  report_month: string
  total_calls: number
  total_patients: number
  total_transports: number
  avg_response_seconds: number
  calls_in_district: number
  calls_out_of_district: number
  unit_hour_utilization: number | string
  air_transports: number
}
interface UnitRow {
  report_month: string
  unit_name: string
  runs: number
  avg_response_seconds: number
}
interface ZoneRow {
  report_month: string
  zone_name: string
  calls: number
}

const summaries = ref<CallVolumeSummary[]>([])
const units = ref<CallVolumeUnit[]>([])
const zones = ref<CallVolumeZone[]>([])
const ready = ref(false)
let loadStarted = false

function summaryFromRow(r: SummaryRow): CallVolumeSummary {
  return {
    reportMonth: r.report_month,
    totalCalls: r.total_calls,
    totalPatients: r.total_patients,
    totalTransports: r.total_transports,
    avgResponseSeconds: r.avg_response_seconds,
    callsInDistrict: r.calls_in_district ?? 0,
    callsOutOfDistrict: r.calls_out_of_district ?? 0,
    /* Postgres numeric returns a string over PostgREST — coerce to Number. */
    unitHourUtilization: Number(r.unit_hour_utilization ?? 0),
    airTransports: r.air_transports ?? 0,
  }
}
function unitFromRow(r: UnitRow): CallVolumeUnit {
  return {
    reportMonth: r.report_month,
    unitName: r.unit_name,
    runs: r.runs,
    avgResponseSeconds: r.avg_response_seconds ?? 0,
  }
}
function zoneFromRow(r: ZoneRow): CallVolumeZone {
  return {
    reportMonth: r.report_month,
    zoneName: r.zone_name,
    calls: r.calls,
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub || !auth.appUser) {
    /* Dev-stub: hydrate straight from the fixture. JSON shape already
       matches CallVolumeSummary / CallVolumeUnit / CallVolumeZone since
       the migration 0024 cleanup, so no per-field remapping needed. */
    const data = seed as {
      summaries: CallVolumeSummary[]
      units: CallVolumeUnit[]
      zones: CallVolumeZone[]
    }
    summaries.value = data.summaries
    units.value = data.units.map((u) => ({ ...u, avgResponseSeconds: u.avgResponseSeconds ?? 0 }))
    zones.value = data.zones
    ready.value = true
    return
  }

  const [sumRes, unitRes, zoneRes] = await Promise.all([
    supabase
      .from('call_volume_summaries')
      .select(
        'report_month, total_calls, total_patients, total_transports, avg_response_seconds, calls_in_district, calls_out_of_district, unit_hour_utilization, air_transports',
      )
      .order('report_month'),
    supabase
      .from('call_volume_units')
      .select('report_month, unit_name, runs, avg_response_seconds')
      .order('report_month'),
    supabase
      .from('call_volume_zones')
      .select('report_month, zone_name, calls')
      .order('report_month'),
  ])
  if (sumRes.error) console.error('[call-volume] summaries load:', sumRes.error.message)
  if (unitRes.error) console.error('[call-volume] units load:', unitRes.error.message)
  if (zoneRes.error) console.error('[call-volume] zones load:', zoneRes.error.message)

  summaries.value = (sumRes.data ?? []).map((d) => summaryFromRow(d as SummaryRow))
  units.value = (unitRes.data ?? []).map((d) => unitFromRow(d as UnitRow))
  zones.value = (zoneRes.data ?? []).map((d) => zoneFromRow(d as ZoneRow))
  ready.value = true
}

export interface MonthSnapshot {
  summary: CallVolumeSummary
  units: CallVolumeUnit[]
  zones: CallVolumeZone[]
}

export function useCallVolume() {
  void load()

  const months = computed(() => {
    /* Union of every month with any data — summaries / units / zones
       so a partially-entered month still appears in the list. */
    const set = new Set<string>()
    for (const s of summaries.value) set.add(s.reportMonth)
    for (const u of units.value) set.add(u.reportMonth)
    for (const z of zones.value) set.add(z.reportMonth)
    return Array.from(set).sort()
  })

  function getMonth(month: string): MonthSnapshot {
    const summary: CallVolumeSummary = summaries.value.find(
      (s) => s.reportMonth === month,
    ) ?? {
      reportMonth: month,
      totalCalls: 0,
      totalPatients: 0,
      totalTransports: 0,
      avgResponseSeconds: 0,
      callsInDistrict: 0,
      callsOutOfDistrict: 0,
      unitHourUtilization: 0,
      airTransports: 0,
    }
    return {
      summary,
      units: units.value.filter((u) => u.reportMonth === month),
      zones: zones.value.filter((z) => z.reportMonth === month),
    }
  }

  /** Most recent month with any data — used as a template seed when
   *  admin adds a new month so they don't retype 8 unit + 16 zone
   *  rows from scratch. */
  function latestMonth(): string | null {
    const list = months.value
    return list.length > 0 ? list[list.length - 1] : null
  }

  async function saveMonth(input: {
    month: string
    summary: Omit<CallVolumeSummary, 'reportMonth'>
    units: Array<Omit<CallVolumeUnit, 'reportMonth'>>
    zones: Array<Omit<CallVolumeZone, 'reportMonth'>>
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const month = input.month
    if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) {
      return { ok: false, error: 'Month must be a date (YYYY-MM-DD).' }
    }
    /* Drop blank-named unit / zone rows — admins might leave an empty
       template row at the bottom of the form. */
    const cleanUnits = input.units
      .map((u) => ({ ...u, unitName: u.unitName.trim() }))
      .filter((u) => u.unitName.length > 0)
    const cleanZones = input.zones
      .map((z) => ({ ...z, zoneName: z.zoneName.trim() }))
      .filter((z) => z.zoneName.length > 0)

    const auth = useAuthStore()

    if (auth.usingDevStub) {
      summaries.value = [
        ...summaries.value.filter((s) => s.reportMonth !== month),
        { reportMonth: month, ...input.summary },
      ].sort((a, b) => a.reportMonth.localeCompare(b.reportMonth))
      units.value = [
        ...units.value.filter((u) => u.reportMonth !== month),
        ...cleanUnits.map((u) => ({ reportMonth: month, ...u })),
      ]
      zones.value = [
        ...zones.value.filter((z) => z.reportMonth !== month),
        ...cleanZones.map((z) => ({ reportMonth: month, ...z })),
      ]
      return { ok: true }
    }

    /* Real session — upsert summary, then replace the month's unit +
       zone rows. Replace (delete + insert) is simpler than diffing
       per-row, and the dataset is small. */
    const { error: sumErr } = await supabase
      .from('call_volume_summaries')
      .upsert({
        report_month: month,
        total_calls: input.summary.totalCalls,
        total_patients: input.summary.totalPatients,
        total_transports: input.summary.totalTransports,
        avg_response_seconds: input.summary.avgResponseSeconds,
        calls_in_district: input.summary.callsInDistrict,
        calls_out_of_district: input.summary.callsOutOfDistrict,
        unit_hour_utilization: input.summary.unitHourUtilization,
        air_transports: input.summary.airTransports,
      })
    if (sumErr) return { ok: false, error: `Summary save failed: ${sumErr.message}` }

    const { error: delUnitsErr } = await supabase
      .from('call_volume_units')
      .delete()
      .eq('report_month', month)
    if (delUnitsErr) return { ok: false, error: `Units clear failed: ${delUnitsErr.message}` }

    if (cleanUnits.length > 0) {
      const { error: insUnitsErr } = await supabase
        .from('call_volume_units')
        .insert(
          cleanUnits.map((u) => ({
            report_month: month,
            unit_name: u.unitName,
            runs: u.runs,
            avg_response_seconds: u.avgResponseSeconds,
          })),
        )
      if (insUnitsErr) return { ok: false, error: `Units save failed: ${insUnitsErr.message}` }
    }

    const { error: delZonesErr } = await supabase
      .from('call_volume_zones')
      .delete()
      .eq('report_month', month)
    if (delZonesErr) return { ok: false, error: `Zones clear failed: ${delZonesErr.message}` }

    if (cleanZones.length > 0) {
      const { error: insZonesErr } = await supabase
        .from('call_volume_zones')
        .insert(
          cleanZones.map((z) => ({
            report_month: month,
            zone_name: z.zoneName,
            calls: z.calls,
          })),
        )
      if (insZonesErr) return { ok: false, error: `Zones save failed: ${insZonesErr.message}` }
    }

    /* Patch local cache so the consumer (InsightsView) reflects the
       change without waiting for a reload. */
    summaries.value = [
      ...summaries.value.filter((s) => s.reportMonth !== month),
      { reportMonth: month, ...input.summary },
    ].sort((a, b) => a.reportMonth.localeCompare(b.reportMonth))
    units.value = [
      ...units.value.filter((u) => u.reportMonth !== month),
      ...cleanUnits.map((u) => ({ reportMonth: month, ...u })),
    ]
    zones.value = [
      ...zones.value.filter((z) => z.reportMonth !== month),
      ...cleanZones.map((z) => ({ reportMonth: month, ...z })),
    ]
    return { ok: true }
  }

  async function deleteMonth(month: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      summaries.value = summaries.value.filter((s) => s.reportMonth !== month)
      units.value = units.value.filter((u) => u.reportMonth !== month)
      zones.value = zones.value.filter((z) => z.reportMonth !== month)
      return { ok: true }
    }
    const [s, u, z] = await Promise.all([
      supabase.from('call_volume_summaries').delete().eq('report_month', month),
      supabase.from('call_volume_units').delete().eq('report_month', month),
      supabase.from('call_volume_zones').delete().eq('report_month', month),
    ])
    if (s.error || u.error || z.error) {
      return {
        ok: false,
        error: s.error?.message ?? u.error?.message ?? z.error?.message ?? 'Delete failed',
      }
    }
    summaries.value = summaries.value.filter((s) => s.reportMonth !== month)
    units.value = units.value.filter((u) => u.reportMonth !== month)
    zones.value = zones.value.filter((z) => z.reportMonth !== month)
    return { ok: true }
  }

  return {
    ready,
    summaries,
    units,
    zones,
    months,
    getMonth,
    latestMonth,
    saveMonth,
    deleteMonth,
  }
}
