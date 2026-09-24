<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  vacationRate,
  serviceYears,
  todayCentralIso,
  personSortKey,
  accruingBy,
  type LeaveBalance,
  type LeaveTaken,
} from '@/composables/useSchedule'
import ScheduleLeaveHistory from './ScheduleLeaveHistory.vue'
import ScheduleSpinner from './ScheduleSpinner.vue'

/**
 * Leave balances — the HR surface on Time Reports. Vacation + sick live
 * in the module (decision 2026-09-23): credits come from the ledger
 * (opening import, per-period accruals, adjustments, anniversary
 * write-offs) and paid time-off entries deduct live. This section is
 * the roster view: everyone's numbers, manual adjustments with a note,
 * a paste-in true-up against Paycom's accrual report, and a CSV export.
 */

const sched = useSchedule()

const rows = ref<LeaveBalance[]>([])
const taken = ref<LeaveTaken[]>([])
const loading = ref(true)
const flash = ref<string | null>(null)
let flashT: ReturnType<typeof setTimeout> | null = null
function say(msg: string) {
  flash.value = msg
  if (flashT) clearTimeout(flashT)
  flashT = setTimeout(() => (flash.value = null), 4000)
}

async function load() {
  loading.value = true
  const [b, t] = await Promise.all([sched.fetchLeaveBalances(), sched.fetchLeaveTaken()])
  rows.value = b
  taken.value = t
  loading.value = false
}
onMounted(load)

/** One row per employee, three numbers per kind (Justin, 2026-09-24):
 *  balance = today, before upcoming approved time off (what Paycom
 *  would roughly say); upcoming = approved days that haven't happened
 *  yet; available = once they're taken, counting the accruals that
 *  post between now and the last one. The module's working balance
 *  (what the request gate uses) is the Available number. */
interface KindCols {
  balance: number | null
  upcoming: number
  available: number | null
}

interface Row {
  userId: string
  name: string
  hireDate: string | null
  years: number
  rate: number
  vacation: KindCols
  sick: KindCols
}

/** Approved-but-future paid time off per user|kind — the wedge between
 *  the module's working balance and what Paycom shows today. */
const upcomingMap = computed(() => {
  const today = todayCentralIso()
  const up = new Map<string, { hours: number; last: string }>()
  for (const t of taken.value) {
    if (t.dateIso <= today) continue
    const k = `${t.userId}|${t.kind}`
    const e = up.get(k) ?? { hours: 0, last: t.dateIso }
    e.hours = Math.round((e.hours + t.hours) * 100) / 100
    if (t.dateIso > e.last) e.last = t.dateIso
    up.set(k, e)
  }
  return up
})

const table = computed<Row[]>(() => {
  const by = new Map<string, { vacation?: number; sick?: number }>()
  for (const b of rows.value) {
    const e = by.get(b.userId) ?? {}
    e[b.kind] = b.balance
    by.set(b.userId, e)
  }
  const today = todayCentralIso()
  const up = upcomingMap.value
  const cols = (
    userId: string,
    kind: 'vacation' | 'sick',
    bal: number | undefined,
    p: { hireDate?: string | null; employmentType?: string | null },
  ): KindCols => {
    const u = up.get(`${userId}|${kind}`)
    const view = bal ?? null
    if (view === null) return { balance: null, upcoming: u?.hours ?? 0, available: null }
    if (!u) return { balance: view, upcoming: 0, available: view }
    return {
      balance: Math.round((view + u.hours) * 100) / 100,
      upcoming: u.hours,
      available:
        Math.round(
          (view + accruingBy(p.hireDate, p.employmentType === 'full_time', kind, u.last)) * 100,
        ) / 100,
    }
  }
  const out: Row[] = []
  for (const [userId, bals] of by) {
    const p = sched.personById.value.get(userId)
    if (!p) continue
    out.push({
      userId,
      name: p.fullName,
      hireDate: p.hireDate ?? null,
      years: serviceYears(p.hireDate ?? null, today),
      rate: vacationRate(p.hireDate ?? null, today),
      vacation: cols(userId, 'vacation', bals.vacation, p),
      sick: cols(userId, 'sick', bals.sick, p),
    })
  }
  // last-name order, same as every other payroll table
  return out.sort((a, b) => personSortKey(a.name).localeCompare(personSortKey(b.name)))
})

/* ── per-row ledger expansion ──────────────────────────────────────── */
const histFor = ref<string | null>(null)
function toggleHist(userId: string) {
  histFor.value = histFor.value === userId ? null : userId
}

/* ── manual adjustment ─────────────────────────────────────────────── */
const adjustFor = ref<string | null>(null)
const adjKind = ref<'vacation' | 'sick'>('vacation')
const adjHours = ref<number | null>(null)
const adjNote = ref('')
const busy = ref(false)
function openAdjust(userId: string) {
  adjustFor.value = adjustFor.value === userId ? null : userId
  adjKind.value = 'vacation'
  adjHours.value = null
  adjNote.value = ''
}
async function saveAdjust() {
  if (!adjustFor.value || !adjHours.value || busy.value) return
  if (!adjNote.value.trim()) {
    say('Adjustments need a note — what is this correcting?')
    return
  }
  busy.value = true
  const e = await sched.adjustLeave(adjustFor.value, adjKind.value, adjHours.value, adjNote.value)
  busy.value = false
  if (e) {
    say(e)
    return
  }
  say('Adjustment posted.')
  adjustFor.value = null
  await load()
}

/* ── true-up vs the Paycom accrual report ──────────────────────────── */
const trueOpen = ref(false)
const truePaste = ref('')
interface TrueRow {
  userId: string
  name: string
  kind: 'vacation' | 'sick'
  target: number
  current: number
  diff: number
}
const truePreview = ref<TrueRow[] | null>(null)
function parseTrueUp() {
  const byCode = new Map(
    sched.allPeople.value.filter((p) => p.paycomCode).map((p) => [p.paycomCode as string, p]),
  )
  const cur = new Map(rows.value.map((b) => [`${b.userId}|${b.kind}`, b.balance]))
  const out: TrueRow[] = []
  for (const line of truePaste.value.split('\n')) {
    const m = line.match(/\(([A-Z0-9]{3,6})\)\s*[|\t;,]?\s*(Sick|FSV)\b[\s|\t;,]+[\d.]+[\s|\t;,]+(-?[\d.]+)/i)
    if (!m) continue
    const p = byCode.get(m[1].toUpperCase())
    if (!p) continue
    const kind = m[2].toUpperCase() === 'FSV' ? 'vacation' : 'sick'
    const target = Number(m[3])
    /* Compare against the PRE-upcoming balance: approved future time
       off already deducts here but hasn't hit Paycom yet — without
       adding it back, every future vacation reads as drift. */
    const current =
      (cur.get(`${p.id}|${kind}`) ?? 0) + (upcomingMap.value.get(`${p.id}|${kind}`)?.hours ?? 0)
    const diff = Math.round((target - current) * 100) / 100
    if (Math.abs(diff) >= 0.05) out.push({ userId: p.id, name: p.fullName, kind, target, current, diff })
  }
  truePreview.value = out
}
async function applyTrueUp() {
  if (!truePreview.value?.length || busy.value) return
  busy.value = true
  let n = 0
  for (const t of truePreview.value) {
    const e = await sched.adjustLeave(t.userId, t.kind, t.diff, `True-up vs Paycom accrual report ${todayCentralIso()}`)
    if (!e) n++
  }
  busy.value = false
  say(`True-up posted ${n} adjustment${n === 1 ? '' : 's'}.`)
  truePreview.value = null
  truePaste.value = ''
  trueOpen.value = false
  await load()
}

/* ── export ────────────────────────────────────────────────────────── */
function exportCsv() {
  const q = (v: string) => '"' + v.replace(/"/g, '""') + '"'
  const n = (v: number | null) => (v === null ? '' : v.toFixed(2))
  const lines = [
    'name,hire_date,years,vacation_rate,vacation_balance,vacation_upcoming,vacation_available,sick_balance,sick_upcoming,sick_available',
  ]
  for (const r of table.value) {
    lines.push(
      [
        q(r.name),
        r.hireDate ?? '',
        r.years,
        r.rate.toFixed(2),
        n(r.vacation.balance),
        r.vacation.upcoming ? r.vacation.upcoming.toFixed(2) : '',
        n(r.vacation.available),
        n(r.sick.balance),
        r.sick.upcoming ? r.sick.upcoming.toFixed(2) : '',
        n(r.sick.available),
      ].join(','),
    )
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `leave-balances-${todayCentralIso()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function fmtHire(d: string | null): string {
  return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}
</script>

<template>
  <div class="lv">
    <div class="lv__head">
      <h3 class="lv__title">Leave balances</h3>
      <span class="lv__sub">Vacation + sick — accruals post at each pay-period close; approved paid time off deducts automatically.</span>
      <button type="button" class="lv__btn" @click="trueOpen = !trueOpen">True-up vs Paycom</button>
      <button type="button" class="lv__btn lv__btn--ghost" @click="exportCsv">Export CSV</button>
    </div>

    <div v-if="trueOpen" class="lv__trueup">
      <p class="lv__hint">
        Paste rows from the Paycom accrual report (Employee (CODE) | Sick/FSV | rate | running balance).
        Differences post as adjustments with a true-up note.
      </p>
      <textarea v-model="truePaste" rows="5" class="lv__paste" placeholder="ABEL, FAWNA (A001)	Sick	2.77	106.17"></textarea>
      <div class="lv__truebtns">
        <button type="button" class="lv__btn" :disabled="!truePaste.trim()" @click="parseTrueUp">Preview</button>
        <button v-if="truePreview?.length" type="button" class="lv__btn lv__btn--go" :disabled="busy" @click="applyTrueUp">
          Post {{ truePreview.length }} adjustment{{ truePreview.length === 1 ? '' : 's' }}
        </button>
        <span v-else-if="truePreview" class="lv__ok">Everything matches — nothing to post.</span>
      </div>
      <div v-if="truePreview?.length" class="lv__prev">
        <div v-for="t in truePreview" :key="t.userId + t.kind" class="lv__prevrow">
          <span>{{ t.name }}</span><span>{{ t.kind }}</span>
          <span>{{ t.current.toFixed(2) }} → {{ t.target.toFixed(2) }}</span>
          <b :class="{ 'lv__neg': t.diff < 0 }">{{ t.diff > 0 ? '+' : '' }}{{ t.diff.toFixed(2) }}</b>
        </div>
      </div>
    </div>

    <ScheduleSpinner v-if="loading" label="Loading balances…" />
    <div v-else class="lv__scroll">
      <table class="lv__table">
        <thead>
          <tr class="lv__grp">
            <th colspan="4"></th>
            <th colspan="3" class="lv__gv">Vacation</th>
            <th colspan="3" class="lv__gs">Sick</th>
            <th></th>
          </tr>
          <tr>
            <th>Employee</th><th>Hired</th><th class="lv__num">Yrs</th><th class="lv__num">Rate</th>
            <th class="lv__num lv__tv">Balance</th><th class="lv__num lv__tv">Upcoming</th><th class="lv__num lv__tv">Available</th>
            <th class="lv__num lv__ts">Balance</th><th class="lv__num lv__ts">Upcoming</th><th class="lv__num lv__ts">Available</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in table" :key="r.userId">
            <tr class="lv__row" @click="toggleHist(r.userId)">
              <td>
                <span class="lv__chev" :class="{ 'lv__chev--open': histFor === r.userId }" aria-hidden="true">▸</span>
                <span class="lv__name">{{ r.name }}</span>
              </td>
              <td>{{ fmtHire(r.hireDate) }}</td>
              <td class="lv__num">{{ r.years }}</td>
              <td class="lv__num">{{ r.rate.toFixed(2) }}</td>
              <td class="lv__num lv__tv" :class="{ 'lv__neg': (r.vacation.balance ?? 0) < 0 }">{{ r.vacation.balance?.toFixed(2) ?? '—' }}</td>
              <td class="lv__num lv__tv lv__up">{{ r.vacation.upcoming ? '−' + r.vacation.upcoming.toFixed(2) : '—' }}</td>
              <td class="lv__num lv__tv lv__avail" :class="{ 'lv__neg': (r.vacation.available ?? 0) < 0 }">{{ r.vacation.available?.toFixed(2) ?? '—' }}</td>
              <td class="lv__num lv__ts" :class="{ 'lv__neg': (r.sick.balance ?? 0) < 0 }">{{ r.sick.balance?.toFixed(2) ?? '—' }}</td>
              <td class="lv__num lv__ts lv__up">{{ r.sick.upcoming ? '−' + r.sick.upcoming.toFixed(2) : '—' }}</td>
              <td class="lv__num lv__ts lv__avail" :class="{ 'lv__neg': (r.sick.available ?? 0) < 0 }">{{ r.sick.available?.toFixed(2) ?? '—' }}</td>
              <td><button type="button" class="lv__adjbtn" @click.stop="openAdjust(r.userId)">Adjust</button></td>
            </tr>
            <tr v-if="adjustFor === r.userId">
              <td colspan="11" class="lv__adjrow">
                <select v-model="adjKind" class="lv__input"><option value="vacation">Vacation</option><option value="sick">Sick</option></select>
                <input v-model.number="adjHours" type="number" step="0.25" class="lv__input lv__input--num" placeholder="± hours" />
                <input v-model="adjNote" type="text" class="lv__input lv__input--note" placeholder="Why (required — goes in the ledger)" />
                <button type="button" class="lv__btn lv__btn--go" :disabled="busy || !adjHours" @click="saveAdjust">Post</button>
              </td>
            </tr>
            <tr v-if="histFor === r.userId">
              <td colspan="11" class="lv__histrow">
                <ScheduleLeaveHistory :user-id="r.userId" :summary="false" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-if="!loading" class="lv__legend">
      Balance = today, before upcoming time off · Upcoming = approved days not yet taken ·
      Available = once they're taken, counting accruals through the last one. Click a row for
      the full ledger.
    </p>
    <p v-if="flash" class="lv__flash">{{ flash }}</p>
  </div>
</template>

<style scoped>
.lv {
  margin-top: 4px;
}
.lv__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.lv__title { font-family: var(--font-display, inherit); font-size: 1.15rem; margin: 0; color: var(--color-brand-800); }
.lv__sub { font-size: 0.72rem; color: var(--color-muted); flex: 1; min-width: 220px; }
.lv__btn {
  border: 1px solid var(--color-brand-800); background: var(--color-brand-800); color: #fff;
  border-radius: 4px; padding: 6px 12px; font-size: 0.74rem; font-weight: 700; cursor: pointer;
}
.lv__btn:disabled { opacity: 0.5; cursor: default; }
.lv__btn--ghost { background: none; color: var(--color-ink); border-color: var(--color-line); }
.lv__btn--go { background: var(--color-success-500); border-color: var(--color-success-500); }
.lv__hint { font-size: 0.74rem; color: var(--color-muted); margin: 10px 0 0; }
.lv__trueup { margin-top: 12px; border: 1px dashed var(--color-line); border-radius: 10px; padding: 10px 12px; }
.lv__paste { width: 100%; margin-top: 6px; border: 1px solid var(--color-line); border-radius: 8px; padding: 8px 10px; font: 0.72rem ui-monospace, Consolas, monospace; background: var(--color-canvas, transparent); color: inherit; }
.lv__truebtns { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.lv__ok { font-size: 0.74rem; color: var(--color-success-500); font-weight: 600; }
.lv__prev { margin-top: 8px; }
.lv__prevrow { display: flex; gap: 14px; font-size: 0.74rem; padding: 2px 0; }
.lv__prevrow span:first-child { min-width: 180px; }
.lv__scroll { overflow-x: auto; margin-top: 10px; }
.lv__table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.lv__table th { text-align: left; font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted); padding: 4px 8px; border-bottom: 1px solid var(--color-line); }
.lv__table td { padding: 5px 8px; border-bottom: 1px solid var(--color-line-soft); }
.lv__num { text-align: right; font-variant-numeric: tabular-nums; }
.lv__table th.lv__num { text-align: right; }
.lv__neg { color: var(--color-danger-500); font-weight: 700; }
/* Kind zoning (Justin, 2026-09-24): warm band = vacation, cool band =
   sick, heavy underlined group headers — the small gold text got lost. */
.lv__grp th { border-bottom: 0; padding-bottom: 2px; }
.lv__gv, .lv__gs {
  text-align: center !important;
  color: var(--color-ink) !important;
  font-size: 0.66rem !important;
  letter-spacing: 0.14em !important;
}
.lv__gv { border-bottom: 2px solid var(--color-accent-600) !important; }
.lv__gs { border-bottom: 2px solid oklch(0.55 0.1 262) !important; }
.lv__tv { background: oklch(0.975 0.018 86.8); }
.lv__ts { background: oklch(0.968 0.008 262); }
tr:hover .lv__tv { background: oklch(0.955 0.025 86.8); }
tr:hover .lv__ts { background: oklch(0.945 0.012 262); }
.lv__row { cursor: pointer; }
.lv__row:hover .lv__name { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
.lv__name { font-weight: 600; color: var(--color-ink); }
.lv__chev { display: inline-block; font-size: 0.6rem; color: var(--color-muted); margin-right: 6px; transition: transform 0.12s; }
.lv__chev--open { transform: rotate(90deg); }
.lv__up { color: var(--color-muted); }
.lv__avail { font-weight: 700; color: var(--color-ink); }
.lv__histrow { background: var(--color-surface-sunk, transparent); padding: 8px 12px 10px 28px; }
.lv__legend { font-size: 0.7rem; color: var(--color-muted); margin: 8px 0 0; }
.lv__adjbtn { border: 1px solid var(--color-line); background: none; color: var(--color-muted); border-radius: 6px; padding: 2px 9px; font-size: 0.68rem; font-weight: 600; cursor: pointer; }
.lv__adjbtn:hover { border-color: var(--color-brand-700); color: var(--color-brand-700); }
.lv__adjrow { background: var(--color-surface-sunk, transparent); }
.lv__adjrow .lv__input { border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 8px; font-size: 0.74rem; background: var(--color-canvas, transparent); color: inherit; margin-right: 6px; }
.lv__input--num { width: 90px; }
.lv__input--note { width: 46%; min-width: 200px; }
.lv__flash { margin: 10px 0 0; font-size: 0.76rem; font-weight: 600; color: var(--color-brand-700); }
</style>
