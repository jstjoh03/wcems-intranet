<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DEFAULT_HIGHLIGHT, useSchedule, todayCentralIso, addDaysIso } from '@/composables/useSchedule'
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
/* Phones open on the DAY board — crews voted for the full picture of
   who's on every truck today (2026-09-18); My schedule is one tab
   over. Desktop keeps Month. */
const isPhone = window.matchMedia('(max-width: 900px)').matches
const tab = ref<Tab>(isPhone ? 'day' : 'month')
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
  ]
  /* View-only accounts get the boards and nothing self-service. */
  if (sched.canRequest.value) {
    t.push({ key: 'requests', label: 'Requests', group: true }, { key: 'trades', label: 'Trades' })
  }
  if (sched.canPageOut.value) {
    t.push({ key: 'pages', label: 'Page-outs' })
  }
  /* Time Reports serves three duties from one tab: supervisors review
     punches to verify schedules are accurate; HR and editors get the
     full payroll flow (CSV, Paycom export, earning codes). */
  if (sched.canEdit.value || sched.level.value === 'supervisor' || sched.isHr.value) {
    t.push({ key: 'time', label: 'Time Reports', group: true })
  }
  if (sched.canEdit.value) {
    t.push({ key: 'members', label: 'Members' })
  }
  /* HR sees Setup too, trimmed to the payroll cards inside the panel. */
  if (sched.canEdit.value || sched.isHr.value) {
    t.push({ key: 'setup', label: 'Setup' })
  }
  return t
})

const showsDateNav = computed(() => tab.value === 'month' || tab.value === 'day' || tab.value === 'week')

/* Desktop rail (Sortren system, 2026-09-23): the same permission logic
   as TABS, grouped BOARDS / REQUESTS / MANAGE. Phones keep the strip. */
const RAIL = computed<{ h: string; items: { key: Tab; label: string }[] }[]>(() => {
  const groups: { h: string; items: { key: Tab; label: string }[] }[] = [
    {
      h: 'Boards',
      items: [
        { key: 'month', label: 'Month' },
        { key: 'day', label: 'Day' },
        { key: 'week', label: 'Week' },
        { key: 'period', label: 'Pay period' },
        { key: 'mine', label: 'My schedule' },
      ],
    },
  ]
  const req: { key: Tab; label: string }[] = []
  if (sched.canRequest.value) req.push({ key: 'requests', label: 'Requests' }, { key: 'trades', label: 'Trades' })
  if (sched.canPageOut.value) req.push({ key: 'pages', label: 'Page-outs' })
  if (req.length) groups.push({ h: 'Requests', items: req })
  const man: { key: Tab; label: string }[] = []
  if (sched.canEdit.value || sched.level.value === 'supervisor' || sched.isHr.value) man.push({ key: 'time', label: 'Time Reports' })
  if (sched.canEdit.value) man.push({ key: 'members', label: 'Members' })
  if (sched.canEdit.value || sched.isHr.value) man.push({ key: 'setup', label: 'Setup' })
  if (man.length) groups.push({ h: 'Manage', items: man })
  return groups
})

function badgeText(n: number): string {
  return n > 20 ? '20+' : String(n)
}

/* Breadcrumb + serif title for the non-board screens (boards carry the
   date navigator instead). */
const PANEL_META: Partial<Record<Tab, { crumb: string; title: string; sub: string }>> = {
  mine: { crumb: 'Operations · Scheduling', title: 'My schedule', sub: '' },
  requests: { crumb: 'Operations · Scheduling', title: 'Requests', sub: '' },
  trades: { crumb: 'Operations · Scheduling', title: 'Trades', sub: '' },
  pages: { crumb: 'Operations · Scheduling', title: 'Page-outs', sub: '' },
  time: { crumb: 'Operations · Scheduling · Manage', title: 'Time Reports', sub: '' },
  members: { crumb: 'Operations · Scheduling · Manage', title: 'Members', sub: 'Scheduling access only — names, roles and HR fields live in Manage Employees.' },
  setup: { crumb: 'Operations · Scheduling · Manage', title: 'Setup', sub: '' },
}

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

/* The first paint used to show a chips-only skeleton month for several
   seconds while core + entries loaded — it read as a broken page. The
   boards hide behind a spinner until the initial load lands. */
const booting = ref(true)

onMounted(async () => {
  try {
    await sched.ensureLoaded()
    if (typeof route.query.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.d)) {
      dateIso.value = route.query.d
    }
    // Page-out day links (?v=day) land on that day's full board — on
    // phones the default is My schedule, which would hide the shift.
    if (route.query.v === 'day') {
      tab.value = 'day'
      void router.replace({ query: { ...route.query, v: undefined } })
    }
    // Requests + trade offers load with the shell (not just on their
    // tabs) so pending rows show on the boards and the tab badges are
    // right from the first paint; realtime keeps them fresh after that.
    await Promise.all([loadVisibleRange(), sched.loadRequests(), sched.loadTradeOffers()])
  } finally {
    booting.value = false
  }
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
  // The tab watcher calls editor.closeAll() on its next flush — wait it
  // out, or it closes this modal the instant it opens.
  await nextTick()
  editor.openSlotDirect({
    dateIso: info.dateIso,
    seatId: info.seatId,
    entryId,
    label: info.label,
    start: info.start,
    end: info.end,
  })
}

/** ACTIONABLE requests → red badge on the Requests tab (editors).
 *  Matches the queue: trades/giveaways only count once both members
 *  have agreed. */
const pendingCount = computed(() =>
  sched.canEdit.value
    ? sched.requests.value.filter(
        (r) =>
          r.status === 'partner_accepted' ||
          (r.status === 'pending' && r.type !== 'trade' && r.type !== 'giveaway'),
      ).length
    : 0,
)

/** Actions waiting on ME → red badge on the Trades tab (everyone):
 *  directed requests in my inbox + offers awaiting my accept/decline
 *  on my own postings. Points people at where the ball is in their
 *  court, like the Requests badge does for admin. */
const tradesCount = computed(() => {
  const me = sched.myUserId.value
  if (!me || !sched.canRequest.value) return 0
  const inbox = sched.requests.value.filter(
    (r) =>
      (r.type === 'trade' || r.type === 'giveaway') &&
      r.status === 'pending' &&
      r.counterpartyId === me &&
      r.requesterId !== me,
  ).length
  const myPostingIds = new Set(
    sched.requests.value
      .filter(
        (r) =>
          (r.type === 'trade' || r.type === 'giveaway') &&
          r.status === 'pending' &&
          r.requesterId === me,
      )
      .map((r) => r.id),
  )
  const offers = sched.tradeOffers.value.filter(
    (o) => o.status === 'queued' && myPostingIds.has(o.requestId) && o.userId !== me,
  ).length
  return inbox + offers
})

function badgeFor(key: Tab): number {
  if (key === 'requests') return pendingCount.value
  if (key === 'trades') return tradesCount.value
  return 0
}

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
  <div class="sched" :style="{ '--me-hl': sched.myHighlight.value || DEFAULT_HIGHLIGHT }">
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
              }}<span v-if="badgeFor(t.key) > 0" class="sched__tab-badge">{{
                badgeText(badgeFor(t.key))
              }}</span>
            </button>
          </template>
        </div>
      </header>

      <div class="sched__layout">
        <nav class="sched__rail" aria-label="Scheduling sections">
          <div class="sched__rail-brand">
            <p class="sched__rail-t">Scheduling</p>
            <p class="sched__rail-s">Waller County EMS</p>
          </div>
          <template v-for="g in RAIL" :key="g.h">
            <p class="sched__rail-h">{{ g.h }}</p>
            <button
              v-for="it in g.items"
              :key="it.key"
              class="sched__rail-item"
              :class="{ 'sched__rail-item--on': tab === it.key }"
              @click="tab = it.key"
            >
              {{ it.label }}
              <span v-if="badgeFor(it.key) > 0" class="sched__rail-badge">{{ badgeText(badgeFor(it.key)) }}</span>
            </button>
          </template>
        </nav>
        <div class="sched__body">

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

      <div v-if="booting" class="sched__boot" role="status" aria-live="polite">
        <span class="sched__spinner" aria-hidden="true" />
        <p class="sched__boot-text">Loading the schedule…</p>
      </div>
      <template v-else>
        <div v-if="PANEL_META[tab]" class="sched__pagehead">
          <p class="sched__crumb">{{ PANEL_META[tab]!.crumb }}</p>
          <h2 class="sched__pagetitle">{{ PANEL_META[tab]!.title }}</h2>
          <p v-if="PANEL_META[tab]!.sub" class="sched__pagesub">{{ PANEL_META[tab]!.sub }}</p>
        </div>
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
      </div>
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

.sched__boot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  padding: 5rem 0 6rem;
}

.sched__spinner {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 3px solid oklch(0.9 0.02 260);
  border-top-color: var(--color-accent-600);
  animation: sched-spin 0.9s linear infinite;
}

.sched__boot-text {
  font-size: 0.9rem;
  letter-spacing: 0.02em;
  color: var(--color-muted);
  margin: 0;
}

@keyframes sched-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sched__spinner {
    animation-duration: 2.5s;
  }
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
  border: 1px solid var(--color-line-soft);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 4px;
  gap: 2px;
  flex-wrap: wrap;
}

/* ── desktop rail (Sortren system) ─────────────────────────────────── */
.sched__layout {
  display: flex;
  align-items: flex-start;
}

.sched__rail {
  display: none;
}

.sched__body {
  flex: 1;
  min-width: 0;
}

@media (min-width: 901px) {
  .sched__head {
    display: none;
  }

  .sched__rail {
    display: block;
    width: 196px;
    flex-shrink: 0;
    position: sticky;
    top: 14px;
    padding: 4px 0 20px;
    border-right: 1px solid var(--color-line-soft);
    margin-right: 26px;
  }

  .sched__body {
    padding-top: 4px;
  }
}

.sched__rail-brand {
  padding: 0 14px 10px 2px;
}

.sched__rail-t {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-brand-800);
  margin: 0;
}

.sched__rail-s {
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 1px 0 0;
}

.sched__rail-h {
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-muted);
  margin: 16px 0 3px 2px;
}

.sched__rail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  text-align: left;
  font: inherit;
  font-size: 0.84rem;
  color: var(--color-ink);
  padding: 5px 10px 5px 8px;
  border-left: 2px solid transparent;
  cursor: pointer;
}

.sched__rail-item:hover {
  background: var(--color-surface);
}

.sched__rail-item--on {
  border-left-color: var(--color-accent-600);
  background: var(--color-surface);
  font-weight: 600;
}

.sched__rail-badge {
  margin-left: auto;
  font-size: 0.62rem;
  font-weight: 700;
  background: var(--color-danger-500);
  color: #fff;
  border-radius: 999px;
  padding: 1px 7px;
  font-variant-numeric: tabular-nums;
}

.sched__pagehead {
  margin: 2px 0 14px;
}

.sched__crumb {
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 0;
}

.sched__pagetitle {
  font-family: var(--font-display);
  font-size: 1.65rem;
  font-weight: 400;
  color: var(--color-brand-800);
  margin: 2px 0 0;
}

.sched__pagesub {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 3px 0 0;
  max-width: 68ch;
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

/* Phone (the rail is desktop-only): the navy pill bar read as a relic
   next to the redesigned panels — same underline-tab language as the
   panel tabs instead, one swipeable row (Justin, 2026-09-24). Kept
   AFTER the desktop tab rules: equal specificity, source order wins. */
@media (max-width: 900px) {
  .sched__tabs {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    max-width: 100%;
    width: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 0;
    gap: 16px;
    border-bottom: 1px solid var(--color-line);
  }

  .sched__tabs::-webkit-scrollbar {
    display: none;
  }

  .sched__tabs > * {
    flex: none;
  }

  .sched__tabdiv {
    display: none;
  }

  .sched__tab {
    padding: 7px 2px 9px;
    border-radius: 0;
    background: none;
    color: var(--color-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 0.12s ease;
  }

  .sched__tab:hover {
    background: none;
    color: var(--color-ink);
  }

  .sched__tab--on,
  .sched__tab--on:hover {
    background: none;
    color: var(--color-ink);
    box-shadow: none;
    border-bottom-color: var(--color-accent-600);
  }

  .sched__tab--on::after {
    display: none;
  }

  /* the masthead already says Operations · Scheduling on a phone */
  .sched__crumb {
    display: none;
  }

  .sched__pagehead {
    margin-top: 8px;
  }
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
