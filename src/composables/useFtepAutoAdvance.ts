import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'
import type { FtepTimeline } from '@/composables/useFtepTimeline'
import type { PipelinePerson } from '@/types'

/**
 * Intra-transition auto phase advancement (Justin, 2026-11-15).
 *
 * The FTO's recommendation gates the END of a transition (P1C→P1,
 * P1→P2) — closing the Final Evaluation and everything after it stays
 * a human decision. The phases INSIDE a transition advance themselves:
 * when the current phase holds its standard day count of qualifying
 * days — ridden with an FTO, a submitted DOR on file, and no DOR
 * section below 3 (the Guide's acceptable floor) — the phase closes on
 * the day the standard was met and the next phase opens the following
 * day, so later schedule days allocate to it.
 *
 * House auto-wire pattern (useClinicalAutoWires): runs in an EDITOR's
 * session after the FTEP home builds its timelines, module-level
 * in-flight guards, idempotent writes with a provenance note. A
 * training hold or active PIP freezes the record. An FTO extending a
 * phase toward its maximum keeps control the same way they manage day
 * counts today: a below-3 DOR section stops the clock, and a ledger
 * exclusion removes a day from the count.
 */

const inFlight = new Set<string>()

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Returns true when anything was written (phase rows changed). */
export async function runFtepAutoAdvance(
  people: PipelinePerson[],
  timelines: Record<string, FtepTimeline>,
): Promise<boolean> {
  const pipeline = usePipeline()
  const ftep = useFtep()
  const reportById = new Map(ftep.reports.value.map((r) => [r.id, r]))
  let wrote = false

  for (const p of people) {
    const tl = timelines[p.userId]
    if (!tl || tl.unanchored) continue
    if (p.record.trainingHold || p.record.pipActive) continue
    const cur = tl.phases.find((ph) => ph.status === 'current')
    /* The final phase ends the transition — its close is the FTO's
       recommendation + credentialing, never automated. */
    if (!cur || cur.key === tl.finalPhaseKey) continue
    const std = cur.standard?.std
    if (!std || !cur.startedAt) continue

    /* Qualifying days, in date order: FTO aboard, DOR submitted, every
       rated section at 3 or better ("any section below 3 is
       unsuccessful for that day" — Guide §6). */
    const qual = cur.days.filter((d) => {
      if (d.future || !d.counts || !d.dorReportId) return false
      const r = reportById.get(d.dorReportId)
      if (!r) return false
      return !Object.values(r.payload.ratings ?? {}).some(
        (x) => typeof x.score === 'number' && x.score < 3,
      )
    })
    if (qual.length < std) continue

    const metOn = qual[std - 1]!.dateIso
    const key = `${p.record.id}:${cur.key}`
    if (inFlight.has(key)) continue
    inFlight.add(key)
    try {
      await pipeline.setPhaseProgress(p.record.id, cur.key, {
        startedAt: cur.startedAt,
        completedAt: metOn,
        note: `Auto-advanced: standard of ${std} FTO days met ${metOn}, all DORs acceptable (no section below 3).`,
      })
      const next = tl.phases[tl.phases.findIndex((ph) => ph.key === cur.key) + 1]
      if (next && !next.startedAt) {
        await pipeline.setPhaseProgress(p.record.id, next.key, {
          startedAt: addDaysIso(metOn, 1),
        })
      }
      wrote = true
    } catch {
      /* Transient write failure — allow the next pass to retry. */
      inFlight.delete(key)
    }
  }
  return wrote
}
