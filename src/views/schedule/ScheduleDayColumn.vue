<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule, todayCentralIso } from '@/composables/useSchedule'
import { useScheduleEditor } from '@/composables/useScheduleEditor'

/**
 * Compact Aladtec-style day column used by the Week and Pay-period
 * boards: date header with platoon chip, then unit blocks with
 * name/credential rows and right-aligned times. Rows open the shared
 * modals — pickups on open seats, the Chief's editors on people,
 * students, and events — and the "+" adds to the day in place.
 */

// mine: "My schedule" mode — only one member + open seats. forUser
// swaps that member (the My-panel "Schedule for" picker); default me.
const props = defineProps<{
  dateIso: string
  mine?: boolean
  forUser?: string | null
  hideOpen?: boolean
}>()
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const sched = useSchedule()
const editor = useScheduleEditor()
const model = computed(() =>
  sched.dayModel(
    props.dateIso,
    props.mine ? (props.forUser ?? sched.myUserId.value) : null,
    props.mine && props.hideOpen,
  ),
)
const isToday = computed(() => props.dateIso === todayCentralIso())

const header = computed(() =>
  new Date(`${props.dateIso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }),
)

/** Unit/day notes open in the shared note modal (editable for editors). */
function noteCtx(label: string, notes: { id: string; note: string }[]) {
  return {
    title: `${label} — ${header.value}`,
    text: notes.map((n) => n.note).join('\n'),
    dayNotes: notes.map((n) => ({ id: n.id, note: n.note })),
  }
}

function notesTitle(notes: { note: string }[]): string {
  return notes.map((n) => n.note).join('\n')
}
</script>

<template>
  <div class="dc" :class="{ 'dc--today': isToday }">
    <div class="dc__head">
      <button class="dc__headbtn" @click="emit('open-day', dateIso)">
        <span class="dc__date">{{ header }}</span>
      </button>
      <span class="dc__platoon" :data-platoon="model.platoon">
        <span class="dc__dot" />{{ model.platoon }}
      </span>
      <button
        v-if="sched.canEdit.value"
        class="dc__plus"
        title="Add event, note, or student"
        @click="editor.openAdd(dateIso)"
      >
        +
      </button>
    </div>

    <div v-if="model.notes.length" class="dc__row">
      <button
        class="dc__name dc__rowbtn dc__daynote"
        :title="notesTitle(model.notes)"
        @click="editor.openNote(noteCtx('Day note', model.notes))"
      >
        <span class="dc__noteicon" />Day note
      </button>
    </div>

    <div v-for="um in model.units" :key="um.unit.id" class="dc__unit">
      <p class="dc__unit-name">
        {{ um.unit.code }}
        <button
          v-if="um.notes.length"
          class="dc__noteicon dc__rowbtn"
          :title="notesTitle(um.notes)"
          @click="editor.openNote(noteCtx(um.unit.code, um.notes))"
        />
      </p>
      <template v-for="sm in um.seats" :key="sm.seat.id">
        <div
          v-for="(row, ri) in sm.rows"
          :key="sm.seat.id + '-' + ri"
          class="dc__row"
          :class="{ 'dc__row--open': row.open }"
        >
          <button
            v-if="row.open"
            class="dc__name dc__name--open dc__rowbtn"
            title="Open — click to request or assign"
            @click="editor.openSlot(dateIso, sm.seat.id, sm.seat.label, row)"
          >
            {{ sm.seat.label }}
          </button>
          <button
            v-else-if="sched.canEdit.value"
            class="dc__name dc__rowbtn"
            :class="{ 'dc__name--me': !!row.userId && row.userId === sched.myUserId.value }"
            title="Edit this person's day"
            @click="editor.openPerson(dateIso, um.unit.code, sm.seat.id, sm.seat.label, row)"
          >
            {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
          </button>
          <button
            v-else-if="!!row.userId && row.userId === sched.myUserId.value"
            class="dc__name dc__rowbtn dc__name--me"
            title="Your shift — time off, trade, or giveaway"
            @click="editor.openMyShift(dateIso, um.unit.code, sm.seat.id, sm.seat.label, row)"
          >
            {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
          </button>
          <span v-else class="dc__name">
            {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
          </span>
          <span class="dc__time">{{ row.start }}-{{ row.end }}</span>
        </div>
      </template>
      <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="dc__row dc__row--extra">
        <button
          v-if="ex.open"
          class="dc__name dc__name--open dc__rowbtn"
          title="Open extra seat — click to request or assign"
          @click="editor.openRiderSlot(dateIso, `${um.unit.code} ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
        >
          {{ ex.posLabel ?? 'Rider' }}
        </button>
        <button
          v-else-if="sched.canEdit.value && ex.kind === 'rider' && ex.entryId"
          class="dc__name dc__rowbtn"
          :class="{ 'dc__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
          title="Edit this rider seat"
          @click="editor.openRiderRow(dateIso, `${um.unit.code} · ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
        >
          {{ ex.name }}<span v-if="ex.credential" class="dc__cred"> - {{ ex.credential }}</span>
        </button>
        <button
          v-else-if="sched.canEdit.value && ex.kind === 'student' && ex.entryId"
          class="dc__name dc__rowbtn"
          :title="ex.note ?? 'Edit this student'"
          @click="editor.openStudent(dateIso, ex)"
        >
          {{ ex.name }}<span v-if="ex.note" class="dc__noteicon" />
        </button>
        <button
          v-else-if="ex.note"
          class="dc__name dc__rowbtn"
          :class="{ 'dc__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
          :title="ex.note ?? undefined"
          @click="editor.openNote({ title: ex.name, text: ex.note ?? '' })"
        >
          {{ ex.name }}<span class="dc__noteicon" />
        </button>
        <span
          v-else
          class="dc__name"
          :class="{ 'dc__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
        >
          {{ ex.name }}
        </span>
        <span class="dc__time">{{ ex.start }}-{{ ex.end }}</span>
      </div>
    </div>

    <div v-if="model.extraHours.length" class="dc__section dc__section--extra">
      <p class="dc__section-h">Extra Hours</p>
      <div v-for="r in model.extraHours" :key="r.entryId">
        <div class="dc__row">
          <button
            v-if="sched.canEdit.value"
            class="dc__name dc__rowbtn"
            :class="{ 'dc__name--me': !!r.userId && r.userId === sched.myUserId.value }"
            title="Edit or delete these extra hours"
            @click="editor.openExtra(dateIso, r)"
          >
            {{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span>
          </button>
          <span v-else class="dc__name" :class="{ 'dc__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
      </div>
    </div>

    <div v-if="model.trades.length" class="dc__section dc__section--trade">
      <p class="dc__section-h">Trades</p>
      <div v-for="r in model.trades" :key="r.entryId">
        <div class="dc__row">
          <span class="dc__name" :class="{ 'dc__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
      </div>
    </div>

    <div v-if="model.timeOff.length" class="dc__section dc__section--off">
      <p class="dc__section-h">Time Off</p>
      <div v-for="r in model.timeOff" :key="r.entryId">
        <div class="dc__row">
          <span class="dc__name" :class="{ 'dc__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </div>
        <p v-if="r.sub" class="dc__sub">{{ r.sub }}</p>
      </div>
    </div>

    <div v-for="ev in model.events" :key="ev.label" class="dc__event">
      <p class="dc__event-name">
        <button
          v-if="sched.canEdit.value"
          class="dc__rowbtn dc__rowbtn--ev"
          title="Manage this event — notes, slots, delete"
          @click="editor.openEvent(dateIso, ev)"
        >
          {{ ev.label }}
        </button>
        <template v-else>{{ ev.label }}</template>
        <button
          v-if="ev.notes"
          class="dc__noteicon dc__rowbtn"
          :title="ev.notes ?? undefined"
          @click="editor.openNote({ title: ev.label, text: ev.notes ?? '', event: { dateIso, label: ev.label, eventId: ev.eventId, startHm: ev.start, endHm: ev.end } })"
        />
      </p>
      <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="dc__row">
        <button
          v-if="row.open"
          class="dc__name dc__name--open dc__rowbtn"
          title="Open — click to request or assign"
          @click="editor.openEventSlot(dateIso, ev, row)"
        >
          {{ row.name }}
        </button>
        <button
          v-else-if="sched.canEdit.value"
          class="dc__name dc__rowbtn"
          :class="{ 'dc__name--me': !!row.userId && row.userId === sched.myUserId.value }"
          title="Manage this event"
          @click="editor.openEvent(dateIso, ev)"
        >
          {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
        </button>
        <span
          v-else
          class="dc__name"
          :class="{ 'dc__name--open': row.open, 'dc__name--me': !!row.userId && row.userId === sched.myUserId.value }"
        >
          {{ row.name }}<span v-if="row.credential" class="dc__cred"> - {{ row.credential }}</span>
        </span>
        <span class="dc__time">{{ row.start }}-{{ row.end }}</span>
      </div>
    </div>

    <div v-if="model.pending.length" class="dc__section dc__section--pend">
      <p class="dc__section-h">Pending Requests</p>
      <button
        v-for="r in model.pending"
        :key="r.id"
        class="dc__pendbtn"
        :title="sched.canEdit.value ? 'Review — approve or deny' : 'Your request — view or cancel'"
        @click="editor.openRequest(r.id)"
      >
        <span class="dc__row">
          <span class="dc__name">{{ r.name }}<span v-if="r.credential" class="dc__cred"> - {{ r.credential }}</span></span>
          <span class="dc__time">{{ r.start }}-{{ r.end }}</span>
        </span>
        <span class="dc__sub">{{ r.sub }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dc {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
  min-width: 0;
}

.dc--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 2px var(--color-accent-600);
}

.dc__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  padding: 0.4rem 0.55rem;
}

.dc__headbtn {
  border: 0;
  background: transparent;
  font: inherit;
  padding: 0;
  cursor: pointer;
  margin-right: auto;
  min-width: 0;
}

.dc__headbtn:hover .dc__date {
  color: var(--color-brand-600);
}

.dc__plus {
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

.dc__plus:hover {
  border-color: var(--color-brand-300);
}

.dc__rowbtn {
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
  text-align: left;
  cursor: pointer;
  display: block;
}

.dc__rowbtn:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.dc__rowbtn--ev {
  display: inline;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dc__date {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-brand-800);
  white-space: nowrap;
}

.dc__platoon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--color-surface);
}

.dc__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
}

/* whole-chip platoon color — see MonthBoard note (Ng feedback) */
.dc__platoon[data-platoon='A'] {
  color: #fff;
  border-color: oklch(0.52 0.19 27);
  background: oklch(0.52 0.19 27);
  font-weight: 700;
}

.dc__platoon[data-platoon='A'] .dc__dot {
  background: oklch(1 0 0 / 0.9);
}

.dc__platoon[data-platoon='B'] {
  color: #fff;
  border-color: oklch(0.44 0.16 262);
  background: oklch(0.44 0.16 262);
  font-weight: 700;
}

.dc__platoon[data-platoon='B'] .dc__dot {
  background: oklch(1 0 0 / 0.9);
}

.dc__platoon[data-platoon='C'] {
  color: #fff;
  border-color: oklch(0.47 0.14 148);
  background: oklch(0.47 0.14 148);
  font-weight: 700;
}

.dc__platoon[data-platoon='C'] .dc__dot {
  background: oklch(1 0 0 / 0.9);
}

.dc__unit {
  padding: 0.3rem 0.55rem 0.35rem;
  border-bottom: 1px solid var(--color-line-soft);
}

.dc__unit:last-child {
  border-bottom: 0;
}

.dc__unit-name {
  display: flex;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-brand-700);
  margin: 0 0 0.15rem;
}

/* clickable pending-request row — same reset as the name buttons */
.dc__pendbtn {
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

.dc__pendbtn .dc__sub {
  display: block;
  padding: 0 0.2rem;
}

.dc__pendbtn:hover .dc__name {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.dc__daynote {
  display: inline-flex;
  align-items: center;
  font-size: 0.68rem;
  font-weight: 600;
  color: oklch(0.5 0.11 86.8);
}

.dc__daynote .dc__noteicon {
  margin: 0 5px 0 0;
}

.dc__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.08rem 0.2rem;
  margin: 0 -0.2rem;
}

/* subtle zebra per UNIT block — alternating trucks scan at a glance.
   (child 1 of the column is the date header, so odd children are the
   2nd/4th unit blocks) */
.dc > .dc__unit:nth-child(odd) {
  background: oklch(0.45 0.02 260 / 0.045);
}

.dc__name {
  /* Aladtec behavior: one line, ellipsize when long, time stays put. */
  font-size: 0.75rem;
  color: var(--color-ink);
  min-width: 0;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dc__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

/* Aladtec-style "that's me" highlight. */
.dc__name--me {
  background: var(--me-hl, oklch(0.85 0.14 86.8));
  font-weight: 700;
  border-radius: 4px;
  padding: 0 3px;
}

.dc__cred {
  color: var(--color-muted);
}

.dc__time {
  font-size: 0.7rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dc__row--extra .dc__name {
  color: var(--color-accent-700);
}

.dc__event {
  padding: 0.3rem 0.55rem 0.35rem;
  border-top: 1px solid oklch(0.9 0.04 86.8);
  background: oklch(0.99 0.008 86.8);
}

.dc__event-name {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-accent-700);
  margin: 0 0 0.15rem;
}

.dc__noteicon {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-left: 5px;
  border-radius: 2px;
  background: oklch(0.88 0.1 86.8);
  border: 1px solid oklch(0.6 0.11 86.8);
  cursor: pointer;
}

.dc__section {
  padding: 0.25rem 0.55rem 0.3rem;
  border-top: 1px solid var(--color-line-soft);
}

.dc__section-h {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0 0 0.1rem;
}

.dc__section--extra .dc__section-h {
  color: var(--color-brand-700);
}

.dc__section--trade .dc__section-h {
  color: var(--color-success-500);
}

.dc__section--off .dc__section-h {
  color: oklch(0.5 0.13 60);
}

.dc__section--pend {
  background: oklch(0.99 0.006 27);
}

.dc__section--pend .dc__section-h {
  color: var(--color-danger-500);
}

.dc__sub {
  font-size: 0.62rem;
  color: var(--color-muted);
  margin: 0;
  line-height: 1.25;
}
</style>
