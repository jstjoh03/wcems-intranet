<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  vacationRate,
  serviceYears,
  todayCentralIso,
  personSortKey,
  accruingBy,
  effectiveRates,
  openingAccrual,
  LEAVE_PAID_THROUGH,
  SICK_RATE,
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
    p: {
      hireDate?: string | null
      employmentType?: string | null
      vacRateOverride?: number | null
      sickRateOverride?: number | null
    },
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
          (view +
            accruingBy(p.hireDate, p.employmentType === 'full_time', kind, u.last, {
              vac: p.vacRateOverride,
              sick: p.sickRateOverride,
            })) *
            100,
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
      rate: effectiveRates(p).vac,
      vacation: cols(userId, 'vacation', bals.vacation, p),
      sick: cols(userId, 'sick', bals.sick, p),
    })
  }
  // last-name order, same as every other payroll table
  return out.sort((a, b) => personSortKey(a.name).localeCompare(personSortKey(b.name)))
})

/* ── per-row history drawer (2026-09-25; was an inline expansion) ──── */
const histFor = ref<string | null>(null)
const histName = computed(() =>
  histFor.value ? (sched.personById.value.get(histFor.value)?.fullName ?? 'Member') : '',
)
function openHist(userId: string) {
  histFor.value = userId
}
/* jump from reading the ledger to managing the person */
function histToManage() {
  const id = histFor.value
  histFor.value = null
  if (id) openDrawer(id)
}

/* ── leave profile drawer (2026-09-24) ─────────────────────────────
   Hire date, manual accrual-rate overrides, opening balances for new
   full-timers with nothing to import, adjustments, and the ledger —
   one drawer per person, replacing the inline adjust row. */
const drawerFor = ref<string | null>(null)
const dHire = ref('')
const dVac = ref<number | null>(null)
const dSick = ref<number | null>(null)
const adjKind = ref<'vacation' | 'sick'>('vacation')
const adjHours = ref<number | null>(null)
const adjNote = ref('')
const openVac = ref<number | null>(0)
const openSick = ref<number | null>(0)
const busy = ref(false)

const ledgerIds = computed(() => new Set(rows.value.map((b) => b.userId)))
const drawerPerson = computed(() =>
  drawerFor.value ? sched.personById.value.get(drawerFor.value) : undefined,
)
const drawerHasLedger = computed(() => !!drawerFor.value && ledgerIds.value.has(drawerFor.value))

function openDrawer(userId: string) {
  drawerFor.value = userId
  const p = sched.personById.value.get(userId)
  dHire.value = p?.hireDate ?? ''
  dVac.value = p?.vacRateOverride ?? null
  dSick.value = p?.sickRateOverride ?? null
  adjKind.value = 'vacation'
  adjHours.value = null
  adjNote.value = ''
  openTouched.value = false
  const a = openingAccrual(p?.hireDate ?? null, p?.employmentType === 'full_time', {
    vac: p?.vacRateOverride,
    sick: p?.sickRateOverride,
  })
  openVac.value = a.vac
  openSick.value = a.sick
}

/* auto-calculated opening: what they'd have banked pay period by pay
   period from hire date through the Paycom cutover (Sep 12, 2026) —
   sched_leave_catchup() posts every period after that on its own.
   The fields stay editable; typing in one stops the auto-fill. */
const openTouched = ref(false)
const autoOpen = computed(() =>
  openingAccrual(dHire.value || null, drawerPerson.value?.employmentType === 'full_time', {
    vac: dVac.value,
    sick: dSick.value,
  }),
)
watch(autoOpen, (a) => {
  if (!openTouched.value) {
    openVac.value = a.vac
    openSick.value = a.sick
  }
})

/* add someone who never had an import — they get a profile + opening */
const addPick = ref('')
const addable = computed(() =>
  sched.allPeople.value.filter((p) => p.active && !ledgerIds.value.has(p.id)),
)
function onAddPick() {
  if (!addPick.value) return
  openDrawer(addPick.value)
  addPick.value = ''
}

async function saveProfile() {
  if (!drawerFor.value || busy.value) return
  busy.value = true
  const e = await sched.setLeaveProfile(
    drawerFor.value,
    dHire.value || null,
    dVac.value ?? null,
    dSick.value ?? null,
  )
  busy.value = false
  say(e ?? 'Profile saved — accruals follow it from the next pay-period close.')
}

async function postOpening() {
  if (!drawerFor.value || busy.value) return
  if (!dHire.value) {
    say('Set the hire date first — accruals need it.')
    return
  }
  busy.value = true
  const a = autoOpen.value
  const isAuto = a.periods > 0 && openVac.value === a.vac && openSick.value === a.sick
  const note = isAuto
    ? `Opening balance — accrued from hire ${dHire.value} through ${LEAVE_PAID_THROUGH} (${a.periods} pay periods, auto-calculated)`
    : undefined
  const pe = await sched.setLeaveProfile(drawerFor.value, dHire.value, dVac.value ?? null, dSick.value ?? null)
  const e = pe ?? (await sched.openLeaveBalances(drawerFor.value, openVac.value ?? 0, openSick.value ?? 0, note))
  busy.value = false
  if (e) {
    say(e)
    return
  }
  say('Balances started — they are on the board now.')
  await load()
}

async function saveAdjust() {
  if (!drawerFor.value || !adjHours.value || busy.value) return
  if (!adjNote.value.trim()) {
    say('Adjustments need a note — what is this correcting?')
    return
  }
  busy.value = true
  const e = await sched.adjustLeave(drawerFor.value, adjKind.value, adjHours.value, adjNote.value)
  busy.value = false
  if (e) {
    say(e)
    return
  }
  say('Adjustment posted.')
  adjHours.value = null
  adjNote.value = ''
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
      <select v-model="addPick" class="lv__addsel" aria-label="Add an employee to balances" @change="onAddPick">
        <option value="">Add employee…</option>
        <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.fullName }}</option>
      </select>
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
            <tr class="lv__row" @click="openHist(r.userId)">
              <td>
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
              <td><button type="button" class="lv__adjbtn" @click.stop="openDrawer(r.userId)">Manage</button></td>
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

    <!-- history drawer — row click; read-only ledger view -->
    <div v-if="histFor" class="lv__ovl" @click.self="histFor = null">
      <aside class="lv__drawer" role="dialog" aria-label="Leave history">
        <div class="lv__dh">
          <h3 class="lv__dtitle">{{ histName }}</h3>
          <button type="button" class="lv__dclose" aria-label="Close" @click="histFor = null">×</button>
        </div>
        <div class="lv__dbody">
          <ScheduleLeaveHistory :user-id="histFor" :summary="true" />
          <div class="lv__drow">
            <button type="button" class="lv__btn" @click="histToManage">
              Manage — profile, rates, adjustments
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- leave profile drawer -->
    <div v-if="drawerFor" class="lv__ovl" @click.self="drawerFor = null">
      <aside class="lv__drawer" role="dialog" aria-label="Leave profile">
        <div class="lv__dh">
          <h3 class="lv__dtitle">{{ drawerPerson?.fullName ?? 'Member' }}</h3>
          <button type="button" class="lv__dclose" aria-label="Close" @click="drawerFor = null">×</button>
        </div>
        <div class="lv__dbody">
          <p class="lv__dsect">Profile</p>
          <div class="lv__drow">
            <span class="lv__dk">Hired</span>
            <input v-model="dHire" type="date" class="lv__input" />
          </div>
          <div class="lv__drow">
            <span class="lv__dk">Vac rate</span>
            <input v-model.number="dVac" type="number" step="0.01" class="lv__input lv__input--num" :placeholder="`auto (${vacationRate(dHire || null, todayCentralIso()).toFixed(2)})`" />
            <span class="lv__dhint">per pay period — blank = automatic band</span>
          </div>
          <div class="lv__drow">
            <span class="lv__dk">Sick rate</span>
            <input v-model.number="dSick" type="number" step="0.01" class="lv__input lv__input--num" :placeholder="`auto (${SICK_RATE})`" />
            <span class="lv__dhint">blank = {{ SICK_RATE }} flat</span>
          </div>
          <div class="lv__drow">
            <button type="button" class="lv__btn" :disabled="busy" @click="saveProfile">Save profile</button>
            <span v-if="drawerPerson && drawerPerson.employmentType !== 'full_time'" class="lv__dhint lv__dwarn">
              Not marked full-time — accruals only run for full-time members.
            </span>
          </div>

          <template v-if="!drawerHasLedger">
            <p class="lv__dsect">Opening balances</p>
            <p v-if="autoOpen.periods > 0" class="lv__dhint">
              Auto-calculated from the hire date: {{ autoOpen.periods }} pay
              period{{ autoOpen.periods === 1 ? '' : 's' }} banked through Sep 12, 2026 — the
              last period Paycom paid out. Every period after that posts on its own. Edit the
              numbers before posting if Paycom shows something different.
            </p>
            <p v-else-if="dHire && dHire > LEAVE_PAID_THROUGH && drawerPerson?.employmentType === 'full_time'" class="lv__dhint">
              Hired after the Paycom cutover — accruals post automatically from their first
              pay-period close. Start at 0 (or a carried balance) to put them on the board.
            </p>
            <p v-else class="lv__dhint">
              New hire with nothing to import? Post their starting hours (0 is fine) — that
              puts them on the board and accruals take it from there.
            </p>
            <div class="lv__drow">
              <span class="lv__dk">Vacation</span>
              <input v-model.number="openVac" type="number" step="0.25" class="lv__input lv__input--num" @input="openTouched = true" />
              <span class="lv__dk">Sick</span>
              <input v-model.number="openSick" type="number" step="0.25" class="lv__input lv__input--num" @input="openTouched = true" />
              <button type="button" class="lv__btn lv__btn--go" :disabled="busy" @click="postOpening">Start balances</button>
            </div>
          </template>

          <template v-else>
            <p class="lv__dsect">Adjustment</p>
            <div class="lv__drow">
              <select v-model="adjKind" class="lv__input"><option value="vacation">Vacation</option><option value="sick">Sick</option></select>
              <input v-model.number="adjHours" type="number" step="0.25" class="lv__input lv__input--num" placeholder="± hours" />
            </div>
            <div class="lv__drow">
              <input v-model="adjNote" type="text" class="lv__input lv__input--note" placeholder="Why (required — goes in the ledger)" />
              <button type="button" class="lv__btn lv__btn--go" :disabled="busy || !adjHours" @click="saveAdjust">Post</button>
            </div>

            <p class="lv__dsect">Ledger</p>
            <ScheduleLeaveHistory :user-id="drawerFor" :summary="true" />
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.lv {
  margin-top: 4px;
}
.lv__head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.lv__title { font-family: var(--font-display, inherit); font-size: 1.15rem; margin: 0; color: var(--color-brand-800); }
.lv__sub { font-size: 0.72rem; color: var(--color-muted); flex: 1; min-width: 220px; }
/* system buttons: quiet underlined links, one flat navy primary */
.lv__btn {
  font: inherit; font-size: 0.78rem; font-weight: 650; padding: 2px; border: 0; background: none;
  color: var(--color-ink-soft); cursor: pointer; text-decoration: underline;
  text-underline-offset: 3px; text-decoration-thickness: 1px; text-decoration-color: var(--color-line);
}
.lv__btn:hover:not(:disabled) { text-decoration-color: var(--color-accent-600); }
.lv__btn:disabled { opacity: 0.5; cursor: default; }
.lv__btn--ghost { color: var(--color-muted); }
.lv__btn--go {
  border: 1px solid var(--color-brand-800); background: var(--color-brand-800); color: #fff;
  border-radius: 4px; padding: 6px 14px; font-weight: 700; text-decoration: none;
}
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
.lv__up { color: var(--color-muted); }
.lv__avail { font-weight: 700; color: var(--color-ink); }
.lv__legend { font-size: 0.7rem; color: var(--color-muted); margin: 8px 0 0; }
.lv__adjbtn { border: 1px solid var(--color-line); background: none; color: var(--color-muted); border-radius: 6px; padding: 2px 9px; font-size: 0.68rem; font-weight: 600; cursor: pointer; }
.lv__adjbtn:hover { border-color: var(--color-brand-700); color: var(--color-brand-700); }
.lv__input { border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 8px; font-size: 0.76rem; background: var(--color-surface); color: inherit; font: inherit; }
.lv__input--num { width: 110px; }
.lv__input--note { flex: 1; min-width: 180px; }
.lv__addsel { font: inherit; font-size: 0.74rem; border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 8px; background: var(--color-surface); color: var(--color-ink); }

/* ── leave profile drawer ── */
.lv__ovl { position: fixed; inset: 0; z-index: 70; background: oklch(0.18 0.015 260 / 0.4); backdrop-filter: blur(1.5px); display: flex; align-items: stretch; justify-content: flex-end; }
.lv__drawer { width: min(520px, 94vw); height: 100%; background: var(--color-surface); border-left: 1px solid var(--color-line); box-shadow: -18px 0 44px oklch(0.2 0.03 260 / 0.24); display: flex; flex-direction: column; }
.lv__dh { display: flex; align-items: baseline; gap: 10px; padding: 16px 18px 10px; border-bottom: 1px solid var(--color-line-soft); }
.lv__dtitle { font-family: var(--font-display, inherit); font-size: 1.2rem; color: var(--color-brand-800); margin: 0; flex: 1; }
.lv__dclose { border: 0; background: none; font-size: 1.25rem; color: var(--color-muted); cursor: pointer; padding: 2px 6px; }
.lv__dbody { flex: 1; overflow-y: auto; padding: 10px 18px 18px; }
.lv__dsect { font-size: 0.64rem; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: var(--color-ink); margin: 16px 0 6px; }
.lv__drow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 7px; }
.lv__dk { font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: var(--color-muted); width: 68px; flex: none; }
.lv__dhint { font-size: 0.7rem; color: var(--color-muted); }
.lv__dwarn { color: oklch(0.5 0.13 60); font-weight: 600; }
@media (max-width: 700px) {
  .lv__ovl { align-items: flex-end; justify-content: stretch; }
  .lv__drawer { width: 100%; height: auto; max-height: 88dvh; border-left: 0; border-top: 1px solid var(--color-line); border-radius: 16px 16px 0 0; }
}
.lv__flash { margin: 10px 0 0; font-size: 0.76rem; font-weight: 600; color: var(--color-brand-700); }
</style>
