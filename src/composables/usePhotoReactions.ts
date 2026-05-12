import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Heart-reaction state for gallery photos.
 *
 * Real-session: backed by `photo_reactions` table. Counts and the
 * current user's reacted-status are derived from a bulk SELECT that
 * runs once per session and is mutated optimistically on toggle.
 *
 * Dev-stub: localStorage. Mirrors useBirthdayReactions.
 *
 * One module-level cache so multiple consumers (dashboard carousel +
 * /gallery page + photo detail modal) share state.
 */

const STORAGE_KEY = 'wcems:photo-reactions'

/** photo_id → list of user_ids who reacted */
type ReactionState = Record<string, string[]>

const state = ref<ReactionState>({})
const ready = ref(false)
let loadStarted = false

function loadFromLocalStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) state.value = JSON.parse(raw) as ReactionState
  } catch {
    /* ignore corrupt local copy */
  }
}

function persistToLocalStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
  } catch {
    /* quota exceeded — no-op */
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true

  const auth = useAuthStore()

  if (auth.usingDevStub) {
    loadFromLocalStorage()
    ready.value = true
    return
  }

  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)

  const { data, error } = await supabase
    .from('photo_reactions')
    .select('photo_id, user_id')
  if (error) {
    console.error('[photo-reactions] failed to load:', error.message)
    ready.value = true
    return
  }

  const next: ReactionState = {}
  for (const r of (data ?? []) as Array<{ photo_id: string; user_id: string }>) {
    if (!next[r.photo_id]) next[r.photo_id] = []
    next[r.photo_id].push(r.user_id)
  }
  state.value = next
  ready.value = true

  subscribeRealtime()
}

/**
 * Subscribe to INSERT/DELETE events on `photo_reactions` and patch the
 * local cache. Naturally idempotent — applying the same INSERT or
 * DELETE twice (e.g. our own optimistic update plus the realtime echo)
 * is a no-op because we dedupe on user_id presence in the per-photo
 * array.
 */
function subscribeRealtime() {
  const channel = supabase
    .channel('photo_reactions')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'photo_reactions' },
      (payload) => {
        const row = payload.new as { photo_id: string; user_id: string }
        const list = state.value[row.photo_id] ? [...state.value[row.photo_id]] : []
        if (list.includes(row.user_id)) return
        list.push(row.user_id)
        state.value = { ...state.value, [row.photo_id]: list }
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'photo_reactions' },
      (payload) => {
        const row = payload.old as { photo_id?: string; user_id?: string }
        if (!row.photo_id || !row.user_id) return
        const list = state.value[row.photo_id]
        if (!list) return
        const next = list.filter((id) => id !== row.user_id)
        if (next.length === list.length) return
        const cloned = { ...state.value }
        if (next.length === 0) delete cloned[row.photo_id]
        else cloned[row.photo_id] = next
        state.value = cloned
      },
    )
    .subscribe()
  return channel
}

export function usePhotoReactions(currentUserId: string) {
  void load()

  function getCount(photoId: string): number {
    return state.value[photoId]?.length ?? 0
  }

  function hasReacted(photoId: string): boolean {
    return state.value[photoId]?.includes(currentUserId) ?? false
  }

  async function toggle(photoId: string) {
    const before = state.value
    const next = { ...state.value }
    const list = next[photoId] ? [...next[photoId]] : []
    const i = list.indexOf(currentUserId)
    const wasReacted = i >= 0
    if (wasReacted) list.splice(i, 1)
    else list.push(currentUserId)
    if (list.length === 0) delete next[photoId]
    else next[photoId] = list
    state.value = next

    const auth = useAuthStore()
    if (auth.usingDevStub) {
      persistToLocalStorage()
      return
    }

    const { error } = wasReacted
      ? await supabase
          .from('photo_reactions')
          .delete()
          .eq('photo_id', photoId)
          .eq('user_id', currentUserId)
      : await supabase
          .from('photo_reactions')
          .insert({ photo_id: photoId, user_id: currentUserId })
    if (error) {
      console.error('[photo-reactions] toggle failed:', error.message)
      state.value = before
    }
  }

  return { getCount, hasReacted, toggle, ready }
}
