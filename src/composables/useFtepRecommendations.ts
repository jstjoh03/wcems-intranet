import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { allRows } from '@/lib/pagedSelect'
import { useAuthStore } from '@/stores/auth'

/**
 * Advancement recommendation letters — the "Final Release
 * Recommendation (Standalone)" paper form run in-portal. The
 * in-charge (P2) credential needs TWO on file; the rec_letters gate
 * self-completes from countFor(). Letters are evaluator-facing:
 * trainees never see them (RLS enforces this), matching the paper
 * workflow.
 */

export type RecommenderRole = 'fto' | 'supervisor' | 'cdo'
export type RecommendationChoice = 'release' | 'extend' | 'separate'

export interface FtepRecommendation {
  id: string
  traineeId: string
  recommenderId: string
  recommenderName: string | null
  transition: string
  recommenderRole: RecommenderRole
  knowledge: boolean
  safeEthical: boolean
  comfortable: boolean
  recommendation: RecommendationChoice
  basis: string | null
  evalDate: string
  createdAt: string
}

/* The signature stays out of the list select — it's a fat data URL
   only the PDF needs, and the PDF is generated at submit. */
const COLUMNS =
  'id, trainee_id, recommender_id, transition, recommender_role, knowledge, safe_ethical, comfortable, recommendation, basis, eval_date, created_at, recommender:app_users!ftep_recommendations_recommender_id_fkey(full_name)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): FtepRecommendation {
  return {
    id: r.id,
    traineeId: r.trainee_id,
    recommenderId: r.recommender_id,
    recommenderName: r.recommender?.full_name ?? null,
    transition: r.transition,
    recommenderRole: r.recommender_role,
    knowledge: r.knowledge,
    safeEthical: r.safe_ethical,
    comfortable: r.comfortable,
    recommendation: r.recommendation,
    basis: r.basis ?? null,
    evalDate: r.eval_date,
    createdAt: r.created_at,
  }
}

/* Module-shared state — every caller sees the same list. */
const rows = ref<FtepRecommendation[]>([])
const loaded = ref(false)
let inFlight: Promise<void> | null = null

export function useFtepRecommendations() {
  const auth = useAuthStore()

  async function load(): Promise<void> {
    if (loaded.value) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      if (auth.usingDevStub) {
        loaded.value = true
        return
      }
      const res = await allRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('ftep_recommendations')
          .select(COLUMNS)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      )
      if (!res.error) {
        rows.value = res.rows.map(fromRow)
        loaded.value = true
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  function listFor(traineeId: string, transition?: string): FtepRecommendation[] {
    return rows.value.filter(
      (r) => r.traineeId === traineeId && (!transition || r.transition === transition),
    )
  }

  /** Letters on file toward a credentialing step — drives rec_letters. */
  function countFor(traineeId: string, transition: string): number {
    return listFor(traineeId, transition).length
  }

  async function submit(input: {
    traineeId: string
    transition: string
    recommenderRole: RecommenderRole
    knowledge: boolean
    safeEthical: boolean
    comfortable: boolean
    recommendation: RecommendationChoice
    basis: string
    signature: string
    evalDate: string
  }): Promise<{ ok: true; rec: FtepRecommendation } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (auth.usingDevStub) {
      const rec: FtepRecommendation = {
        id: `dev-${Date.now()}`,
        traineeId: input.traineeId,
        recommenderId: uid,
        recommenderName: auth.appUser?.fullName ?? null,
        transition: input.transition,
        recommenderRole: input.recommenderRole,
        knowledge: input.knowledge,
        safeEthical: input.safeEthical,
        comfortable: input.comfortable,
        recommendation: input.recommendation,
        basis: input.basis,
        evalDate: input.evalDate,
        createdAt: new Date().toISOString(),
      }
      rows.value = [rec, ...rows.value]
      return { ok: true, rec }
    }
    const { data, error } = await supabase
      .from('ftep_recommendations')
      .insert({
        trainee_id: input.traineeId,
        recommender_id: uid,
        transition: input.transition,
        recommender_role: input.recommenderRole,
        knowledge: input.knowledge,
        safe_ethical: input.safeEthical,
        comfortable: input.comfortable,
        recommendation: input.recommendation,
        basis: input.basis.trim() || null,
        signature: input.signature,
        eval_date: input.evalDate,
      })
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const rec = fromRow(data)
    rows.value = [rec, ...rows.value]
    return { ok: true, rec }
  }

  return { rows, loaded, load, listFor, countFor, submit }
}
