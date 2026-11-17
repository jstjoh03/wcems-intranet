import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { allRows } from '@/lib/pagedSelect'
import { platoonFor } from '@/composables/useSchedule'
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
 * Shift attribution (Justin, 2026-11-17): a FULL-TIMER with a shift
 * letter counts toward that shift. Everyone else — part-timers,
 * volunteers, third riders, anyone without a fixed letter — counts
 * toward whichever shift was ON DUTY (agency rotation, platoonFor) on
 * the Central date of their FIRST answer to that question: they ride
 * with that day's crew, so that's whose number they boost.
 *
 * Comment pairs and vote timestamps load once (paged per the
 * 1,000-row convention) and stay fresh via realtime INSERTs; vote
 * membership rides the already-realtime useQotwVotes state.
 */

export type ShiftLetter = 'A' | 'B' | 'C'

/* questionId -> Set of userIds who commented */
const commentersByQ = ref<Record<string, Set<string>>>({})
/* userId -> fixed shift letter (app_users, synced from the schedule) */
const shiftByUser = ref<Record<string, ShiftLetter>>({})
/* userId -> employment_type */
const employmentByUser = ref<Record<string, string>>({})
/* `${questionId}::${userId}` -> Central date of their FIRST answer */
const answerDate = ref<Record<string, string>>({})
const ready = ref(false)
let loadStarted = false

const DEV_STUB_SHIFTS: Record<string, ShiftLetter> = {
  'dev-a': 'A',
  'dev-b': 'A',
  'dev-c': 'B',
  'dev-d': 'C',
  'dev-e': 'B',
}

function centralDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

function noteAnswer(questionId: string, userId: string, ts: string) {
  const key = `${questionId}::${userId}`
  const d = centralDate(ts)
  const prev = answerDate.value[key]
  if (!prev || d < prev) answerDate.value = { ...answerDate.value, [key]: d }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    shiftByUser.value = { ...DEV_STUB_SHIFTS }
    for (const id of Object.keys(DEV_STUB_SHIFTS)) employmentByUser.value[id] = 'full_time'
    if (auth.appUser?.id) {
      /* The stub viewer is a part-timer — exercises day-of-answer. */
      employmentByUser.value[auth.appUser.id] = 'part_time'
    }
    ready.value = true
    return
  }

  const [pairs, ballots, people] = await Promise.all([
    allRows<{ question_id: string; user_id: string; created_at: string; id: string }>((from, to) =>
      supabase
        .from('qotw_comments')
        .select('id, question_id, user_id, created_at')
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    allRows<{ question_id: string; user_id: string; voted_at: string }>((from, to) =>
      supabase
        .from('qotw_votes')
        .select('question_id, user_id, voted_at')
        .order('question_id')
        .order('user_id')
        .range(from, to),
    ),
    supabase.from('app_users').select('id, shift, employment_type').eq('active', true),
  ])

  if (!pairs.error) {
    const next: Record<string, Set<string>> = {}
    for (const r of pairs.rows) {
      if (!next[r.question_id]) next[r.question_id] = new Set()
      next[r.question_id].add(r.user_id)
      noteAnswer(r.question_id, r.user_id, r.created_at)
    }
    commentersByQ.value = next
  }
  if (!ballots.error) {
    for (const r of ballots.rows) noteAnswer(r.question_id, r.user_id, r.voted_at)
  }
  if (!people.error) {
    const shifts: Record<string, ShiftLetter> = {}
    const emp: Record<string, string> = {}
    for (const p of (people.data ?? []) as { id: string; shift: string | null; employment_type: string | null }[]) {
      if (p.shift === 'A' || p.shift === 'B' || p.shift === 'C') shifts[p.id] = p.shift
      emp[p.id] = p.employment_type ?? 'full_time'
    }
    shiftByUser.value = shifts
    employmentByUser.value = emp
  }
  ready.value = true

  supabase
    .channel('qotw_participation')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qotw_comments' },
      (payload) => {
        const row = payload.new as { question_id: string; user_id: string; created_at: string }
        const set = new Set(commentersByQ.value[row.question_id] ?? [])
        if (!set.has(row.user_id)) {
          set.add(row.user_id)
          commentersByQ.value = { ...commentersByQ.value, [row.question_id]: set }
        }
        noteAnswer(row.question_id, row.user_id, row.created_at)
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qotw_votes' },
      (payload) => {
        const row = payload.new as { question_id: string; user_id: string; voted_at: string }
        noteAnswer(row.question_id, row.user_id, row.voted_at)
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

  /** Which shift this person's answer credits on this question. */
  function shiftCredit(questionId: string, userId: string): ShiftLetter | null {
    const fixed = shiftByUser.value[userId] ?? null
    const fullTime = (employmentByUser.value[userId] ?? 'full_time') === 'full_time'
    if (fullTime && fixed) return fixed
    const d =
      answerDate.value[`${questionId}::${userId}`] ??
      (auth.usingDevStub && userId === auth.appUser?.id
        ? centralDate(new Date().toISOString())
        : null)
    if (d) return platoonFor(d) as ShiftLetter
    return fixed
  }

  /** The shift race on one question: answered counts per shift. */
  function shiftCountsFor(questionId: string): Record<ShiftLetter, number> {
    const counts: Record<ShiftLetter, number> = { A: 0, B: 0, C: 0 }
    for (const uid of participantsFor(questionId)) {
      const s = shiftCredit(questionId, uid)
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
