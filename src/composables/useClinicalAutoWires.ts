import { watchEffect } from 'vue'
import { useClinical } from '@/composables/useClinical'
import { useExams } from '@/composables/useExams'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { useFtoEvalRequests } from '@/composables/useFtoEvalRequests'
import { usePipeline } from '@/composables/usePipeline'
import { activeTransitionFor, TRANSITIONS } from '@/constants/pipelineGates'
import type { PipelineTransition } from '@/types'

/**
 * Clinical auto-wiring that runs in an EDITOR's session (same pattern
 * as useExamCertAutoFile — mounted where editors look, module-level
 * in-flight guards, idempotent writes):
 *
 *  1. Protocol-test pass → the trainee owes a Trainee Evaluation of
 *     FTO: an ftep_fto_eval_requests row (dedup_key `exam:<id>` keeps
 *     it one-per-pass across sessions) + push/email via sched-notify.
 *  2. Skills Day sign-offs complete (a pass on every active station)
 *     → the NEOP `neop_signoffs` gate checks itself.
 *
 * The exam→protocol-gate wire lives server-side in exam_submit.
 */

const evalReqInFlight = new Set<string>()
const gateInFlight = new Set<string>()

/** Transitions whose protocol test ends a credential and therefore
 *  triggers the FTO evaluation (Justin, 2026-10-21: "any time they
 *  take a protocol test"). NEOP's academy exam has no FTO yet. */
const FTO_EVAL_TRANSITIONS = new Set<PipelineTransition>([
  'P1C_P1',
  'P1_P2',
  'P1_LEGACY',
  'P1_P2_LEGACY',
])

export function useClinicalAutoWires() {
  const { canEdit, clinicalPeople, gatesFor } = useClinical()
  const exams = useExams()
  const skills = useSkillsDay()
  const evalReqs = useFtoEvalRequests()
  const pipeline = usePipeline()

  /* 1 — protocol-test pass → FTO-eval request */
  watchEffect(() => {
    if (!canEdit.value || !exams.ready.value || !evalReqs.ready.value) return
    for (const a of exams.assignments.value) {
      if (a.status !== 'submitted' || !a.passed || !a.submittedAt) continue
      const p = clinicalPeople.value.find((x) => x.userId === a.userId)
      if (!p) continue
      const t = activeTransitionFor(p.record)
      if (!t || !FTO_EVAL_TRANSITIONS.has(t)) continue
      const dedupKey = `exam:${a.id}`
      if (evalReqInFlight.has(dedupKey)) continue
      if (evalReqs.requests.value.some((r) => r.dedupKey === dedupKey)) continue
      evalReqInFlight.add(dedupKey)
      void (async () => {
        try {
          const id = await evalReqs.create({
            traineeUserId: p.userId,
            ftoName: p.record.ftoName ?? '',
            phaseLabel: `${TRANSITIONS[t].label} — protocol test passed ${a.submittedAt!.slice(0, 10)}`,
            reason: 'protocol_test_passed',
            dedupKey,
          })
          if (id) evalReqs.notify(id)
        } catch (e) {
          console.error('[clinical] FTO-eval request failed:', e)
          evalReqInFlight.delete(dedupKey)
        }
      })()
    }
  })

  /* 2 — Skills Day complete → NEOP sign-offs gate */
  watchEffect(() => {
    if (!canEdit.value || !skills.ready.value || !pipeline.ready.value) return
    const stations = skills.checkoffs.value
    if (!stations.length) return
    for (const p of clinicalPeople.value) {
      if (activeTransitionFor(p.record) !== 'NEOP') continue
      const existing = gatesFor(p.record.id).find(
        (g) => g.transition === 'NEOP' && g.gateKey === 'neop_signoffs',
      )
      if (existing?.status === 'complete' || existing?.status === 'na') continue
      const key = `neop:${p.record.id}`
      if (gateInFlight.has(key)) continue
      const passedAll = stations.every((c) =>
        skills.evaluations.value.some(
          (e) => e.checkoffId === c.id && e.candidateId === p.userId && e.overall === 'pass',
        ),
      )
      if (!passedAll) continue
      gateInFlight.add(key)
      void (async () => {
        try {
          await pipeline.setGate(
            p.record.id,
            'NEOP',
            'neop_signoffs',
            'complete',
            `${stations.length} stations passed (Skills Day)`,
          )
          await pipeline.refresh()
        } catch (e) {
          console.error('[clinical] NEOP skills gate auto-check failed:', e)
          gateInFlight.delete(key)
        }
      })()
    }
  })
}
