import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { ThreadComment } from '@/components/engagement/CommentThread.vue'

/**
 * Answers to the Question of the Week — one live thread per question,
 * rendered through the shared CommentThread component.
 *
 * Follows useBirthdayComments (realtime INSERT/DELETE with the
 * pending-id echo dedupe), simplified to a single active thread
 * because the dashboard only ever shows one question.
 *
 * Dev-stub: localStorage.
 */

const STORAGE_KEY = 'wcems:qotw-comments'
const SELECT =
  'id, question_id, user_id, body, created_at, app_users:app_users!qotw_comments_user_id_fkey(full_name, email)'

interface CommentRow {
  id: string
  question_id: string
  user_id: string
  body: string
  created_at: string
  app_users: { full_name: string | null; email: string } | null
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

function rowToComment(r: CommentRow): ThreadComment {
  const fullName = r.app_users?.full_name?.trim() || r.app_users?.email?.split('@')[0] || 'Crew'
  return {
    id: r.id,
    userId: r.user_id,
    authorName: fullName,
    authorInitials: initials(fullName),
    body: r.body,
    createdAt: r.created_at,
  }
}

const comments = ref<ThreadComment[]>([])
const loading = ref(false)
let loadedFor: string | null = null
let subscribed = false

const pendingInsertIds = new Set<string>()
const pendingDeleteIds = new Set<string>()

function stubLoad(questionId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, ThreadComment[]>) : {}
    comments.value = all[questionId] ?? []
  } catch {
    comments.value = []
  }
}

function stubPersist(questionId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, ThreadComment[]>) : {}
    all[questionId] = comments.value
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* quota — no-op */
  }
}

async function fetchOne(id: string): Promise<ThreadComment | null> {
  const { data, error } = await supabase
    .from('qotw_comments')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return rowToComment(data as unknown as CommentRow)
}

function subscribeRealtime() {
  if (subscribed) return
  subscribed = true
  supabase
    .channel('qotw_comments')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qotw_comments' },
      async (payload) => {
        const row = payload.new as { id: string; question_id: string }
        if (row.question_id !== loadedFor) return
        if (pendingInsertIds.has(row.id)) {
          pendingInsertIds.delete(row.id)
          return
        }
        if (comments.value.some((c) => c.id === row.id)) return
        const enriched = await fetchOne(row.id)
        if (enriched && !comments.value.some((c) => c.id === enriched.id))
          comments.value = [...comments.value, enriched]
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'qotw_comments' },
      (payload) => {
        const row = payload.old as { id?: string; question_id?: string }
        if (!row.id || row.question_id !== loadedFor) return
        if (pendingDeleteIds.has(row.id)) {
          pendingDeleteIds.delete(row.id)
          return
        }
        comments.value = comments.value.filter((c) => c.id !== row.id)
      },
    )
    .subscribe()
}

export function useQotwComments() {
  const auth = useAuthStore()

  async function load(questionId: string) {
    if (loadedFor === questionId) return
    loadedFor = questionId
    loading.value = true

    if (auth.usingDevStub) {
      stubLoad(questionId)
      loading.value = false
      return
    }

    const { data, error } = await supabase
      .from('qotw_comments')
      .select(SELECT)
      .eq('question_id', questionId)
      .order('created_at', { ascending: true })
    loading.value = false
    if (error) {
      console.error('[qotw-comments] load failed:', error.message)
      return
    }
    comments.value = (data ?? []).map((r) => rowToComment(r as unknown as CommentRow))
    subscribeRealtime()
  }

  async function post(questionId: string, body: string): Promise<boolean> {
    const trimmed = body.trim()
    const uid = auth.appUser?.id
    if (!trimmed || !uid) return false

    if (auth.usingDevStub) {
      const name = auth.appUser?.fullName ?? 'You'
      comments.value = [
        ...comments.value,
        {
          id: `dev-${crypto.randomUUID()}`,
          userId: uid,
          authorName: name,
          authorInitials: initials(name),
          body: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]
      stubPersist(questionId)
      return true
    }

    const { data, error } = await supabase
      .from('qotw_comments')
      .insert({ question_id: questionId, user_id: uid, body: trimmed })
      .select(SELECT)
      .single()
    if (error) {
      console.error('[qotw-comments] post failed:', error.message)
      return false
    }
    const inserted = rowToComment(data as unknown as CommentRow)
    pendingInsertIds.add(inserted.id)
    comments.value = [...comments.value, inserted]
    return true
  }

  async function remove(questionId: string, commentId: string) {
    const before = comments.value
    comments.value = before.filter((c) => c.id !== commentId)

    if (auth.usingDevStub) {
      stubPersist(questionId)
      return
    }

    pendingDeleteIds.add(commentId)
    const { error } = await supabase.from('qotw_comments').delete().eq('id', commentId)
    if (error) {
      pendingDeleteIds.delete(commentId)
      comments.value = before
      console.error('[qotw-comments] delete failed:', error.message)
    }
  }

  return { comments, loading, load, post, remove }
}
