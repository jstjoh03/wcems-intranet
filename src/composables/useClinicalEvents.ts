import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * clinical_events — the per-person activity timeline every console
 * write appends to (phase advancements, megacodes, recorded cards,
 * waivers, reminders). The file's "Recent activity" rail reads it;
 * every surface that changes a record writes it, so the file tells
 * the whole story without hunting through tabs.
 */

export interface ClinicalEvent {
  id: number
  userId: string
  kind: string
  summary: string
  detail: Record<string, unknown>
  actorId: string | null
  createdAt: string
}

interface Row {
  id: number
  user_id: string
  kind: string
  summary: string
  detail: Record<string, unknown>
  actor_id: string | null
  created_at: string
}

function fromRow(r: Row): ClinicalEvent {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    summary: r.summary,
    detail: r.detail ?? {},
    actorId: r.actor_id,
    createdAt: r.created_at,
  }
}

const byUser = ref<Record<string, ClinicalEvent[]>>({})
const loadedFor = new Set<string>()

export function useClinicalEvents() {
  const auth = useAuthStore()

  async function loadFor(userId: string) {
    if (loadedFor.has(userId) || auth.usingDevStub) return
    loadedFor.add(userId)
    const { data, error } = await supabase
      .from('clinical_events')
      .select('id, user_id, kind, summary, detail, actor_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) {
      console.error('[clinical-events] load:', error.message)
      loadedFor.delete(userId)
      return
    }
    byUser.value = { ...byUser.value, [userId]: (data ?? []).map((r) => fromRow(r as Row)) }
  }

  function eventsFor(userId: string): ClinicalEvent[] {
    return byUser.value[userId] ?? []
  }

  /** Append + reflect locally (editors only — RLS enforces). */
  async function log(userId: string, kind: string, summary: string, detail: Record<string, unknown> = {}) {
    if (auth.usingDevStub) return
    const { data, error } = await supabase
      .from('clinical_events')
      .insert({ user_id: userId, kind, summary, detail, actor_id: auth.appUser?.id ?? null })
      .select('id, user_id, kind, summary, detail, actor_id, created_at')
      .single()
    if (error) {
      console.error('[clinical-events] log:', error.message)
      return
    }
    const row = fromRow(data as Row)
    byUser.value = { ...byUser.value, [userId]: [row, ...(byUser.value[userId] ?? [])] }
  }

  return { eventsFor, loadFor, log }
}
