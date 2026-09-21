import { useSchedule, todayCentralIso, type TimeSegment } from '@/composables/useSchedule'
import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'
import { activeTransitionFor } from '@/constants/pipelineGates'
import {
  FTEP_PROGRAM_PHASES,
  FTEP_DAY_STANDARDS,
  type PhaseDayStandard,
} from '@/constants/ftepForms'
import type { PipelinePerson } from '@/types'

/**
 * Schedule-linked FTEP timeline (Program Guide v1.0 §4/§5).
 *
 * Replaces hand-tracked phase days: a trainee's training days are
 * derived from the live schedule — every 24-hour work date where they
 * hold coverage on a unit ALONGSIDE an FTO counts one training day
 * toward the phase whose window contains it (only FTO days count;
 * overtime without an FTO explicitly does not — Guide §5). DORs match
 * by eval date, and the published minimum/standard/maximum day tables
 * project the dates each phase — and testing eligibility — should
 * land at both standard and minimum pace.
 *
 * Read-only overlay: nothing here writes to ftep_phase_progress; the
 * stepper's manual day list keeps working as an override/plan.
 */

export interface FtepDayRow {
  dateIso: string
  unitCode: string
  ftoNames: string[]
  /** false = worked without an FTO — shown, but doesn't count. */
  counts: boolean
  future: boolean
  dor: 'submitted' | 'missing' | 'upcoming'
  phaseKey: string | null
}

export interface FtepPhaseTimeline {
  key: string
  no: number
  label: string
  startedAt: string | null
  completedAt: string | null
  ftoName: string | null
  standard: PhaseDayStandard | null
  actual: number
  status: 'complete' | 'current' | 'upcoming'
  days: FtepDayRow[]
  /** Projected dates (current/upcoming phases only). */
  estStdStart: string | null
  estStdEnd: string | null
  estMinEnd: string | null
}

export interface FtepGateChip {
  key: string
  label: string
  complete: boolean
}

export interface FtepTimeline {
  transition: 'P1C_P1' | 'P1_P2'
  accelerated: boolean
  phases: FtepPhaseTimeline[]
  /** Next scheduled qualifying days (with FTO) on the calendar. */
  upcoming: FtepDayRow[]
  /** Worked days with NO FTO in the phase window — visibility only. */
  notCounting: FtepDayRow[]
  estTestStd: string | null
  estTestMin: string | null
  /** Every FTO who has trained this person so far (phase rows + day
   *  log) — the final evaluation must be run by someone NOT here. */
  ftosUsed: string[]
  /** The final-evaluation phase key (needs a DIFFERENT FTO). */
  finalPhaseKey: string
  gates: FtepGateChip[]
  /** True when no phase has a start date — nothing to anchor days to. */
  unanchored: boolean
}

const NON_TRAINING_KINDS = new Set(['timeoff', 'student', 'event'])
const MIN_OVERLAP_MS = 60 * 60_000

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function buildFtepTimeline(
  person: PipelinePerson,
  opts?: { segs?: TimeSegment[] },
): Promise<FtepTimeline | null> {
  /* The Aug-17 cohort rode phases while their working phase still said
     NEOP - treat NEOP as the P1 track so the timeline never hides on a
     stale pointer. Legacy/rideup/AEMT tracks have no day tables. */
  const raw = activeTransitionFor(person.record)
  const transition = raw === 'NEOP' ? 'P1C_P1' : raw
  if (transition !== 'P1C_P1' && transition !== 'P1_P2') return null
  if (person.record.legacyTrack) return null

  const sched = useSchedule()
  const pipeline = usePipeline()
  const ftep = useFtep()
  await sched.ensureLoaded()

  const accelerated = transition === 'P1_P2' && person.record.p2Accelerated
  const standards = FTEP_DAY_STANDARDS[accelerated ? 'P1_P2_ACCEL' : transition]
  const programPhases = FTEP_PROGRAM_PHASES[transition].filter((p) => !p.noFto)
  const rows = new Map(pipeline.phasesFor(person.record.id).map((r) => [r.phaseKey, r]))

  const today = todayCentralIso()
  /* A phase's window opens at its recorded start OR its first planned
     day - the stepper often carries scheduled days before anyone sets
     a start date. */
  const effStart = (key: string): string | null => {
    const r = rows.get(key)
    return r?.startedAt ?? r?.scheduledDays[0] ?? null
  }
  const starts = programPhases
    .map((p) => effStart(p.key))
    .filter((s): s is string => !!s)
  if (person.record.workingStartedAt) starts.push(person.record.workingStartedAt)
  const unanchored = starts.length === 0
  const rangeStart = starts.length
    ? [...starts].sort()[0]!
    : addDaysIso(today, -60)
  const startIso = rangeStart < addDaysIso(today, -240) ? addDaysIso(today, -240) : rangeStart
  const endIso = addDaysIso(today, 112)

  let segs: TimeSegment[]
  if (opts?.segs) {
    segs = opts.segs
  } else {
    const res = await sched.fetchTimeSegments(startIso, endIso)
    if (res.error) throw new Error(res.error)
    segs = res.segs
  }

  /* Trainee's coverage per work date + everyone sharing the unit. */
  const unitById = new Map(sched.units.value.map((u) => [u.id, u]))
  const mine = segs.filter(
    (s) => s.userId === person.userId && s.unitId && !NON_TRAINING_KINDS.has(s.kind),
  )
  const othersByDateUnit = new Map<string, TimeSegment[]>()
  for (const s of segs) {
    if (s.userId === person.userId || !s.unitId) continue
    if (s.kind === 'timeoff' || s.kind === 'student') continue
    const k = `${s.dateIso}|${s.unitId}`
    if (!othersByDateUnit.has(k)) othersByDateUnit.set(k, [])
    othersByDateUnit.get(k)!.push(s)
  }

  function isFto(userId: string): boolean {
    const cred = sched.personById.value.get(userId)?.credential ?? ''
    if (cred.endsWith('-FTO')) return true
    return pipeline.allPeople.value.find((p) => p.userId === userId)?.record.isFto ?? false
  }

  const dorDates = new Set(
    ftep.reports.value
      .filter((r) => r.kind === 'dor' && r.traineeId === person.userId && r.status === 'submitted')
      .map((r) => r.evalDate),
  )

  /* One day row per work date the trainee is on a truck. */
  const byDate = new Map<string, { unitId: string; segs: TimeSegment[] }>()
  for (const s of mine) {
    const cur = byDate.get(s.dateIso)
    if (cur) cur.segs.push(s)
    else byDate.set(s.dateIso, { unitId: s.unitId!, segs: [s] })
  }
  const dayRows: FtepDayRow[] = [...byDate.entries()]
    .map(([dateIso, d]) => {
      const ftos = new Map<string, string>()
      for (const seg of d.segs) {
        for (const o of othersByDateUnit.get(`${dateIso}|${seg.unitId}`) ?? []) {
          const overlap = Math.min(seg.endMs, o.endMs) - Math.max(seg.startMs, o.startMs)
          if (overlap < MIN_OVERLAP_MS || !isFto(o.userId)) continue
          ftos.set(o.userId, sched.personById.value.get(o.userId)?.fullName ?? 'FTO')
        }
      }
      const future = dateIso > today
      return {
        dateIso,
        unitCode: unitById.get(d.unitId)?.code ?? '',
        ftoNames: [...ftos.values()],
        counts: ftos.size > 0,
        future,
        dor: future ? ('upcoming' as const) : dorDates.has(dateIso) ? ('submitted' as const) : ('missing' as const),
        phaseKey: null,
      }
    })
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))

  /* Allocate past days to the phase whose window holds them: latest
     phase started on/before the day and not completed before it. */
  const windows = programPhases
    .map((p) => ({ key: p.key, start: effStart(p.key), row: rows.get(p.key) }))
    .filter((w) => !!w.start)
  function phaseFor(dateIso: string): string | null {
    let hit: { key: string; started: string } | null = null
    for (const w of windows) {
      const started = w.start!
      const ended = w.row?.completedAt ?? null
      if (started <= dateIso && (!ended || dateIso <= ended)) {
        if (!hit || started > hit.started) hit = { key: w.key, started }
      }
    }
    return hit?.key ?? null
  }
  for (const d of dayRows) {
    if (!d.future) d.phaseKey = phaseFor(d.dateIso)
  }

  /* Projection: walk the future qualifying days; extrapolate at the
     observed cadence once the loaded horizon runs out. */
  const futureQual = dayRows.filter((d) => d.future && d.counts).map((d) => d.dateIso)
  let cadence = 3
  if (futureQual.length >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < futureQual.length; i++) {
      gaps.push(
        (new Date(`${futureQual[i]}T00:00:00Z`).getTime() -
          new Date(`${futureQual[i - 1]}T00:00:00Z`).getTime()) /
          86_400_000,
      )
    }
    gaps.sort((a, b) => a - b)
    cadence = Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]!))
  }
  function makeWalker() {
    let idx = 0
    let last = futureQual.length ? null : today
    return (count: number): { first: string | null; last: string | null } => {
      let first: string | null = null
      let d: string | null = null
      for (let i = 0; i < count; i++) {
        if (idx < futureQual.length) {
          d = futureQual[idx]!
          last = d
          idx++
        } else {
          last = addDaysIso(last ?? today, cadence)
          d = last
        }
        if (first === null) first = d
      }
      return { first, last: d }
    }
  }

  const phases: FtepPhaseTimeline[] = []
  let current: string | null = null
  for (const p of programPhases) {
    const row = rows.get(p.key)
    const std = standards[p.key] ?? null
    const days = dayRows.filter((d) => d.phaseKey === p.key)
    const actual = days.filter((d) => d.counts).length
    let status: FtepPhaseTimeline['status'] = 'upcoming'
    if (row?.completedAt) status = 'complete'
    else if (effStart(p.key) && !current) {
      status = 'current'
      current = p.key
    }
    phases.push({
      key: p.key,
      no: p.no,
      label: p.label,
      startedAt: effStart(p.key),
      completedAt: row?.completedAt ?? null,
      ftoName: row?.ftoName ?? null,
      standard: std,
      actual,
      status,
      days,
      estStdStart: null,
      estStdEnd: null,
      estMinEnd: null,
    })
  }

  const stdWalk = makeWalker()
  const minWalk = makeWalker()
  let estTestStd: string | null = null
  let estTestMin: string | null = null
  for (const ph of phases) {
    if (ph.status === 'complete' || !ph.standard) continue
    const remStd = Math.max(0, ph.standard.std - (ph.status === 'current' ? ph.actual : 0))
    const remMin = Math.max(0, ph.standard.min - (ph.status === 'current' ? ph.actual : 0))
    const w1 = stdWalk(remStd)
    const w2 = minWalk(remMin)
    ph.estStdStart = ph.status === 'current' ? ph.startedAt : w1.first
    ph.estStdEnd = remStd === 0 ? today : w1.last
    ph.estMinEnd = remMin === 0 ? today : w2.last
    estTestStd = ph.estStdEnd
    estTestMin = ph.estMinEnd
  }

  const GATE_LABELS: Record<string, string> = {
    mega_code: 'Mega code',
    protocol_exam: 'Protocol exam',
    oral_board: 'Oral board',
  }
  const gateRows = pipeline.gatesFor(person.record.id).filter((g) => g.transition === transition)
  const gates: FtepGateChip[] = Object.entries(GATE_LABELS).map(([key, label]) => ({
    key,
    label,
    complete: gateRows.some((g) => g.gateKey === key && g.status === 'complete'),
  }))

  const ftosUsed = [
    ...new Set([
      ...programPhases.map((p) => rows.get(p.key)?.ftoName).filter((n): n is string => !!n),
      ...dayRows.filter((d) => !d.future && d.counts).flatMap((d) => d.ftoNames),
    ]),
  ]

  return {
    transition,
    accelerated,
    phases,
    ftosUsed,
    finalPhaseKey: programPhases[programPhases.length - 1]!.key,
    upcoming: dayRows.filter((d) => d.future && d.counts).slice(0, 8),
    notCounting: dayRows.filter((d) => !d.future && !d.counts && d.phaseKey !== null),
    estTestStd,
    estTestMin,
    gates,
    unanchored,
  }
}
