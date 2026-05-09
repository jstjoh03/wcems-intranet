<script setup lang="ts">
import { ChevronRight, Image as ImageIcon, Edit2 } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <AppCard class="newsletter-card overflow-hidden">
    <div class="newsletter-card__hero">
      <ImageIcon :size="26" class="newsletter-card__icon" />
      <AppChip variant="accent" class="newsletter-card__chip">Featured</AppChip>
      <button
        v-if="auth.isAdmin"
        type="button"
        class="newsletter-card__edit"
        aria-label="Edit newsletter"
      >
        <Edit2 :size="12" />
      </button>
    </div>
    <div class="newsletter-card__body">
      <Eyebrow>Newsletter</Eyebrow>
      <h3 class="newsletter-card__title display">No newsletter yet</h3>
      <p class="newsletter-card__sub">
        When the team publishes the next monthly newsletter, it'll show up here.
      </p>
      <button class="newsletter-card__more" disabled>
        Read more <ChevronRight :size="13" />
      </button>
    </div>
  </AppCard>
</template>

<style scoped>
.newsletter-card__hero {
  position: relative;
  height: 144px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    var(--color-brand-600) 0%,
    var(--color-brand-800) 100%
  );
}
.newsletter-card__hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 75% 30%,
    oklch(0.55 0.12 250) 0%,
    transparent 60%
  );
  opacity: 0.6;
}
.newsletter-card__icon {
  position: relative;
  color: var(--color-accent-500);
  opacity: 0.6;
}
.newsletter-card__chip {
  position: absolute;
  top: 12px;
  left: 12px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  border-color: transparent;
  font-weight: 600;
}
.newsletter-card__edit {
  position: absolute;
  top: 12px;
  right: 12px;
  background: oklch(0 0 0 / 0.4);
  border: none;
  color: white;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms;
}
.newsletter-card:hover .newsletter-card__edit {
  opacity: 1;
}

.newsletter-card__body {
  padding: 20px;
}
.newsletter-card__title {
  font-size: 22px;
  margin-top: 6px;
  color: var(--color-ink);
}
.newsletter-card__sub {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.newsletter-card__more {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-600);
  background: transparent;
  border: none;
  cursor: pointer;
}
.newsletter-card__more:disabled {
  color: var(--color-muted);
  cursor: not-allowed;
}
</style>
