<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { Send, Trash2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

/**
 * Generic comment thread renderer — list of comments + post input.
 *
 * Stays dumb: takes an array of normalized comments + handlers; the
 * parent (PhotoDetailModal / BirthdayCommentsModal) owns the data
 * fetch and decides which composable to call.
 */

export interface ThreadComment {
  id: string
  userId: string
  authorName: string
  authorInitials: string
  body: string
  createdAt: string
}

const props = defineProps<{
  comments: ThreadComment[]
  loading?: boolean
  /** Disables the input — e.g., when offline or unauthorized. */
  disabled?: boolean
  /** Override the "no comments yet" copy. */
  emptyHint?: string
}>()

const emit = defineEmits<{
  post: [body: string]
  remove: [commentId: string]
}>()

const auth = useAuthStore()
const text = ref('')
const submitting = ref(false)
const listEl = ref<HTMLElement | null>(null)

const canSubmit = computed(
  () => text.value.trim().length > 0 && !submitting.value && !props.disabled,
)

const sorted = computed(() =>
  [...props.comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  ),
)

watch(
  () => props.comments.length,
  async () => {
    /* Pin scroll to the bottom after a new post lands — chat-style. */
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  },
)

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function canDelete(c: ThreadComment) {
  return auth.isAdmin || auth.appUser?.id === c.userId
}

async function submit() {
  if (!canSubmit.value) return
  const body = text.value.trim()
  submitting.value = true
  emit('post', body)
  /* Optimistic clear — parent should append on success. If parent
     rejects, it can reset the input by re-binding (rare). */
  text.value = ''
  submitting.value = false
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void submit()
  }
}
</script>

<template>
  <div class="thread">
    <div ref="listEl" class="thread__list">
      <div v-if="loading" class="thread__loading">Loading comments…</div>

      <div v-else-if="sorted.length === 0" class="thread__empty">
        {{ emptyHint ?? "Be the first to leave a comment." }}
      </div>

      <div v-for="c in sorted" :key="c.id" class="thread__row">
        <div class="thread__avatar display">{{ c.authorInitials }}</div>
        <div class="thread__bubble">
          <div class="thread__bubble-head">
            <span class="thread__author">{{ c.authorName }}</span>
            <span class="thread__time">{{ formatTime(c.createdAt) }}</span>
            <button
              v-if="canDelete(c)"
              type="button"
              class="thread__delete"
              :aria-label="`Delete comment by ${c.authorName}`"
              @click="$emit('remove', c.id)"
            >
              <Trash2 :size="11" :stroke-width="1.85" />
            </button>
          </div>
          <div class="thread__body">{{ c.body }}</div>
        </div>
      </div>
    </div>

    <form class="thread__compose" @submit.prevent="submit">
      <input
        v-model="text"
        type="text"
        maxlength="500"
        placeholder="Add a comment…"
        class="thread__input"
        :disabled="!!disabled"
        @keydown="onKey"
      />
      <button
        type="submit"
        class="thread__send"
        :disabled="!canSubmit"
        aria-label="Post comment"
      >
        <Send :size="14" :stroke-width="1.9" />
      </button>
    </form>
  </div>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* parent decides height — thread fills it */
}

.thread__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 8px;
}

.thread__loading,
.thread__empty {
  font-size: 12.5px;
  color: var(--color-muted);
  text-align: center;
  padding: 18px 8px;
}

.thread__row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.thread__avatar {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: 1px solid var(--color-brand-100);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.thread__bubble {
  flex: 1;
  min-width: 0;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 6px 10px 8px;
}
.thread__bubble-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.thread__author {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
}
.thread__time {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-muted);
  letter-spacing: 0.02em;
}
.thread__delete {
  margin-left: auto;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}
.thread__delete:hover {
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
}
.thread__body {
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--color-ink-soft);
  word-wrap: break-word;
  white-space: pre-wrap;
}

.thread__compose {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--color-line-soft);
}
.thread__input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 8px 14px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.thread__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.thread__input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.thread__send {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-brand-600);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.thread__send:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.thread__send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
