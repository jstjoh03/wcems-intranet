<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { CheckCircle2, HeartHandshake } from 'lucide-vue-next'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { usePolicies } from '@/composables/usePolicies'

/**
 * Mobile-only compact strips (the rail cards are desktop-only): the
 * MIH referral entry point and a slim compliance readout, up top where
 * a phone user actually sees them instead of three screens down.
 *
 * When compliance items ARE outstanding the required-training/policy
 * banners already occupy the top of the page with resolve CTAs, so
 * the compliance strip only renders its quiet all-clear state — no
 * triple-stacked nagging.
 */

const { ready: rtReady, outstandingCount: rtOutstanding } = useRequiredTraining()
const { ready: polReady, outstandingCount: polOutstanding } = usePolicies()

const ready = computed(() => rtReady.value && polReady.value)
const allClear = computed(() => rtOutstanding.value + polOutstanding.value === 0)
</script>

<template>
  <div class="mqs">
    <RouterLink to="/mih-referral" class="mqs__strip mqs__strip--mih">
      <HeartHandshake :size="17" :stroke-width="1.9" class="mqs__icon" />
      <span class="mqs__label">Refer a patient to MIH</span>
      <span class="mqs__arrow">→</span>
    </RouterLink>

    <div v-if="ready && allClear" class="mqs__strip mqs__strip--clear">
      <CheckCircle2 :size="17" :stroke-width="1.9" class="mqs__icon" />
      <span class="mqs__label">Compliance — all caught up</span>
    </div>
  </div>
</template>

<style scoped>
.mqs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mqs__strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.mqs__strip--mih {
  background:
    radial-gradient(ellipse 90% 90% at 15% 0%, oklch(0.4 0.13 250 / 0.5), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border: 1px solid var(--color-brand-800);
  color: white;
  box-shadow: var(--shadow-sm);
}
.mqs__strip--mih .mqs__icon {
  color: var(--color-accent-on-dark);
}
.mqs__strip--clear {
  background: var(--color-success-50);
  border: 1px solid oklch(0.85 0.07 155);
  color: var(--color-success-500);
}
.mqs__icon {
  flex-shrink: 0;
}
.mqs__label {
  flex: 1;
  min-width: 0;
}
.mqs__arrow {
  color: var(--color-accent-on-dark);
}
</style>
