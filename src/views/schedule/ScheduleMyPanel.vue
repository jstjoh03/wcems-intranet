<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  addDaysIso,
  hhmm,
  type SchedRequest,
} from '@/composables/useSchedule'
import ScheduleMonthBoard from './ScheduleMonthBoard.vue'
import ScheduleDayBoard from './ScheduleDayBoard.vue'
import ScheduleWeekBoard from './ScheduleWeekBoard.vue'
import SchedulePeriodBoard from './SchedulePeriodBoard.vue'

/**
 * My schedule — the same calendar views as the main boards (month
 * default, plus day / week / pay period) filtered to the signed-in
 * member and open seats, with their own pending requests and a
 * shifts/hours summary on top. Clicking an open seat still opens the
 * pickup/assign modal.
 */

const sched = useSchedule()

type MyView = 'month' | 'day' | 'week' | 'period'
const view = ref<MyView>('month')
const dateIso = ref(todayCentralIso())

const VIEWS: { key: MyView; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'period', label: 'Pay period' },
]

const monthAnchor = computed(() => dateIso.value.slice(0, 7))

const navLabel = computed(() => {
  if (view.value === 'month') {
    return new Date(`${monthAnchor.value}-01T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  }
  if (view.value === 'week') {
    const d = new Date(`${dateIso.value}T00:00:00`)
    const start = addDaysIso(dateIso.value, -d.getDay())
    const end = addDaysIso(start, 6)
    const fmt = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `Week of ${fmt(start)} – ${fmt(end)}`
  }
  return new Date(`${dateIso.value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})

function shiftView(delta: number) {
  if (view.value === 'month') {
    const d = new Date(`${monthAnchor.value}-01T00:00:00`)
    d.setMonth(d.getMonth() + delta)
    dateIso.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  } else if (view.value === 'week') {
    dateIso.value = addDaysIso(dateIso.value, delta * 7)
  } else {
    dateIso.value = addDaysIso(dateIso.value, delta)
  }
}

function goToday() {
  dateIso.value = todayCentralIso()
}

function openDay(iso: string) {
  dateIso.value = iso
  view.value = 'day'
}

/* Keep the loaded entry range covering what this tab shows (shared
   with the main boards — the shell reloads its own window when the
   user returns to a calendar tab). */
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
  await loadVisibleRange()
})

watch(monthAnchor, () => {
  void loadVisibleRange()
})

watch(view, (v, prev) => {
  if (prev === 'period' && v !== 'period') void loadVisibleRange()
})

// ── summary + own pending ────────────────────────────────────────────

/** How many of my shift days land in the displayed month. */
const monthShiftCount = computed(() => {
  const me = sched.myUserId.value
  if (!me) return 0
  const first = `${monthAnchor.value}-01`
  const endD = new Date(`${first}T00:00:00`)
  endD.setMonth(endD.getMonth() + 1)
  endD.setDate(0)
  const last = `${monthAnchor.value}-${String(endD.getDate()).padStart(2, '0')}`
  let days = 0
  for (let iso = first; iso <= last; iso = addDaysIso(iso, 1)) {
    if (iso < sched.rangeStart.value || iso > sched.rangeEnd.value) continue
    const m = sched.dayModel(iso, me)
    const working = m.units.some((um) => um.seats.some((sm) => sm.rows.some((r) => !r.open)))
    if (working) days++
  }
  return days
})

const myPending = computed(() =>
  sched.requests.value.filter(
    (r) =>
      (r.status === 'pending' || r.status === 'partner_accepted') &&
      (r.requesterId === sched.myUserId.value || r.counterpartyId === sched.myUserId.value),
  ),
)

const TYPE_LABELS: Record<string, string> = {
  time_off: 'Time off',
  extra_hours: 'Extra hours',
  pickup: 'Shift pickup',
  trade: 'Trade',
  giveaway: 'Giveaway',
}

function pendingLine(r: SchedRequest): string {
  const bits: string[] = []
  if (r.workDate) {
    bits.push(
      new Date(`${r.workDate}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    )
  }
  if (r.startAt && r.endAt) bits.push(`${hhmm(r.startAt)} – ${hhmm(r.endAt)}`)
  if (r.unitCode) bits.push(r.unitCode)
  if (r.positionLabel) bits.push(r.positionLabel)
  return bits.join(' · ')
}
</script>

<template>
  <div class="my">
    <section v-if="myPending.length > 0" class="my__pending">
      <h3 class="my__h my__h--pend">Your pending requests</h3>
      <div v-for="r in myPending" :key="r.id" class="my__pendrow">
        <span class="my__pendtype">{{ TYPE_LABELS[r.type] ?? r.type }}</span>
        <span class="my__pendline">{{ pendingLine(r) }}</span>
        <span class="my__chip">{{ r.status === 'partner_accepted' ? 'Awaiting approval' : 'Pending' }}</span>
      </div>
    </section>

    <div class="my__nav">
      <div class="my__views" role="tablist">
        <button
          v-for="v in VIEWS"
          :key="v.key"
          class="my__viewbtn"
          :class="{ 'my__viewbtn--on': view === v.key }"
          role="tab"
          :aria-selected="view === v.key"
          @click="view = v.key"
        >
          {{ v.label }}
        </button>
      </div>

      <template v-if="view !== 'period'">
        <div class="my__arrows">
          <button class="my__navbtn" aria-label="Previous" @click="shiftView(-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button class="my__navbtn my__navbtn--today" @click="goToday">Today</button>
          <button class="my__navbtn" aria-label="Next" @click="shiftView(1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <h2 class="my__navlabel">{{ navLabel }}</h2>
      </template>

      <span class="my__count">
        Showing you + open seats
        <template v-if="view === 'month' && monthShiftCount > 0">
          · {{ monthShiftCount }} shift {{ monthShiftCount === 1 ? 'day' : 'days' }} this month
        </template>
      </span>
    </div>

    <ScheduleMonthBoard v-if="view === 'month'" :month="monthAnchor" mine @open-day="openDay" />
    <ScheduleDayBoard v-else-if="view === 'day'" :date-iso="dateIso" mine />
    <ScheduleWeekBoard v-else-if="view === 'week'" :date-iso="dateIso" mine @open-day="openDay" />
    <SchedulePeriodBoard
      v-else
      mine
      @open-day="openDay"
      @range="(s: string, e: string) => sched.loadRange(s, e)"
    />
  </div>
</template>

<style scoped>
.my__h {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.45rem;
}

.my__h--pend {
  color: var(--color-danger-500);
}

.my__pending {
  border: 1px solid oklch(0.88 0.06 27);
  background: oklch(0.995 0.004 27);
  border-radius: 12px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 1rem;
  box-shadow: var(--shadow-sm);
  max-width: 720px;
}

.my__pendrow {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.86rem;
  flex-wrap: wrap;
}

.my__pendrow:last-child {
  border-bottom: 0;
}

.my__pendtype {
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
}

.my__pendline {
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
  min-width: 0;
}

.my__chip {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 700;
  border: 1px solid oklch(0.88 0.05 60);
  background: var(--color-warning-50);
  color: oklch(0.5 0.13 60);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.my__nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.my__views {
  display: inline-flex;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 3px;
  gap: 2px;
}

.my__viewbtn {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-muted);
  padding: 0.28rem 0.7rem;
  border-radius: 7px;
  cursor: pointer;
}

.my__viewbtn--on {
  background: var(--color-brand-700);
  color: white;
}

.my__arrows {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.my__navbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  padding: 0 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.my__navbtn svg {
  width: 14px;
  height: 14px;
}

.my__navbtn:hover {
  border-color: var(--color-brand-300);
}

.my__navlabel {
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--color-ink);
  margin: 0;
}

.my__count {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--color-muted);
}
</style>
