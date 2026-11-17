import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Poll votes on the Question of the Week.
 *
 * Module singleton, same shape as useBirthdayReactions: one bulk load,
 * optimistic writes with rollback, realtime INSERT/UPDATE/DELETE with
 * idempotent handlers. One vote per person per question (table PK);
 * tapping another option changes the vote via upsert.
 *
 * Dev-stub: localStorage for your vote + canned counts so the bars
 * render meaningfully.
 */

const STORAGE_KEY = 'wcems:qotw-votes'

/* questionId -> userId -> optionIndex */
type VoteState = Record<string, Record<string, number>>

const state = ref<VoteState>({})
const ready = ref(false)
let loadStarted = false

const DEV_STUB_BALLOTS: Record<string, number> = {
  'dev-a': 0,
  'dev-b': 0,
  'dev-c': 2,
  'dev-d': 1,
  'dev-e': 0,
}

function stubLoad() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    state.value = raw ? (JSON.parse(raw) as VoteState) : {}
  } catch {
    state.value = {}
  }
}

function stubPersist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
  } catch {
    /* quota — no-op */
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    stubLoad()
    /* Seed canned ballots so counts look alive in dev. */
    const q = 'dev-qotw-1'
    state.value = { [q]: { ...DEV_STUB_BALLOTS, ...(state.value[q] ?? {}) } }
    ready.value = true
    return
  }

  const { data, error } = await supabase
    .from('qotw_votes')
    .select('question_id, user_id, option_index')
  if (error) {
    console.error('[qotw-votes] load failed:', error.message)
    ready.value = true
    return
  }
  const next: VoteState = {}
  for (const r of (data ?? []) as Array<{
    question_id: string
    user_id: string
    option_index: number
  }>) {
    if (!next[r.question_id]) next[r.question_id] = {}
    next[r.question_id][r.user_id] = r.option_index
  }
  state.value = next
  ready.value = true

  supabase
    .channel('qotw_votes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'qotw_votes' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const row = payload.old as { question_id?: string; user_id?: string }
          if (!row.question_id || !row.user_id) return
          const q = state.value[row.question_id]
          if (!q || !(row.user_id in q)) return
          const nextQ = { ...q }
          delete nextQ[row.user_id]
          state.value = { ...state.value, [row.question_id]: nextQ }
          return
        }
        const row = payload.new as {
          question_id: string
          user_id: string
          option_index: number
        }
        const q = state.value[row.question_id] ?? {}
        if (q[row.user_id] === row.option_index) return
        state.value = {
          ...state.value,
          [row.question_id]: { ...q, [row.user_id]: row.option_index },
        }
      },
    )
    .subscribe()
}

export function useQotwVotes() {
  const auth = useAuthStore()
  void load()

  function currentId(): string | null {
    return auth.appUser?.id ?? null
  }

  /** Vote count per option index. */
  function counts(questionId: string, optionCount: number): number[] {
    const out = new Array(optionCount).fill(0)
    for (const idx of Object.values(state.value[questionId] ?? {})) {
      if (idx >= 0 && idx < optionCount) out[idx]++
    }
    return out
  }

  function totalVotes(questionId: string): number {
    return Object.keys(state.value[questionId] ?? {}).length
  }

  /** Everyone who voted on a question (the participation layer). */
  function votersFor(questionId: string): string[] {
    return Object.keys(state.value[questionId] ?? {})
  }

  /** userId -> optionIndex for a question — the admin breakdown. */
  function ballotsFor(questionId: string): Record<string, number> {
    return state.value[questionId] ?? {}
  }

  function myVote(questionId: string): number | null {
    const id = currentId()
    if (!id) return null
    const v = state.value[questionId]?.[id]
    return typeof v === 'number' ? v : null
  }

  async function vote(questionId: string, optionIndex: number) {
    const id = currentId()
    if (!id || auth.isKiosk) return
    const before = state.value
    const q = { ...(state.value[questionId] ?? {}) }
    if (q[id] === optionIndex) return /* tapping your own choice again is a no-op */
    q[id] = optionIndex
    state.value = { ...state.value, [questionId]: q }

    if (auth.usingDevStub) {
      stubPersist()
      return
    }

    const { error } = await supabase
      .from('qotw_votes')
      .upsert(
        { question_id: questionId, user_id: id, option_index: optionIndex },
        { onConflict: 'question_id,user_id' },
      )
    if (error) {
      console.error('[qotw-votes] vote failed:', error.message)
      state.value = before
    }
  }

  return { counts, totalVotes, myVote, vote, votersFor, ballotsFor, ready }
}
