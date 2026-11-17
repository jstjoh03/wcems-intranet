<script setup lang="ts">
import { computed, watch } from 'vue'
import { MessageCircleQuestion } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useQotw } from '@/composables/useQotw'
import { useQotwComments } from '@/composables/useQotwComments'
import { useQotwVotes } from '@/composables/useQotwVotes'
import { useAuthStore } from '@/stores/auth'

/**
 * Question of the Week — the engagement card. One question at a time
 * (published Monday mornings from the admin queue at /admin/qotw).
 * Text questions get the shared CommentThread; polls get vote bars
 * (tap to vote, tap another to change) plus the same thread for
 * discussion. Everything realtime.
 *
 * Renders nothing when no question has ever been published — except
 * for admins, who get a stocking hint.
 */

const auth = useAuthStore()
const { current, ready } = useQotw()
const { comments, loading, load, post, remove } = useQotwComments()
const votes = useQotwVotes()

watch(
  current,
  (q) => {
    if (q) void load(q.id)
  },
  { immediate: true },
)

const options = computed(() => current.value?.options ?? [])
const voteCounts = computed(() =>
  current.value ? votes.counts(current.value.id, options.value.length) : [],
)
const total = computed(() => (current.value ? votes.totalVotes(current.value.id) : 0))
const mine = computed(() => (current.value ? votes.myVote(current.value.id) : null))

function pct(i: number): number {
  if (!total.value) return 0
  return Math.round((voteCounts.value[i] / total.value) * 100)
}

function weekLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return `week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
</script>

<template>
  <AppCard v-if="current || (ready && auth.isAdmin)" class="qotw">
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <Eyebrow>Question of the Week</Eyebrow>
      <span v-if="current?.weekOf" class="qotw__week">{{ weekLabel(current.weekOf) }}</span>
    </div>

    <!-- Admin stocking hint when nothing has ever published -->
    <div v-if="!current" class="qotw__empty">
      <MessageCircleQuestion :size="18" :stroke-width="1.8" />
      <span>
        No question is live yet — stock the queue at
        <RouterLink to="/admin/qotw" class="qotw__empty-link">Admin → Question of the Week</RouterLink>.
      </span>
    </div>

    <template v-else>
      <h3 class="qotw__prompt display">{{ current.prompt }}</h3>

      <!-- Poll -->
      <div v-if="current.kind === 'poll'" class="qotw__poll">
        <button
          v-for="(opt, i) in options"
          :key="i"
          type="button"
          class="qotw__opt"
          :class="{ 'qotw__opt--mine': mine === i, 'qotw__opt--kiosk': auth.isKiosk }"
          :disabled="auth.isKiosk"
          :title="auth.isKiosk ? 'Voting is disabled on station accounts' : mine === i ? 'Your vote' : 'Tap to vote'"
          @click="current && votes.vote(current.id, i)"
        >
          <span class="qotw__opt-bar" :style="{ width: `${pct(i)}%` }"></span>
          <span class="qotw__opt-label">{{ opt }}</span>
          <span class="qotw__opt-count">{{ voteCounts[i] ?? 0 }} · {{ pct(i) }}%</span>
        </button>
        <div class="qotw__poll-foot">
          {{ total }} {{ total === 1 ? 'vote' : 'votes' }}
          <template v-if="mine !== null"> · you voted — tap another option to change</template>
          <template v-else-if="!auth.isKiosk"> · tap an option to vote</template>
        </div>
      </div>

      <!-- Answers / discussion -->
      <div class="qotw__thread">
        <CommentThread
          :comments="comments"
          :loading="loading"
          :empty-hint="current.kind === 'poll' ? 'Add a comment to go with your vote.' : 'Be the first to answer.'"
          @post="(b: string) => current && post(current.id, b)"
          @remove="(cid: string) => current && remove(current.id, cid)"
        />
      </div>
    </template>
  </AppCard>
</template>

<style scoped>
.qotw__week {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  letter-spacing: 0.03em;
}
.qotw__empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 4px;
  font-size: 13px;
  color: var(--color-muted);
}
.qotw__empty-link {
  color: var(--color-brand-600);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.qotw__prompt {
  font-size: 19px;
  line-height: 1.3;
  color: var(--color-ink);
  margin-bottom: 12px;
}

.qotw__poll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.qotw__opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  overflow: hidden;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1.5px solid var(--color-line);
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.qotw__opt:hover:not(:disabled) {
  border-color: var(--color-brand-600);
}
.qotw__opt--mine {
  border-color: var(--color-brand-600);
}
.qotw__opt--mine .qotw__opt-label {
  font-weight: 700;
}
.qotw__opt--kiosk {
  cursor: default;
}
.qotw__opt-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--color-brand-50);
  transition: width 300ms var(--ease-out);
}
.qotw__opt--mine .qotw__opt-bar {
  background: var(--color-brand-100);
}
.qotw__opt-label {
  position: relative;
  flex: 1;
  min-width: 0;
}
.qotw__opt-count {
  position: relative;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
.qotw__poll-foot {
  font-size: 11.5px;
  color: var(--color-muted);
}

.qotw__thread {
  margin-top: 4px;
}
.qotw__thread :deep(.thread__list) {
  max-height: 320px;
}
</style>
