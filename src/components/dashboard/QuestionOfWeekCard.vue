<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Flame, MessageCircleQuestion, Trophy, X } from 'lucide-vue-next'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useQotw, type QotwAnswerKey } from '@/composables/useQotw'
import { useQotwComments } from '@/composables/useQotwComments'
import { useQotwVotes } from '@/composables/useQotwVotes'
import { useQotwParticipation, type ShiftLetter } from '@/composables/useQotwParticipation'
import { useAuthStore } from '@/stores/auth'

/**
 * Question of the Week — the engagement card, V2 (Justin, 2026-11-17):
 * navy/gold header so it stands out without leaving the design
 * language, instant answer + teaching-point reveal when a member locks
 * in (quiz questions lock the vote — RLS enforces it), the A/B/C shift
 * participation race, and the member's streak. Mobile-first: options
 * are full-width 44px touch targets, chips wrap.
 */

const auth = useAuthStore()
const { current, recent, ready, loadKey } = useQotw()
const { comments, loading, load, post, remove } = useQotwComments()
const votes = useQotwVotes()
const part = useQotwParticipation()

const revealKey = ref<QotwAnswerKey | null>(null)

const options = computed(() => current.value?.options ?? [])
const voteCounts = computed(() =>
  current.value ? votes.counts(current.value.id, options.value.length) : [],
)
const total = computed(() => (current.value ? votes.totalVotes(current.value.id) : 0))
const mine = computed(() => (current.value ? votes.myVote(current.value.id) : null))
const iCommented = computed(() =>
  !!auth.appUser?.id && comments.value.some((c) => c.userId === auth.appUser?.id),
)
const answered = computed(() => mine.value !== null || iCommented.value)
/* A loaded key means this is a QUIZ — the vote is locked. */
const locked = computed(() => mine.value !== null && !!revealKey.value)
/* Results stay hidden until YOU answer, so the crowd can't steer your
   pick (Justin, 2026-11-17). Kiosks never answer, so they never show
   the spread — the station TV just advertises the question. */
const showResults = computed(() => answered.value)

/* Below the computeds it reads: with { immediate: true } this body runs
   DURING setup, and reading iCommented any earlier is a TDZ crash that
   took the whole card down on in-app revisits (seen 2026-11-19). */
watch(
  current,
  async (q) => {
    if (!q) return
    void load(q.id)
    /* Already answered on an earlier visit? Pull the key for the reveal. */
    if (votes.myVote(q.id) !== null || iCommented.value) {
      revealKey.value = await loadKey(q.id)
    }
  },
  { immediate: true },
)

async function castVote(i: number) {
  const q = current.value
  if (!q || auth.isKiosk || locked.value) return
  await votes.vote(q.id, i)
  revealKey.value = await loadKey(q.id, true)
}

async function onPost(body: string) {
  const q = current.value
  if (!q) return
  const ok = await post(q.id, body)
  if (ok && !revealKey.value) revealKey.value = await loadKey(q.id, true)
}

function pct(i: number): number {
  if (!total.value) return 0
  return Math.round((voteCounts.value[i] / total.value) * 100)
}

/* ── Reveal ─────────────────────────────────────────────────────── */
const gotItRight = computed(
  () =>
    revealKey.value?.correctOption != null &&
    mine.value !== null &&
    mine.value === revealKey.value.correctOption,
)
const showReveal = computed(() => !!revealKey.value && answered.value)

/* ── Shift race ─────────────────────────────────────────────────── */
const SHIFTS: ShiftLetter[] = ['A', 'B', 'C']
const race = computed(() =>
  current.value ? part.shiftCountsFor(current.value.id) : { A: 0, B: 0, C: 0 },
)
const answeredCount = computed(() =>
  current.value ? part.participantsFor(current.value.id).size : 0,
)
const leader = computed<ShiftLetter | null>(() => {
  const r = race.value
  const max = Math.max(r.A, r.B, r.C)
  if (max === 0) return null
  const tops = SHIFTS.filter((s) => r[s] === max)
  return tops.length === 1 ? tops[0] : null
})

/* ── Streak ─────────────────────────────────────────────────────── */
const recentIds = computed(() => recent.value.map((q) => q.id))
const streak = computed(() => part.streakFor(part.myId.value, recentIds.value))
const streakAtRisk = computed(
  () =>
    !answered.value &&
    part.streakFor(part.myId.value, recentIds.value.slice(1)) > 0,
)
const priorStreak = computed(() => part.streakFor(part.myId.value, recentIds.value.slice(1)))

function weekLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return `week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
</script>

<template>
  <div v-if="current || (ready && auth.isAdmin)" class="qw">
    <!-- Navy header band, gold seam — the Hero's language -->
    <div class="qw__head">
      <div class="qw__head-top">
        <span class="qw__eyebrow">
          <MessageCircleQuestion :size="14" :stroke-width="2.2" />
          Question of the Week
        </span>
        <span v-if="current?.weekOf" class="qw__week">{{ weekLabel(current.weekOf) }}</span>
      </div>

      <div v-if="!current" class="qw__empty">
        No question is live yet — stock the queue at
        <RouterLink to="/admin/qotw" class="qw__empty-link">Admin → Question of the Week</RouterLink>.
      </div>

      <template v-else>
        <h3 class="qw__prompt display">{{ current.prompt }}</h3>
        <div class="qw__chips">
          <span v-if="streak > 0" class="qw__chip qw__chip--streak">
            <Flame :size="12" :stroke-width="2.2" />
            {{ streak }}-question streak
          </span>
          <span v-else-if="streakAtRisk" class="qw__chip qw__chip--risk">
            <Flame :size="12" :stroke-width="2.2" />
            answer to keep your {{ priorStreak }}-question streak
          </span>
          <span v-if="answered" class="qw__chip qw__chip--done">
            <Check :size="12" :stroke-width="2.5" /> you're in
          </span>
          <span class="qw__chip">{{ answeredCount }} answered</span>
        </div>
      </template>
    </div>

    <div v-if="current" class="qw__body">
      <!-- Poll -->
      <div v-if="current.kind === 'poll'" class="qw__poll">
        <button
          v-for="(opt, i) in options"
          :key="i"
          type="button"
          class="qw__opt"
          :class="{
            'qw__opt--mine': mine === i,
            'qw__opt--locked': locked || auth.isKiosk,
            'qw__opt--right': showReveal && revealKey?.correctOption === i,
            'qw__opt--wrong': showReveal && mine === i && revealKey?.correctOption != null && revealKey.correctOption !== i,
          }"
          :disabled="locked || auth.isKiosk"
          @click="castVote(i)"
        >
          <span v-if="showResults" class="qw__opt-bar" :style="{ width: `${pct(i)}%` }"></span>
          <span class="qw__opt-label">{{ opt }}</span>
          <span v-if="showReveal && revealKey?.correctOption === i" class="qw__opt-mark qw__opt-mark--right">
            <Check :size="14" :stroke-width="2.6" />
          </span>
          <span v-else-if="showReveal && mine === i && revealKey?.correctOption != null" class="qw__opt-mark qw__opt-mark--wrong">
            <X :size="14" :stroke-width="2.6" />
          </span>
          <span v-if="showResults" class="qw__opt-count">{{ voteCounts[i] ?? 0 }} · {{ pct(i) }}%</span>
        </button>
        <div class="qw__poll-foot">
          <template v-if="auth.isKiosk">Voting is personal — sign in with your own account.</template>
          <template v-else-if="locked">Answer locked in — see how you did below.</template>
          <template v-else-if="mine !== null">You voted — tap another option to change.</template>
          <template v-else>Tap an option to lock in your answer — results show after you do.</template>
        </div>
      </div>

      <!-- Instant reveal: answer + teaching point -->
      <div
        v-if="showReveal && (revealKey?.correctOption != null || revealKey?.teachingPoint)"
        class="qw__reveal"
        :class="revealKey?.correctOption == null ? '' : gotItRight ? 'qw__reveal--right' : 'qw__reveal--wrong'"
      >
        <div v-if="revealKey?.correctOption != null" class="qw__reveal-head">
          <template v-if="gotItRight"><Check :size="15" :stroke-width="2.6" /> Nailed it.</template>
          <template v-else><X :size="15" :stroke-width="2.6" /> Not this time — the answer is
            <b>{{ options[revealKey.correctOption] }}</b>.</template>
        </div>
        <p v-if="revealKey?.teachingPoint" class="qw__reveal-teach">{{ revealKey.teachingPoint }}</p>
      </div>

      <!-- Shift race -->
      <div class="qw__race">
        <span class="qw__race-label"><Trophy :size="12" :stroke-width="2.2" /> Shift race</span>
        <span
          v-for="s in SHIFTS"
          :key="s"
          class="qw__race-chip"
          :class="{ 'qw__race-chip--lead': leader === s }"
        >
          {{ s }} <b>{{ race[s] }}</b>
        </span>
        <span v-if="leader" class="qw__race-lead-note">{{ leader }} Shift leads</span>
      </div>

      <!-- Answers / discussion -->
      <div class="qw__thread">
        <CommentThread
          :comments="comments"
          :loading="loading"
          :empty-hint="current.kind === 'poll' ? 'Add a comment to go with your vote.' : 'Be the first to answer.'"
          @post="onPost"
          @remove="(cid: string) => current && remove(current.id, cid)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.qw {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.06), 0 10px 28px oklch(0.2 0.03 260 / 0.1);
}

/* ── Navy header, gold seam ─────────────────────────────────────── */
.qw__head {
  position: relative;
  background:
    radial-gradient(120% 140% at 85% -20%, oklch(0.38 0.07 265 / 0.9), transparent 60%),
    linear-gradient(170deg, var(--color-brand-900, #1c2a4a), var(--color-brand-950, #141e36));
  padding: 16px 18px 14px;
  border-bottom: 3px solid var(--color-accent-strong, #c9a84c);
}
.qw__head::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -6px;
  height: 1px;
  background: var(--color-accent-strong, #c9a84c);
  opacity: 0.35;
}
.qw__head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.qw__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark, #e8cb72);
}
.qw__week {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: oklch(1 0 0 / 0.55);
}
.qw__prompt {
  font-size: clamp(18px, 4.6vw, 23px);
  line-height: 1.25;
  color: #fff;
  margin: 0 0 10px;
  text-wrap: balance;
}
.qw__empty {
  font-size: 13px;
  color: oklch(1 0 0 / 0.75);
  padding: 4px 0 6px;
}
.qw__empty-link {
  color: var(--color-accent-on-dark, #e8cb72);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.qw__chips {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.qw__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 650;
  color: oklch(1 0 0 / 0.85);
  background: oklch(1 0 0 / 0.1);
  border: 1px solid oklch(1 0 0 / 0.18);
  border-radius: 999px;
  padding: 3.5px 10px;
}
.qw__chip--streak {
  color: #1c2a4a;
  background: linear-gradient(180deg, #f0d88a, var(--color-accent-strong, #c9a84c));
  border-color: transparent;
}
.qw__chip--risk {
  color: var(--color-accent-on-dark, #e8cb72);
  border-color: oklch(0.78 0.1 85 / 0.5);
}
.qw__chip--done {
  color: oklch(0.85 0.09 150);
  border-color: oklch(0.6 0.1 150 / 0.5);
}

/* ── Body ───────────────────────────────────────────────────────── */
.qw__body {
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.qw__poll {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qw__opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 46px; /* phone thumb target */
  overflow: hidden;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
  padding: 10px 14px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), transform 100ms var(--ease-out);
}
.qw__opt:hover:not(:disabled) {
  border-color: var(--color-accent-strong, #c9a84c);
  transform: translateY(-1px);
}
.qw__opt--mine {
  border-color: var(--color-brand-800);
}
.qw__opt--mine .qw__opt-label {
  font-weight: 700;
}
.qw__opt--locked {
  cursor: default;
}
.qw__opt--locked:hover {
  transform: none;
}
.qw__opt--right {
  border-color: oklch(0.55 0.12 150);
  background: oklch(0.97 0.025 150);
}
.qw__opt--wrong {
  border-color: oklch(0.6 0.14 28);
}
.qw__opt-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, oklch(0.93 0.035 85), oklch(0.9 0.055 85));
  transition: width 350ms var(--ease-out);
}
.qw__opt--right .qw__opt-bar {
  background: oklch(0.93 0.04 150);
}
.qw__opt-label {
  position: relative;
  flex: 1;
  min-width: 0;
}
.qw__opt-mark {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: #fff;
}
.qw__opt-mark--right {
  background: oklch(0.55 0.12 150);
}
.qw__opt-mark--wrong {
  background: oklch(0.6 0.14 28);
}
.qw__opt-count {
  position: relative;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
.qw__poll-foot {
  font-size: 11.5px;
  color: var(--color-muted);
}

/* ── Reveal ─────────────────────────────────────────────────────── */
.qw__reveal {
  border-radius: 11px;
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-accent-strong, #c9a84c);
  background: var(--color-surface-soft);
  padding: 11px 14px;
}
.qw__reveal--right {
  border-left-color: oklch(0.55 0.12 150);
}
.qw__reveal--wrong {
  border-left-color: oklch(0.6 0.14 28);
}
.qw__reveal-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
  flex-wrap: wrap;
}
.qw__reveal--right .qw__reveal-head svg {
  color: oklch(0.55 0.12 150);
}
.qw__reveal--wrong .qw__reveal-head svg {
  color: oklch(0.6 0.14 28);
}
.qw__reveal-teach {
  margin: 7px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
}

/* ── Shift race ─────────────────────────────────────────────────── */
.qw__race {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.qw__race-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.qw__race-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 4px 11px;
  font-variant-numeric: tabular-nums;
}
.qw__race-chip b {
  color: var(--color-ink);
}
.qw__race-chip--lead {
  border-color: var(--color-accent-strong, #c9a84c);
  background: oklch(0.96 0.035 85);
  box-shadow: inset 0 0 0 1px oklch(0.78 0.09 85 / 0.4);
}
.qw__race-lead-note {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-accent-strong, #a8842c);
}

/* ── Thread ─────────────────────────────────────────────────────── */
.qw__thread {
  border-top: 1px solid var(--color-line-soft, #eee);
  padding-top: 10px;
}
.qw__thread :deep(.thread__list) {
  max-height: 300px;
}

@media (max-width: 480px) {
  .qw__head {
    padding: 14px 14px 12px;
  }
  .qw__body {
    padding: 14px 14px 12px;
    gap: 12px;
  }
  .qw__opt-count {
    font-size: 10px;
  }
}
</style>
