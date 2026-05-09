<script setup lang="ts">
import { Phone, Mail, Building2 } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import staff from '@/data/admin-staff.json'
</script>

<template>
  <div class="admin-staff">
    <header class="admin-staff__header">
      <div class="flex items-center gap-2">
        <Building2 :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display admin-staff__title">Admin Staff</h1>
      </div>
      <p class="admin-staff__sub">
        Direct contact information for WCEMS administrative staff.
      </p>
    </header>

    <div class="admin-staff__list">
      <AppCard v-for="s in staff" :key="s.title + s.name" class="admin-staff__card">
        <Eyebrow>{{ s.title }}</Eyebrow>
        <h3 class="admin-staff__name display">{{ s.name }}</h3>
        <div class="admin-staff__contact">
          <a v-if="s.phone" :href="`tel:${s.phone.replace(/[^\d+]/g, '')}`" class="admin-staff__link">
            <Phone :size="13" :stroke-width="1.85" />
            <span class="font-mono">{{ s.phone }}</span>
          </a>
          <a v-if="s.email" :href="`mailto:${s.email}`" class="admin-staff__link">
            <Mail :size="13" :stroke-width="1.85" />
            <span>{{ s.email }}</span>
          </a>
        </div>
        <p v-if="s.notes" class="admin-staff__notes">{{ s.notes }}</p>
      </AppCard>
    </div>
  </div>
</template>

<style scoped>
.admin-staff {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .admin-staff {
    padding: 40px 40px 64px;
  }
}
.admin-staff__title {
  font-size: 32px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .admin-staff__title {
    font-size: 40px;
  }
}
.admin-staff__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}

.admin-staff__list {
  margin-top: 24px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) {
  .admin-staff__list {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 1024px) {
  .admin-staff__list {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

.admin-staff__card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.admin-staff__name {
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin-top: 2px;
}
.admin-staff__contact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.admin-staff__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-brand-600);
  text-decoration: none;
  word-break: break-all;
}
.admin-staff__link:hover {
  text-decoration: underline;
}
.admin-staff__notes {
  margin-top: 6px;
  font-size: 12px;
  font-style: italic;
  color: var(--color-muted);
  border-left: 2px solid var(--color-line);
  padding-left: 10px;
}
</style>
