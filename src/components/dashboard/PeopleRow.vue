<script setup lang="ts">
import { computed } from 'vue'
import { Cake, Star, Award, Heart, Users } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import peopleData from '@/data/people.json'
import { useAuthStore } from '@/stores/auth'
import { useGreeting } from '@/composables/useGreeting'
import { useBirthdayReactions } from '@/composables/useBirthdayReactions'

const auth = useAuthStore()
const { isoDate } = useGreeting()
const people = peopleData as {
  spotlight: { name: string; role: string; tenure: string; blurb: string } | null
  birthdays: Array<{ name: string; role: string; shift: string; date: string }>
}

const currentUserId = computed(() => auth.appUser?.id ?? 'anonymous')
const reactions = useBirthdayReactions(currentUserId.value)

function initials(name: string) {
  return name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
}

/** Stable key per person; falls back to a slug of their name. */
function keyFor(b: { name: string }) {
  return b.name.toLowerCase().replace(/\s+/g, '-')
}
</script>

<template>
  <section id="people" class="reveal" style="margin-top: 48px; animation-delay: 200ms">
    <Eyebrow class="mb-4">People</Eyebrow>
    <div class="people-row">
      <!-- Spotlight (or empty state) -->
      <AppCard class="spotlight">
        <div class="spotlight__art">
          <Award :size="56" class="spotlight__art-icon" />
          <AppChip class="spotlight__chip">
            <Star :size="9" /> Spotlight
          </AppChip>
        </div>
        <div class="spotlight__body">
          <template v-if="people.spotlight">
            <div class="spotlight__role">
              {{ people.spotlight.role }} · {{ people.spotlight.tenure }}
            </div>
            <h3 class="spotlight__name display">{{ people.spotlight.name }}</h3>
            <p class="spotlight__blurb">"{{ people.spotlight.blurb }}"</p>
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
            >
              + Choose a spotlight
            </button>
          </template>
        </div>
      </AppCard>

      <!-- Birthdays -->
      <AppCard class="birthdays">
        <div class="flex items-center gap-2 mb-3">
          <Cake :size="13" :stroke-width="1.85" style="color: var(--color-accent-700)" />
          <Eyebrow>Birthdays today</Eyebrow>
        </div>

        <div v-if="people.birthdays.length === 0" class="birthdays__empty">
          <Users :size="18" :stroke-width="1.5" class="birthdays__empty-icon" />
          <div class="birthdays__empty-title">No birthdays today</div>
          <p class="birthdays__empty-sub">We'll celebrate again tomorrow.</p>
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="b in people.birthdays"
            :key="b.name"
            class="birthdays__row"
          >
            <div class="birthdays__avatar display">{{ initials(b.name) }}</div>
            <div class="flex-1 min-w-0">
              <div class="display text-[16px]" style="color: var(--color-ink)">{{ b.name }}</div>
              <div class="font-mono text-[10.5px]" style="color: var(--color-muted)">
                {{ b.role }} · {{ b.shift }} Shift
              </div>
            </div>
            <button
              type="button"
              class="birthdays__heart"
              :class="{ 'birthdays__heart--reacted': reactions.hasReacted(isoDate, keyFor(b)) }"
              :aria-pressed="reactions.hasReacted(isoDate, keyFor(b))"
              :aria-label="
                reactions.hasReacted(isoDate, keyFor(b))
                  ? `You wished ${b.name.split(' ')[0]} happy birthday — tap to undo`
                  : `Send happy birthday to ${b.name.split(' ')[0]}`
              "
              @click="reactions.toggle(isoDate, keyFor(b))"
            >
              <Heart
                :size="14"
                :fill="reactions.hasReacted(isoDate, keyFor(b)) ? 'currentColor' : 'none'"
              />
              <span
                v-if="reactions.getCount(isoDate, keyFor(b)) > 0"
                class="birthdays__heart-count"
              >
                {{ reactions.getCount(isoDate, keyFor(b)) }}
              </span>
            </button>
          </div>
        </div>
      </AppCard>
    </div>
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
  height: 168px;
  background: linear-gradient(
    135deg,
    var(--color-accent-500) 0%,
    var(--color-accent-700) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
@media (min-width: 768px) {
  .spotlight__art {
    width: 42%;
    height: auto;
  }
}
.spotlight__art-icon {
  color: var(--color-brand-900);
  opacity: 0.25;
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

.birthdays__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: oklch(0.97 0.04 86.8);
}
.birthdays__avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}
.birthdays__heart {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  padding: 5px 8px 5px 7px;
  border-radius: 999px;
  color: var(--color-accent-700);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  transition:
    background 140ms var(--ease-out),
    border-color 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}
.birthdays__heart:hover {
  background: oklch(1 0 0 / 0.6);
  border-color: oklch(0.85 0.07 86.8);
}
.birthdays__heart:active {
  transform: scale(0.94);
}
.birthdays__heart--reacted {
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border-color: oklch(0.85 0.07 20);
}
.birthdays__heart--reacted:hover {
  background: oklch(0.94 0.06 20);
  border-color: oklch(0.78 0.1 20);
}
.birthdays__heart-count {
  letter-spacing: 0.02em;
  min-width: 0.7em;
  text-align: center;
}
</style>
