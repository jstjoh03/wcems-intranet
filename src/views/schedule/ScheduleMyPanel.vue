<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  platoonFor,
  todayCentralIso,
  hhmm,
  type MyScheduleItem,
  type SchedRequest,
} from '@/composables/useSchedule'

/**
 * My schedule — the signed-in member's own next 60 days at a glance:
 * seat shifts, extra hours, event assignments, approved time off, and
 * marked-unavailable days, grouped by date, with their own pending
 * requests pinned on top. Reloads itself when the boards change (own
 * actions or realtime from elsewhere).
 */

const sched = useSchedule()

const items = ref<MyScheduleItem[]>([])
const busy = ref(false)
const err = ref<string | null>(null)
const todayIso = todayCentralIso()

async function load() {
  busy.value = true
  const res = await sched.fetchMySchedule(60)
  busy.value = false
  err.value = res.error
  items.value = res.items
}

onMounted(async () => {
  await sched.ensureLoaded()
  await load()
})

// board changed (own mutation or realtime) → refresh the list
watch(sched.entries, () => {
  void load()
})

interface DayGroup {
  dateIso: string
  heading: string
  platoon: string
  isToday: boolean
  items: MyScheduleItem[]
}

const groups = computed<DayGroup[]>(() => {
  const map = new Map<string, MyScheduleItem[]>()
  for (const it of items.value) {
    if (!map.has(it.dateIso)) map.set(it.dateIso, [])
    map.get(it.dateIso)!.push(it)
  }
  return [...map.entries()].map(([dateIso, list]) => ({
    dateIso,
    heading: new Date(`${dateIso}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    platoon: platoonFor(dateIso),
    isToday: dateIso === todayIso,
    items: list,
  }))
})

const totals = computed(() => {
  let shifts = 0
  let hours = 0
  for (const it of items.value) {
    if (it.kind === 'shift') shifts++
    if (it.kind === 'shift' || it.kind === 'extra' || it.kind === 'event') hours += it.hours
  }
  return { shifts, hours: Math.round(hours * 10) / 10 }
})

// own requests still waiting on a decision
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
    <div class="my__summary">
      <div class="my__stat">
        <span class="my__stat-n">{{ totals.shifts }}</span>
        <span class="my__stat-l">shifts · next 60 days</span>
      </div>
      <div class="my__stat">
        <span class="my__stat-n">{{ totals.hours }}</span>
        <span class="my__stat-l">scheduled hours</span>
      </div>
    </div>

    <p v-if="err" class="my__error">{{ err }}</p>

    <section v-if="myPending.length > 0" class="my__pending">
      <h3 class="my__h my__h--pend">Your pending requests</h3>
      <div v-for="r in myPending" :key="r.id" class="my__pendrow">
        <span class="my__pendtype">{{ TYPE_LABELS[r.type] ?? r.type }}</span>
        <span class="my__pendline">{{ pendingLine(r) }}</span>
        <span class="my__chip">{{ r.status === 'partner_accepted' ? 'Awaiting approval' : 'Pending' }}</span>
      </div>
    </section>

    <p v-if="busy && items.length === 0" class="my__muted">Loading your schedule…</p>
    <p v-else-if="items.length === 0" class="my__muted">
      Nothing scheduled in the next 60 days.
    </p>

    <div v-for="g in groups" :key="g.dateIso" class="my__day" :class="{ 'my__day--today': g.isToday }">
      <div class="my__day-head">
        <span class="my__day-date">{{ g.heading }}</span>
        <span v-if="g.isToday" class="my__today">Today</span>
        <span class="my__platoon" :data-platoon="g.platoon"><span class="my__dot" />{{ g.platoon }}</span>
      </div>
      <div v-for="(it, i) in g.items" :key="i" class="my__row" :data-kind="it.kind">
        <span class="my__label">
          {{ it.label }}<span v-if="it.sub" class="my__sub"> · {{ it.sub }}</span>
        </span>
        <span v-if="it.start" class="my__time">{{ it.start }} – {{ it.end }}</span>
        <span v-else class="my__time">all day</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.my {
  max-width: 640px;
}

.my__summary {
  display: flex;
  gap: 1.6rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.my__stat {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}

.my__stat-n {
  font-family: var(--font-display);
  font-size: 1.7rem;
  color: var(--color-brand-800);
  line-height: 1;
}

.my__stat-l {
  font-size: 0.8rem;
  color: var(--color-muted);
}

.my__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.my__muted {
  color: var(--color-muted);
  font-size: 0.88rem;
}

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

.my__day {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.55rem 0.8rem;
  margin-bottom: 0.55rem;
  box-shadow: var(--shadow-sm);
}

.my__day--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 1px var(--color-accent-600);
}

.my__day-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--color-line-soft);
  margin-bottom: 0.2rem;
}

.my__day-date {
  font-weight: 700;
  color: var(--color-brand-800);
  font-size: 0.92rem;
}

.my__today {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}

.my__platoon {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--color-surface);
}

.my__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

.my__platoon[data-platoon='A'] .my__dot {
  background: oklch(0.55 0.2 27);
}

.my__platoon[data-platoon='B'] .my__dot {
  background: oklch(0.5 0.16 255);
}

.my__platoon[data-platoon='C'] .my__dot {
  background: oklch(0.55 0.15 150);
}

.my__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.22rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.9rem;
}

.my__row:last-child {
  border-bottom: 0;
}

.my__label {
  color: var(--color-ink);
  font-weight: 500;
  min-width: 0;
}

.my__sub {
  color: var(--color-muted);
  font-weight: 400;
  font-size: 0.82rem;
}

.my__row[data-kind='extra'] .my__label,
.my__row[data-kind='event'] .my__label {
  color: var(--color-accent-700);
}

.my__row[data-kind='timeoff'] .my__label {
  color: oklch(0.5 0.13 60);
}

.my__row[data-kind='unavailable'] .my__label {
  color: var(--color-muted);
  font-style: italic;
  font-weight: 400;
}

.my__time {
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
