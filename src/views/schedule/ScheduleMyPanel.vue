<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  addDaysIso,
  hhmm,
  NOTIFY_TYPES,
  NOTIFY_CHANNELS,
  notifyOn,
  type Availability,
  type MemberSettings,
  type NotifyChannel,
  type SchedRequest,
} from '@/composables/useSchedule'
import ScheduleMonthBoard from './ScheduleMonthBoard.vue'
import ScheduleDayBoard from './ScheduleDayBoard.vue'
import ScheduleWeekBoard from './ScheduleWeekBoard.vue'
import SchedulePeriodBoard from './SchedulePeriodBoard.vue'

/**
 * My schedule — the same calendar views as the main boards (month
 * default, plus day / week / pay period) filtered to the signed-in
 * member and open seats, with their own pending requests and a
 * shifts/hours summary on top. Clicking an open seat still opens the
 * pickup/assign modal.
 */

const sched = useSchedule()

type MyView = 'month' | 'day' | 'week' | 'period'
const view = ref<MyView>('month')
const dateIso = ref(todayCentralIso())

const VIEWS: { key: MyView; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'period', label: 'Pay period' },
]

const monthAnchor = computed(() => dateIso.value.slice(0, 7))

/* The phone month is a personal calendar (gold day markers only); the
   other views — and desktop month — still list open seats too. */
const isPhone = window.matchMedia('(max-width: 900px)').matches
const showingLabel = computed(() =>
  isPhone && view.value === 'month'
    ? 'Your days are marked in gold'
    : 'Showing you + open seats',
)

const navLabel = computed(() => {
  if (view.value === 'month') {
    return new Date(`${monthAnchor.value}-01T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  }
  if (view.value === 'week') {
    const d = new Date(`${dateIso.value}T00:00:00`)
    const start = addDaysIso(dateIso.value, -d.getDay())
    const end = addDaysIso(start, 6)
    const fmt = (iso: string) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `Week of ${fmt(start)} – ${fmt(end)}`
  }
  return new Date(`${dateIso.value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})

function shiftView(delta: number) {
  if (view.value === 'month') {
    const d = new Date(`${monthAnchor.value}-01T00:00:00`)
    d.setMonth(d.getMonth() + delta)
    dateIso.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  } else if (view.value === 'week') {
    dateIso.value = addDaysIso(dateIso.value, delta * 7)
  } else {
    dateIso.value = addDaysIso(dateIso.value, delta)
  }
}

function goToday() {
  dateIso.value = todayCentralIso()
}

function openDay(iso: string) {
  dateIso.value = iso
  view.value = 'day'
}

/* Keep the loaded entry range covering what this tab shows (shared
   with the main boards — the shell reloads its own window when the
   user returns to a calendar tab). */
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

onMounted(async () => {
  await sched.ensureLoaded()
  await loadVisibleRange()
})

watch(monthAnchor, () => {
  void loadVisibleRange()
})

watch(view, (v, prev) => {
  if (prev === 'period' && v !== 'period') void loadVisibleRange()
})

// ── summary + own pending ────────────────────────────────────────────

/** How many of my shift days land in the displayed month. */
const monthShiftCount = computed(() => {
  const me = sched.myUserId.value
  if (!me) return 0
  const first = `${monthAnchor.value}-01`
  const endD = new Date(`${first}T00:00:00`)
  endD.setMonth(endD.getMonth() + 1)
  endD.setDate(0)
  const last = `${monthAnchor.value}-${String(endD.getDate()).padStart(2, '0')}`
  let days = 0
  for (let iso = first; iso <= last; iso = addDaysIso(iso, 1)) {
    if (iso < sched.rangeStart.value || iso > sched.rangeEnd.value) continue
    const m = sched.dayModel(iso, me)
    const working = m.units.some((um) => um.seats.some((sm) => sm.rows.some((r) => !r.open)))
    if (working) days++
  }
  return days
})

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

// ── my settings (contact, notifications, unavailable days) ──────────

const setOpen = ref(false)
const mySet = ref<MemberSettings | null>(null)
const myUnavail = ref<Availability[]>([])
const setBusy = ref(false)
const setSaved = ref(false)
const setErr = ref<string | null>(null)

const myPerson = computed(() =>
  sched.myUserId.value ? (sched.personById.value.get(sched.myUserId.value) ?? null) : null,
)

/** Editors and supervisors also get the approvals row. */
const myNotifyTypes = computed(() =>
  NOTIFY_TYPES.filter(
    (t) => !t.editorOnly || sched.canEdit.value || sched.level.value === 'supervisor',
  ),
)

async function openSettings() {
  setOpen.value = true
  setSaved.value = false
  setErr.value = null
  mySet.value = null
  const me = sched.myUserId.value
  if (!me) return
  mySet.value = await sched.fetchMemberSettings(me)
  myUnavail.value = await sched.listMyUnavailable()
}

function nChecked(key: string, ch: NotifyChannel): boolean {
  return mySet.value ? notifyOn(mySet.value.notify, key, ch) : true
}

function nToggle(key: string, ch: NotifyChannel, ev: Event) {
  if (!mySet.value) return
  const on = (ev.target as HTMLInputElement).checked
  const n = { ...(mySet.value.notify as Record<string, Record<string, boolean>>) }
  n[key] = { ...(n[key] ?? {}), [ch]: on }
  mySet.value.notify = n
}

async function saveSettings() {
  if (!mySet.value) return
  setBusy.value = true
  setErr.value = null
  setSaved.value = false
  const e = await sched.saveMemberSettings(mySet.value)
  setBusy.value = false
  if (e) {
    setErr.value = e
    return
  }
  setSaved.value = true
}

async function removeUnavail(id: string) {
  setErr.value = null
  const e = await sched.clearUnavailable(id)
  if (e) {
    setErr.value = e
    return
  }
  myUnavail.value = await sched.listMyUnavailable()
}

function fmtUnavail(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
    <section v-if="myPending.length > 0" class="my__pending">
      <h3 class="my__h my__h--pend">Your pending requests</h3>
      <div v-for="r in myPending" :key="r.id" class="my__pendrow">
        <span class="my__pendtype">{{ TYPE_LABELS[r.type] ?? r.type }}</span>
        <span class="my__pendline">{{ pendingLine(r) }}</span>
        <span class="my__chip">{{ r.status === 'partner_accepted' ? 'Awaiting approval' : 'Pending' }}</span>
      </div>
    </section>

    <div class="my__nav">
      <div class="my__views" role="tablist">
        <button
          v-for="v in VIEWS"
          :key="v.key"
          class="my__viewbtn"
          :class="{ 'my__viewbtn--on': view === v.key }"
          role="tab"
          :aria-selected="view === v.key"
          @click="view = v.key"
        >
          {{ v.label }}
        </button>
      </div>

      <template v-if="view !== 'period'">
        <div class="my__arrows">
          <button class="my__navbtn" aria-label="Previous" @click="shiftView(-1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button class="my__navbtn my__navbtn--today" @click="goToday">Today</button>
          <button class="my__navbtn" aria-label="Next" @click="shiftView(1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <h2 class="my__navlabel">{{ navLabel }}</h2>
      </template>

      <span class="my__count">
        {{ showingLabel }}
        <template v-if="view === 'month' && monthShiftCount > 0">
          · {{ monthShiftCount }} shift {{ monthShiftCount === 1 ? 'day' : 'days' }} this month
        </template>
      </span>

      <button class="my__navbtn my__setbtn" @click="openSettings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        My settings
      </button>
    </div>

    <div v-if="setOpen" class="my__overlay" @click.self="setOpen = false">
      <div class="my__modal" role="dialog" aria-label="My settings">
        <h3 class="my__mtitle">My settings</h3>
        <p v-if="setErr" class="my__merr">{{ setErr }}</p>

        <template v-if="mySet">
          <section class="my__msec">
            <h4 class="my__mh">Contact on file</h4>
            <p class="my__mline">
              {{ myPerson?.phone ?? 'No phone on file' }} · {{ myPerson?.email ?? 'no email on file' }}
            </p>
            <p class="my__mhint">Wrong or missing? Ask the office to update your roster record.</p>
            <label class="my__mcheck">
              <input v-model="mySet.smsOptIn" type="checkbox" />
              Send me text messages about scheduling
            </label>
            <p class="my__mhint">
              Optional — never required. Frequency varies with schedule activity; message &amp;
              data rates may apply. Reply STOP to any message to opt out (or untick this box),
              HELP for help. See the
              <a href="/sms-terms.html" target="_blank" rel="noopener">SMS Terms</a> and
              <a href="/sms-privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
            </p>
          </section>

          <section class="my__msec">
            <h4 class="my__mh">Notifications</h4>
            <table class="my__ntable">
              <thead>
                <tr>
                  <th></th>
                  <th v-for="ch in NOTIFY_CHANNELS" :key="ch.key">{{ ch.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in myNotifyTypes" :key="t.key">
                  <td class="my__ntype">{{ t.label }}</td>
                  <td v-for="ch in NOTIFY_CHANNELS" :key="ch.key">
                    <input
                      type="checkbox"
                      :checked="nChecked(t.key, ch.key)"
                      :disabled="ch.key === 'sms' && !mySet.smsOptIn"
                      :aria-label="`${t.label} — ${ch.label}`"
                      @change="nToggle(t.key, ch.key, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="my__mhint">
              Delivery starts with the notifications rollout — your choices here are ready for it.
            </p>
          </section>

          <section class="my__msec">
            <h4 class="my__mh">Unavailable days</h4>
            <p v-if="myUnavail.length === 0" class="my__mhint">
              None marked. Protect a rotation day off from Requests → Time off → “Mark unavailable”.
            </p>
            <ul v-else class="my__ulist">
              <li v-for="a in myUnavail" :key="a.id" class="my__urow">
                <span class="my__udate">{{ fmtUnavail(a.onDate) }}</span>
                <span v-if="a.reason" class="my__ureason">{{ a.reason }}</span>
                <button class="my__uremove" @click="removeUnavail(a.id)">Remove</button>
              </li>
            </ul>
          </section>

          <div class="my__mfoot">
            <span v-if="setSaved" class="my__msaved">Saved.</span>
            <button class="my__navbtn" @click="setOpen = false">Close</button>
            <button class="my__msave" :disabled="setBusy" @click="saveSettings">
              {{ setBusy ? 'Saving…' : 'Save settings' }}
            </button>
          </div>
        </template>
        <p v-else class="my__mhint">Loading…</p>
      </div>
    </div>

    <ScheduleMonthBoard v-if="view === 'month'" :month="monthAnchor" mine @open-day="openDay" />
    <ScheduleDayBoard v-else-if="view === 'day'" :date-iso="dateIso" mine />
    <ScheduleWeekBoard v-else-if="view === 'week'" :date-iso="dateIso" mine @open-day="openDay" />
    <SchedulePeriodBoard
      v-else
      mine
      @open-day="openDay"
      @range="(s: string, e: string) => sched.loadRange(s, e)"
    />
  </div>
</template>

<style scoped>
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
  max-width: 720px;
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

.my__nav {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.my__views {
  display: inline-flex;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 3px;
  gap: 2px;
}

.my__viewbtn {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-muted);
  padding: 0.28rem 0.7rem;
  border-radius: 7px;
  cursor: pointer;
}

.my__viewbtn--on {
  background: var(--color-brand-700);
  color: white;
}

.my__arrows {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.my__navbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  padding: 0 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.my__navbtn svg {
  width: 14px;
  height: 14px;
}

.my__navbtn:hover {
  border-color: var(--color-brand-300);
}

.my__navlabel {
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--color-ink);
  margin: 0;
}

.my__count {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--color-muted);
}

.my__setbtn {
  gap: 6px;
}

/* ── My settings modal (module elevation recipe) ── */

.my__overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.25 0.03 260 / 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 7vh 1rem 2rem;
  overflow-y: auto;
}

.my__modal {
  width: min(560px, 100%);
  background:
    linear-gradient(180deg, oklch(1 0 0 / 0.9), oklch(0.985 0.004 84 / 0.9)),
    var(--color-surface);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-brand-700);
  border-radius: 14px;
  box-shadow: 0 24px 60px oklch(0.2 0.04 260 / 0.28), 0 4px 14px oklch(0.2 0.04 260 / 0.12);
  padding: 1rem 1.2rem 1.1rem;
}

.my__mtitle {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-ink);
  margin: 0 0 0.6rem;
}

.my__msec {
  border-top: 1px solid var(--color-line-soft);
  padding: 0.7rem 0 0.4rem;
}

.my__mh {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.4rem;
}

.my__mline {
  font-size: 0.86rem;
  color: var(--color-ink);
  margin: 0 0 0.15rem;
  overflow-wrap: anywhere;
}

.my__mhint {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin: 0.15rem 0 0.4rem;
}

.my__mcheck {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  margin: 0.35rem 0 0.2rem;
}

.my__merr {
  font-size: 0.8rem;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  background: oklch(0.98 0.013 27);
  border: 1px solid oklch(0.88 0.06 27);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
}

.my__ntable {
  border-collapse: collapse;
  font-size: 0.82rem;
  width: 100%;
}

.my__ntable th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 0.25rem 0.5rem;
  text-align: center;
}

.my__ntable td {
  padding: 0.3rem 0.5rem;
  border-top: 1px solid var(--color-line-soft);
  text-align: center;
}

.my__ntable td.my__ntype {
  text-align: left;
  color: var(--color-ink-soft);
  padding-left: 0;
}

.my__ntable input[type='checkbox']:disabled {
  opacity: 0.4;
}

.my__ulist {
  list-style: none;
  margin: 0.2rem 0 0.3rem;
  padding: 0;
}

.my__urow {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.84rem;
  flex-wrap: wrap;
}

.my__urow:last-child {
  border-bottom: 0;
}

.my__udate {
  font-weight: 600;
  color: var(--color-ink);
}

.my__ureason {
  color: var(--color-muted);
  font-size: 0.78rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.my__uremove {
  margin-left: auto;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  background: transparent;
  border: 1px solid oklch(0.88 0.06 27);
  border-radius: 7px;
  padding: 0.1rem 0.5rem;
  cursor: pointer;
}

.my__mfoot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 0.7rem;
  margin-top: 0.4rem;
}

.my__msaved {
  font-size: 0.8rem;
  color: var(--color-success-600, oklch(0.55 0.13 150));
  margin-right: auto;
}

.my__msave {
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.4rem 1rem;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18), 0 1px 2px oklch(0.2 0.04 260 / 0.2);
  color: white;
  cursor: pointer;
}

.my__msave:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
