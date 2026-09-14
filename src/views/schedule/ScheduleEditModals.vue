<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  useSchedule,
  platoonFor,
  type HoursWarning,
  type OpenSeatInfo,
} from '@/composables/useSchedule'
import { useScheduleEditor } from '@/composables/useScheduleEditor'

/**
 * The scheduling module's shared modals, rendered ONCE in ScheduleView.
 * Every calendar view opens them via useScheduleEditor(), so clicking a
 * person / open seat / student / event works the same on Month, Day,
 * Week, and Pay-period boards:
 *  - slot modal: crew pickup requests (with hour-threshold warnings) and
 *    the Chief's direct assign (unavailability + hours conflict overlay)
 *  - person modal: the Chief's day editor (off / remove / move / replace)
 *  - student modal: edit label, note, times, or remove a ride-along
 *  - event modal: per-event notes, slot management, delete
 *  - add modals: event / day note / student from any view
 */

const sched = useSchedule()
const editor = useScheduleEditor()

const busy = ref(false)
const err = ref<string | null>(null)
const notice = ref<string | null>(null)
let noticeTimer: number | undefined

function flash(msg: string): void {
  notice.value = msg
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = null), 4000)
}

function toInput(hhmm4: string): string {
  return `${hhmm4.slice(0, 2)}:${hhmm4.slice(2)}`
}

function fmtLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function fmtShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// ── conflict overlay (unavailability + hour thresholds) ──────────────

const conflict = ref<{
  title: string
  items: string[]
  leaveOpen: boolean
  proceed: () => Promise<void>
} | null>(null)
const conflictAcknowledged = ref(false)

async function conflictProceed(): Promise<void> {
  if (!conflict.value) return
  busy.value = true
  await conflict.value.proceed()
  busy.value = false
}

/** Unavailability + would-be hours for scheduling `userId` into a window. */
async function gatherConflicts(
  userId: string,
  dateIso: string,
  from: string,
  until: string,
): Promise<string[]> {
  const name = sched.personById.value.get(userId)?.fullName ?? 'This member'
  const [un, info] = await Promise.all([
    sched.checkUnavailable(userId, dateIso),
    sched.hoursCheckWindow(userId, dateIso, from, until, name),
  ])
  const items: string[] = []
  if (un) {
    items.push(
      `${name} marked ${fmtLong(dateIso)} unavailable${un.reason ? ` — "${un.reason}"` : ''}. Scheduling them anyway overrides that.`,
    )
  }
  for (const w of info.warnings) items.push(w.message)
  return items
}

// ── open seat / event slot modal ─────────────────────────────────────

const slotFrom = ref('06:00')
const slotUntil = ref('06:00')
const slotComments = ref('')
const slotAssignee = ref('')
const pickupWarn = ref<HoursWarning[] | null>(null)

watch(editor.slot, (s) => {
  if (!s) return
  slotFrom.value = toInput(s.start)
  slotUntil.value = toInput(s.end)
  slotComments.value = ''
  slotAssignee.value = ''
  pickupWarn.value = null
  err.value = null
})

watch([slotFrom, slotUntil], () => {
  pickupWarn.value = null
})

const pickupHasConfirm = computed(() =>
  (pickupWarn.value ?? []).some((w) => w.code === 'consecutive_confirm'),
)

async function submitPickup(): Promise<void> {
  const s = editor.slot.value
  if (!s || busy.value) return
  busy.value = true
  err.value = null
  // First pass: compute hour-threshold warnings and make the requester
  // acknowledge them; the acknowledged set is stored on the request so
  // the Chief sees exactly what the crew member saw.
  if (pickupWarn.value === null) {
    const me = sched.myUserId.value
    if (me) {
      const info = await sched.hoursCheckWindow(me, s.dateIso, slotFrom.value, slotUntil.value, 'You')
      if (info.warnings.length > 0) {
        pickupWarn.value = info.warnings
        busy.value = false
        return
      }
    }
    pickupWarn.value = []
  }
  const e = await sched.createPickupRequest({
    dateIso: s.dateIso,
    seatId: s.seatId,
    entryId: s.entryId,
    from: slotFrom.value,
    until: slotUntil.value,
    comments: slotComments.value,
    positionLabel: s.label,
    warnings: pickupWarn.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Pickup request submitted — pending approval.')
}

async function assignDirect(): Promise<void> {
  const s = editor.slot.value
  if (!s || !slotAssignee.value || busy.value) return
  busy.value = true
  if (!conflictAcknowledged.value) {
    const items = await gatherConflicts(slotAssignee.value, s.dateIso, slotFrom.value, slotUntil.value)
    if (items.length > 0) {
      const who = sched.personById.value.get(slotAssignee.value)?.fullName ?? 'This member'
      conflict.value = {
        title: `Before you schedule ${who}`,
        items,
        leaveOpen: false,
        proceed: async () => {
          conflictAcknowledged.value = true
          conflict.value = null
          await assignDirect()
          conflictAcknowledged.value = false
        },
      }
      busy.value = false
      return
    }
  }
  err.value = null
  let e: string | null
  if (s.seatId) {
    e = await sched.assignOpenSeat({
      dateIso: s.dateIso,
      seatId: s.seatId,
      entryId: s.entryId,
      userId: slotAssignee.value,
      from: slotFrom.value,
      until: slotUntil.value,
    })
  } else if (s.entryId) {
    e = await sched.assignEventSlot(s.entryId, slotAssignee.value)
  } else {
    e = 'Nothing to assign.'
  }
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Assigned.')
}

// ── Chief person day-edit modal ──────────────────────────────────────

type EditAction = '' | 'off' | 'remove' | 'move' | 'replace'
const editAction = ref<EditAction>('')
const editOffType = ref('vacation')
const editFrom = ref('06:00')
const editUntil = ref('06:00')
const editScope = ref<'day' | 'permanent'>('day')
const editReplaceWith = ref('')
const editMoveTo = ref('')
const editOpenSeats = ref<OpenSeatInfo[]>([])

watch(editor.person, (p) => {
  if (!p) return
  editAction.value = ''
  editOffType.value = 'vacation'
  editFrom.value = toInput(p.start)
  editUntil.value = toInput(p.end)
  editScope.value = 'day'
  editReplaceWith.value = ''
  editMoveTo.value = ''
  conflict.value = null
  err.value = null
  editOpenSeats.value = sched.openSeatsFor(p.dateIso).filter((s) => s.seatId !== p.seatId)
})

async function runEdit(): Promise<void> {
  const ctx = editor.person.value
  if (!ctx) return
  busy.value = true
  err.value = null
  let e: string | null = null
  try {
    if (editAction.value === 'off') {
      e = await sched.dayMarkOff({
        dateIso: ctx.dateIso,
        seatId: ctx.seatId,
        userId: ctx.userId,
        offType: editOffType.value,
        from: editFrom.value,
        until: editUntil.value,
      })
    } else if (editAction.value === 'remove') {
      if (editScope.value === 'permanent') {
        e = await sched.assignRotation(ctx.seatId, platoonFor(ctx.dateIso), null, ctx.dateIso)
        // template change covers rotation days; entry-backed today needs
        // the day-scope removal too
        if (!e && sched.holdsViaOverride(ctx.userId, ctx.seatId, ctx.dateIso)) {
          e = await sched.dayRemove({ dateIso: ctx.dateIso, seatId: ctx.seatId, userId: ctx.userId })
        }
      } else {
        e = await sched.dayRemove({ dateIso: ctx.dateIso, seatId: ctx.seatId, userId: ctx.userId })
      }
    } else if (editAction.value === 'move') {
      const target = editOpenSeats.value.find(
        (s) => `${s.seatId}|${s.entryId ?? ''}` === editMoveTo.value,
      )
      if (!target) e = 'Pick an open seat to move them to.'
      else {
        e = await sched.dayMove({
          dateIso: ctx.dateIso,
          fromSeatId: ctx.seatId,
          toSeatId: target.seatId,
          toEntryId: target.entryId,
          userId: ctx.userId,
          from: toInput(target.start),
          until: toInput(target.end),
        })
      }
    } else if (editAction.value === 'replace') {
      if (!editReplaceWith.value) {
        e = 'Pick a replacement.'
      } else {
        const items = await gatherConflicts(
          editReplaceWith.value,
          ctx.dateIso,
          editFrom.value,
          editUntil.value,
        )
        if (items.length > 0) {
          const who = sched.personById.value.get(editReplaceWith.value)?.fullName ?? 'This member'
          conflict.value = {
            title: `Before you schedule ${who}`,
            items,
            leaveOpen: true,
            proceed: async () => {
              await applyReplace()
            },
          }
          busy.value = false
          return
        }
        await applyReplace()
        busy.value = false
        return
      }
    }
  } finally {
    busy.value = false
  }
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Done.')
}

async function applyReplace(): Promise<void> {
  const ctx = editor.person.value
  if (!ctx) return
  let e: string | null
  if (editScope.value === 'permanent') {
    e = await sched.assignRotation(
      ctx.seatId,
      platoonFor(ctx.dateIso),
      editReplaceWith.value,
      ctx.dateIso,
    )
    // entry-backed today: also swap the day's rows
    if (!e && sched.holdsViaOverride(ctx.userId, ctx.seatId, ctx.dateIso)) {
      e = await sched.dayReplace({
        dateIso: ctx.dateIso,
        seatId: ctx.seatId,
        fromUserId: ctx.userId,
        toUserId: editReplaceWith.value,
        from: '06:00',
        until: '06:00',
      })
    }
  } else {
    e = await sched.dayReplace({
      dateIso: ctx.dateIso,
      seatId: ctx.seatId,
      fromUserId: ctx.userId,
      toUserId: editReplaceWith.value,
      from: editFrom.value,
      until: editUntil.value,
    })
  }
  if (e) {
    err.value = e
    return
  }
  conflict.value = null
  editor.closeAll()
  flash('Done.')
}

async function conflictLeaveOpen(): Promise<void> {
  const ctx = editor.person.value
  if (!ctx) return
  busy.value = true
  // open only the window the blocked replace was for, not the whole day
  const e = await sched.dayOpenWindow({
    dateIso: ctx.dateIso,
    seatId: ctx.seatId,
    userId: ctx.userId,
    from: editFrom.value,
    until: editUntil.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  conflict.value = null
  editor.closeAll()
  flash('Seat posted as open.')
}

// ── approved extra-hours editor ──────────────────────────────────────

const exFrom = ref('06:00')
const exUntil = ref('06:00')
const exArm = ref(false)

watch(editor.extra, (x) => {
  if (!x) return
  exFrom.value = toInput(x.start)
  exUntil.value = toInput(x.end)
  exArm.value = false
  err.value = null
})

async function saveExtra(): Promise<void> {
  const x = editor.extra.value
  if (!x || busy.value) return
  busy.value = true
  err.value = null
  const e = await sched.updateEntryWindow(x.entryId, x.dateIso, exFrom.value, exUntil.value)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Extra hours updated.')
}

async function removeExtra(): Promise<void> {
  const x = editor.extra.value
  if (!x || busy.value) return
  if (!exArm.value) {
    exArm.value = true
    return
  }
  busy.value = true
  const e = await sched.removeEntry(x.entryId)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash(x.canUnassign ? 'Seat removed.' : 'Extra hours removed.')
}

/** Rider seats: clear the person, keep the seat posted open. */
async function unassignExtra(): Promise<void> {
  const x = editor.extra.value
  if (!x || busy.value) return
  busy.value = true
  err.value = null
  const e = await sched.assignEventSlot(x.entryId, null)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Unassigned — the seat is open again.')
}

// ── student modal ────────────────────────────────────────────────────

const stLabel = ref('')
const stNote = ref('')
const stFrom = ref('06:00')
const stUntil = ref('18:00')
const stArm = ref(false)

watch(editor.student, (s) => {
  if (!s) return
  stLabel.value = s.label
  stNote.value = s.note
  stFrom.value = toInput(s.start)
  stUntil.value = toInput(s.end)
  stArm.value = false
  err.value = null
})

async function saveStudent(): Promise<void> {
  const s = editor.student.value
  if (!s || busy.value) return
  if (!stLabel.value.trim()) {
    err.value = 'School / program is required.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.updateStudentEntry({
    entryId: s.entryId,
    dateIso: s.dateIso,
    label: stLabel.value,
    note: stNote.value,
    from: stFrom.value,
    until: stUntil.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Student updated.')
}

async function removeStudent(): Promise<void> {
  const s = editor.student.value
  if (!s || busy.value) return
  if (!stArm.value) {
    stArm.value = true
    return
  }
  busy.value = true
  const e = await sched.removeEntry(s.entryId)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Student removed.')
}

// ── event modal ──────────────────────────────────────────────────────

const evNotes = ref('')
const evArm = ref(false)

watch(editor.eventEdit, (ev) => {
  if (!ev) return
  evNotes.value = ev.notes ?? ''
  evArm.value = false
  err.value = null
})

/** Live view of the event box (rows change as slots are managed). */
const eventBox = computed(() => {
  const ctx = editor.eventEdit.value
  if (!ctx) return null
  return sched.dayModel(ctx.dateIso).events.find((e) => e.label === ctx.label) ?? null
})

async function saveEventNotes(): Promise<void> {
  const ctx = editor.eventEdit.value
  if (!ctx || busy.value) return
  busy.value = true
  err.value = null
  const box = eventBox.value
  // A box with no sched_events listing yet (imported history) gets one
  // created to hold the note — default its times to the staffing rows.
  const rows = box?.rows ?? []
  const start = box?.start ?? ctx.start ?? rows[0]?.start ?? null
  const end = box?.end ?? ctx.end ?? rows[rows.length - 1]?.end ?? null
  const e = await sched.setEventNotes(
    ctx.dateIso,
    ctx.label,
    box?.eventId ?? ctx.eventId,
    start,
    end,
    evNotes.value,
  )
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Event note saved.')
}

async function evAddSlot(title: string): Promise<void> {
  const ctx = editor.eventEdit.value
  if (!ctx || busy.value) return
  busy.value = true
  err.value = null
  const from = ctx.start ? toInput(ctx.start) : '06:00'
  const until = ctx.end ? toInput(ctx.end) : '06:00'
  const e = await sched.addEventSlot(ctx.dateIso, ctx.label, title, from, until)
  busy.value = false
  if (e) err.value = e
}

async function evUnassign(entryId: string | null): Promise<void> {
  if (!entryId || busy.value) return
  busy.value = true
  const e = await sched.assignEventSlot(entryId, null)
  busy.value = false
  if (e) err.value = e
}

async function evRemoveRow(entryId: string | null): Promise<void> {
  if (!entryId || busy.value) return
  busy.value = true
  const e = await sched.removeEntry(entryId)
  busy.value = false
  if (e) err.value = e
}

async function evDelete(): Promise<void> {
  const ctx = editor.eventEdit.value
  if (!ctx || busy.value) return
  if (!evArm.value) {
    evArm.value = true
    return
  }
  busy.value = true
  const e = await sched.deleteEventBox(ctx.dateIso, ctx.label, eventBox.value?.eventId ?? ctx.eventId)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Event deleted.')
}

// ── add modals (event / note / student) ──────────────────────────────

const aeLabel = ref('')
const aeFrom = ref('17:00')
const aeUntil = ref('21:00')
const aeMedics = ref(1)
const aeAttendants = ref(1)
const aeNotes = ref('')

const noteText = ref('')
const noteUnit = ref('')
const noteRemind = ref(false)

const asProgram = ref('')
const asComment = ref('')
const asFrom = ref('06:00')
const asUntil = ref('18:00')
const asUnit = ref('')

const rsUnit = ref('')
const RS_POSITIONS = ['Attendant', 'Paramedic', 'Observer', 'FTO Trainee', '3rd Rider'] as const
const rsLabelChoice = ref<string>('Attendant') // '__other' = free text
const rsLabelCustom = ref('')
const rsCount = ref(1)
const rsFrom = ref('06:00')
const rsUntil = ref('06:00')
const rsStart = ref('')
const rsEnd = ref('')

watch(editor.add, (a) => {
  if (!a) return
  err.value = null
  aeLabel.value = aeNotes.value = ''
  aeFrom.value = '17:00'
  aeUntil.value = '21:00'
  aeMedics.value = 1
  aeAttendants.value = 1
  noteText.value = ''
  noteUnit.value = ''
  noteRemind.value = false
  asProgram.value = asComment.value = ''
  asFrom.value = '06:00'
  asUntil.value = '18:00'
  asUnit.value = a.unitId ?? ''
  rsUnit.value = a.unitId ?? ''
  rsLabelChoice.value = 'Attendant'
  rsLabelCustom.value = ''
  rsCount.value = 1
  rsFrom.value = '06:00'
  rsUntil.value = '06:00'
  rsStart.value = a.dateIso
  rsEnd.value = a.dateIso
})

function pickAdd(kind: 'event' | 'note' | 'student' | 'seat'): void {
  if (editor.add.value) editor.add.value.kind = kind
}

async function submitAddSeat(): Promise<void> {
  const a = editor.add.value
  if (!a || busy.value) return
  const label = rsLabelChoice.value === '__other' ? rsLabelCustom.value.trim() : rsLabelChoice.value
  if (!label) {
    err.value = 'Give the seat a position label.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.addRiderSeats({
    unitId: rsUnit.value,
    label,
    from: rsFrom.value,
    until: rsUntil.value,
    startDate: rsStart.value,
    endDate: rsEnd.value,
    count: rsCount.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Extra seat added — it shows open on the unit until filled.')
}

async function submitAddEvent(): Promise<void> {
  const a = editor.add.value
  if (!a) return
  if (!aeLabel.value.trim()) {
    err.value = 'Event name is required.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.addEvent({
    dateIso: a.dateIso,
    label: aeLabel.value.trim(),
    from: aeFrom.value,
    until: aeUntil.value,
    paramedicSlots: Math.max(0, aeMedics.value),
    attendantSlots: Math.max(0, aeAttendants.value),
    notes: aeNotes.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Event created.')
}

async function submitAddNote(): Promise<void> {
  const a = editor.add.value
  if (!a || !noteText.value.trim()) return
  busy.value = true
  err.value = null
  const e = await sched.addDayNote({
    dateIso: a.dateIso,
    unitId: noteUnit.value || null,
    note: noteText.value.trim(),
    includeInReminders: noteRemind.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Note saved.')
}

async function submitAddStudent(): Promise<void> {
  const a = editor.add.value
  if (!a) return
  if (!asProgram.value.trim()) {
    err.value = 'School / program is required.'
    return
  }
  if (!asUnit.value) {
    err.value = 'Pick the unit the student rides with.'
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.addStudent({
    dateIso: a.dateIso,
    unitId: asUnit.value,
    program: asProgram.value.trim(),
    comment: asComment.value.trim(),
    from: asFrom.value,
    until: asUntil.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  editor.closeAll()
  flash('Student added.')
}
</script>

<template>
  <div class="em">
    <!-- toast -->
    <transition name="em-toast">
      <p v-if="notice" class="em__toast">{{ notice }}</p>
    </transition>

    <!-- conflict overlay (unavailability + hour thresholds) -->
    <div v-if="conflict" class="em__overlay">
      <div class="em__modal">
        <h3 class="em__title">{{ conflict.title }}</h3>
        <ul class="em__warnlist">
          <li v-for="(item, i) in conflict.items" :key="i">{{ item }}</li>
        </ul>
        <p v-if="err" class="em__error">{{ err }}</p>
        <button class="em__btn em__btn--primary" :disabled="busy" @click="conflictProceed">
          Schedule anyway
        </button>
        <button
          v-if="conflict.leaveOpen && editor.person.value"
          class="em__btn"
          :disabled="busy"
          @click="conflictLeaveOpen"
        >
          Post the seat as open instead
        </button>
        <button class="em__btn em__btn--ghost" @click="conflict = null">Go back</button>
      </div>
    </div>

    <!-- open seat / event slot -->
    <div
      v-else-if="editor.slot.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <h3 class="em__title">{{ editor.slot.value.label }}</h3>
        <p class="em__sub">
          {{ fmtShort(editor.slot.value.dateIso) }} ·
          {{ editor.slot.value.start }} – {{ editor.slot.value.end }}
        </p>
        <div class="em__times">
          <label>From <input v-model="slotFrom" type="time" class="em__input em__input--time" /></label>
          <label>Until <input v-model="slotUntil" type="time" class="em__input em__input--time" /></label>
        </div>
        <input v-model="slotComments" type="text" class="em__input" placeholder="Comments (optional)" />
        <div v-if="pickupWarn && pickupWarn.length" class="em__warnbox">
          <p class="em__warnhead">Before you request this:</p>
          <ul class="em__warnlist">
            <li v-for="(w, i) in pickupWarn" :key="i">{{ w.message }}</li>
          </ul>
        </div>
        <p v-if="err" class="em__error">{{ err }}</p>

        <!-- Editors lead with assignment (their actual job); the crew's
             request-a-shift flow is the secondary path for them. -->
        <template v-if="sched.canEdit.value">
          <select v-model="slotAssignee" class="em__input">
            <option value="">— assign a member —</option>
            <option v-for="p in sched.people.value" :key="p.id" :value="p.id">
              {{ p.fullName }}<template v-if="p.credential"> - {{ p.credential }}</template>
            </option>
          </select>
          <button
            class="em__btn em__btn--primary"
            :disabled="busy || !slotAssignee"
            @click="assignDirect"
          >
            Assign to this shift
          </button>
          <div class="em__div">or file it as a request for yourself</div>
          <button class="em__btn" :disabled="busy" @click="submitPickup">
            {{
              pickupWarn && pickupWarn.length
                ? pickupHasConfirm
                  ? 'I understand — request admin approval'
                  : 'Request anyway'
                : 'Request this shift'
            }}
          </button>
        </template>
        <button v-else class="em__btn em__btn--primary" :disabled="busy" @click="submitPickup">
          {{
            pickupWarn && pickupWarn.length
              ? pickupHasConfirm
                ? 'I understand — request admin approval'
                : 'Request anyway'
              : 'Request this shift'
          }}
        </button>

        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <!-- approved extra-hours editor -->
    <div
      v-else-if="editor.extra.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <h3 class="em__title">{{ editor.extra.value.name }}</h3>
        <p class="em__sub">
          {{ editor.extra.value.canUnassign ? '' : 'Extra hours · ' }}{{ fmtShort(editor.extra.value.dateIso) }}
          <template v-if="editor.extra.value.sub"> · {{ editor.extra.value.sub }}</template>
        </p>
        <div class="em__times">
          <label>From <input v-model="exFrom" type="time" class="em__input em__input--time" /></label>
          <label>Until <input v-model="exUntil" type="time" class="em__input em__input--time" /></label>
        </div>
        <p v-if="err" class="em__error">{{ err }}</p>
        <button class="em__btn em__btn--primary" :disabled="busy" @click="saveExtra">
          {{ busy ? 'Working…' : 'Save new times' }}
        </button>
        <button
          v-if="editor.extra.value.canUnassign"
          class="em__btn"
          :disabled="busy"
          @click="unassignExtra"
        >
          Unassign — post the seat open again
        </button>
        <button class="em__btn em__btn--danger" :disabled="busy" @click="removeExtra">
          {{
            exArm
              ? editor.extra.value.canUnassign
                ? 'Confirm — remove this seat'
                : 'Confirm — remove these hours'
              : editor.extra.value.canUnassign
                ? 'Remove this seat entirely'
                : 'Delete these hours'
          }}
        </button>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <!-- Chief person day editor -->
    <div
      v-else-if="editor.person.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <h3 class="em__title">{{ editor.person.value.personName }}</h3>
        <p class="em__sub">
          {{ editor.person.value.unitCode }} {{ editor.person.value.seatLabel }} ·
          {{ fmtShort(editor.person.value.dateIso) }} ·
          {{ editor.person.value.start }} – {{ editor.person.value.end }}
        </p>

        <div class="em__actions">
          <button
            v-for="[k, label] in ([['off','Mark time off'],['remove','Remove from day'],['move','Move to open seat'],['replace','Replace with…']] as const)"
            :key="k"
            class="em__btn"
            :class="{ 'em__btn--primary': editAction === k }"
            @click="editAction = editAction === k ? '' : k"
          >
            {{ label }}
          </button>
        </div>

        <template v-if="editAction === 'off'">
          <select v-model="editOffType" class="em__input">
            <option value="vacation">Vacation</option>
            <option value="sick">Sick</option>
            <option value="unpaid">Unpaid time off</option>
            <option value="bereavement">Bereavement</option>
            <option value="other">Other</option>
          </select>
          <div class="em__times">
            <label>From <input v-model="editFrom" type="time" class="em__input em__input--time" /></label>
            <label>Until <input v-model="editUntil" type="time" class="em__input em__input--time" /></label>
          </div>
        </template>

        <template v-else-if="editAction === 'remove'">
          <div class="em__scope">
            <label><input v-model="editScope" type="radio" value="day" /> This day only</label>
            <label><input v-model="editScope" type="radio" value="permanent" /> Permanent from this date (template change)</label>
          </div>
        </template>

        <template v-else-if="editAction === 'move'">
          <select v-model="editMoveTo" class="em__input">
            <option value="" disabled>— open seats today —</option>
            <option v-for="s in editOpenSeats" :key="s.seatId + (s.entryId ?? '')" :value="`${s.seatId}|${s.entryId ?? ''}`">
              {{ s.unitCode }} {{ s.seatLabel }} · {{ s.start }} – {{ s.end }}
            </option>
          </select>
          <p v-if="editOpenSeats.length === 0" class="em__empty">No open seats today.</p>
        </template>

        <template v-else-if="editAction === 'replace'">
          <select v-model="editReplaceWith" class="em__input">
            <option value="">— choose a member —</option>
            <option
              v-for="p in sched.people.value.filter((x) => x.id !== editor.person.value!.userId)"
              :key="p.id"
              :value="p.id"
            >
              {{ p.fullName }}<template v-if="p.credential"> - {{ p.credential }}</template>
            </option>
          </select>
          <div class="em__times">
            <label>From <input v-model="editFrom" type="time" class="em__input em__input--time" /></label>
            <label>Until <input v-model="editUntil" type="time" class="em__input em__input--time" /></label>
          </div>
          <div class="em__scope">
            <label><input v-model="editScope" type="radio" value="day" /> This day only</label>
            <label><input v-model="editScope" type="radio" value="permanent" /> Permanent from this date (template change)</label>
          </div>
        </template>

        <p v-if="err" class="em__error">{{ err }}</p>
        <button v-if="editAction" class="em__btn em__btn--primary" :disabled="busy" @click="runEdit">
          {{ busy ? 'Working…' : 'Apply' }}
        </button>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <!-- student editor -->
    <div
      v-else-if="editor.student.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <h3 class="em__title">Student rider</h3>
        <p class="em__sub">{{ fmtShort(editor.student.value.dateIso) }}</p>
        <label class="em__field">
          <span>School / program (and name)</span>
          <input v-model="stLabel" type="text" class="em__input" placeholder="Lonestar (J. Smith)" />
        </label>
        <label class="em__field">
          <span>Note</span>
          <input v-model="stNote" type="text" class="em__input" placeholder="Pertinent info — precepting goals, contact…" />
        </label>
        <div class="em__times">
          <label>From <input v-model="stFrom" type="time" class="em__input em__input--time" /></label>
          <label>Until <input v-model="stUntil" type="time" class="em__input em__input--time" /></label>
        </div>
        <p v-if="err" class="em__error">{{ err }}</p>
        <button class="em__btn em__btn--primary" :disabled="busy" @click="saveStudent">
          {{ busy ? 'Working…' : 'Save changes' }}
        </button>
        <button class="em__btn em__btn--danger" :disabled="busy" @click="removeStudent">
          {{ stArm ? 'Confirm — remove from schedule' : 'Remove from schedule' }}
        </button>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <!-- event editor -->
    <div
      v-else-if="editor.eventEdit.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <h3 class="em__title">{{ editor.eventEdit.value.label }}</h3>
        <p class="em__sub">
          {{ fmtShort(editor.eventEdit.value.dateIso) }}
          <template v-if="editor.eventEdit.value.start">
            · {{ editor.eventEdit.value.start }} – {{ editor.eventEdit.value.end }}
          </template>
        </p>

        <label class="em__field">
          <span>Event note (shows on hover everywhere)</span>
          <textarea v-model="evNotes" class="em__input em__textarea" rows="3" placeholder="Staging location, contacts, radio channel…" />
        </label>
        <button class="em__btn" :disabled="busy" @click="saveEventNotes">Save note</button>

        <template v-if="eventBox">
          <div class="em__div">staffing</div>
          <p v-if="eventBox.rows.length === 0" class="em__empty">No slots yet.</p>
          <div v-for="row in eventBox.rows" :key="row.entryId ?? row.name" class="em__evrow">
            <span class="em__evname" :class="{ 'em__evname--open': row.open }">
              {{ row.open ? `${row.name} — open` : row.name }}
            </span>
            <span class="em__evtime">{{ row.start }} – {{ row.end }}</span>
            <span class="em__evtools">
              <button v-if="!row.open" class="em__mini" :disabled="busy" @click="evUnassign(row.entryId)">Unassign</button>
              <button class="em__mini em__mini--danger" :disabled="busy" @click="evRemoveRow(row.entryId)">Remove</button>
            </span>
          </div>
          <div class="em__evadd">
            <button class="em__btn" :disabled="busy" @click="evAddSlot('Paramedic')">+ Paramedic</button>
            <button class="em__btn" :disabled="busy" @click="evAddSlot('Attendant')">+ Attendant</button>
          </div>
        </template>

        <p v-if="err" class="em__error">{{ err }}</p>
        <button class="em__btn em__btn--danger" :disabled="busy" @click="evDelete">
          {{ evArm ? 'Confirm — delete event and its slots' : 'Delete event' }}
        </button>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <!-- add: menu / event / note / student -->
    <div
      v-else-if="editor.add.value"
      class="em__overlay"
      @click.self="editor.closeAll()"
    >
      <div class="em__modal">
        <template v-if="editor.add.value.kind === 'menu'">
          <h3 class="em__title">{{ fmtLong(editor.add.value.dateIso) }}</h3>
          <p class="em__sub">Add to this day</p>
          <button class="em__btn" @click="pickAdd('event')">Add a special event</button>
          <button class="em__btn" @click="pickAdd('note')">Add a note</button>
          <button class="em__btn" @click="pickAdd('student')">Add a student</button>
          <button class="em__btn" @click="pickAdd('seat')">Add an extra seat (3rd rider)</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
        </template>

        <template v-else-if="editor.add.value.kind === 'seat'">
          <h3 class="em__title">Add an extra seat</h3>
          <p class="em__sub">
            A third-rider seat on a unit — observers, new hires in field training. It shows
            open on the unit until someone claims it or you assign them.
          </p>
          <label class="em__field">
            <span>Unit</span>
            <select v-model="rsUnit" class="em__input">
              <option value="" disabled>— choose a unit —</option>
              <option v-for="u in sched.units.value.filter((x) => x.active)" :key="u.id" :value="u.id">{{ u.code }}</option>
            </select>
          </label>
          <div class="em__times">
            <label class="em__field">
              <span>Position</span>
              <select v-model="rsLabelChoice" class="em__input">
                <option v-for="p in RS_POSITIONS" :key="p" :value="p">{{ p }}</option>
                <option value="__other">Other…</option>
              </select>
            </label>
            <label class="em__field">
              <span>Seats</span>
              <input v-model.number="rsCount" type="number" min="1" max="4" class="em__input em__input--num" />
            </label>
          </div>
          <label v-if="rsLabelChoice === '__other'" class="em__field">
            <span>Position label</span>
            <input v-model="rsLabelCustom" type="text" class="em__input" placeholder="e.g. Ride-along RN" />
          </label>
          <div class="em__times">
            <label>Start date <input v-model="rsStart" type="date" class="em__input" /></label>
            <label>End date <input v-model="rsEnd" type="date" class="em__input" /></label>
          </div>
          <div class="em__times">
            <label>From <input v-model="rsFrom" type="time" class="em__input em__input--time" /></label>
            <label>Until <input v-model="rsUntil" type="time" class="em__input em__input--time" /></label>
          </div>
          <p v-if="err" class="em__error">{{ err }}</p>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="submitAddSeat">
            {{ busy ? 'Working…' : 'Add extra seat' }}
          </button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Cancel</button>
        </template>

        <template v-else-if="editor.add.value.kind === 'event'">
          <h3 class="em__title">Add event</h3>
          <p class="em__sub">{{ fmtLong(editor.add.value.dateIso) }}</p>
          <label class="em__field">
            <span>Event name</span>
            <input v-model="aeLabel" type="text" class="em__input" placeholder="Royal HS Football" />
          </label>
          <div class="em__times">
            <label>From <input v-model="aeFrom" type="time" class="em__input em__input--time" /></label>
            <label>Until <input v-model="aeUntil" type="time" class="em__input em__input--time" /></label>
          </div>
          <div class="em__times">
            <label>Paramedic seats <input v-model.number="aeMedics" type="number" min="0" max="10" class="em__input em__input--num" /></label>
            <label>Attendant seats <input v-model.number="aeAttendants" type="number" min="0" max="10" class="em__input em__input--num" /></label>
          </div>
          <label class="em__field">
            <span>Notes</span>
            <input v-model="aeNotes" type="text" class="em__input" placeholder="Optional" />
          </label>
          <p v-if="err" class="em__error">{{ err }}</p>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="submitAddEvent">Create event</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Cancel</button>
        </template>

        <template v-else-if="editor.add.value.kind === 'note'">
          <h3 class="em__title">Add note</h3>
          <p class="em__sub">{{ fmtLong(editor.add.value.dateIso) }}</p>
          <label class="em__field">
            <span>Note</span>
            <input v-model="noteText" type="text" class="em__input" placeholder="Note for the day" />
          </label>
          <label class="em__field">
            <span>Attach to</span>
            <select v-model="noteUnit" class="em__input">
              <option value="">Whole day</option>
              <option v-for="u in sched.units.value.filter((x) => x.active)" :key="u.id" :value="u.id">{{ u.code }}</option>
            </select>
          </label>
          <label class="em__check">
            <input v-model="noteRemind" type="checkbox" /> Include in shift reminders
          </label>
          <p v-if="err" class="em__error">{{ err }}</p>
          <button class="em__btn em__btn--primary" :disabled="busy || !noteText.trim()" @click="submitAddNote">Save note</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Cancel</button>
        </template>

        <template v-else>
          <h3 class="em__title">Add student</h3>
          <p class="em__sub">{{ fmtLong(editor.add.value.dateIso) }}</p>
          <label class="em__field">
            <span>Rides with</span>
            <select v-model="asUnit" class="em__input">
              <option value="" disabled>— choose a unit —</option>
              <option v-for="u in sched.units.value.filter((x) => x.active)" :key="u.id" :value="u.id">{{ u.code }}</option>
            </select>
          </label>
          <label class="em__field">
            <span>School / program</span>
            <input v-model="asProgram" type="text" class="em__input" placeholder="Lonestar" />
          </label>
          <label class="em__field">
            <span>Student name (optional)</span>
            <input v-model="asComment" type="text" class="em__input" />
          </label>
          <div class="em__times">
            <label>From <input v-model="asFrom" type="time" class="em__input em__input--time" /></label>
            <label>Until <input v-model="asUntil" type="time" class="em__input em__input--time" /></label>
          </div>
          <p v-if="err" class="em__error">{{ err }}</p>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="submitAddStudent">Add student</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Cancel</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.em__toast {
  position: fixed;
  bottom: 1.2rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  background: var(--color-brand-800);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  margin: 0;
}

.em-toast-enter-active,
.em-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.em-toast-enter-from,
.em-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

.em__overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 1rem;
}

.em__modal {
  background: var(--color-surface);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 1.1rem 1.2rem;
  width: min(400px, 100%);
  max-height: min(85vh, 700px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.em__title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--color-brand-800);
  margin: 0;
}

.em__sub {
  font-size: 0.82rem;
  color: var(--color-muted);
  margin: -0.3rem 0 0;
  font-variant-numeric: tabular-nums;
}

.em__field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.7rem;
  color: var(--color-muted);
}

.em__input {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.32rem 0.45rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink);
}

.em__input--time {
  width: 105px;
}

.em__input--num {
  width: 64px;
}

.em__textarea {
  resize: vertical;
  font-family: inherit;
}

.em__times {
  display: flex;
  gap: 0.7rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  align-items: center;
  flex-wrap: wrap;
}

.em__check {
  font-size: 0.82rem;
  color: var(--color-ink-soft);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.em__btn {
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

.em__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.em__btn--danger {
  color: var(--color-danger-500);
}

.em__btn--ghost {
  border: 0;
  color: var(--color-muted);
}

.em__btn:disabled {
  opacity: 0.6;
}

.em__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.em__scope {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.82rem;
  color: var(--color-ink-soft);
}

.em__scope label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.em__div {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-top: 0.2rem;
}

.em__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
  margin: 0;
}

.em__empty {
  color: var(--color-muted);
  font-size: 0.85rem;
  margin: 0;
}

.em__warnbox {
  border: 1px solid oklch(0.85 0.08 60);
  background: var(--color-warning-50);
  border-radius: 9px;
  padding: 0.5rem 0.7rem;
}

.em__warnhead {
  font-size: 0.78rem;
  font-weight: 700;
  color: oklch(0.45 0.12 60);
  margin: 0 0 0.25rem;
}

.em__warnlist {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.em__evrow {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.84rem;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0.2rem 0;
}

.em__evname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink);
}

.em__evname--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.em__evtime {
  font-size: 0.76rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: auto;
}

.em__evtools {
  display: inline-flex;
  gap: 0.3rem;
  flex: none;
}

.em__mini {
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.em__mini--danger {
  color: var(--color-danger-500);
}

.em__evadd {
  display: flex;
  gap: 0.4rem;
}
</style>
