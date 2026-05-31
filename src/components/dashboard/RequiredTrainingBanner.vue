<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { ShieldCheck, ChevronRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useRequiredTraining } from '@/composables/useRequiredTraining'

/**
 * Surfaces a banner on the dashboard whenever the signed-in user has
 * one or more required-training modules outstanding. Tap the banner
 * to jump to /training/required. Self-gates so it never shows when
 * the user's caught up.
 */

const auth = useAuthStore()
const { ready, outstandingCount } = useRequiredTraining()

const visible = computed(
  () =>
    auth.appUser !== null &&
    !auth.usingDevStub &&
    ready.value &&
    outstandingCount.value > 0,
)
</script>

<template>
  <RouterLink v-if="visible" to="/training/required" class="rtb">
    <div class="rtb__icon">
      <ShieldCheck :size="20" :stroke-width="1.85" />
    </div>
    <div class="rtb__copy">
      <strong class="rtb__title">Required training awaiting completion</strong>
      <span class="rtb__sub">
        You have {{ outstandingCount }} module{{ outstandingCount === 1 ? '' : 's' }} to watch
        and sign off on. Tap to start.
      </span>
    </div>
    <ChevronRight :size="18" :stroke-width="1.85" class="rtb__chev" />
  </RouterLink>
</template>

<style scoped>
.rtb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: oklch(0.97 0.05 80);
  border: 1px solid oklch(0.88 0.09 80);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms var(--ease-out);
}
.rtb:hover {
  border-color: oklch(0.78 0.13 75);
}
.rtb__icon {
  color: oklch(0.55 0.16 75);
  flex-shrink: 0;
}
.rtb__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.rtb__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.rtb__sub {
  font-size: 12px;
  color: var(--color-ink-soft);
  line-height: 1.4;
}
.rtb__chev {
  color: oklch(0.55 0.16 75);
  flex-shrink: 0;
}
</style>
