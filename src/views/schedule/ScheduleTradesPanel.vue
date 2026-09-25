<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import TimeSelect24 from '@/views/schedule/TimeSelect24.vue'
import ScheduleSpinner from './ScheduleSpinner.vue'
import {
  useSchedule,
  todayCentralIso,
  hhmm,
  payPeriodFor,
  type SchedRequest,
  type TradeOffer,
  type UpcomingShift,
  type HoursWarning,
} from '@/composables/useSchedule'

/**
 * Trades board — Aladtec's "Available Trades", but with the swap-offer
 * step built in. Crew post a shift as a giveaway (anyone can claim) or
 * a swap (others offer one of their shifts back). The poster accepts
 * one offer; the deal then lands in the Chief's approval queue, and
 * approval rewrites both calendars.
 */

const sched = useSchedule()

const ready = ref(false)
onMounted(async () => {
  await sched.ensureLoaded()
  await Promise.all([sched.loadRequests(), sched.loadTradeOffers()])
  ready.value = true
})

// ── post a shift ─────────────────────────────────────────────────────

const posting = ref(false)
const postType = ref<'giveaway' | 'trade'>('giveaway')
const postShiftKey = ref('')
const postPartial = ref(false)
const postFrom = ref('06:00')
const postUntil = ref('06:00')
const postComments = ref('')
/* '' = the public board; a user id = sent directly to that member,
   who accepts/declines (or offers a shift back) before the Chief. */
const postTo = ref('')
const busy = ref(false)
const err = ref<string | null>(null)
const done = ref<string | null>(null)

/* people arrives last-name sorted from the store (personSortKey). */
const sendToCandidates = computed(() =>
  sched.people.value.filter((p) => p.id !== sched.myUserId.value),
)

const myShifts = ref<UpcomingShift[]>([])

/* 120 days out — 45 cut Kaleb's November days off the offer list when
   Ashtin's posting was for Nov 27 (day-1 launch bug). */
const SHIFT_HORIZON_DAYS = 120

/** Shifts grouped by month so long lists stay scannable in the select. */
const myShiftGroups = computed(() => {
  const groups: { label: string; items: UpcomingShift[] }[] = []
  for (const s of myShifts.value) {
    const label = new Date(`${s.dateIso}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  return groups
})

function openPost() {
  posting.value = !posting.value
  err.value = done.value = null
  if (posting.value) {
    const me = sched.myUserId.value
    myShifts.value = me ? sched.upcomingShiftsFor(me, todayCentralIso(), SHIFT_HORIZON_DAYS) : []
    postShiftKey.value = myShifts.value[0] ? shiftKey(myShifts.value[0]) : ''
  }
}

function shiftKey(s: UpcomingShift): string {
  return `${s.dateIso}|${s.seatId}`
}

function shiftLabel(s: UpcomingShift): string {
  return `${fmtDate(s.dateIso)} · ${s.unitCode} ${s.seatLabel}`
}

async function submitPost() {
  const sel = myShifts.value.find((s) => shiftKey(s) === postShiftKey.value)
  if (!sel) {
    err.value = 'Pick one of your shifts.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.createTradePosting({
    type: postType.value,
    dateIso: sel.dateIso,
    seatId: sel.seatId,
    from: postPartial.value ? postFrom.value : '06:00',
    until: postPartial.value ? postUntil.value : '06:00',
    comments: postComments.value,
    toUserId: postTo.value || null,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  const toName = postTo.value ? (sched.personById.value.get(postTo.value)?.fullName ?? '') : ''
  posting.value = false
  postComments.value = ''
  postPartial.value = false
  postTo.value = ''
  done.value = toName
    ? `Sent to ${toName} — they'll get a notification to respond.`
    : 'Posted — it is now on the board for the crew.'
}

// ── board ────────────────────────────────────────────────────────────

/* Public postings, plus directed ones the viewer is part of (a request
   sent to one member never shows on everyone else's board). */
const board = computed(() =>
  sched.requests.value.filter(
    (r) =>
      (r.type === 'giveaway' || r.type === 'trade') &&
      r.status === 'pending' &&
      (!r.counterpartyId ||
        r.requesterId === sched.myUserId.value ||
        r.counterpartyId === sched.myUserId.value ||
        sched.canEdit.value),
  ),
)

/** Directed requests waiting on ME — the "Sent to you" inbox. */
const sentToMe = computed(() =>
  board.value.filter(
    (r) => r.counterpartyId === sched.myUserId.value && r.requesterId !== sched.myUserId.value,
  ),
)

function isDirected(r: SchedRequest): boolean {
  return !!r.counterpartyId && r.status === 'pending'
}

function directedToName(r: SchedRequest): string {
  return r.counterpartyId
    ? (sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown')
    : ''
}

async function acceptDirect(r: SchedRequest) {
  busy.value = true
  err.value = null
  if (!(r.id in hourWarnFor.value)) {
    const w = await checkMyHours(r)
    if (w.length > 0) {
      hourWarnFor.value = { ...hourWarnFor.value, [r.id]: w }
      busy.value = false
      return
    }
  }
  const e = await sched.respondToDirect(r, true)
  busy.value = false
  if (e) err.value = e
  else done.value = 'Accepted — sent to the Chief for final approval.'
}

async function declineDirect(r: SchedRequest) {
  busy.value = true
  err.value = null
  const e = await sched.respondToDirect(r, false)
  busy.value = false
  if (e) err.value = e
  else done.value = 'Declined — the poster has been notified.'
}

const awaitingApproval = computed(() =>
  sched.requests.value.filter(
    (r) => (r.type === 'giveaway' || r.type === 'trade') && r.status === 'partner_accepted',
  ),
)

function posterName(r: SchedRequest): string {
  return sched.personById.value.get(r.requesterId)?.fullName ?? 'Unknown'
}

function offerName(o: TradeOffer): string {
  return sched.personById.value.get(o.userId)?.fullName ?? 'Unknown'
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function postingLine(r: SchedRequest): string {
  const bits: string[] = []
  if (r.workDate) bits.push(fmtDate(r.workDate))
  if (r.unitCode) bits.push(`${r.unitCode} ${r.positionLabel ?? ''}`.trim())
  if (r.startAt && r.endAt) bits.push(`${hhmm(r.startAt)} – ${hhmm(r.endAt)}`)
  return bits.join(' · ')
}

function offerShiftLine(o: TradeOffer): string {
  if (!o.offerWorkDate) return 'Claim (no shift offered back)'
  const seat = sched.seats.value.find((s) => s.id === o.offerSeatId)
  const unit = sched.units.value.find((u) => u.id === seat?.unitId)
  const times =
    o.offerStartAt && o.offerEndAt ? ` · ${hhmm(o.offerStartAt)} – ${hhmm(o.offerEndAt)}` : ''
  return `${fmtDate(o.offerWorkDate)} · ${unit?.code ?? ''} ${seat?.label ?? ''}${times}`
}

/* The main list — everything except requests sitting in MY inbox
   (those render in "Sent to you" above, with their own actions). */
const boardRest = computed(() =>
  board.value.filter(
    (r) => !(r.counterpartyId === sched.myUserId.value && r.requesterId !== sched.myUserId.value),
  ),
)

/* Lanes + a status filter (redesign 2026-09-24): the one long scroll
   split into Open board / Sent to you / Your postings. */
const lane = ref<'board' | 'inbox' | 'mine'>('board')
const statusFilter = ref<'all' | 'open' | 'offers' | 'waiting_target'>('all')

/* "Yours" = your postings PLUS postings you've claimed or offered on —
   a claim was invisible once the board scrolled, so the claimer never
   found their Withdraw (Justin, 2026-09-24). */
const myPostings = computed(() =>
  boardRest.value.filter(
    (r) =>
      r.requesterId === sched.myUserId.value ||
      (r.requesterId !== sched.myUserId.value && !!myOfferOn(r)),
  ),
)
/* a posting whose shift already began is dead — claiming it is blocked
   anyway, so keep it off the public board (poster still sees it under
   Yours to withdraw, and the Chief's queue flags it as stale) */
const openBoard = computed(() =>
  boardRest.value.filter(
    (r) =>
      r.requesterId !== sched.myUserId.value &&
      !(r.startAt && Date.parse(r.startAt) <= Date.now()),
  ),
)

function postingStatusKey(r: SchedRequest): string {
  if (isDirected(r) && offersFor(r).length === 0) return 'waiting_target'
  return offersFor(r).length > 0 ? 'offers' : 'open'
}

/* soonest shift first by default — that's the one that needs covering
   (Justin, 2026-09-24) */
const sortSel = ref<'soonest' | 'newest' | 'oldest'>('soonest')

const boardShown = computed(() => {
  const base = lane.value === 'mine' ? myPostings.value : openBoard.value
  const filtered =
    lane.value === 'board' && statusFilter.value !== 'all'
      ? base.filter((r) => postingStatusKey(r) === statusFilter.value)
      : base
  const sorted = [...filtered]
  if (sortSel.value === 'soonest')
    sorted.sort((a, b) => (a.workDate ?? '9999').localeCompare(b.workDate ?? '9999'))
  else if (sortSel.value === 'newest') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  else sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return sorted
})

/* one table serves every lane */
const laneRows = computed(() => (lane.value === 'inbox' ? sentToMe.value : boardShown.value))

/* poster's offer review expands inline under the row */
const reviewFor = ref<string | null>(null)

/** Status cell: what state the posting is in, who it's waiting on, and
 *  how old it is. `you` lights the gold stripe — it needs YOUR move. */
function statusParts(r: SchedRequest): { l1: string; l2: string; you: boolean } {
  const me = sched.myUserId.value
  const age = `posted ${postedAge(r)}`
  if (r.counterpartyId === me && r.requesterId !== me) {
    return { l1: 'Waiting on you', l2: `sent to you · ${age}`, you: true }
  }
  if (isDirected(r) && offersFor(r).length === 0) {
    return { l1: `Waiting on ${directedToName(r)}`, l2: age, you: false }
  }
  const mine = myOfferOn(r)
  if (mine) {
    return { l1: r.type === 'giveaway' ? 'Your claim is in' : 'Your offer is in', l2: age, you: false }
  }
  const n = offersFor(r).length
  if (n > 0) {
    return {
      l1: `${n} offer${n === 1 ? '' : 's'} in${r.requesterId === me ? ' — review' : ''}`,
      l2: age,
      you: r.requesterId === me,
    }
  }
  return { l1: 'Open', l2: age, you: false }
}

/** Awaiting-approval flags: swaps only flag pay-period crossings; a
 *  giveaway adds hours, so its stored hour warnings still show. */
function awaitFlags(r: SchedRequest): string[] {
  if (r.type === 'trade') {
    if (r.workDate && r.counterWorkDate && payPeriodFor(r.workDate).start !== payPeriodFor(r.counterWorkDate).start)
      return ['Crosses pay periods']
    return []
  }
  return reqWarnings(r).map((w) =>
    w.code === 'weekly' ? `${w.hours}h week` : w.code === 'ot' ? 'Overtime' : `${w.hours}h consecutive`,
  )
}

function postedAge(r: SchedRequest): string {
  const h = (Date.now() - Date.parse(r.createdAt)) / 3600e3
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Date-first with detail underneath — the single line wrapped badly. */
function postingParts(r: SchedRequest): { date: string; detail: string } {
  const s = postingLine(r)
  const i = s.indexOf(' · ')
  return i === -1 ? { date: s, detail: '' } : { date: s.slice(0, i), detail: s.slice(i + 3) }
}

function offersFor(r: SchedRequest): TradeOffer[] {
  return sched.tradeOffers.value.filter(
    (o) => o.requestId === r.id && (o.status === 'queued' || o.status === 'accepted'),
  )
}

function myOfferOn(r: SchedRequest): TradeOffer | undefined {
  return sched.tradeOffers.value.find(
    (o) => o.requestId === r.id && o.userId === sched.myUserId.value && o.status === 'queued',
  )
}

// take / offer flows
const offeringOn = ref<string | null>(null)
const offerShiftKey = ref('')
const offerNote = ref('')
/* The offerer picks which part of the offered shift is on the table —
   whole tour by default, or exact times. */
const offerPartial = ref(false)
const offerFrom = ref('06:00')
const offerUntil = ref('06:00')

/* Hour-threshold warnings for taking the POSTED shift: shown once, and
   the second click is the acknowledgment. */
const hourWarnFor = ref<Record<string, HoursWarning[]>>({})

function warnConfirm(list: HoursWarning[]): boolean {
  return list.some((w) => w.code === 'consecutive_confirm')
}

async function checkMyHours(r: SchedRequest): Promise<HoursWarning[]> {
  const me = sched.myUserId.value
  if (!me || !r.workDate || !r.startAt || !r.endAt) return []
  const info = await sched.hoursCheck(
    me,
    [{ dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt }],
    'You',
  )
  return info.warnings
}

function startOffer(r: SchedRequest) {
  err.value = done.value = null
  const me = sched.myUserId.value
  myShifts.value = me ? sched.upcomingShiftsFor(me, todayCentralIso(), SHIFT_HORIZON_DAYS) : []
  offerShiftKey.value = myShifts.value[0] ? shiftKey(myShifts.value[0]) : ''
  offerNote.value = ''
  offerPartial.value = false
  offerFrom.value = '06:00'
  offerUntil.value = '06:00'
  offeringOn.value = r.id
}

async function takeShift(r: SchedRequest) {
  busy.value = true
  err.value = null
  if (!(r.id in hourWarnFor.value)) {
    const w = await checkMyHours(r)
    if (w.length > 0) {
      hourWarnFor.value = { ...hourWarnFor.value, [r.id]: w }
      busy.value = false
      return
    }
  }
  const e = await sched.makeOffer({ requestId: r.id, offerShift: null, note: '' })
  busy.value = false
  if (e) err.value = e
  else done.value = 'Claim placed — the poster and Chief will see it.'
}

async function submitOffer(r: SchedRequest) {
  const sel = myShifts.value.find((s) => shiftKey(s) === offerShiftKey.value)
  if (!sel) {
    err.value = 'Pick one of your shifts to offer.'
    return
  }
  busy.value = true
  err.value = null
  if (!(r.id in hourWarnFor.value)) {
    const w = await checkMyHours(r)
    if (w.length > 0) {
      hourWarnFor.value = { ...hourWarnFor.value, [r.id]: w }
      busy.value = false
      return
    }
  }
  const e = await sched.makeOffer({
    requestId: r.id,
    offerShift: {
      dateIso: sel.dateIso,
      seatId: sel.seatId,
      from: offerPartial.value ? offerFrom.value : '06:00',
      until: offerPartial.value ? offerUntil.value : '06:00',
    },
    note: offerNote.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  offeringOn.value = null
  done.value = 'Swap offer sent to the poster.'
}

/** Warnings stored on a request when the poster accepted the deal. */
function reqWarnings(r: SchedRequest): HoursWarning[] {
  return (r.warnings as HoursWarning[]).filter(
    (w) => w && typeof w === 'object' && 'code' in w && 'message' in w,
  )
}

async function accept(r: SchedRequest, o: TradeOffer) {
  busy.value = true
  err.value = null
  const e = await sched.acceptOffer(r, o)
  busy.value = false
  if (e) err.value = e
  else done.value = 'Accepted — sent to the Chief for final approval.'
}

async function decline(o: TradeOffer) {
  busy.value = true
  const e = await sched.declineOffer(o.id)
  busy.value = false
  if (e) err.value = e
}

/* Two-tap withdraw — a single stray tap silently pulled Kaleb's offer
   while the poster's email still said one was waiting (day-2). */
const withdrawArm = ref<string | null>(null)

async function withdraw(o: TradeOffer) {
  if (withdrawArm.value !== o.id) {
    withdrawArm.value = o.id
    return
  }
  withdrawArm.value = null
  busy.value = true
  const e = await sched.withdrawOffer(o.id)
  busy.value = false
  if (e) err.value = e
  else done.value = 'Offer withdrawn.'
}

async function cancelPosting(r: SchedRequest) {
  busy.value = true
  const e = await sched.cancelRequest(r.id)
  busy.value = false
  if (e) err.value = e
}

/** Swaps are preferred inside one pay period — soft warning only, the
 *  Chief can still approve a crosser. */
function offerCrossesPeriod(r: SchedRequest): boolean {
  const sel = myShifts.value.find((s) => shiftKey(s) === offerShiftKey.value)
  if (!sel || !r.workDate) return false
  return payPeriodFor(sel.dateIso).start !== payPeriodFor(r.workDate).start
}
</script>

<template>
  <div class="tr">
    <ScheduleSpinner v-if="!ready" label="Loading trades…" />
    <template v-else>
    <div class="tr__tabs" role="tablist">
      <button class="tr__tab" :class="{ 'tr__tab--on': lane === 'board' }" @click="lane = 'board'">Open board <i>{{ openBoard.length }}</i></button>
      <button class="tr__tab" :class="{ 'tr__tab--on': lane === 'inbox' }" @click="lane = 'inbox'">Sent to you <i>{{ sentToMe.length }}</i></button>
      <button class="tr__tab" :class="{ 'tr__tab--on': lane === 'mine' }" @click="lane = 'mine'">Yours <i>{{ myPostings.length }}</i></button>
    </div>
    <div class="tr__topbar">
      <select v-if="lane === 'board'" v-model="statusFilter" class="tr__filter" aria-label="Filter postings by status">
        <option value="all">Status: All</option>
        <option value="open">Open — claimable</option>
        <option value="offers">Offers in</option>
        <option value="waiting_target">Waiting on someone</option>
      </select>
      <select v-if="lane !== 'inbox'" v-model="sortSel" class="tr__filter" aria-label="Sort postings">
        <option value="soonest">Sort: soonest shift</option>
        <option value="newest">Newest posted</option>
        <option value="oldest">Oldest posted</option>
      </select>
      <p class="tr__hint">
        Deals you accept still go to the Chief for final approval before the calendar changes.
      </p>
      <button class="tr__post" @click="openPost">
        {{ posting ? 'Close' : 'Post a shift' }}
      </button>
    </div>

    <p v-if="done" class="tr__done">{{ done }}</p>
    <p v-if="err" class="tr__error">{{ err }}</p>

    <form v-if="posting" class="tr__form" @submit.prevent="submitPost">
      <div class="tr__form-grid">
        <label class="tr__field">
          <span class="tr__label">Type</span>
          <select v-model="postType" class="tr__input">
            <option value="giveaway">Give away — anyone can claim</option>
            <option value="trade">Swap — I want a shift in return</option>
          </select>
        </label>
        <label class="tr__field">
          <span class="tr__label">Your shift</span>
          <select v-model="postShiftKey" class="tr__input">
            <option v-if="myShifts.length === 0" value="" disabled>No upcoming shifts found</option>
            <optgroup v-for="g in myShiftGroups" :key="g.label" :label="g.label">
              <option v-for="s in g.items" :key="shiftKey(s)" :value="shiftKey(s)">
                {{ shiftLabel(s) }}
              </option>
            </optgroup>
          </select>
        </label>
      </div>
      <label class="tr__field">
        <span class="tr__label">Send to</span>
        <select v-model="postTo" class="tr__input">
          <option value="">The trade board — anyone can respond</option>
          <option v-for="p in sendToCandidates" :key="p.id" :value="p.id">
            {{ p.fullName }}
          </option>
        </select>
      </label>
      <p v-if="postTo" class="tr__muted tr__muted--sm">
        Already worked it out with them? They'll get a notification to
        {{ postType === 'giveaway' ? 'accept or decline' : 'offer a shift back or decline' }};
        once you both agree it goes to the Chief for final approval.
      </p>
      <label class="tr__check">
        <input v-model="postPartial" type="checkbox" /> Part of the shift only
      </label>
      <div v-if="postPartial" class="tr__times">
        <label>From <TimeSelect24 v-model="postFrom" class="tr__input tr__input--time" /></label>
        <label>Until <TimeSelect24 v-model="postUntil" class="tr__input tr__input--time" /></label>
      </div>
      <label class="tr__field">
        <span class="tr__label">Comments</span>
        <input v-model="postComments" type="text" class="tr__input" placeholder="Optional" />
      </label>
      <button type="submit" class="tr__submit" :disabled="busy">
        {{ busy ? 'Sending…' : postTo ? 'Send the request' : 'Post to the board' }}
      </button>
    </form>

    <!-- ONE table for every lane (approved mock, 2026-09-24):
         TYPE / POSTED BY / SHIFT / STATUS / actions — claim, accept,
         decline, offer and review flows live in the detail row. -->
    <section class="tr__section">
      <p v-if="laneRows.length === 0" class="tr__muted">
        {{ lane === 'inbox' ? 'Nothing waiting on you.' : lane === 'mine' ? 'You have nothing posted or claimed.' : 'Nothing on the board right now.' }}
      </p>
      <table v-else class="tr__table">
        <thead>
          <tr><th>Type</th><th>Posted by</th><th>Shift</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="r in laneRows" :key="r.id">
            <tr class="tr__row" :class="{ 'tr__row--att': statusParts(r).you }">
              <td><span class="tr__typ">{{ r.type === 'giveaway' ? 'Giveaway' : 'Swap' }}</span></td>
              <td class="tr__poster">
                {{ posterName(r) }}<span v-if="r.requesterId === sched.myUserId.value" class="tr__youtag"> (you)</span>
                <span v-if="isDirected(r) && r.counterpartyId !== sched.myUserId.value" class="tr__l2">to {{ directedToName(r) }}</span>
              </td>
              <td>
                <span class="tr__l1">{{ postingParts(r).date }}</span>
                <span v-if="postingParts(r).detail" class="tr__l2">{{ postingParts(r).detail }}</span>
                <span v-if="r.comments" class="tr__l2 tr__cmt">"{{ r.comments }}"</span>
              </td>
              <td>
                <span class="tr__l1" :class="{ 'tr__st--you': statusParts(r).you }">{{ statusParts(r).l1 }}</span>
                <span class="tr__l2">{{ statusParts(r).l2 }}</span>
              </td>
              <td class="tr__act">
                <!-- sent to me: answer it -->
                <template v-if="r.counterpartyId === sched.myUserId.value && r.requesterId !== sched.myUserId.value">
                  <button v-if="r.type === 'giveaway'" class="tr__btn tr__btn--primary" :disabled="busy" @click="acceptDirect(r)">
                    {{ hourWarnFor[r.id] ? (warnConfirm(hourWarnFor[r.id]!) ? 'I understand — accept' : 'Accept anyway') : 'Accept' }}
                  </button>
                  <button v-else-if="offeringOn !== r.id" class="tr__btn tr__btn--primary" @click="startOffer(r)">Offer a shift back</button>
                  <button class="tr__btn" :disabled="busy" @click="declineDirect(r)">Decline</button>
                </template>
                <!-- my posting (admins can watch offers on any) -->
                <template v-else-if="r.requesterId === sched.myUserId.value || sched.canEdit.value">
                  <button v-if="offersFor(r).length" class="tr__btn" @click="reviewFor = reviewFor === r.id ? null : r.id">
                    {{ reviewFor === r.id ? 'Hide offers' : 'Review offers' }}
                  </button>
                  <button v-if="r.requesterId === sched.myUserId.value" class="tr__btn" :disabled="busy" @click="cancelPosting(r)">Withdraw posting</button>
                </template>
                <!-- someone else's open posting: claim / offer / withdraw -->
                <template v-if="!isDirected(r) && r.requesterId !== sched.myUserId.value">
                  <button v-if="myOfferOn(r)" class="tr__btn" :disabled="busy" @click="withdraw(myOfferOn(r)!)">
                    {{ withdrawArm === myOfferOn(r)!.id ? 'Really withdraw?' : 'Withdraw' }}
                  </button>
                  <template v-else-if="offeringOn !== r.id">
                    <button v-if="r.type === 'giveaway'" class="tr__btn tr__btn--primary" :disabled="busy" @click="takeShift(r)">
                      {{ hourWarnFor[r.id] ? (warnConfirm(hourWarnFor[r.id]!) ? 'I understand — take it' : 'Take it anyway') : 'Claim' }}
                    </button>
                    <button v-else class="tr__btn tr__btn--primary" @click="startOffer(r)">Offer a shift</button>
                  </template>
                </template>
              </td>
            </tr>

            <tr v-if="hourWarnFor[r.id] || offeringOn === r.id || reviewFor === r.id" class="tr__detailrow">
              <td colspan="5">
                <div v-if="hourWarnFor[r.id]" class="tr__warnbox">
                  <p class="tr__warnhead">Before you take this:</p>
                  <ul class="tr__warnlist">
                    <li v-for="(w, i) in hourWarnFor[r.id]" :key="i">{{ w.message }}</li>
                  </ul>
                </div>

                <div v-if="reviewFor === r.id" class="tr__offers">
                  <div v-for="o in offersFor(r)" :key="o.id" class="tr__offer">
                    <div class="tr__offer-main">
                      <p class="tr__offer-who">{{ offerName(o) }}</p>
                      <p class="tr__offer-line">{{ offerShiftLine(o) }}</p>
                      <p v-if="o.note" class="tr__offer-note">"{{ o.note }}"</p>
                    </div>
                    <div v-if="r.requesterId === sched.myUserId.value" class="tr__offer-actions">
                      <button class="tr__btn tr__btn--primary" :disabled="busy" @click="accept(r, o)">Accept</button>
                      <button class="tr__btn" :disabled="busy" @click="decline(o)">Decline</button>
                    </div>
                  </div>
                  <p v-if="offersFor(r).length === 0" class="tr__muted tr__muted--sm">No offers yet.</p>
                </div>

                <div v-if="offeringOn === r.id" class="tr__offerform">
                  <label class="tr__field">
                    <span class="tr__label">{{ r.counterpartyId === sched.myUserId.value ? 'Offer one of your shifts back' : 'Offer one of your shifts' }}</span>
                    <select v-model="offerShiftKey" class="tr__input">
                      <option v-if="myShifts.length === 0" value="" disabled>No upcoming shifts found</option>
                      <optgroup v-for="g in myShiftGroups" :key="g.label" :label="g.label">
                        <option v-for="sh in g.items" :key="shiftKey(sh)" :value="shiftKey(sh)">
                          {{ shiftLabel(sh) }}
                        </option>
                      </optgroup>
                    </select>
                  </label>
                  <label class="tr__check">
                    <input v-model="offerPartial" type="checkbox" /> Part of that shift only
                  </label>
                  <div v-if="offerPartial" class="tr__times">
                    <label>From <TimeSelect24 v-model="offerFrom" class="tr__input tr__input--time" /></label>
                    <label>Until <TimeSelect24 v-model="offerUntil" class="tr__input tr__input--time" /></label>
                  </div>
                  <input v-model="offerNote" type="text" class="tr__input" placeholder="Note (optional)" />
                  <p v-if="offerCrossesPeriod(r)" class="tr__ppwarn">
                    Heads up: that shift is in a different pay period than {{ posterName(r) }}'s —
                    the Chief prefers same-period swaps but can still approve it.
                  </p>
                  <div class="tr__offer-actions">
                    <button class="tr__btn tr__btn--primary" :disabled="busy" @click="submitOffer(r)">
                      {{
                        hourWarnFor[r.id]
                          ? warnConfirm(hourWarnFor[r.id]!)
                            ? 'I understand — send offer'
                            : 'Send offer anyway'
                          : 'Send offer'
                      }}
                    </button>
                    <button class="tr__btn" @click="offeringOn = null">Cancel</button>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <section v-if="awaitingApproval.length > 0" class="tr__section">
      <h3 class="tr__sect">Awaiting Chief approval</h3>
      <table class="tr__table">
        <thead>
          <tr><th>Type</th><th>Deal</th><th>Shift</th><th>Flags</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in awaitingApproval" :key="r.id" class="tr__row">
            <td><span class="tr__typ">{{ r.type === 'giveaway' ? 'Giveaway' : 'Swap' }}</span></td>
            <td class="tr__poster">
              {{ posterName(r) }} ⇄ {{ r.counterpartyId ? (sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown') : '—' }}
            </td>
            <td>
              <span class="tr__l1">{{ r.workDate ? fmtDate(r.workDate) : '' }}<template v-if="r.counterWorkDate"> ⇄ {{ fmtDate(r.counterWorkDate) }}</template></span>
              <span v-if="postingParts(r).detail" class="tr__l2">{{ postingParts(r).detail }}</span>
            </td>
            <td>
              <span v-for="(f, i) in awaitFlags(r)" :key="i" class="tr__flag">{{ f }}</span>
              <span v-if="awaitFlags(r).length === 0" class="tr__l2">—</span>
            </td>
            <td><span class="tr__l1 tr__pending">Pending approval</span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="sched.canEdit.value" class="tr__muted tr__muted--sm" style="margin-top: 6px">
        Approve or deny these on the Requests tab.
      </p>
    </section>
    </template>
  </div>
</template>

<style scoped>
.tr {
  max-width: 760px;
}

/* underline lane tabs, same language as Time Reports (2026-09-24) */
.tr__tabs {
  display: flex;
  gap: 18px;
  border-bottom: 1px solid var(--color-line);
  margin: 0 0 10px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tr__tab {
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

.tr__tab i {
  font-style: normal;
  opacity: 0.6;
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}

.tr__tab--on {
  color: var(--color-ink);
  border-bottom-color: var(--color-accent-600);
}

.tr__topbar {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
}

.tr__filter {
  font: inherit;
  font-size: 0.78rem;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  border-radius: 7px;
  padding: 0.35rem 0.55rem;
}

.tr__post {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0.4rem 0.9rem;
  border: 0;
  border-radius: 4px;
  background: var(--color-brand-800);
  color: white;
  cursor: pointer;
  margin-left: auto;
}

.tr__hint {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0;
  max-width: 46ch;
}

.tr__done {
  color: var(--color-success-500);
  font-size: 0.85rem;
}

.tr__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.tr__form {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 1rem;
  box-shadow: var(--shadow-sm);
}

.tr__form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.6rem;
}

.tr__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tr__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.tr__input {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.38rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.tr__input--time {
  width: 110px;
}

.tr__check {
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.tr__times {
  display: flex;
  gap: 0.8rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  align-items: center;
}

.tr__submit {
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

.tr__section {
  margin-bottom: 1.6rem;
}

.tr__h {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--color-brand-800);
  margin: 0 0 0.6rem;
}

.tr__muted {
  color: var(--color-muted);
  font-size: 0.85rem;
}

.tr__muted--sm {
  font-size: 0.78rem;
}

/* ── the board TABLE (approved mock) — real header row, roomier rows,
   names carry the weight so nothing blends (2026-09-24) ── */
.tr__table {
  width: 100%;
  border-collapse: collapse;
}

.tr__table th {
  text-align: left;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
  font-weight: 700;
  padding: 4px 10px 6px;
  border-bottom: 1px solid var(--color-line);
}

.tr__table td {
  padding: 10px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.84rem;
  vertical-align: top;
}

.tr__row:hover td {
  background: var(--color-surface);
}

.tr__row--att td:first-child {
  box-shadow: inset 2.5px 0 0 var(--color-accent-600);
}

.tr__detailrow > td {
  background: var(--color-surface);
  padding-top: 4px;
}

.tr__typ {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  white-space: nowrap;
}

.tr__poster {
  font-weight: 600;
  color: var(--color-ink);
}

.tr__youtag {
  font-weight: 400;
  color: var(--color-muted);
}

.tr__st--you {
  color: oklch(0.5 0.12 60);
}

.tr__cmt {
  font-style: italic;
}

.tr__act {
  text-align: right;
  white-space: nowrap;
}

.tr__pending {
  color: var(--color-muted);
  font-weight: 500;
}

.tr__flag {
  display: inline-block;
  font-size: 0.66rem;
  font-weight: 600;
  border-radius: 5px;
  padding: 1.5px 7px;
  margin: 0 4px 3px 0;
  background: var(--color-warning-50, oklch(0.97 0.03 86.8));
  color: oklch(0.45 0.12 60);
}

.tr__sect {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-ink);
  margin: 20px 0 6px;
}

/* legacy card shell (posting form container etc.) stays flat */
.tr__card {
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  border-radius: 0;
  background: transparent;
  padding: 0.65rem 0.2rem 0.7rem;
  margin-bottom: 0;
  box-shadow: none;
}

.tr__l1 {
  display: block;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
}

.tr__l2 {
  display: block;
  font-size: 0.76rem;
  color: var(--color-muted);
  margin-top: 1px;
  white-space: nowrap;
}

.tr__age {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tr__card-top {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.tr__type {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 8px;
  color: var(--color-accent-700);
}

.tr__type[data-type='trade'] {
  color: var(--color-brand-600);
}

.tr__who {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0;
}

.tr__line {
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.tr__comments {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0.25rem 0 0;
}

.tr__offer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  border-top: 1px solid var(--color-line-soft);
  padding: 0.45rem 0;
  margin-top: 0.45rem;
}

.tr__offer-who {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0;
}

.tr__offer-line {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0;
}

.tr__offer-note {
  font-size: 0.76rem;
  color: var(--color-ink-soft);
  margin: 0.1rem 0 0;
}

.tr__offer-actions {
  display: flex;
  gap: 0.35rem;
  flex: none;
}

/* row actions = underlined text links (locked 2026-09-24) */
.tr__btn {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--color-ink-soft);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--color-line);
}

.tr__btn:hover:not(:disabled) {
  text-decoration-color: var(--color-accent-600);
}

.tr__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.tr__btn + .tr__btn {
  margin-left: 12px;
}

.tr__btn--primary {
  color: var(--color-success-500);
  text-decoration-color: color-mix(in oklab, var(--color-success-500) 55%, transparent);
}

.tr__btn--primary:hover:not(:disabled) {
  text-decoration-color: var(--color-success-500);
}

.tr__cardfoot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.55rem;
}

.tr__mine {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-success-500);
}

.tr__offerform {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 0.55rem;
  margin-top: 0.55rem;
}

.tr__card--waiting {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

/* gold stripe = waiting on YOU (chip chrome retired) */
.tr__card--direct {
  box-shadow: inset 2.5px 0 0 var(--color-accent-600);
  padding-left: 0.7rem;
}

.tr__direct {
  font-size: 11px;
  font-weight: 600;
  color: oklch(0.5 0.11 86.8);
  border: 1px solid oklch(0.82 0.08 86.8);
  border-radius: 999px;
  padding: 2px 9px;
}

.tr__chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-warning-500);
  border: 1px solid oklch(0.88 0.05 60);
  background: var(--color-warning-50);
  border-radius: 999px;
  padding: 2px 9px;
  margin-left: auto;
}

.tr__chip--warn {
  margin-left: 0;
  color: oklch(0.45 0.12 60);
  cursor: help;
}

.tr__warnbox {
  border: 1px solid oklch(0.85 0.08 60);
  background: var(--color-warning-50);
  border-radius: 9px;
  padding: 0.5rem 0.7rem;
  margin-top: 0.4rem;
}

.tr__warnhead {
  font-size: 0.78rem;
  font-weight: 700;
  color: oklch(0.45 0.12 60);
  margin: 0 0 0.25rem;
}

.tr__warnlist {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.tr__ppwarn {
  font-size: 0.76rem;
  color: oklch(0.5 0.13 60);
  background: var(--color-warning-50, oklch(0.98 0.02 85));
  border: 1px solid oklch(0.88 0.05 60);
  border-radius: 8px;
  padding: 0.3rem 0.55rem;
  margin: 0.1rem 0 0;
}
</style>
