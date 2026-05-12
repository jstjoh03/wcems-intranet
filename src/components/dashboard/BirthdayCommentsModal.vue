<script setup lang="ts">
import { computed, watch, onBeforeUnmount, ref } from 'vue'
import { X, Heart, MessageCircle, Cake } from 'lucide-vue-next'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useAuthStore } from '@/stores/auth'
import { useBirthdayReactions } from '@/composables/useBirthdayReactions'
import { useBirthdayComments } from '@/composables/useBirthdayComments'

const props = defineProps<{
  target: {
    name: string
    title?: string
    station?: string
    roleFallback?: string
  } | null
  birthdayDate: string
  personKey: string
}>()

const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const currentUserId = computed(() => auth.appUser?.id ?? 'anonymous')
const reactions = useBirthdayReactions(currentUserId.value)
const comments = useBirthdayComments(currentUserId.value)

const loadingThread = ref(false)

const initials = computed(() => {
  if (!props.target) return ''
  return props.target.name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
})

const reacted = computed(() =>
  props.target ? reactions.hasReacted(props.birthdayDate, props.personKey) : false,
)
const reactionCount = computed(() =>
  props.target ? reactions.getCount(props.birthdayDate, props.personKey) : 0,
)
const thread = computed(() =>
  props.target ? comments.getThread(props.birthdayDate, props.personKey) : [],
)
const commentCount = computed(() =>
  props.target ? comments.getCount(props.birthdayDate, props.personKey) : 0,
)

watch(
  () => props.target,
  async (next) => {
    if (next) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onEsc)
      loadingThread.value = true
      await comments.ensureThreadLoaded(props.birthdayDate, props.personKey)
      loadingThread.value = false
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEsc)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEsc)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onToggleHeart() {
  if (!props.target) return
  void reactions.toggle(props.birthdayDate, props.personKey)
}

async function onPost(body: string) {
  if (!props.target) return
  const result = await comments.post(props.birthdayDate, props.personKey, body, {
    name: auth.appUser?.fullName ?? 'Crew',
  })
  if (!result.ok) alert(result.error)
}

async function onRemove(id: string) {
  if (!props.target) return
  if (!confirm('Delete this comment?')) return
  const result = await comments.remove(props.birthdayDate, props.personKey, id)
  if (!result.ok) alert(result.error)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="bday-modal">
      <div v-if="target" class="bday-modal-overlay" @click.self="$emit('close')">
        <div class="bday-modal" role="dialog" aria-labelledby="bday-modal-title">
          <header class="bday-modal__head">
            <div class="bday-modal__avatar display">{{ initials }}</div>
            <div class="bday-modal__head-text">
              <div class="bday-modal__eyebrow">
                <Cake :size="11" :stroke-width="1.9" />
                <span>Birthday today</span>
              </div>
              <h2 id="bday-modal-title" class="bday-modal__title display">
                {{ target.name }}
              </h2>
              <div class="bday-modal__meta">
                {{ target.title || target.roleFallback || '' }}
                <template v-if="target.station"> · {{ target.station }}</template>
              </div>
            </div>
            <button
              type="button"
              class="bday-modal__close"
              aria-label="Close"
              @click="$emit('close')"
            >
              <X :size="18" />
            </button>
          </header>

          <div class="bday-modal__actions">
            <button
              type="button"
              class="bday-modal__heart"
              :class="{ 'bday-modal__heart--reacted': reacted }"
              :aria-pressed="reacted"
              :aria-label="
                reacted
                  ? `You wished ${target.name.split(' ')[0]} happy birthday — tap to undo`
                  : `Wish ${target.name.split(' ')[0]} a happy birthday`
              "
              @click="onToggleHeart"
            >
              <Heart :size="16" :fill="reacted ? 'currentColor' : 'none'" />
              <span>{{ reactionCount > 0 ? reactionCount : 'Send love' }}</span>
            </button>
            <div class="bday-modal__count">
              <MessageCircle :size="14" :stroke-width="1.85" />
              <span>{{ commentCount }} {{ commentCount === 1 ? 'comment' : 'comments' }}</span>
            </div>
          </div>

          <div class="bday-modal__thread-wrap">
            <CommentThread
              :comments="thread"
              :loading="loadingThread"
              :empty-hint="`Leave a note for ${target.name.split(' ')[0]}.`"
              @post="onPost"
              @remove="onRemove"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bday-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: oklch(0.16 0.015 260 / 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
}
@media (min-width: 640px) {
  .bday-modal-overlay {
    align-items: center;
  }
}

.bday-modal {
  width: 100%;
  max-width: 520px;
  max-height: 92dvh;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bday-modal__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--color-line-soft);
}
.bday-modal__avatar {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.bday-modal__head-text {
  flex: 1;
  min-width: 0;
}
.bday-modal__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.bday-modal__title {
  font-size: 20px;
  margin-top: 2px;
  color: var(--color-ink);
  line-height: 1.15;
}
.bday-modal__meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.bday-modal__close {
  align-self: flex-start;
  background: transparent;
  border: none;
  border-radius: 6px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  cursor: pointer;
}
.bday-modal__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.bday-modal__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-line-soft);
}
.bday-modal__heart {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--color-line);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 999px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  transition:
    color 140ms var(--ease-out),
    border-color 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.bday-modal__heart:hover {
  color: var(--color-ink-soft);
  border-color: var(--color-muted-soft);
}
.bday-modal__heart:active {
  transform: scale(0.94);
}
.bday-modal__heart--reacted,
.bday-modal__heart--reacted:hover {
  color: var(--color-danger-500);
  border-color: var(--color-danger-500);
}
.bday-modal__count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-muted);
}

.bday-modal__thread-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px 18px 18px;
}

.bday-modal-overlay {
  transition: opacity 200ms var(--ease-out);
}
.bday-modal {
  transition:
    transform 220ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.bday-modal-enter-from,
.bday-modal-leave-to {
  opacity: 0;
}
.bday-modal-enter-from .bday-modal,
.bday-modal-leave-to .bday-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
