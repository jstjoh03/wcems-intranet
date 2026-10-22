import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Trainee-Evaluation-of-FTO requests (ftep_fto_eval_requests): the
 * "you owe an evaluation" queue. Auto-created on a protocol-test pass
 * and on an FTO change into the final evaluation (dedup_key keeps the
 * triggers idempotent across sessions); the trainee's submission on
 * /clinical-development/fto-eval closes it. Editors see the full
 * queue (Today's "N FTO evaluations due"); a trainee sees their own.
 */

export interface FtoEvalRequest {
  id: string
  traineeUserId: string
  ftoName: string
  phaseLabel: string
  reason: string
  status: 'pending' | 'done' | 'dismissed'
  dedupKey: string | null
  createdAt: string
}

interface Row {
  id: string
  trainee_user_id: string
  fto_name: string
  phase_label: string
  reason: string
  status: 'pending' | 'done' | 'dismissed'
  dedup_key: string | null
  created_at: string
}

function fromRow(r: Row): FtoEvalRequest {
  return {
    id: r.id,
    traineeUserId: r.trainee_user_id,
    ftoName: r.fto_name,
    phaseLabel: r.phase_label,
    reason: r.reason,
    status: r.status,
    dedupKey: r.dedup_key,
    createdAt: r.created_at,
  }
}

const COLUMNS = 'id, trainee_user_id, fto_name, phase_label, reason, status, dedup_key, created_at'

const requests = ref<FtoEvalRequest[]>([])
const ready = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('ftep_fto_eval_requests')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (error) console.error('[fto-eval-req] load:', error.message)
  requests.value = (data ?? []).map((r) => fromRow(r as Row))
  ready.value = true
}

export function useFtoEvalRequests() {
  const auth = useAuthStore()
  void load()

  function pending(): FtoEvalRequest[] {
    return requests.value.filter((r) => r.status === 'pending')
  }

  function pendingFor(userId: string): FtoEvalRequest[] {
    return requests.value.filter((r) => r.status === 'pending' && r.traineeUserId === userId)
  }

  function anyFor(userId: string): FtoEvalRequest[] {
    return requests.value.filter((r) => r.traineeUserId === userId)
  }

  /** Idempotent create — a dedup key makes repeat triggers no-ops.
   *  Returns the request id when a NEW request was created. */
  async function create(input: {
    traineeUserId: string
    ftoName: string
    phaseLabel: string
    reason: 'protocol_test_passed' | 'fto_change' | 'manual'
    dedupKey?: string
  }): Promise<string | null> {
    if (auth.usingDevStub) return null
    const { data, error } = await supabase
      .from('ftep_fto_eval_requests')
      .upsert(
        {
          trainee_user_id: input.traineeUserId,
          fto_name: input.ftoName,
          phase_label: input.phaseLabel,
          reason: input.reason,
          dedup_key: input.dedupKey ?? null,
          created_by: auth.appUser?.id ?? null,
        },
        { onConflict: 'dedup_key', ignoreDuplicates: true },
      )
      .select(COLUMNS)
      .maybeSingle()
    if (error) {
      console.error('[fto-eval-req] create:', error.message)
      return null
    }
    if (!data) return null // duplicate — already requested
    const row = fromRow(data as Row)
    requests.value = [row, ...requests.value.filter((r) => r.id !== row.id)]
    return row.id
  }

  /** The trainee's submission closes their request. */
  async function complete(id: string, evalId: string | null) {
    if (auth.usingDevStub) return
    const { error } = await supabase
      .from('ftep_fto_eval_requests')
      .update({ status: 'done', eval_id: evalId, completed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      console.error('[fto-eval-req] complete:', error.message)
      return
    }
    requests.value = requests.value.map((r) => (r.id === id ? { ...r, status: 'done' as const } : r))
  }

  async function dismiss(id: string) {
    if (auth.usingDevStub) return
    const { error } = await supabase
      .from('ftep_fto_eval_requests')
      .update({ status: 'dismissed', completed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return
    requests.value = requests.value.map((r) => (r.id === id ? { ...r, status: 'dismissed' as const } : r))
  }

  /** Push + email the trainee their form link (server-side fan-out). */
  function notify(requestId: string) {
    void supabase.functions.invoke('sched-notify', {
      body: { kind: 'clinical_fto_eval_request', requestId },
    })
  }

  return { ready, requests, pending, pendingFor, anyFor, create, complete, dismiss, notify }
}
