import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { allRows } from '@/lib/pagedSelect'
import { useAuthStore } from '@/stores/auth'
import { useQotwVotes } from '@/composables/useQotwVotes'

/**
 * Who has answered the Question of the Week — the competition layer.
 *
 * "Answered" = voted OR commented on a question. Three things come out
 * of it: per-shift participation counts on the current question (the
 * shift race), each person's streak (consecutive published questions
 * they answered, newest backwards), and the per-question participant
 * sets the admin breakdown uses.
 *
 * Comment pairs load once (paged per the 1,000-row convention) and
 * stay fresh via a realtime INSERT subscription; votes ride the
 * already-realtime useQotwVotes state. Shifts come from app_users
 * (synced daily from the schedule).
 */

export type ShiftLetter = 'A' | 'B' | 'C'

/* questionId -> Set of userIds who commented */
const commentersByQ = ref<Record<string, Set<string>>>({})
/* userId -> shift letter */
const shiftByUser = ref<Record<string, ShiftLetter>>({})
const ready = ref(false)
let loadStarted = false

const DEV_STUB_SHIFTS: Record<string, ShiftLetter> = {
  'dev-a': 'A',
  'dev-b': 'A',
  'dev-c': 'B',
  'dev-d': 'C',
  'dev-e': 'B',
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    shiftByUser.value = { ...DEV_STUB_SHIFTS, ...(auth.appUser?.id ? { [auth.appUser.id]: 'C' as ShiftLetter } : {}) }
    ready.value = true
    return
  }

  const [pairs, people] = await Promise.all([
    allRows<{ question_id: string; user_id: string; id: string }>((from, to) =>
      supabase
        .from('qotw_comments')
        .select('id, question_id, user_id')
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    supabase.from('app_users').select('id, shift').eq('active', true),
  ])

  if (!pairs.error) {
    const next: Record<string, Set<string>> = {}
    for (const r of pairs.rows) {
      if (!next[r.question_id]) next[r.question_id] = new Set()
      next[r.question_id].add(r.user_id)
    }
    commentersByQ.value = next
  }
  if (!people.error) {
    const next: Record<string, ShiftLetter> = {}
    for (const p of (people.data ?? []) as { id: string; shift: string | null }[]) {
      if (p.shift === 'A' || p.shift === 'B' || p.shift === 'C') next[p.id] = p.shift
    }
    shiftByUser.value = next
  }
  ready.value = true

  supabase
    .channel('qotw_participation')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qotw_comments' },
      (payload) => {
        const row = payload.new as { question_id: string; user_id: string }
        const set = new Set(commentersByQ.value[row.question_id] ?? [])
        if (set.has(row.user_id)) return
        set.add(row.user_id)
        commentersByQ.value = { ...commentersByQ.value, [row.question_id]: set }
      },
    )
    .subscribe()
}

export function useQotwParticipation() {
  const auth = useAuthStore()
  const votes = useQotwVotes()
  void load()

  /** Everyone who voted or commented on a question. */
  function participantsFor(questionId: string): Set<string> {
    const out = new Set<string>(commentersByQ.value[questionId] ?? [])
    for (const uid of votes.votersFor(questionId)) out.add(uid)
    return out
  }

  /** The shift race on one question: answered counts per shift. */
  function shiftCountsFor(questionId: string): Record<ShiftLetter, number> {
    const counts: Record<ShiftLetter, number> = { A: 0, B: 0, C: 0 }
    for (const uid of participantsFor(questionId)) {
      const s = shiftByUser.value[uid]
      if (s) counts[s]++
    }
    return counts
  }

  /** Consecutive answered questions, newest first. `questionIds` must
   *  be ordered current → oldest (published_at desc). */
  function streakFor(userId: string | null, questionIds: string[]): number {
    if (!userId) return 0
    let n = 0
    for (const qid of questionIds) {
      if (participantsFor(qid).has(userId)) n++
      else break
    }
    return n
  }

  const myId = computed(() => auth.appUser?.id ?? null)

  return { ready, participantsFor, shiftCountsFor, streakFor, myId }
}
