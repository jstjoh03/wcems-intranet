<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  MessageCircleQuestion,
  Plus,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Send,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import QotwResponses from '@/components/admin/QotwResponses.vue'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'

/**
 * Question of the Week queue (/admin/qotw, admins).
 *
 * Stock questions in advance; the next one in line publishes itself
 * every Monday 7am Central (pg_cron → qotw_publish_next) and buzzes
 * everyone's phone. "Publish now" runs the same promotion immediately
 * (archives whatever is live). Deleting a published/archived question
 * takes its answers with it — the armed two-tap guards that.
 */

const auth = useAuthStore()

interface QRow {
  id: string
  prompt: string
  kind: 'text' | 'poll'
  options: string[] | null
  position: number
  status: 'queued' | 'published' | 'archived'
  published_at: string | null
  week_of: string | null
  comment_count?: number
  vote_count?: number
}

const rows = ref<QRow[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const busy = ref(false)
const actionError = ref<string | null>(null)

const queued = computed(() =>
  rows.value.filter((r) => r.status === 'queued').sort((a, b) => a.position - b.position),
)
const published = computed(() => rows.value.find((r) => r.status === 'published') ?? null)
const archived = computed(() =>
  rows.value
    .filter((r) => r.status === 'archived')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '')),
)

async function load() {
  loading.value = true
  loadError.value = null
  if (auth.usingDevStub) {
    rows.value = [
      { id: 'dev-qotw-1', prompt: 'Best station meal of the year so far — who cooked it and what was it?', kind: 'poll', options: ['Brisket night at S1', 'Fajita Friday', 'The gumbo', 'Waffle-iron everything'], position: 0, status: 'published', published_at: new Date().toISOString(), week_of: new Date().toISOString().slice(0, 10) },
      { id: 'dev-qotw-2', prompt: 'What is one call that changed how you practice?', kind: 'text', options: null, position: 1, status: 'queued', published_at: null, week_of: null },
    ]
    loading.value = false
    return
  }
  const { data, error } = await supabase
    .from('qotw_questions')
    .select('id, prompt, kind, options, position, status, published_at, week_of')
    .order('position')
  if (error) {
    loadError.value = error.message
    loading.value = false
    return
  }
  rows.value = (data ?? []) as QRow[]
  loading.value = false

  /* Engagement counts for the published + archived lists — two cheap
     aggregate reads, best-effort. */
  const ids = rows.value.filter((r) => r.status !== 'queued').map((r) => r.id)
  if (ids.length) {
    const [c, v] = await Promise.all([
      supabase.from('qotw_comments').select('question_id').in('question_id', ids),
      supabase.from('qotw_votes').select('question_id').in('question_id', ids),
    ])
    const cc: Record<string, number> = {}
    for (const r of (c.data ?? []) as { question_id: string }[])
      cc[r.question_id] = (cc[r.question_id] ?? 0) + 1
    const vc: Record<string, number> = {}
    for (const r of (v.data ?? []) as { question_id: string }[])
      vc[r.question_id] = (vc[r.question_id] ?? 0) + 1
    rows.value = rows.value.map((r) => ({
      ...r,
      comment_count: cc[r.id] ?? 0,
      vote_count: vc[r.id] ?? 0,
    }))
  }
}
onMounted(load)

/* ── Create / edit ──────────────────────────────────────────────── */
const draft = ref<{
  id: string | null
  prompt: string
  kind: 'text' | 'poll'
  options: string[]
  /** '' = opinion question (no right answer, votes stay changeable). */
  correctOption: number | ''
  teachingPoint: string
} | null>(null)

function startCreate() {
  draft.value = { id: null, prompt: '', kind: 'text', options: ['', ''], correctOption: '', teachingPoint: '' }
}
async function startEdit(r: QRow) {
  draft.value = {
    id: r.id,
    prompt: r.prompt,
    kind: r.kind,
    options: r.options ? [...r.options] : ['', ''],
    correctOption: '',
    teachingPoint: '',
  }
  if (auth.usingDevStub) return
  const { data } = await supabase
    .from('qotw_answer_keys')
    .select('correct_option, teaching_point')
    .eq('question_id', r.id)
    .maybeSingle()
  if (data && draft.value?.id === r.id) {
    draft.value.correctOption = (data as { correct_option: number | null }).correct_option ?? ''
    draft.value.teachingPoint = (data as { teaching_point: string | null }).teaching_point ?? ''
  }
}
function addOption() {
  if (draft.value && draft.value.options.length < 4) draft.value.options.push('')
}
function removeOption(i: number) {
  if (draft.value && draft.value.options.length > 2) draft.value.options.splice(i, 1)
}

const draftValid = computed(() => {
  const d = draft.value
  if (!d || !d.prompt.trim()) return false
  if (d.kind === 'poll') {
    const opts = d.options.map((o) => o.trim()).filter(Boolean)
    return opts.length >= 2 && opts.length <= 4
  }
  return true
})

async function saveDraft() {
  const d = draft.value
  if (!d || !draftValid.value || busy.value) return
  busy.value = true
  actionError.value = null
  const payload = {
    prompt: d.prompt.trim(),
    kind: d.kind,
    options: d.kind === 'poll' ? d.options.map((o) => o.trim()).filter(Boolean) : null,
  }
  let qid = d.id
  if (qid) {
    const res = await supabase.from('qotw_questions').update(payload).eq('id', qid)
    if (res.error) {
      busy.value = false
      actionError.value = res.error.message
      return
    }
  } else {
    const res = await supabase
      .from('qotw_questions')
      .insert({
        ...payload,
        position: (queued.value.at(-1)?.position ?? -1) + 1,
        created_by: auth.appUser?.id ?? null,
      })
      .select('id')
      .single()
    if (res.error) {
      busy.value = false
      actionError.value = res.error.message
      return
    }
    qid = (res.data as { id: string }).id
  }
  /* Answer key: upsert when either field is set, clear when both empty.
     The correct option only applies to polls. */
  const correct = d.kind === 'poll' && d.correctOption !== '' ? d.correctOption : null
  const teach = d.teachingPoint.trim() || null
  const keyRes =
    correct != null || teach
      ? await supabase
          .from('qotw_answer_keys')
          .upsert({ question_id: qid, correct_option: correct, teaching_point: teach, updated_at: new Date().toISOString() })
      : await supabase.from('qotw_answer_keys').delete().eq('question_id', qid)
  busy.value = false
  if (keyRes.error) {
    actionError.value = `Question saved, but the answer key failed: ${keyRes.error.message}`
    return
  }
  draft.value = null
  await load()
}

/* ── Who answered what — the retraining breakdown ───────────────── */
const expandedId = ref<string | null>(null)
interface Breakdown {
  key: { correctOption: number | null; teachingPoint: string | null } | null
  ballots: { name: string; optionIndex: number }[]
  answers: { name: string; body: string }[]
}
const breakdowns = ref<Record<string, Breakdown>>({})

async function toggleResponses(r: QRow) {
  if (expandedId.value === r.id) {
    expandedId.value = null
    return
  }
  expandedId.value = r.id
  if (breakdowns.value[r.id] || auth.usingDevStub) return
  const [v, c, k] = await Promise.all([
    supabase
      .from('qotw_votes')
      .select('option_index, app_users:app_users!qotw_votes_user_id_fkey(full_name)')
      .eq('question_id', r.id),
    supabase
      .from('qotw_comments')
      .select('body, app_users:app_users!qotw_comments_user_id_fkey(full_name)')
      .eq('question_id', r.id)
      .order('created_at'),
    supabase.from('qotw_answer_keys').select('correct_option, teaching_point').eq('question_id', r.id).maybeSingle(),
  ])
  breakdowns.value = {
    ...breakdowns.value,
    [r.id]: {
      key: k.data
        ? {
            correctOption: (k.data as { correct_option: number | null }).correct_option,
            teachingPoint: (k.data as { teaching_point: string | null }).teaching_point,
          }
        : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ballots: ((v.data ?? []) as any[]).map((row) => ({
        name: row.app_users?.full_name ?? '—',
        optionIndex: row.option_index,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      answers: ((c.data ?? []) as any[]).map((row) => ({
        name: row.app_users?.full_name ?? '—',
        body: row.body,
      })),
    },
  }
}

function ballotsByOption(r: QRow): { label: string; correct: boolean; names: string[] }[] {
  const b = breakdowns.value[r.id]
  if (!b || r.kind !== 'poll') return []
  return (r.options ?? []).map((label, i) => ({
    label,
    correct: b.key?.correctOption === i,
    names: b.ballots.filter((x) => x.optionIndex === i).map((x) => x.name).sort(),
  }))
}

/* ── Reorder ────────────────────────────────────────────────────── */
async function move(r: QRow, dir: -1 | 1) {
  const list = queued.value
  const i = list.findIndex((x) => x.id === r.id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length || busy.value) return
  busy.value = true
  actionError.value = null
  const other = list[j]
  const [e1, e2] = await Promise.all([
    supabase.from('qotw_questions').update({ position: other.position }).eq('id', r.id),
    supabase.from('qotw_questions').update({ position: r.position }).eq('id', other.id),
  ])
  busy.value = false
  if (e1.error || e2.error) actionError.value = (e1.error ?? e2.error)!.message
  await load()
}

/* ── Delete (two-tap armed, like the kudos inbox) ───────────────── */
const armedId = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
async function onDelete(r: QRow) {
  if (armedId.value !== r.id) {
    armedId.value = r.id
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => (armedId.value = null), 4000)
    return
  }
  armedId.value = null
  busy.value = true
  actionError.value = null
  const { error, count } = await supabase
    .from('qotw_questions')
    .delete({ count: 'exact' })
    .eq('id', r.id)
  busy.value = false
  if (error) actionError.value = error.message
  else if (!count) actionError.value = 'Nothing deleted — check permissions.'
  await load()
}

/* ── Publish now ────────────────────────────────────────────────── */
const publishArmed = ref(false)
let pubTimer: ReturnType<typeof setTimeout> | null = null
async function publishNow() {
  if (!publishArmed.value) {
    publishArmed.value = true
    if (pubTimer) clearTimeout(pubTimer)
    pubTimer = setTimeout(() => (publishArmed.value = false), 4000)
    return
  }
  publishArmed.value = false
  busy.value = true
  actionError.value = null
  const { error } = await supabase.rpc('qotw_publish_now')
  busy.value = false
  if (error) actionError.value = error.message
  await load()
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function kindLabel(r: QRow): string {
  return r.kind === 'poll' ? `Poll · ${r.options?.length ?? 0} options` : 'Open text'
}
</script>

<template>
  <div class="mq">
    <header class="mq__header">
      <div class="flex items-center gap-2">
        <MessageCircleQuestion :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mq__title">Question of the Week</h1>
      </div>
      <p class="mq__sub">
        Stock the queue — the next question in line publishes itself every
        <b>Monday at 7am</b> with a push to everyone. Crews answer on the dashboard.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mq__gate">Admin only.</div>

    <template v-else>
      <p v-if="loadError" class="mq__error">{{ loadError }}</p>
      <p v-if="actionError" class="mq__error">{{ actionError }}</p>

      <!-- Live now -->
      <AppCard class="mq__card">
        <Eyebrow class="mb-3">Live now</Eyebrow>
        <div v-if="published" class="mq__live">
          <div class="mq__live-prompt">{{ published.prompt }}</div>
          <div class="mq__meta">
            {{ kindLabel(published) }} · published {{ fmt(published.published_at) }}
            · {{ published.comment_count ?? 0 }} answers<template v-if="published.kind === 'poll'"> · {{ published.vote_count ?? 0 }} votes</template>
            · <button type="button" class="mq__linkbtn" @click="toggleResponses(published)">
              {{ expandedId === published.id ? 'hide responses' : 'who answered what' }}
            </button>
          </div>
          <QotwResponses v-if="expandedId === published.id" :groups="ballotsByOption(published)" :answers="breakdowns[published.id]?.answers ?? []" />
        </div>
        <div v-else class="mq__empty">Nothing live yet.</div>
      </AppCard>

      <!-- Queue -->
      <AppCard class="mq__card">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <Eyebrow>Queue — next up first</Eyebrow>
          <div class="flex items-center gap-2">
            <button
              v-if="queued.length"
              type="button"
              class="mq__btn"
              :class="{ 'mq__btn--armed': publishArmed }"
              :disabled="busy"
              @click="publishNow"
            >
              <Send :size="13" :stroke-width="2" />
              {{ publishArmed ? 'Tap again — replaces the live question' : 'Publish next now' }}
            </button>
            <button v-if="!draft" type="button" class="mq__btn mq__btn--primary" @click="startCreate">
              <Plus :size="14" :stroke-width="2" /> New question
            </button>
          </div>
        </div>

        <!-- Compose / edit -->
        <form v-if="draft" class="mq__form" @submit.prevent="saveDraft">
          <label class="mq__field">
            <span class="mq__label">Question *</span>
            <textarea v-model="draft.prompt" rows="2" maxlength="300" class="mq__input" placeholder="e.g. What's the weirdest call you've ever run?"></textarea>
          </label>
          <div class="mq__kindrow">
            <span class="mq__label">Format</span>
            <label class="mq__radio"><input v-model="draft.kind" type="radio" value="text" /> Open text</label>
            <label class="mq__radio"><input v-model="draft.kind" type="radio" value="poll" /> Poll</label>
          </div>
          <div v-if="draft.kind === 'poll'" class="mq__opts">
            <div v-for="(_, i) in draft.options" :key="i" class="mq__optrow">
              <input v-model="draft.options[i]" type="text" maxlength="80" class="mq__input" :placeholder="`Option ${i + 1}`" />
              <button v-if="draft.options.length > 2" type="button" class="mq__icon" title="Remove option" @click="removeOption(i)">
                <Trash2 :size="13" :stroke-width="1.85" />
              </button>
            </div>
            <button v-if="draft.options.length < 4" type="button" class="mq__btn mq__btn--ghost" @click="addOption">
              <Plus :size="13" :stroke-width="2" /> Add option
            </button>
            <label class="mq__field">
              <span class="mq__label">Correct answer <em class="mq__opt-note">optional — set it and votes lock with an instant reveal; leave unset for opinion polls</em></span>
              <select v-model="draft.correctOption" class="mq__input mq__input--select">
                <option value="">No right answer (opinion poll)</option>
                <option v-for="(o, i) in draft.options" :key="i" :value="i" :disabled="!o.trim()">
                  {{ o.trim() || `Option ${i + 1}` }}
                </option>
              </select>
            </label>
          </div>
          <label class="mq__field">
            <span class="mq__label">Teaching point <em class="mq__opt-note">optional — shows with the reveal after someone answers</em></span>
            <textarea v-model="draft.teachingPoint" rows="3" maxlength="2000" class="mq__input" placeholder="The why behind the answer — protocol reference, pearls, what crews get wrong."></textarea>
          </label>
          <div class="mq__formfoot">
            <button type="button" class="mq__btn" @click="draft = null">Cancel</button>
            <button type="submit" class="mq__btn mq__btn--primary" :disabled="!draftValid || busy">
              {{ draft.id ? 'Save changes' : 'Add to queue' }}
            </button>
          </div>
        </form>

        <div v-if="loading" class="mq__empty">Loading…</div>
        <div v-else-if="!queued.length && !draft" class="mq__empty">
          The queue is empty — nothing will publish Monday until you add a question.
        </div>
        <div v-for="(r, idx) in queued" :key="r.id" class="mq__row">
          <div class="mq__reorder">
            <button type="button" class="mq__icon" :disabled="idx === 0 || busy" @click="move(r, -1)">
              <ArrowUp :size="13" :stroke-width="2" />
            </button>
            <button type="button" class="mq__icon" :disabled="idx === queued.length - 1 || busy" @click="move(r, 1)">
              <ArrowDown :size="13" :stroke-width="2" />
            </button>
          </div>
          <div class="mq__row-main">
            <div class="mq__row-prompt">{{ r.prompt }}</div>
            <div class="mq__meta">{{ kindLabel(r) }}<template v-if="idx === 0"> · <b>publishes next</b></template></div>
          </div>
          <div class="mq__row-actions">
            <button type="button" class="mq__icon" title="Edit" @click="startEdit(r)">
              <Pencil :size="13" :stroke-width="1.85" />
            </button>
            <button
              type="button"
              class="mq__icon"
              :class="{ 'mq__icon--armed': armedId === r.id }"
              :title="armedId === r.id ? 'Tap again to delete' : 'Delete'"
              @click="onDelete(r)"
            >
              <Trash2 :size="13" :stroke-width="1.85" />
            </button>
          </div>
        </div>
      </AppCard>

      <!-- History -->
      <AppCard v-if="archived.length" class="mq__card">
        <Eyebrow class="mb-3">Past questions</Eyebrow>
        <div v-for="r in archived" :key="r.id" class="mq__row mq__row--hist">
          <div class="mq__row-main">
            <div class="mq__row-prompt">{{ r.prompt }}</div>
            <div class="mq__meta">
              {{ kindLabel(r) }} · week of {{ fmt(r.week_of) }}
              · {{ r.comment_count ?? 0 }} answers<template v-if="r.kind === 'poll'"> · {{ r.vote_count ?? 0 }} votes</template>
              · <button type="button" class="mq__linkbtn" @click="toggleResponses(r)">
                {{ expandedId === r.id ? 'hide responses' : 'who answered what' }}
              </button>
            </div>
            <QotwResponses v-if="expandedId === r.id" :groups="ballotsByOption(r)" :answers="breakdowns[r.id]?.answers ?? []" />
          </div>
          <button
            type="button"
            class="mq__icon"
            :class="{ 'mq__icon--armed': armedId === r.id }"
            :title="armedId === r.id ? 'Tap again — deletes its answers too' : 'Delete (removes its answers)'"
            @click="onDelete(r)"
          >
            <Trash2 :size="13" :stroke-width="1.85" />
          </button>
        </div>
      </AppCard>
    </template>
  </div>
</template>

<style scoped>
.mq { max-width: 860px; margin: 0 auto; padding: 28px 16px 80px; }
@media (min-width: 768px) { .mq { padding: 36px 32px 80px; } }
.mq__header { margin-bottom: 20px; }
.mq__title { font-size: 24px; color: var(--color-ink); }
.mq__sub { margin-top: 6px; font-size: 13px; line-height: 1.55; color: var(--color-muted); }
.mq__gate { padding: 40px 0; text-align: center; color: var(--color-muted); }
.mq__error { font-size: 13px; color: var(--color-danger-500, oklch(0.55 0.2 25)); margin-bottom: 12px; }
.mq__card { margin-bottom: 18px; }
.mq__empty { font-size: 13px; color: var(--color-muted); padding: 10px 2px; }

.mq__live-prompt { font-size: 15.5px; font-weight: 650; color: var(--color-ink); line-height: 1.4; }
.mq__meta { margin-top: 3px; font-size: 11.5px; color: var(--color-muted); }
.mq__linkbtn {
  font: inherit; background: none; border: none; padding: 0; cursor: pointer;
  color: var(--color-brand-600); font-weight: 650; text-decoration: underline; text-underline-offset: 2px;
}
.mq__opt-note {
  font-style: normal; font-weight: 500; letter-spacing: 0; text-transform: none;
  color: var(--color-muted-soft);
}
.mq__input--select { max-width: 420px; }

.mq__btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 9px; padding: 7px 12px; cursor: pointer;
}
.mq__btn:hover:not(:disabled) { border-color: var(--color-brand-600); }
.mq__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mq__btn--primary { color: white; background: var(--color-brand-600); border-color: var(--color-brand-600); }
.mq__btn--primary:hover:not(:disabled) { background: var(--color-brand-700); }
.mq__btn--ghost { border-style: dashed; width: fit-content; }
.mq__btn--armed { color: white; background: var(--color-danger-500, oklch(0.55 0.2 25)); border-color: transparent; }

.mq__form { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 16px; border-bottom: 1px solid var(--color-line-soft); margin-bottom: 12px; }
.mq__field { display: flex; flex-direction: column; gap: 5px; }
.mq__label { font-size: 11.5px; font-weight: 700; color: var(--color-muted); }
.mq__input {
  font-family: var(--font-sans); font-size: 13.5px; color: var(--color-ink);
  background: var(--color-surface-soft); border: 1.5px solid var(--color-line);
  border-radius: 9px; padding: 8px 11px; width: 100%; resize: vertical;
}
.mq__input:focus { outline: none; border-color: var(--color-brand-600); }
.mq__kindrow { display: flex; align-items: center; gap: 16px; }
.mq__radio { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-ink-soft); cursor: pointer; }
.mq__radio input { accent-color: var(--color-brand-600); }
.mq__opts { display: flex; flex-direction: column; gap: 8px; }
.mq__optrow { display: flex; gap: 8px; align-items: center; }
.mq__formfoot { display: flex; justify-content: flex-end; gap: 8px; }

.mq__row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 2px; border-bottom: 1px solid var(--color-line-soft);
}
.mq__row:last-child { border-bottom: none; }
.mq__reorder { display: flex; flex-direction: column; gap: 2px; }
.mq__row-main { flex: 1; min-width: 0; }
.mq__row-prompt { font-size: 13.5px; color: var(--color-ink); line-height: 1.4; }
.mq__row-actions { display: flex; gap: 4px; }
.mq__icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 7px;
  background: none; border: 1px solid transparent; color: var(--color-muted); cursor: pointer;
}
.mq__icon:hover:not(:disabled) { border-color: var(--color-line); color: var(--color-ink); }
.mq__icon:disabled { opacity: 0.35; cursor: not-allowed; }
.mq__icon--armed { color: white; background: var(--color-danger-500, oklch(0.55 0.2 25)); }
</style>
