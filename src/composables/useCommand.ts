import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Command module — shift handoff notes, the fleet list, and the native
 * Supervisor Daily Summary (replaces the Jotform, 2026-11-04).
 *
 * Access = command staff = is_supervisor() on the database side (role
 * supervisor OR admin): Chief, Assistant Chief, CDO, Rhonda B, April M
 * and every shift supervisor. RLS enforces it; the views gate on
 * auth.isSupervisor for the UX.
 */

export interface CommandNote {
  id: string
  authorId: string
  authorName: string
  note: string
  pinned: boolean
  createdAt: string
}

export interface FleetVehicle {
  id: string
  label: string
  sort: number
  active: boolean
}

export type SummarySide = 'north' | 'south' | 'all'

/** One supervisor row — more than one when a sup worked a partial
 *  shift and someone else covered the rest. */
export interface SummarySupervisor {
  name: string
  /** HH:MM, only set for partial-shift rows. */
  from?: string
  until?: string
}

export interface LateCallRow {
  incident: string
  reason: string
}

export interface CrewSlot {
  ic: string
  at: string
  third: string
  /** Which cells were hand-corrected after the schedule pre-fill. */
  edited?: string[]
}

export interface UnitSection {
  /** AM = the 0600–1800 half, PM = 1800–0600. */
  am: CrewSlot
  pm: CrewSlot
  /** NEOP/3rd row only renders when a rider exists (add-button). */
  hasThird: boolean
  calls: { post: number | null; transport: number | null; non: number | null }
}

export interface FleetStatusRow {
  status: 'in_service' | 'oos'
  location: string
  pstrax: boolean
  notes: string
}

export interface DowntimeBlock {
  used: boolean
  unit: string
  from: string
  until: string
  reason: string
}

export interface SummaryData {
  supervisors: SummarySupervisor[]
  units: Record<string, UnitSection>
  fleet: Record<string, FleetStatusRow>
  downtime: { first: DowntimeBlock; second: DowntimeBlock }
  esd: {
    postedForUs: { answer: boolean; agency: string; details: string }
    wePosted: { answer: boolean; agency: string; details: string }
    lateCalls: { answer: boolean; rows: LateCallRow[] }
  }
  notes: { equipment: string; personnel: string; supplies: string; other: string }
}

export interface DailySummary {
  id: string
  shiftDate: string
  side: SummarySide
  shiftLetter: string | null
  supervisorId: string | null
  chartAudits: number | null
  data: SummaryData
  status: 'draft' | 'submitted'
  submittedAt: string | null
  pdfPath: string | null
  updatedAt: string
}

export function emptyCrewSlot(): CrewSlot {
  return { ic: '', at: '', third: '' }
}

export function emptySummaryData(): SummaryData {
  return {
    supervisors: [{ name: '' }],
    units: {},
    fleet: {},
    downtime: {
      first: { used: false, unit: '', from: '', until: '', reason: '' },
      second: { used: false, unit: '', from: '', until: '', reason: '' },
    },
    esd: {
      postedForUs: { answer: false, agency: '', details: '' },
      wePosted: { answer: false, agency: '', details: '' },
      lateCalls: { answer: false, rows: [] },
    },
    notes: { equipment: '', personnel: '', supplies: '', other: '' },
  }
}

const SUMMARY_COLUMNS =
  'id, shift_date, side, shift_letter, supervisor_id, chart_audits, data, status, submitted_at, pdf_path, updated_at'

interface SummaryRow {
  id: string
  shift_date: string
  side: SummarySide
  shift_letter: string | null
  supervisor_id: string | null
  chart_audits: number | null
  data: SummaryData
  status: 'draft' | 'submitted'
  submitted_at: string | null
  pdf_path: string | null
  updated_at: string
}

function fromRow(r: SummaryRow): DailySummary {
  return {
    id: r.id,
    shiftDate: r.shift_date,
    side: r.side,
    shiftLetter: r.shift_letter,
    supervisorId: r.supervisor_id,
    chartAudits: r.chart_audits,
    data: { ...emptySummaryData(), ...(r.data ?? {}) },
    status: r.status,
    submittedAt: r.submitted_at,
    pdfPath: r.pdf_path,
    updatedAt: r.updated_at,
  }
}

/* ── module-singleton state ───────────────────────────────────────── */
const ready = ref(false)
const notes = ref<CommandNote[]>([])
/** Every vehicle incl. archived — the admin fleet editor needs both. */
const fleetAll = ref<FleetVehicle[]>([])
const fleet = computed<FleetVehicle[]>(() => fleetAll.value.filter((f) => f.active))
const summaries = ref<DailySummary[]>([])
const loadError = ref<string | null>(null)
let loadStarted = false

export function useCommand() {
  const auth = useAuthStore()
  const isLive = computed(() => !auth.usingDevStub)

  async function load(): Promise<void> {
    if (loadStarted) return
    loadStarted = true

    if (!isLive.value) {
      /* Dev fixtures — the page renders signed-out; writes error. */
      fleetAll.value = [
        '8751', '9238', '0081', '8237', '8744', '8750',
        'Vannie Mae', '2795', '2793', '0379', '8665', '2794',
      ].map((label, i) => ({ id: `dev-f-${i}`, label, sort: (i + 1) * 10, active: true }))
      notes.value = [
        { id: 'dev-n-1', authorId: 'dev-1', authorName: 'Rhonda Getschman', note: 'Burn ban in effect county-wide — expect brush-fire standbys with WCFD.', pinned: true, createdAt: new Date(Date.now() - 5 * 864e5).toISOString() },
        { id: 'dev-n-2', authorId: 'dev-2', authorName: 'Sample Supervisor', note: '8237 pulling right under braking — PSTrax ticket in, shop appt Thursday. Spare only.', pinned: false, createdAt: new Date(Date.now() - 6 * 36e5).toISOString() },
      ]
      const dd = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
      const devData = emptySummaryData()
      devData.supervisors = [{ name: 'Sample Supervisor' }]
      devData.esd.lateCalls = { answer: true, rows: [{ incident: '26-058704', reason: 'both units committed on transfers' }] }
      devData.fleet = { '8237': { status: 'oos', location: 'Shop', pstrax: true, notes: 'brakes — Thursday appt' } }
      summaries.value = [
        { id: 'dev-s-1', shiftDate: dd, side: 'south', shiftLetter: 'B', supervisorId: 'dev-2', chartAudits: 10, data: devData, status: 'submitted', submittedAt: new Date().toISOString(), pdfPath: null, updatedAt: new Date().toISOString() },
      ]
      ready.value = true
      return
    }

    const [nRes, fRes, sRes] = await Promise.all([
      supabase
        .from('command_notes')
        .select('id, author_id, note, pinned, created_at, author:app_users!command_notes_author_id_fkey(full_name)')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60),
      supabase.from('command_fleet').select('id, label, sort, active').order('sort'),
      supabase
        .from('sup_daily_summaries')
        .select(SUMMARY_COLUMNS)
        .order('shift_date', { ascending: false })
        .limit(400),
    ])
    const err = nRes.error ?? fRes.error ?? sRes.error
    if (err) {
      loadError.value = err.message
      ready.value = true
      return
    }
    notes.value = (nRes.data ?? []).map((r) => ({
      id: r.id,
      authorId: r.author_id,
      authorName: (r.author as unknown as { full_name: string } | null)?.full_name ?? 'Command staff',
      note: r.note,
      pinned: r.pinned,
      createdAt: r.created_at,
    }))
    fleetAll.value = fRes.data ?? []
    summaries.value = ((sRes.data ?? []) as SummaryRow[]).map(fromRow)
    ready.value = true
  }

  /* ── handoff notes ───────────────────────────────────────────────── */
  async function addNote(text: string): Promise<string | null> {
    const uid = auth.appUser?.id
    if (!uid || !text.trim()) return 'Nothing to post.'
    if (!isLive.value) return 'Not available in the dev preview.'
    const { data, error } = await supabase
      .from('command_notes')
      .insert({ author_id: uid, note: text.trim() })
      .select('id, author_id, note, pinned, created_at')
      .single()
    if (error) return error.message
    notes.value = [
      { id: data.id, authorId: data.author_id, authorName: auth.appUser?.fullName ?? 'Me', note: data.note, pinned: data.pinned, createdAt: data.created_at },
      ...notes.value,
    ]
    return null
  }

  async function deleteNote(id: string): Promise<string | null> {
    if (!isLive.value) return 'Not available in the dev preview.'
    const { error } = await supabase.from('command_notes').delete().eq('id', id)
    if (error) return error.message
    notes.value = notes.value.filter((n) => n.id !== id)
    return null
  }

  async function togglePin(n: CommandNote): Promise<string | null> {
    if (!isLive.value) return 'Not available in the dev preview.'
    const { error } = await supabase
      .from('command_notes')
      .update({ pinned: !n.pinned, updated_at: new Date().toISOString() })
      .eq('id', n.id)
    if (error) return error.message
    n.pinned = !n.pinned
    notes.value = [...notes.value].sort((a, b) =>
      a.pinned === b.pinned ? b.createdAt.localeCompare(a.createdAt) : a.pinned ? -1 : 1,
    )
    return null
  }

  /* ── fleet editor (admins; in-app, never the backend) ────────────── */
  async function addFleetVehicle(label: string): Promise<string | null> {
    const clean = label.trim()
    if (!clean) return 'Enter the vehicle number or name.'
    if (!isLive.value) return 'Not available in the dev preview.'
    if (fleetAll.value.some((f) => f.label.toLowerCase() === clean.toLowerCase()))
      return 'That vehicle is already on the list (restore it if archived).'
    const sort = Math.max(0, ...fleetAll.value.map((f) => f.sort)) + 10
    const { data, error } = await supabase
      .from('command_fleet')
      .insert({ label: clean, sort })
      .select('id, label, sort, active')
      .single()
    if (error) return error.message
    fleetAll.value = [...fleetAll.value, data].sort((a, b) => a.sort - b.sort)
    return null
  }

  async function setFleetActive(id: string, active: boolean): Promise<string | null> {
    if (!isLive.value) return 'Not available in the dev preview.'
    const { error } = await supabase.from('command_fleet').update({ active }).eq('id', id)
    if (error) return error.message
    fleetAll.value = fleetAll.value.map((f) => (f.id === id ? { ...f, active } : f))
    return null
  }

  /* ── daily summaries ─────────────────────────────────────────────── */
  function summaryFor(shiftDate: string, side: SummarySide): DailySummary | null {
    return summaries.value.find((s) => s.shiftDate === shiftDate && s.side === side) ?? null
  }

  /** The side's status for a date — an 'all' (county-wide) summary
   *  covers both sides. */
  function coverageFor(shiftDate: string, side: 'north' | 'south'): DailySummary | null {
    return (
      summaries.value.find(
        (s) => s.shiftDate === shiftDate && (s.side === side || s.side === 'all') && s.status === 'submitted',
      ) ?? null
    )
  }

  async function saveDraft(input: {
    id?: string
    shiftDate: string
    side: SummarySide
    shiftLetter: string | null
    chartAudits: number | null
    data: SummaryData
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (!isLive.value) return { ok: true, id: input.id ?? 'dev-draft' }
    const { data, error } = await supabase
      .from('sup_daily_summaries')
      .upsert(
        {
          shift_date: input.shiftDate,
          side: input.side,
          shift_letter: input.shiftLetter,
          supervisor_id: uid,
          chart_audits: input.chartAudits,
          data: input.data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shift_date,side' },
      )
      .select(SUMMARY_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as SummaryRow)
    summaries.value = [row, ...summaries.value.filter((s) => s.id !== row.id)]
    return { ok: true, id: row.id }
  }

  /** Submit: upload the letterhead PDF, stamp the row, then ask the
   *  edge function to email it to every supervisor (Jotform parity). */
  async function submitSummary(
    id: string,
    pdfBlob: Blob,
  ): Promise<{ ok: true; emailed: number } | { ok: false; error: string }> {
    if (!isLive.value) return { ok: false, error: 'Not available in the dev preview.' }
    const row = summaries.value.find((s) => s.id === id)
    if (!row) return { ok: false, error: 'Save the draft first.' }

    const path = `${row.shiftDate.slice(0, 4)}/${row.shiftDate}_${row.side}.pdf`
    const up = await supabase.storage
      .from('daily-summaries')
      .upload(path, pdfBlob, { contentType: 'application/pdf', upsert: true })
    if (up.error) return { ok: false, error: `PDF upload failed: ${up.error.message}` }

    const { data, error } = await supabase
      .from('sup_daily_summaries')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), pdf_path: path })
      .eq('id', id)
      .select(SUMMARY_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const updated = fromRow(data as SummaryRow)
    summaries.value = [updated, ...summaries.value.filter((s) => s.id !== updated.id)]

    /* Email the PDF to all supervisors — failure here never un-submits;
       the archive keeps the PDF either way. */
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const base = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${base}/functions/v1/daily-summary-notify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryId: id }),
      })
      const out = await res.json()
      if (!out.ok) return { ok: true, emailed: -1 }
      return { ok: true, emailed: Number(out.sent ?? 0) }
    } catch {
      return { ok: true, emailed: -1 }
    }
  }

  async function pdfUrl(path: string): Promise<string | null> {
    if (!isLive.value) return null
    const { data } = await supabase.storage.from('daily-summaries').createSignedUrl(path, 300)
    return data?.signedUrl ?? null
  }

  return {
    ready,
    loadError,
    notes,
    fleet,
    fleetAll,
    addFleetVehicle,
    setFleetActive,
    summaries,
    load,
    addNote,
    deleteNote,
    togglePin,
    summaryFor,
    coverageFor,
    saveDraft,
    submitSummary,
    pdfUrl,
  }
}
