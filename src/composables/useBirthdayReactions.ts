import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Heart-reaction state for the daily birthday list.
 *
 * Real-session mode: backed by `birthday_reactions` table — counts and
 * "you reacted" status aggregate across every signed-in crew member.
 * Dev-stub mode: backed by localStorage so dev iteration keeps state
 * across reloads without a real session.
 *
 * Toggle is optimistic — the local cache flips immediately, then the
 * INSERT/DELETE round-trips. On error we roll back so the UI ends up
 * matching the DB.
 *
 * Comments / message threads are intentionally NOT shipped here —
 * Phase 2 backlog item with admin moderation.
 */

const STORAGE_KEY = 'wcems:birthday-reactions'

type ReactionState = Record<string, string[]>

const state = ref<ReactionState>({})
const ready = ref(false)
let loadStarted = false

function makeKey(isoDate: string, personKey: string) {
  return `${isoDate}::${personKey}`
}

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
    /* quota exceeded — silently no-op */
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

  /* Clean up the legacy dev key so it doesn't shadow real DB state. */
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }

  const { data, error } = await supabase
    .from('birthday_reactions')
    .select('birthday_date, person_key, user_id')
  if (error) {
    console.error('[birthday-reactions] failed to load:', error.message)
    ready.value = true
    return
  }

  const next: ReactionState = {}
  for (const r of (data ?? []) as Array<{
    birthday_date: string
    person_key: string
    user_id: string
  }>) {
    const key = makeKey(r.birthday_date, r.person_key)
    if (!next[key]) next[key] = []
    next[key].push(r.user_id)
  }
  state.value = next
  ready.value = true

  subscribeRealtime()
}

/**
 * Live INSERT/DELETE updates from `birthday_reactions`. Same idempotent
 * presence-check pattern as photo reactions.
 */
function subscribeRealtime() {
  const channel = supabase
    .channel('birthday_reactions')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'birthday_reactions' },
      (payload) => {
        const row = payload.new as {
          birthday_date: string
          person_key: string
          user_id: string
        }
        const key = makeKey(row.birthday_date, row.person_key)
        const list = state.value[key] ? [...state.value[key]] : []
        if (list.includes(row.user_id)) return
        list.push(row.user_id)
        state.value = { ...state.value, [key]: list }
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'birthday_reactions' },
      (payload) => {
        const row = payload.old as {
          birthday_date?: string
          person_key?: string
          user_id?: string
        }
        if (!row.birthday_date || !row.person_key || !row.user_id) return
        const key = makeKey(row.birthday_date, row.person_key)
        const list = state.value[key]
        if (!list) return
        const next = list.filter((id) => id !== row.user_id)
        if (next.length === list.length) return
        const cloned = { ...state.value }
        if (next.length === 0) delete cloned[key]
        else cloned[key] = next
        state.value = cloned
      },
    )
    .subscribe()
  return channel
}

export function useBirthdayReactions() {
  const auth = useAuthStore()
  void load()

  /* Read the current user's id live at every call. The previous shape
     took it as an arg captured at component setup; if auth.appUser
     hadn't finished loading yet, components captured the fallback
     'anonymous' string and every insert failed RLS. */
  function currentId(): string | null {
    return auth.appUser?.id ?? null
  }

  function getCount(isoDate: string, personKey: string): number {
    return state.value[makeKey(isoDate, personKey)]?.length ?? 0
  }

  function hasReacted(isoDate: string, personKey: string): boolean {
    const id = currentId()
    if (!id) return false
    return state.value[makeKey(isoDate, personKey)]?.includes(id) ?? false
  }

  async function toggle(isoDate: string, personKey: string) {
    const id = currentId()
    if (!id) {
      console.warn('[birthday-reactions] toggle ignored — not signed in')
      return
    }
    const key = makeKey(isoDate, personKey)
    const before = state.value
    const next = { ...state.value }
    const list = next[key] ? [...next[key]] : []
    const i = list.indexOf(id)
    const wasReacted = i >= 0
    if (wasReacted) list.splice(i, 1)
    else list.push(id)
    if (list.length === 0) delete next[key]
    else next[key] = list
    state.value = next

    if (auth.usingDevStub) {
      persistToLocalStorage()
      return
    }

    const { error } = wasReacted
      ? await supabase
          .from('birthday_reactions')
          .delete()
          .eq('birthday_date', isoDate)
          .eq('person_key', personKey)
          .eq('user_id', id)
      : await supabase
          .from('birthday_reactions')
          .insert({
            birthday_date: isoDate,
            person_key: personKey,
            user_id: id,
          })
    if (error) {
      console.error('[birthday-reactions] toggle failed:', error.message)
      state.value = before
    }
  }

  return { getCount, hasReacted, toggle, ready }
}
