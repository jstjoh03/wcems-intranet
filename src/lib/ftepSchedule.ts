import type { FtepPhaseProgress, FtepReport } from '@/types'

/**
 * Scheduled-day ↔ DOR matching, shared by the phase stepper, the
 * trainee quickview, and the FTEP home "missing DORs" list.
 *
 * WCEMS runs 24-hour shifts, so a DOR is often dated the day after
 * the scheduled shift date. A scheduled day therefore matches any
 * counting DOR dated within ±1 day, and a day is only flagged
 * "missing" once that +1-day grace window has fully passed.
 * Clinical-run (noFto) phases carry no DOR requirement — their days
 * complete on the calendar alone.
 */

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Eval dates of the trainee's counting DORs (exclusions dropped). */
export function buildDorDateSet(dors: FtepReport[]): Set<string> {
  return new Set(dors.map((r) => r.evalDate))
}

/** A DOR within ±1 day of the scheduled date counts for that day. */
export function dorNear(set: Set<string>, day: string): boolean {
  return set.has(day) || set.has(isoAddDays(day, 1)) || set.has(isoAddDays(day, -1))
}

export type ScheduledDayState = 'done' | 'missed' | 'upcoming'

export function dayState(set: Set<string>, day: string, noFto?: boolean): ScheduledDayState {
  const today = todayIso()
  if (noFto) return day <= today ? 'done' : 'upcoming'
  if (dorNear(set, day)) return 'done'
  /* Grace: the DOR may land the day after a 24-hr shift — flag only
     once day+1 has also passed. */
  return day < isoAddDays(today, -1) ? 'missed' : 'upcoming'
}

/** Days past their grace window with no DOR on file. */
export function missingDorDays(
  row: Pick<FtepPhaseProgress, 'scheduledDays'> | undefined,
  set: Set<string>,
  noFto?: boolean,
): string[] {
  if (noFto || !row) return []
  return row.scheduledDays.filter((d) => dayState(set, d) === 'missed')
}

/** Every scheduled day has passed and (for FTO phases) has its DOR —
 *  the auto-complete condition. */
export function scheduleSatisfied(
  row: Pick<FtepPhaseProgress, 'scheduledDays'> | undefined,
  set: Set<string>,
  noFto?: boolean,
): boolean {
  const days = row?.scheduledDays ?? []
  if (days.length === 0) return false
  const today = todayIso()
  return days.every((d) => d < today && (noFto || dorNear(set, d)))
}
