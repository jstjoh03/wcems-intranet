<script setup lang="ts">
import { computed } from 'vue'
import { Cake } from 'lucide-vue-next'
import { useGreeting } from '@/composables/useGreeting'
import { useAuthStore } from '@/stores/auth'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import ShiftPill from '@/components/primitives/ShiftPill.vue'

const auth = useAuthStore()
const { greeting, todayStr, isoDate } = useGreeting()

/**
 * True when today's MM-DD (in Central Time) matches the user's DOB MM-DD.
 * Note: Feb-29 birthdays only fire on actual leap years — acceptable v1.
 */
const isBirthday = computed(() => {
  const dob = auth.appUser?.dateOfBirth
  if (!dob) return false
  const [, dobMonth, dobDay] = dob.split('-')
  const [, todayMonth, todayDay] = isoDate.value.split('-')
  return dobMonth === todayMonth && dobDay === todayDay
})

const greetingText = computed(() =>
  isBirthday.value ? 'Happy birthday' : greeting.value,
)
</script>

<template>
  <header class="hero reveal">
    <div class="hero__main">
      <Eyebrow>{{ todayStr }}</Eyebrow>
      <h1 class="hero__title display" :class="{ 'hero__title--birthday': isBirthday }">
        {{ greetingText }}<template v-if="auth.appUser?.firstName">,
          <em class="hero__name italic">{{ auth.appUser.firstName }}</em></template>{{ isBirthday ? '!' : '.' }}
        <Cake
          v-if="isBirthday"
          :size="32"
          :stroke-width="1.5"
          class="hero__cake"
          aria-hidden="true"
        />
      </h1>
      <div class="hero__pill">
        <ShiftPill />
      </div>
    </div>

    <div class="hero__patch patch-in" aria-hidden="true">
      <span class="hero__patch-halo" />
      <img src="/wcems-patch.png" alt="WCEMS patch" width="140" height="140" />
    </div>
  </header>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 32px;
  min-width: 0;
}
.hero__main {
  flex: 1;
  min-width: 0;
}
.hero__title {
  font-size: 40px;
  letter-spacing: -0.01em;
  line-height: 1.05;
  color: var(--color-ink);
  margin-top: 8px;
}
@media (min-width: 768px) {
  .hero__title {
    font-size: 52px;
  }
}
.hero__name {
  color: var(--color-brand-600);
}
.hero__pill {
  margin-top: 18px;
}

/* ── Birthday flourish ───────────────────────────────────────────────
   Inline cake icon next to the greeting when it's the user's birthday.
   Restrained — gentle gold + soft pulse — not a confetti party. */
.hero__cake {
  display: inline-block;
  vertical-align: -0.18em;
  margin-left: 0.18em;
  color: var(--color-accent-600);
  filter: drop-shadow(0 0 6px oklch(0.734 0.114 86.8 / 0.35));
  animation: cake-pulse 3.4s var(--ease-in-out) infinite;
}
@keyframes cake-pulse {
  0%, 100% { transform: rotate(0deg) scale(1); }
  40% { transform: rotate(-4deg) scale(1.04); }
  60% { transform: rotate(4deg) scale(1.04); }
}
.hero__title--birthday .hero__name {
  color: var(--color-accent-700);
}

.hero__patch {
  position: relative;
  display: none;
  flex-shrink: 0;
  width: 140px;
  height: 140px;
  display: none;
}
@media (min-width: 1024px) {
  .hero__patch {
    display: block;
  }
}
.hero__patch img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: contain;
  z-index: 1;
  /* Stacked drop-shadows: tight contact + soft elevation */
  filter:
    drop-shadow(0 1px 1px oklch(0.18 0.015 260 / 0.18))
    drop-shadow(0 4px 8px oklch(0.18 0.015 260 / 0.12))
    drop-shadow(0 12px 24px oklch(0.18 0.015 260 / 0.08));
  transition: transform 400ms var(--ease-out);
}
.hero__patch:hover img {
  transform: translateY(-2px);
}

/* Subtle radial gold halo behind the patch — gives the shield depth and
   echoes the gold accent line without colored fill on the surface */
.hero__patch-halo {
  position: absolute;
  inset: -22px;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    oklch(0.734 0.114 86.8 / 0.18) 0%,
    oklch(0.734 0.114 86.8 / 0.06) 38%,
    transparent 68%
  );
  z-index: 0;
  pointer-events: none;
}
</style>
