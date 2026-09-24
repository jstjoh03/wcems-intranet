<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { vacationRate, SICK_RATE, payPeriodFor, type LeaveBalance } from '@/composables/useSchedule'
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
import ScheduleMemberSettingsForm from './ScheduleMemberSettingsForm.vue'
import ScheduleLeaveHistory from './ScheduleLeaveHistory.vue'
import ScheduleSpinner from './ScheduleSpinner.vue'

/**
 * My schedule — the same calendar views as the main boards (month
 * default, plus day / week / pay period) filtered to the signed-in
 * member and open seats, with their own pending requests and a
 * shifts/hours summary on top. Clicking an open seat still opens the
 * pickup/assign modal.
 *
 * A "Schedule for" picker swaps the calendar to any other member —
 * office staff without shifts of their own use it to answer "what days
 * does X work" without hunting the full boards. Requests, settings,
 * and the pending strip stay the signed-in user's own.
 */

const sched = useSchedule()

// ── whose calendar is displayed (default: mine) ─────────────────────

/** The "Schedule for" picker is a leadership/office tool (Justin,
 *  2026-09-17): editors, supervisors, and HR — not regular members,
 *  who use the main boards to see other people. */
const canPickPerson = computed(
  () => sched.canEdit.value || sched.level.value === 'supervisor' || sched.isHr.value,
)

const viewUserId = ref<string>('') // '' = the signed-in member
const viewingId = computed(() => viewUserId.value || sched.myUserId.value)
const viewingSelf = computed(
  () => !viewUserId.value || viewUserId.value === sched.myUserId.value,
)

// ── vacation / sick balances (full-time; PT and new hires have none) ─
const leaveBal = ref<LeaveBalance[]>([])
async function loadLeave() {
  leaveBal.value = viewingId.value ? await sched.fetchLeaveBalances(viewingId.value) : []
}
onMounted(loadLeave)
watch(viewingId, loadLeave)
const vacBal = computed(() => leaveBal.value.find((b) => b.kind === 'vacation') ?? null)
const sickBal = computed(() => leaveBal.value.find((b) => b.kind === 'sick') ?? null)
const myVacRate = computed(() => {
  const p = viewingId.value ? sched.personById.value.get(viewingId.value) : undefined
  return vacationRate(p?.hireDate ?? null, todayCentralIso())
})
const nextAccrual = computed(() => {
  const end = payPeriodFor(todayCentralIso()).end
  return new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
})
/* full ledger modal — same component HR sees, RLS-scoped to self */
const balDetail = ref(false)
const viewingName = computed(() =>
  viewingSelf.value
    ? null
    : (sched.personById.value.get(viewUserId.value)?.fullName ?? null),
)
const myOptionLabel = computed(() => {
  const n = sched.personById.value.get(sched.myUserId.value ?? '')?.fullName
  return n ? `${n} (me)` : 'Me'
})

/* people arrives last-name sorted from the store (personSortKey). */
const peopleOptions = computed(() =>
  sched.people.value.filter((p) => p.id !== sched.myUserId.value),
)

/* Open seats on the personal calendar are an invitation to pick up —
   useful to some, noise to others. Off switch persists per device. */
const SHOW_OPEN_KEY = 'wcems:sched-show-open'
const showOpen = ref(true)
try {
  showOpen.value = localStorage.getItem(SHOW_OPEN_KEY) !== '0'
} catch {
  /* storage unavailable (private mode) — default stands */
}
watch(showOpen, (v) => {
  try {
    localStorage.setItem(SHOW_OPEN_KEY, v ? '1' : '0')
  } catch {
    /* best-effort persistence only */
  }
})

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

/* The phone month is a personal calendar (gold day markers only); the
   other views — and desktop month — still list open seats too. */
const isPhone = window.matchMedia('(max-width: 900px)').matches
const showingLabel = computed(() => {
  const opens = showOpen.value ? ' + open seats' : ''
  if (!viewingSelf.value) {
    const first = viewingName.value?.split(' ')[0] ?? 'Their'
    return isPhone && view.value === 'month'
      ? `${first}'s days are marked in gold`
      : `Showing ${viewingName.value ?? 'them'}${opens}`
  }
  return isPhone && view.value === 'month'
    ? 'Your days are marked in gold'
    : `Showing you${opens}`
})

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

const ready = ref(false)
onMounted(async () => {
  await sched.ensureLoaded()
  await loadVisibleRange()
  ready.value = true
})

watch(monthAnchor, () => {
  void loadVisibleRange()
})

watch(view, (v, prev) => {
  if (prev === 'period' && v !== 'period') void loadVisibleRange()
})

// ── summary + own pending ────────────────────────────────────────────

/** How many of the displayed member's shift days land in the month. */
const monthShiftCount = computed(() => {
  const me = viewingId.value
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

// ── my settings (shared form — same one the profile modal hosts) ────

const setOpen = ref(false)

function openSettings() {
  setOpen.value = true
}

/** The form flashes "Saved." — give it a beat to register, then close. */
function onSettingsSaved() {
  window.setTimeout(() => {
    setOpen.value = false
  }, 900)
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
    <ScheduleSpinner v-if="!ready" label="Loading your schedule…" />
    <template v-else>
    <p v-if="vacBal || sickBal" class="my__balline">
      <span class="my__bal"><span class="my__balk">Vacation</span><b :class="{ 'my__balneg': (vacBal?.balance ?? 0) < 0 }">{{ (vacBal?.balance ?? 0).toFixed(1) }}</b> hrs · +{{ myVacRate.toFixed(2) }}/period</span>
      <span class="my__bal"><span class="my__balk">Sick</span><b :class="{ 'my__balneg': (sickBal?.balance ?? 0) < 0 }">{{ (sickBal?.balance ?? 0).toFixed(1) }}</b> hrs · +{{ SICK_RATE }}/period</span>
      <span class="my__bal">next accrual {{ nextAccrual }}</span>
      <button type="button" class="my__ballink" @click="balDetail = true">View details</button>
    </p>

    <div v-if="balDetail" class="my__balovl" @click.self="balDetail = false">
      <div class="my__balmodal" role="dialog" aria-label="Leave balance details">
        <div class="my__balmhead">
          <h3 class="my__balmtitle">Leave balances{{ viewingName ? ' — ' + viewingName : '' }}</h3>
          <button type="button" class="my__balmclose" aria-label="Close" @click="balDetail = false">×</button>
        </div>
        <div class="my__balmscroll">
          <ScheduleLeaveHistory v-if="viewingId" :user-id="viewingId" />
        </div>
      </div>
    </div>
    <section v-if="myPending.length > 0" class="my__pending">
      <h3 class="my__h my__h--pend">Your pending requests</h3>
      <div v-for="r in myPending" :key="r.id" class="my__pendrow">
        <span class="my__pendtype">{{ TYPE_LABELS[r.type] ?? r.type }}</span>
        <span class="my__pendline">{{ pendingLine(r) }}</span>
        <span class="my__chip">{{ r.status === 'partner_accepted' ? 'Awaiting approval' : 'Pending' }}</span>
      </div>
    </section>

    <div class="my__whorow">
      <label v-if="canPickPerson" class="my__who">
        <span class="my__wholabel">Schedule for</span>
        <select v-model="viewUserId" class="my__whoselect" aria-label="Whose schedule to show">
          <option value="">{{ myOptionLabel }}</option>
          <option v-for="p in peopleOptions" :key="p.id" :value="p.id">{{ p.fullName }}</option>
        </select>
      </label>
      <label class="my__openchk">
        <input v-model="showOpen" type="checkbox" />
        Show open seats
      </label>
      <span v-if="!viewingSelf" class="my__whohint">
        Viewing {{ viewingName }}'s calendar — requests and settings below stay yours.
      </span>
    </div>

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
        {{ showingLabel }}
        <template v-if="view === 'month' && monthShiftCount > 0">
          · {{ monthShiftCount }} shift {{ monthShiftCount === 1 ? 'day' : 'days' }} this month
        </template>
      </span>

      <button class="my__navbtn my__setbtn" @click="openSettings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        My settings
      </button>
    </div>

    <div v-if="setOpen" class="my__overlay" @click.self="setOpen = false">
      <div class="my__modal" role="dialog" aria-label="My settings">
        <h3 class="my__mtitle">My settings</h3>
        <ScheduleMemberSettingsForm @saved="onSettingsSaved">
          <template #foot>
            <button class="my__navbtn" @click="setOpen = false">Close</button>
          </template>
        </ScheduleMemberSettingsForm>
      </div>
    </div>

    <ScheduleMonthBoard
      v-if="view === 'month'"
      :month="monthAnchor"
      mine
      :for-user="viewUserId || null"
      :hide-open="!showOpen"
      @open-day="openDay"
    />
    <ScheduleDayBoard
      v-else-if="view === 'day'"
      :date-iso="dateIso"
      mine
      :for-user="viewUserId || null"
      :hide-open="!showOpen"
    />
    <ScheduleWeekBoard
      v-else-if="view === 'week'"
      :date-iso="dateIso"
      mine
      :for-user="viewUserId || null"
      :hide-open="!showOpen"
      @open-day="openDay"
    />
    <SchedulePeriodBoard
      v-else
      mine
      :for-user="viewUserId || null"
      :hide-open="!showOpen"
      @open-day="openDay"
      @range="(s: string, e: string) => sched.loadRange(s, e)"
    />
    </template>
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

/* underline tabs + text nav, matching the module (2026-09-24 — the
   pill container and boxed buttons were the last of the old chrome) */
.my__views {
  display: inline-flex;
  border: 0;
  background: transparent;
  padding: 0;
  gap: 16px;
}

.my__viewbtn {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-muted);
  padding: 4px 2px 6px;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  cursor: pointer;
}

.my__viewbtn:hover {
  color: var(--color-ink);
}

.my__viewbtn--on {
  background: none;
  color: var(--color-ink);
  border-bottom-color: var(--color-accent-600);
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
  min-width: 24px;
  padding: 0 0.35rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.my__navbtn svg {
  width: 15px;
  height: 15px;
}

.my__navbtn:hover {
  color: var(--color-ink);
  background: var(--color-surface);
}

.my__navbtn--today {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-line);
  text-underline-offset: 3px;
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

.my__setbtn {
  gap: 6px;
}

/* ── My settings modal (module elevation recipe) ── */

.my__overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.25 0.03 260 / 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 7vh 1rem 2rem;
  overflow-y: auto;
}

.my__modal {
  width: min(560px, 100%);
  background:
    linear-gradient(180deg, oklch(1 0 0 / 0.9), oklch(0.985 0.004 84 / 0.9)),
    var(--color-surface);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-brand-700);
  border-radius: 14px;
  box-shadow: 0 24px 60px oklch(0.2 0.04 260 / 0.28), 0 4px 14px oklch(0.2 0.04 260 / 0.12);
  padding: 1rem 1.2rem 1.1rem;
}

.my__mtitle {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-ink);
  margin: 0 0 0.6rem;
}

/* ── "Schedule for" picker ── */

.my__whorow {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
}

.my__who {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.my__wholabel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  white-space: nowrap;
}

.my__whoselect {
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.32rem 0.5rem;
  max-width: min(260px, 70vw);
}

.my__whoselect:focus-visible {
  outline: 2px solid var(--color-brand-300);
  outline-offset: 1px;
}

.my__whohint {
  font-size: 0.76rem;
  color: var(--color-muted);
}

.my__openchk {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  cursor: pointer;
  white-space: nowrap;
}

.my__openchk input {
  accent-color: var(--color-brand-600);
}
/* Balances read as one line of header metadata (redesign 2026-09-23) —
   same register as the rotation note; the calendar is the page. */
.my__balline {
  display: flex;
  align-items: baseline;
  gap: 6px 22px;
  flex-wrap: wrap;
  font-size: 0.76rem;
  color: var(--color-muted);
  margin: 0 0 10px;
}

.my__bal {
  white-space: nowrap;
}

.my__balk {
  font-size: 0.6rem;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  font-weight: 700;
  margin-right: 5px;
}

.my__bal b {
  font-size: 0.95rem;
  color: var(--color-ink);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.my__balneg {
  color: var(--color-danger-500) !important;
}

.my__ballink {
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--color-accent-700);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

/* side drawer, matching the shared editor drawers (2026-09-24) */
.my__balovl {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.4);
  backdrop-filter: blur(1.5px);
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  z-index: 70;
  padding: 0;
}

.my__balmodal {
  background: var(--color-surface);
  border: 0;
  border-left: 1px solid var(--color-line);
  box-shadow: -18px 0 44px oklch(0.2 0.03 260 / 0.24);
  width: min(560px, 94vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.1rem 1.2rem;
  gap: 0.5rem;
}

@media (max-width: 700px) {
  .my__balovl {
    align-items: flex-end;
    justify-content: stretch;
  }

  .my__balmodal {
    width: 100%;
    height: auto;
    max-height: 88dvh;
    border-left: 0;
    border-top: 1px solid var(--color-line);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -14px 40px oklch(0.2 0.03 260 / 0.24);
  }
}

.my__balmhead {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.my__balmtitle {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--color-brand-800);
  margin: 0;
  flex: 1;
}

.my__balmclose {
  border: 0;
  background: none;
  font-size: 1.3rem;
  line-height: 1;
  color: var(--color-muted);
  cursor: pointer;
  padding: 2px 6px;
}

.my__balmscroll {
  overflow: auto;
}
</style>
