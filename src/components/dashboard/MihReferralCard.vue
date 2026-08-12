<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { HeartHandshake } from 'lucide-vue-next'

/**
 * Standing MIH referral tile in the dashboard rail — navy so it pops
 * against the cream cards around it. One tap into the embedded
 * referral form; the goal is crews thinking of MIH at the moment they
 * see a candidate patient.
 */
</script>

<template>
  <RouterLink to="/mih-referral" class="mihc">
    <div class="mihc__icon">
      <HeartHandshake :size="19" :stroke-width="1.8" />
    </div>
    <div>
      <div class="mihc__eyebrow">Mobile Integrated Healthcare</div>
      <div class="mihc__title">Refer a patient to MIH</div>
      <p class="mihc__sub">
        Frequent flyers, fall risks, medication or resource needs — send them
        to the Community Paramedic program.
      </p>
      <span class="mihc__cta">Start a referral →</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.mihc {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 20px 22px;
  border-radius: 14px;
  text-decoration: none;
  background:
    radial-gradient(ellipse 90% 80% at 20% 0%, oklch(0.4 0.13 250 / 0.5), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border: 1px solid var(--color-brand-800);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 160ms var(--ease-out), transform 160ms var(--ease-out);
}
.mihc:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.mihc__icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(1 0 0 / 0.08);
  color: var(--color-accent-on-dark);
  border: 1px solid oklch(0.734 0.114 86.8 / 0.3);
}
.mihc__eyebrow {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
  opacity: 0.85;
}
.mihc__title {
  margin-top: 4px;
  font-family: var(--font-display);
  font-size: 19px;
  line-height: 1.15;
  color: white;
}
.mihc__sub {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.55;
  color: oklch(0.78 0.03 250);
}
.mihc__cta {
  display: inline-block;
  margin-top: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-accent-on-dark);
}
</style>
