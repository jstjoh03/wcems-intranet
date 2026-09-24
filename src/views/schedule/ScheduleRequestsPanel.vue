<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import TimeSelect24 from '@/views/schedule/TimeSelect24.vue'
import ScheduleSpinner from './ScheduleSpinner.vue'
import {
  useSchedule,
  todayCentralIso,
  hhmm,
  payPeriodFor,
  type SchedRequest,
  type UpcomingShift,
  type Availability,
  type HoursWarning,
} from '@/composables/useSchedule'

/**
 * Requests — crew submit time off / extra hours / open-shift pickups;
 * editors see the pending queue and approve or deny. Approval writes the
 * deviation entries so the calendar updates immediately. Pending requests
 * are private to the requester (plus supervisors and editors) via RLS.
 */

const sched = useSchedule()

const ready = ref(false)
onMounted(async () => {
  await sched.ensureLoaded()
  await sched.loadRequests()
  ready.value = true
})

// ── new request form ─────────────────────────────────────────────────

/* Pickups are filed by clicking the open shift on the calendar — no
   form here; they still surface in the approval queue below. */
type FormKind = '' | 'time_off' | 'extra_hours'
const formKind = ref<FormKind>('')
const formError = ref<string | null>(null)
const formBusy = ref(false)
const formDone = ref<string | null>(null)
const comments = ref('')

// time off
const offType = ref('vacation')
const OFF_TYPES = [
  ['vacation', 'Vacation'],
  ['sick', 'Sick'],
  ['unpaid', 'Unpaid time off'],
  ['bereavement', 'Bereavement'],
  ['other', 'Other'],
] as const

interface DayPick {
  shift: UpcomingShift
  checked: boolean
  editing: boolean
  from: string
  until: string
}
const dayPicks = ref<DayPick[]>([])

/* Three ways to take time off: from your scheduled shifts (approval
   required), a custom date (approval required), or marking a rotation
   day off as UNAVAILABLE — saved instantly, no approval; the Chief gets
   a conflict warning if they try to schedule you that day. */
type OffMode = 'shifts' | 'custom' | 'unavailable'
const offMode = ref<OffMode>('shifts')
const customDate = ref(todayCentralIso())
const customFrom = ref('06:00')
const customUntil = ref('06:00')
const unavailDate = ref(todayCentralIso())
const unavailReason = ref('')
const myUnavailable = ref<Availability[]>([])

async function refreshUnavailable() {
  myUnavailable.value = await sched.listMyUnavailable()
}

function loadDayPicks() {
  const me = sched.myUserId.value
  if (!me) return
  dayPicks.value = sched.upcomingShiftsFor(me, todayCentralIso(), 45).map((s) => ({
    shift: s,
    checked: false,
    editing: false,
    from: '06:00',
    until: '06:00',
  }))
  void refreshUnavailable()
}

async function submitUnavailable() {
  formError.value = null
  formBusy.value = true
  const e = await sched.markUnavailable(unavailDate.value, unavailReason.value)
  formBusy.value = false
  if (e) {
    formError.value = e
    return
  }
  unavailReason.value = ''
  formDone.value = 'Saved — no approval needed. The Chief is warned before scheduling you that day.'
  await refreshUnavailable()
}

async function removeUnavailable(id: string) {
  formBusy.value = true
  const e = await sched.clearUnavailable(id)
  formBusy.value = false
  if (e) formError.value = e
  await refreshUnavailable()
}

// extra hours
const exDate = ref(todayCentralIso())
const exFrom = ref('06:00')
const exUntil = ref('08:00')
const exUnit = ref('')
const exPosition = ref('')
const exTimeType = ref('regular')

/* Hour-threshold warnings, computed on first submit; the member has to
   acknowledge them before the request actually goes in, and what they
   acknowledged is stored on the request for the Chief. */
const hourWarn = ref<HoursWarning[] | null>(null)

watch([exDate, exFrom, exUntil], () => {
  hourWarn.value = null
})

const hourWarnConfirm = computed(() =>
  (hourWarn.value ?? []).some((w) => w.code === 'consecutive_confirm'),
)

function pickForm(kind: FormKind) {
  formKind.value = kind
  formError.value = null
  formDone.value = null
  comments.value = ''
  hourWarn.value = null
  if (kind === 'time_off') loadDayPicks()
}

async function submit() {
  formError.value = null
  formBusy.value = true
  let err: string | null = null
  let awaitingAck = false
  try {
    if (formKind.value === 'time_off' && offMode.value === 'custom') {
      err = await sched.createTimeOffRequests(
        offType.value,
        [{ dateIso: customDate.value, from: customFrom.value, until: customUntil.value, seatId: null }],
        comments.value,
      )
    } else if (formKind.value === 'time_off') {
      const daysSel = dayPicks.value.filter((d) => d.checked)
      if (daysSel.length === 0) {
        err = 'Select at least one day.'
      } else {
        err = await sched.createTimeOffRequests(
          offType.value,
          daysSel.map((d) => ({
            dateIso: d.shift.dateIso,
            from: d.editing ? d.from : '06:00',
            until: d.editing ? d.until : '06:00',
            seatId: d.shift.seatId,
          })),
          comments.value,
        )
      }
    } else if (formKind.value === 'extra_hours') {
      if (hourWarn.value === null) {
        const me = sched.myUserId.value
        if (me) {
          const info = await sched.hoursCheckWindow(me, exDate.value, exFrom.value, exUntil.value, 'You')
          if (info.warnings.length > 0) {
            hourWarn.value = info.warnings
            awaitingAck = true
          }
        }
        if (!awaitingAck) hourWarn.value = []
      }
      if (!awaitingAck) {
        err = await sched.createExtraRequest({
          dateIso: exDate.value,
          from: exFrom.value,
          until: exUntil.value,
          unitId: exUnit.value || null,
          positionLabel: exPosition.value,
          timeType: exTimeType.value,
          comments: comments.value,
          warnings: hourWarn.value ?? [],
        })
      }
    }
  } finally {
    formBusy.value = false
  }
  if (awaitingAck) return
  if (err) {
    formError.value = err
    return
  }
  formDone.value = 'Request submitted — it stays pending until it is approved.'
  formKind.value = ''
}

// ── lists ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  time_off: 'Time off',
  extra_hours: 'Extra hours',
  pickup: 'Shift pickup',
  trade: 'Trade',
  giveaway: 'Giveaway',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  partner_accepted: 'Awaiting approval',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
}

function requestLine(r: SchedRequest): string {
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
  if (r.offType) bits.push(OFF_TYPES.find(([v]) => v === r.offType)?.[1] ?? r.offType)
  if (r.timeType && r.type === 'extra_hours') {
    bits.push(
      r.timeType === 'event'
        ? 'Special Event'
        : r.timeType.charAt(0).toUpperCase() + r.timeType.slice(1),
    )
  }
  return bits.join(' · ')
}

function requesterName(r: SchedRequest): string {
  return sched.personById.value.get(r.requesterId)?.fullName ?? 'Unknown'
}

const myRequests = computed(() =>
  sched.requests.value.filter((r) => r.requesterId === sched.myUserId.value),
)

/* ACTIONABLE queue only: trades/giveaways don't belong here until both
   members have agreed (partner_accepted) — a still-pending swap showed
   an Approve button on day 1 and confused the flow. Those wait in the
   "in negotiation" strip below instead. */
const pendingQueue = computed(() =>
  sched.requests.value.filter(
    (r) =>
      r.status === 'partner_accepted' ||
      (r.status === 'pending' && r.type !== 'trade' && r.type !== 'giveaway'),
  ),
)

/** Trades/giveaways the members are still working out — context only. */
const negotiating = computed(() =>
  sched.requests.value.filter(
    (r) => (r.type === 'trade' || r.type === 'giveaway') && r.status === 'pending',
  ),
)

function negotiatingLine(r: SchedRequest): string {
  const target = r.counterpartyId
    ? `sent to ${sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown'}`
    : 'on the public board'
  return `${requesterName(r)} — ${requestLine(r)} · ${target}`
}

// ── swap detail + pay-period check (Chief's full picture) ────────────

function fmtD(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function seatTitleOf(seatId: string | null): string {
  const seat = sched.seats.value.find((s) => s.id === seatId)
  const unit = sched.units.value.find((u) => u.id === seat?.unitId)
  return `${unit?.code ?? ''} ${seat?.label ?? ''}`.trim()
}

/** Both sides of an agreed swap/giveaway, spelled out for the queue. */
function swapLines(r: SchedRequest): string[] {
  if ((r.type !== 'trade' && r.type !== 'giveaway') || !r.counterpartyId) return []
  const partner = sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Partner'
  const lines = [`${requesterName(r)} gives: ${requestLine(r)}`]
  if (r.type === 'trade' && r.counterWorkDate) {
    const bits: string[] = [fmtD(r.counterWorkDate)]
    if (r.counterStartAt && r.counterEndAt)
      bits.push(`${hhmm(r.counterStartAt)} – ${hhmm(r.counterEndAt)}`)
    const st = seatTitleOf(r.counterSeatId)
    if (st) bits.push(st)
    lines.push(`${partner} gives: ${bits.join(' · ')}`)
  } else if (r.type === 'giveaway') {
    lines.push(`${partner} takes the shift (giveaway — nothing back)`)
  }
  return lines
}

/** Same-pay-period preference: flag crossers; Chief can still approve. */
function crossesPayPeriods(r: SchedRequest): boolean {
  return (
    r.type === 'trade' &&
    !!r.workDate &&
    !!r.counterWorkDate &&
    payPeriodFor(r.workDate).start !== payPeriodFor(r.counterWorkDate).start
  )
}

function periodPair(r: SchedRequest): string {
  if (!r.workDate || !r.counterWorkDate) return ''
  return `${payPeriodFor(r.workDate).label} ⇄ ${payPeriodFor(r.counterWorkDate).label}`
}

/* A 26-deep queue shouldn't bury the page — show the first few, expand
   on demand. */
/* Workbench toolbar (redesign 2026-09-23): search, type filter with
   counts, and sort — warnings float first by default. */
const qFilter = ref('')
const qType = ref<'all' | 'time_off' | 'pickup' | 'extra_hours' | 'swap'>('all')
const qSort = ref<'attention' | 'oldest' | 'shift'>('attention')

const typeCounts = computed(() => {
  const c = { all: pendingQueue.value.length, time_off: 0, pickup: 0, extra_hours: 0, swap: 0 }
  for (const r of pendingQueue.value) {
    if (r.type === 'time_off') c.time_off++
    else if (r.type === 'pickup') c.pickup++
    else if (r.type === 'extra_hours') c.extra_hours++
    else c.swap++
  }
  return c
})

function needsAttention(r: SchedRequest): boolean {
  return cardChips(r).length > 0 || crossesPayPeriods(r)
}

const visibleQueue = computed(() => {
  const q = qFilter.value.trim().toLowerCase()
  const list = pendingQueue.value.filter((r) => {
    if (qType.value === 'time_off' && r.type !== 'time_off') return false
    if (qType.value === 'pickup' && r.type !== 'pickup') return false
    if (qType.value === 'extra_hours' && r.type !== 'extra_hours') return false
    if (qType.value === 'swap' && r.type !== 'trade' && r.type !== 'giveaway') return false
    if (q && !requesterName(r).toLowerCase().includes(q)) return false
    return true
  })
  const sorted = [...list]
  if (qSort.value === 'attention') {
    sorted.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.createdAt.localeCompare(b.createdAt))
  } else if (qSort.value === 'oldest') {
    sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } else {
    sorted.sort((a, b) => (a.workDate ?? '9999').localeCompare(b.workDate ?? '9999'))
  }
  return sorted
})

/** Collapsed rows show one line; the chevron opens the rest. */
const openReq = ref<string | null>(null)
function toggleReq(id: string) {
  openReq.value = openReq.value === id ? null : id
}
function rowOpen(r: SchedRequest): boolean {
  return openReq.value === r.id || confirmApprove.value === r.id || editTimesFor.value === r.id
}
function requestSummary(r: SchedRequest): string {
  if (r.type === 'trade' && r.counterWorkDate) return `${requestLine(r)} ⇄ ${fmtD(r.counterWorkDate)}`
  return requestLine(r)
}

function waitingAge(r: SchedRequest): string {
  const h = (Date.now() - Date.parse(r.createdAt)) / 3600e3
  if (h < 1) return 'now'
  if (h < 24) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// ── inline time edit on a pending card (editors) ─────────────────────

const editTimesFor = ref<string | null>(null)
const editFrom = ref('06:00')
const editUntil = ref('06:00')

function canRetime(r: SchedRequest): boolean {
  return (
    r.status === 'pending' &&
    !!r.workDate &&
    (r.type === 'time_off' || r.type === 'extra_hours' || r.type === 'pickup')
  )
}

function hmInput(ts: string): string {
  const s = hhmm(ts)
  return `${s.slice(0, 2)}:${s.slice(2)}`
}

function startEditTimes(r: SchedRequest) {
  editTimesFor.value = r.id
  editFrom.value = r.startAt ? hmInput(r.startAt) : '06:00'
  editUntil.value = r.endAt ? hmInput(r.endAt) : '06:00'
}

async function saveEditTimes(r: SchedRequest) {
  busyId.value = r.id
  decideError.value = null
  const e = await sched.updateRequestWindow(r, editFrom.value, editUntil.value)
  busyId.value = null
  if (e) {
    decideError.value = e
    return
  }
  editTimesFor.value = null
}

// ── decision history (editors): what was decided, by whom — and undo ─

const decided = computed(() =>
  sched.requests.value
    .filter((r) => r.status === 'approved' || r.status === 'denied' || r.status === 'cancelled')
    .slice()
    .sort((a, b) =>
      String(b.decidedAt ?? b.createdAt ?? '').localeCompare(String(a.decidedAt ?? a.createdAt ?? '')),
    ),
)
const showHistory = ref(false)
const HISTORY_PREVIEW = 15
const showAllHistory = ref(false)
const visibleHistory = computed(() =>
  showAllHistory.value ? decided.value : decided.value.slice(0, HISTORY_PREVIEW),
)

function decidedLine(r: SchedRequest): string {
  const by = r.decidedBy ? (sched.personById.value.get(r.decidedBy)?.fullName ?? 'admin') : null
  const at = r.decidedAt
    ? new Date(r.decidedAt as string).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      })
    : null
  return [by ? `by ${by}` : null, at].filter(Boolean).join(' · ')
}

const reopenArm = ref<string | null>(null)

async function reopen(r: SchedRequest) {
  if (reopenArm.value !== r.id) {
    reopenArm.value = r.id
    return
  }
  reopenArm.value = null
  busyId.value = r.id
  decideError.value = null
  const e = await sched.reopenRequest(r)
  busyId.value = null
  if (e) decideError.value = e
}

// ── hours context for the approval queue ─────────────────────────────

/** Warnings stored on a request at submit/accept time. */
function reqWarnings(r: SchedRequest): HoursWarning[] {
  return (r.warnings as HoursWarning[]).filter(
    (w) => w && typeof w === 'object' && 'code' in w && 'message' in w,
  )
}

function chipText(w: HoursWarning): string {
  if (w.code === 'consecutive' || w.code === 'consecutive_confirm') return `${w.hours}h consecutive`
  if (w.code === 'weekly') return `${w.hours}h week`
  if (w.code === 'ot') return 'Overtime'
  return 'Hours unverified'
}

interface CardHours {
  lines: string[]
  warnings: HoursWarning[]
}

/** Live would-be hours for whoever GAINS time if the request is approved,
 *  recomputed when the queue loads so stale submit-time numbers don't
 *  decide anything. */
const cardHours = ref<Record<string, CardHours>>({})

async function computeCardHours() {
  if (!sched.canEdit.value) return
  const queue = pendingQueue.value
  const results = await Promise.all(
    queue.map(async (r) => {
      const subs: { userId: string; dateIso: string; startAt: string; endAt: string; name: string }[] = []
      if ((r.type === 'pickup' || r.type === 'extra_hours') && r.workDate && r.startAt && r.endAt) {
        subs.push({ userId: r.requesterId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name: requesterName(r) })
      } else if (r.type === 'giveaway' && r.counterpartyId && r.workDate && r.startAt && r.endAt) {
        const name = sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Claimant'
        subs.push({ userId: r.counterpartyId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name })
      } else if (r.type === 'trade') {
        if (r.counterpartyId && r.workDate && r.startAt && r.endAt) {
          const name = sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Partner'
          subs.push({ userId: r.counterpartyId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name })
        }
        if (r.counterpartyId && r.counterWorkDate && r.counterStartAt && r.counterEndAt) {
          subs.push({
            userId: r.requesterId,
            dateIso: r.counterWorkDate,
            startAt: r.counterStartAt,
            endAt: r.counterEndAt,
            name: requesterName(r),
          })
        }
      }
      if (subs.length === 0) return null
      const lines: string[] = []
      const warnings: HoursWarning[] = []
      for (const s of subs) {
        const info = await sched.hoursCheck(
          s.userId,
          [{ dateIso: s.dateIso, startAt: s.startAt, endAt: s.endAt }],
          s.name,
        )
        lines.push(
          `${s.name}: ${info.weekHours}h week · ${info.periodHours}h period · ${info.consecutiveHours}h consecutive`,
        )
        warnings.push(...info.warnings)
      }
      return [r.id, { lines, warnings }] as const
    }),
  )
  const out: Record<string, CardHours> = {}
  for (const entry of results) {
    if (entry) out[entry[0]] = entry[1]
  }
  cardHours.value = out
}

watch(pendingQueue, () => void computeCardHours(), { immediate: true })

/** Chips shown on a Chief card: live warnings win over stored ones. */
function cardChips(r: SchedRequest): HoursWarning[] {
  const live = cardHours.value[r.id]?.warnings ?? []
  const stored = reqWarnings(r)
  const seen = new Set(live.map((w) => w.code))
  return [...live, ...stored.filter((w) => !seen.has(w.code))]
}

const busyId = ref<string | null>(null)
const decideError = ref<string | null>(null)
const confirmApprove = ref<string | null>(null)

function approveClicked(r: SchedRequest) {
  openReq.value = r.id

  const chips = cardChips(r)
  const needsConfirm = chips.some(
    (w) => w.code === 'consecutive_confirm' || w.code === 'check_failed',
  )
  if (needsConfirm && confirmApprove.value !== r.id) {
    confirmApprove.value = r.id
    return
  }
  confirmApprove.value = null
  void decide(r, true)
}

async function decide(r: SchedRequest, approve: boolean) {
  decideError.value = null
  busyId.value = r.id
  const err = await sched.decideRequest(r, approve, '')
  busyId.value = null
  if (err) decideError.value = err
}

async function cancel(r: SchedRequest) {
  busyId.value = r.id
  const err = await sched.cancelRequest(r.id)
  busyId.value = null
  if (err) decideError.value = err
}
</script>

<template>
  <div class="rq">
    <ScheduleSpinner v-if="!ready" label="Loading requests…" />
    <template v-else>
    <!-- Editors see a work queue; the request form is for the crew
         (and supervisors), who file their own. -->
    <section v-if="!sched.canEdit.value" class="rq__section">
      <h2 class="rq__h">New request</h2>
      <div class="rq__kinds">
        <button
          v-for="[k, label] in ([['time_off', 'Time off'], ['extra_hours', 'Extra hours']] as const)"
          :key="k"
          class="rq__kind"
          :class="{ 'rq__kind--on': formKind === k }"
          @click="pickForm(formKind === k ? '' : k)"
        >
          {{ label }}
        </button>
        <span class="rq__muted">To pick up an open shift, click it on the calendar. Giveaways and swaps live on the Trades tab.</span>
      </div>

      <p v-if="formDone" class="rq__done">{{ formDone }}</p>
      <p v-if="formError" class="rq__error">{{ formError }}</p>

      <form v-if="formKind" class="rq__form" @submit.prevent="submit">
        <template v-if="formKind === 'time_off'">
          <div class="rq__kinds">
            <button
              v-for="[m, label] in ([['shifts', 'From my scheduled shifts'], ['custom', 'Custom date'], ['unavailable', 'Mark a day off unavailable']] as const)"
              :key="m"
              type="button"
              class="rq__kind"
              :class="{ 'rq__kind--on': offMode === m }"
              @click="offMode = m"
            >
              {{ label }}
            </button>
          </div>

          <template v-if="offMode === 'unavailable'">
            <p class="rq__muted">
              Protects a rotation day off — saved instantly, no approval. The Chief sees a
              warning before scheduling you on that day.
            </p>
            <div class="rq__grid">
              <label class="rq__field">
                <span class="rq__label">Date</span>
                <input v-model="unavailDate" type="date" class="rq__input" />
              </label>
              <label class="rq__field">
                <span class="rq__label">Reason (optional)</span>
                <input v-model="unavailReason" type="text" class="rq__input" />
              </label>
            </div>
            <button type="button" class="rq__submit" :disabled="formBusy" @click="submitUnavailable">
              {{ formBusy ? 'Saving…' : 'Mark unavailable' }}
            </button>
            <div v-if="myUnavailable.length" class="rq__unavail">
              <p class="rq__label">Your unavailable days</p>
              <div v-for="a in myUnavailable" :key="a.id" class="rq__day rq__day--flex">
                <span>{{ new Date(a.onDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}<span v-if="a.reason" class="rq__muted"> · {{ a.reason }}</span></span>
                <button type="button" class="rq__minor" @click="removeUnavailable(a.id)">Remove</button>
              </div>
            </div>
          </template>

          <template v-else-if="offMode === 'custom'">
            <label class="rq__field">
              <span class="rq__label">Type</span>
              <select v-model="offType" class="rq__input">
                <option v-for="[v, label] in OFF_TYPES" :key="v" :value="v">{{ label }}</option>
              </select>
            </label>
            <div class="rq__grid">
              <label class="rq__field">
                <span class="rq__label">Date</span>
                <input v-model="customDate" type="date" class="rq__input" />
              </label>
              <label class="rq__field">
                <span class="rq__label">From</span>
                <TimeSelect24 v-model="customFrom" class="rq__input" />
              </label>
              <label class="rq__field">
                <span class="rq__label">Until</span>
                <TimeSelect24 v-model="customUntil" class="rq__input" />
              </label>
            </div>
          </template>

          <template v-else>
          <label class="rq__field">
            <span class="rq__label">Type</span>
            <select v-model="offType" class="rq__input">
              <option v-for="[v, label] in OFF_TYPES" :key="v" :value="v">{{ label }}</option>
            </select>
          </label>

          <p class="rq__label">Your upcoming shifts — pick the days</p>
          <p v-if="dayPicks.length === 0" class="rq__muted">
            No scheduled shifts found in the next 45 days.
          </p>
          <div v-for="d in dayPicks" :key="d.shift.dateIso + d.shift.seatId" class="rq__day">
            <label class="rq__day-main">
              <input v-model="d.checked" type="checkbox" />
              <span>
                {{ new Date(d.shift.dateIso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }}
                <span class="rq__muted">· {{ d.shift.unitCode }} {{ d.shift.seatLabel }} · 0600 – 0600</span>
              </span>
            </label>
            <button
              v-if="d.checked"
              type="button"
              class="rq__minor"
              @click="d.editing = !d.editing"
            >
              {{ d.editing ? 'Full shift' : 'Edit time' }}
            </button>
            <div v-if="d.checked && d.editing" class="rq__times">
              <label>From <TimeSelect24 v-model="d.from" class="rq__input rq__input--time" /></label>
              <label>Until <TimeSelect24 v-model="d.until" class="rq__input rq__input--time" /></label>
            </div>
          </div>
          </template>
        </template>

        <template v-else-if="formKind === 'extra_hours'">
          <div class="rq__grid">
            <label class="rq__field">
              <span class="rq__label">Date</span>
              <input v-model="exDate" type="date" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">From</span>
              <TimeSelect24 v-model="exFrom" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">Until</span>
              <TimeSelect24 v-model="exUntil" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">Unit</span>
              <select v-model="exUnit" class="rq__input">
                <option value="">—</option>
                <option v-for="u in sched.units.value.filter((x) => x.active)" :key="u.id" :value="u.id">{{ u.code }}</option>
              </select>
            </label>
            <label class="rq__field">
              <span class="rq__label">Position</span>
              <input v-model="exPosition" type="text" class="rq__input" placeholder="Paramedic" />
            </label>
            <label class="rq__field">
              <span class="rq__label">Time type</span>
              <select v-model="exTimeType" class="rq__input">
                <option value="regular">Regular</option>
                <option value="instructor">Instructor</option>
                <option value="meeting">Meeting</option>
                <option value="event">Special Event</option>
              </select>
            </label>
          </div>
        </template>

        <template v-if="formKind !== 'time_off' || offMode !== 'unavailable'">
          <label class="rq__field">
            <span class="rq__label">Comments</span>
            <input
              v-model="comments"
              type="text"
              class="rq__input"
              placeholder="Optional — e.g. late call run number"
            />
          </label>

          <div v-if="hourWarn && hourWarn.length" class="rq__warnbox">
            <p class="rq__warnhead">Before you submit:</p>
            <ul class="rq__warnlist">
              <li v-for="(w, i) in hourWarn" :key="i">{{ w.message }}</li>
            </ul>
          </div>

          <button type="submit" class="rq__submit" :disabled="formBusy">
            {{
              formBusy
                ? 'Submitting…'
                : hourWarn && hourWarn.length
                  ? hourWarnConfirm
                    ? 'I understand — request admin approval'
                    : 'Submit anyway'
                  : 'Submit request'
            }}
          </button>
        </template>
      </form>
    </section>

    <section v-if="sched.canEdit.value" class="rq__section">
      <h2 class="rq__h">Pending approval</h2>
      <p v-if="decideError" class="rq__error">{{ decideError }}</p>
      <p v-if="pendingQueue.length === 0" class="rq__muted">Nothing waiting.</p>
      <div v-if="pendingQueue.length > 0" class="rq__tabs" role="tablist">
        <button class="rq__tab" :class="{ 'rq__tab--on': qType === 'all' }" @click="qType = 'all'">All <i>{{ typeCounts.all }}</i></button>
        <button v-if="typeCounts.time_off" class="rq__tab" :class="{ 'rq__tab--on': qType === 'time_off' }" @click="qType = 'time_off'">Time off <i>{{ typeCounts.time_off }}</i></button>
        <button v-if="typeCounts.pickup" class="rq__tab" :class="{ 'rq__tab--on': qType === 'pickup' }" @click="qType = 'pickup'">Pickups <i>{{ typeCounts.pickup }}</i></button>
        <button v-if="typeCounts.extra_hours" class="rq__tab" :class="{ 'rq__tab--on': qType === 'extra_hours' }" @click="qType = 'extra_hours'">Extra hours <i>{{ typeCounts.extra_hours }}</i></button>
        <button v-if="typeCounts.swap" class="rq__tab" :class="{ 'rq__tab--on': qType === 'swap' }" @click="qType = 'swap'">Trades <i>{{ typeCounts.swap }}</i></button>
      </div>
      <div v-if="pendingQueue.length > 0" class="rq__filterrow">
        <input v-model="qFilter" type="search" class="rq__search" placeholder="Search people…" aria-label="Search requests by person" />
        <select v-model="qSort" class="rq__sort" aria-label="Sort pending requests">
          <option value="attention">Sort: needs attention</option>
          <option value="oldest">Sort: oldest first</option>
          <option value="shift">Sort: shift date</option>
        </select>
      </div>
      <p v-if="pendingQueue.length > 0 && visibleQueue.length === 0" class="rq__muted">No pending requests match.</p>
      <table v-if="visibleQueue.length > 0" class="rq__table">
        <thead>
          <tr>
            <th class="rq__thchev"></th>
            <th>Request</th>
            <th>Shift</th>
            <th>Flags</th>
            <th class="rq__thage">Waiting</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in visibleQueue" :key="r.id">
            <tr class="rq__row" :class="{ 'rq__row--att': needsAttention(r), 'rq__row--open': rowOpen(r) }">
              <td class="rq__chevcell">
                <button class="rq__chev" :class="{ 'rq__chev--open': rowOpen(r) }" :aria-expanded="rowOpen(r)" aria-label="Show detail" @click="toggleReq(r.id)">▸</button>
              </td>
              <td class="rq__reqcell" @click="toggleReq(r.id)">
                <b>{{ TYPE_LABELS[r.type] }}</b> — {{ requesterName(r) }}<template v-if="r.counterpartyId">
                  ⇄ {{ sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown' }}</template>
              </td>
              <td class="rq__shiftcell" @click="toggleReq(r.id)">{{ requestSummary(r) }}</td>
              <td class="rq__flagcell">
                <span v-if="crossesPayPeriods(r)" class="rq__chip" data-code="period" :title="`Swap crosses pay periods: ${periodPair(r)} — your call.`">Crosses pay periods</span>
                <span v-for="(w, i) in cardChips(r)" :key="i" class="rq__chip" :data-code="w.code" :title="w.message">{{ chipText(w) }}</span>
              </td>
              <td class="rq__agecell" :title="'Submitted ' + new Date(r.createdAt).toLocaleString()">{{ waitingAge(r) }}</td>
              <td class="rq__actcell">
                <button class="rq__btn rq__btn--approve" :disabled="busyId === r.id" @click="approveClicked(r)">
                  {{ confirmApprove === r.id ? 'Approve anyway' : 'Approve' }}
                </button>
                <button v-if="confirmApprove === r.id" class="rq__btn" @click="confirmApprove = null">Back</button>
                <button v-else class="rq__btn rq__btn--deny" :disabled="busyId === r.id" @click="decide(r, false)">Deny</button>
              </td>
            </tr>
            <tr v-if="rowOpen(r)" class="rq__detailrow">
              <td></td>
              <td colspan="5">
                <template v-if="swapLines(r).length">
                  <p v-for="(line, i) in swapLines(r)" :key="'sw' + i" class="rq__card-line">{{ line }}</p>
                </template>
                <p v-else class="rq__card-line">{{ requestLine(r) }}</p>
                <p v-for="(line, i) in cardHours[r.id]?.lines ?? []" :key="i" class="rq__hoursline">{{ line }}</p>
                <p v-if="r.comments" class="rq__card-comments">"{{ r.comments }}"</p>
                <p v-if="confirmApprove === r.id" class="rq__confirmnote">
                  This crosses an hour threshold that needs admin sign-off — approve anyway?
                </p>
                <div v-if="editTimesFor === r.id" class="rq__edittimes">
                  <label>From <TimeSelect24 v-model="editFrom" class="rq__input rq__input--time" /></label>
                  <label>Until <TimeSelect24 v-model="editUntil" class="rq__input rq__input--time" /></label>
                  <button class="rq__btn rq__btn--approve" :disabled="busyId === r.id" @click="saveEditTimes(r)">Save times</button>
                  <button class="rq__btn" @click="editTimesFor = null">Cancel</button>
                </div>
                <button v-else-if="canRetime(r)" class="rq__btn rq__btn--ghostline" @click="startEditTimes(r)">Edit times</button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>


      <template v-if="negotiating.length > 0">
        <h3 class="rq__subh">
          In negotiation on the Trades board ({{ negotiating.length }}) — not ready for approval
        </h3>
        <p v-for="r in negotiating" :key="r.id" class="rq__negline">
          {{ negotiatingLine(r) }}
        </p>
        <p class="rq__muted">These appear up top for approval once both members agree.</p>
      </template>
    </section>

    <section v-if="sched.canEdit.value" class="rq__section">
      <div class="rq__histhead">
        <h2 class="rq__h">Decision history</h2>
        <button class="rq__btn" @click="showHistory = !showHistory">
          {{ showHistory ? 'Hide' : `Show (${decided.length})` }}
        </button>
      </div>
      <template v-if="showHistory">
        <p v-if="decided.length === 0" class="rq__muted">No decided requests yet.</p>
        <div v-for="r in visibleHistory" :key="r.id" class="rq__card rq__card--hist">
          <div class="rq__card-main">
            <p class="rq__card-title">
              {{ TYPE_LABELS[r.type] }} — {{ requesterName(r) }}<template v-if="r.counterpartyId">
                → {{ sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown' }}</template>
            </p>
            <template v-if="swapLines(r).length">
              <p v-for="(line, i) in swapLines(r)" :key="'sw' + i" class="rq__card-line">{{ line }}</p>
            </template>
            <p v-else class="rq__card-line">{{ requestLine(r) }}</p>
            <p class="rq__histmeta">
              <span class="rq__status" :data-status="r.status">{{ STATUS_LABELS[r.status] }}</span>
              <span v-if="decidedLine(r)" class="rq__muted">{{ decidedLine(r) }}</span>
            </p>
            <p v-if="r.decisionNote" class="rq__card-comments">"{{ r.decisionNote }}"</p>
            <p v-if="reopenArm === r.id" class="rq__confirmnote">
              {{
                r.status === 'approved'
                  ? 'Reopening removes what this approval wrote on the calendar and puts the request back in the queue — double-check the day afterward.'
                  : 'Puts this request back in the pending queue to re-decide.'
              }}
            </p>
          </div>
          <div class="rq__card-actions">
            <button class="rq__btn" :disabled="busyId === r.id" @click="reopen(r)">
              {{ reopenArm === r.id ? 'Really reopen?' : 'Reopen' }}
            </button>
            <button v-if="reopenArm === r.id" class="rq__btn" @click="reopenArm = null">Back</button>
          </div>
        </div>
        <button
          v-if="decided.length > HISTORY_PREVIEW"
          class="rq__btn rq__expander"
          @click="showAllHistory = !showAllHistory"
        >
          {{ showAllHistory ? 'Show fewer' : `Show all ${decided.length}` }}
        </button>
      </template>
    </section>

    <section class="rq__section">
      <h2 class="rq__h">My requests</h2>
      <p v-if="myRequests.length === 0" class="rq__muted">None yet.</p>
      <div v-for="r in myRequests" :key="r.id" class="rq__card">
        <div class="rq__card-main">
          <p class="rq__card-title">{{ TYPE_LABELS[r.type] }}</p>
          <p class="rq__card-line">{{ requestLine(r) }}</p>
          <div v-if="reqWarnings(r).length" class="rq__chips">
            <span
              v-for="(w, i) in reqWarnings(r)"
              :key="i"
              class="rq__chip"
              :data-code="w.code"
              :title="w.message"
            >
              {{ chipText(w) }}
            </span>
          </div>
        </div>
        <div class="rq__card-actions">
          <span class="rq__status" :data-status="r.status">{{ STATUS_LABELS[r.status] }}</span>
          <button
            v-if="r.status === 'pending'"
            class="rq__btn"
            :disabled="busyId === r.id"
            @click="cancel(r)"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
    </template>
  </div>
</template>

<style scoped>
.rq {
  max-width: 980px;
}

/* ── workbench toolbar ─────────────────────────────────────────────── */
.rq__tabs {
  display: flex;
  gap: 18px;
  border-bottom: 1px solid var(--color-line);
  margin: 0 0 10px;
  overflow-x: auto;
  scrollbar-width: none;
}

.rq__tab {
  border: 0;
  background: none;
  padding: 6px 2px 8px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  white-space: nowrap;
}

.rq__tab i {
  font-style: normal;
  font-weight: 600;
  opacity: 0.6;
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}

.rq__tab--on {
  color: var(--color-ink);
  border-bottom-color: var(--color-accent-600);
}

.rq__filterrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0.6rem;
}

.rq__table {
  width: 100%;
  border-collapse: collapse;
}

.rq__table th {
  text-align: left;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
  font-weight: 700;
  padding: 4px 8px 6px;
  border-bottom: 1px solid var(--color-line);
}

.rq__table th.rq__thage {
  text-align: right;
}

.rq__table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.82rem;
  vertical-align: middle;
}

.rq__row:hover td {
  background: var(--color-surface);
}

.rq__row--att td:first-child {
  box-shadow: inset 2.5px 0 0 var(--color-danger-500);
}

.rq__row--open td {
  border-bottom-color: transparent;
}

.rq__chevcell {
  width: 26px;
  padding-right: 0;
}

.rq__chev {
  border: 0;
  background: none;
  color: var(--color-muted);
  font-size: 0.68rem;
  cursor: pointer;
  padding: 2px 4px;
  transition: transform 0.12s;
  display: inline-block;
}

.rq__chev--open {
  transform: rotate(90deg);
}

.rq__reqcell,
.rq__shiftcell {
  cursor: pointer;
}

.rq__reqcell b {
  font-weight: 650;
}

.rq__shiftcell {
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.rq__agecell {
  text-align: right;
  color: var(--color-muted);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rq__actcell {
  text-align: right;
  white-space: nowrap;
}

.rq__detailrow td {
  padding-top: 0;
  background: var(--color-surface);
}

.rq__btn--ghostline {
  margin-top: 0.35rem;
}

.rq__toolbar {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
}

.rq__search {
  flex: 0 1 220px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
  font: inherit;
  font-size: 0.8rem;
  padding: 0.4rem 0.65rem;
}

.rq__fchip {
  border: 1px solid var(--color-line);
  background: none;
  color: var(--color-muted);
  border-radius: 999px;
  padding: 0.28rem 0.7rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}

.rq__fchip i {
  font-style: normal;
  opacity: 0.65;
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}

.rq__fchip--on {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: #fff;
}

.rq__sort {
  margin-left: auto;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  border-radius: 8px;
  font: inherit;
  font-size: 0.76rem;
  padding: 0.35rem 0.55rem;
}

.rq__age {
  font-size: 0.72rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 2px;
}

.rq__section {
  margin-bottom: 1.8rem;
}

.rq__h {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--color-brand-800);
  margin: 0 0 0.6rem;
}

.rq__histhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.rq__histmeta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
}

.rq__card--hist .rq__card-title {
  font-size: 0.88rem;
}

.rq__edittimes {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
  font-size: 0.8rem;
  color: var(--color-muted);
}

.rq__expander {
  display: block;
  margin-top: 0.2rem;
}

.rq__kinds {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
}

.rq__kind {
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.rq__kind--on {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.rq__form {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  box-shadow: var(--shadow-sm);
}

.rq__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.6rem;
}

.rq__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rq__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0;
}

.rq__input {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.38rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.rq__input--time {
  width: 110px;
}

.rq__day {
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0.35rem 0;
}

.rq__day:last-of-type {
  border-bottom: 0;
}

.rq__day--flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.86rem;
  color: var(--color-ink);
}

.rq__unavail {
  margin-top: 0.3rem;
}

.rq__day-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.rq__minor {
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-brand-600);
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0.15rem 0;
  margin-left: 1.6rem;
}

.rq__times {
  display: flex;
  gap: 0.8rem;
  margin: 0.3rem 0 0.2rem 1.6rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  align-items: center;
}

.rq__submit {
  align-self: flex-start;
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.45rem 1.1rem;
  border: 0;
  border-radius: 8px;
  background: var(--color-brand-700);
  color: white;
  cursor: pointer;
}

.rq__submit:disabled {
  opacity: 0.6;
}

.rq__done {
  color: var(--color-success-500);
  font-size: 0.85rem;
}

.rq__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.rq__muted {
  color: var(--color-muted);
  font-size: 0.85rem;
}

.rq__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  border-radius: 0;
  background: transparent;
  padding: 0.55rem 0.35rem;
  margin-bottom: 0;
}

.rq__card:hover {
  background: var(--color-surface);
}

.rq__card--att {
  box-shadow: inset 2.5px 0 0 var(--color-danger-500);
  padding-left: 0.6rem;
}

.rq__card-main {
  min-width: 0;
}

.rq__card-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0;
}

.rq__card-line {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0.1rem 0 0;
  font-variant-numeric: tabular-nums;
}

.rq__card-comments {
  font-size: 0.8rem;
  color: var(--color-ink-soft);
  margin: 0.15rem 0 0;
}

.rq__card-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: none;
}

.rq__btn {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.rq__btn--approve {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.rq__btn--deny {
  color: var(--color-danger-500);
}

.rq__status {
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 9px;
  color: var(--color-muted);
}

.rq__status[data-status='approved'] {
  color: var(--color-success-500);
}

.rq__status[data-status='denied'] {
  color: var(--color-danger-500);
}

.rq__status[data-status='pending'] {
  color: var(--color-warning-500);
}

.rq__warnbox {
  border: 1px solid oklch(0.85 0.08 60);
  background: var(--color-warning-50);
  border-radius: 9px;
  padding: 0.5rem 0.7rem;
}

.rq__warnhead {
  font-size: 0.78rem;
  font-weight: 700;
  color: oklch(0.45 0.12 60);
  margin: 0 0 0.25rem;
}

.rq__warnlist {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rq__hoursline {
  font-size: 0.76rem;
  color: var(--color-ink-soft);
  margin: 0.15rem 0 0;
  font-variant-numeric: tabular-nums;
}

.rq__chips {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-top: 0.25rem;
}

.rq__chip {
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 2px 8px;
  border: 1px solid oklch(0.85 0.08 60);
  background: var(--color-warning-50);
  color: oklch(0.45 0.12 60);
  cursor: help;
  white-space: nowrap;
}

.rq__chip[data-code='consecutive_confirm'],
.rq__chip[data-code='check_failed'] {
  border-color: oklch(0.8 0.1 27);
  background: oklch(0.97 0.02 27);
  color: var(--color-danger-500);
}

.rq__chip[data-code='ot'] {
  border-color: var(--color-line);
  background: var(--color-surface-soft);
  color: var(--color-muted);
}

.rq__chip[data-code='period'] {
  border-color: oklch(0.8 0.06 262);
  background: oklch(0.96 0.02 262);
  color: oklch(0.42 0.12 262);
}

.rq__subh {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 1rem 0 0.35rem;
}

.rq__negline {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0.15rem 0;
  padding-left: 0.6rem;
  border-left: 2px solid var(--color-line);
}

.rq__confirmnote {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-danger-500);
  margin: 0.25rem 0 0;
}

@media (max-width: 560px) {
  .rq__card {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Phone: the six-column queue stacks — each request reads as one block
   (chevron pinned left, actions last) instead of scrolling sideways. */
@media (max-width: 700px) {
  .rq__filterrow {
    flex-wrap: wrap;
  }

  .rq__search {
    flex: 1 1 160px;
    min-width: 0;
  }

  .rq__table thead {
    display: none;
  }

  .rq__table,
  .rq__table tbody,
  .rq__table tr,
  .rq__table td {
    display: block;
  }

  .rq__row {
    position: relative;
    padding: 9px 0 11px 26px;
    border-bottom: 1px solid var(--color-line-soft);
  }

  .rq__row td {
    border-bottom: 0;
    padding: 1px 0;
  }

  .rq__chevcell {
    position: absolute;
    left: 0;
    top: 7px;
    width: auto;
    padding: 0;
  }

  .rq__agecell {
    text-align: left;
  }

  .rq__agecell::before {
    content: 'Waiting ';
  }

  .rq__actcell {
    text-align: left;
    padding-top: 7px;
  }

  /* the attention stripe moves from the first cell to the whole row */
  .rq__row--att {
    box-shadow: inset 2.5px 0 0 var(--color-danger-500);
  }

  .rq__row--att td:first-child {
    box-shadow: none;
  }

  .rq__row--open {
    border-bottom: 0;
  }

  .rq__detailrow td:first-child {
    display: none;
  }

  .rq__detailrow td[colspan] {
    padding: 2px 0 12px 26px;
  }
}
</style>
