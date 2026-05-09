<script setup lang="ts">
import { computed } from 'vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { Phone, AlertCircle } from 'lucide-vue-next'
import { useGreeting } from '@/composables/useGreeting'
import { useShift } from '@/composables/useShift'
import { useAuthStore } from '@/stores/auth'
import onCallData from '@/data/on-call.json'

const auth = useAuthStore()
const { todayHoliday } = useGreeting()
const { current } = useShift(auth.appUser?.shift ?? null)

const onCall = onCallData

// Crude "shift remaining" — assumes shift change at 06:00 Central. Day 1 ends
// at 06:00 the next day; Day 2 ends at 06:00 the day after that. This is a
// rough hour-level read; we'll refine when we wire individual shift schedules.
const shiftWindow = computed(() => {
  return { start: '06:00', end: '06:00 (next day)' }
})

const hoursRemaining = computed(() => {
  const now = new Date()
  const centralHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'America/Chicago',
    }).format(now),
    10,
  )
  const centralMin = parseInt(
    new Intl.DateTimeFormat('en-US', {
      minute: '2-digit',
      timeZone: 'America/Chicago',
    }).format(now),
    10,
  )
  // Reference 06:00 today. If past 06:00, the next 06:00 is tomorrow at 06:00.
  // Day 1 spans 24h, Day 2 spans the next 24h to wrap-up.
  const minutesIntoCurrentDay = centralHour * 60 + centralMin - 6 * 60
  let totalMinsLeft: number
  if (current.value.day === 1) {
    totalMinsLeft = 24 * 60 - (minutesIntoCurrentDay >= 0 ? minutesIntoCurrentDay : minutesIntoCurrentDay + 1440)
    totalMinsLeft += 24 * 60
  } else {
    totalMinsLeft = 24 * 60 - (minutesIntoCurrentDay >= 0 ? minutesIntoCurrentDay : minutesIntoCurrentDay + 1440)
  }
  totalMinsLeft = Math.max(0, totalMinsLeft)
  const h = Math.floor(totalMinsLeft / 60)
  const m = totalMinsLeft % 60
  return { h, m, label: `${h}h ${m.toString().padStart(2, '0')}m` }
})

const progressPct = computed(() => {
  const totalMins = 48 * 60
  const remaining = hoursRemaining.value.h * 60 + hoursRemaining.value.m
  return Math.min(100, Math.max(0, ((totalMins - remaining) / totalMins) * 100))
})
</script>

<template>
  <section id="operations" class="reveal" style="animation-delay: 60ms; margin-bottom: 40px">
    <AppCard class="overflow-hidden">
      <div class="op-strip">
        <div class="op-strip__on-call">
          <div class="flex items-center gap-2 mb-3">
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
        </div>

        <div class="op-strip__shift">
          <div class="flex items-center justify-between mb-2">
            <Eyebrow>Your Shift</Eyebrow>
            <span class="font-mono text-[11px]" style="color: var(--color-muted)">
              {{ shiftWindow.start }} → {{ shiftWindow.end }}
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span class="op-strip__remaining display">{{ hoursRemaining.label }}</span>
            <span class="text-[12px] font-medium" style="color: var(--color-muted)">remaining</span>
          </div>
          <div class="op-strip__progress">
            <div class="op-strip__progress-bar" :style="{ width: `${progressPct}%` }" />
          </div>
        </div>
      </div>
    </AppCard>
  </section>
</template>

<style scoped>
.op-strip {
  display: grid;
  grid-template-columns: 1fr;
}
@media (min-width: 768px) {
  .op-strip {
    grid-template-columns: 1.6fr 1fr;
  }
}

.op-strip__on-call {
  padding: 20px;
}
.op-strip__on-call-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
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
  font-size: 16px;
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

.op-strip__shift {
  padding: 20px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-line);
}
@media (min-width: 768px) {
  .op-strip__shift {
    border-top: none;
    border-left: 1px solid var(--color-line);
  }
}
.op-strip__remaining {
  font-size: 36px;
  letter-spacing: -0.02em;
  color: var(--color-brand-600);
}
.op-strip__progress {
  margin-top: 12px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-line);
  overflow: hidden;
}
.op-strip__progress-bar {
  height: 100%;
  background: var(--color-success-500);
  transition: width 600ms var(--ease-out);
}
</style>
