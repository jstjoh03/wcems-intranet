import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Ask WCEMS — chat state + transport for the AI how-to assistant.
 *
 * The panel talks to the `ask-assistant` edge function with a direct
 * fetch (not supabase.functions.invoke) so the SSE stream can be read
 * incrementally. The function answers ONLY from its bundled knowledge
 * base; when it can't answer it ends the reply with the [[OFFER_REQUEST]]
 * marker, which we strip and turn into a "send this to the dev team"
 * card backed by assistant_feature_requests (plain RLS insert).
 *
 * Conversation lives in sessionStorage (keyed by user) so it survives
 * SPA navigation but not a tab close or another person signing in.
 */

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  /** Assistant couldn't answer — show the feature-request card. */
  offerRequest?: boolean
  /** The card was used (or dismissed) — collapse it. */
  requestSent?: boolean
  /** Transport/API failure bubble (kept out of the history we resend). */
  error?: boolean
}

const OFFER_MARKER = '[[OFFER_REQUEST]]'
const STORAGE_KEY = 'wcems:assistant-chat'
const HISTORY_LIMIT = 12
const DAILY_REQUEST_LIMIT = 5

/* Module singletons — the panel can be opened from any route. */
const messages = ref<AssistantMessage[]>([])
const open = ref(false)
const sending = ref(false)
const hydrated = ref(false)

function persist(userId: string | undefined) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId: userId ?? null, messages: messages.value }),
    )
  } catch {
    /* storage blocked — chat just won't survive navigation */
  }
}

function hydrate(userId: string | undefined) {
  if (hydrated.value) return
  hydrated.value = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { userId?: string | null; messages?: AssistantMessage[] }
    if (saved.userId === (userId ?? null) && Array.isArray(saved.messages)) {
      messages.value = saved.messages
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* malformed stash — start fresh */
  }
}

/** Strip a complete marker, or a trailing partial one mid-stream, so the
 *  marker text never flashes in the UI. */
function displayText(raw: string): string {
  let t = raw
  if (t.trimEnd().endsWith(OFFER_MARKER)) {
    t = t.trimEnd().slice(0, -OFFER_MARKER.length)
  } else {
    // Hide a trailing prefix of the marker while it streams in.
    for (let n = Math.min(OFFER_MARKER.length - 1, t.length); n > 0; n--) {
      if (t.endsWith(OFFER_MARKER.slice(0, n))) {
        t = t.slice(0, -n)
        break
      }
    }
  }
  return t.trimEnd()
}

export function useAssistant() {
  const auth = useAuthStore()
  hydrate(auth.appUser?.id)

  const starterChips = computed(() => {
    const chips = [
      "Who's on duty today?",
      "What's my leave balance?",
      'How do I request a day off?',
    ]
    if (auth.isAdmin) chips.push('How do I publish a new policy version?')
    else chips.push('How do shift trades work?')
    return chips
  })

  function reset() {
    messages.value = []
    persist(auth.appUser?.id)
  }

  async function send(question: string) {
    const q = question.trim()
    if (!q || sending.value) return
    sending.value = true

    messages.value.push({ role: 'user', content: q })
    // History = everything before the question we just pushed, errors
    // excluded (the server trims to 12 as well — keep the two in step).
    const history = messages.value
      .slice(0, -1)
      .filter((m) => !m.error)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.offerRequest ? `${m.content}\n${OFFER_MARKER}` : m.content,
      }))
    const reply: AssistantMessage = { role: 'assistant', content: '' }
    messages.value.push(reply)
    const live = messages.value[messages.value.length - 1]!
    persist(auth.appUser?.id)

    try {
      if (auth.usingDevStub) {
        await devStubAnswer(q, live)
        return
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('signed-out')

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-assistant`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ question: q, history }),
      })

      if (!res.ok) {
        let msg = 'The assistant is temporarily unavailable — please try again in a bit.'
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) msg = body.error
        } catch {
          /* non-JSON error body — keep the friendly default */
        }
        live.content = msg
        live.error = true
        return
      }

      const raw = await readAnswer(res, (sofar) => {
        live.content = displayText(sofar)
      })
      live.offerRequest = raw.trimEnd().endsWith(OFFER_MARKER)
      live.content = displayText(raw)
      if (!live.content) {
        live.content = 'Sorry — I came back empty on that one. Try rephrasing?'
        live.error = true
        live.offerRequest = false
      }
    } catch {
      live.content = 'The assistant is temporarily unavailable — please try again in a bit.'
      live.error = true
    } finally {
      sending.value = false
      persist(auth.appUser?.id)
    }
  }

  /** Read the reply body: SSE stream when the function streams, JSON
   *  fallback otherwise. Returns the full raw text (marker included). */
  async function readAnswer(res: Response, onProgress: (sofar: string) => void): Promise<string> {
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/event-stream')) {
      const body = (await res.json()) as { answer?: string }
      const answer = body.answer ?? ''
      onProgress(answer)
      return answer
    }

    const reader = res.body?.getReader()
    if (!reader) return ''
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('')
        if (!data) continue
        try {
          const evt = JSON.parse(data) as { type: string; delta?: string; error?: string }
          if (evt.type === 'text' && evt.delta) {
            answer += evt.delta
            onProgress(answer)
          } else if (evt.type === 'error') {
            throw new Error(evt.error ?? 'stream-error')
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue // partial/odd frame — skip
          throw e
        }
      }
    }
    return answer
  }

  /** Dev preview: canned, slowly-"streamed" answers so the panel is
   *  demoable offline. A question mentioning "dark mode" demos the
   *  feature-request card. */
  async function devStubAnswer(q: string, live: AssistantMessage) {
    const unanswerable = /dark mode|feature|can it|could the app/i.test(q)
    const canned = unanswerable
      ? "I don't know that one — it isn't covered in the WCEMS docs I have. For app questions like this, the dev team is the right contact."
      : 'Open **Schedule** from the masthead, then use the **Time off** tab to submit a request. Your supervisor approves it from the same page.\n\n[Open Schedule](/schedule)'
    for (let i = 0; i < canned.length; i += 6) {
      live.content = canned.slice(0, i + 6)
      await new Promise((r) => setTimeout(r, 12))
    }
    live.content = canned
    live.offerRequest = unanswerable
  }

  /** Count today's requests (own rows under RLS) for the soft limit. */
  async function requestsToday(): Promise<number> {
    if (auth.usingDevStub) return 0
    const id = auth.appUser?.id
    if (!id) return 0
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const { count } = await supabase
      .from('assistant_feature_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id)
      .gte('created_at', start.toISOString())
    return count ?? 0
  }

  /** Re-save the conversation (e.g. after the panel marks a request sent). */
  function persistNow() {
    persist(auth.appUser?.id)
  }

  /** Insert a feature request. Returns an error string or null. */
  async function sendFeatureRequest(question: string, note: string): Promise<string | null> {
    const id = auth.appUser?.id
    if (!id) return 'You need to be signed in for this.'
    if (auth.usingDevStub) return null
    if ((await requestsToday()) >= DAILY_REQUEST_LIMIT) {
      return "You've sent a few requests today already — try again tomorrow."
    }
    const { error } = await supabase.from('assistant_feature_requests').insert({
      user_id: id,
      question: question.trim(),
      note: note.trim() || null,
    })
    if (error) return 'Could not send that right now — please try again later.'
    return null
  }

  return {
    open,
    messages,
    sending,
    starterChips,
    send,
    reset,
    sendFeatureRequest,
    persistNow,
  }
}
