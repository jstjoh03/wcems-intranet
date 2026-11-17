import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Question of the Week — the currently-published question.
 *
 * Module singleton. Admins manage the queue on /admin/qotw with
 * direct queries (ManageQotwView); this composable only cares about
 * what the dashboard shows. Realtime on qotw_questions flips the card
 * Monday morning without a reload.
 *
 * Dev-stub: a canned poll question.
 */

export interface QotwQuestion {
  id: string
  prompt: string
  kind: 'text' | 'poll'
  options: string[] | null
  publishedAt: string | null
  weekOf: string | null
}

interface QuestionRow {
  id: string
  prompt: string
  kind: 'text' | 'poll'
  options: string[] | null
  published_at: string | null
  week_of: string | null
}

const DEV_STUB_QUESTION: QotwQuestion = {
  id: 'dev-qotw-1',
  prompt: 'Best station meal of the year so far — who cooked it and what was it?',
  kind: 'poll',
  options: ['Brisket night at S1', 'Fajita Friday', 'The gumbo', 'Waffle-iron everything'],
  publishedAt: new Date().toISOString(),
  weekOf: new Date().toISOString().slice(0, 10),
}

const current = ref<QotwQuestion | null>(null)
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
  }
}

async function fetchCurrent() {
  const { data, error } = await supabase
    .from('qotw_questions')
    .select('id, prompt, kind, options, published_at, week_of')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[qotw] load failed:', error.message)
    return
  }
  current.value = data ? fromRow(data as QuestionRow) : null
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    current.value = DEV_STUB_QUESTION
    ready.value = true
    return
  }

  await fetchCurrent()
  ready.value = true

  /* Any change to the questions table can change which question is
     live (publish, archive, edit) — just refetch; it's one tiny row. */
  supabase
    .channel('qotw_questions')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'qotw_questions' },
      () => void fetchCurrent(),
    )
    .subscribe()
}

export function useQotw() {
  void load()
  return { current, ready, refresh: fetchCurrent }
}
