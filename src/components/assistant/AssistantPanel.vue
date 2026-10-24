<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import {
  MessageCircleQuestion,
  X,
  Send,
  RotateCcw,
  Sparkles,
  CheckCircle2,
} from 'lucide-vue-next'
import { useAssistant, type AssistantMessage } from '@/composables/useAssistant'

/**
 * Ask WCEMS — floating trigger + chat panel.
 *
 * Mounted once in App.vue for every authenticated route (chromeless
 * sections included). Desktop: right-side slide-over. Mobile: full-screen
 * sheet. Answers come from the ask-assistant edge function via
 * useAssistant(); internal markdown links are intercepted and routed
 * through the SPA so "Open Schedule" doesn't reload the app.
 */

const router = useRouter()
const { open, messages, sending, starterChips, send, reset, sendFeatureRequest, persistNow } =
  useAssistant()

const draft = ref('')
const panelEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

/* ── Open/close + scroll lock + focus ──────────────────────────────── */

function openPanel() {
  open.value = true
}
function close() {
  open.value = false
}

watch(open, async (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : ''
  if (isOpen) {
    await nextTick()
    inputEl.value?.focus()
    scrollToEnd()
  }
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

/* Esc closes; Tab stays inside the dialog (simple focus trap). */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    return
  }
  if (e.key !== 'Tab' || !panelEl.value) return
  const focusables = panelEl.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]',
  )
  if (!focusables.length) return
  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

/* ── Messages ──────────────────────────────────────────────────────── */

marked.setOptions({ breaks: true })
function md(text: string): string {
  return marked.parse(text) as string
}

/** The user question that produced the assistant message at `idx` —
 *  what the feature-request card sends verbatim. */
function questionFor(idx: number): string {
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m?.role === 'user') return m.content
  }
  return ''
}

const showIntro = computed(() => messages.value.length === 0)
const typing = computed(() => {
  if (!sending.value) return false
  const last = messages.value[messages.value.length - 1]
  return last?.role === 'assistant' && last.content === ''
})

function scrollToEnd() {
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(
  () => messages.value.map((m) => m.content.length).join(','),
  async () => {
    await nextTick()
    scrollToEnd()
  },
)

async function submit() {
  const q = draft.value.trim()
  if (!q || sending.value) return
  draft.value = ''
  await send(q)
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void submit()
  }
}

/* Internal links navigate within the SPA and close the panel; external
 * links keep their default new-tab behavior (markdown is ours — rendered
 * the same way the protocols pages render theirs). */
function onBodyClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('/')) {
    e.preventDefault()
    close()
    void router.push(href)
  } else if (href) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener')
  }
}

/* ── Feature-request card ──────────────────────────────────────────── */

const reqNote = ref('')
const reqBusy = ref(false)
const reqError = ref('')
const reqSentIdx = ref<number[]>([])

async function sendRequest(idx: number, message: AssistantMessage) {
  if (reqBusy.value) return
  reqBusy.value = true
  reqError.value = ''
  const err = await sendFeatureRequest(questionFor(idx), reqNote.value)
  reqBusy.value = false
  if (err) {
    reqError.value = err
    return
  }
  message.requestSent = true
  reqSentIdx.value.push(idx)
  reqNote.value = ''
  persistNow()
}

/* Quiet manual path: "Suggest a feature" in the footer opens the same
 * card with an editable question field. */
const suggestOpen = ref(false)
const suggestQuestion = ref('')
const suggestNote = ref('')
const suggestBusy = ref(false)
const suggestError = ref('')
const suggestSent = ref(false)

async function sendSuggestion() {
  const q = suggestQuestion.value.trim()
  if (!q || suggestBusy.value) return
  suggestBusy.value = true
  suggestError.value = ''
  const err = await sendFeatureRequest(q, suggestNote.value)
  suggestBusy.value = false
  if (err) {
    suggestError.value = err
    return
  }
  suggestSent.value = true
  suggestQuestion.value = ''
  suggestNote.value = ''
  setTimeout(() => {
    suggestOpen.value = false
    suggestSent.value = false
  }, 2200)
}
</script>

<template>
  <!-- Floating trigger — hidden while the panel is open -->
  <button
    v-if="!open"
    type="button"
    class="asst-fab"
    aria-label="Ask WCEMS — AI assistant"
    @click="openPanel"
  >
    <span class="asst-fab__icon"><MessageCircleQuestion :size="19" :stroke-width="2" /></span>
    <span class="asst-fab__label">Ask WCEMS</span>
  </button>

  <Teleport to="body">
    <div v-if="open" class="asst" role="dialog" aria-modal="true" aria-label="Ask WCEMS assistant">
      <div class="asst__backdrop" @click="close" />
      <section ref="panelEl" class="asst__panel" @keydown="onKeydown">
        <header class="asst__head">
          <div class="asst__head-text">
            <h2 class="asst__title display">Ask WCEMS</h2>
            <p class="asst__sub">AI assistant — answers from WCEMS docs; not medical direction</p>
          </div>
          <div class="asst__head-actions">
            <button
              v-if="messages.length"
              type="button"
              class="asst__iconbtn"
              aria-label="Start a new conversation"
              title="New conversation"
              @click="reset"
            >
              <RotateCcw :size="16" :stroke-width="2" />
            </button>
            <button type="button" class="asst__iconbtn" aria-label="Close" @click="close">
              <X :size="18" :stroke-width="2" />
            </button>
          </div>
        </header>

        <div ref="scrollEl" class="asst__scroll" @click="onBodyClick">
          <!-- Empty state: intro + starter chips -->
          <div v-if="showIntro" class="asst__intro">
            <div class="asst__intro-icon"><Sparkles :size="20" :stroke-width="1.85" /></div>
            <p class="asst__intro-lead">
              Ask how to do anything in the portal — scheduling, training, policies, equipment —
              and I'll point you to the right page.
            </p>
            <div class="asst__chips">
              <button
                v-for="chip in starterChips"
                :key="chip"
                type="button"
                class="asst__chip"
                @click="send(chip)"
              >
                {{ chip }}
              </button>
            </div>
          </div>

          <!-- Conversation -->
          <template v-for="(m, idx) in messages" :key="idx">
            <div v-if="m.role === 'user'" class="asst__msg asst__msg--user">
              <div class="asst__bubble asst__bubble--user">{{ m.content }}</div>
            </div>
            <div v-else class="asst__msg asst__msg--bot">
              <div
                class="asst__bubble asst__bubble--bot"
                :class="{ 'asst__bubble--error': m.error }"
              >
                <div
                  v-if="m.content"
                  class="asst__md"
                  v-html="md(m.content)"
                />
                <div v-else-if="typing && idx === messages.length - 1" class="asst__typing" aria-label="Thinking">
                  <span /><span /><span />
                </div>
              </div>

              <!-- "Send to the dev team" card for unanswered questions -->
              <div v-if="m.offerRequest && !m.requestSent" class="asst__req">
                <p class="asst__req-lead">Want this added to the intranet? Send it to the dev team.</p>
                <textarea
                  v-model="reqNote"
                  class="asst__req-note"
                  rows="2"
                  placeholder="Anything to add? (optional)"
                />
                <p v-if="reqError" class="asst__req-error">{{ reqError }}</p>
                <div class="asst__req-actions">
                  <button
                    type="button"
                    class="asst__btn asst__btn--primary"
                    :disabled="reqBusy"
                    @click="sendRequest(idx, m)"
                  >
                    {{ reqBusy ? 'Sending…' : 'Send request' }}
                  </button>
                </div>
              </div>
              <p v-else-if="m.offerRequest && m.requestSent" class="asst__req-done">
                <CheckCircle2 :size="14" :stroke-width="2" />
                Sent — thanks, this is how the intranet gets better.
              </p>
            </div>
          </template>
        </div>

        <footer class="asst__foot">
          <!-- Quiet manual feature-request path -->
          <div v-if="suggestOpen" class="asst__req asst__req--footer">
            <p v-if="suggestSent" class="asst__req-done">
              <CheckCircle2 :size="14" :stroke-width="2" />
              Sent — thanks, this is how the intranet gets better.
            </p>
            <template v-else>
              <p class="asst__req-lead">Suggest a feature for the intranet</p>
              <textarea
                v-model="suggestQuestion"
                class="asst__req-note"
                rows="2"
                placeholder="What should the intranet do?"
              />
              <textarea
                v-model="suggestNote"
                class="asst__req-note"
                rows="1"
                placeholder="Extra context (optional)"
              />
              <p v-if="suggestError" class="asst__req-error">{{ suggestError }}</p>
              <div class="asst__req-actions">
                <button type="button" class="asst__btn asst__btn--ghost" @click="suggestOpen = false">
                  Cancel
                </button>
                <button
                  type="button"
                  class="asst__btn asst__btn--primary"
                  :disabled="suggestBusy || !suggestQuestion.trim()"
                  @click="sendSuggestion"
                >
                  {{ suggestBusy ? 'Sending…' : 'Send request' }}
                </button>
              </div>
            </template>
          </div>

          <div class="asst__composer">
            <textarea
              ref="inputEl"
              v-model="draft"
              class="asst__input"
              rows="1"
              maxlength="1500"
              placeholder="Ask a question…"
              :disabled="sending"
              @keydown="onComposerKeydown"
            />
            <button
              type="button"
              class="asst__send"
              aria-label="Send question"
              :disabled="sending || !draft.trim()"
              @click="submit"
            >
              <Send :size="17" :stroke-width="2" />
            </button>
          </div>
          <button
            v-if="!suggestOpen"
            type="button"
            class="asst__suggest"
            @click="suggestOpen = true"
          >
            Suggest a feature
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Floating trigger ─────────────────────────────────────────────── */
.asst-fab {
  position: fixed;
  z-index: 32;
  right: 16px;
  bottom: 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 10px 11px;
  border-radius: 999px;
  border: 1px solid var(--color-brand-700);
  background: var(--color-brand-600);
  color: white;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow:
    0 1px 2px oklch(0.18 0.015 260 / 0.16),
    0 8px 24px oklch(0.18 0.015 260 / 0.2);
  transition:
    transform 200ms var(--ease-out),
    background 200ms var(--ease-out);
}
.asst-fab:hover {
  background: var(--color-brand-700);
  transform: translateY(-2px);
}
.asst-fab__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900, oklch(0.2 0.05 250));
}
/* Phones: the quick-links dock pill is bottom-centered and wide, so the
   trigger goes icon-only (a compact circle in the corner clears it). */
@media (max-width: 767px) {
  .asst-fab {
    padding: 11px;
  }
  .asst-fab__label {
    display: none;
  }
}
/* Tablets (768–1023px): the dock pill moves to bottom-right — sit above it. */
@media (min-width: 768px) and (max-width: 1023px) {
  .asst-fab {
    bottom: 84px;
    right: 28px;
  }
}
@media (min-width: 1024px) {
  .asst-fab {
    right: 24px;
    bottom: 24px;
  }
}

/* ── Panel shell ──────────────────────────────────────────────────── */
.asst {
  position: fixed;
  inset: 0;
  z-index: 75;
}
.asst__backdrop {
  position: absolute;
  inset: 0;
  background: oklch(0.2 0.03 260 / 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: asst-fade 160ms var(--ease-out) both;
}
.asst__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-canvas);
  animation: asst-up 220ms var(--ease-out) both;
}
@media (min-width: 768px) {
  .asst__panel {
    inset: 0 0 0 auto;
    width: 420px;
    max-width: 92vw;
    border-left: 1px solid var(--color-line);
    box-shadow: -24px 0 60px oklch(0.18 0.015 260 / 0.18);
    animation: asst-in 220ms var(--ease-out) both;
  }
}
@keyframes asst-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes asst-in {
  from { transform: translateX(28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes asst-up {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .asst__backdrop,
  .asst__panel {
    animation: none;
  }
}

/* ── Header ───────────────────────────────────────────────────────── */
.asst__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  background: var(--color-brand-600);
  color: white;
}
.asst__title {
  font-size: 22px;
  line-height: 1.1;
  letter-spacing: 0.005em;
  color: white;
}
.asst__sub {
  margin-top: 3px;
  font-size: 11.5px;
  line-height: 1.35;
  color: oklch(0.86 0.025 86.8);
}
.asst__head-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.asst__iconbtn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: oklch(0.9 0.02 86.8);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.asst__iconbtn:hover {
  background: oklch(1 0 0 / 0.12);
  color: white;
}

/* ── Scroll area ──────────────────────────────────────────────────── */
.asst__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.asst__intro {
  margin: auto 0;
  text-align: center;
  padding: 24px 8px;
}
.asst__intro-icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 12px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-brand-50);
  color: var(--color-brand-600);
}
.asst__intro-lead {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
  max-width: 300px;
  margin: 0 auto;
}
.asst__chips {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.asst__chip {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.asst__chip:hover {
  border-color: var(--color-accent-500);
  background: var(--color-surface-soft);
}

/* ── Messages ─────────────────────────────────────────────────────── */
.asst__msg {
  display: flex;
  flex-direction: column;
}
.asst__msg--user {
  align-items: flex-end;
}
.asst__msg--bot {
  align-items: stretch;
}
.asst__bubble {
  max-width: 88%;
  border-radius: 14px;
  padding: 9px 13px;
  font-size: 13.5px;
  line-height: 1.55;
}
.asst__bubble--user {
  background: var(--color-brand-600);
  color: white;
  border-bottom-right-radius: 5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.asst__bubble--bot {
  max-width: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-ink);
  border-bottom-left-radius: 5px;
}
.asst__bubble--error {
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  font-style: italic;
}

/* Markdown inside assistant bubbles */
.asst__md :deep(p) {
  margin: 0 0 8px;
}
.asst__md :deep(p:last-child) {
  margin-bottom: 0;
}
.asst__md :deep(ol),
.asst__md :deep(ul) {
  margin: 4px 0 8px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.asst__md :deep(li)::marker {
  color: var(--color-muted);
  font-weight: 600;
}
.asst__md :deep(a) {
  color: var(--color-brand-600);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--color-accent-500);
}
.asst__md :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 5px;
  padding: 1px 5px;
}
.asst__md :deep(strong) {
  font-weight: 650;
}
.asst__md :deep(h1),
.asst__md :deep(h2),
.asst__md :deep(h3) {
  font-size: 13.5px;
  font-weight: 700;
  margin: 10px 0 4px;
}

/* Typing dots */
.asst__typing {
  display: inline-flex;
  gap: 4px;
  padding: 3px 0;
}
.asst__typing span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-muted);
  animation: asst-dot 1.1s ease-in-out infinite;
}
.asst__typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.asst__typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes asst-dot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30% { transform: translateY(-3px); opacity: 1; }
}

/* ── Feature-request card ─────────────────────────────────────────── */
.asst__req {
  margin-top: 8px;
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-accent-500);
  border-radius: 10px;
  background: var(--color-surface-soft);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.asst__req--footer {
  margin: 0 0 10px;
}
.asst__req-lead {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.asst__req-note {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  padding: 7px 10px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--color-ink);
}
.asst__req-note:focus {
  outline: 2px solid var(--color-accent-500);
  outline-offset: -1px;
}
.asst__req-error {
  font-size: 12px;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
}
.asst__req-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.asst__req-done {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-success-600, oklch(0.5 0.14 150));
}
.asst__btn {
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out);
}
.asst__btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.asst__btn--primary {
  background: var(--color-brand-600);
  color: white;
}
.asst__btn--primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.asst__btn--ghost {
  background: transparent;
  border-color: var(--color-line);
  color: var(--color-ink-soft);
}
.asst__btn--ghost:hover {
  color: var(--color-ink);
  border-color: var(--color-muted-soft);
}

/* ── Footer / composer ────────────────────────────────────────────── */
.asst__foot {
  border-top: 1px solid var(--color-line);
  background: var(--color-surface);
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
}
.asst__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.asst__input {
  flex: 1;
  resize: none;
  min-height: 40px;
  max-height: 120px;
  border: 1px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-canvas);
  padding: 10px 12px;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--color-ink);
}
.asst__input:focus {
  outline: 2px solid var(--color-accent-500);
  outline-offset: -1px;
}
.asst__send {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 11px;
  background: var(--color-brand-600);
  color: white;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.asst__send:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.asst__send:disabled {
  opacity: 0.5;
  cursor: default;
}
.asst__suggest {
  margin-top: 8px;
  background: transparent;
  border: none;
  padding: 0;
  font-size: 11.5px;
  color: var(--color-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.asst__suggest:hover {
  color: var(--color-ink-soft);
}
</style>
