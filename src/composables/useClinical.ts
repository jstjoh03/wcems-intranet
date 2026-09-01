import { computed } from 'vue'
import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'
import {
  activeTransitionFor,
  jurisprudenceStatus,
  requirementStatus,
} from '@/constants/pipelineGates'
import type { PipelinePerson, PipelineRequirement } from '@/types'

/**
 * Shared scoping + rollups for the redesigned Clinical Development
 * section (/clinical). Wraps usePipeline with the clinical-file rule
 * (cert level "N/A" — office staff without clinical requirements —
 * are excluded) and the attention/coming-up computations the hub,
 * roster, and file pages all share.
 */

export interface AttentionItem {
  person: PipelinePerson
  detail: string
  severity: 'due' | 'warn' | 'info'
}

export interface UpcomingItem {
  person: PipelinePerson | null
  when: string // ISO date
  detail: string
}

const DAY = 86_400_000

export function useClinical() {
  const pipeline = usePipeline()
  const { people, requirements, completionsFor, gatesFor } = pipeline

  /** Everyone with a clinical file — active people with a clinical cert. */
  const clinicalPeople = computed<PipelinePerson[]>(() =>
    people.value.filter(
      (p) => p.active && p.record.certLevel && p.record.certLevel !== 'N/A',
    ),
  )

  function personById(userId: string): PipelinePerson | null {
    return clinicalPeople.value.find((p) => p.userId === userId) ?? null
  }

  function licDays(p: PipelinePerson): number | null {
    const exp = p.record.txLicenseExpiresAt
    if (!exp) return null
    return Math.ceil((new Date(`${exp}T00:00:00`).getTime() - Date.now()) / DAY)
  }

  /** Requirements that apply to this person's level (or that they have
   *  a completion for anyway — voluntarily tracked extras). */
  function requirementsFor(p: PipelinePerson): PipelineRequirement[] {
    const comps = completionsFor(p.userId)
    return requirements.value.filter((r) => {
      if (!r.active) return false
      if (r.requiredLevels.length === 0)
        return comps.some((c) => c.requirementId === r.id)
      return !!p.record.certLevel && r.requiredLevels.includes(p.record.certLevel)
    })
  }

  /** Required-for-level CARD classes with nothing on file. Per-cycle
   *  items (jurisprudence, HEART) are deliberately excluded — they get
   *  the "required before <license expiry>" treatment instead of an
   *  everyone-at-once missing-card alarm. */
  function missingRequired(p: PipelinePerson): PipelineRequirement[] {
    if (p.record.pending) return []
    const comps = completionsFor(p.userId)
    return requirements.value.filter(
      (r) =>
        r.active &&
        r.cycle === 'certification' &&
        r.requiredLevels.length > 0 &&
        !!p.record.certLevel &&
        r.requiredLevels.includes(p.record.certLevel) &&
        !comps.some((c) => c.requirementId === r.id),
    )
  }

  /** Everything needing action for one person (file page + rollups). */
  function attentionFor(p: PipelinePerson): AttentionItem[] {
    const items: AttentionItem[] = []
    const lic = licDays(p)
    if (lic !== null && lic < 0)
      items.push({ person: p, detail: `TX license expired ${-lic}d ago`, severity: 'due' })
    else if (lic !== null && lic <= 90)
      items.push({ person: p, detail: `TX license expires in ${lic}d`, severity: lic <= 30 ? 'due' : 'warn' })

    const missing = missingRequired(p)
    if (missing.length)
      items.push({
        person: p,
        detail: `${missing.map((m) => m.name).join(', ')} — no card on file`,
        severity: 'due',
      })

    for (const req of requirementsFor(p)) {
      const st = requirementStatus(req, completionsFor(p.userId), p.record)
      if (st.state === 'due') {
        if (req.cycle === 'per_cert_cycle')
          items.push({ person: p, detail: `${req.name} — required before ${st.dueAt ?? 'license renewal'}`, severity: 'due' })
        else if (st.latest)
          items.push({ person: p, detail: `${req.name} — expired/due`, severity: 'due' })
      } else if (st.state === 'expiring' && st.latest) {
        items.push({ person: p, detail: `${req.name} — expires ${st.dueAt}`, severity: 'warn' })
      }
      /* 'required' (per-cycle, window not open) is a tag on the file,
         not an attention item. */
    }

    if (!p.record.pending) {
      const js = jurisprudenceStatus(p.record)
      if (js.state === 'due')
        items.push({
          person: p,
          detail: js.requiredBefore
            ? `TX jurisprudence — required before ${js.requiredBefore}`
            : 'TX jurisprudence not on file for this cycle',
          severity: 'due',
        })
    }

    const t = p.record.workingTargetAt
    if (p.record.workingPhase && t && new Date(`${t}T00:00:00`).getTime() < Date.now())
      items.push({ person: p, detail: `Phase target ${t} passed — follow up`, severity: 'warn' })

    return items
  }

  const attentionAll = computed<AttentionItem[]>(() =>
    clinicalPeople.value.flatMap((p) => attentionFor(p)),
  )

  /** People counted once, however many items they have. */
  const attentionPeopleCount = computed(
    () => new Set(attentionAll.value.map((i) => i.person.userId)).size,
  )

  const inPipeline = computed(() =>
    clinicalPeople.value.filter((p) => activeTransitionFor(p.record) !== null),
  )

  const missingCertPeople = computed(() =>
    clinicalPeople.value.filter((p) => missingRequired(p).length > 0),
  )

  /** Next-90-day horizon: expirations and phase targets, soonest first. */
  const comingUp = computed<UpcomingItem[]>(() => {
    const out: UpcomingItem[] = []
    const horizon = Date.now() + 90 * DAY
    for (const p of clinicalPeople.value) {
      const exp = p.record.txLicenseExpiresAt
      if (exp) {
        const t = new Date(`${exp}T00:00:00`).getTime()
        if (t > Date.now() && t < horizon)
          out.push({ person: p, when: exp, detail: `${p.fullName} — TX license expires` })
      }
      for (const req of requirementsFor(p)) {
        const st = requirementStatus(req, completionsFor(p.userId), p.record)
        if (st.state === 'expiring' && st.dueAt)
          out.push({ person: p, when: st.dueAt, detail: `${p.fullName} — ${req.name} expires` })
      }
      const target = p.record.workingTargetAt
      if (p.record.workingPhase && target) {
        const t = new Date(`${target}T00:00:00`).getTime()
        if (t > Date.now() && t < horizon)
          out.push({ person: p, when: target, detail: `${p.fullName} — phase target` })
      }
    }
    return out.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 8)
  })

  /** Which FTEP track a trainee is on — the programs carry different
   *  forms and requirements and must read as visually distinct
   *  (Justin, 2026-08-20):
   *   new    — current FTEP program: DOR avg over final 4 (floor 3.5),
   *            10 scored ALS ICRs
   *   legacy — pre-program P2 candidates: DOR avg over final 2,
   *            10 call evals in narrative format
   *   rideup — P2→P3 ride-up supervisor (Dodd, Cates): 4 × 12-hr
   *            supervisor rideouts + skills check-offs — NO ICR count
   *   aemt   — AEMT upgrade: skills checklists + med sign-off
   */
  function ftepTrackFor(p: PipelinePerson): {
    key: 'new' | 'legacy' | 'rideup' | 'aemt'
    label: string
    /** Legacy DORs live in Jotform on a different scale — the portal
     *  tracks only their call evals, so DOR stats are off entirely. */
    dorTracked: boolean
    dorWindow: number
    icrTarget: number | null
    icrLabel: string
    rideoutTarget: number | null
    /** Legacy rung the current 10 count toward ('P1' or 'P2'). */
    legacyPhase?: 'P1' | 'P2'
  } | null {
    const t = activeTransitionFor(p.record)
    if (!t) return null
    if (t === 'P1_LEGACY')
      return { key: 'legacy', label: 'Legacy — credentialing as P1', dorTracked: false, dorWindow: 2, icrTarget: 10, icrLabel: 'call evals', rideoutTarget: null, legacyPhase: 'P1' }
    if (t === 'P1_P2_LEGACY')
      return { key: 'legacy', label: 'Legacy — P1 → P2', dorTracked: false, dorWindow: 2, icrTarget: 10, icrLabel: 'call evals', rideoutTarget: null, legacyPhase: 'P2' }
    if (t === 'P2_P3')
      return { key: 'rideup', label: 'Ride-up supervisor', dorTracked: true, dorWindow: 4, icrTarget: null, icrLabel: '', rideoutTarget: 4 }
    if (t === 'AEMT')
      return { key: 'aemt', label: 'AEMT upgrade', dorTracked: true, dorWindow: 4, icrTarget: null, icrLabel: '', rideoutTarget: null }
    return { key: 'new', label: 'FTEP — new program', dorTracked: true, dorWindow: 4, icrTarget: 10, icrLabel: 'ICRs', rideoutTarget: null }
  }

  /** Rideouts credited via the P2→P3 gate value — completed before the
   *  portal existed and typed into Edit record (e.g. Dodd's 4). Views
   *  max() this with submitted rideout DORs so manual credit checks
   *  the requirement off without fabricating report rows. */
  /** Live report counts for count-based gates (call evals / ICRs) so
   *  gateItemsFor can self-complete them. */
  function gateStatsFor(p: PipelinePerson) {
    const ftep = useFtep()
    const track = ftepTrackFor(p)
    if (!track) return {}
    if (track.key === 'legacy')
      return { callEvals: ftep.icrCount(p.userId, track.legacyPhase) }
    if (track.icrTarget) return { scoredIcrs: ftep.icrCount(p.userId) }
    return {}
  }

  /** Same, but for a SPECIFIC transition — used by the credentialing
   *  history so a completed legacy rung still shows its eval count. */
  function gateStatsForTransition(p: PipelinePerson, transition: string) {
    const ftep = useFtep()
    if (transition === 'P1_LEGACY') return { callEvals: ftep.icrCount(p.userId, 'P1') }
    if (transition === 'P1_P2_LEGACY') return { callEvals: ftep.icrCount(p.userId, 'P2') }
    if (transition === 'P1C_P1' || transition === 'P1_P2')
      return { scoredIcrs: ftep.icrCount(p.userId) }
    return {}
  }

  function manualRideouts(p: PipelinePerson): number {
    const row = gatesFor(p.record.id).find(
      (g) => g.transition === 'P2_P3' && g.gateKey === 'supervisor_rideouts',
    )
    const m = row?.value?.match(/\d+/)
    return m ? parseInt(m[0], 10) : 0
  }

  /** One roster-row status chip per person. */
  function statusChip(p: PipelinePerson): { text: string; kind: 'navy' | 'ok' | 'hold' } {
    if (p.record.pending) return { text: 'NEOP · pending', kind: 'hold' }
    const transition = activeTransitionFor(p.record)
    if (transition) {
      const labels: Record<string, string> = {
        NEOP: 'NEOP',
        P1C_P1: 'P1C → P1',
        P1_P2: 'P1 → P2',
        P1_LEGACY: '→ P1 · Legacy',
        P1_P2_LEGACY: 'P1 → P2 · Legacy',
        P2_P3: 'P2 → P3',
        AEMT: 'AEMT upgrade',
      }
      return { text: labels[transition] ?? transition, kind: 'navy' }
    }
    return { text: 'Credentialed', kind: 'ok' }
  }

  /** Primary attention chip for the roster row (worst first). */
  function attentionChip(p: PipelinePerson): { text: string; severity: 'due' | 'warn' } | null {
    const items = attentionFor(p)
    const due = items.find((i) => i.severity === 'due')
    if (due) {
      const missing = missingRequired(p)
      if (missing.length > 1) return { text: `${missing.length} certs missing`, severity: 'due' }
      return { text: due.detail.length > 34 ? `${due.detail.slice(0, 32)}…` : due.detail, severity: 'due' }
    }
    const warn = items.find((i) => i.severity === 'warn')
    if (warn)
      return { text: warn.detail.length > 34 ? `${warn.detail.slice(0, 32)}…` : warn.detail, severity: 'warn' }
    return null
  }

  return {
    ...pipeline,
    clinicalPeople,
    personById,
    licDays,
    requirementsFor,
    missingRequired,
    attentionFor,
    attentionAll,
    attentionPeopleCount,
    inPipeline,
    missingCertPeople,
    comingUp,
    statusChip,
    attentionChip,
    ftepTrackFor,
    manualRideouts,
    gateStatsFor,
    gateStatsForTransition,
    gatesFor,
  }
}
