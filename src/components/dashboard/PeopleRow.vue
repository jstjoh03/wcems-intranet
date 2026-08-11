<script setup lang="ts">
import { ref } from 'vue'
import { Cake, Star, Award, Heart, Users, MessageCircle, Edit2 } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useGreeting } from '@/composables/useGreeting'
import { useBirthdayReactions } from '@/composables/useBirthdayReactions'
import { useBirthdayComments } from '@/composables/useBirthdayComments'
import { useTodaysBirthdays } from '@/composables/useTodaysBirthdays'
import { useSpotlight } from '@/composables/useSpotlight'
import { useQuickLinks } from '@/composables/useQuickLinks'
import { computed } from 'vue'
import BirthdayCommentsModal from './BirthdayCommentsModal.vue'
import SpotlightEditModal from './SpotlightEditModal.vue'
import SpotlightDetailModal from './SpotlightDetailModal.vue'

const auth = useAuthStore()
const { isoDate } = useGreeting()

const { birthdays } = useTodaysBirthdays()
const { current: spotlight } = useSpotlight()

const spotlightEditOpen = ref(false)
const spotlightDetailOpen = ref(false)

/* Kudos form (supervisor's Jotform, admin-curated in quick links) —
   surfaced under the spotlight to keep recognition submissions coming. */
const { links: quickLinks } = useQuickLinks()
const SHOUTOUT_FALLBACK = 'https://form.jotform.com/261249366820056'
const shoutoutUrl = computed(
  () => quickLinks.value.find((l) => l.label === 'Employee Shoutout')?.url ?? SHOUTOUT_FALLBACK,
)

const reactions = useBirthdayReactions()
const comments = useBirthdayComments()

const activeBirthday = ref<{
  name: string
  title: string
  station: string
  roleFallback: string
  personKey: string
} | null>(null)

function openComments(b: {
  name: string
  title: string
  station: string
  roleFallback: string
  personKey: string
}) {
  activeBirthday.value = { ...b }
}

function initials(name: string) {
  return name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
}

</script>

<template>
  <section id="people" class="reveal" style="margin-top: 48px; animation-delay: 200ms">
    <Eyebrow class="mb-4">People</Eyebrow>
    <div class="people-row">
      <!-- Spotlight (or empty state) -->
      <AppCard class="spotlight" :class="{ 'spotlight--with-photo': spotlight?.photoUrl }">
        <div
          class="spotlight__art"
          :style="
            spotlight?.photoUrl
              ? { backgroundImage: `url(${spotlight.photoUrl})` }
              : undefined
          "
        >
          <Award v-if="!spotlight?.photoUrl" :size="56" class="spotlight__art-icon" />
          <AppChip class="spotlight__chip">
            <Star :size="9" /> Spotlight
          </AppChip>
          <button
            v-if="auth.isAdmin && spotlight"
            type="button"
            class="spotlight__edit-btn"
            aria-label="Edit spotlight"
            @click="spotlightEditOpen = true"
          >
            <Edit2 :size="13" :stroke-width="1.85" />
          </button>
        </div>
        <div class="spotlight__body">
          <template v-if="spotlight">
            <div
              v-if="spotlight.role || spotlight.tenure"
              class="spotlight__role"
            >
              {{ spotlight.role
              }}<template v-if="spotlight.role && spotlight.tenure"> · </template
              >{{ spotlight.tenure }}
            </div>
            <h3 class="spotlight__name display">{{ spotlight.personName }}</h3>
            <p v-if="spotlight.blurb" class="spotlight__blurb">"{{ spotlight.blurb }}"</p>
            <button
              v-if="spotlight.story"
              type="button"
              class="spotlight__story-link"
              @click="spotlightDetailOpen = true"
            >
              Read the full story →
            </button>
          </template>
          <template v-else>
            <div class="spotlight__role">Recognition</div>
            <h3 class="spotlight__name display">Nobody in the spotlight yet</h3>
            <p class="spotlight__blurb">
              When admin highlights a teammate's work, they'll appear here with a quick blurb.
            </p>
            <button
              v-if="auth.isAdmin"
              class="spotlight__add"
              type="button"
              @click="spotlightEditOpen = true"
            >
              + Choose a spotlight
            </button>
          </template>

          <!-- Kudos pipeline: the spotlight is fed by shoutouts, so the
               ask lives right where the recognition is displayed. -->
          <a class="spotlight__kudos" :href="shoutoutUrl" target="_blank" rel="noopener">
            <Star :size="12" :stroke-width="2" />
            Seen a teammate go above and beyond? Send a shoutout →
          </a>
        </div>
      </AppCard>

      <!-- Birthdays -->
      <AppCard class="birthdays">
        <div class="flex items-center gap-2 mb-3">
          <Cake :size="13" :stroke-width="1.85" style="color: var(--color-accent-700)" />
          <Eyebrow>Birthdays today</Eyebrow>
        </div>

        <div v-if="birthdays.length === 0" class="birthdays__empty">
          <Users :size="18" :stroke-width="1.5" class="birthdays__empty-icon" />
          <div class="birthdays__empty-title">No birthdays today</div>
          <p class="birthdays__empty-sub">We'll celebrate again tomorrow.</p>
        </div>

        <div v-else class="birthdays__list">
          <div
            v-for="b in birthdays"
            :key="b.personKey"
            class="birthdays__row"
          >
            <div class="birthdays__avatar display">{{ initials(b.name) }}</div>
            <div class="flex-1 min-w-0">
              <div class="birthdays__name display">{{ b.name }}</div>
              <div class="birthdays__meta">
                {{ b.title || b.roleFallback
                }}<template v-if="b.station"> · {{ b.station }}</template>
              </div>
            </div>
            <div class="birthdays__actions">
              <button
                v-if="!auth.isKiosk"
                type="button"
                class="birthdays__heart"
                :class="{ 'birthdays__heart--reacted': reactions.hasReacted(isoDate, b.personKey) }"
                :aria-pressed="reactions.hasReacted(isoDate, b.personKey)"
                :aria-label="
                  reactions.hasReacted(isoDate, b.personKey)
                    ? `You wished ${b.name.split(' ')[0]} happy birthday — tap to undo`
                    : `Send happy birthday to ${b.name.split(' ')[0]}`
                "
                @click="reactions.toggle(isoDate, b.personKey)"
              >
                <Heart
                  :size="14"
                  :fill="reactions.hasReacted(isoDate, b.personKey) ? 'currentColor' : 'none'"
                />
                <span
                  v-if="reactions.getCount(isoDate, b.personKey) > 0"
                  class="birthdays__heart-count"
                >
                  {{ reactions.getCount(isoDate, b.personKey) }}
                </span>
              </button>
              <button
                type="button"
                class="birthdays__comment"
                :aria-label="`Leave a note for ${b.name.split(' ')[0]}`"
                @click="openComments(b)"
              >
                <MessageCircle :size="14" :stroke-width="1.85" />
                <span
                  v-if="comments.getCount(isoDate, b.personKey) > 0"
                  class="birthdays__heart-count"
                >
                  {{ comments.getCount(isoDate, b.personKey) }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </AppCard>
    </div>

    <BirthdayCommentsModal
      :target="activeBirthday"
      :birthday-date="isoDate"
      :person-key="activeBirthday?.personKey ?? ''"
      @close="activeBirthday = null"
    />

    <SpotlightDetailModal
      :spotlight="spotlightDetailOpen ? spotlight : null"
      :shoutout-url="shoutoutUrl"
      @close="spotlightDetailOpen = false"
    />

    <SpotlightEditModal
      :open="spotlightEditOpen"
      @close="spotlightEditOpen = false"
    />
  </section>
</template>

<style scoped>
.people-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 768px) {
  .people-row {
    grid-template-columns: 2fr 1fr;
  }
}

.spotlight {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (min-width: 768px) {
  .spotlight {
    flex-direction: row;
  }
}
.spotlight__art {
  position: relative;
  width: 100%;
  /* Tall enough on mobile to show a portrait headshot without cropping
     the face. Most spotlight photos are framed with the subject in the
     upper portion, so anchor to the top-third (25%) instead of center
     when there's a real image. */
  height: 260px;
  background: linear-gradient(
    135deg,
    var(--color-accent-500) 0%,
    var(--color-accent-700) 100%
  );
  background-size: cover;
  background-position: center 25%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
@media (min-width: 768px) {
  .spotlight__art {
    width: 42%;
    height: auto;
    min-height: 240px;
  }
}
.spotlight__art-icon {
  color: var(--color-brand-900);
  opacity: 0.25;
}
/* When a real photo is set, the gradient is replaced by the image and
   we don't want the Award placeholder dimming over it. The chip still
   reads clearly against any image because of its solid dark fill. */
.spotlight--with-photo .spotlight__art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    oklch(0 0 0 / 0) 60%,
    oklch(0 0 0 / 0.25) 100%
  );
  pointer-events: none;
}
.spotlight__edit-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.85);
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 120ms var(--ease-out);
  z-index: 1;
}
.spotlight__edit-btn:hover {
  background: white;
}
.spotlight__chip {
  position: absolute;
  top: 14px;
  left: 14px;
  background: var(--color-brand-900);
  color: var(--color-accent-500);
  border-color: transparent;
  font-weight: 600;
}
.spotlight__body {
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
@media (min-width: 768px) {
  .spotlight__body {
    padding: 32px;
  }
}
.spotlight__role {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.spotlight__name {
  margin-top: 4px;
  font-size: 28px;
  line-height: 1.05;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .spotlight__name {
    font-size: 32px;
  }
}
.spotlight__blurb {
  margin-top: 12px;
  max-width: 32rem;
  font-size: 14px;
  color: var(--color-ink-soft);
  line-height: 1.6;
}
.spotlight__add {
  margin-top: 12px;
  align-self: flex-start;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.spotlight__add:hover {
  border-color: var(--color-muted-soft);
}

.birthdays {
  padding: 20px;
}
.birthdays__empty {
  text-align: center;
  padding: 12px 4px 4px;
}
.birthdays__empty-icon {
  color: var(--color-muted-soft);
  margin: 0 auto 6px;
}
.birthdays__empty-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.birthdays__empty-sub {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-muted);
}

.birthdays__list {
  display: flex;
  flex-direction: column;
}
.birthdays__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.birthdays__row + .birthdays__row {
  border-top: 1px solid var(--color-line-soft);
}
.birthdays__avatar {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12.5px;
  flex-shrink: 0;
}
.birthdays__name {
  font-size: 15.5px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  line-height: 1.2;
}
.birthdays__meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.birthdays__actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.birthdays__heart,
.birthdays__comment {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
  color: var(--color-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  transition:
    color 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.birthdays__heart:hover,
.birthdays__comment:hover {
  color: var(--color-ink-soft);
}
.birthdays__heart:active,
.birthdays__comment:active {
  transform: scale(0.94);
}
.birthdays__heart--reacted,
.birthdays__heart--reacted:hover {
  color: var(--color-danger-500);
}
.birthdays__comment:hover {
  color: var(--color-brand-600);
}
.birthdays__heart-count {
  letter-spacing: 0.02em;
  min-width: 0.7em;
  text-align: center;
}
.spotlight__story-link {
  margin-top: 10px;
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  transition: color 120ms var(--ease-out);
}
.spotlight__story-link:hover {
  color: var(--color-accent-700);
}

.spotlight__kudos {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-line-soft);
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-muted);
  text-decoration: none;
  transition: color 120ms var(--ease-out);
}
.spotlight__kudos:hover {
  color: var(--color-accent-700);
}
.spotlight__kudos svg {
  color: var(--color-accent-600);
  flex-shrink: 0;
}
</style>