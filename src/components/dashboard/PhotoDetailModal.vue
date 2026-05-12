<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { X, Heart, MessageCircle } from 'lucide-vue-next'
import AppChip from '@/components/primitives/AppChip.vue'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useAuthStore } from '@/stores/auth'
import { usePhotoReactions } from '@/composables/usePhotoReactions'
import { usePhotoComments } from '@/composables/usePhotoComments'
import type { GalleryPhoto } from '@/composables/useGallery'

const props = defineProps<{
  photo: GalleryPhoto | null
}>()

const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const currentUserId = computed(() => auth.appUser?.id ?? 'anonymous')
const reactions = usePhotoReactions(currentUserId.value)
const comments = usePhotoComments(currentUserId.value)

const loadingThread = ref(false)

const reacted = computed(() =>
  props.photo ? reactions.hasReacted(props.photo.id) : false,
)
const reactionCount = computed(() =>
  props.photo ? reactions.getCount(props.photo.id) : 0,
)
const thread = computed(() =>
  props.photo ? comments.getThread(props.photo.id) : [],
)
const commentCount = computed(() =>
  props.photo ? comments.getCount(props.photo.id) : 0,
)

watch(
  () => props.photo,
  async (next) => {
    if (next) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onEsc)
      loadingThread.value = true
      await comments.ensureThreadLoaded(next.id)
      loadingThread.value = false
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onEsc)
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (props.photo) document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onEsc)
})

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

function onToggleHeart() {
  if (!props.photo) return
  void reactions.toggle(props.photo.id)
}

async function onPost(body: string) {
  if (!props.photo) return
  const result = await comments.post(props.photo.id, body, {
    name: auth.appUser?.fullName ?? 'Crew',
  })
  if (!result.ok) alert(result.error)
}

async function onRemove(id: string) {
  if (!props.photo) return
  if (!confirm('Delete this comment?')) return
  const result = await comments.remove(props.photo.id, id)
  if (!result.ok) alert(result.error)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="photo-modal">
      <div
        v-if="photo"
        class="photo-modal-overlay"
        @click.self="$emit('close')"
      >
        <div
          class="photo-modal"
          role="dialog"
          :aria-labelledby="photo.caption ? 'photo-modal-caption' : undefined"
        >
          <button
            type="button"
            class="photo-modal__close"
            aria-label="Close"
            @click="$emit('close')"
          >
            <X :size="18" />
          </button>

          <div class="photo-modal__hero">
            <img :src="photo.imageUrl" :alt="photo.caption || 'Gallery photo'" />
            <AppChip class="photo-modal__chip">{{ photo.tag }}</AppChip>
          </div>

          <div class="photo-modal__body">
            <div v-if="photo.caption" class="photo-modal__caption" id="photo-modal-caption">
              {{ photo.caption }}
            </div>

            <div class="photo-modal__actions">
              <button
                type="button"
                class="photo-modal__heart"
                :class="{ 'photo-modal__heart--reacted': reacted }"
                :aria-pressed="reacted"
                :aria-label="reacted ? 'Remove your heart' : 'Heart this photo'"
                @click="onToggleHeart"
              >
                <Heart :size="16" :fill="reacted ? 'currentColor' : 'none'" />
                <span v-if="reactionCount > 0">{{ reactionCount }}</span>
              </button>
              <div class="photo-modal__count">
                <MessageCircle :size="14" :stroke-width="1.85" />
                <span>{{ commentCount }} {{ commentCount === 1 ? 'comment' : 'comments' }}</span>
              </div>
            </div>

            <CommentThread
              :comments="thread"
              :loading="loadingThread"
              empty-hint="Be the first to leave a comment on this photo."
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
.photo-modal-overlay {
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
  .photo-modal-overlay {
    align-items: center;
  }
}

.photo-modal {
  position: relative;
  width: 100%;
  max-width: 640px;
  max-height: 92dvh;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.photo-modal__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.photo-modal__close:hover {
  background: white;
}

.photo-modal__hero {
  position: relative;
  width: 100%;
  background: oklch(0.18 0.015 260);
  flex-shrink: 0;
  /* Cap the hero so the thread always has breathing room — without
     this, very tall portrait photos push the comments below the fold. */
  max-height: 50vh;
}
.photo-modal__hero img {
  width: 100%;
  height: 100%;
  max-height: 50vh;
  object-fit: contain;
  display: block;
}
.photo-modal__chip {
  position: absolute;
  top: 12px;
  left: 12px;
  background: oklch(1 0 0 / 0.9);
  color: var(--color-brand-700);
  border-color: transparent;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.photo-modal__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 18px 18px;
  flex: 1;
  min-height: 0;
}

.photo-modal__caption {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 1.3;
  color: var(--color-ink);
}

.photo-modal__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-line-soft);
}
.photo-modal__heart {
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
.photo-modal__heart:hover {
  color: var(--color-ink-soft);
  border-color: var(--color-muted-soft);
}
.photo-modal__heart:active {
  transform: scale(0.94);
}
.photo-modal__heart--reacted,
.photo-modal__heart--reacted:hover {
  color: var(--color-danger-500);
  border-color: var(--color-danger-500);
}
.photo-modal__count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-muted);
}

.photo-modal-overlay {
  transition: opacity 200ms var(--ease-out);
}
.photo-modal {
  transition:
    transform 220ms var(--ease-out),
    opacity 200ms var(--ease-out);
}
.photo-modal-enter-from,
.photo-modal-leave-to {
  opacity: 0;
}
.photo-modal-enter-from .photo-modal,
.photo-modal-leave-to .photo-modal {
  transform: translateY(16px);
  opacity: 0;
}
</style>
