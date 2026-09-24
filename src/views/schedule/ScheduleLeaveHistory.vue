<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  accruingBy,
  type LeaveBalance,
  type LeaveTaken,
} from '@/composables/useSchedule'

/**
 * Leave ledger for one member — both kinds, every transaction with a
 * running balance, newest first. Credits come from sched_leave_ledger
 * (opening / accruals / adjustments / write-offs); deductions are the
 * paid time-off entries on the schedule. Upcoming (future-dated) time
 * off is flagged: it already deducts from the working balance the
 * moment it's approved, but it hasn't been TAKEN yet.
 *
 * Used two ways: expanded rows on the HR Balances table (summary off —
 * the numbers are table columns there) and the member-facing "View
 * details" modal on My schedule (summary on).
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
  label: string
  note: string | null
  delta: number
  after: number
  future: boolean
}

interface KindBlock {
  kind: 'vacation' | 'sick'
  title: string
  /** balance before upcoming approved time off — "what you have today" */
  current: number
  /** approved paid time off that hasn't happened yet */
  upcoming: number
  lastUpcoming: string | null
  /** once the upcoming days are taken, counting accruals through then */
  available: number
  rows: LedgerRow[]
}

const today = todayCentralIso()

const blocks = computed<KindBlock[]>(() => {
  const p = sched.personById.value.get(props.userId)
  const out: KindBlock[] = []
  for (const kind of ['vacation', 'sick'] as const) {
    const bal = bals.value.find((b) => b.kind === kind)?.balance ?? null
    const events: Omit<LedgerRow, 'after'>[] = []
    for (const c of credits.value) {
      if (c.kind !== kind) continue
      events.push({
        dateIso: c.effectiveOn,
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
        label: future ? 'Time off — upcoming' : 'Time off taken',
        note: null,
        delta: -t.hours,
        future,
      })
    }
    if (events.length === 0 && bal === null) continue
    // ledger order: date, credits before deductions on the same day
    events.sort(
      (a, b) => a.dateIso.localeCompare(b.dateIso) || (a.delta > 0 ? 0 : 1) - (b.delta > 0 ? 0 : 1),
    )
    let run = 0
    const rows: LedgerRow[] = events.map((e) => {
      run = Math.round((run + e.delta) * 100) / 100
      return { ...e, after: run }
    })
    rows.reverse() // newest first — the running balance reads downward into history
    const upcoming =
      Math.round(mine.filter((t) => t.dateIso > today).reduce((k, t) => k + t.hours, 0) * 100) / 100
    const lastUpcoming = mine.reduce<string | null>(
      (m, t) => (t.dateIso > today && (!m || t.dateIso > m) ? t.dateIso : m),
      null,
    )
    const current = Math.round(((bal ?? 0) + upcoming) * 100) / 100
    const available = lastUpcoming
      ? Math.round(
          ((bal ?? 0) +
            accruingBy(p?.hireDate, p?.employmentType === 'full_time', kind, lastUpcoming)) *
            100,
        ) / 100
      : (bal ?? 0)
    out.push({
      kind,
      title: kind === 'vacation' ? 'Vacation' : 'Sick',
      current,
      upcoming,
      lastUpcoming,
      available,
      rows,
    })
  }
  return out
})

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
    <p v-if="loading" class="lh__muted">Loading history…</p>
    <template v-else>
      <p v-if="blocks.length === 0" class="lh__muted">No leave activity on record.</p>
      <div v-for="b in blocks" :key="b.kind" class="lh__kind">
        <p class="lh__head">
          <span class="lh__k">{{ b.title }}</span>
          <template v-if="props.summary">
            <span class="lh__stat">balance <b :class="{ lh__neg: b.current < 0 }">{{ b.current.toFixed(2) }}</b></span>
            <template v-if="b.upcoming > 0">
              <span class="lh__stat">upcoming <b>−{{ b.upcoming.toFixed(2) }}</b></span>
              <span class="lh__stat">
                available <b :class="{ lh__neg: b.available < 0 }">{{ b.available.toFixed(2) }}</b>
                <span class="lh__muted"> after {{ fmtD(b.lastUpcoming!) }}</span>
              </span>
            </template>
          </template>
        </p>
        <table v-if="b.rows.length" class="lh__table">
          <thead>
            <tr><th>Date</th><th>Event</th><th class="lh__num">Hours</th><th class="lh__num">Balance</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in b.rows" :key="i" :class="{ 'lh__row--future': r.future }">
              <td class="lh__date">{{ fmtD(r.dateIso) }}</td>
              <td>{{ r.label }}<span v-if="r.note" class="lh__muted"> — {{ r.note }}</span></td>
              <td class="lh__num" :class="r.delta < 0 ? 'lh__out' : 'lh__in'">{{ fmtDelta(r.delta) }}</td>
              <td class="lh__num" :class="{ lh__neg: r.after < 0 }">{{ r.after.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="lh__muted">No activity yet.</p>
      </div>
      <p v-if="props.summary && blocks.some((b) => b.upcoming > 0)" class="lh__note">
        Upcoming time off deducts from the working balance as soon as it's approved. The
        Balance column shows where the balance lands after each line; accruals keep posting
        every pay-period close.
      </p>
    </template>
  </div>
</template>

<style scoped>
.lh__kind {
  margin: 4px 0 14px;
}

.lh__head {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 0 4px;
}

.lh__k {
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-accent-700);
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
</style>
