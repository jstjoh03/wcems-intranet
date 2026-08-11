<script setup lang="ts">
import { computed, watch } from 'vue'
import { X, Award, ExternalLink } from 'lucide-vue-next'
import CommentThread from '@/components/engagement/CommentThread.vue'
import { useSpotlightComments } from '@/composables/useSpotlightComments'
import type { Spotlight } from '@/composables/useSpotlight'

/**
 * Full-story view of the active spotlight — the card blurb links here
 * so a whole patient-encounter write-up fits, plus a congratulations
 * thread (internal-social style) so teammates can pile on. The kudos
 * Jotform link rides along at the bottom to keep the recognition
 * pipeline fed.
 */
const props = defineProps<{
  spotlight: Spotlight | null
  shoutoutUrl: string
}>()

const emit = defineEmits<{ close: [] }>()

const { comments, loading, load, post, remove } = useSpotlightComments()

watch(
  () => props.spotlight?.id,
  (id) => {
    if (id) void load(id)
  },
  { immediate: true },
)

/** Split the story into paragraphs on blank lines. */
const paragraphs = computed(() =>
  (props.spotlight?.story ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean),
)

async function onPost(body: string) {
  if (props.spotlight) await post(props.spotlight.id, body)
}
async function onRemove(commentId: string) {
  if (props.spotlight) await remove(props.spotlight.id, commentId)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sd-fade" :duration="180">
      <div v-if="spotlight" class="sd-overlay" @click.self="emit('close')">
        <div class="sd-panel" role="dialog" aria-modal="true" :aria-label="`Spotlight: ${spotlight.personName}`">
          <button class="sd-close" aria-label="Close" @click="emit('close')">
            <X :size="18" />
          </button>

          <div class="sd-hero">
            <div
              class="sd-photo"
              :style="spotlight.photoUrl ? { backgroundImage: `url(${spotlight.photoUrl})` } : undefined"
            >
              <Award v-if="!spotlight.photoUrl" :size="42" class="sd-photo__icon" />
            </div>
            <div>
              <div class="sd-eyebrow">Employee Spotlight</div>
              <h2 class="sd-name display">{{ spotlight.personName }}</h2>
              <div v-if="spotlight.role || spotlight.tenure" class="sd-role">
                {{ spotlight.role }}<template v-if="spotlight.role && spotlight.tenure"> · </template>{{ spotlight.tenure }}
              </div>
            </div>
          </div>

          <div class="sd-body">
            <p v-if="spotlight.blurb" class="sd-blurb">"{{ spotlight.blurb }}"</p>
            <template v-if="paragraphs.length">
              <p v-for="(p, i) in paragraphs" :key="i" class="sd-para">{{ p }}</p>
            </template>

            <div class="sd-thread">
              <div class="sd-thread__head">Congratulations &amp; comments</div>
              <CommentThread
                :comments="comments"
                :loading="loading"
                empty-hint="Be the first to congratulate them."
                @post="onPost"
                @remove="onRemove"
              />
            </div>

            <a class="sd-kudos" :href="shoutoutUrl" target="_blank" rel="noopener">
              Seen a teammate go above and beyond? Send a shoutout
              <ExternalLink :size="12" :stroke-width="2" />
            </a>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sd-overlay {
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
  .sd-overlay {
    align-items: center;
    padding: 24px;
  }
}

.sd-panel {
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
  .sd-panel {
    border-radius: 18px;
    max-height: 86vh;
  }
}

.sd-close {
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

.sd-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 26px 26px 18px;
  background:
    radial-gradient(ellipse 80% 90% at 20% 0%, oklch(0.4 0.13 250 / 0.5), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border-bottom: 2px solid var(--color-accent-600);
}
.sd-photo {
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 14px;
  background-color: var(--color-brand-800);
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px oklch(0.08 0.03 250 / 0.5);
}
.sd-photo__icon {
  color: var(--color-accent-on-dark);
}
.sd-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
}
.sd-name {
  margin-top: 4px;
  font-size: 26px;
  line-height: 1.1;
  color: white;
}
.sd-role {
  margin-top: 4px;
  font-size: 12.5px;
  color: oklch(0.78 0.03 250);
}

.sd-body {
  padding: 20px 26px 26px;
}
.sd-blurb {
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 1.45;
  color: var(--color-brand-600);
  margin-bottom: 14px;
}
.sd-para {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-ink-soft);
}
.sd-para + .sd-para {
  margin-top: 12px;
}

.sd-thread {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--color-line);
}
.sd-thread__head {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  margin-bottom: 10px;
}

.sd-kudos {
  margin-top: 18px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.sd-kudos:hover {
  text-decoration: underline;
}

.sd-fade-enter-active,
.sd-fade-leave-active {
  transition: opacity 180ms var(--ease-out);
}
.sd-fade-enter-from,
.sd-fade-leave-to {
  opacity: 0;
}
</style>
