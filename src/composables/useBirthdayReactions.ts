import { ref, watch } from 'vue'

/**
 * Heart-reaction state for the daily birthday list.
 *
 * Phase 1: localStorage stub keyed by `YYYY-MM-DD::personKey`. Each
 * entry tracks the set of user IDs who tapped the heart so a user can
 * un-react and we can show a count + "you reacted" state. Reactions
 * scoped to the day cleanly expire on the next morning.
 *
 * Phase 2: swap the `load` / `persist` body to call
 * `supabase.from('birthday_reactions')`. The composable's public surface
 * (`getCount`, `hasReacted`, `toggle`) does not change.
 *
 * Comments / message threads are intentionally NOT shipped here — Justin
 * scoped that to Phase 2 once we have a real backend + admin moderation.
 */

const STORAGE_KEY = 'wcems:birthday-reactions'

type ReactionState = Record<string, string[]>

function load(): ReactionState {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ReactionState) : {}
  } catch {
    return {}
  }
}

function persist(state: ReactionState) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota exceeded — silently no-op; counts stay in-memory for session */
  }
}

const state = ref<ReactionState>(load())
watch(state, (val) => persist(val), { deep: true })

function makeKey(isoDate: string, personKey: string) {
  return `${isoDate}::${personKey}`
}

export function useBirthdayReactions(currentUserId: string) {
  function getCount(isoDate: string, personKey: string): number {
    return state.value[makeKey(isoDate, personKey)]?.length ?? 0
  }

  function hasReacted(isoDate: string, personKey: string): boolean {
    return (
      state.value[makeKey(isoDate, personKey)]?.includes(currentUserId) ?? false
    )
  }

  function toggle(isoDate: string, personKey: string) {
    const key = makeKey(isoDate, personKey)
    const next = { ...state.value }
    const list = next[key] ? [...next[key]] : []
    const i = list.indexOf(currentUserId)
    if (i >= 0) {
      list.splice(i, 1)
    } else {
      list.push(currentUserId)
    }
    if (list.length === 0) delete next[key]
    else next[key] = list
    state.value = next
  }

  return { getCount, hasReacted, toggle }
}
