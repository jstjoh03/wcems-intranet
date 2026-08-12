<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { useQuickLinks } from '@/composables/useQuickLinks'

/**
 * MIH patient referral — the Community Paramedic program's Jotform
 * embedded inside the portal so crews can submit a referral without
 * leaving the app (hospital-bay, phone-in-hand friendly).
 *
 * The form URL is resolved from the admin-curated quick_links catalog
 * (label "Patient Referral Form") so a form swap never needs a deploy;
 * the constant below is only a fallback.
 */
const FALLBACK_URL = 'https://form.jotform.com/260535468117055'

const { links } = useQuickLinks()
const formUrl = computed(
  () => links.value.find((l) => l.label === 'Patient Referral Form')?.url ?? FALLBACK_URL,
)
</script>

<template>
  <div class="mih">
    <header class="mih__hero">
      <div class="mih__hero-wrap">
        <div class="mih__eyebrow">Mobile Integrated Healthcare</div>
        <h1 class="mih__title display">Patient Referral</h1>
        <p class="mih__sub">
          See a patient who could use the Community Paramedic program?
          Frequent 911 utilizers, fall risks, medication or resource needs —
          submit the referral below and the MIH team takes it from there.
        </p>
      </div>
      <div class="mih__goldseam" aria-hidden="true"></div>
    </header>

    <div class="mih__body">
      <div class="mih__frame-card">
        <iframe
          :src="formUrl"
          class="mih__frame"
          title="MIH patient referral form"
          allow="geolocation"
        ></iframe>
      </div>
      <a class="mih__fallback" :href="formUrl" target="_blank" rel="noopener">
        Form not loading? Open it in a new tab
        <ExternalLink :size="12" :stroke-width="2" />
      </a>
    </div>
  </div>
</template>

<style scoped>
.mih__hero {
  background:
    radial-gradient(ellipse 90% 70% at 15% 0%, oklch(0.4 0.13 250 / 0.55), transparent 60%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
}
.mih__hero-wrap {
  max-width: 1400px;
  margin: 0 auto;
  padding: 34px 16px 28px;
}
@media (min-width: 768px) {
  .mih__hero-wrap {
    padding: 40px 40px 34px;
  }
}
.mih__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
  opacity: 0.88;
}
.mih__title {
  margin-top: 8px;
  font-size: 34px;
  line-height: 1.05;
  color: white;
}
@media (min-width: 768px) {
  .mih__title {
    font-size: 42px;
  }
}
.mih__sub {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.6;
  max-width: 640px;
  color: oklch(0.8 0.03 250);
}
.mih__goldseam {
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

.mih__body {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .mih__body {
    padding: 32px 40px 56px;
  }
}
.mih__frame-card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.mih__frame {
  display: block;
  width: 100%;
  height: min(1400px, calc(100dvh - 220px));
  min-height: 640px;
  border: 0;
}
.mih__fallback {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.mih__fallback:hover {
  text-decoration: underline;
}
</style>
