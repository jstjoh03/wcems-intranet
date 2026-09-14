<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  hhmm,
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

onMounted(async () => {
  await sched.ensureLoaded()
  await Promise.all([sched.loadRequests(), sched.loadTradeOffers()])
})

// ── post a shift ─────────────────────────────────────────────────────

const posting = ref(false)
const postType = ref<'giveaway' | 'trade'>('giveaway')
const postShiftKey = ref('')
const postPartial = ref(false)
const postFrom = ref('06:00')
const postUntil = ref('06:00')
const postComments = ref('')
const busy = ref(false)
const err = ref<string | null>(null)
const done = ref<string | null>(null)

const myShifts = ref<UpcomingShift[]>([])

function openPost() {
  posting.value = !posting.value
  err.value = done.value = null
  if (posting.value) {
    const me = sched.myUserId.value
    myShifts.value = me ? sched.upcomingShiftsFor(me, todayCentralIso(), 45) : []
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
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  posting.value = false
  postComments.value = ''
  postPartial.value = false
  done.value = 'Posted — it is now on the board for the crew.'
}

// ── board ────────────────────────────────────────────────────────────

const board = computed(() =>
  sched.requests.value.filter(
    (r) => (r.type === 'giveaway' || r.type === 'trade') && r.status === 'pending',
  ),
)

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
  return `${fmtDate(o.offerWorkDate)} · ${unit?.code ?? ''} ${seat?.label ?? ''}`
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
  myShifts.value = me ? sched.upcomingShiftsFor(me, todayCentralIso(), 45) : []
  offerShiftKey.value = myShifts.value[0] ? shiftKey(myShifts.value[0]) : ''
  offerNote.value = ''
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
    offerShift: { dateIso: sel.dateIso, seatId: sel.seatId },
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

async function withdraw(o: TradeOffer) {
  busy.value = true
  const e = await sched.withdrawOffer(o.id)
  busy.value = false
  if (e) err.value = e
}

async function cancelPosting(r: SchedRequest) {
  busy.value = true
  const e = await sched.cancelRequest(r.id)
  busy.value = false
  if (e) err.value = e
}
</script>

<template>
  <div class="tr">
    <div class="tr__topbar">
      <button class="tr__post" @click="openPost">
        {{ posting ? 'Close' : 'Post a shift' }}
      </button>
      <p class="tr__hint">
        Give a shift away for anyone qualified to claim, or ask for a swap. Deals you accept
        still go to the Chief for final approval before the calendar changes.
      </p>
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
            <option v-for="s in myShifts" :key="shiftKey(s)" :value="shiftKey(s)">
              {{ shiftLabel(s) }}
            </option>
          </select>
        </label>
      </div>
      <label class="tr__check">
        <input v-model="postPartial" type="checkbox" /> Part of the shift only
      </label>
      <div v-if="postPartial" class="tr__times">
        <label>From <input v-model="postFrom" type="time" class="tr__input tr__input--time" /></label>
        <label>Until <input v-model="postUntil" type="time" class="tr__input tr__input--time" /></label>
      </div>
      <label class="tr__field">
        <span class="tr__label">Comments</span>
        <input v-model="postComments" type="text" class="tr__input" placeholder="Optional" />
      </label>
      <button type="submit" class="tr__submit" :disabled="busy">
        {{ busy ? 'Posting…' : 'Post to the board' }}
      </button>
    </form>

    <section class="tr__section">
      <h2 class="tr__h">Available trades</h2>
      <p v-if="board.length === 0" class="tr__muted">Nothing on the board right now.</p>

      <div v-for="r in board" :key="r.id" class="tr__card">
        <div class="tr__card-top">
          <span class="tr__type" :data-type="r.type">{{ r.type === 'giveaway' ? 'Giveaway' : 'Swap wanted' }}</span>
          <p class="tr__who">{{ posterName(r) }}</p>
          <p class="tr__line">{{ postingLine(r) }}</p>
        </div>
        <p v-if="r.comments" class="tr__comments">"{{ r.comments }}"</p>

        <!-- poster's view: manage offers -->
        <template v-if="r.requesterId === sched.myUserId.value || sched.canEdit.value">
          <div v-if="offersFor(r).length === 0" class="tr__muted tr__muted--sm">No takers yet.</div>
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
          <div v-if="r.requesterId === sched.myUserId.value" class="tr__cardfoot">
            <button class="tr__btn" :disabled="busy" @click="cancelPosting(r)">Cancel posting</button>
          </div>
        </template>

        <!-- everyone else: take or offer -->
        <template v-if="r.requesterId !== sched.myUserId.value">
          <div v-if="hourWarnFor[r.id]" class="tr__warnbox">
            <p class="tr__warnhead">Before you take this:</p>
            <ul class="tr__warnlist">
              <li v-for="(w, i) in hourWarnFor[r.id]" :key="i">{{ w.message }}</li>
            </ul>
          </div>
          <div v-if="myOfferOn(r)" class="tr__cardfoot">
            <span class="tr__mine">Your {{ r.type === 'giveaway' ? 'claim' : 'offer' }} is in.</span>
            <button class="tr__btn" :disabled="busy" @click="withdraw(myOfferOn(r)!)">Withdraw</button>
          </div>
          <div v-else-if="offeringOn === r.id" class="tr__offerform">
            <label class="tr__field">
              <span class="tr__label">Offer one of your shifts</span>
              <select v-model="offerShiftKey" class="tr__input">
                <option v-if="myShifts.length === 0" value="" disabled>No upcoming shifts found</option>
                <option v-for="s in myShifts" :key="shiftKey(s)" :value="shiftKey(s)">
                  {{ shiftLabel(s) }}
                </option>
              </select>
            </label>
            <input v-model="offerNote" type="text" class="tr__input" placeholder="Note (optional)" />
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
          <div v-else class="tr__cardfoot">
            <button
              v-if="r.type === 'giveaway'"
              class="tr__btn tr__btn--primary"
              :disabled="busy"
              @click="takeShift(r)"
            >
              {{
                hourWarnFor[r.id]
                  ? warnConfirm(hourWarnFor[r.id]!)
                    ? 'I understand — take this shift'
                    : 'Take it anyway'
                  : 'Take this shift'
              }}
            </button>
            <button v-else class="tr__btn tr__btn--primary" @click="startOffer(r)">Offer a swap</button>
          </div>
        </template>
      </div>
    </section>

    <section v-if="awaitingApproval.length > 0" class="tr__section">
      <h2 class="tr__h">Awaiting Chief approval</h2>
      <div v-for="r in awaitingApproval" :key="r.id" class="tr__card tr__card--waiting">
        <span class="tr__type" :data-type="r.type">{{ r.type === 'giveaway' ? 'Giveaway' : 'Swap' }}</span>
        <p class="tr__line">
          {{ posterName(r) }} → {{ r.counterpartyId ? (sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Unknown') : '' }}
          · {{ postingLine(r) }}
          <template v-if="r.counterWorkDate"> ↔ {{ fmtDate(r.counterWorkDate) }}</template>
        </p>
        <span
          v-for="(w, i) in reqWarnings(r)"
          :key="i"
          class="tr__chip tr__chip--warn"
          :title="w.message"
        >
          {{ w.code === 'weekly' ? `${w.hours}h week` : w.code === 'ot' ? 'Overtime' : `${w.hours}h consecutive` }}
        </span>
        <span class="tr__chip">Pending approval</span>
      </div>
      <p v-if="sched.canEdit.value" class="tr__muted tr__muted--sm">
        Approve or deny these on the Requests tab.
      </p>
    </section>
  </div>
</template>

<style scoped>
.tr {
  max-width: 760px;
}

.tr__topbar {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
}

.tr__post {
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.45rem 1rem;
  border: 0;
  border-radius: 8px;
  background: var(--color-brand-700);
  color: white;
  cursor: pointer;
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

.tr__card {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.6rem;
  box-shadow: var(--shadow-sm);
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

.tr__btn {
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

.tr__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
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
</style>
