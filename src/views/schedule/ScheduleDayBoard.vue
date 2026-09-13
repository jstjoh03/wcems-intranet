<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSchedule, type SeatRow, type DayEventBox } from '@/composables/useSchedule'

/**
 * Day board — one work date (0600 → 0600). Unit groups with seat rows,
 * then SPECIAL EVENTS in their own boxes (event name, assigned staff,
 * open event seats). Open seats/slots are clickable: crew file a pickup
 * request; editors can also assign someone directly. Editors add events,
 * students, and day/unit notes from here.
 */

const props = defineProps<{ dateIso: string }>()
const sched = useSchedule()

const model = computed(() => sched.dayModel(props.dateIso))

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
const notice = ref<string | null>(null)
const busy = ref(false)

// ── open seat / event slot modal ─────────────────────────────────────

interface SlotCtx {
  seatId: string | null
  entryId: string | null
  label: string
  start: string // 'HHmm'
  end: string
}
const slot = ref<SlotCtx | null>(null)
const slotFrom = ref('06:00')
const slotUntil = ref('06:00')
const slotComments = ref('')
const slotAssignee = ref('')

function toInput(hhmm4: string): string {
  return `${hhmm4.slice(0, 2)}:${hhmm4.slice(2)}`
}

function openSeatSlot(seatId: string, label: string, row: SeatRow) {
  slot.value = { seatId, entryId: row.entryId, label, start: row.start, end: row.end }
  slotFrom.value = toInput(row.start)
  slotUntil.value = toInput(row.end)
  slotComments.value = ''
  slotAssignee.value = ''
  err.value = notice.value = null
}

function openEventSlot(ev: DayEventBox, row: SeatRow) {
  slot.value = { seatId: null, entryId: row.entryId, label: `${ev.label} — ${row.name}`, start: row.start, end: row.end }
  slotFrom.value = toInput(row.start)
  slotUntil.value = toInput(row.end)
  slotComments.value = ''
  slotAssignee.value = ''
  err.value = notice.value = null
}

async function submitPickup() {
  if (!slot.value) return
  busy.value = true
  err.value = null
  const e = await sched.createPickupRequest({
    dateIso: props.dateIso,
    seatId: slot.value.seatId,
    entryId: slot.value.entryId,
    from: slotFrom.value,
    until: slotUntil.value,
    comments: slotComments.value,
    positionLabel: slot.value.label,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  slot.value = null
  notice.value = 'Pickup request submitted — pending approval.'
}

async function assignDirect() {
  if (!slot.value || !slotAssignee.value) return
  busy.value = true
  err.value = null
  let e: string | null
  if (slot.value.seatId) {
    e = await sched.assignOpenSeat({
      dateIso: props.dateIso,
      seatId: slot.value.seatId,
      entryId: slot.value.entryId,
      userId: slotAssignee.value,
      from: slotFrom.value,
      until: slotUntil.value,
    })
  } else if (slot.value.entryId) {
    e = await sched.assignEventSlot(slot.value.entryId, slotAssignee.value)
  } else {
    e = 'Nothing to assign.'
  }
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  slot.value = null
  notice.value = 'Assigned.'
}

// ── editor: add event ────────────────────────────────────────────────

const addingEvent = ref(false)
const evLabel = ref('')
const evFrom = ref('17:00')
const evUntil = ref('21:00')
const evMedics = ref(1)
const evAttendants = ref(1)
const evNotes = ref('')

async function submitEvent() {
  if (!evLabel.value.trim()) {
    err.value = 'Event name is required.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.addEvent({
    dateIso: props.dateIso,
    label: evLabel.value.trim(),
    from: evFrom.value,
    until: evUntil.value,
    paramedicSlots: Math.max(0, evMedics.value),
    attendantSlots: Math.max(0, evAttendants.value),
    notes: evNotes.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  addingEvent.value = false
  evLabel.value = evNotes.value = ''
}

const deleteArm = ref<string | null>(null)

async function deleteEvent(ev: DayEventBox) {
  const key = `${ev.label}`
  if (deleteArm.value !== key) {
    deleteArm.value = key
    return
  }
  deleteArm.value = null
  busy.value = true
  const e = await sched.deleteEventBox(props.dateIso, ev.label, ev.eventId)
  busy.value = false
  if (e) err.value = e
}

async function addSlotTo(ev: DayEventBox, title: string) {
  busy.value = true
  const from = ev.start ? toInput(ev.start) : '06:00'
  const until = ev.end ? toInput(ev.end) : '06:00'
  const e = await sched.addEventSlot(props.dateIso, ev.label, title, from, until)
  busy.value = false
  if (e) err.value = e
}

async function clearRow(entryId: string | null) {
  if (!entryId) return
  busy.value = true
  const e = await sched.removeEntry(entryId)
  busy.value = false
  if (e) err.value = e
}

async function unassignEventRow(entryId: string | null) {
  if (!entryId) return
  busy.value = true
  const e = await sched.assignEventSlot(entryId, null)
  busy.value = false
  if (e) err.value = e
}

// ── editor: add student ──────────────────────────────────────────────

const studentOnUnit = ref<string | null>(null)
const stProgram = ref('')
const stComment = ref('')
const stFrom = ref('06:00')
const stUntil = ref('18:00')

function startStudent(unitId: string) {
  studentOnUnit.value = studentOnUnit.value === unitId ? null : unitId
  stProgram.value = stComment.value = ''
  stFrom.value = '06:00'
  stUntil.value = '18:00'
}

async function submitStudent(unitId: string) {
  if (!stProgram.value.trim()) {
    err.value = 'School / program is required.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.addStudent({
    dateIso: props.dateIso,
    unitId,
    program: stProgram.value.trim(),
    comment: stComment.value.trim(),
    from: stFrom.value,
    until: stUntil.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  studentOnUnit.value = null
}

// ── editor: notes ────────────────────────────────────────────────────

const addingNote = ref(false)
const noteText = ref('')
const noteUnit = ref('')
const noteRemind = ref(false)

async function submitNote() {
  if (!noteText.value.trim()) return
  busy.value = true
  err.value = null
  const e = await sched.addDayNote({
    dateIso: props.dateIso,
    unitId: noteUnit.value || null,
    note: noteText.value.trim(),
    includeInReminders: noteRemind.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  addingNote.value = false
  noteText.value = ''
  noteRemind.value = false
}

async function removeNote(id: string) {
  busy.value = true
  const e = await sched.deleteDayNote(id)
  busy.value = false
  if (e) err.value = e
}
</script>

<template>
  <div class="db">
    <div class="db__meta">
      <span class="db__platoon" :data-platoon="model.platoon">
        <span class="db__dot" />{{ model.platoon }} Shift on duty
      </span>
      <span v-if="model.openCount > 0" class="db__opencount">
        {{ model.openCount }} open {{ model.openCount === 1 ? 'seat' : 'seats' }}
      </span>
      <span v-if="sched.canEdit.value" class="db__tools">
        <button class="db__tool" @click="addingEvent = !addingEvent">Add event</button>
        <button class="db__tool" @click="addingNote = !addingNote">Add note</button>
      </span>
    </div>

    <p v-if="notice" class="db__notice">{{ notice }}</p>
    <p v-if="err" class="db__error">{{ err }}</p>

    <form v-if="addingEvent" class="db__form" @submit.prevent="submitEvent">
      <div class="db__form-grid">
        <label class="db__field db__field--wide">
          <span>Event name</span>
          <input v-model="evLabel" type="text" class="db__input" placeholder="Royal HS Football" />
        </label>
        <label class="db__field"><span>From</span><input v-model="evFrom" type="time" class="db__input" /></label>
        <label class="db__field"><span>Until</span><input v-model="evUntil" type="time" class="db__input" /></label>
        <label class="db__field"><span>Paramedic seats</span><input v-model.number="evMedics" type="number" min="0" max="10" class="db__input" /></label>
        <label class="db__field"><span>Attendant seats</span><input v-model.number="evAttendants" type="number" min="0" max="10" class="db__input" /></label>
      </div>
      <label class="db__field"><span>Notes</span><input v-model="evNotes" type="text" class="db__input" placeholder="Optional" /></label>
      <div class="db__formbtns">
        <button type="submit" class="db__btn db__btn--primary" :disabled="busy">Create event</button>
        <button type="button" class="db__btn" @click="addingEvent = false">Cancel</button>
      </div>
    </form>

    <form v-if="addingNote" class="db__form" @submit.prevent="submitNote">
      <div class="db__form-grid">
        <label class="db__field db__field--wide">
          <span>Note</span>
          <input v-model="noteText" type="text" class="db__input" placeholder="Note for the day" />
        </label>
        <label class="db__field">
          <span>Attach to</span>
          <select v-model="noteUnit" class="db__input">
            <option value="">Whole day</option>
            <option v-for="u in sched.units.value" :key="u.id" :value="u.id">{{ u.code }}</option>
          </select>
        </label>
      </div>
      <label class="db__check">
        <input v-model="noteRemind" type="checkbox" /> Include in shift reminders
      </label>
      <div class="db__formbtns">
        <button type="submit" class="db__btn db__btn--primary" :disabled="busy">Save note</button>
        <button type="button" class="db__btn" @click="addingNote = false">Cancel</button>
      </div>
    </form>

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
            @click="startStudent(um.unit.id)"
          >
            + Student
          </button>
        </div>

        <form
          v-if="studentOnUnit === um.unit.id"
          class="db__form db__form--inline"
          @submit.prevent="submitStudent(um.unit.id)"
        >
          <input v-model="stProgram" type="text" class="db__input" placeholder="School / program" />
          <input v-model="stComment" type="text" class="db__input" placeholder="Student name (optional)" />
          <label>From <input v-model="stFrom" type="time" class="db__input db__input--time" /></label>
          <label>Until <input v-model="stUntil" type="time" class="db__input db__input--time" /></label>
          <button type="submit" class="db__btn db__btn--primary" :disabled="busy">Add</button>
        </form>

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
              @click="openSeatSlot(sm.seat.id, sm.seat.label, row)"
            >
              {{ sm.seat.label }}
            </button>
            <span v-else class="db__name">
              {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
              <span v-if="row.isRotation" class="db__rot" title="Regular rotation">R</span>
            </span>
            <span class="db__time">{{ row.start }} – {{ row.end }}</span>
          </div>
        </template>

        <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
          <span class="db__seat">{{ ex.kind === 'student' ? 'Student' : 'Extra' }}</span>
          <span class="db__name">
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

    <section v-if="model.events.length > 0 || sched.canEdit.value" class="db__station">
      <h3 class="db__station-name">Special events</h3>
      <p v-if="model.events.length === 0" class="db__empty">No events this day.</p>

      <div v-for="ev in model.events" :key="ev.label" class="db__event">
        <div class="db__event-head">
          <span class="db__event-name">{{ ev.label }}</span>
          <span v-if="ev.notes" class="db__noteicon" :title="ev.notes">
            <svg viewBox="0 0 24 24" fill="oklch(0.88 0.1 86.8)" stroke="oklch(0.6 0.11 86.8)" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /></svg>
          </span>
          <span v-if="ev.start" class="db__time">{{ ev.start }} – {{ ev.end }}</span>
          <span v-if="sched.canEdit.value" class="db__event-tools">
            <button class="db__tool db__tool--sm" @click="addSlotTo(ev, 'Paramedic')">+ Paramedic</button>
            <button class="db__tool db__tool--sm" @click="addSlotTo(ev, 'Attendant')">+ Attendant</button>
            <button class="db__tool db__tool--sm db__tool--danger" @click="deleteEvent(ev)">
              {{ deleteArm === ev.label ? 'Confirm delete' : 'Delete event' }}
            </button>
          </span>
        </div>
        <p v-if="ev.rows.length === 0" class="db__empty">No staff assigned.</p>
        <div v-for="row in ev.rows" :key="row.entryId ?? row.name" class="db__row">
          <span class="db__seat">{{ row.open ? row.name : 'Staff' }}</span>
          <button
            v-if="row.open"
            class="db__name db__name--open db__name--btn"
            @click="openEventSlot(ev, row)"
          >
            {{ row.name }} — open
          </button>
          <span v-else class="db__name">
            {{ row.name }}<span v-if="row.credential" class="db__cred"> - {{ row.credential }}</span>
          </span>
          <span class="db__time">
            {{ row.start }} – {{ row.end }}
            <template v-if="sched.canEdit.value && row.entryId">
              <button v-if="!row.open" class="db__x" aria-label="Unassign" title="Unassign" @click="unassignEventRow(row.entryId)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m17 8 5 5" /><path d="m22 8-5 5" /></svg>
              </button>
              <button class="db__x" aria-label="Remove slot" title="Remove slot" @click="clearRow(row.entryId)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </template>
          </span>
        </div>
      </div>
    </section>

    <section v-if="model.extraHours.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--extra">Extra Hours</h3>
      <div class="db__labeled">
        <div v-for="r in model.extraHours" :key="r.entryId" class="db__row">
          <span class="db__seat">{{ r.sub || 'Extra' }}</span>
          <span class="db__name">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
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
          <span class="db__name">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
          <span class="db__time">{{ r.start }} – {{ r.end }}</span>
        </div>
      </div>
    </section>

    <section v-if="model.timeOff.length > 0" class="db__station">
      <h3 class="db__station-name db__station-name--off">Time Off</h3>
      <div class="db__labeled">
        <div v-for="r in model.timeOff" :key="r.entryId" class="db__row">
          <span class="db__seat">{{ r.sub }}</span>
          <span class="db__name">{{ r.name }}<span v-if="r.credential" class="db__cred"> - {{ r.credential }}</span></span>
          <span class="db__time">
            {{ r.start }} – {{ r.end }}
            <button v-if="sched.canEdit.value" class="db__x" aria-label="Remove" @click="clearRow(r.entryId)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="model.unattached.length > 0" class="db__station">
      <h3 class="db__station-name">Other assignments</h3>
      <div v-for="ex in model.unattached" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
        <span class="db__seat">{{ ex.kind === 'student' ? 'Student' : 'Extra' }}</span>
        <span class="db__name">{{ ex.name }}</span>
        <span class="db__time">{{ ex.start }} – {{ ex.end }}</span>
      </div>
    </section>

    <p v-if="sched.rotation.value.length === 0" class="db__empty">
      No rotation template yet — assign crews to seats under Setup and the calendar fills in
      from the effective date forward.
    </p>

    <!-- open seat / slot modal -->
    <div v-if="slot" class="db__overlay" @click.self="slot = null">
      <div class="db__modal">
        <h3 class="db__modal-title">{{ slot.label }}</h3>
        <p class="db__modal-sub">{{ slot.start }} – {{ slot.end }}</p>
        <div class="db__times">
          <label>From <input v-model="slotFrom" type="time" class="db__input db__input--time" /></label>
          <label>Until <input v-model="slotUntil" type="time" class="db__input db__input--time" /></label>
        </div>
        <input v-model="slotComments" type="text" class="db__input" placeholder="Comments (optional)" />
        <button class="db__btn db__btn--primary" :disabled="busy" @click="submitPickup">
          Request this shift
        </button>

        <template v-if="sched.canEdit.value">
          <div class="db__modal-div">or assign directly</div>
          <select v-model="slotAssignee" class="db__input">
            <option value="">— choose a member —</option>
            <option v-for="p in sched.people.value" :key="p.id" :value="p.id">
              {{ p.fullName }}<template v-if="p.credential"> - {{ p.credential }}</template>
            </option>
          </select>
          <button class="db__btn" :disabled="busy || !slotAssignee" @click="assignDirect">Assign</button>
        </template>

        <button class="db__btn db__btn--ghost" @click="slot = null">Close</button>
      </div>
    </div>
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

.db__platoon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 3px 10px;
  background: var(--color-surface);
}

.db__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.db__platoon[data-platoon='A'] .db__dot {
  background: oklch(0.55 0.2 27);
}

.db__platoon[data-platoon='B'] .db__dot {
  background: oklch(0.5 0.16 255);
}

.db__platoon[data-platoon='C'] .db__dot {
  background: oklch(0.55 0.15 150);
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

.db__tool {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-brand-600);
  cursor: pointer;
  white-space: nowrap;
}

.db__tool--sm {
  font-size: 0.72rem;
  padding: 0.18rem 0.5rem;
}

.db__tool--danger {
  color: var(--color-danger-500);
}

.db__notice {
  color: var(--color-success-500);
  font-size: 0.85rem;
}

.db__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.db__form {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 0.7rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.db__form--inline {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0.4rem 0;
}

.db__form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;
}

.db__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.7rem;
  color: var(--color-muted);
}

.db__field--wide {
  grid-column: span 2;
}

.db__input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.32rem 0.45rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.db__input--time {
  width: 105px;
}

.db__check {
  font-size: 0.82rem;
  color: var(--color-ink-soft);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.db__formbtns {
  display: flex;
  gap: 0.4rem;
}

.db__btn {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.32rem 0.8rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.db__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.db__btn--ghost {
  border: 0;
  color: var(--color-muted);
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
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.6rem 0.8rem 0.5rem;
  margin-bottom: 0.6rem;
  box-shadow: var(--shadow-sm);
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
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

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
  border: 1px solid oklch(0.86 0.06 86.8);
  background: oklch(0.99 0.008 86.8);
  border-radius: 12px;
  padding: 0.6rem 0.8rem 0.5rem;
  margin-bottom: 0.6rem;
  box-shadow: var(--shadow-sm);
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
  cursor: help;
}

.db__noteicon svg {
  width: 14px;
  height: 14px;
}

.db__station-name--extra {
  color: var(--color-brand-700);
}

.db__station-name--trade {
  color: var(--color-success-500);
}

.db__station-name--off {
  color: oklch(0.5 0.13 60);
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

.db__overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 1rem;
}

.db__modal {
  background: var(--color-surface);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 1.1rem 1.2rem;
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.db__modal-title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--color-brand-800);
  margin: 0;
}

.db__modal-sub {
  font-size: 0.82rem;
  color: var(--color-muted);
  margin: -0.3rem 0 0;
  font-variant-numeric: tabular-nums;
}

.db__times {
  display: flex;
  gap: 0.7rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  align-items: center;
}

.db__modal-div {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-top: 0.2rem;
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
</style>
