import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Question of the Week — the currently-published question, the recent
 * history (streaks count against it), and the answer key.
 *
 * Module singleton. Admins manage the queue on /admin/qotw with
 * direct queries (ManageQotwView); this composable serves the
 * dashboard card. Realtime on qotw_questions flips the card Monday
 * morning without a reload.
 *
 * Answer keys live in qotw_answer_keys and are RLS-gated: readable
 * only after YOU answered (vote/comment), after archive, or as admin.
 * loadKey() quietly comes back empty until then — the card calls it
 * right after the member answers.
 *
 * Dev-stub: a canned quiz poll with a key.
 */

export interface QotwQuestion {
  id: string
  prompt: string
  kind: 'text' | 'poll'
  options: string[] | null
  publishedAt: string | null
  weekOf: string | null
  status: 'published' | 'archived'
}

export interface QotwAnswerKey {
  correctOption: number | null
  teachingPoint: string | null
}

interface QuestionRow {
  id: string
  prompt: string
  kind: 'text' | 'poll'
  options: string[] | null
  published_at: string | null
  week_of: string | null
  status: 'published' | 'archived'
}

const DEV_STUB_QUESTION: QotwQuestion = {
  id: 'dev-qotw-1',
  prompt: 'A CHF patient on CPAP suddenly drops their pressure. First move?',
  kind: 'poll',
  options: ['Increase PEEP', 'Pull CPAP, assist with BVM', 'Push fluids wide open', 'Nitro SL now'],
  publishedAt: new Date().toISOString(),
  weekOf: new Date().toISOString().slice(0, 10),
  status: 'published',
}
const DEV_STUB_KEY: QotwAnswerKey = {
  correctOption: 1,
  teachingPoint:
    'CPAP is preload-dependent — hypotension means the pressure support is now hurting them. Pull it, assist ventilations, and reassess before anything else. Protocol 4.3.',
}

const current = ref<QotwQuestion | null>(null)
/** Published + archived, newest first — streaks walk this. */
const recent = ref<QotwQuestion[]>([])
const keys = ref<Record<string, QotwAnswerKey | null>>({})
const ready = ref(false)
let loadStarted = false

function fromRow(r: QuestionRow): QotwQuestion {
  return {
    id: r.id,
    prompt: r.prompt,
    kind: r.kind,
    options: r.options,
    publishedAt: r.published_at,
    weekOf: r.week_of,
    status: r.status,
  }
}

async function fetchQuestions() {
  const { data, error } = await supabase
    .from('qotw_questions')
    .select('id, prompt, kind, options, published_at, week_of, status')
    .in('status', ['published', 'archived'])
    .order('published_at', { ascending: false })
    .limit(26)
  if (error) {
    console.error('[qotw] load failed:', error.message)
    return
  }
  const list = ((data ?? []) as QuestionRow[]).map(fromRow)
  recent.value = list
  current.value = list.find((q) => q.status === 'published') ?? null
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    current.value = DEV_STUB_QUESTION
    recent.value = [DEV_STUB_QUESTION]
    ready.value = true
    return
  }

  await fetchQuestions()
  ready.value = true

  /* Any change to the questions table can change which question is
     live (publish, archive, edit) — just refetch; it's a few rows. */
  supabase
    .channel('qotw_questions')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'qotw_questions' },
      () => void fetchQuestions(),
    )
    .subscribe()
}

export function useQotw() {
  const auth = useAuthStore()
  void load()

  /** Fetch a question's answer key. RLS returns nothing until the
   *  member has answered (or the question archived) — call again with
   *  force after they answer. Caches both hits and misses. */
  async function loadKey(questionId: string, force = false): Promise<QotwAnswerKey | null> {
    if (auth.usingDevStub) {
      keys.value = { ...keys.value, [questionId]: DEV_STUB_KEY }
      return DEV_STUB_KEY
    }
    if (!force && questionId in keys.value) return keys.value[questionId]
    const { data, error } = await supabase
      .from('qotw_answer_keys')
      .select('correct_option, teaching_point')
      .eq('question_id', questionId)
      .maybeSingle()
    const key =
      !error && data
        ? {
            correctOption: (data as { correct_option: number | null }).correct_option,
            teachingPoint: (data as { teaching_point: string | null }).teaching_point,
          }
        : null
    keys.value = { ...keys.value, [questionId]: key }
    return key
  }

  function keyFor(questionId: string): QotwAnswerKey | null {
    return keys.value[questionId] ?? null
  }

  return { current, recent, ready, keys, keyFor, loadKey, refresh: fetchQuestions }
}
