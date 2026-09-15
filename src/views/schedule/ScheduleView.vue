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
import ScheduleMyPanel from './ScheduleMyPanel.vue'
import ScheduleTimePanel from './ScheduleTimePanel.vue'
import SchedulePagesPanel from './SchedulePagesPanel.vue'

/**
 * Scheduling module shell — soft-launch build (URL-only, no nav entry).
 * Access is limited to Global admins / Schedulers while the module is
 * built out against Aladtec; the gate widens for the parallel run.
 */

const route = useRoute()
const router = useRouter()
const sched = useSchedule()
const editor = useScheduleEditor()

type Tab =
  | 'month'
  | 'day'
  | 'week'
  | 'period'
  | 'mine'
  | 'requests'
  | 'trades'
  | 'pages'
  | 'time'
  | 'members'
  | 'setup'
const tab = ref<Tab>('month')
const dateIso = ref(todayCentralIso())

/* Members and Setup are editor tools — non-editors (supervisors during
   the soft launch, crew after) get the calendar + request tabs only.
   `group` starts a new visual cluster in the tab bar. */
const TABS = computed<{ key: Tab; label: string; group?: boolean }[]>(() => {
  const t: { key: Tab; label: string; group?: boolean }[] = [
    { key: 'month', label: 'Month' },
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'period', label: 'Pay period' },
    { key: 'mine', label: 'My schedule', group: true },
    { key: 'requests', label: 'Requests', group: true },
    { key: 'trades', label: 'Trades' },
  ]
  if (sched.canPageOut.value) {
    t.push({ key: 'pages', label: 'Page-outs' })
  }
  if (sched.canEdit.value) {
    t.push(
      { key: 'time', label: 'Payroll', group: true },
      { key: 'members', label: 'Members' },
      { key: 'setup', label: 'Setup' },
    )
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
  // Requests load with the shell (not just on the Requests tab) so
  // pending pickups/time-off show on the boards and the tab badge is
  // right from the first paint; realtime keeps both fresh after that.
  await Promise.all([loadVisibleRange(), sched.loadRequests()])
  sched.startRealtime()
  // Page-out deep link: /schedule?d=<date>&pickup=<entryId> opens the
  // pickup modal for that open entry straight from the email/push.
  const pk = route.query.pickup
  if (typeof pk === 'string' && pk) {
    void openPickupLink(pk)
    void router.replace({ query: { ...route.query, pickup: undefined } })
  }
})

/** Deep link from a page-out message: fetch the entry FRESH and open
 *  the same slot modal the boards use — or say it's gone. */
const linkMsg = ref<string | null>(null)
async function openPickupLink(entryId: string) {
  const info = await sched.fetchOpenEntryInfo(entryId)
  if (!info) {
    linkMsg.value =
      'That paged shift is no longer open — it may have just been filled. The current board is below.'
    return
  }
  dateIso.value = info.dateIso
  tab.value = 'day'
  editor.openSlotDirect({
    dateIso: info.dateIso,
    seatId: info.seatId,
    entryId,
    label: info.label,
    start: info.start,
    end: info.end,
  })
}

/** Undecided requests → red badge on the Requests tab (editors). */
const pendingCount = computed(() =>
  sched.canEdit.value
    ? sched.requests.value.filter(
        (r) => r.status === 'pending' || r.status === 'partner_accepted',
      ).length
    : 0,
)

watch(monthAnchor, () => {
  void loadVisibleRange()
})

watch(tab, (t, prev) => {
  // a modal opened from the previous view shouldn't survive the switch
  editor.closeAll()
  // returning from a tab that loads its own window (pay period, My
  // schedule), restore the month-window load
  if ((prev === 'period' || prev === 'mine') && (t === 'month' || t === 'day' || t === 'week')) {
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
          <template v-for="t in TABS" :key="t.key">
            <span v-if="t.group" class="sched__tabdiv" aria-hidden="true" />
            <button
              class="sched__tab"
              :class="{ 'sched__tab--on': tab === t.key }"
              role="tab"
              :aria-selected="tab === t.key"
              @click="tab = t.key"
            >
              {{ t.label
              }}<span v-if="t.key === 'requests' && pendingCount > 0" class="sched__tab-badge">{{
                pendingCount
              }}</span>
            </button>
          </template>
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
      <p v-if="linkMsg" class="sched__error">
        {{ linkMsg }}
        <button class="sched__linkdismiss" aria-label="Dismiss" @click="linkMsg = null">×</button>
      </p>

      <ScheduleMonthBoard v-if="tab === 'month'" :month="monthAnchor" @open-day="openDay" />
      <ScheduleDayBoard v-else-if="tab === 'day'" :date-iso="dateIso" />
      <ScheduleWeekBoard v-else-if="tab === 'week'" :date-iso="dateIso" @open-day="openDay" />
      <SchedulePeriodBoard
        v-else-if="tab === 'period'"
        @open-day="openDay"
        @range="onPeriodRange"
      />
      <ScheduleMyPanel v-else-if="tab === 'mine'" />
      <ScheduleRequestsPanel v-else-if="tab === 'requests'" />
      <ScheduleTradesPanel v-else-if="tab === 'trades'" />
      <SchedulePagesPanel v-else-if="tab === 'pages'" />
      <ScheduleTimePanel v-else-if="tab === 'time'" />
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

/* The module's main navigator — give it real presence: an elevated
   bar, grouped clusters, and a navy pill with a gold accent when
   active, instead of a flat strip that disappears into the page. */
.sched__tabs {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-line);
  border-bottom-color: oklch(0.82 0.02 260);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-surface-soft) 100%);
  box-shadow:
    0 1px 2px oklch(0.3 0.03 260 / 0.08),
    0 3px 10px oklch(0.3 0.03 260 / 0.09);
  padding: 4px;
  gap: 2px;
  flex-wrap: wrap;
}

.sched__tabdiv {
  width: 1px;
  align-self: stretch;
  margin: 5px 4px;
  background: var(--color-line);
}

.sched__tab {
  position: relative;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  padding: 0.45rem 0.95rem;
  border-radius: 9px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    box-shadow 0.12s ease;
}

.sched__tab:hover {
  background: oklch(0.94 0.015 260);
  color: var(--color-brand-700);
}

.sched__tab--on,
.sched__tab--on:hover {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  color: white;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.18),
    0 2px 6px oklch(0.3 0.06 260 / 0.35);
}

.sched__tab--on::after {
  content: '';
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: 3px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-accent-500, oklch(0.78 0.13 86.8));
  opacity: 0.9;
}

.sched__tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  margin-left: 6px;
  border-radius: 999px;
  background: var(--color-danger-500);
  color: white;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  vertical-align: 1px;
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

.sched__linkdismiss {
  font: inherit;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 0.3rem;
  font-weight: 700;
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
