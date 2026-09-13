<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  hhmm,
  type SchedRequest,
  type UpcomingShift,
} from '@/composables/useSchedule'

/**
 * Requests — crew submit time off / extra hours / open-shift pickups;
 * editors see the pending queue and approve or deny. Approval writes the
 * deviation entries so the calendar updates immediately. Pending requests
 * are private to the requester (plus supervisors and editors) via RLS.
 */

const sched = useSchedule()

onMounted(async () => {
  await sched.ensureLoaded()
  await sched.loadRequests()
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
}

// extra hours
const exDate = ref(todayCentralIso())
const exFrom = ref('06:00')
const exUntil = ref('08:00')
const exUnit = ref('')
const exPosition = ref('')
const exTimeType = ref('regular')

function pickForm(kind: FormKind) {
  formKind.value = kind
  formError.value = null
  formDone.value = null
  comments.value = ''
  if (kind === 'time_off') loadDayPicks()
}

async function submit() {
  formError.value = null
  formBusy.value = true
  let err: string | null = null
  try {
    if (formKind.value === 'time_off') {
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
      err = await sched.createExtraRequest({
        dateIso: exDate.value,
        from: exFrom.value,
        until: exUntil.value,
        unitId: exUnit.value || null,
        positionLabel: exPosition.value,
        timeType: exTimeType.value,
        comments: comments.value,
      })
    }
  } finally {
    formBusy.value = false
  }
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
    bits.push(r.timeType.charAt(0).toUpperCase() + r.timeType.slice(1))
  }
  return bits.join(' · ')
}

function requesterName(r: SchedRequest): string {
  return sched.personById.value.get(r.requesterId)?.fullName ?? 'Unknown'
}

const myRequests = computed(() =>
  sched.requests.value.filter((r) => r.requesterId === sched.myUserId.value),
)

const pendingQueue = computed(() =>
  sched.requests.value.filter((r) => r.status === 'pending' || r.status === 'partner_accepted'),
)

const busyId = ref<string | null>(null)
const decideError = ref<string | null>(null)

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
    <section class="rq__section">
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
              <label>From <input v-model="d.from" type="time" class="rq__input rq__input--time" /></label>
              <label>Until <input v-model="d.until" type="time" class="rq__input rq__input--time" /></label>
            </div>
          </div>
        </template>

        <template v-else-if="formKind === 'extra_hours'">
          <div class="rq__grid">
            <label class="rq__field">
              <span class="rq__label">Date</span>
              <input v-model="exDate" type="date" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">From</span>
              <input v-model="exFrom" type="time" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">Until</span>
              <input v-model="exUntil" type="time" class="rq__input" />
            </label>
            <label class="rq__field">
              <span class="rq__label">Unit</span>
              <select v-model="exUnit" class="rq__input">
                <option value="">—</option>
                <option v-for="u in sched.units.value" :key="u.id" :value="u.id">{{ u.code }}</option>
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
              </select>
            </label>
          </div>
        </template>

        <label class="rq__field">
          <span class="rq__label">Comments</span>
          <input
            v-model="comments"
            type="text"
            class="rq__input"
            placeholder="Optional — e.g. late call run number"
          />
        </label>

        <button type="submit" class="rq__submit" :disabled="formBusy">
          {{ formBusy ? 'Submitting…' : 'Submit request' }}
        </button>
      </form>
    </section>

    <section v-if="sched.canEdit.value" class="rq__section">
      <h2 class="rq__h">Pending approval</h2>
      <p v-if="decideError" class="rq__error">{{ decideError }}</p>
      <p v-if="pendingQueue.length === 0" class="rq__muted">Nothing waiting.</p>
      <div v-for="r in pendingQueue" :key="r.id" class="rq__card">
        <div class="rq__card-main">
          <p class="rq__card-title">
            {{ TYPE_LABELS[r.type] }} — {{ requesterName(r) }}
          </p>
          <p class="rq__card-line">{{ requestLine(r) }}</p>
          <p v-if="r.comments" class="rq__card-comments">"{{ r.comments }}"</p>
        </div>
        <div class="rq__card-actions">
          <button class="rq__btn rq__btn--approve" :disabled="busyId === r.id" @click="decide(r, true)">
            Approve
          </button>
          <button class="rq__btn rq__btn--deny" :disabled="busyId === r.id" @click="decide(r, false)">
            Deny
          </button>
        </div>
      </div>
    </section>

    <section class="rq__section">
      <h2 class="rq__h">My requests</h2>
      <p v-if="myRequests.length === 0" class="rq__muted">None yet.</p>
      <div v-for="r in myRequests" :key="r.id" class="rq__card">
        <div class="rq__card-main">
          <p class="rq__card-title">{{ TYPE_LABELS[r.type] }}</p>
          <p class="rq__card-line">{{ requestLine(r) }}</p>
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
  </div>
</template>

<style scoped>
.rq {
  max-width: 720px;
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
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 0.6rem 0.85rem;
  margin-bottom: 0.5rem;
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

@media (max-width: 560px) {
  .rq__card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
