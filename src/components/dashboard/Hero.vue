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
      <div class="hero__pill">
        <ShiftPill />
      </div>
    </div>

    <!-- Vertical gold accent line — same gradient treatment Justin uses
         in the supply portal's DashboardView header divider. -->
    <span class="hero__divider" aria-hidden="true" />

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

/* Vertical gold gradient line, ported from supply portal DashboardView */
.hero__divider {
  display: none;
  flex-shrink: 0;
  width: 1px;
  align-self: stretch;
  min-height: 92px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    oklch(0.734 0.114 86.8 / 0.45) 30%,
    oklch(0.734 0.114 86.8 / 0.45) 70%,
    transparent 100%
  );
}
@media (min-width: 1024px) {
  .hero__divider {
    display: block;
  }
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
