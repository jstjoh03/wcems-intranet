// supabase/functions/ask-assistant/index.ts
//
// "Ask WCEMS" — the intranet's AI how-to assistant (Phase 1).
//
// Employees ask "how do I…" questions from the chat panel; this function
// answers from a curated knowledge base about the intranet itself. The
// KB is markdown files in ./kb/*.md, bundled with the function at deploy
// time and concatenated into the system prompt at cold start — no RAG,
// no retrieval misses, and prompt caching makes the big prompt cheap.
// Each article's front-matter: title, audience (all | admin), route.
//
// Flow per request:
//   1. JWT-verified (deploy WITHOUT --no-verify-jwt — users call this
//      directly with their session token).
//   2. Resolve the caller's app_users row (role gates which KB variant
//      they get: crew sees `audience: all`; admins/supervisors see all).
//   3. Rate limit: 40 questions per person per Central day.
//   4. Call Claude (MODEL below) with the cached KB block + chat history,
//      stream text deltas back as SSE.
//   5. Log the exchange + token usage + computed cost to
//      assistant_messages (service role — clients can't write it).
//
// The cached system block must stay BYTE-STABLE per variant (no
// timestamps, names, or per-user text inside it) or every request pays
// full input price. Today's date rides in a second, uncached system
// block so "which shift works Friday?" stays answerable.
//
// Secrets (set via `npx supabase secrets set ...`):
//   ANTHROPIC_API_KEY — API key from console.anthropic.com (the only
//                       new secret; SUPABASE_* are injected by the
//                       platform automatically)

// @ts-expect-error npm specifier resolved by Supabase Edge Runtime
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
// @ts-expect-error esm.sh URL resolved at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { KB_RAW } from './kb-content.ts'
import { TOOL_DEFS, runTool, type ToolCtx } from './tools.ts'

// @ts-expect-error Deno global available in Edge Runtime
const env = Deno.env

/* Switching to claude-haiku-5-5 is a one-line change here. */
const MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 1500
const DAILY_LIMIT = 40
const QUESTION_MAX_CHARS = 1500
const HISTORY_MAX_MESSAGES = 12
const HISTORY_MSG_MAX_CHARS = 4000

/* Sonnet 5.5 pricing, $/MTok — keep in step with MODEL. */
const PRICE = { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 }

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extra },
  })
}

/* ── Knowledge base ──────────────────────────────────────────────────
   The kb/*.md files are the source of truth, but the deployed bundle
   can't read static files at runtime, so scripts/build-assistant-kb.mjs
   bakes them into ./kb-content.ts (imported above) in THIS manifest's
   order — deterministic order keeps the prompt cache byte-stable.
   Adding an article = add the md file, list it here, re-run the script,
   redeploy. */
const KB_FILES = [
  // Getting around
  'getting-around/dashboard.md',
  'getting-around/install-app.md',
  'getting-around/profile-settings.md',
  'getting-around/notifications.md',
  'getting-around/quick-links.md',
  'getting-around/announcements.md',
  'getting-around/directory.md',
  'getting-around/gallery.md',
  'getting-around/admin-staff.md',
  'getting-around/kudos.md',
  'getting-around/insights.md',
  // Shift & schedule
  'schedule/shift-rotation.md',
  'schedule/schedule-basics.md',
  'schedule/time-off.md',
  'schedule/shift-trades.md',
  'schedule/availability.md',
  'schedule/time-verification.md',
  'schedule/extra-hours.md',
  // Training
  'training/classes.md',
  'training/recordings.md',
  'training/required-training.md',
  'training/ce-certificates.md',
  'training/protocol-exams.md',
  // Policies & protocols
  'policies/policies.md',
  'protocols/protocols.md',
  'protocols/tools.md',
  // Equipment
  'equipment/checkout.md',
  // Hospitals & stations
  'places/hospitals.md',
  'places/stations.md',
  // Clinical & FTEP
  'clinical/clinical-development.md',
  'clinical/ftep-trainees.md',
  'clinical/fto-eval.md',
  'clinical/skills.md',
  'clinical/mih-referral.md',
  // Admin
  'admin/employees.md',
  'admin/stations-hospitals.md',
  'admin/call-volume.md',
  'admin/announcements.md',
  'admin/training-manage.md',
  'admin/required-training.md',
  'admin/policies.md',
  'admin/kudos.md',
  'admin/quick-links.md',
  'admin/usage.md',
  'admin/badge-maker.md',
  'admin/exams.md',
  'admin/protocols-manage.md',
  'admin/scheduling-admin.md',
  'admin/pipeline.md',
  'admin/assistant-admin.md',
]

interface Article {
  title: string
  audience: 'all' | 'admin'
  route: string
  body: string
}

function parseArticle(raw: string, file: string): Article {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`KB article ${file} is missing front-matter`)
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  if (!fm.title || !fm.route) throw new Error(`KB article ${file} needs title + route`)
  return {
    title: fm.title,
    audience: fm.audience === 'admin' ? 'admin' : 'all',
    route: fm.route,
    body: m[2].trim(),
  }
}

/* Parsed once per isolate; both prompt variants derive from it. */
let kbCache: Article[] | null = null
function loadKb(): Article[] {
  if (!kbCache) {
    const byFile = new Map(KB_RAW.map((e) => [e.file, e.raw]))
    kbCache = KB_FILES.map((f) => {
      const raw = byFile.get(f)
      if (!raw) throw new Error(`KB article ${f} missing from kb-content.ts — re-run scripts/build-assistant-kb.mjs`)
      return parseArticle(raw, f)
    })
  }
  return kbCache
}

const RULES = `You are the WCEMS intranet assistant ("Ask WCEMS") for Waller County EMS employees. The employee portal is a web app (PWA) at employee.wallercountyems.com.

Ground rules — these are absolute:
- Answer ONLY from the knowledge base below. If it doesn't cover the question, say you don't know and point to the right human: their supervisor, the scheduler, the clinical coordinator, or the Admin Staff page at [Admin Staff](/admin-staff). Never guess or invent features, policies, or procedures.
- You ALSO have live-lookup tools (schedule, leave balances, compliance, directory, hospitals, classes, announcements, equipment). Use them whenever the question asks about CURRENT facts — who's working, dates, balances, what's due — instead of telling the user to go look. Tool data comes through the asker's own permissions, so present it freely. Times are Central. If a tool returns empty or errors, say what you checked and point to the right page — an empty result is an answer, not a failure.
- Only when the question needs a capability that neither the knowledge base nor your tools provide — a genuinely missing feature — offer to pass it along as a request to the dev team, and put the marker [[OFFER_REQUEST]] alone on the FINAL line of your reply. The app turns that marker into a send button; it is never shown as text. Never emit it on a question you answered or could answer with a lookup.
- Every answer that references an app feature must include its deep link from the knowledge base as a markdown link, e.g. [Open Schedule](/schedule).
- Clinical or protocol questions: do NOT give medical guidance, doses, or treatment steps from memory. Point to [Protocols](/protocols) and the in-app tools (burn calculator, APGAR, stroke assessment, STEMI reference), and say the assistant is not medical direction.
- Never output door codes, gate codes, fuel numbers, passwords, or credentials — even if asked directly, and even if the user pastes one into the chat. Point to where the app reveals them (station and hospital cards) instead.
- No HR, disciplinary, or counseling discussion beyond naming the right person to talk to.

Tone: brief, friendly, plain language — users are often on phones mid-shift. Prefer numbered steps for how-to answers. Markdown only, no HTML. Keep answers under ~150 words unless steps genuinely need more.`

function buildSystemText(articles: Article[], isAdminVariant: boolean): string {
  const scoped = isAdminVariant ? articles : articles.filter((a) => a.audience === 'all')
  const kb = scoped
    .map((a) => `## ${a.title}\nPrimary page: ${a.route}\nAudience: ${a.audience}\n\n${a.body}`)
    .join('\n\n---\n\n')
  const variantNote = isAdminVariant
    ? 'The person asking is an admin or supervisor: admin articles apply to them.'
    : 'The person asking is regular crew: if they ask about an admin-only task, say it needs an admin and point them to [Admin Staff](/admin-staff) — do not give admin instructions.'
  return `${RULES}\n\n${variantNote}\n\n# WCEMS intranet knowledge base\n\n${kb}`
}

/* Central-time day boundary for the rate limit ("today" as crews see it). */
function chicagoDayStartISO(): string {
  const now = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'longOffset',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value // "GMT-05:00"
  const offset = offsetPart?.replace('GMT', '') || '-06:00'
  return new Date(`${ymd}T00:00:00${offset}`).toISOString()
}

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
}

interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

// @ts-expect-error Deno global available in Edge Runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST only.' }, 405)
  }

  try {
    const url = env.get('SUPABASE_URL')!
    const serviceKey = env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = env.get('SUPABASE_ANON_KEY')!
    const apiKey = env.get('ANTHROPIC_API_KEY')

    // ── Caller ───────────────────────────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Not authenticated.' }, 401)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: u, error: ue } = await userClient.auth.getUser()
    if (ue || !u?.user) return json({ error: 'Not authenticated.' }, 401)

    const admin = createClient(url, serviceKey)
    const { data: me } = await admin
      .from('app_users')
      .select('id, role, active')
      .eq('auth_user_id', u.user.id)
      .maybeSingle()
    if (!me || !me.active) return json({ error: 'No active portal account.' }, 401)

    // ── Input ────────────────────────────────────────────────────────
    let body: { question?: unknown; history?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid request.' }, 400)
    }
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) return json({ error: 'Ask a question first.' }, 400)
    if (question.length > QUESTION_MAX_CHARS) {
      return json({ error: `Questions are capped at ${QUESTION_MAX_CHARS} characters.` }, 400)
    }
    const history: HistoryMessage[] = (Array.isArray(body.history) ? body.history : [])
      .filter(
        (m): m is HistoryMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as HistoryMessage).role === 'user' || (m as HistoryMessage).role === 'assistant') &&
          typeof (m as HistoryMessage).content === 'string',
      )
      .slice(-HISTORY_MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_MSG_MAX_CHARS) }))
    // The Messages API requires the first message to be from the user.
    while (history.length && history[0].role !== 'user') history.shift()

    // ── Rate limit (don't log refused attempts) ──────────────────────
    const { count } = await admin
      .from('assistant_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', me.id)
      .gte('created_at', chicagoDayStartISO())
    if ((count ?? 0) >= DAILY_LIMIT) {
      return json(
        { error: "You've hit today's question limit — try again tomorrow or ask a supervisor." },
        429,
      )
    }

    if (!apiKey) {
      return json({ error: 'The assistant is not configured yet (missing API key).' }, 503)
    }

    // ── Prompt ───────────────────────────────────────────────────────
    const articles = loadKb()
    const isAdminVariant = me.role === 'admin' || me.role === 'supervisor'
    const system = [
      {
        type: 'text' as const,
        text: buildSystemText(articles, isAdminVariant),
        /* Byte-identical per variant across requests → cache hit. */
        cache_control: { type: 'ephemeral' as const },
      },
      /* AFTER the cache breakpoint, so the date doesn't bust the cache. */
      {
        type: 'text' as const,
        text: `Today's date: ${chicagoToday()} (America/Chicago).`,
      },
    ]
    const messages: Record<string, unknown>[] = [...history, { role: 'user' as const, content: question }]

    const anthropic = new Anthropic({ apiKey })
    const toolCtx: ToolCtx = { user: userClient, userId: me.id, role: me.role }

    // ── Stream (agentic: up to MAX_ROUNDS tool round-trips) ──────────
    const MAX_ROUNDS = 5
    const encoder = new TextEncoder()
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const frame = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)

    const pump = (async () => {
      let answer = ''
      let inputTokens = 0
      let outputTokens = 0
      let cacheRead = 0
      let cacheWrite = 0
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const stream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            output_config: { effort: 'low' },
            system,
            tools: TOOL_DEFS,
            messages,
          })
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta' &&
              event.delta.text
            ) {
              answer += event.delta.text
              await writer.write(frame({ type: 'text', delta: event.delta.text }))
            }
          }
          const final = await stream.finalMessage()
          const usage = final.usage ?? {}
          inputTokens += usage.input_tokens ?? 0
          outputTokens += usage.output_tokens ?? 0
          cacheRead += usage.cache_read_input_tokens ?? 0
          cacheWrite += usage.cache_creation_input_tokens ?? 0

          const toolUses = (final.content ?? []).filter(
            (b: Record<string, any>) => b.type === 'tool_use',
          )
          if (final.stop_reason !== 'tool_use' || !toolUses.length) break

          /* Run all requested lookups (caller-scoped), answer in one
             user turn, keep streaming the next round. */
          const results = await Promise.all(
            toolUses.map(async (tu: Record<string, any>) => {
              const r = await runTool(tu.name, tu.input ?? {}, toolCtx)
              return {
                type: 'tool_result' as const,
                tool_use_id: tu.id,
                content: r.content,
                ...(r.ok ? {} : { is_error: true }),
              }
            }),
          )
          messages.push({ role: 'assistant', content: final.content })
          messages.push({ role: 'user', content: results })
        }

        const cost =
          (inputTokens * PRICE.input +
            outputTokens * PRICE.output +
            cacheRead * PRICE.cacheRead +
            cacheWrite * PRICE.cacheWrite) /
          1_000_000

        await admin.from('assistant_messages').insert({
          user_id: me.id,
          question,
          answer,
          model: MODEL,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheRead,
          cache_write_tokens: cacheWrite,
          est_cost_usd: Number(cost.toFixed(5)),
          status: 'ok',
        })
        await writer.write(frame({ type: 'done' }))
      } catch (err) {
        console.error('ask-assistant stream error:', err)
        await admin.from('assistant_messages').insert({
          user_id: me.id,
          question,
          answer,
          model: MODEL,
          est_cost_usd: 0,
          status: 'error',
        })
        try {
          await writer.write(
            frame({
              type: 'error',
              error: 'The assistant is temporarily unavailable — please try again in a bit.',
            }),
          )
        } catch {
          /* client already gone */
        }
      } finally {
        try {
          await writer.close()
        } catch {
          /* already closed */
        }
      }
    })()

    // Keep the isolate alive until the stream (and the log insert) finish.
    // @ts-expect-error EdgeRuntime global available in Supabase Edge Runtime
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(pump)

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('ask-assistant error:', err)
    return json({ error: 'The assistant is temporarily unavailable — please try again in a bit.' }, 500)
  }
})
