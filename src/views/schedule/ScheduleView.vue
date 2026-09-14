<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchedule, todayCentralIso, addDaysIso } from '@/composables/useSchedule'
import { useScheduleEditor } from '@/composables/useScheduleEditor'
import ScheduleMonthBoard from './ScheduleMonthBoard.vue'
import ScheduleDayBoard from './ScheduleDayBoard.vue'
import ScheduleWeekBoard from './ScheduleWeekBoard.vue'
import SchedulePeriodBoard from './SchedulePeriodBoard.vue'
import ScheduleRequestsPanel from './ScheduleRequestsPanel.vue'
import ScheduleTradesPanel from './ScheduleTradesPanel.vue'
import ScheduleMembersPanel from './ScheduleMembersPanel.vue'
import ScheduleSetupPanel from './ScheduleSetupPanel.vue'
import ScheduleEditModals from './ScheduleEditModals.vue'

/**
 * Scheduling module shell — soft-launch build (URL-only, no nav entry).
 * Access is limited to Global admins / Schedulers while the module is
 * built out against Aladtec; the gate widens for the parallel run.
 */

const route = useRoute()
const router = useRouter()
const sched = useSchedule()
const editor = useScheduleEditor()

type Tab = 'month' | 'day' | 'week' | 'period' | 'requests' | 'trades' | 'members' | 'setup'
const tab = ref<Tab>('month')
const dateIso = ref(todayCentralIso())

/* Members and Setup are editor tools — non-editors (supervisors during
   the soft launch, crew after) get the calendar + request tabs only. */
const TABS = computed<{ key: Tab; label: string }[]>(() => {
  const t: { key: Tab; label: string }[] = [
    { key: 'month', label: 'Month' },
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'period', label: 'Pay period' },
    { key: 'requests', label: 'Requests' },
    { key: 'trades', label: 'Trades' },
  ]
  if (sched.canEdit.value) {
    t.push({ key: 'members', label: 'Members' }, { key: 'setup', label: 'Setup' })
  }
  return t
})

const showsDateNav = computed(() => tab.value === 'month' || tab.value === 'day' || tab.value === 'week')

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

const weekLabel = computed(() => {
  const d = new Date(`${dateIso.value}T00:00:00`)
  const start = addDaysIso(dateIso.value, -d.getDay())
  const end = addDaysIso(start, 6)
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Week of ${fmt(start)} – ${fmt(end)}`
})

const periodTitle = computed(() =>
  tab.value === 'month' ? monthLabel.value : tab.value === 'week' ? weekLabel.value : dayLabel.value,
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

async function onPeriodRange(start: string, end: string) {
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

watch(tab, (t, prev) => {
  // a modal opened from the previous view shouldn't survive the switch
  editor.closeAll()
  // returning from the pay-period board, restore the month-window load
  if (prev === 'period' && (t === 'month' || t === 'day' || t === 'week')) {
    void loadVisibleRange()
  }
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
            v-for="t in TABS"
            :key="t.key"
            class="sched__tab"
            :class="{ 'sched__tab--on': tab === t.key }"
            role="tab"
            :aria-selected="tab === t.key"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
      </header>

      <div v-if="showsDateNav" class="sched__nav">
        <div class="sched__nav-arrows">
          <button
            class="sched__nav-btn"
            aria-label="Previous"
            @click="tab === 'month' ? shiftMonth(-1) : tab === 'week' ? shiftDay(-7) : shiftDay(-1)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button class="sched__nav-btn sched__nav-btn--today" @click="goToday">Today</button>
          <button
            class="sched__nav-btn"
            aria-label="Next"
            @click="tab === 'month' ? shiftMonth(1) : tab === 'week' ? shiftDay(7) : shiftDay(1)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <h2 class="sched__period">{{ periodTitle }}</h2>
        <label class="sched__jump">
          <span class="sr-only">Jump to date</span>
          <input v-model="dateIso" type="date" class="sched__jump-input" />
        </label>
      </div>

      <p v-if="sched.loadError.value" class="sched__error">{{ sched.loadError.value }}</p>

      <ScheduleMonthBoard v-if="tab === 'month'" :month="monthAnchor" @open-day="openDay" />
      <ScheduleDayBoard v-else-if="tab === 'day'" :date-iso="dateIso" />
      <ScheduleWeekBoard v-else-if="tab === 'week'" :date-iso="dateIso" @open-day="openDay" />
      <SchedulePeriodBoard
        v-else-if="tab === 'period'"
        @open-day="openDay"
        @range="onPeriodRange"
      />
      <ScheduleRequestsPanel v-else-if="tab === 'requests'" />
      <ScheduleTradesPanel v-else-if="tab === 'trades'" />
      <ScheduleMembersPanel v-else-if="tab === 'members'" />
      <ScheduleSetupPanel v-else />

      <!-- shared modals: pickups, day editor, students, events, adds -->
      <ScheduleEditModals />
    </template>
  </div>
</template>

<style scoped>
.sched {
  /* Wide like the mockup — the month/week grids need the room. */
  max-width: 1720px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 3rem;
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
