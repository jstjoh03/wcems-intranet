// supabase/functions/exam-import/index.ts
//
// One-shot importer for protocol exam content: POST the parsed exam
// JSON ({title, slug, timeLimitMinutes, passingPct, instructions,
// questions, answers, refs}) and it upserts exam_definitions (questions
// only — no answers) + exam_answer_keys, keyed by slug. Exam content
// stays out of the repo (controlled testing material); this function
// holds no content itself.
//
// Auth: ?secret=<ROSTER_SYNC_SECRET>.

// @ts-expect-error resolved by Edge Runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// @ts-expect-error Deno global
const env = Deno.env

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405 })
  }
  const url = new URL(req.url)
  const secret = env.get('ROSTER_SYNC_SECRET')
  if (!secret || url.searchParams.get('secret') !== secret) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
  }

  let body: {
    title: string
    slug: string
    timeLimitMinutes?: number
    passingPct?: number
    instructions?: string
    questions: unknown[]
    answers: Record<string, string>
    refs?: Record<string, string>
  }
  try {
    body = await req.json()
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `Bad JSON: ${(e as Error).message}` }), { status: 400 })
  }
  if (!body.slug || !body.title || !Array.isArray(body.questions) || !body.answers) {
    return new Response(JSON.stringify({ ok: false, error: 'slug, title, questions, answers required' }), { status: 400 })
  }

  const supabase = createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: def, error: defErr } = await supabase
    .from('exam_definitions')
    .upsert(
      {
        title: body.title,
        slug: body.slug,
        time_limit_minutes: body.timeLimitMinutes ?? 120,
        passing_pct: body.passingPct ?? 85,
        instructions: body.instructions ?? null,
        questions: body.questions,
        active: true,
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single()
  if (defErr) return new Response(JSON.stringify({ ok: false, error: defErr.message }), { status: 500 })

  const { error: keyErr } = await supabase
    .from('exam_answer_keys')
    .upsert({ exam_id: def.id, answers: body.answers, refs: body.refs ?? null }, { onConflict: 'exam_id' })
  if (keyErr) return new Response(JSON.stringify({ ok: false, error: keyErr.message }), { status: 500 })

  return new Response(
    JSON.stringify({ ok: true, examId: def.id, questions: body.questions.length, keyed: Object.keys(body.answers).length }),
    { status: 200 },
  )
})
