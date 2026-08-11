import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { ThreadComment } from '@/components/engagement/CommentThread.vue'

/**
 * Congratulations thread on the active spotlight — the "internal
 * social" layer: anyone can post a congrats, delete their own; admins
 * can moderate. Simpler than the birthday/photo threads (no count map,
 * no realtime): the list loads when the detail modal opens and posts
 * append optimistically.
 *
 * Dev-stub: localStorage-backed so the flow is demoable offline.
 */

interface CommentRow {
  id: string
  spotlight_id: string
  user_id: string
  body: string
  created_at: string
  app_users: { full_name: string | null; email: string | null } | null
}

const DEV_KEY = 'wcems:spotlight-comments'

function initialsOf(name: string): string {
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
  const name = r.app_users?.full_name || r.app_users?.email || 'Teammate'
  return {
    id: r.id,
    userId: r.user_id,
    authorName: name,
    authorInitials: initialsOf(name),
    body: r.body,
    createdAt: r.created_at,
  }
}

export function useSpotlightComments() {
  const comments = ref<ThreadComment[]>([])
  const loading = ref(false)

  async function load(spotlightId: string) {
    const auth = useAuthStore()
    loading.value = true

    if (auth.usingDevStub) {
      try {
        const all = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}')
        comments.value = all[spotlightId] ?? []
      } catch {
        comments.value = []
      }
      loading.value = false
      return
    }

    const { data, error } = await supabase
      .from('spotlight_comments')
      .select(
        'id, spotlight_id, user_id, body, created_at, app_users:app_users!spotlight_comments_user_id_fkey(full_name, email)',
      )
      .eq('spotlight_id', spotlightId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[spotlight-comments] load failed:', error.message)
      comments.value = []
    } else {
      comments.value = ((data ?? []) as unknown as CommentRow[]).map(rowToComment)
    }
    loading.value = false
  }

  async function post(spotlightId: string, body: string): Promise<boolean> {
    const auth = useAuthStore()
    const trimmed = body.trim()
    if (!trimmed || !auth.appUser) return false

    if (auth.usingDevStub) {
      const c: ThreadComment = {
        id: crypto.randomUUID(),
        userId: auth.appUser.id,
        authorName: auth.appUser.fullName,
        authorInitials: auth.appUser.initials,
        body: trimmed,
        createdAt: new Date().toISOString(),
      }
      comments.value = [...comments.value, c]
      try {
        const all = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}')
        all[spotlightId] = comments.value
        localStorage.setItem(DEV_KEY, JSON.stringify(all))
      } catch {
        /* quota */
      }
      return true
    }

    const { data, error } = await supabase
      .from('spotlight_comments')
      .insert({ spotlight_id: spotlightId, user_id: auth.appUser.id, body: trimmed })
      .select(
        'id, spotlight_id, user_id, body, created_at, app_users:app_users!spotlight_comments_user_id_fkey(full_name, email)',
      )
      .single()
    if (error) {
      console.error('[spotlight-comments] post failed:', error.message)
      return false
    }
    comments.value = [...comments.value, rowToComment(data as unknown as CommentRow)]
    return true
  }

  async function remove(spotlightId: string, commentId: string): Promise<void> {
    const auth = useAuthStore()

    if (auth.usingDevStub) {
      comments.value = comments.value.filter((c) => c.id !== commentId)
      try {
        const all = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}')
        all[spotlightId] = comments.value
        localStorage.setItem(DEV_KEY, JSON.stringify(all))
      } catch {
        /* quota */
      }
      return
    }

    const { error } = await supabase.from('spotlight_comments').delete().eq('id', commentId)
    if (error) {
      console.error('[spotlight-comments] delete failed:', error.message)
      return
    }
    comments.value = comments.value.filter((c) => c.id !== commentId)
  }

  return { comments, loading, load, post, remove }
}
