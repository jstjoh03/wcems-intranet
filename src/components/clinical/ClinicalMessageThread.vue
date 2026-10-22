<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usePipeline } from '@/composables/usePipeline'
import { useClinicalMessages } from '@/composables/useClinicalMessages'

/**
 * One trainee's message thread — FTO, trainee, and Clinical leave
 * comments and questions in one place instead of texts that get lost.
 * Visible (RLS) to clinical editors, admins, supervisors, the trainee,
 * and their FTOs; a new post sends push + email to Clinical, the FTO,
 * the trainee, and earlier posters — never the author.
 */

const props = defineProps<{
  recordId: string
  /** The trainee's app_user id — used to tag their rows. */
  traineeUserId: string
}>()

const auth = useAuthStore()
const { allPeople, editorIds } = usePipeline()
const { threadFor, loadThread, postMessage } = useClinicalMessages()

onMounted(() => void loadThread(props.recordId))

const messages = computed(() => threadFor(props.recordId))

function nameFor(userId: string): string {
  return allPeople.value.find((p) => p.userId === userId)?.fullName ?? 'Staff'
}

function roleFor(userId: string): string {
  if (userId === props.traineeUserId) return 'Trainee'
  if (editorIds.value.includes(userId)) return 'Clinical'
  return 'FTO / Supervisor'
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const t = d
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    .replace(':', '')
  return `${date} · ${t}`
}

const draft = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function onPost(): Promise<void> {
  if (busy.value || !draft.value.trim()) return
  busy.value = true
  error.value = null
  const e = await postMessage(props.recordId, draft.value)
  busy.value = false
  if (e) {
    error.value = e
    return
  }
  draft.value = ''
}
</script>

<template>
  <div class="mt">
    <p v-if="messages.length === 0" class="mt__empty">
      No messages yet — questions and notes posted here reach Clinical, the FTO, and the
      trainee.
    </p>
    <div v-for="m in messages" :key="m.id" class="mt__msg">
      <div class="mt__head">
        <b>{{ nameFor(m.authorId) }}</b>
        <span class="mt__role">{{ roleFor(m.authorId) }}</span>
        <span class="mt__when">{{ fmtWhen(m.createdAt) }}</span>
      </div>
      <div class="mt__body">{{ m.body }}</div>
    </div>

    <div class="mt__compose">
      <input
        v-model="draft"
        class="mt__input"
        placeholder="Write a message…"
        :disabled="busy"
        @keyup.enter="onPost"
      />
      <button type="button" class="mt__post" :disabled="busy || !draft.trim()" @click="onPost">
        {{ busy ? 'Posting…' : 'Post' }}
      </button>
    </div>
    <p v-if="error" class="mt__error">{{ error }}</p>
    <p class="mt__note">
      Visible to Clinical, {{ auth.appUser?.id === traineeUserId ? 'you' : 'the trainee' }},
      their FTO, and supervisors. A new post sends push + email to Clinical, the FTO, and
      earlier posters.
    </p>
  </div>
</template>

<style scoped>
.mt {
  font-family: var(--font-sans);
}
.mt__empty {
  font-size: 12.5px;
  color: var(--color-muted);
  line-height: 1.5;
  margin: 0 0 8px;
}
.mt__msg {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-line-soft, var(--color-line));
}
.mt__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  color: var(--color-ink);
}
.mt__role {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 5px;
  padding: 1px 6px;
}
.mt__when {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mt__body {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  line-height: 1.5;
  margin-top: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mt__compose {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.mt__input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
}
.mt__post {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}
.mt__post:disabled {
  opacity: 0.55;
  cursor: default;
}
.mt__error {
  font-size: 12px;
  font-weight: 600;
  color: oklch(0.5 0.17 25);
  margin: 6px 0 0;
}
.mt__note {
  font-size: 11px;
  color: var(--color-muted);
  line-height: 1.45;
  margin: 8px 0 0;
}
</style>
