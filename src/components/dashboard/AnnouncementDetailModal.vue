<script setup lang="ts">
import { computed, watch } from 'vue'
import { X, Megaphone } from 'lucide-vue-next'
import AppChip from '@/components/primitives/AppChip.vue'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useAnnouncementComments } from '@/composables/useAnnouncementComments'
import type { Announcement } from '@/types'

/**
 * Full-story view of an announcement — same pattern as the employee
 * spotlight: the card shows a snippet and links here, where the whole
 * post fits, plus a comment thread when the announcement was posted
 * with comments allowed (e.g. congratulations on the remission news).
 */
const props = defineProps<{
  announcement: Announcement | null
}>()

const emit = defineEmits<{ close: [] }>()

const { comments, loading, load, post, remove } = useAnnouncementComments()

watch(
  () => props.announcement?.id,
  (id) => {
    if (id && props.announcement?.allowComments) void load(id)
  },
  { immediate: true },
)

/** Split the body into paragraphs on blank lines (single newlines keep
 *  the paragraph together, matching how the card renders). */
const paragraphs = computed(() =>
  (props.announcement?.body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean),
)

async function onPost(body: string) {
  if (props.announcement) await post(props.announcement.id, body)
}
async function onRemove(commentId: string) {
  if (props.announcement) await remove(props.announcement.id, commentId)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ad-fade" :duration="180">
      <div v-if="announcement" class="ad-overlay" @click.self="emit('close')">
        <div
          class="ad-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="`Announcement: ${announcement.title}`"
        >
          <button class="ad-close" aria-label="Close" @click="emit('close')">
            <X :size="18" />
          </button>

          <div class="ad-hero">
            <div class="ad-hero__icon">
              <Megaphone :size="26" :stroke-width="1.75" />
            </div>
            <div class="min-w-0">
              <div class="ad-eyebrow">Announcement</div>
              <h2 class="ad-title display">{{ announcement.title }}</h2>
              <div class="ad-meta">
                <AppChip variant="brand">{{ announcement.tag }}</AppChip>
                <span>{{ announcement.date }}</span>
                <span>· {{ announcement.authorName }}</span>
              </div>
            </div>
          </div>

          <div class="ad-body">
            <img
              v-if="announcement.imageUrl"
              :src="announcement.imageUrl"
              :alt="`${announcement.title} image`"
              class="ad-image"
              referrerpolicy="no-referrer"
            />
            <p v-for="(p, i) in paragraphs" :key="i" class="ad-para">{{ p }}</p>

            <div v-if="announcement.allowComments" class="ad-thread">
              <div class="ad-thread__head">Comments</div>
              <CommentThread
                :comments="comments"
                :loading="loading"
                empty-hint="Be the first to leave a comment."
                @post="onPost"
                @remove="onRemove"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ad-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.15 0.03 250 / 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
@media (min-width: 640px) {
  .ad-overlay {
    align-items: center;
    padding: 24px;
  }
}

.ad-panel {
  position: relative;
  width: 100%;
  max-width: 620px;
  max-height: 92dvh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: 18px 18px 0 0;
  box-shadow: var(--shadow-lg);
}
@media (min-width: 640px) {
  .ad-panel {
    border-radius: 18px;
    max-height: 86vh;
  }
}

.ad-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-ink-soft);
  box-shadow: var(--shadow-sm);
}

.ad-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 26px 56px 18px 26px;
  background:
    radial-gradient(ellipse 80% 90% at 20% 0%, oklch(0.4 0.13 250 / 0.5), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border-bottom: 2px solid var(--color-accent-600);
}
.ad-hero__icon {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--color-brand-800);
  color: var(--color-accent-on-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px oklch(0.08 0.03 250 / 0.5);
}
.ad-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
}
.ad-title {
  margin-top: 4px;
  font-size: 24px;
  line-height: 1.15;
  color: white;
  overflow-wrap: anywhere;
}
.ad-meta {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: oklch(0.78 0.03 250);
}

.ad-body {
  padding: 20px 26px 26px;
}
.ad-image {
  display: block;
  width: 100%;
  max-height: 340px;
  object-fit: contain;
  background: var(--color-surface-sunk);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  margin-bottom: 14px;
}
.ad-para {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-ink-soft);
  white-space: pre-line;
}
.ad-para + .ad-para {
  margin-top: 12px;
}

.ad-thread {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--color-line);
}
.ad-thread__head {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  margin-bottom: 10px;
}

.ad-fade-enter-active,
.ad-fade-leave-active {
  transition: opacity 180ms var(--ease-out);
}
.ad-fade-enter-from,
.ad-fade-leave-to {
  opacity: 0;
}
</style>
