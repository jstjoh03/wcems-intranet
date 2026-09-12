<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchedule, todayCentralIso, addDaysIso } from '@/composables/useSchedule'
import ScheduleMonthBoard from './ScheduleMonthBoard.vue'
import ScheduleDayBoard from './ScheduleDayBoard.vue'
import ScheduleSetupPanel from './ScheduleSetupPanel.vue'

/**
 * Scheduling module shell — soft-launch build (URL-only, no nav entry).
 * Access is limited to Global admins / Schedulers while the module is
 * built out against Aladtec; the gate widens for the parallel run.
 */

const route = useRoute()
const router = useRouter()
const sched = useSchedule()

type Tab = 'month' | 'day' | 'setup'
const tab = ref<Tab>('month')
const dateIso = ref(todayCentralIso())

const monthAnchor = computed(() => dateIso.value.slice(0, 7)) // YYYY-MM

const monthLabel = computed(() =>
  new Date(`${monthAnchor.value}-01T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  }),
)

const dayLabel = computed(() =>
  new Date(`${dateIso.value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }),
)

function shiftMonth(delta: number) {
  const d = new Date(`${monthAnchor.value}-01T00:00:00`)
  d.setMonth(d.getMonth() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  dateIso.value = `${y}-${m}-01`
}

function shiftDay(delta: number) {
  dateIso.value = addDaysIso(dateIso.value, delta)
}

function goToday() {
  dateIso.value = todayCentralIso()
}

function openDay(iso: string) {
  dateIso.value = iso
  tab.value = 'day'
}

/* Load entries for the visible month plus a week either side, so month
   cells at the grid edges still resolve. */
async function loadVisibleRange() {
  const start = addDaysIso(`${monthAnchor.value}-01`, -7)
  const firstNext = (() => {
    const d = new Date(`${monthAnchor.value}-01T00:00:00`)
    d.setMonth(d.getMonth() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })()
  const end = addDaysIso(firstNext, 7)
  await sched.loadRange(start, end)
}

onMounted(async () => {
  await sched.ensureLoaded()
  if (typeof route.query.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.d)) {
    dateIso.value = route.query.d
  }
  await loadVisibleRange()
})

watch(monthAnchor, () => {
  void loadVisibleRange()
})

watch(dateIso, (v) => {
  void router.replace({ query: { ...route.query, d: v } })
})
</script>

<template>
  <div class="sched">
    <template v-if="sched.loaded.value && !sched.canAccessModule.value">
      <div class="sched__locked">
        <p class="sched__locked-title">Scheduling isn't open yet</p>
        <p class="sched__locked-body">
          The scheduling module is being set up. It will be announced when it's ready for the
          whole crew.
        </p>
      </div>
    </template>

    <template v-else>
      <header class="sched__head">
        <div>
          <p class="sched__eyebrow">Operations</p>
          <h1 class="sched__title">Scheduling</h1>
        </div>
        <div class="sched__tabs" role="tablist">
          <button
            v-for="t in (['month', 'day', 'setup'] as const)"
            :key="t"
            class="sched__tab"
            :class="{ 'sched__tab--on': tab === t }"
            role="tab"
            :aria-selected="tab === t"
            @click="tab = t"
          >
            {{ t === 'month' ? 'Month' : t === 'day' ? 'Day' : 'Setup' }}
          </button>
        </div>
      </header>

      <div v-if="tab !== 'setup'" class="sched__nav">
        <div class="sched__nav-arrows">
          <button
            class="sched__nav-btn"
            :aria-label="tab === 'month' ? 'Previous month' : 'Previous day'"
            @click="tab === 'month' ? shiftMonth(-1) : shiftDay(-1)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button class="sched__nav-btn sched__nav-btn--today" @click="goToday">Today</button>
          <button
            class="sched__nav-btn"
            :aria-label="tab === 'month' ? 'Next month' : 'Next day'"
            @click="tab === 'month' ? shiftMonth(1) : shiftDay(1)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <h2 class="sched__period">{{ tab === 'month' ? monthLabel : dayLabel }}</h2>
        <label class="sched__jump">
          <span class="sr-only">Jump to date</span>
          <input v-model="dateIso" type="date" class="sched__jump-input" />
        </label>
      </div>

      <p v-if="sched.loadError.value" class="sched__error">{{ sched.loadError.value }}</p>

      <ScheduleMonthBoard v-if="tab === 'month'" :month="monthAnchor" @open-day="openDay" />
      <ScheduleDayBoard v-else-if="tab === 'day'" :date-iso="dateIso" />
      <ScheduleSetupPanel v-else />
    </template>
  </div>
</template>

<style scoped>
.sched {
  max-width: 1120px;
  margin: 0 auto;
  padding: 1.25rem 1rem 3rem;
}

.sched__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.sched__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.15rem;
}

.sched__title {
  font-family: var(--font-display);
  font-size: 2rem;
  line-height: 1.1;
  color: var(--color-brand-800);
  margin: 0;
}

.sched__tabs {
  display: inline-flex;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 3px;
  gap: 2px;
}

.sched__tab {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-muted);
  padding: 0.35rem 0.85rem;
  border-radius: 7px;
  cursor: pointer;
}

.sched__tab--on {
  background: var(--color-brand-700);
  color: white;
}

.sched__nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.sched__nav-arrows {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sched__nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 32px;
  padding: 0 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.sched__nav-btn svg {
  width: 15px;
  height: 15px;
}

.sched__nav-btn:hover {
  border-color: var(--color-brand-300);
}

.sched__period {
  font-family: var(--font-display);
  font-size: 1.3rem;
  color: var(--color-ink);
  margin: 0;
}

.sched__jump {
  margin-left: auto;
}

.sched__jump-input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.sched__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.sched__locked {
  max-width: 460px;
  margin: 4rem auto;
  text-align: center;
}

.sched__locked-title {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--color-brand-800);
  margin: 0 0 0.4rem;
}

.sched__locked-body {
  color: var(--color-muted);
  font-size: 0.92rem;
  margin: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
