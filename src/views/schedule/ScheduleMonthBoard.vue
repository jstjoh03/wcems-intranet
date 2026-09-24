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

// mine: "My schedule" mode — only one member + open seats. forUser
// swaps that member (the My-panel "Schedule for" picker); default me.
const props = defineProps<{
  month: string // 'YYYY-MM'
  mine?: boolean
  forUser?: string | null
  hideOpen?: boolean
}>()
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
  worksMe: boolean
  model: DayModel
}

/** Am I working (seat, rider, event, or extra hours) on this day?
 *  Drives the gold day-number marker — on phones the roster is hidden,
 *  so this is how you spot your days at a glance (the Aladtec habit). */
function worksMe(model: DayModel, me: string | null): boolean {
  if (!me) return false
  return (
    model.units.some(
      (um) =>
        um.seats.some((sm) => sm.rows.some((r) => r.userId === me)) ||
        um.extras.some((r) => r.userId === me),
    ) ||
    model.events.some((ev) => ev.rows.some((r) => r.userId === me)) ||
    model.extraHours.some((r) => r.userId === me)
  )
}

/** Unit (or whole-day) notes open in the shared note modal — Aladtec's
 *  gold note icon on the unit header, tap-to-read on phones, editable
 *  in place for editors. */
function noteCtx(label: string, iso: string, notes: { id: string; note: string }[]) {
  const day = new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return {
    title: `${label} — ${day}`,
    text: notes.map((n) => n.note).join('\n'),
    dayNotes: notes.map((n) => ({ id: n.id, note: n.note })),
  }
}

function notesTitle(notes: { note: string }[]): string {
  return notes.map((n) => n.note).join('\n')
}

const weeks = computed<Cell[][]>(() => {
  const first = new Date(`${props.month}-01T00:00:00`)
  const gridStart = addDaysIso(`${props.month}-01`, -first.getDay())
  const me = (props.mine ? props.forUser : null) ?? sched.myUserId.value
  const out: Cell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const iso = addDaysIso(gridStart, w * 7 + d)
      const model = sched.dayModel(iso, props.mine ? me : null, props.mine && props.hideOpen)
      row.push({
        iso,
        dayNum: Number(iso.slice(8, 10)),
        inMonth: iso.slice(0, 7) === props.month,
        isToday: iso === todayIso,
        worksMe: worksMe(model, me),
        model,
      })
    }
    if (row.every((c) => !c.inMonth)) break
    out.push(row)
  }
  return out
})

</script>

<template>
  <div class="mb" :class="{ 'mb--mine': props.mine }">
    <div class="mb__legend">
      <span class="mb__platoon" data-platoon="A"><span class="mb__dot" />A Shift</span>
      <span class="mb__platoon" data-platoon="B"><span class="mb__dot" />B Shift</span>
      <span class="mb__platoon" data-platoon="C"><span class="mb__dot" />C Shift</span>
      <span class="mb__legend-note">48/96 rotation · 0600 changeover</span>
    </div>

    <div class="mb__weekdays">
      <span v-for="w in WEEKDAYS" :key="w" class="mb__weekday">{{ w }}</span>
    </div>

    <div v-for="(week, wi) in weeks" :key="wi" class="mb__week">
      <div
        v-for="c in week"
        :key="c.iso"
        class="mb__cell"
        :class="{ 'mb__cell--out': !c.inMonth, 'mb__cell--today': c.isToday, 'mb__cell--me': props.mine && c.worksMe }"
      >
        <div class="mb__cellhead">
          <button class="mb__cellbtn" @click="emit('open-day', c.iso)">
            <span class="mb__daynum" :class="{ 'mb__daynum--me': c.worksMe }" :title="c.worksMe ? 'You work this day' : undefined">{{ c.dayNum }}</span>
            <span class="mb__platoon" :data-platoon="c.model.platoon">
              <span class="mb__dot" /><span class="mb__platoonword">{{ c.model.platoon }} Shift</span>
            </span>
          </button>
          <span v-if="c.model.openCount > 0" class="mb__open">{{ c.model.openCount }}<span class="mb__openword"> open</span></span>
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
          <div v-if="c.model.notes.length" class="mb__daynotes">
            <button
              class="mb__noteicon mb__rowbtn"
              :title="notesTitle(c.model.notes)"
              @click="editor.openNote(noteCtx('Day note', c.iso, c.model.notes))"
            >
              <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
              <span>Day note</span>
            </button>
          </div>
          <div v-for="um in c.model.units" :key="um.unit.id" class="mb__unit">
            <p class="mb__unitname">
              <span>{{ um.unit.code }}</span>
              <button
                v-if="um.notes.length"
                class="mb__noteicon mb__rowbtn"
                :title="notesTitle(um.notes)"
                @click="editor.openNote(noteCtx(um.unit.code, c.iso, um.notes))"
              >
                <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
              </button>
            </p>
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
                <button
                  v-else-if="!!row.userId && row.userId === sched.myUserId.value"
                  class="mb__name mb__rowbtn mb__name--me"
                  title="Your shift — time off, trade, or giveaway"
                  @click="editor.openMyShift(c.iso, um.unit.code, sm.seat.id, sm.seat.label, row)"
                >
                  {{ row.name }}<span v-if="row.credential" class="mb__cred"> - {{ row.credential }}</span>
                </button>
                <span v-else class="mb__name">
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
              <button
                v-else-if="ex.note"
                class="mb__name mb__rowbtn"
                :class="{ 'mb__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
                :title="ex.note ?? undefined"
                @click="editor.openNote({ title: ex.name, text: ex.note ?? '' })"
              >
                {{ ex.name }}<span class="mb__notedot" />
              </button>
              <span
                v-else
                class="mb__name"
                :class="{ 'mb__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
              >
                {{ ex.name }}
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
            <button
              v-else-if="ex.note"
              class="mb__name mb__rowbtn"
              :title="ex.note ?? undefined"
              @click="editor.openNote({ title: ex.name, text: ex.note ?? '' })"
            >{{ ex.name }}<span class="mb__notedot" /></button>
            <span v-else class="mb__name">{{ ex.name }}</span>
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

          <div v-if="c.model.events.length" class="mb__section mb__section--event">
            <p class="mb__section-h">Events</p>
          <div v-for="ev in c.model.events" :key="ev.label" class="mb__event">
            <p class="mb__eventname">
              <button
                class="mb__eventlabel mb__rowbtn mb__rowbtn--ev"
                :title="sched.eventTooltip(c.iso, ev)"
                @click="editor.openEventInfo(c.iso, ev)"
              >
                {{ ev.label }}
              </button>
              <button
                v-if="ev.notes"
                class="mb__noteicon mb__rowbtn"
                :title="ev.notes ?? undefined"
                @click="editor.openNote({ title: ev.label, text: ev.notes ?? '', event: { dateIso: c.iso, label: ev.label, eventId: ev.eventId, startHm: ev.start, endHm: ev.end } })"
              >
                <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
              </button>
              <span v-if="ev.start && !ev.rows.length" class="mb__time">{{ ev.start }}-{{ ev.end }}</span>
            </p>
            <p v-if="ev.location" class="mb__evloc">{{ ev.location }}</p>
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
          </div>

          <div v-if="c.model.pending.length" class="mb__section mb__section--pend">
            <p class="mb__section-h">Pending Requests</p>
            <button
              v-for="r in c.model.pending"
              :key="r.id"
              class="mb__lrow mb__pendbtn"
              :title="sched.canEdit.value ? 'Review — approve or deny' : 'Your request — view or cancel'"
              @click="editor.openRequest(r.id)"
            >
              <span class="mb__row">
                <span class="mb__name">{{ r.name }}<span v-if="r.credential" class="mb__cred"> - {{ r.credential }}</span></span>
                <span class="mb__time">{{ r.start }}-{{ r.end }}</span>
              </span>
              <span class="mb__sub">{{ r.sub }}</span>
            </button>
          </div>
        </div>
      </div>
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
  box-shadow: 0 0 0 2px var(--color-accent-600);
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

/* clickable pending-request row — same reset as the name buttons */
.mb__pendbtn {
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
  text-align: left;
  cursor: pointer;
  display: block;
  width: 100%;
}

.mb__pendbtn .mb__sub {
  display: block;
}

.mb__pendbtn:hover .mb__name {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.mb__daynotes {
  padding: 0.08rem 0;
}

.mb__daynotes .mb__noteicon span {
  font-size: 0.66rem;
  font-weight: 600;
  color: oklch(0.5 0.11 86.8);
  margin-left: 3px;
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

/* Gold day number = you're on the board that day (matches the gold
   name highlight; on phones it's the only marker, roster is hidden). */
.mb__daynum--me {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--me-hl, oklch(0.94 0.13 102));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--me-hl, oklch(0.94 0.13 102)), black 15%);
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

/* Whole-chip platoon color (Ng, day-1 feedback: dots alone let B and C
   blend — the tinted chip + colored text reads at a glance). */
.mb__platoon[data-platoon='A'] {
  color: #fff;
  border-color: oklch(0.52 0.19 27);
  background: oklch(0.52 0.19 27);
  font-weight: 700;
}

.mb__platoon[data-platoon='A'] .mb__dot {
  background: oklch(1 0 0 / 0.9);
}

.mb__platoon[data-platoon='B'] {
  color: #fff;
  border-color: oklch(0.44 0.16 262);
  background: oklch(0.44 0.16 262);
  font-weight: 700;
}

.mb__platoon[data-platoon='B'] .mb__dot {
  background: oklch(1 0 0 / 0.9);
}

.mb__platoon[data-platoon='C'] {
  color: #fff;
  border-color: oklch(0.47 0.14 148);
  background: oklch(0.47 0.14 148);
  font-weight: 700;
}

.mb__platoon[data-platoon='C'] .mb__dot {
  background: oklch(1 0 0 / 0.9);
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
  display: flex;
  align-items: center;
  gap: 0.25rem;
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
  background: var(--me-hl, oklch(0.94 0.13 102));
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
  padding: 0.15rem 0 0.2rem;
  border-top: 1px solid var(--color-line-soft);
}

.mb__event:first-of-type {
  border-top: 0;
  padding-top: 0.05rem;
}

.mb__eventname {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 0 0 0.05rem;
}

/* Note icon hugs the name; the event's hours sit at the right edge. */
.mb__eventname .mb__time {
  margin-left: auto;
}

.mb__eventlabel {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mb__evloc {
  font-size: 0.62rem;
  color: var(--color-muted);
  margin: -0.02rem 0 0.08rem;
  overflow-wrap: break-word;
}

.mb__noteicon {
  flex: none;
  display: inline-flex;
  cursor: pointer;
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

/* Section boxes darkened a notch (Ng + Justin, day-2): stronger
   borders, deeper header tints, darker label text. */
.mb__section--extra {
  border-color: oklch(0.5 0.1 250);
  background: oklch(0.97 0.015 250);
}

.mb__section--extra .mb__section-h {
  background: oklch(0.45 0.1 250);
  color: #fff;
}

.mb__section--trade {
  border-color: oklch(0.48 0.13 150);
  background: oklch(0.97 0.02 150);
}

.mb__section--trade .mb__section-h {
  background: oklch(0.45 0.13 150);
  color: #fff;
}

.mb__section--off {
  border-color: oklch(0.58 0.13 65);
  background: oklch(0.98 0.02 65);
}

.mb__section--off .mb__section-h {
  background: oklch(0.55 0.13 65);
  color: #fff;
}

.mb__section--event {
  border-color: oklch(0.5 0.11 300);
  background: oklch(0.978 0.012 300);
}

.mb__section--event .mb__section-h {
  background: oklch(0.47 0.11 300);
  color: #fff;
}

.mb__section--pend {
  border-color: oklch(0.52 0.18 27);
  background: oklch(0.98 0.012 27);
}

.mb__section--pend .mb__section-h {
  background: oklch(0.52 0.18 27);
  color: #fff;
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
  margin-bottom: 0.6rem;
}

.mb__legend-note {
  font-size: 12px;
  color: var(--color-muted);
}

/* Phone: a native-calendar month — day number (gold circle = your
   day), platoon dot, red open-count pill. The whole cell taps into the
   Day view; rosters and editor tools live there. */
@media (max-width: 900px) {
  .mb__roster,
  .mb__plus,
  .mb__platoonword,
  .mb__openword {
    display: none;
  }

  .mb__week {
    gap: 4px;
    margin-bottom: 4px;
  }

  .mb__cell {
    position: relative;
    min-height: 60px;
    border-radius: 9px;
  }

  .mb__cellhead {
    border-bottom: 0;
    background: var(--color-surface);
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 3px;
    padding: 0.4rem 0.1rem;
  }

  .mb__cell--out .mb__cellhead {
    background: transparent;
  }

  .mb__cellbtn {
    position: static;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  /* stretch the tap target across the whole cell */
  .mb__cellbtn::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  /* Day cells strip the chip chrome — but then the DOT must carry the
     platoon color itself, full strength. (The desktop white-on-chip dot
     over a transparent chip left pale ghosts nobody could tell apart —
     Justin, 2026-09-24.) The legend keeps its solid chips. */
  .mb__cellhead .mb__platoon {
    border: 0;
    padding: 0;
    background: transparent;
  }

  .mb__dot {
    width: 10px;
    height: 10px;
  }

  .mb__cellhead .mb__platoon[data-platoon='A'] .mb__dot {
    background: oklch(0.52 0.19 27);
  }

  .mb__cellhead .mb__platoon[data-platoon='B'] .mb__dot {
    background: oklch(0.44 0.16 262);
  }

  .mb__cellhead .mb__platoon[data-platoon='C'] .mb__dot {
    background: oklch(0.47 0.14 148);
  }

  .mb__open {
    margin-left: 0;
    line-height: 15px;
    padding: 0 6px;
    border-radius: 999px;
    background: oklch(0.98 0.013 27);
    box-shadow: inset 0 0 0 1px oklch(0.9 0.05 27);
  }

  /* My schedule on a phone: a personal calendar — only YOUR days are
     marked (gold circle); no platoon dots or open pills as noise. */
  .mb--mine .mb__platoon,
  .mb--mine .mb__open {
    display: none;
  }
}

/* My schedule: the whole day carries the gold, not just the number
   (Ng, day-1 feedback). */
.mb--mine .mb__cell--me {
  background: var(--me-hl, oklch(0.94 0.13 102));
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--me-hl, oklch(0.94 0.13 102)), black 20%);
}

/* ONE uniform shade per cell — the header strip, day number, and name
   pill all melt into the same fill (separate component highlights read
   as seams — Justin, 2026-09-22). */
.mb--mine .mb__cell--me .mb__cellhead {
  background: transparent;
  border-bottom-color: color-mix(in oklab, var(--me-hl, oklch(0.94 0.13 102)), black 12%);
}

.mb--mine .mb__cell--me .mb__daynum--me {
  background: transparent;
  box-shadow: none;
}

.mb--mine .mb__cell--me .mb__name--me {
  background: transparent;
  padding: 0;
}

/* Times/credentials washed out over the fill — force dark ink inside
   highlighted cells whatever tint the member picked. */
.mb--mine .mb__cell--me .mb__time,
.mb--mine .mb__cell--me .mb__cred,
.mb--mine .mb__cell--me .mb__sub {
  color: oklch(0.38 0.03 95);
}

/* Phone: the cellhead paints the whole cell, so it must carry the gold
   too (it was covering the cell fill) — and a touch stronger, since on
   a 60px cell the wash is the only signal. */
@media (max-width: 900px) {
  .mb--mine .mb__cell--me,
  .mb--mine .mb__cell--me .mb__cellhead {
    background: var(--me-hl, oklch(0.94 0.13 102));
  }

  .mb--mine .mb__cell--me {
    box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--me-hl, oklch(0.94 0.13 102)), black 25%);
  }
}
</style>
