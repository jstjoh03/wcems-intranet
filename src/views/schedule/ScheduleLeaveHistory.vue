<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import ScheduleSpinner from './ScheduleSpinner.vue'
import {
  useSchedule,
  todayCentralIso,
  addDaysIso,
  accruingBy,
  type LeaveBalance,
  type LeaveTaken,
} from '@/composables/useSchedule'

/**
 * Leave ledger for one member — ONE merged stream (locked 2026-09-24):
 * every credit and every time-off day, tagged VAC / SICK, newest first,
 * each line carrying that kind's running balance. Upcoming (future-
 * dated) time off is flagged: it already deducts from the working
 * balance the moment it's approved, but it hasn't been TAKEN yet.
 *
 * The planner at the bottom answers "how much will I have on <date>?" —
 * accruals through that date, minus only the time off before it.
 *
 * Used two ways: expanded rows on the HR Balances table (summary off)
 * and the member-facing "View details" modal on My schedule.
 */

const props = withDefaults(defineProps<{ userId: string; summary?: boolean }>(), {
  summary: true,
})

const sched = useSchedule()

const loading = ref(true)
const bals = ref<LeaveBalance[]>([])
const credits = ref<{ kind: string; hours: number; reason: string; effectiveOn: string; note: string | null }[]>([])
const taken = ref<LeaveTaken[]>([])

async function load() {
  loading.value = true
  const [b, c, t] = await Promise.all([
    sched.fetchLeaveBalances(props.userId),
    sched.fetchLeaveLedger(props.userId),
    sched.fetchLeaveTaken(props.userId),
  ])
  bals.value = b
  credits.value = c
  taken.value = t
  loading.value = false
}
onMounted(load)
watch(() => props.userId, load)

const REASON_LABELS: Record<string, string> = {
  opening: 'Opening balance (Paycom import)',
  accrual: 'Accrual — pay period close',
  adjustment: 'Adjustment',
  writeoff: 'Carry-over write-off',
}

interface LedgerRow {
  dateIso: string
  kind: 'vacation' | 'sick'
  label: string
  note: string | null
  delta: number
  after: number
  future: boolean
}

interface KindSummary {
  kind: 'vacation' | 'sick'
  title: string
  current: number
  upcoming: number
  lastUpcoming: string | null
  available: number
}

const today = todayCentralIso()

const model = computed<{ summaries: KindSummary[]; rows: LedgerRow[] }>(() => {
  const p = sched.personById.value.get(props.userId)
  const summaries: KindSummary[] = []
  const rows: LedgerRow[] = []
  for (const kind of ['vacation', 'sick'] as const) {
    const bal = bals.value.find((b) => b.kind === kind)?.balance ?? null
    const events: Omit<LedgerRow, 'after'>[] = []
    for (const c of credits.value) {
      if (c.kind !== kind) continue
      events.push({
        dateIso: c.effectiveOn,
        kind,
        label: REASON_LABELS[c.reason] ?? c.reason,
        note: c.note,
        delta: c.hours,
        future: false,
      })
    }
    const mine = taken.value.filter((t) => t.kind === kind)
    for (const t of mine) {
      const future = t.dateIso > today
      events.push({
        dateIso: t.dateIso,
        kind,
        label: future ? 'Time off — upcoming' : 'Time off taken',
        note: null,
        delta: -t.hours,
        future,
      })
    }
    if (events.length === 0 && bal === null) continue
    // per-kind running balance: date order, credits before deductions
    events.sort(
      (a, b) => a.dateIso.localeCompare(b.dateIso) || (a.delta > 0 ? 0 : 1) - (b.delta > 0 ? 0 : 1),
    )
    let run = 0
    for (const e of events) {
      run = Math.round((run + e.delta) * 100) / 100
      rows.push({ ...e, after: run })
    }
    const upcoming =
      Math.round(mine.filter((t) => t.dateIso > today).reduce((k, t) => k + t.hours, 0) * 100) / 100
    const lastUpcoming = mine.reduce<string | null>(
      (m, t) => (t.dateIso > today && (!m || t.dateIso > m) ? t.dateIso : m),
      null,
    )
    summaries.push({
      kind,
      title: kind === 'vacation' ? 'Vacation' : 'Sick',
      current: Math.round(((bal ?? 0) + upcoming) * 100) / 100,
      upcoming,
      lastUpcoming,
      available: lastUpcoming
        ? Math.round(
            ((bal ?? 0) +
              accruingBy(p?.hireDate, p?.employmentType === 'full_time', kind, lastUpcoming)) *
              100,
          ) / 100
        : (bal ?? 0),
    })
  }
  // one merged stream, newest first (per-kind balances stay coherent
  // because each row carries ITS kind's running number)
  rows.sort((a, b) => b.dateIso.localeCompare(a.dateIso) || a.kind.localeCompare(b.kind))
  return { summaries, rows }
})

/* ── planner: "how much will I have on <date>?" ────────────────────── */
const planDate = ref(addDaysIso(todayCentralIso(), 60))

/** Balance on a future date: credits to date + accruals through it,
 *  counting only the approved time off that happens BEFORE it. */
function availableOn(kind: 'vacation' | 'sick', dateIso: string): number | null {
  const bal = bals.value.find((b) => b.kind === kind)?.balance
  if (bal === undefined) return null
  const p = sched.personById.value.get(props.userId)
  const addBack = taken.value
    .filter((t) => t.kind === kind && t.dateIso > dateIso)
    .reduce((k, t) => k + t.hours, 0)
  return (
    Math.round(
      (bal + addBack + accruingBy(p?.hireDate, p?.employmentType === 'full_time', kind, dateIso)) *
        100,
    ) / 100
  )
}

const planVac = computed(() => availableOn('vacation', planDate.value))
const planSick = computed(() => availableOn('sick', planDate.value))

function fmtD(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`
}
</script>

<template>
  <div class="lh">
    <ScheduleSpinner v-if="loading" label="Loading history…" />
    <template v-else>
      <p v-if="model.summaries.length === 0" class="lh__muted">No leave activity on record.</p>

      <div v-if="props.summary && model.summaries.length" class="lh__sums">
        <p v-for="s in model.summaries" :key="s.kind" class="lh__head">
          <span class="lh__klab" :class="s.kind === 'vacation' ? 'lh__klab--v' : 'lh__klab--s'">{{ s.kind === 'vacation' ? 'VAC' : 'SICK' }}</span>
          <span class="lh__stat">balance <b :class="{ lh__neg: s.current < 0 }">{{ s.current.toFixed(2) }}</b></span>
          <template v-if="s.upcoming > 0">
            <span class="lh__stat">upcoming <b>−{{ s.upcoming.toFixed(2) }}</b></span>
            <span class="lh__stat">
              available <b :class="{ lh__neg: s.available < 0 }">{{ s.available.toFixed(2) }}</b>
              <span class="lh__muted"> after {{ fmtD(s.lastUpcoming!) }}</span>
            </span>
          </template>
        </p>
      </div>

      <table v-if="model.rows.length" class="lh__table">
        <thead>
          <tr><th>Date</th><th>Kind</th><th>Event</th><th class="lh__num">Hours</th><th class="lh__num">Balance</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in model.rows" :key="i" :class="{ 'lh__row--future': r.future }">
            <td class="lh__date">{{ fmtD(r.dateIso) }}</td>
            <td><span class="lh__klab" :class="r.kind === 'vacation' ? 'lh__klab--v' : 'lh__klab--s'">{{ r.kind === 'vacation' ? 'VAC' : 'SICK' }}</span></td>
            <td>{{ r.label }}<span v-if="r.note" class="lh__muted"> — {{ r.note }}</span></td>
            <td class="lh__num" :class="r.delta < 0 ? 'lh__out' : 'lh__in'">{{ fmtDelta(r.delta) }}</td>
            <td class="lh__num" :class="{ lh__neg: r.after < 0 }">{{ r.after.toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="lh__muted">No activity yet.</p>

      <div v-if="model.summaries.length" class="lh__plan">
        <span class="lh__planq">How much will I have on</span>
        <input v-model="planDate" type="date" class="lh__planinput" :min="today" />
        <span class="lh__planr">
          →
          <span class="lh__klab lh__klab--v">VAC</span>
          <b :class="{ lh__neg: (planVac ?? 0) < 0 }">{{ planVac === null ? '—' : planVac.toFixed(1) }}</b>
          <span class="lh__klab lh__klab--s" style="margin-left: 10px">SICK</span>
          <b :class="{ lh__neg: (planSick ?? 0) < 0 }">{{ planSick === null ? '—' : planSick.toFixed(1) }}</b>
        </span>
        <span class="lh__muted lh__plannote">counts every accrual through that date, minus time off approved before it</span>
      </div>

      <p v-if="props.summary && model.rows.some((r) => r.future)" class="lh__note">
        Upcoming time off deducts from the working balance as soon as it's approved. The
        Balance column shows where that kind's balance lands after each line; accruals keep
        posting every pay-period close.
      </p>
    </template>
  </div>
</template>

<style scoped>
.lh__sums {
  margin: 2px 0 10px;
}

.lh__head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 0 4px;
}

.lh__klab {
  display: inline-block;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  border-radius: 4px;
  padding: 2px 6px;
  vertical-align: 1px;
}

.lh__klab--v {
  background: oklch(0.965 0.025 86.8);
  color: oklch(0.45 0.11 86.8);
}

.lh__klab--s {
  background: oklch(0.95 0.015 262);
  color: oklch(0.42 0.1 262);
}

.lh__stat {
  font-size: 0.78rem;
  color: var(--color-ink-soft);
}

.lh__stat b {
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.lh__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
}

.lh__table th {
  text-align: left;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  font-weight: 700;
  padding: 3px 8px;
  border-bottom: 1px solid var(--color-line);
}

.lh__table th.lh__num {
  text-align: right;
}

.lh__table td {
  padding: 3px 8px;
  border-bottom: 1px solid var(--color-line-soft);
  color: var(--color-ink-soft);
}

.lh__date {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.lh__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.lh__in {
  color: var(--color-success-500);
}

.lh__out {
  color: var(--color-ink);
}

.lh__row--future td {
  color: var(--color-muted);
  font-style: italic;
}

.lh__row--future .lh__klab {
  font-style: normal;
}

.lh__neg {
  color: var(--color-danger-500);
  font-weight: 700;
}

.lh__muted {
  color: var(--color-muted);
  font-size: 0.74rem;
  margin: 2px 0;
  font-style: normal;
}

.lh__note {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 6px 0 0;
  max-width: 62ch;
}

/* ── planner ── */
.lh__plan {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background: var(--color-surface-soft, transparent);
  padding: 8px 12px;
  margin-top: 10px;
  font-size: 0.78rem;
}

.lh__planq {
  font-weight: 600;
  color: var(--color-ink);
}

.lh__planinput {
  font: inherit;
  font-size: 0.76rem;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 3px 7px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.lh__planr {
  color: var(--color-ink);
}

.lh__planr b {
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

.lh__plannote {
  flex-basis: 100%;
  margin: 0;
}
</style>
