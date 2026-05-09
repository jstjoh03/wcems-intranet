<script setup lang="ts">
import { useGreeting } from '@/composables/useGreeting'
import { useAuthStore } from '@/stores/auth'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import ShiftPill from '@/components/primitives/ShiftPill.vue'

const auth = useAuthStore()
const { greeting, todayStr } = useGreeting()
</script>

<template>
  <header class="hero reveal">
    <div class="hero__main">
      <Eyebrow>{{ todayStr }}</Eyebrow>
      <h1 class="hero__title display">
        {{ greeting }}<template v-if="auth.appUser?.firstName">,
          <em class="hero__name italic">{{ auth.appUser.firstName }}</em></template>.
      </h1>
      <p class="hero__sub">
        Your hub for protocols, training, station info, and everything Waller County EMS.
      </p>
      <div class="hero__pill">
        <ShiftPill />
      </div>
    </div>

    <div class="hero__patch patch-in" aria-hidden="true">
      <img src="/wcems-patch.png" alt="WCEMS patch" width="104" height="104" />
    </div>
  </header>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 32px;
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
.hero__sub {
  margin-top: 12px;
  max-width: 36rem;
  color: var(--color-ink-soft);
  font-size: 14.5px;
  line-height: 1.55;
}
.hero__pill {
  margin-top: 18px;
}
.hero__patch {
  display: none;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 6px oklch(0.18 0.015 260 / 0.12))
    drop-shadow(0 6px 16px oklch(0.18 0.015 260 / 0.06));
}
@media (min-width: 1024px) {
  .hero__patch {
    display: block;
  }
}
.hero__patch img {
  width: 104px;
  height: 104px;
  object-fit: contain;
}
</style>
