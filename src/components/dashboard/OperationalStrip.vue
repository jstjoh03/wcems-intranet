<script setup lang="ts">
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { Phone, AlertCircle } from 'lucide-vue-next'
import { useGreeting } from '@/composables/useGreeting'
import onCallData from '@/data/on-call.json'

const { todayHoliday } = useGreeting()
const onCall = onCallData
</script>

<template>
  <section id="operations" class="reveal" style="animation-delay: 60ms; margin-bottom: 40px">
    <AppCard class="op-strip">
      <div class="op-strip__head">
        <Eyebrow>On Call</Eyebrow>
        <span
          v-if="todayHoliday"
          class="op-strip__holiday-chip"
          :title="`Admin office closed: ${todayHoliday.name}`"
        >
          <AlertCircle :size="11" :stroke-width="2" />
          Admin office closed · {{ todayHoliday.name }}
        </span>
      </div>

      <div class="op-strip__on-call-grid">
        <div v-for="p in onCall" :key="p.roleLabel" class="op-strip__on-call-cell">
          <div class="op-strip__on-call-label">{{ p.roleLabel }}</div>
          <a
            :href="`tel:${p.phone.replace(/[^\d+]/g, '')}`"
            class="op-strip__on-call-phone"
          >
            <Phone :size="13" :stroke-width="1.85" />
            <span class="font-mono">{{ p.phone }}</span>
          </a>
          <div v-if="p.meta" class="op-strip__on-call-meta">{{ p.meta }}</div>
        </div>
      </div>
    </AppCard>
  </section>
</template>

<style scoped>
.op-strip {
  padding: 18px 20px;
}

.op-strip__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.op-strip__on-call-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px 32px;
}
@media (min-width: 640px) {
  .op-strip__on-call-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.op-strip__on-call-cell {
  min-width: 0;
}
.op-strip__on-call-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.op-strip__on-call-phone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 17px;
  letter-spacing: -0.01em;
  color: var(--color-brand-600);
  font-weight: 500;
  text-decoration: none;
  font-family: var(--font-display);
}
.op-strip__on-call-phone:hover {
  text-decoration: underline;
}
.op-strip__on-call-meta {
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 2px;
}

.op-strip__holiday-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-warning-50);
  color: oklch(0.4 0.14 60);
  border: 1px solid oklch(0.88 0.1 60);
}
</style>
