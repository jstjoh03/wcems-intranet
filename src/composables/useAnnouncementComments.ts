import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { ThreadComment } from '@/components/engagement/CommentThread.vue'

/**
 * Comment thread on an announcement (only announcements posted with
 * "allow comments" get one — first case: April's remission post, so
 * crews can pile on congratulations). Mirrors useSpotlightComments:
 * the list loads when the detail modal opens and posts append
 * optimistically; RLS enforces the allow-comments toggle server-side.
 *
 * Dev-stub: localStorage-backed so the flow is demoable offline.
 */

interface CommentRow {
  id: string
  announcement_id: string
  user_id: string
  body: string
  created_at: string
  app_users: { full_name: string | null; email: string | null } | null
}

const DEV_KEY = 'wcems:announcement-comments'

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

export function useAnnouncementComments() {
  const comments = ref<ThreadComment[]>([])
  const loading = ref(false)

  async function load(announcementId: string) {
    const auth = useAuthStore()
    loading.value = true

    if (auth.usingDevStub) {
      try {
        const all = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}')
        comments.value = all[announcementId] ?? []
      } catch {
        comments.value = []
      }
      loading.value = false
      return
    }

    const { data, error } = await supabase
      .from('announcement_comments')
      .select(
        'id, announcement_id, user_id, body, created_at, app_users:app_users!announcement_comments_user_id_fkey(full_name, email)',
      )
      .eq('announcement_id', announcementId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[announcement-comments] load failed:', error.message)
      comments.value = []
    } else {
      comments.value = ((data ?? []) as unknown as CommentRow[]).map(rowToComment)
    }
    loading.value = false
  }

  async function post(announcementId: string, body: string): Promise<boolean> {
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
        all[announcementId] = comments.value
        localStorage.setItem(DEV_KEY, JSON.stringify(all))
      } catch {
        /* quota */
      }
      return true
    }

    const { data, error } = await supabase
      .from('announcement_comments')
      .insert({ announcement_id: announcementId, user_id: auth.appUser.id, body: trimmed })
      .select(
        'id, announcement_id, user_id, body, created_at, app_users:app_users!announcement_comments_user_id_fkey(full_name, email)',
      )
      .single()
    if (error) {
      console.error('[announcement-comments] post failed:', error.message)
      return false
    }
    comments.value = [...comments.value, rowToComment(data as unknown as CommentRow)]
    return true
  }

  async function remove(announcementId: string, commentId: string): Promise<void> {
    const auth = useAuthStore()

    if (auth.usingDevStub) {
      comments.value = comments.value.filter((c) => c.id !== commentId)
      try {
        const all = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}')
        all[announcementId] = comments.value
        localStorage.setItem(DEV_KEY, JSON.stringify(all))
      } catch {
        /* quota */
      }
      return
    }

    const { error } = await supabase.from('announcement_comments').delete().eq('id', commentId)
    if (error) {
      console.error('[announcement-comments] delete failed:', error.message)
      return
    }
    comments.value = comments.value.filter((c) => c.id !== commentId)
  }

  return { comments, loading, load, post, remove }
}
