<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSchedule } from '@/composables/useSchedule'
import { useScheduleEditor } from '@/composables/useScheduleEditor'

/**
 * Day board — one work date (0600 → 0600). Unit groups with seat rows,
 * then SPECIAL EVENTS in their own boxes. All editing goes through the
 * shared modals (ScheduleEditModals in ScheduleView): open seats/slots
 * are clickable for pickups and direct assigns, assigned people open the
 * Chief's day editor, students open the student editor, and events open
 * the event manager — the same behavior as every other view.
 */

// mine: "My schedule" mode — only one member + open seats. forUser
// swaps that member (the My-panel "Schedule for" picker); default me.
const props = defineProps<{
  dateIso: string
  mine?: boolean
  forUser?: string | null
  hideOpen?: boolean
}>()
const sched = useSchedule()
const editor = useScheduleEditor()

const model = computed(() =>
  sched.dayModel(
    props.dateIso,
    props.mine ? (props.forUser ?? sched.myUserId.value) : null,
    props.mine && props.hideOpen,
  ),
)

const stations = computed(() => {
  const groups: { station: string; units: typeof model.value.units }[] = []
  for (const u of model.value.units) {
    const last = groups[groups.length - 1]
    if (last && last.station === u.unit.station) last.units.push(u)
    else groups.push({ station: u.unit.station, units: [u] })
  }
  return groups
})

const err = ref<string | null>(null)
const busy = ref(false)

async function clearRow(entryId: string | null) {
  if (!entryId || busy.value) return
  busy.value = true
  const e = await sched.removeEntry(entryId)
  busy.value = false
  if (e) err.value = e
}

async function removeNote(id: string) {
  if (busy.value) return
  busy.value = true
  const e = await sched.deleteDayNote(id)
  busy.value = false
  if (e) err.value = e
}
</script>

<template>
  <div class="db">
    <div class="db__meta">
      <span class="db__platoon">
        <b class="db__shl" :data-platoon="model.platoon">{{ model.platoon }}</b>&nbsp;Shift on duty
      </span>
      <span v-if="model.openCount > 0" class="db__opencount">
        {{ model.openCount }} open {{ model.openCount === 1 ? 'seat' : 'seats' }}
      </span>
      <!-- one quiet link instead of four buttons (Justin, 2026-09-24) —
           it opens the same add menu the month day-numbers use -->
      <span v-if="sched.canEdit.value" class="db__tools">
        <button class="db__addlink" @click="editor.openAdd(props.dateIso)">+ Add to this day</button>
      </span>
    </div>

    <p v-if="err" class="db__error">{{ err }}</p>

    <div v-for="n in model.notes" :key="n.id" class="db__daynote">
      <span>{{ n.note }}</span>
      <button v-if="sched.canEdit.value" class="db__x" aria-label="Delete note" @click="removeNote(n.id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>

    <section v-for="grp in stations" :key="grp.station" class="db__station">
      <h3 class="db__station-name">{{ grp.station }}</h3>

      <div v-for="um in grp.units" :key="um.unit.id" class="db__unit">
        <div class="db__unit-head">
          <span class="db__unit-code">{{ um.unit.code }}</span>
          <span class="db__unit-label">{{ um.unit.label }}</span>
          <button
            v-if="sched.canEdit.value"
            class="db__tool db__tool--sm"
            @click="editor.openAdd(props.dateIso, 'student', um.unit.id)"
          >
            + Student
          </button>
        </div>

        <div v-for="n in um.notes" :key="n.id" class="db__unitnote">
          <span>{{ n.note }}</span>
          <button v-if="sched.canEdit.value" class="db__x" aria-label="Delete note" @click="removeNote(n.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        <template v-for="sm in um.seats" :key="sm.seat.id">
          <div
            v-for="(row, ri) in sm.rows"
            :key="sm.seat.id + '-' + ri"
            class="db__row"
            :class="{ 'db__row--open': row.open }"
          >
            <span class="db__seat">{{ sm.seat.label }}</span>
            <button
              v-if="row.open"
              class="db__name db__name--open db__name--btn"
              @click="editor.openSlot(props.dateIso, sm.seat.id, sm.seat.label, row)"
            >
              {{ sm.seat.label }}
            </button>
            <button
              v-else-if="sched.canEdit.value"
              class="db__name db__name--btn"
              :class="{ 'db__name--me': !!row.userId && row.userId === sched.myUserId.value }"
              title="Edit this person's day"
              @click="editor.openPerson(props.dateIso, um.unit.code, sm.seat.id, sm.seat.label, row)"
            >
              {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
              <span v-if="row.isRotation" class="db__rot" title="Regular rotation">R</span>
            </button>
            <button
              v-else-if="!!row.userId && row.userId === sched.myUserId.value"
              class="db__name db__name--btn db__name--me"
              title="Your shift — time off, trade, or giveaway"
              @click="editor.openMyShift(props.dateIso, um.unit.code, sm.seat.id, sm.seat.label, row)"
            >
              {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
              <span v-if="row.isRotation" class="db__rot" title="Regular rotation">R</span>
            </button>
            <span v-else class="db__name">
              {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
              <span v-if="row.isRotation" class="db__rot" title="Regular rotation">R</span>
            </span>
            <span class="db__time">{{ row.start }} – {{ row.end }}</span>
          </div>
        </template>

        <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
          <span class="db__seat">{{ ex.kind === 'rider' ? `${ex.posLabel ?? 'Rider'} (extra)` : ex.kind === 'student' ? 'Student' : 'Extra' }}</span>
          <button
            v-if="ex.open"
            class="db__name db__name--open db__name--btn"
            title="Open extra seat — click to request or assign"
            @click="editor.openRiderSlot(props.dateIso, `${um.unit.code} ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
          >
            {{ ex.posLabel ?? 'Rider' }}
          </button>
          <button
            v-else-if="sched.canEdit.value && ex.kind === 'rider' && ex.entryId"
            class="db__name db__name--btn"
            :class="{ 'db__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
            title="Edit this rider seat"
            @click="editor.openRiderRow(props.dateIso, `${um.unit.code} · ${ex.posLabel ?? 'Rider'} (extra seat)`, ex)"
          >
            {{ ex.name }}<span v-if="ex.credential" class="db__cred"> - {{ ex.credential }}</span>
          </button>
          <button
            v-else-if="sched.canEdit.value && ex.kind === 'student' && ex.entryId"
            class="db__name db__name--btn"
            title="Edit this student"
            @click="editor.openStudent(props.dateIso, ex)"
          >
            {{ ex.name }}<span v-if="ex.credential" class="db__cred"> - {{ ex.credential }}</span>
            <span v-if="ex.note" class="db__noteicon" :title="ex.note">
              <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
            </span>
          </button>
          <button
            v-else-if="ex.note"
            class="db__name db__name--btn"
            :class="{ 'db__name--me': !!ex.userId && ex.userId === sched.myUserId.value }"
            :title="ex.note ?? undefined"
            @click="editor.openNote({ title: ex.name, text: ex.note ?? '' })"
          >
            {{ ex.name }}<span v-if="ex.credential" class="db__cred"> - {{ ex.credential }}</span>
            <span class="db__noteicon">
              <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
            </span>
          </button>
          <span v-else class="db__name" :class="{ 'db__name--me': !!ex.userId && ex.userId === sched.myUserId.value }">
            {{ ex.name }}<span v-if="ex.credential" class="db__cred"> - {{ ex.credential }}</span>
          </span>
          <span class="db__time">
            {{ ex.start }} – {{ ex.end }}
            <button
              v-if="sched.canEdit.value && ex.entryId"
              class="db__x"
              aria-label="Remove"
              @click="clearRow(ex.entryId)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="model.extraHours.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--extra">Extra Hours</h3>
      <div class="db__labeled">
        <div v-for="r in model.extraHours" :key="r.entryId" class="db__row">
          <span class="db__seat">{{ r.sub || 'Extra' }}</span>
          <button
            v-if="sched.canEdit.value"
            class="db__name db__name--btn"
            :class="{ 'db__name--me': !!r.userId && r.userId === sched.myUserId.value }"
            title="Edit or delete these extra hours"
            @click="editor.openExtra(props.dateIso, r)"
          >
            {{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span>
          </button>
          <span v-else class="db__name" :class="{ 'db__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
          <span class="db__time">
            {{ r.start }} – {{ r.end }}
            <button v-if="sched.canEdit.value" class="db__x" aria-label="Remove" @click="clearRow(r.entryId)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="model.trades.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--trade">Trades</h3>
      <div class="db__labeled">
        <div v-for="r in model.trades" :key="r.entryId" class="db__row">
          <span class="db__seat">{{ r.sub }}</span>
          <span class="db__name" :class="{ 'db__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
          <span class="db__time">{{ r.start }} – {{ r.end }}</span>
        </div>
      </div>
    </section>

    <section v-if="model.timeOff.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--off">Time Off</h3>
      <div class="db__labeled">
        <template v-for="r in model.timeOff" :key="r.entryId">
          <button
            v-if="sched.canEdit.value"
            class="db__row db__row--offbtn"
            title="Edit or remove this time off"
            @click="editor.openTimeOffEdit(props.dateIso, r)"
          >
            <span class="db__seat">{{ r.sub }}</span>
            <span class="db__name" :class="{ 'db__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
            <span class="db__time">{{ r.start }} – {{ r.end }}</span>
          </button>
          <div v-else class="db__row">
            <span class="db__seat">{{ r.sub }}</span>
            <span class="db__name" :class="{ 'db__name--me': !!r.userId && r.userId === sched.myUserId.value }">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
            <span class="db__time">{{ r.start }} – {{ r.end }}</span>
          </div>
        </template>
      </div>
    </section>

    <section v-if="model.events.length > 0 || sched.canEdit.value" class="db__station">
      <h3 class="db__station-name">Special events</h3>
      <p v-if="model.events.length === 0" class="db__empty">No events this day.</p>

      <div v-for="ev in model.events" :key="ev.label" class="db__event">
        <div class="db__event-head">
          <button
            class="db__event-name db__notebtn"
            :title="sched.eventTooltip(props.dateIso, ev)"
            @click="editor.openEventInfo(props.dateIso, ev)"
          >{{ ev.label }}</button>
          <button
            v-if="ev.notes"
            class="db__noteicon db__notebtn"
            :title="ev.notes ?? undefined"
            @click="editor.openNote({ title: ev.label, text: ev.notes ?? '', event: { dateIso: props.dateIso, label: ev.label, eventId: ev.eventId, startHm: ev.start, endHm: ev.end } })"
          >
            <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
          </button>
          <span v-if="ev.start" class="db__time">{{ ev.start }} – {{ ev.end }}</span>
          <span v-if="sched.canEdit.value" class="db__event-tools">
            <button class="db__tool db__tool--sm" @click="editor.openEvent(props.dateIso, ev)">
              Manage event
            </button>
          </span>
        </div>
        <p v-if="ev.location" class="db__evloc">{{ ev.location }}</p>
        <p v-if="ev.rows.length === 0" class="db__empty">No staff assigned.</p>
        <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="db__row">
          <span class="db__seat">{{ row.open ? row.name : 'Staff' }}</span>
          <button
            v-if="row.open"
            class="db__name db__name--open db__name--btn"
            @click="editor.openEventSlot(props.dateIso, ev, row)"
          >
            {{ row.name }} — open
          </button>
          <button
            v-else-if="sched.canEdit.value"
            class="db__name db__name--btn"
            :class="{ 'db__name--me': !!row.userId && row.userId === sched.myUserId.value }"
            title="Manage this event"
            @click="editor.openEvent(props.dateIso, ev)"
          >
            {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
          </button>
          <span
            v-else
            class="db__name"
            :class="{ 'db__name--me': !!row.userId && row.userId === sched.myUserId.value }"
          >
            {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
          </span>
          <span class="db__time">{{ row.start }} – {{ row.end }}</span>
        </div>
      </div>
    </section>

    <section v-if="model.pending.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--pend">Pending Requests</h3>
      <div class="db__labeled db__labeled--pend">
        <button
          v-for="r in model.pending"
          :key="r.id"
          class="db__row db__pendbtn"
          :title="sched.canEdit.value ? 'Review — approve or deny' : 'Your request — view or cancel'"
          @click="editor.openRequest(r.id)"
        >
          <span class="db__seat" :title="r.sub">{{ r.sub }}</span>
          <span class="db__name">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
          <span class="db__time">{{ r.start }} – {{ r.end }}</span>
        </button>
      </div>
      <p v-if="sched.canEdit.value" class="db__pendhint">Click a request to approve or deny it in place.</p>
    </section>

    <section v-if="model.unattached.length > 0" class="db__station">
      <h3 class="db__station-name">Other assignments</h3>
      <div v-for="ex in model.unattached" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
        <span class="db__seat">{{ ex.kind === 'student' ? 'Student' : 'Extra' }}</span>
        <button
          v-if="sched.canEdit.value && ex.kind === 'student' && ex.entryId"
          class="db__name db__name--btn"
          title="Edit this student"
          @click="editor.openStudent(props.dateIso, ex)"
        >
          {{ ex.name }}
        </button>
        <span v-else class="db__name">{{ ex.name }}</span>
        <span class="db__time">{{ ex.start }} – {{ ex.end }}</span>
      </div>
    </section>

    <p v-if="sched.rotation.value.length === 0" class="db__empty">
      No rotation template yet — assign crews to seats under Setup and the calendar fills in
      from the effective date forward.
    </p>
  </div>
</template>

<style scoped>
.db {
  max-width: 760px;
}

.db__meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.9rem;
  flex-wrap: wrap;
}

/* shift LETTER in shift color (2026-09-24) — chip chrome retired */
.db__platoon {
  display: inline-flex;
  align-items: baseline;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
}

.db__shl {
  font-weight: 800;
  font-size: 13px;
}

.db__shl[data-platoon='A'] {
  color: oklch(0.52 0.19 27);
}

.db__shl[data-platoon='B'] {
  color: oklch(0.44 0.16 262);
}

.db__shl[data-platoon='C'] {
  color: oklch(0.47 0.14 148);
}

.db__opencount {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-danger-500);
}

.db__tools {
  margin-left: auto;
  display: inline-flex;
  gap: 0.4rem;
}

.db__addlink {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  border: 0;
  background: none;
  color: var(--color-accent-700);
  cursor: pointer;
  white-space: nowrap;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-line);
  text-underline-offset: 3px;
}

.db__addlink:hover {
  text-decoration-color: var(--color-accent-600);
}

/* "+ Student" reads as a quiet link, not a button (2026-09-24) */
.db__tool {
  font: inherit;
  font-size: 0.74rem;
  font-weight: 650;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-accent-700);
  cursor: pointer;
  white-space: nowrap;
  margin-left: auto;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-line);
  text-underline-offset: 3px;
}

.db__tool:hover {
  text-decoration-color: var(--color-accent-600);
}

.db__tool--sm {
  font-size: 0.72rem;
  padding: 0.18rem 0.5rem;
}

.db__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.db__daynote,
.db__unitnote {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  background: var(--color-warning-50);
  border: 1px solid oklch(0.88 0.05 60);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  margin: 0 0 0.6rem;
}

.db__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
  vertical-align: middle;
}

.db__x svg {
  width: 12px;
  height: 12px;
}

.db__x:hover {
  color: var(--color-danger-500);
}

/* time-off rows are buttons for editors — row click opens the
   time-off editor (retime / retype / delete) */
.db__row--offbtn {
  font: inherit;
  border: 0;
  background: none;
  width: 100%;
  text-align: left;
  padding: 0;
  cursor: pointer;
}

.db__row--offbtn:hover .db__name {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.db__station {
  margin-bottom: 1.4rem;
}

.db__station-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.5rem;
}

.db__unit {
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  border-radius: 0;
  background: transparent;
  padding: 0.55rem 0.1rem 0.5rem;
  margin-bottom: 0;
  box-shadow: none;
}

.db__unit-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-line-soft);
  margin-bottom: 0.25rem;
}

.db__unit-code {
  font-weight: 700;
  color: var(--color-brand-700);
  font-size: 0.95rem;
}

.db__unit-label {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin-right: auto;
}

.db__row {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0.45rem;
  margin: 0 -0.45rem;
  border-bottom: 1px solid var(--color-line-soft);
}

/* subtle zebra — rows scan at a glance on busy days. Unit/event blocks
   lead with a header child, so their odd children are 2nd/4th rows;
   labeled sections are rows only, so even children are. */
/* zebra retired with the card chrome (2026-09-24) — hairlines carry
   the rows */

.db__row:last-child {
  border-bottom: 0;
}

.db__seat {
  font-size: 0.78rem;
  color: var(--color-muted);
}

.db__name {
  font-size: 0.92rem;
  color: var(--color-ink);
  font-weight: 500;
}

.db__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

/* Aladtec-style "that's me" highlight. */
.db__name--me {
  background: var(--me-hl, oklch(0.94 0.13 102));
  font-weight: 700;
  border-radius: 4px;
  padding: 0 4px;
}

.db__name--btn {
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 600;
  text-align: left;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.db__cred {
  color: var(--color-muted);
  font-weight: 400;
  font-size: 0.85rem;
}

.db__rot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-left: 6px;
  border: 1px solid var(--color-muted-soft);
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-muted);
  vertical-align: 1px;
}

.db__time {
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.db__row--extra .db__seat {
  color: var(--color-accent-700);
  font-weight: 600;
}

.db__event {
  border: 0;
  border-left: 2px solid var(--color-accent-600);
  background: color-mix(in oklab, var(--color-accent-600) 5%, transparent);
  border-radius: 0;
  padding: 0.55rem 0.8rem 0.5rem;
  margin: 0.6rem 0;
  box-shadow: none;
}

.db__event-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid oklch(0.92 0.03 86.8);
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.db__event-name {
  font-weight: 700;
  color: var(--color-accent-700);
  font-size: 0.95rem;
}

.db__event-tools {
  margin-left: auto;
  display: inline-flex;
  gap: 0.35rem;
}

.db__noteicon {
  display: inline-flex;
  cursor: pointer;
}

.db__notebtn {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.db__evloc {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 0.05rem 0 0.2rem;
}

.db__noteicon svg {
  width: 14px;
  height: 14px;
}

/* Bottom sections darkened + color-edged so they stop blending into
   the schedule above (Ng, day-1 feedback). */
.db__station-name--extra {
  color: var(--color-brand-700);
}

.db__station-name--trade {
  color: oklch(0.42 0.13 150);
}

.db__station-name--off {
  color: oklch(0.45 0.13 60);
}

.db__station-name--pend {
  color: var(--color-danger-500);
}

.db__labeled--pend {
  border-color: oklch(0.88 0.06 27);
  background: oklch(0.995 0.004 27);
}

.db__pendhint {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin: 0.35rem 0 0;
}

/* clickable pending-request row — inherits the db__row flex layout */
.db__pendbtn {
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.db__pendbtn:hover .db__name {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.db__labeled {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.3rem 0.8rem;
  box-shadow: var(--shadow-sm);
}

.db__labeled .db__seat {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.db__empty {
  color: var(--color-muted);
  font-size: 0.85rem;
}

@media (max-width: 560px) {
  .db__row {
    grid-template-columns: 1fr auto;
  }

  .db__seat {
    grid-column: 1 / -1;
    padding-top: 0.15rem;
  }
}

/* color-edge the labeled boxes to match their section headers */
.db__station-name--extra + .db__labeled {
  border-left: 3px solid var(--color-brand-700);
}

.db__station-name--trade + .db__labeled {
  border-left: 3px solid oklch(0.5 0.13 150);
}

.db__station-name--off + .db__labeled {
  border-left: 3px solid oklch(0.6 0.12 60);
}

.db__station-name--pend + .db__labeled {
  border-left: 3px solid var(--color-danger-500);
}
</style>
