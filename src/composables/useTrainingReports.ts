import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Monthly Training & Education Report — the board-meeting report,
 * assembled the way the old spreadsheet was filled in by hand:
 *
 *   AUTO rows    every course session in the month (not canceled), its
 *                attendance split in-person / virtual from check-ins.
 *   MANUAL rows  courses the app never saw (1-on-1s, outside-hosted
 *                classes), kept in training_monthly_report_entries.
 *   OVERRIDES    an entry with session_id set decorates an auto row:
 *                its notes always show; non-null counts replace what
 *                attendance says (e.g. "virtual count unavailable").
 *
 * Filing freezes the assembled rows + summary into the report row's
 * jsonb snapshot, so the archived report never drifts when attendance
 * is edited later. A filed month can be reopened and re-filed.
 */

export interface ReportRow {
  key: string
  on: string // YYYY-MM-DD ('' allowed on manual rows with no date yet)
  title: string
  inPerson: number | null
  virtual: number | null
  total: number | null
  notes: string
  source: 'auto' | 'manual'
  sessionId?: string
  entryId?: string
}

export interface ReportSummary {
  trainings: number
  inPerson: number
  virtual: number
  total: number
}

export interface MonthReport {
  month: string // YYYY-MM-01
  status: 'building' | 'filed'
  rows: ReportRow[]
  summary: ReportSummary
  filedByName: string | null
  filedAt: string | null
}

export interface ArchiveItem {
  month: string
  status: 'building' | 'filed'
  trainings: number
  total: number
  filedByName: string | null
  filedAt: string | null
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return monthKey(new Date(y, m, 1))
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  return monthKey(new Date(y, m - 1 + by, 1))
}

function summarize(rows: ReportRow[]): ReportSummary {
  return {
    trainings: rows.length,
    inPerson: rows.reduce((n, r) => n + (r.inPerson ?? 0), 0),
    virtual: rows.reduce((n, r) => n + (r.virtual ?? 0), 0),
    total: rows.reduce((n, r) => n + (r.total ?? 0), 0),
  }
}

const DEV_ROWS: ReportRow[] = [
  { key: 'd1', on: '2026-11-04', title: 'ACLS Renewal', inPerson: 6, virtual: null, total: 6, notes: '', source: 'auto', sessionId: 'SES-DEV1' },
  { key: 'd2', on: '2026-11-14', title: 'Cardiology & 12-Lead Recognition', inPerson: 5, virtual: 13, total: 18, notes: 'Virtual via Teams', source: 'auto', sessionId: 'SES-DEV2' },
  { key: 'd3', on: '2026-11-18', title: 'Needle Cricothyrotomy Lab', inPerson: 28, virtual: null, total: 28, notes: 'Two labs combined; one roster', source: 'auto', sessionId: 'SES-DEV3' },
  { key: 'd4', on: '2026-11-20', title: '1-on-1 Training: Documentation', inPerson: 1, virtual: null, total: 1, notes: '', source: 'manual', entryId: 'dev-e1' },
]

export function useTrainingReports() {
  const auth = useAuthStore()
  const loading = ref(false)
  const error = ref<string | null>(null)

  const currentMonth = monthKey(new Date())

  /** Assemble one month live: auto rows from sessions + attendance,
   *  manual rows and overrides from the entries table. */
  async function assembleMonth(month: string): Promise<ReportRow[]> {
    if (auth.usingDevStub) return month === currentMonth ? [...DEV_ROWS] : []

    const [sess, ents] = await Promise.all([
      supabase
        .from('course_sessions')
        .select('session_id, title, lecture_title, card_course_name, class_date, status')
        .gte('class_date', month)
        .lt('class_date', nextMonth(month))
        .neq('status', 'Canceled')
        .order('class_date'),
      supabase
        .from('training_monthly_report_entries')
        .select('id, session_id, happened_on, title, in_person, virtual, notes')
        .eq('month', month)
        .order('happened_on'),
    ])
    if (sess.error) throw new Error(sess.error.message)
    if (ents.error) throw new Error(ents.error.message)

    const sessions = (sess.data ?? []) as {
      session_id: string
      title: string | null
      lecture_title: string | null
      card_course_name: string | null
      class_date: string
    }[]

    /* One attendance pull for the month's sessions, counted client-side
       (a month holds a handful of classes, not thousands of rows). */
    const counts = new Map<string, { inPerson: number; virtual: number }>()
    if (sessions.length) {
      const { data: att, error: attErr } = await supabase
        .from('training_attendance')
        .select('session_id, attendance_mode, status, phase')
        .in('session_id', sessions.map((s) => s.session_id))
      if (attErr) throw new Error(attErr.message)
      for (const a of (att ?? []) as { session_id: string; attendance_mode: string; status: string; phase: string }[]) {
        if (a.phase !== 'checkedin' || a.status === 'Pending') continue
        const c = counts.get(a.session_id) ?? { inPerson: 0, virtual: 0 }
        if (a.attendance_mode === 'Virtual') c.virtual++
        else c.inPerson++
        counts.set(a.session_id, c)
      }
    }

    type Entry = {
      id: string
      session_id: string | null
      happened_on: string | null
      title: string
      in_person: number | null
      virtual: number | null
      notes: string
    }
    const entries = (ents.data ?? []) as Entry[]
    const overrides = new Map(entries.filter((e) => e.session_id).map((e) => [e.session_id as string, e]))

    const rows: ReportRow[] = sessions.map((s) => {
      const c = counts.get(s.session_id) ?? { inPerson: 0, virtual: 0 }
      const ov = overrides.get(s.session_id)
      const inPerson = ov && ov.in_person !== null ? ov.in_person : c.inPerson || null
      const virtual = ov && ov.virtual !== null ? ov.virtual : c.virtual || null
      return {
        key: `s-${s.session_id}`,
        on: s.class_date,
        title: s.title || s.lecture_title || s.card_course_name || 'Training session',
        inPerson,
        virtual,
        total: inPerson === null && virtual === null ? null : (inPerson ?? 0) + (virtual ?? 0),
        notes: ov?.notes ?? '',
        source: 'auto',
        sessionId: s.session_id,
        entryId: ov?.id,
      }
    })

    for (const e of entries) {
      if (e.session_id) continue
      const total = e.in_person === null && e.virtual === null ? null : (e.in_person ?? 0) + (e.virtual ?? 0)
      rows.push({
        key: `e-${e.id}`,
        on: e.happened_on ?? '',
        title: e.title,
        inPerson: e.in_person,
        virtual: e.virtual,
        total,
        notes: e.notes,
        source: 'manual',
        entryId: e.id,
      })
    }
    rows.sort((a, b) => (a.on || '9999').localeCompare(b.on || '9999'))
    return rows
  }

  async function filedByNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))]
    if (!want.length) return new Map()
    const { data } = await supabase.from('app_users').select('id, full_name').in('id', want)
    return new Map(((data ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]))
  }

  /** One month, for the builder: a filed month serves its snapshot. */
  async function loadMonth(month: string): Promise<MonthReport> {
    loading.value = true
    error.value = null
    try {
      if (auth.usingDevStub) {
        const rows = await assembleMonth(month)
        return { month, status: 'building', rows, summary: summarize(rows), filedByName: null, filedAt: null }
      }
      const { data: rep, error: rErr } = await supabase
        .from('training_monthly_reports')
        .select('month, status, snapshot, filed_by, filed_at')
        .eq('month', month)
        .maybeSingle()
      if (rErr) throw new Error(rErr.message)
      if (rep?.status === 'filed' && rep.snapshot) {
        const snap = rep.snapshot as { rows: ReportRow[]; summary: ReportSummary }
        const names = await filedByNames([rep.filed_by])
        return {
          month,
          status: 'filed',
          rows: snap.rows ?? [],
          summary: snap.summary ?? summarize(snap.rows ?? []),
          filedByName: rep.filed_by ? (names.get(rep.filed_by) ?? null) : null,
          filedAt: rep.filed_at ?? null,
        }
      }
      const rows = await assembleMonth(month)
      return { month, status: 'building', rows, summary: summarize(rows), filedByName: null, filedAt: null }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  /** Add a manual course, or an override for one auto session row. */
  async function saveEntry(month: string, fields: {
    id?: string
    sessionId?: string | null
    happenedOn?: string | null
    title?: string
    inPerson: number | null
    virtual: number | null
    notes: string
  }): Promise<void> {
    if (auth.usingDevStub) return
    const row = {
      month,
      session_id: fields.sessionId ?? null,
      happened_on: fields.happenedOn ?? null,
      title: fields.title ?? '',
      in_person: fields.inPerson,
      virtual: fields.virtual,
      notes: fields.notes,
      created_by: auth.appUser?.id ?? null,
    }
    const q = fields.id
      ? supabase.from('training_monthly_report_entries').update(row).eq('id', fields.id)
      : supabase.from('training_monthly_report_entries').insert(row)
    const { error: e } = await q
    if (e) throw new Error(e.message)
  }

  async function removeEntry(id: string): Promise<void> {
    if (auth.usingDevStub) return
    const { error: e } = await supabase.from('training_monthly_report_entries').delete().eq('id', id)
    if (e) throw new Error(e.message)
  }

  /** File the month: freeze what's on screen into the snapshot. */
  async function fileMonth(month: string, rows: ReportRow[]): Promise<void> {
    if (auth.usingDevStub) return
    const { error: e } = await supabase.from('training_monthly_reports').upsert(
      {
        month,
        status: 'filed',
        snapshot: { rows, summary: summarize(rows) },
        filed_by: auth.appUser?.id ?? null,
        filed_at: new Date().toISOString(),
      },
      { onConflict: 'month' },
    )
    if (e) throw new Error(e.message)
  }

  async function reopenMonth(month: string): Promise<void> {
    if (auth.usingDevStub) return
    const { error: e } = await supabase
      .from('training_monthly_reports')
      .update({ status: 'building' })
      .eq('month', month)
    if (e) throw new Error(e.message)
  }

  /** The archive: every filed month, newest first. */
  async function loadArchive(): Promise<ArchiveItem[]> {
    if (auth.usingDevStub) {
      return [
        { month: '2026-10-01', status: 'filed', trainings: 9, total: 67, filedByName: 'Justin St John', filedAt: '2026-11-01T14:00:00Z' },
        { month: '2026-09-01', status: 'filed', trainings: 12, total: 88, filedByName: 'Heather Fojt', filedAt: '2026-10-02T13:00:00Z' },
      ]
    }
    const { data, error: e } = await supabase
      .from('training_monthly_reports')
      .select('month, status, snapshot, filed_by, filed_at')
      .order('month', { ascending: false })
    if (e) throw new Error(e.message)
    const reps = (data ?? []) as {
      month: string
      status: 'building' | 'filed'
      snapshot: { rows?: ReportRow[]; summary?: ReportSummary } | null
      filed_by: string | null
      filed_at: string | null
    }[]
    const names = await filedByNames(reps.map((r) => r.filed_by))
    return reps.map((r) => ({
      month: r.month,
      status: r.status,
      trainings: r.snapshot?.summary?.trainings ?? r.snapshot?.rows?.length ?? 0,
      total: r.snapshot?.summary?.total ?? 0,
      filedByName: r.filed_by ? (names.get(r.filed_by) ?? null) : null,
      filedAt: r.filed_at,
    }))
  }

  /** Search inside filed reports: class names and notes. */
  async function searchArchive(q: string): Promise<{ month: string; row: ReportRow }[]> {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    if (auth.usingDevStub) {
      return DEV_ROWS.filter(
        (r) => r.title.toLowerCase().includes(needle) || r.notes.toLowerCase().includes(needle),
      ).map((row) => ({ month: currentMonth, row }))
    }
    const { data, error: e } = await supabase
      .from('training_monthly_reports')
      .select('month, snapshot')
      .eq('status', 'filed')
      .order('month', { ascending: false })
    if (e) throw new Error(e.message)
    const hits: { month: string; row: ReportRow }[] = []
    for (const r of (data ?? []) as { month: string; snapshot: { rows?: ReportRow[] } | null }[]) {
      for (const row of r.snapshot?.rows ?? []) {
        if (row.title.toLowerCase().includes(needle) || (row.notes ?? '').toLowerCase().includes(needle)) {
          hits.push({ month: r.month, row })
        }
      }
    }
    return hits
  }

  return {
    loading,
    error,
    currentMonth,
    loadMonth,
    assembleMonth,
    summarize,
    saveEntry,
    removeEntry,
    fileMonth,
    reopenMonth,
    loadArchive,
    searchArchive,
  }
}
