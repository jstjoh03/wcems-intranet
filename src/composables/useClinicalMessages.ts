import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Per-trainee FTEP message threads (ftep_messages). Visibility is the
 * thread circle RLS enforces server-side: clinical editors, admins,
 * supervisors, the trainee, and any FTO who has held one of their
 * phases. Posting fans out push + email via sched-notify
 * (kind 'clinical_message') to the editors, the FTO(s), the trainee,
 * and earlier posters — never the author.
 *
 * Module singleton; threads load on demand per record and update live
 * through realtime inserts.
 */

export interface FtepMessage {
  id: string
  recordId: string
  authorId: string
  body: string
  createdAt: string
}

interface MessageRow {
  id: string
  record_id: string
  author_id: string
  body: string
  created_at: string
}

function fromRow(r: MessageRow): FtepMessage {
  return {
    id: r.id,
    recordId: r.record_id,
    authorId: r.author_id,
    body: r.body,
    createdAt: r.created_at,
  }
}

const threads = ref<Record<string, FtepMessage[]>>({})
const loadedRecords = new Set<string>()
let realtimeSubscribed = false

function upsertLocal(msg: FtepMessage): void {
  const list = threads.value[msg.recordId] ?? []
  if (list.some((m) => m.id === msg.id)) return
  threads.value = {
    ...threads.value,
    [msg.recordId]: [...list, msg].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }
}

function subscribeRealtime(): void {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('ftep-messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ftep_messages' },
      (payload) => upsertLocal(fromRow(payload.new as MessageRow)),
    )
    .subscribe()
}

export function useClinicalMessages() {
  const auth = useAuthStore()

  function threadFor(recordId: string): FtepMessage[] {
    return threads.value[recordId] ?? []
  }

  async function loadThread(recordId: string): Promise<void> {
    if (auth.usingDevStub) {
      if (!loadedRecords.has(recordId)) {
        loadedRecords.add(recordId)
        threads.value = { ...threads.value, [recordId]: [] }
      }
      return
    }
    if (loadedRecords.has(recordId)) return
    loadedRecords.add(recordId)
    subscribeRealtime()
    const { data, error } = await supabase
      .from('ftep_messages')
      .select('id, record_id, author_id, body, created_at')
      .eq('record_id', recordId)
      .order('created_at')
    if (error) {
      console.error('[clinical] thread load:', error.message)
      loadedRecords.delete(recordId)
      return
    }
    threads.value = { ...threads.value, [recordId]: (data ?? []).map((r) => fromRow(r as MessageRow)) }
  }

  /** Post to a thread; the edge function resolves recipients and sends
   *  push + email. The notify call is fire-and-forget — a delivery
   *  hiccup never loses the message itself. */
  async function postMessage(recordId: string, body: string): Promise<string | null> {
    const text = body.trim()
    if (!text) return 'Write a message first.'
    const uid = auth.appUser?.id
    if (!uid) return 'Sign in first.'
    if (auth.usingDevStub) {
      upsertLocal({
        id: `dev-msg-${Date.now()}`,
        recordId,
        authorId: uid,
        body: text,
        createdAt: new Date().toISOString(),
      })
      return null
    }
    const { data, error } = await supabase
      .from('ftep_messages')
      .insert({ record_id: recordId, author_id: uid, body: text })
      .select('id, record_id, author_id, body, created_at')
      .single()
    if (error) return error.message
    const msg = fromRow(data as MessageRow)
    upsertLocal(msg)
    void supabase.functions
      .invoke('sched-notify', { body: { kind: 'clinical_message', messageId: msg.id } })
      .then(({ error: e }) => {
        if (e) console.warn('[clinical] message notify failed:', e.message)
      })
      .catch((e: unknown) => console.warn('[clinical] message notify failed:', e))
    return null
  }

  /** Recent posts across every thread the caller can see — the Today
   *  queue's "new messages" rows. */
  async function loadRecent(days = 7): Promise<FtepMessage[]> {
    if (auth.usingDevStub) return []
    subscribeRealtime()
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const { data, error } = await supabase
      .from('ftep_messages')
      .select('id, record_id, author_id, body, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(40)
    if (error) {
      console.error('[clinical] recent messages:', error.message)
      return []
    }
    return (data ?? []).map((r) => fromRow(r as MessageRow))
  }

  return { threadFor, loadThread, postMessage, loadRecent }
}
