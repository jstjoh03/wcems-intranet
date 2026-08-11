<script setup lang="ts">
import { computed } from 'vue'
import { Cake } from 'lucide-vue-next'
import { useGreeting } from '@/composables/useGreeting'
import { useShift } from '@/composables/useShift'
import { useTraining } from '@/composables/useTraining'
import { useAuthStore } from '@/stores/auth'

/**
 * Navy hero band (approved portal mockup v2): serif greeting over the
 * lit-surface navy gradient, with the duty line — on-duty shift, shift
 * day, next shift up, and upcoming-class count — replacing the old
 * on-canvas greeting + shift pill.
 */
const auth = useAuthStore()
const { greeting, todayStr, isoDate } = useGreeting()
const { current } = useShift()
const { events, ready: trainingReady } = useTraining()

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

const subline = computed(
  () => `${current.value.shift}-Shift holds the county today — day ${current.value.day} of the rotation.`,
)

const upcomingCount = computed(() => events.value.length)
</script>

<template>
  <header class="hero reveal">
    <div class="hero__wrap">
      <div class="hero__main">
        <div class="hero__eyebrow">{{ todayStr }} · Hempstead, TX</div>
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
        <p class="hero__sub">{{ subline }}</p>

        <div class="hero__dutyline">
          <div class="hero__duty-item">
            <b>{{ current.shift }}</b>
            <span class="hero__duty-lbl">On duty</span>
          </div>
          <template v-if="trainingReady && upcomingCount > 0">
            <div class="hero__duty-sep" aria-hidden="true"></div>
            <RouterLink to="/training" class="hero__duty-item hero__duty-link">
              <b class="hero__duty-gold">{{ upcomingCount }}</b>
              <span class="hero__duty-lbl">Upcoming {{ upcomingCount === 1 ? 'class' : 'classes' }} <span class="hero__duty-arrow">→</span></span>
            </RouterLink>
          </template>
        </div>
      </div>

      <div class="hero__patch patch-in" aria-hidden="true">
        <span class="hero__patch-halo" />
        <img src="/wcems-patch.png" alt="WCEMS patch" width="150" height="150" />
      </div>
    </div>
    <div class="hero__goldseam" aria-hidden="true"></div>
  </header>
</template>

<style scoped>
/* Full-bleed navy band with the "lit surface" treatment: three soft
   radial highlights over a 135° brand gradient. */
.hero {
  background:
    radial-gradient(ellipse 90% 70% at 15% 0%, oklch(0.4 0.13 250 / 0.55), transparent 60%),
    radial-gradient(ellipse 70% 60% at 85% 100%, oklch(0.32 0.12 250 / 0.5), transparent 60%),
    radial-gradient(ellipse 50% 45% at 70% 20%, oklch(0.45 0.12 250 / 0.28), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
}
.hero__wrap {
  max-width: 1400px;
  margin: 0 auto;
  padding: 40px 16px 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  min-width: 0;
}
@media (min-width: 768px) {
  .hero__wrap {
    padding: 52px 40px 44px;
  }
}

.hero__main {
  flex: 1;
  min-width: 0;
}
.hero__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
  opacity: 0.88;
}
.hero__title {
  font-size: 38px;
  letter-spacing: -0.01em;
  line-height: 1.05;
  color: white;
  margin-top: 10px;
}
@media (min-width: 768px) {
  .hero__title {
    font-size: 50px;
  }
}
.hero__name {
  color: var(--color-accent-on-dark);
}
.hero__sub {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.55;
  color: oklch(0.8 0.03 250);
  max-width: 560px;
}

/* ── duty line ──────────────────────────────────────────────────── */
.hero__dutyline {
  margin-top: 26px;
  display: flex;
  align-items: center;
  gap: 26px;
  flex-wrap: wrap;
  row-gap: 18px;
}
.hero__duty-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hero__duty-item b {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 32px;
  line-height: 1;
  color: white;
}
.hero__duty-link {
  text-decoration: none;
  border-radius: 8px;
  margin: -6px -10px;
  padding: 6px 10px;
  transition: background 140ms var(--ease-out);
}
.hero__duty-link:hover {
  background: oklch(1 0 0 / 0.07);
}
.hero__duty-arrow {
  opacity: 0;
  transition: opacity 140ms var(--ease-out);
}
.hero__duty-link:hover .hero__duty-arrow {
  opacity: 1;
}
.hero__duty-gold {
  color: var(--color-accent-on-dark) !important;
}
.hero__duty-lbl {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: oklch(0.66 0.035 250);
}
.hero__duty-sep {
  width: 1px;
  align-self: stretch;
  background: linear-gradient(
    to bottom,
    transparent,
    oklch(0.734 0.114 86.8 / 0.4) 30%,
    oklch(0.734 0.114 86.8 / 0.4) 70%,
    transparent
  );
}

/* ── birthday flourish ─────────────────────────────────────────── */
.hero__cake {
  display: inline-block;
  vertical-align: -0.18em;
  margin-left: 0.18em;
  color: var(--color-accent-on-dark);
  filter: drop-shadow(0 0 6px oklch(0.734 0.114 86.8 / 0.35));
  animation: cake-pulse 3.4s var(--ease-in-out) infinite;
}
@keyframes cake-pulse {
  0%, 100% { transform: rotate(0deg) scale(1); }
  40% { transform: rotate(-4deg) scale(1.04); }
  60% { transform: rotate(4deg) scale(1.04); }
}

/* ── patch ─────────────────────────────────────────────────────── */
.hero__patch {
  position: relative;
  flex-shrink: 0;
  width: 150px;
  height: 150px;
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
  filter:
    drop-shadow(0 1px 1px oklch(0.1 0.03 250 / 0.5))
    drop-shadow(0 8px 20px oklch(0.08 0.03 250 / 0.45));
  transition: transform 400ms var(--ease-out);
}
.hero__patch:hover img {
  transform: translateY(-2px);
}
.hero__patch-halo {
  position: absolute;
  inset: -24px;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    oklch(0.734 0.114 86.8 / 0.22) 0%,
    oklch(0.734 0.114 86.8 / 0.07) 40%,
    transparent 68%
  );
  z-index: 0;
  pointer-events: none;
}

/* feathered gold seam along the band's bottom edge */
.hero__goldseam {
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(200, 164, 77, 0.55) 18%,
    #e8cb72 50%,
    rgba(200, 164, 77, 0.55) 82%,
    transparent
  );
}
</style>
