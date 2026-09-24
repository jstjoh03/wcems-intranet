<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import ScheduleLeaveSection from './ScheduleLeaveSection.vue'
import {
  useSchedule,
  todayCentralIso,
  addDaysIso,
  payPeriodFor,
  payPeriodList,
  holidayName,
  personSortKey,
  OFF_LABELS,
  type PayPeriod,
  type TimeSegment,
} from '@/composables/useSchedule'

/**
 * Scheduled Time — the payroll verification report. Member-subtotaled
 * hours for any window (day / week / month / pay period / custom) with
 * per-person drill-down, CSV + print, and — for a pay period — the
 * punch verification table and the Paycom timecard-import CSV
 * (no header, 17 columns, ID/OD punch rows per merged shift segment).
 */

const sched = useSchedule()

/* Two audiences, one tab. Supervisors get the schedule-accuracy half —
   hours summary, per-day drill-down, punch review — because verifying
   the schedule matches reality is their duty. The payroll flow (CSV,
   Paycom export, earning codes, EE codes) stays editor-only. */
const payrollAccess = computed(() => sched.canEdit.value || sched.isHr.value)

// ── range controls ───────────────────────────────────────────────────

type Preset = 'day' | 'week' | 'month' | 'period' | 'custom'
const preset = ref<Preset>('period')
const anchor = ref(todayCentralIso())
const monthAnchor = ref(todayCentralIso().slice(0, 7))
const periods = ref<PayPeriod[]>(payPeriodList(todayCentralIso(), 6, 3))
const periodStart = ref(payPeriodFor(todayCentralIso()).start)
const customStart = ref(payPeriodFor(todayCentralIso()).start)
const customEnd = ref(todayCentralIso())

const range = computed(() => {
  if (preset.value === 'day') return { start: anchor.value, end: anchor.value }
  if (preset.value === 'week') {
    const d = new Date(`${anchor.value}T00:00:00`)
    const start = addDaysIso(anchor.value, -d.getDay())
    return { start, end: addDaysIso(start, 6) }
  }
  if (preset.value === 'month') {
    const first = `${monthAnchor.value}-01`
    const endD = new Date(`${first}T00:00:00`)
    endD.setMonth(endD.getMonth() + 1)
    endD.setDate(0)
    return {
      start: first,
      end: `${monthAnchor.value}-${String(endD.getDate()).padStart(2, '0')}`,
    }
  }
  if (preset.value === 'period') {
    const p = periods.value.find((x) => x.start === periodStart.value) ?? periods.value[0]
    return { start: p.start, end: p.end }
  }
  return {
    start: customStart.value <= customEnd.value ? customStart.value : customEnd.value,
    end: customStart.value <= customEnd.value ? customEnd.value : customStart.value,
  }
})

const rangeLabel = computed(() => {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return range.value.start === range.value.end
    ? fmt(range.value.start)
    : `${fmt(range.value.start)} – ${fmt(range.value.end)}`
})

// ── data ─────────────────────────────────────────────────────────────

const segs = ref<TimeSegment[]>([])
const busy = ref(false)
const err = ref<string | null>(null)

async function load() {
  busy.value = true
  // settings ride along fresh so earning codes saved on another device
  // reach this session's Paycom export without a reload
  const [res] = await Promise.all([
    sched.fetchTimeSegments(range.value.start, range.value.end),
    sched.reloadSettings(),
  ])
  busy.value = false
  err.value = res.error
  segs.value = res.segs
}

onMounted(async () => {
  await sched.ensureLoaded()
  await load()
})

watch(range, () => void load())
// board changed elsewhere (own edits or realtime) → keep the report live
watch(sched.entries, () => void load())

// ── filters ──────────────────────────────────────────────────────────

const memberFilter = ref('')
const typeFilter = ref('')

/** WORKED coverage only — time-off segments ride along solely for the
 *  Paycom export and never count as worked hours anywhere. */
const worked = computed(() => segs.value.filter((s) => s.kind !== 'timeoff'))

const filtered = computed(() =>
  worked.value.filter(
    (s) =>
      (!memberFilter.value || s.userId === memberFilter.value) &&
      (!typeFilter.value || s.timeType === typeFilter.value),
  ),
)

// ── member summary ───────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Paycom sorts people by LAST name — every list here follows suit
 *  (personSortKey handles multi-word surnames like St John). */
function byLast(a: string, b: string): number {
  return personSortKey(a).localeCompare(personSortKey(b))
}

function weekStartFor(iso: string): string {
  return addDaysIso(iso, -new Date(`${iso}T00:00:00`).getDay())
}

interface MemberRow {
  userId: string
  name: string
  credential: string | null
  code: string | null
  days: number
  regular: number
  instructor: number
  meeting: number
  holiday: number // double-time hours worked on observed holidays
  total: number
  ot: number
}

const summary = computed<MemberRow[]>(() => {
  const t = sched.warningThresholds()
  const byUser = new Map<string, TimeSegment[]>()
  for (const s of filtered.value) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, [])
    byUser.get(s.userId)!.push(s)
  }
  // OT from ALL of a member's WORKED hours in range (not the type filter)
  const allByUser = new Map<string, TimeSegment[]>()
  for (const s of worked.value) {
    if (!allByUser.has(s.userId)) allByUser.set(s.userId, [])
    allByUser.get(s.userId)!.push(s)
  }
  const out: MemberRow[] = []
  for (const [userId, list] of byUser) {
    const p = sched.personById.value.get(userId)
    let regular = 0
    let instructor = 0
    let meeting = 0
    let holiday = 0
    const days = new Set<string>()
    for (const s of list) {
      days.add(s.dateIso)
      if (holidayName(s.dateIso)) holiday += s.hours
      if (s.timeType === 'instructor') instructor += s.hours
      else if (s.timeType === 'meeting') meeting += s.hours
      else regular += s.hours
    }
    const weekTotals = new Map<string, number>()
    for (const s of allByUser.get(userId) ?? []) {
      const wk = weekStartFor(s.dateIso)
      weekTotals.set(wk, (weekTotals.get(wk) ?? 0) + s.hours)
    }
    let ot = 0
    for (const h of weekTotals.values()) ot += Math.max(0, h - t.otWeek)
    out.push({
      userId,
      name: p?.fullName ?? 'Unknown',
      credential: p?.credential ?? null,
      code: p?.paycomCode ?? null,
      days: days.size,
      regular: round2(regular),
      instructor: round2(instructor),
      meeting: round2(meeting),
      holiday: round2(holiday),
      total: round2(regular + instructor + meeting),
      ot: round2(ot),
    })
  }
  return out.sort((a, b) => byLast(a.name, b.name))
})

const grand = computed(() => {
  let regular = 0
  let instructor = 0
  let meeting = 0
  let holiday = 0
  let total = 0
  let ot = 0
  for (const r of summary.value) {
    regular += r.regular
    instructor += r.instructor
    meeting += r.meeting
    holiday += r.holiday
    total += r.total
    ot += r.ot
  }
  return {
    regular: round2(regular),
    instructor: round2(instructor),
    meeting: round2(meeting),
    holiday: round2(holiday),
    total: round2(total),
    ot: round2(ot),
  }
})

// ── drill-down ───────────────────────────────────────────────────────

const expanded = ref<string | null>(null)

function msHm(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Chicago',
  })
    .format(new Date(ms))
    .replace(':', '')
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const detail = computed(() => {
  if (!expanded.value) return []
  const list = filtered.value
    .filter((s) => s.userId === expanded.value)
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.startMs - b.startMs)
  const groups: { dateIso: string; rows: TimeSegment[]; hours: number }[] = []
  for (const s of list) {
    const last = groups[groups.length - 1]
    if (last && last.dateIso === s.dateIso) {
      last.rows.push(s)
      last.hours = round2(last.hours + s.hours)
    } else {
      groups.push({ dateIso: s.dateIso, rows: [s], hours: round2(s.hours) })
    }
  }
  return groups
})

// ── CSV + print ──────────────────────────────────────────────────────

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function downloadFile(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function csvReport(): void {
  const lines = ['Member,EE Code,Work Date,Source,Start,End,Hours,Type,Holiday']
  const list = [...filtered.value].sort((a, b) => {
    const an = sched.personById.value.get(a.userId)?.fullName ?? ''
    const bn = sched.personById.value.get(b.userId)?.fullName ?? ''
    return byLast(an, bn) || a.dateIso.localeCompare(b.dateIso) || a.startMs - b.startMs
  })
  for (const s of list) {
    const p = sched.personById.value.get(s.userId)
    lines.push(
      [
        esc(p?.fullName ?? 'Unknown'),
        p?.paycomCode ?? '',
        s.dateIso,
        esc(s.source),
        msHm(s.startMs),
        msHm(s.endMs),
        String(round2(s.hours)),
        s.timeType,
        holidayName(s.dateIso) ?? '',
      ].join(','),
    )
  }
  downloadFile(`scheduled-time_${range.value.start}_${range.value.end}.csv`, lines.join('\r\n'))
}

function printReport(): void {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) {
    err.value = 'Pop-up blocked — allow pop-ups to print.'
    return
  }
  const rows = summary.value
    .map(
      (r) => `<tr>
        <td>${r.name}${r.credential ? ` <span class="mut">- ${r.credential}</span>` : ''}</td>
        <td>${r.code ?? '—'}</td><td class="n">${r.days}</td><td class="n">${r.regular}</td>
        <td class="n">${r.instructor}</td><td class="n">${r.meeting}</td><td class="n">${r.holiday || ''}</td>
        <td class="n"><strong>${r.total}</strong></td><td class="n">${r.ot}</td></tr>`,
    )
    .join('')
  w.document.write(`<!doctype html><html><head><title>Scheduled Time — ${rangeLabel.value}</title>
    <style>
      body { font: 13px/1.5 -apple-system, "Segoe UI", sans-serif; color: #1a2233; padding: 24px; }
      h1 { font-size: 19px; margin: 0 0 2px; } .sub { color: #667; margin: 0 0 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #d8dce4; padding: 5px 8px; text-align: left; }
      th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #667; }
      td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
      .mut { color: #778; } tfoot td { font-weight: 700; border-top: 2px solid #99a; }
    </style></head><body>
    <h1>Waller County EMS — Scheduled Time</h1>
    <p class="sub">${rangeLabel.value} · generated ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
    <table><thead><tr><th>Member</th><th>EE Code</th><th class="n">Days</th><th class="n">Regular</th>
    <th class="n">Instructor</th><th class="n">Meeting</th><th class="n">Holiday</th><th class="n">Total hrs</th><th class="n">OT (>40/wk)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="n">${grand.value.regular}</td><td class="n">${grand.value.instructor}</td>
    <td class="n">${grand.value.meeting}</td><td class="n">${grand.value.holiday || ''}</td><td class="n">${grand.value.total}</td><td class="n">${grand.value.ot}</td></tr></tfoot>
    </table></body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

// ── Paycom export (pay-period preset) ────────────────────────────────

interface PunchPair {
  userId: string
  name: string
  code: string | null
  dateIso: string
  inMs: number
  outMs: number
  hours: number
  /** Earning code carried on the punch rows (column F); '' = regular. */
  earn: string
  /** Category label for the verify table ('vacation', 'holiday', …). */
  label: string
}

/** Punch pairs per member per work date, split by earning code —
 *  Paycom accepts timed punches carrying an earning code in column F
 *  (verified with a live test import, 2026-09-21), so coded categories
 *  (paid time off, instructor/meeting, special events, holidays)
 *  export as CODED punch pairs with their real windows instead of
 *  bare hours rows. Uncoded time off and uncoded instructor/meeting
 *  time stay OUT of the file (flagged below); uncoded events/holidays
 *  still ride as plain regular punches. Students aren't payroll. */
const punches = computed<PunchPair[]>(() => {
  if (preset.value !== 'period') return []
  const eligible: { s: TimeSegment; earn: string; label: string }[] = []
  for (const s of segs.value) {
    if (s.kind === 'student') continue
    const cat = segCategory(s)
    const earn = cat ? (codes.value[cat.key] ?? '') : ''
    if (!earn && (s.kind === 'timeoff' || s.timeType !== 'regular')) continue
    eligible.push({ s, earn, label: earn ? (cat?.label ?? '') : '' })
  }
  const byKey = new Map<string, { segs: TimeSegment[]; earn: string; label: string }>()
  for (const e of eligible) {
    const k = `${e.s.userId}|${e.s.dateIso}|${e.earn}`
    if (!byKey.has(k)) byKey.set(k, { segs: [], earn: e.earn, label: e.label })
    byKey.get(k)!.segs.push(e.s)
  }
  const out: PunchPair[] = []
  for (const [key, group] of byKey) {
    const [userId, dateIso] = key.split('|')
    const sorted = [...group.segs].sort((a, b) => a.startMs - b.startMs)
    const merged: { start: number; end: number }[] = []
    for (const s of sorted) {
      const last = merged[merged.length - 1]
      if (last && s.startMs <= last.end + 60_000) last.end = Math.max(last.end, s.endMs)
      else merged.push({ start: s.startMs, end: s.endMs })
    }
    const p = sched.personById.value.get(userId)
    for (const m of merged) {
      out.push({
        userId,
        name: p?.fullName ?? 'Unknown',
        code: p?.paycomCode ?? null,
        dateIso,
        inMs: m.start,
        outMs: m.end,
        hours: round2((m.end - m.start) / 3_600_000),
        earn: group.earn,
        label: group.label,
      })
    }
  }
  return out.sort(
    (a, b) => byLast(a.name, b.name) || a.dateIso.localeCompare(b.dateIso) || a.inMs - b.inMs,
  )
})

const noCode = computed(() => {
  const names = new Set<string>()
  for (const p of punches.value) if (!p.code) names.add(p.name)
  return [...names].sort()
})

/** The coded punch pairs going in the file — surfaced as a green
 *  checklist so payroll can eyeball the special-pay lines before
 *  downloading. */
const codedPairs = computed(() => punches.value.filter((p) => p.earn && p.code))

// Earning-code map from Setup (category key → Paycom code). Coded
// categories export as hours rows; uncoded ones get flagged.
const codes = computed(() => sched.paycomCodes())
const holidayCode = computed(() => codes.value['holiday'] ?? '')
const eventCode = computed(() => codes.value['event'] ?? '')

/** Which hours-row category (if any) a segment belongs to. Regular
 *  seat punches return null. Precedence: instructor/meeting by time
 *  type, then special events (double time), then holiday work dates
 *  (double time), then time-off types. */
function segCategory(s: TimeSegment): { key: string; label: string } | null {
  if (s.kind === 'timeoff') {
    const key = s.offType ?? 'other'
    return { key, label: OFF_LABELS[key] ?? 'Time Off' }
  }
  if (s.kind === 'student') return null
  if (s.timeType === 'instructor') return { key: 'instructor', label: 'instructor' }
  if (s.timeType === 'meeting') return { key: 'meeting', label: 'meeting' }
  // Extra hours worked AT a special event (crew picked "Special Event"
  // on the request) pay double time exactly like event staffing.
  if (s.timeType === 'event') return { key: 'event', label: 'special event' }
  if (s.kind === 'event') {
    // events marked regular pay punch like ordinary coverage (unless
    // the date itself is a holiday)
    if (s.eventDouble === false) {
      return holidayName(s.dateIso) ? { key: 'holiday', label: 'holiday' } : null
    }
    return { key: 'event', label: 'special event' }
  }
  if (holidayName(s.dateIso)) return { key: 'holiday', label: 'holiday' }
  return null
}

/** Instructor/meeting time with no earning code — it can't ride as a
 *  regular punch (double time), so it stays out of the file. (Members
 *  missing an EE code are flagged by the no-EE-code banner instead;
 *  uncoded events/holidays stay plain punches; uncoded time off gets
 *  its own banner.) */
const manualEntries = computed(() => {
  if (preset.value !== 'period') return []
  return segs.value
    .map((s) => ({ s, cat: segCategory(s) }))
    .filter(({ cat }) => {
      if (!cat) return false
      return (cat.key === 'instructor' || cat.key === 'meeting') && !codes.value[cat.key]
    })
    .map(({ s, cat }) => ({
      name: sched.personById.value.get(s.userId)?.fullName ?? 'Unknown',
      dateIso: s.dateIso,
      hours: round2(s.hours),
      timeType: cat!.label,
      source: s.source,
    }))
    .sort((a, b) => byLast(a.name, b.name) || a.dateIso.localeCompare(b.dateIso))
})

/** Holidays in this period whose double time ISN'T coded yet — that
 *  coverage exports as ordinary punches until the code is set. */
const uncodedHolidays = computed(() => {
  if (preset.value !== 'period' || holidayCode.value) return []
  const seen = new Map<string, string>()
  for (const s of worked.value) {
    if (s.timeType !== 'regular' || s.kind === 'student' || s.kind === 'event') continue
    const h = holidayName(s.dateIso)
    if (h) seen.set(s.dateIso, h)
  }
  return [...seen.entries()]
    .map(([dateIso, name]) => ({ dateIso, name }))
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
})

/** Event hours with no Special-event code — double time exporting as
 *  ordinary punches until it's set. */
const uncodedEventHours = computed(() => {
  if (preset.value !== 'period' || eventCode.value) return 0
  let h = 0
  for (const s of worked.value) {
    if (s.kind === 'event' && s.timeType === 'regular' && s.eventDouble !== false) h += s.hours
  }
  return round2(h)
})

/** Approved paid time off with no earning code — NOT exported at all
 *  (unpaid time off is expected to stay uncoded and isn't flagged).
 *  Itemized per member per date: a bare "Time Off 48h" total sent
 *  payroll hunting for who and when (Justin, 2026-09-24). */
const uncodedOffRows = computed(() => {
  if (preset.value !== 'period') return []
  return segs.value
    .filter((s) => {
      if (s.kind !== 'timeoff') return false
      const key = s.offType ?? 'other'
      return key !== 'unpaid' && !codes.value[key]
    })
    .map((s) => ({
      name: sched.personById.value.get(s.userId)?.fullName ?? 'Unknown',
      dateIso: s.dateIso,
      hours: round2(s.hours),
      label: OFF_LABELS[s.offType ?? 'other'] ?? 'Time Off',
    }))
    .sort((a, b) => byLast(a.name, b.name) || a.dateIso.localeCompare(b.dateIso))
})

/** Paycom convention: a shift running to the 0600 changeover punches
 *  OUT at 05:59 — otherwise a 48 produces an OD and the next day's ID
 *  at the same instant and the hours don't calculate. */
function punchOutMs(ms: number): number {
  return centralPunch(ms).time === '06:00' ? ms - 60_000 : ms
}

/** Punch pairs grouped per employee (last-name order) — drives the
 *  verification modal and the export-selected checkboxes. */
interface PunchGroup {
  userId: string
  name: string
  code: string | null
  pairs: PunchPair[]
  hours: number
}

const punchGroups = computed<PunchGroup[]>(() => {
  const m = new Map<string, PunchGroup>()
  for (const p of punches.value) {
    if (!m.has(p.userId)) m.set(p.userId, { userId: p.userId, name: p.name, code: p.code, pairs: [], hours: 0 })
    const g = m.get(p.userId)!
    g.pairs.push(p)
    g.hours = round2(g.hours + p.hours)
  }
  return [...m.values()].sort((a, b) => byLast(a.name, b.name))
})

// export-selected: which employees go in the file (default: everyone)
const selectedIds = ref<Set<string>>(new Set())

watch(punchGroups, (groups) => {
  selectedIds.value = new Set(groups.map((g) => g.userId))
})

function toggleSelected(userId: string) {
  const s = new Set(selectedIds.value)
  if (s.has(userId)) s.delete(userId)
  else s.add(userId)
  selectedIds.value = s
}

/* name/EE-code filter over the punch list — supervisors review one
   member at a time without unticking seventy-nine others. */
const punchFilter = ref('')

const visibleGroups = computed<PunchGroup[]>(() => {
  const q = punchFilter.value.trim().toLowerCase()
  if (!q) return punchGroups.value
  return punchGroups.value.filter(
    (g) => g.name.toLowerCase().includes(q) || (g.code ?? '').toLowerCase().includes(q),
  )
})

/** All/None act on what the filter shows — with no filter, everyone. */
function selectAll(on: boolean) {
  const s = new Set(selectedIds.value)
  for (const g of visibleGroups.value) {
    if (on) s.add(g.userId)
    else s.delete(g.userId)
  }
  selectedIds.value = s
}

function centralPunch(ms: number): { date: string; time: string } {
  const d = new Date(ms)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return { date, time }
}

/* Sub-tabs (redesign 2026-09-23): Hours report · Paycom export ·
   Balances — one surface per job instead of one long scroll. */
const ttab = ref<'verify' | 'hours' | 'export' | 'balances'>('verify')
watch(
  ttab,
  (t) => {
    if (t === 'export' || t === 'verify') preset.value = 'period'
  },
  { immediate: true },
)
const showNotes = ref(false)
const exportFlagCount = computed(
  () =>
    noCode.value.length +
    uncodedHolidays.value.length +
    (uncodedEventHours.value > 0 ? 1 : 0) +
    uncodedOffRows.value.length +
    manualEntries.value.length,
)
/* Anything needing attention opens the detail on its own — the count
   alone doesn't say who or what to fix. */
watch(exportFlagCount, (n) => {
  if (n > 0) showNotes.value = true
})

/** Paycom timecard import: no header, 17 columns. Every row is a
 *  punch: EE code, blank, MM/DD/YYYY, HH:MM (24h), ID/OD, and the
 *  earning code in column F for coded categories (blank = regular).
 *  Coded punch pairs import with real times attached to the pay code —
 *  verified against a live Paycom timecard 2026-09-21. */
function downloadPaycom(onlySelected = false): void {
  const keep = (userId: string) => !onlySelected || selectedIds.value.has(userId)
  const rows: string[] = []
  const withCode = punches.value
    .filter((p) => p.code && keep(p.userId))
    .sort((a, b) => byLast(a.name, b.name) || a.inMs - b.inMs)
  for (const p of withCode) {
    const iin = centralPunch(p.inMs)
    const out = centralPunch(punchOutMs(p.outMs))
    // A..Q: code,,date,time,ID/OD,earn + 11 trailing blanks = 17 fields
    const blank11 = ',,,,,,,,,,,'
    rows.push(`${p.code},,${iin.date},${iin.time},ID,${p.earn}${blank11}`)
    rows.push(`${p.code},,${out.date},${out.time},OD,${p.earn}${blank11}`)
  }
  if (rows.length === 0) {
    err.value = onlySelected
      ? 'No employees selected — tick who to export in the punch list.'
      : 'No rows to export for this period.'
    return
  }
  const suffix = onlySelected ? '_selected' : ''
  downloadFile(`paycom-import_${range.value.start}_${range.value.end}${suffix}.csv`, rows.join('\r\n'))
}


</script>

<template>
  <div class="tm">
    <div class="tm__tabs" role="tablist">
      <button class="tm__tab" :class="{ 'tm__tab--on': ttab === 'verify' }" @click="ttab = 'verify'">Verify punches</button>
      <button class="tm__tab" :class="{ 'tm__tab--on': ttab === 'hours' }" @click="ttab = 'hours'">Hours</button>
      <template v-if="payrollAccess">
        <button class="tm__tab" :class="{ 'tm__tab--on': ttab === 'export' }" @click="ttab = 'export'">Paycom export</button>
        <button class="tm__tab" :class="{ 'tm__tab--on': ttab === 'balances' }" @click="ttab = 'balances'">Balances</button>
      </template>
    </div>

    <!-- Verify punches — the default surface: the pay period's IN/OUT
         pairs per member, checked against what actually happened. -->
    <div v-show="ttab === 'verify'" class="tm__verify">
      <div class="tm__exptop">
        <label class="tm__field">
          <span class="tm__label">Pay period</span>
          <select v-model="periodStart" class="tm__input">
            <option v-for="pp in periods" :key="pp.start" :value="pp.start">{{ pp.label }}</option>
          </select>
        </label>
        <input
          v-model="punchFilter"
          type="search"
          class="tm__input tm__pfinput"
          placeholder="Filter by name or EE code…"
          aria-label="Filter punch list by employee"
        />
        <span class="tm__actions">
          <template v-if="payrollAccess">
            <button class="tm__btn" @click="selectAll(true)">All</button>
            <button class="tm__btn" @click="selectAll(false)">None</button>
            <button
              class="tm__btn tm__btn--primary"
              :disabled="selectedIds.size === 0"
              @click="downloadPaycom(true)"
            >
              Download selected ({{ selectedIds.size }} of {{ punchGroups.length }})
            </button>
          </template>
        </span>
      </div>
      <p v-if="payrollAccess" class="tm__muted tm__modal-hint">
        Untick anyone whose timecard shouldn't be touched. OUT punches at the 0600 changeover
        show as 05:59 (Paycom convention).
      </p>
      <p v-else class="tm__muted tm__modal-hint">
        Check each member's IN/OUT punches against what actually happened on shift — if a
        time is wrong, the schedule is wrong: fix the day on the calendar or tell the
        scheduler. OUT punches at the 0600 changeover show as 05:59 (Paycom convention).
      </p>
      <div class="tm__scroll">
        <table class="tm__table tm__table--punch">
          <thead>
            <tr>
              <th></th>
              <th>Work date</th>
              <th>IN</th>
              <th>OUT</th>
              <th>Pay code</th>
              <th class="tm__n">Hrs</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="visibleGroups.length === 0">
              <td colspan="6" class="tm__muted" style="padding: 0.7rem 0">
                {{ punchFilter ? `No members match “${punchFilter}”.` : 'No punches in this pay period yet.' }}
              </td>
            </tr>
            <template v-for="g in visibleGroups" :key="g.userId">
              <tr class="tm__emprow">
                <td colspan="5">
                  <label class="tm__empcheck">
                    <input
                      v-if="payrollAccess"
                      type="checkbox"
                      :checked="selectedIds.has(g.userId)"
                      @change="toggleSelected(g.userId)"
                    />
                    <span class="tm__name">{{ g.name }}</span>
                    <template v-if="payrollAccess">
                      <span v-if="g.code" class="tm__muted">· {{ g.code }}</span>
                      <span v-else class="tm__nocode">no code</span>
                    </template>
                  </label>
                </td>
                <td class="tm__n">{{ g.hours || '' }}</td>
              </tr>
              <tr
                v-for="(pp, i) in g.pairs"
                :key="i"
                class="tm__punchrow"
                :class="{ 'tm__row--alt': i % 2 === 1, 'tm__row--off': !selectedIds.has(g.userId) }"
              >
                <td></td>
                <td>
                  {{ fmtDay(pp.dateIso) }}
                  <span v-if="holidayName(pp.dateIso)" class="tm__holtag">{{ holidayName(pp.dateIso) }}</span>
                </td>
                <td>{{ centralPunch(pp.inMs).date }} {{ centralPunch(pp.inMs).time }}</td>
                <td>{{ centralPunch(punchOutMs(pp.outMs)).date }} {{ centralPunch(punchOutMs(pp.outMs)).time }}</td>
                <td>
                  <template v-if="pp.earn">
                    <span class="tm__earn">{{ pp.earn }}</span>
                    <span v-if="pp.label" class="tm__muted"> {{ pp.label }}</span>
                  </template>
                  <span v-else class="tm__muted">—</span>
                </td>
                <td class="tm__n">{{ pp.hours }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div v-show="ttab === 'hours'">
    <div class="tm__controls">
      <label class="tm__field">
        <span class="tm__label">Range</span>
        <select v-model="preset" class="tm__input">
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="period">Pay period</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <label v-if="preset === 'day' || preset === 'week'" class="tm__field">
        <span class="tm__label">{{ preset === 'day' ? 'Date' : 'Any date in the week' }}</span>
        <input v-model="anchor" type="date" class="tm__input" />
      </label>
      <label v-else-if="preset === 'month'" class="tm__field">
        <span class="tm__label">Month</span>
        <input v-model="monthAnchor" type="month" class="tm__input" />
      </label>
      <label v-else-if="preset === 'period'" class="tm__field">
        <span class="tm__label">Pay period</span>
        <select v-model="periodStart" class="tm__input">
          <option v-for="p in periods" :key="p.start" :value="p.start">{{ p.label }}</option>
        </select>
      </label>
      <template v-else>
        <label class="tm__field">
          <span class="tm__label">From</span>
          <input v-model="customStart" type="date" class="tm__input" />
        </label>
        <label class="tm__field">
          <span class="tm__label">To</span>
          <input v-model="customEnd" type="date" class="tm__input" />
        </label>
      </template>

      <label class="tm__field">
        <span class="tm__label">Member</span>
        <select v-model="memberFilter" class="tm__input">
          <option value="">All members</option>
          <option v-for="p in sched.people.value" :key="p.id" :value="p.id">{{ p.fullName }}</option>
        </select>
      </label>
      <label class="tm__field">
        <span class="tm__label">Time type</span>
        <select v-model="typeFilter" class="tm__input">
          <option value="">All</option>
          <option value="regular">Regular</option>
          <option value="instructor">Instructor</option>
          <option value="meeting">Meeting</option>
          <option value="event">Special Event</option>
        </select>
      </label>

      <span class="tm__actions">
        <button v-if="payrollAccess" class="tm__btn" :disabled="busy || summary.length === 0" @click="csvReport">CSV</button>
        <button class="tm__btn" :disabled="busy || summary.length === 0" @click="printReport">Print</button>
      </span>
    </div>

    <p class="tm__rangeline">
      <strong>{{ rangeLabel }}</strong>
      <span v-if="busy" class="tm__muted"> · loading…</span>
    </p>
    <p v-if="err" class="tm__error">{{ err }}</p>

    <div class="tm__scroll">
      <table class="tm__table">
        <thead>
          <tr>
            <th>Member</th>
            <th v-if="payrollAccess">EE code</th>
            <th class="tm__n">Days</th>
            <th class="tm__n">Regular</th>
            <th class="tm__n">Instructor</th>
            <th class="tm__n">Meeting</th>
            <th class="tm__n" title="Hours worked on observed holidays (0600 → 0600) — paid double time">Holiday</th>
            <th class="tm__n">Total hrs</th>
            <th class="tm__n" title="Estimated: hours over 40 per Sun–Sat week inside this range">OT (&gt;40/wk)</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(r, ri) in summary" :key="r.userId">
            <tr
              class="tm__row"
              :class="{ 'tm__row--alt': ri % 2 === 1 }"
              @click="expanded = expanded === r.userId ? null : r.userId"
            >
              <td>
                <span class="tm__rowchev" :class="{ 'tm__rowchev--open': expanded === r.userId }" aria-hidden="true">▸</span>
                <span class="tm__name tm__name--link">{{ r.name }}</span>
                <span v-if="r.credential" class="tm__muted"> - {{ r.credential }}</span>
              </td>
              <td v-if="payrollAccess">
                <span v-if="r.code">{{ r.code }}</span>
                <span v-else class="tm__nocode">no code</span>
              </td>
              <td class="tm__n">{{ r.days }}</td>
              <td class="tm__n">{{ r.regular }}</td>
              <td class="tm__n">{{ r.instructor || '' }}</td>
              <td class="tm__n">{{ r.meeting || '' }}</td>
              <td class="tm__n tm__hol">{{ r.holiday || '' }}</td>
              <td class="tm__n tm__total">{{ r.total }}</td>
              <td class="tm__n" :class="{ 'tm__ot': r.ot > 0 }">{{ r.ot || '' }}</td>
            </tr>
            <tr v-if="expanded === r.userId" class="tm__detailrow">
              <td :colspan="payrollAccess ? 9 : 8">
                <div v-for="g in detail" :key="g.dateIso" class="tm__detailday">
                  <p class="tm__detailhead">{{ fmtDay(g.dateIso) }} <span class="tm__muted">· {{ g.hours }} hrs</span></p>
                  <div v-for="(s, i) in g.rows" :key="i" class="tm__seg">
                    <span class="tm__segsrc">{{ s.source }}</span>
                    <span v-if="s.timeType !== 'regular'" class="tm__segtype">{{ s.timeType }}</span>
                    <span class="tm__segtime">{{ msHm(s.startMs) }} – {{ msHm(s.endMs) }} · {{ Math.round(s.hours * 100) / 100 }} hrs</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
        <tfoot v-if="summary.length > 0">
          <tr>
            <td :colspan="payrollAccess ? 3 : 2">Total — {{ summary.length }} {{ summary.length === 1 ? 'member' : 'members' }}</td>
            <td class="tm__n">{{ grand.regular }}</td>
            <td class="tm__n">{{ grand.instructor }}</td>
            <td class="tm__n">{{ grand.meeting }}</td>
            <td class="tm__n tm__hol">{{ grand.holiday || '' }}</td>
            <td class="tm__n tm__total">{{ grand.total }}</td>
            <td class="tm__n">{{ grand.ot }}</td>
          </tr>
        </tfoot>
      </table>
      <p v-if="!busy && summary.length === 0" class="tm__muted tm__empty">No scheduled hours in this range.</p>
    </div>
    </div>

    <!-- Paycom export tab: one status line; the detail on demand -->
    <section v-if="payrollAccess" v-show="ttab === 'export'" class="tm__paycom">
      <div class="tm__exptop">
        <label class="tm__field">
          <span class="tm__label">Pay period</span>
          <select v-model="periodStart" class="tm__input">
            <option v-for="pp in periods" :key="pp.start" :value="pp.start">{{ pp.label }}</option>
          </select>
        </label>
        <span class="tm__actions">
          <button class="tm__btn" @click="ttab = 'verify'">Verify punches</button>
          <button
            class="tm__btn tm__btn--primary"
            :disabled="busy || punches.length === 0"
            @click="downloadPaycom()"
          >
            Download Paycom CSV
          </button>
        </span>
      </div>

      <p class="tm__statusline">
        <span class="tm__dot" :class="{ 'tm__dot--warn': exportFlagCount > 0 }" aria-hidden="true" />
        Export ready — {{ codedPairs.length }} coded punch {{ codedPairs.length === 1 ? 'pair' : 'pairs' }}
        <b v-if="exportFlagCount > 0" class="tm__flagcount">· {{ exportFlagCount }} {{ exportFlagCount === 1 ? 'item needs' : 'items need' }} attention</b>
        <button class="tm__notestoggle" @click="showNotes = !showNotes">{{ showNotes ? 'Hide details' : 'Details' }}</button>
      </p>

      <div v-show="showNotes" class="tm__notes">
      <p class="tm__muted">
        One IN (ID) and OUT (OD) punch per merged shift segment, per member with an EE code —
        the file imports straight into the Paycom timecard template (no header, 17 columns).
        Shifts running to the 0600 changeover punch OUT at <strong>05:59</strong> so
        back-to-back 24s pair correctly. Categories with an earning code in Setup —
        special events and holidays (double time), instructor/meeting, and paid time off —
        export as punch pairs <strong>carrying their earning code</strong>, so the timecard
        shows the real times attached to the right pay code.
      </p>

      <p v-if="noCode.length" class="tm__warn">
        No Paycom EE code — enter these manually: {{ noCode.join(', ') }}
      </p>
      <p v-if="uncodedHolidays.length" class="tm__warn">
        {{ uncodedHolidays.map((h) => `${h.name} (${fmtDay(h.dateIso)})`).join(' · ') }} —
        double time, but no Holiday earning code is set in Setup, so these hours export as
        ordinary punches. Set the code and the punches carry it automatically.
      </p>
      <p v-if="uncodedEventHours > 0" class="tm__warn">
        {{ uncodedEventHours }} special-event hours this period — double time, but no
        Special event earning code is set in Setup, so they export as ordinary punches.
      </p>
      <div v-if="uncodedOffRows.length" class="tm__warn">
        <p class="tm__warnhead tm__warnhead--danger">
          Approved paid time off NOT in the file — its category has no earning code. Set
          the code in Setup → Payroll (exports automatically next download), or key these
          into the Paycom timecard by hand:
        </p>
        <p v-for="(o, i) in uncodedOffRows" :key="i" class="tm__manual">
          {{ o.name }} · {{ fmtDay(o.dateIso) }} · {{ o.hours }} hrs {{ o.label }}
        </p>
      </div>
      <div v-if="codedPairs.length" class="tm__warn tm__warn--ok">
        <p class="tm__warnhead">In the file as coded punches (real times + earning code):</p>
        <p v-for="(h, i) in codedPairs" :key="i" class="tm__manual">
          {{ h.name }} · {{ fmtDay(h.dateIso) }} · {{ h.hours }} hrs {{ h.label }}
          <span class="tm__muted">→ earning code {{ h.earn }}</span>
        </p>
      </div>
      <div v-if="manualEntries.length" class="tm__warn tm__warn--soft">
        <p class="tm__warnhead">
          Instructor / meeting time NOT in the file — set its earning code in Setup, or
          enter manually:
        </p>
        <p v-for="(m, i) in manualEntries" :key="i" class="tm__manual">
          {{ m.name }} · {{ fmtDay(m.dateIso) }} · {{ m.hours }} hrs {{ m.timeType }} <span class="tm__muted">({{ m.source }})</span>
        </p>
      </div>
      </div>

    </section>

    <div v-if="payrollAccess" v-show="ttab === 'balances'">
      <ScheduleLeaveSection />
    </div>
  </div>
</template>

<style scoped>
.tm {
  max-width: 1100px;
}

/* headers align with their columns — numeric columns right, always */
.tm__table th.tm__n {
  text-align: right;
}

.tm__rowchev {
  display: inline-block;
  font-size: 0.6rem;
  color: var(--color-muted);
  margin-right: 6px;
  transition: transform 0.12s;
}

.tm__rowchev--open {
  transform: rotate(90deg);
}

.tm__name--link {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-line);
  text-underline-offset: 3px;
}

.tm__row:hover .tm__name--link {
  text-decoration-color: var(--color-accent-600);
}

.tm__verify .tm__pfinput {
  min-width: 220px;
}

.tm__tabs {
  display: flex;
  gap: 18px;
  border-bottom: 1px solid var(--color-line);
  margin: 0 0 14px;
}

.tm__tab {
  border: 0;
  background: none;
  padding: 7px 2px 9px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.tm__tab--on {
  color: var(--color-ink);
  border-bottom-color: var(--color-accent-600);
}

.tm__exptop {
  display: flex;
  align-items: flex-end;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.tm__exptop .tm__actions {
  margin-left: auto;
}

.tm__statusline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  margin: 0.4rem 0 0.6rem;
}

.tm__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-success-500);
  flex-shrink: 0;
}

.tm__dot--warn {
  background: var(--color-danger-500);
}

.tm__flagcount {
  color: var(--color-danger-500);
}

.tm__notestoggle {
  border: 0;
  background: none;
  color: var(--color-accent-700);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.tm__notes {
  border-left: 2px solid var(--color-line-soft);
  padding-left: 14px;
  margin-bottom: 0.6rem;
}

.tm__controls {
  display: flex;
  align-items: flex-end;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
}

.tm__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tm__earn {
  font-weight: 600;
  color: var(--color-accent-700);
  margin-right: 0.35rem;
}

.tm__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.tm__input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.34rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.tm__actions {
  margin-left: auto;
  display: inline-flex;
  gap: 0.4rem;
}

.tm__btn {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.36rem 0.9rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-soft));
  box-shadow: 0 1px 2px oklch(0.3 0.03 260 / 0.08);
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.05s ease;
}

.tm__btn:hover:not(:disabled) {
  border-color: var(--color-brand-300);
  box-shadow: 0 2px 6px oklch(0.3 0.03 260 / 0.14);
}

.tm__btn:active:not(:disabled) {
  transform: translateY(1px);
}

.tm__btn--primary,
.tm__btn--primary:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  border-color: var(--color-brand-800);
  color: white;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.18),
    0 2px 6px oklch(0.3 0.06 260 / 0.35);
}

.tm__btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.tm__rangeline {
  font-size: 0.95rem;
  color: var(--color-ink);
  margin: 0 0 0.5rem;
}

.tm__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.tm__muted {
  color: var(--color-muted);
}

.tm__empty {
  font-size: 0.88rem;
  padding: 0.6rem 0.2rem;
}

.tm__scroll {
  overflow-x: auto;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.tm__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

.tm__table th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  text-align: left;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  white-space: nowrap;
}

.tm__table td {
  padding: 0.42rem 0.7rem;
  border-bottom: 1px solid var(--color-line-soft);
  color: var(--color-ink-soft);
}

.tm__row--alt {
  background: oklch(0.45 0.02 260 / 0.045);
}

.tm__row--off td {
  opacity: 0.45;
}

.tm__n {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tm__row {
  cursor: pointer;
}

.tm__row:hover .tm__name {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.tm__name {
  font-weight: 600;
  color: var(--color-ink);
}

.tm__total {
  font-weight: 700;
  color: var(--color-ink);
}

.tm__ot {
  color: var(--color-danger-500);
  font-weight: 700;
}

.tm__hol {
  color: var(--color-accent-700);
  font-weight: 600;
}

.tm__holtag {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  border: 1px solid oklch(0.86 0.06 86.8);
  background: oklch(0.985 0.012 86.8);
  border-radius: 999px;
  padding: 1px 7px;
  white-space: nowrap;
}

.tm__nocode {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-danger-500);
  border: 1px solid oklch(0.85 0.09 27);
  border-radius: 999px;
  padding: 1px 7px;
  white-space: nowrap;
}

.tm__table tfoot td {
  font-weight: 700;
  color: var(--color-ink);
  border-top: 2px solid var(--color-line);
  background: var(--color-surface-soft);
}

.tm__detailrow > td {
  background: var(--color-surface-soft);
  padding: 0.5rem 1rem 0.7rem;
}

.tm__detailday {
  padding: 0.25rem 0;
}

.tm__detailhead {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-brand-800);
  margin: 0 0 0.15rem;
}

.tm__seg {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 0.82rem;
  padding: 0.12rem 0 0.12rem 0.8rem;
}

.tm__segsrc {
  color: var(--color-ink);
  min-width: 0;
}

.tm__segtype {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-accent-700);
  border: 1px solid oklch(0.86 0.06 86.8);
  border-radius: 999px;
  padding: 1px 7px;
}

.tm__segtime {
  margin-left: auto;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tm__paycom {
  margin-top: 1.4rem;
}

.tm__paycom-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
  margin-bottom: 0.2rem;
}

.tm__h {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--color-brand-800);
  margin: 0;
}

.tm__warn {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-danger-500);
  border: 1px solid oklch(0.85 0.09 27);
  background: oklch(0.97 0.02 27);
  border-radius: 9px;
  padding: 0.5rem 0.7rem;
  margin: 0.5rem 0;
}

.tm__warn--soft {
  color: var(--color-ink-soft);
  font-weight: 400;
  border-color: oklch(0.85 0.08 60);
  background: var(--color-warning-50);
}

.tm__warn--ok {
  color: var(--color-ink-soft);
  font-weight: 400;
  border-color: oklch(0.85 0.07 150);
  background: var(--color-success-50);
}

.tm__warn--ok .tm__warnhead {
  color: var(--color-success-500);
}

.tm__warnhead {
  font-size: 0.8rem;
  font-weight: 700;
  color: oklch(0.45 0.12 60);
  margin: 0 0 0.25rem;
}

.tm__warnhead--danger {
  color: var(--color-danger-500);
}

.tm__manual {
  font-size: 0.82rem;
  margin: 0.1rem 0;
}

.tm__overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 70;
  padding: 1.2rem;
}

.tm__modal {
  background: linear-gradient(180deg, var(--color-surface) 0%, oklch(0.985 0.004 90) 100%);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-brand-700);
  border-radius: 14px;
  box-shadow:
    0 24px 60px oklch(0.2 0.03 260 / 0.28),
    0 4px 14px oklch(0.2 0.03 260 / 0.14);
  width: min(880px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 1rem 1.1rem;
  gap: 0.4rem;
}

.tm__modal-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}

.tm__modal-hint {
  font-size: 0.8rem;
  margin: 0;
}

.tm__punchfilter {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.tm__pfinput {
  font: inherit;
  font-size: 0.84rem;
  padding: 0.32rem 0.55rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
  width: min(280px, 100%);
}

.tm__pfinput:focus-visible {
  outline: 2px solid var(--color-brand-300);
  outline-offset: 1px;
}

.tm__modal-scroll {
  overflow: auto;
  border: 1px solid var(--color-line);
  border-radius: 10px;
}

.tm__emprow td {
  background: var(--color-surface-soft);
  border-top: 2px solid var(--color-line);
  font-weight: 600;
}

.tm__empcheck {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.tm__punchrow td:first-child {
  width: 28px;
}

@media (max-width: 700px) {
  .tm__actions {
    margin-left: 0;
  }

  /* one swipeable underline row — four tabs don't fit a phone */
  .tm__tabs {
    gap: 14px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .tm__tabs::-webkit-scrollbar {
    display: none;
  }

  .tm__tab {
    white-space: nowrap;
    flex: none;
  }
}
</style>
