<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessageCircleQuestion, Inbox, RefreshCw, ChevronDown } from 'lucide-vue-next'
import { marked } from 'marked'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * /admin/assistant — visibility into the Ask WCEMS assistant.
 *
 * Questions: month-to-date volume + spend tiles and the recent Q&A log
 * (straight from assistant_messages under the admin RLS policy — the
 * edge function logs token counts and computed cost per exchange).
 *
 * Requests: the assistant_feature_requests inbox. Unanswered questions
 * users chose to "send to the dev team" land here; admins triage with
 * kind/status/admin note.
 */

const auth = useAuthStore()

type Tab = 'questions' | 'requests'
const tab = ref<Tab>('questions')

/* ── Questions ─────────────────────────────────────────────────────── */

interface MessageRow {
  id: string
  question: string
  answer: string
  model: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  est_cost_usd: number
  status: string
  created_at: string
  app_users: { full_name: string | null } | null
}

const monthCount = ref(0)
const monthCost = ref(0)
const rows = ref<MessageRow[]>([])
const expanded = ref<Set<string>>(new Set())

/* ── Requests ──────────────────────────────────────────────────────── */

interface RequestRow {
  id: string
  question: string
  note: string | null
  kind: string
  status: string
  admin_note: string | null
  created_at: string
  app_users: { full_name: string | null } | null
}

const requests = ref<RequestRow[]>([])
const newCount = computed(() => requests.value.filter((r) => r.status === 'new').length)

const KINDS = ['feature', 'docs_gap', 'bug', 'other'] as const
const STATUSES = ['new', 'planned', 'done', 'declined'] as const

const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [month, recent, reqs] = await Promise.all([
      supabase
        .from('assistant_messages')
        .select('est_cost_usd')
        .gte('created_at', monthStart.toISOString()),
      supabase
        .from('assistant_messages')
        .select(
          'id, question, answer, model, input_tokens, output_tokens, cache_read_tokens, est_cost_usd, status, created_at, app_users(full_name)',
        )
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('assistant_feature_requests')
        .select('id, question, note, kind, status, admin_note, created_at, app_users(full_name)')
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (month.error) throw month.error
    if (recent.error) throw recent.error
    if (reqs.error) throw reqs.error

    monthCount.value = month.data?.length ?? 0
    monthCost.value = (month.data ?? []).reduce((s, r) => s + Number(r.est_cost_usd || 0), 0)
    rows.value = (recent.data ?? []) as unknown as MessageRow[]
    requests.value = (reqs.data ?? []) as unknown as RequestRow[]
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (auth.isAdmin) void load()
})

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

marked.setOptions({ breaks: true })
function md(text: string): string {
  return marked.parse(text) as string
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function money(v: number): string {
  return `$${v.toFixed(v >= 1 ? 2 : 4)}`
}

/* Inline triage saves — small table, save-on-change is plenty. */
const saving = ref<Set<string>>(new Set())
async function saveRequest(r: RequestRow, patch: Partial<Pick<RequestRow, 'kind' | 'status' | 'admin_note'>>) {
  Object.assign(r, patch)
  saving.value = new Set(saving.value).add(r.id)
  const { error: uerr } = await supabase
    .from('assistant_feature_requests')
    .update({ kind: r.kind, status: r.status, admin_note: r.admin_note || null })
    .eq('id', r.id)
  const next = new Set(saving.value)
  next.delete(r.id)
  saving.value = next
  if (uerr) error.value = `Save failed: ${uerr.message}`
}
</script>

<template>
  <div class="aa">
    <header class="aa__header">
      <div class="flex items-center gap-2">
        <MessageCircleQuestion :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display aa__title">Ask WCEMS</h1>
        <button type="button" class="aa__refresh" title="Refresh" @click="load">
          <RefreshCw :size="14" :stroke-width="2" />
        </button>
      </div>
      <p class="aa__sub">
        What people ask the assistant, what it costs, and the feature requests it captures when it
        can't answer. The knowledge base ships with the app — see docs/assistant.md for how to
        update it.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="aa__quiet">Admin only.</div>

    <template v-else>
      <nav class="aa__tabs" role="tablist">
        <button
          type="button"
          class="aa__tab"
          :class="{ 'aa__tab--on': tab === 'questions' }"
          role="tab"
          :aria-selected="tab === 'questions'"
          @click="tab = 'questions'"
        >
          Questions
        </button>
        <button
          type="button"
          class="aa__tab"
          :class="{ 'aa__tab--on': tab === 'requests' }"
          role="tab"
          :aria-selected="tab === 'requests'"
          @click="tab = 'requests'"
        >
          <Inbox :size="14" :stroke-width="2" />
          Requests
          <span v-if="newCount" class="aa__badge">{{ newCount }}</span>
        </button>
      </nav>

      <div v-if="loading" class="aa__quiet">Loading…</div>
      <div v-if="error" class="aa__error">{{ error }}</div>

      <template v-if="!loading && tab === 'questions'">
        <div class="aa__tiles">
          <div class="aa__tile">
            <span class="aa__tile-label">Questions this month</span>
            <span class="aa__tile-value">{{ monthCount }}</span>
          </div>
          <div class="aa__tile">
            <span class="aa__tile-label">Cost this month</span>
            <span class="aa__tile-value">{{ money(monthCost) }}</span>
          </div>
        </div>

        <div v-if="rows.length === 0" class="aa__quiet">No questions yet.</div>
        <div v-for="r in rows" :key="r.id" class="aa__row">
          <button type="button" class="aa__row-head" @click="toggle(r.id)">
            <div class="aa__row-meta">
              <span class="aa__row-user">{{ r.app_users?.full_name ?? 'Unknown' }}</span>
              <span class="aa__row-when">{{ when(r.created_at) }}</span>
              <span v-if="r.status !== 'ok'" class="aa__row-status">{{ r.status }}</span>
              <span class="aa__row-cost">{{ money(Number(r.est_cost_usd)) }}</span>
            </div>
            <div class="aa__row-q">
              {{ r.question }}
              <ChevronDown
                :size="14"
                :stroke-width="2"
                class="aa__chev"
                :class="{ 'aa__chev--open': expanded.has(r.id) }"
              />
            </div>
          </button>
          <div v-if="expanded.has(r.id)" class="aa__row-body">
            <div class="aa__answer" v-html="md(r.answer || '—')" />
            <p class="aa__tokens">
              {{ r.model }} · in {{ r.input_tokens ?? 0 }} · out {{ r.output_tokens ?? 0 }} ·
              cache read {{ r.cache_read_tokens ?? 0 }}
            </p>
          </div>
        </div>
      </template>

      <template v-if="!loading && tab === 'requests'">
        <div v-if="requests.length === 0" class="aa__quiet">
          No requests yet — when the assistant can't answer something, users can send it here.
        </div>
        <div
          v-for="r in requests"
          :key="r.id"
          class="aa__req"
          :class="{ 'aa__req--new': r.status === 'new' }"
        >
          <div class="aa__req-top">
            <span class="aa__row-user">{{ r.app_users?.full_name ?? 'Unknown' }}</span>
            <span class="aa__row-when">{{ when(r.created_at) }}</span>
            <span v-if="r.status === 'new'" class="aa__badge">new</span>
            <span v-if="saving.has(r.id)" class="aa__row-when">saving…</span>
          </div>
          <p class="aa__req-q">{{ r.question }}</p>
          <p v-if="r.note" class="aa__req-note">“{{ r.note }}”</p>
          <div class="aa__req-controls">
            <label class="aa__ctl">
              <span>Kind</span>
              <select :value="r.kind" @change="saveRequest(r, { kind: ($event.target as HTMLSelectElement).value })">
                <option v-for="k in KINDS" :key="k" :value="k">{{ k.replace('_', ' ') }}</option>
              </select>
            </label>
            <label class="aa__ctl">
              <span>Status</span>
              <select :value="r.status" @change="saveRequest(r, { status: ($event.target as HTMLSelectElement).value })">
                <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label class="aa__ctl aa__ctl--grow">
              <span>Admin note</span>
              <input
                :value="r.admin_note ?? ''"
                type="text"
                placeholder="Internal note…"
                @change="saveRequest(r, { admin_note: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.aa { max-width: 860px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .aa { padding: 24px 32px 80px; } }
.aa__header { margin-bottom: 18px; }
.aa__title { font-size: 26px; }
.aa__sub { margin-top: 6px; font-size: 13px; line-height: 1.55; color: var(--color-ink-soft); max-width: 60ch; }
.aa__refresh {
  margin-left: 4px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}
.aa__refresh:hover { color: var(--color-ink); }

.aa__quiet { font-size: 13px; color: var(--color-muted); padding: 12px 0; }
.aa__error { font-size: 13px; color: var(--color-danger-600, oklch(0.5 0.19 27)); padding: 8px 0; }

.aa__tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--color-line); margin-bottom: 16px; }
.aa__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.aa__tab--on { color: var(--color-brand-600); border-bottom-color: var(--color-accent-500); }
.aa__badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900, oklch(0.2 0.05 250));
}

.aa__tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.aa__tile {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.aa__tile-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
.aa__tile-value { font-size: 24px; font-weight: 650; color: var(--color-ink); font-variant-numeric: tabular-nums; }

.aa__row { border: 1px solid var(--color-line); border-radius: 10px; background: var(--color-surface); margin-bottom: 8px; overflow: hidden; }
.aa__row-head { display: block; width: 100%; text-align: left; border: none; background: transparent; padding: 10px 12px; cursor: pointer; }
.aa__row-head:hover { background: var(--color-surface-soft); }
.aa__row-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 3px; }
.aa__row-user { font-size: 12px; font-weight: 650; color: var(--color-brand-600); }
.aa__row-when { font-size: 11.5px; color: var(--color-muted); }
.aa__row-status { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.aa__row-cost { margin-left: auto; font-size: 11.5px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.aa__row-q { font-size: 13.5px; color: var(--color-ink); display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.aa__chev { flex-shrink: 0; color: var(--color-muted); transition: transform 150ms var(--ease-out); }
.aa__chev--open { transform: rotate(180deg); }
.aa__row-body { border-top: 1px solid var(--color-line); padding: 10px 12px; background: var(--color-surface-soft); }
.aa__answer { font-size: 13px; line-height: 1.55; color: var(--color-ink); }
.aa__answer :deep(p) { margin: 0 0 6px; }
.aa__answer :deep(ol), .aa__answer :deep(ul) { margin: 4px 0 6px; padding-left: 20px; }
.aa__answer :deep(a) { color: var(--color-brand-600); font-weight: 600; text-decoration: underline; }
.aa__tokens { margin-top: 8px; font-size: 11px; color: var(--color-muted); font-variant-numeric: tabular-nums; }

.aa__req { border: 1px solid var(--color-line); border-radius: 10px; background: var(--color-surface); padding: 12px 14px; margin-bottom: 8px; }
.aa__req--new { border-left: 3px solid var(--color-accent-500); }
.aa__req-top { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.aa__req-q { font-size: 13.5px; font-weight: 600; color: var(--color-ink); }
.aa__req-note { margin-top: 3px; font-size: 12.5px; color: var(--color-ink-soft); font-style: italic; }
.aa__req-controls { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.aa__ctl { display: flex; flex-direction: column; gap: 3px; }
.aa__ctl--grow { flex: 1; min-width: 160px; }
.aa__ctl span { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
.aa__ctl select,
.aa__ctl input {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-canvas);
  padding: 6px 9px;
  font-size: 12.5px;
  font-family: var(--font-sans);
  color: var(--color-ink);
}
.aa__ctl select:focus,
.aa__ctl input:focus { outline: 2px solid var(--color-accent-500); outline-offset: -1px; }
</style>
