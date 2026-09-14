<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule, addDaysIso, todayCentralIso, type DayModel } from '@/composables/useSchedule'
import { useScheduleEditor } from '@/composables/useScheduleEditor'

/**
 * Month board — the default view, mirroring Aladtec's monthly calendar:
 * every cell carries the full day roster (unit blocks, names with
 * credentials, right-aligned times, open seats in the seat's name).
 * Rows are live: open seats take pickup requests, and for editors every
 * person, student, and event opens the same modals as the Day view; the
 * per-cell "+" adds events, notes, and students without leaving the
 * month. On phones the roster collapses to platoon chip + open count
 * and the cell links into the Day view.
 */

// mine: "My schedule" mode — only the signed-in member + open seats
const props = defineProps<{ month: string; mine?: boolean }>() // 'YYYY-MM'
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const sched = useSchedule()
const editor = useScheduleEditor()
const todayIso = todayCentralIso()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat']

interface Cell {
  iso: string
  dayNum: number
  inMonth: boolean
  isToday: boolean
  model: DayModel
}

const weeks = computed<Cell[][]>(() => {
  const first = new Date(`${props.month}-01T00:00:00`)
  const gridStart = addDaysIso(`${props.month}-01`, -first.getDay())
  const out: Cell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const iso = addDaysIso(gridStart, w * 7 + d)
      row.push({
        iso,
        dayNum: Number(iso.slice(8, 10)),
        inMonth: iso.slice(0, 7) === props.month,
        isToday: iso === todayIso,
        model: sched.dayModel(iso, props.mine ? sched.myUserId.value : null),
      })
    }
    if (row.every((c) => !c.inMonth)) break
    out.push(row)
  }
  return out
})

</script>

<template>
  <div class="mb">
    <div class="mb__weekdays">
      <span v-for="w in WEEKDAYS" :key="w" class="mb__weekday">{{ w }}</span>
    </div>

    <div v-for="(week, wi) in weeks" :key="wi" class="mb__week">
      <div
        v-for="c in week"
        :key="c.iso"
        class="mb__cell"
        :class="{ 'mb__cell--out': !c.inMonth, 'mb__cell--today': c.isToday }"
      >
        <div class="mb__cellhead">
          <button class="mb__cellbtn" @click="emit('open-day', c.iso)">
            <span class="mb__daynum">{{ c.dayNum }}</span>
            <span class="mb__platoon" :data-platoon="c.model.platoon">
              <span class="mb__dot" />{{ c.model.platoon }} Shift
            </span>
          </button>
          <span v-if="c.model.openCount > 0" class="mb__open">{{ c.model.openCount }} open</span>
          <button
            v-if="sched.canEdit.value"
            class="mb__plus"
            title="Add event, note, or student"
            @click="editor.openAdd(c.iso)"
          >
            +
          </button>
        </div>

        <div class="mb__roster">
          <div v-for="um in c.model.units" :key="um.unit.id" class="mb__unit">
            <p class="mb__unitname">{{ um.unit.code }}</p>
            <template v-for="sm in um.seats" :key="sm.seat.id">
              <div
                v-for="(row, ri) in sm.rows"
                :key="sm.seat.id + '-' + ri"
                class="mb__row"
              >
                <button
                  v-if="row.open"
                  class="mb__name mb__name--open mb__rowbtn"
                  title="Open — click to request or assign"
                  @click="editor.openSlot(c.iso, sm.seat.id, sm.seat.label, row)"
                >
                  {{ sm.seat.label }}
                </button>
                <button
                  v-else-if="sched.canEdit.value"
                  class="mb__name mb__rowbtn"
                  :class="{ 'mb__name--me': !!row.userId && row.userId === sched.myUserId.value }"
                  title="Edit this person's day"
                  @click="editor.openPerson(c.iso, um.unit.code, sm.seat.id, sm.seat.label, row)"
                >
                  {{ row.name }}<span v-if="row.credential" class="mb__cred"> - {{ row.credential }}</span>
                </button>
                <span
                  v-else
                  class="mb__name"
                  :class="{ 'mb__name--me': !!row.userId && row.userId === sched.myUserId.value }"
                >
                  {{ row.name }}<span v-if="row.credential" class="mb__cred"> - {{ row.credential }}</span>
                </span>
                <span class="mb__time">{{ row.start }}-{{ row.end }}</span>
              </div>
            </template>
            <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="mb__row mb__row--extra">
              <button
                v-if="ex.open"
                class="mb__name mb__name--open mb__rowbtn"
                title="Open extra seat — click to request or assign"
                @click="editor.openRiderSlot(c.iso, `${um.unit.code} ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
              >
                {{ ex.posLabel ?? 'Rider' }}
              </button>
              <button
                v-else-if="sched.canEdit.value && ex.kind === 'rider' && ex.entryId"
                class="mb__name mb__rowbtn"
                :class="{ 'mb__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
                title="Edit this rider seat"
                @click="editor.openRiderRow(c.iso, `${um.unit.code} · ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
              >
                {{ ex.name }}
              </button>
              <button
                v-else-if="sched.canEdit.value && ex.kind === 'student' && ex.entryId"
                class="mb__name mb__rowbtn"
                :title="ex.note ?? 'Edit this student'"
                @click="editor.openStudent(c.iso, ex)"
              >
                {{ ex.name }}<span v-if="ex.note" class="mb__notedot" />
              </button>
              <span
                v-else
                class="mb__name"
                :class="{ 'mb__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
                :title="ex.note ?? undefined"
              >
                {{ ex.name }}<span v-if="ex.note" class="mb__notedot" />
              </span>
              <span class="mb__time">{{ ex.start }}-{{ ex.end }}</span>
            </div>
          </div>
          <div v-for="ex in c.model.unattached" :key="ex.entryId ?? ex.name" class="mb__row mb__row--extra">
            <button
              v-if="sched.canEdit.value && ex.kind === 'student' && ex.entryId"
              class="mb__name mb__rowbtn"
              :title="ex.note ?? 'Edit this student'"
              @click="editor.openStudent(c.iso, ex)"
            >
              {{ ex.name }}<span v-if="ex.note" class="mb__notedot" />
            </button>
            <span v-else class="mb__name" :title="ex.note ?? undefined">{{ ex.name }}</span>
            <span class="mb__time">{{ ex.start }}-{{ ex.end }}</span>
          </div>

          <div v-if="c.model.extraHours.length" class="mb__section mb__section--extra">
            <p class="mb__section-h">Extra Hours</p>
            <div v-for="r in c.model.extraHours" :key="r.entryId" class="mb__lrow">
              <div class="mb__row">
                <button
                  v-if="sched.canEdit.value"
                  class="mb__name mb__rowbtn"
                  :class="{ 'mb__name--me': !!r.userId && r.userId === sched.myUserId.value }"
                  title="Edit or delete these extra hours"
                  @click="editor.openExtra(c.iso, r)"
                >
                  {{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span>
                </button>
                <span v-else class="mb__name" :class="{ 'mb__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span></span>
                <span class="mb__time">{{ r.start }}-{{ r.end }}</span>
              </div>
              <p v-if="r.sub" class="mb__sub">{{ r.sub }}</p>
            </div>
          </div>

          <div v-if="c.model.trades.length" class="mb__section mb__section--trade">
            <p class="mb__section-h">Trades</p>
            <div v-for="r in c.model.trades" :key="r.entryId" class="mb__lrow">
              <div class="mb__row">
                <span class="mb__name" :class="{ 'mb__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span></span>
                <span class="mb__time">{{ r.start }}-{{ r.end }}</span>
              </div>
              <p v-if="r.sub" class="mb__sub">{{ r.sub }}</p>
            </div>
          </div>

          <div v-if="c.model.timeOff.length" class="mb__section mb__section--off">
            <p class="mb__section-h">Time Off</p>
            <div v-for="r in c.model.timeOff" :key="r.entryId" class="mb__lrow">
              <div class="mb__row">
                <span class="mb__name" :class="{ 'mb__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span></span>
                <span class="mb__time">{{ r.start }}-{{ r.end }}</span>
              </div>
              <p v-if="r.sub" class="mb__sub">{{ r.sub }}</p>
            </div>
          </div>

          <div v-for="ev in c.model.events" :key="ev.label" class="mb__event">
            <p class="mb__eventname">
              <button
                v-if="sched.canEdit.value"
                class="mb__eventlabel mb__rowbtn mb__rowbtn--ev"
                title="Manage this event — notes, slots, delete"
                @click="editor.openEvent(c.iso, ev)"
              >
                {{ ev.label }}
              </button>
              <span v-else class="mb__eventlabel">{{ ev.label }}</span>
              <span v-if="ev.notes" class="mb__noteicon" :title="ev.notes">
                <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
              </span>
              <span v-if="ev.start" class="mb__time">{{ ev.start }}-{{ ev.end }}</span>
            </p>
            <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="mb__row">
              <button
                v-if="row.open"
                class="mb__name mb__name--open mb__rowbtn"
                title="Open — click to request or assign"
                @click="editor.openEventSlot(c.iso, ev, row)"
              >
                {{ row.name }}
              </button>
              <button
                v-else-if="sched.canEdit.value"
                class="mb__name mb__rowbtn"
                :class="{ 'mb__name--me': !!row.userId && row.userId === sched.myUserId.value }"
                title="Manage this event"
                @click="editor.openEvent(c.iso, ev)"
              >
                {{ row.name }}
              </button>
              <span
                v-else
                class="mb__name"
                :class="{ 'mb__name--me': !!row.userId && row.userId === sched.myUserId.value }"
              >{{ row.name }}</span>
              <span class="mb__time">{{ row.start }}-{{ row.end }}</span>
            </div>
          </div>

          <div v-if="c.model.pending.length" class="mb__section mb__section--pend">
            <p class="mb__section-h">Pending Requests</p>
            <div v-for="r in c.model.pending" :key="r.id" class="mb__lrow">
              <div class="mb__row">
                <span class="mb__name">{{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span></span>
                <span class="mb__time">{{ r.start }}-{{ r.end }}</span>
              </div>
              <p class="mb__sub">{{ r.sub }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mb__legend">
      <span class="mb__platoon" data-platoon="A"><span class="mb__dot" />A Shift</span>
      <span class="mb__platoon" data-platoon="B"><span class="mb__dot" />B Shift</span>
      <span class="mb__platoon" data-platoon="C"><span class="mb__dot" />C Shift</span>
      <span class="mb__legend-note">48/96 rotation · 0600 changeover</span>
    </div>
  </div>
</template>

<style scoped>
.mb__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 6px;
}

.mb__weekday {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  text-align: center;
}

.mb__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 6px;
  align-items: stretch;
}

.mb__cell {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.mb__cell--out {
  opacity: 0.45;
  background: var(--color-surface-soft);
}

.mb__cell--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 1px var(--color-accent-600);
}

.mb__cellhead {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  width: 100%;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  padding: 0.3rem 0.4rem;
}

.mb__cellbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  padding: 0;
  cursor: pointer;
  min-width: 0;
}

.mb__cellbtn:hover .mb__daynum {
  color: var(--color-brand-600);
}

.mb__plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-brand-600);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.mb__plus:hover {
  border-color: var(--color-brand-300);
}

.mb__rowbtn {
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
  text-align: left;
  cursor: pointer;
  display: block;
}

.mb__rowbtn:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.mb__notedot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 4px;
  border-radius: 2px;
  background: oklch(0.88 0.1 86.8);
  border: 1px solid oklch(0.6 0.11 86.8);
  vertical-align: 2px;
}

.mb__daynum {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.mb__platoon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--color-surface);
  white-space: nowrap;
}

.mb__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: none;
}

.mb__platoon[data-platoon='A'] .mb__dot {
  background: oklch(0.55 0.2 27);
}

.mb__platoon[data-platoon='B'] .mb__dot {
  background: oklch(0.5 0.16 255);
}

.mb__platoon[data-platoon='C'] .mb__dot {
  background: oklch(0.55 0.15 150);
}

.mb__open {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-danger-500);
  margin-left: auto;
  white-space: nowrap;
}

.mb__roster {
  padding: 0.15rem 0.4rem 0.3rem;
}

.mb__unit {
  padding: 0.12rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.mb__unit:last-child {
  border-bottom: 0;
}

.mb__unitname {
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-brand-700);
  margin: 0 0 0.05rem;
}

.mb__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem;
  line-height: 1.35;
  padding: 0 0.2rem;
  margin: 0 -0.2rem;
}

/* subtle zebra per UNIT block — alternating trucks scan at a glance */
.mb__roster > .mb__unit:nth-child(even) {
  background: oklch(0.45 0.02 260 / 0.045);
  border-radius: 5px;
  padding-inline: 0.25rem;
  margin-inline: -0.25rem;
}

.mb__name {
  /* Aladtec behavior: one line always — long names ellipsize, the
     time never moves or wraps. */
  font-size: 0.7rem;
  color: var(--color-ink);
  min-width: 0;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mb__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

/* Aladtec-style "that's me" highlight — spot your days at a glance. */
.mb__name--me {
  background: oklch(0.93 0.07 86.8);
  font-weight: 700;
  border-radius: 4px;
  padding: 0 3px;
}

.mb__cred {
  color: var(--color-muted);
}

.mb__time {
  font-size: 0.6rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: none;
}

.mb__row--extra .mb__name {
  color: var(--color-accent-700);
}

.mb__event {
  margin-top: 0.25rem;
  border: 1px solid oklch(0.88 0.05 86.8);
  background: oklch(0.985 0.012 86.8);
  border-radius: 7px;
  padding: 0.2rem 0.35rem 0.25rem;
}

.mb__eventname {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 0 0 0.05rem;
}

.mb__eventlabel {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mb__noteicon {
  flex: none;
  display: inline-flex;
  cursor: help;
}

.mb__noteicon svg {
  width: 11px;
  height: 11px;
}

.mb__section {
  margin-top: 0.25rem;
  border-radius: 7px;
  padding: 0 0.35rem 0.25rem;
  border: 1px solid var(--color-line);
}

.mb__section-h {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0 -0.35rem 0.1rem;
  padding: 0.15rem 0.35rem;
  border-radius: 6px 6px 0 0;
}

.mb__section--extra {
  border-color: oklch(0.85 0.06 250);
}

.mb__section--extra .mb__section-h {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}

.mb__section--trade {
  border-color: oklch(0.85 0.07 150);
}

.mb__section--trade .mb__section-h {
  background: var(--color-success-50);
  color: var(--color-success-500);
}

.mb__section--off {
  border-color: oklch(0.88 0.06 60);
}

.mb__section--off .mb__section-h {
  background: var(--color-warning-50);
  color: oklch(0.5 0.13 60);
}

.mb__section--pend {
  border-color: oklch(0.85 0.09 27);
}

.mb__section--pend .mb__section-h {
  background: oklch(0.97 0.02 27);
  color: var(--color-danger-500);
}

.mb__lrow {
  padding: 0.05rem 0;
}

.mb__sub {
  font-size: 0.6rem;
  color: var(--color-muted);
  margin: 0;
  line-height: 1.25;
}

.mb__legend {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}

.mb__legend-note {
  font-size: 12px;
  color: var(--color-muted);
}

/* Phone: collapse rosters — the cell header (day, platoon, opens) stays
   and taps through to the Day view. */
@media (max-width: 900px) {
  .mb__roster {
    display: none;
  }

  .mb__cellhead {
    border-bottom: 0;
    background: var(--color-surface);
    flex-direction: column;
    align-items: flex-start;
  }

  .mb__open {
    margin-left: 0;
  }
}
</style>
