<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import TimeSelect24 from '@/views/schedule/TimeSelect24.vue'
import {
  useSchedule,
  platoonFor,
  payPeriodFor,
  hhmm,
  OFF_LABELS,
  REQ_TYPE_LABELS,
  type HoursWarning,
  type OpenSeatInfo,
  type SchedRequest,
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
  /** When set, these replace "Schedule anyway" — each is a distinct
   *  resolution (rotation swap vs. leave-the-old-seat-open). */
  choices?: { label: string; run: () => Promise<void> }[]
} | null>(null)

async function conflictProceed(): Promise<void> {
  if (!conflict.value) return
  busy.value = true
  await conflict.value.proceed()
  busy.value = false
}

async function conflictChoice(run: () => Promise<void>): Promise<void> {
  busy.value = true
  await run()
  busy.value = false
}

/** Double-booking + unavailability + would-be hours for scheduling
 *  `userId` into a window. */
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
  for (const o of sched.dayOverlaps(userId, dateIso, from, until)) {
    items.push(
      `${name} already works ${o.label} ${o.window} that day — this would double-book them.`,
    )
  }
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
  void loadSlotPickups(s)
})

/* Admins opening an open seat see who has already asked for it — name,
   when they asked, and their hours picture, so the drawer answers "who
   should get this?" without a trip to the queue (Justin, 2026-09-24). */
interface SlotPickup {
  id: string
  name: string
  submitted: string
  line: string
  warnings: HoursWarning[]
}
const slotPickups = ref<SlotPickup[]>([])

async function loadSlotPickups(s: { dateIso: string; seatId: string | null; entryId?: string | null }) {
  slotPickups.value = []
  if (!sched.canEdit.value) return
  const matches = sched.requests.value
    .filter(
      (r) =>
        r.type === 'pickup' &&
        r.status === 'pending' &&
        (s.entryId ? r.entryId === s.entryId : r.workDate === s.dateIso && r.seatId === s.seatId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const out: SlotPickup[] = []
  for (const r of matches) {
    const who = sched.personById.value.get(r.requesterId)
    let line = ''
    let warnings: HoursWarning[] = []
    if (r.workDate && r.startAt && r.endAt) {
      const info = await sched.hoursCheck(
        r.requesterId,
        [{ dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt }],
        who?.fullName ?? 'They',
      )
      line = `${info.weekHours}h week · ${info.periodHours}h period · ${info.consecutiveHours}h consecutive`
      warnings = info.warnings
    }
    out.push({
      id: r.id,
      name: who?.fullName ?? 'Unknown',
      submitted: new Date(r.createdAt).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      line,
      warnings,
    })
  }
  slotPickups.value = out
}

function slotWarnShort(w: HoursWarning): string {
  if (w.code === 'weekly') return `${w.hours}h week`
  if (w.code === 'ot') return 'Overtime'
  if (w.code === 'consecutive' || w.code === 'consecutive_confirm') return `${w.hours}h consecutive`
  return w.code
}

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
  const items = await gatherConflicts(slotAssignee.value, s.dateIso, slotFrom.value, slotUntil.value)
  if (items.length > 0) {
    const who = sched.personById.value.get(slotAssignee.value)?.fullName ?? 'This member'
    conflict.value = {
      title: `Before you schedule ${who}`,
      items,
      leaveOpen: false,
      /* Calls the unguarded worker, NOT assignDirect — conflictProceed
         holds `busy` while running this, and assignDirect's re-entry
         guard would silently no-op (Rhonda's bug: "Schedule anyway"
         bounced her back to the assign modal without assigning). */
      proceed: async () => {
        await applyAssign()
      },
    }
    busy.value = false
    return
  }
  await applyAssign()
  busy.value = false
}

/** The actual assignment write — no busy guard so the conflict
 *  overlay's proceed can run it. */
async function applyAssign(): Promise<void> {
  const s = editor.slot.value
  if (!s || !slotAssignee.value) return
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
  conflict.value = null
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
const editLeaveBal = ref<number | null>(null)
const editOffArm = ref(false)

/* Balance context for the paid mark-off: the admin may go negative,
   but only past a warning and a second click. */
watch([editor.person, editOffType], async ([pv, ot]) => {
  editLeaveBal.value = null
  editOffArm.value = false
  if (!pv || (ot !== 'vacation' && ot !== 'sick')) return
  const proj = await sched.projectedLeaveBalance(pv.userId, ot as 'vacation' | 'sick', pv.dateIso)
  editLeaveBal.value = proj.projected
})
const editOffHours = computed(() => {
  const [fh, fm] = editFrom.value.split(':').map(Number)
  const [uh, um] = editUntil.value.split(':').map(Number)
  const mins = (uh * 60 + um - (fh * 60 + fm) + 1440) % 1440
  return (mins === 0 ? 1440 : mins) / 60
})
const editLeaveShort = computed(
  () => editLeaveBal.value !== null && editOffHours.value > editLeaveBal.value + 0.01,
)

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
  if (
    editAction.value === 'off' &&
    (editOffType.value === 'vacation' || editOffType.value === 'sick') &&
    editLeaveShort.value &&
    !editOffArm.value
  ) {
    editOffArm.value = true
    return
  }
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
        const who = sched.personById.value.get(editReplaceWith.value)?.fullName ?? 'This member'
        const items = await gatherConflicts(
          editReplaceWith.value,
          ctx.dateIso,
          editFrom.value,
          editUntil.value,
        )
        // Permanent replace: if the replacement already holds a rotation
        // seat, Save becomes a choice — swap the two people, or move
        // them here and leave their old seat open.
        const rc =
          editScope.value === 'permanent'
            ? sched.findRotationClashes(
                editReplaceWith.value,
                ctx.seatId,
                platoonFor(ctx.dateIso),
                ctx.dateIso,
              )[0]
            : undefined
        if (rc) {
          const outgoing = sched.personById.value.get(ctx.userId)?.fullName ?? 'The current holder'
          conflict.value = {
            title: `Before you schedule ${who}`,
            items: [
              ...items,
              `${who} currently holds ${rc.seatTitle} on ${rc.platoon} Shift — one person can't hold two rotation seats.`,
            ],
            leaveOpen: false,
            proceed: async () => {},
            choices: [
              {
                label: `Swap the two — ${outgoing} takes ${rc.seatTitle} (${rc.platoon} Shift)`,
                run: () => applyReplaceResolved('swap'),
              },
              {
                label: `Move ${who} here only — leave ${rc.seatTitle} open`,
                run: () => applyReplaceResolved('open'),
              },
            ],
          }
          busy.value = false
          return
        }
        if (items.length > 0) {
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

/** Permanent replace where the replacement holds another rotation seat:
 *  one stroke moves them here and settles their old seat per the choice. */
async function applyReplaceResolved(resolution: 'swap' | 'open'): Promise<void> {
  const ctx = editor.person.value
  if (!ctx) return
  let e = await sched.assignRotationResolved(
    ctx.seatId,
    platoonFor(ctx.dateIso),
    editReplaceWith.value,
    ctx.dateIso,
    resolution,
  )
  // entry-backed today: also swap the day's rows (template covers the
  // rotation days that render from it)
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

/** The details card needs the event date spelled out, Aladtec-style. */
const evInfoWhen = computed(() => {
  const i = editor.eventInfo.value
  if (!i) return ''
  const d = new Date(i.dateIso + 'T12:00:00')
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const hm = (t: string | null) => (t && t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) : '')
  return i.ev.start ? `${day} at ${hm(i.ev.start)} \u2013 ${hm(i.ev.end)}` : day
})
function manageFromInfo(): void {
  const i = editor.eventInfo.value
  if (!i) return
  editor.openEvent(i.dateIso, i.ev)
}

// ── event modal ──────────────────────────────────────────────────────

const evNotes = ref('')
const evLocation = ref('')
const evArm = ref(false)

watch(editor.eventEdit, (ev) => {
  if (!ev) return
  evNotes.value = ev.notes ?? ''
  evLocation.value = ev.location ?? ''
  evArm.value = false
  err.value = null
})

/** Live view of the event box (rows change as slots are managed). */
const eventBox = computed(() => {
  const ctx = editor.eventEdit.value
  if (!ctx) return null
  return sched.dayModel(ctx.dateIso).events.find((e) => e.label === ctx.label) ?? null
})

function eventListingArgs(): [string, string, string | null, string | null, string | null] | null {
  const ctx = editor.eventEdit.value
  if (!ctx) return null
  const box = eventBox.value
  // A box with no sched_events listing yet (imported history) gets one
  // created to hold the fields — default its times to the staffing rows.
  const rows = box?.rows ?? []
  const start = box?.start ?? ctx.start ?? rows[0]?.start ?? null
  const end = box?.end ?? ctx.end ?? rows[rows.length - 1]?.end ?? null
  return [ctx.dateIso, ctx.label, box?.eventId ?? ctx.eventId, start, end]
}

async function saveEventNotes(): Promise<void> {
  const args = eventListingArgs()
  if (!args || busy.value) return
  busy.value = true
  err.value = null
  const e = await sched.updateEventListing(...args, { notes: evNotes.value, location: evLocation.value })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Event details saved.')
}

async function toggleEventDouble(val: boolean): Promise<void> {
  const args = eventListingArgs()
  if (!args || busy.value) return
  busy.value = true
  err.value = null
  const e = await sched.updateEventListing(...args, { doubleTime: val })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash(val ? 'Marked double time.' : 'Marked regular pay.')
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
const aeLocation = ref('')
const aeDouble = ref(true)

const noteText = ref('')
const noteUnit = ref('')
const noteRemind = ref(false)

const asProgram = ref('')
const asComment = ref('')
const asFrom = ref('06:00')
const asUntil = ref('18:00')
const asUnit = ref('')

const rsUnit = ref('')
const riderOptions = computed(() => sched.riderPositions())
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
  aeDouble.value = true
  noteText.value = ''
  noteUnit.value = ''
  noteRemind.value = false
  asProgram.value = asComment.value = ''
  asFrom.value = '06:00'
  asUntil.value = '18:00'
  asUnit.value = a.unitId ?? ''
  rsUnit.value = a.unitId ?? ''
  rsLabelChoice.value = riderOptions.value[0] ?? 'Attendant'
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
    location: aeLocation.value,
    doubleTime: aeDouble.value,
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
// ── my-shift self-service (crew: time off / trade / giveaway) ───────

type MyShiftMode = 'menu' | 'off' | 'trade' | 'giveaway'
const msMode = ref<MyShiftMode>('menu')
const msOffType = ref('vacation')
const msFrom = ref('06:00')
const msUntil = ref('06:00')
const msComment = ref('')
/* '' = the public trade board; a user id = sent directly to that
   member (they already talked it out — the system catches up). */
const msTo = ref('')

/* people arrives last-name sorted from the store (personSortKey). */
const msToCandidates = computed(() =>
  sched.people.value.filter((p) => p.id !== sched.myUserId.value),
)

watch(
  () => editor.myShift.value,
  (v) => {
    msMode.value = 'menu'
    msOffType.value = 'vacation'
    msComment.value = ''
    msTo.value = ''
    err.value = null
    if (v) {
      msFrom.value = toInput(v.start)
      msUntil.value = toInput(v.end)
    }
  },
)

async function msSubmit() {
  const ctx = editor.myShift.value
  if (!ctx || msMode.value === 'menu') return
  busy.value = true
  err.value = null
  let e: string | null
  if (msMode.value === 'off') {
    e = await sched.createTimeOffRequests(
      msOffType.value,
      [{ dateIso: ctx.dateIso, from: msFrom.value, until: msUntil.value, seatId: ctx.seatId }],
      msComment.value,
    )
  } else {
    e = await sched.createTradePosting({
      type: msMode.value,
      dateIso: ctx.dateIso,
      seatId: ctx.seatId,
      from: msFrom.value,
      until: msUntil.value,
      comments: msComment.value,
      toUserId: msTo.value || null,
    })
  }
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  const toName = msTo.value ? (sched.personById.value.get(msTo.value)?.fullName ?? '') : ''
  flash(
    msMode.value === 'off'
      ? 'Time-off request submitted — pending approval.'
      : toName
        ? `Sent to ${toName} — they'll get a notification to respond.`
        : msMode.value === 'trade'
          ? 'Trade posted — offers land on the Trades tab.'
          : 'Giveaway posted — claims land on the Trades tab.',
  )
  editor.closeAll()
}

// ── note viewer / editor ─────────────────────────────────────────────

const noteBody = ref('')

watch(
  () => editor.note.value,
  (v) => {
    noteBody.value = v?.text ?? ''
    err.value = null
  },
)

async function noteSave() {
  const ctx = editor.note.value
  if (!ctx?.event) return
  busy.value = true
  err.value = null
  const ev = ctx.event
  const e = await sched.updateEventListing(ev.dateIso, ev.label, ev.eventId, ev.startHm, ev.endHm, {
    notes: noteBody.value,
  })
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Note saved.')
  editor.closeAll()
}

// unit/day notes (sched_day_notes rows) edit in the same modal
const unitNoteDrafts = ref<{ id: string; text: string }[]>([])
const noteDelArm = ref<string | null>(null)

watch(
  () => editor.note.value,
  (v) => {
    unitNoteDrafts.value = (v?.dayNotes ?? []).map((n) => ({ id: n.id, text: n.note }))
    noteDelArm.value = null
  },
)

async function unitNoteSave(d: { id: string; text: string }) {
  busy.value = true
  err.value = null
  const e = await sched.updateDayNote(d.id, d.text.trim())
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Note saved.')
  editor.closeAll()
}

async function unitNoteDelete(d: { id: string }) {
  if (noteDelArm.value !== d.id) {
    noteDelArm.value = d.id
    return
  }
  busy.value = true
  err.value = null
  const e = await sched.deleteDayNote(d.id)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Note deleted.')
  editor.closeAll()
}

// ── pending request (opened from the red calendar rows) ─────────────

const reqObj = computed(() =>
  editor.request.value
    ? (sched.requests.value.find((r) => r.id === editor.request.value?.requestId) ?? null)
    : null,
)
const reqHours = ref<{ lines: string[]; warnings: HoursWarning[] }>({ lines: [], warnings: [] })
const reqConfirm = ref(false)

watch(reqObj, (r) => {
  err.value = null
  reqConfirm.value = false
  reqHours.value = { lines: [], warnings: [] }
  if (r && sched.canEdit.value && (r.status === 'pending' || r.status === 'partner_accepted')) {
    void computeReqHours(r)
  }
})

function personName(id: string | null): string {
  return (id && sched.personById.value.get(id)?.fullName) || 'Unknown'
}

/** Live would-be hours for whoever GAINS time — same subjects the
 *  Requests queue computes, so the inline decision sees the same
 *  numbers as the dedicated tab. */
async function computeReqHours(r: SchedRequest) {
  const subs: { userId: string; dateIso: string; startAt: string; endAt: string; name: string }[] = []
  if ((r.type === 'pickup' || r.type === 'extra_hours') && r.workDate && r.startAt && r.endAt) {
    subs.push({ userId: r.requesterId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name: personName(r.requesterId) })
  } else if (r.type === 'giveaway' && r.counterpartyId && r.workDate && r.startAt && r.endAt) {
    subs.push({ userId: r.counterpartyId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name: personName(r.counterpartyId) })
  } else if (r.type === 'trade') {
    if (r.counterpartyId && r.workDate && r.startAt && r.endAt) {
      subs.push({ userId: r.counterpartyId, dateIso: r.workDate, startAt: r.startAt, endAt: r.endAt, name: personName(r.counterpartyId) })
    }
    if (r.counterpartyId && r.counterWorkDate && r.counterStartAt && r.counterEndAt) {
      subs.push({ userId: r.requesterId, dateIso: r.counterWorkDate, startAt: r.counterStartAt, endAt: r.counterEndAt, name: personName(r.requesterId) })
    }
  }
  const lines: string[] = []
  const warnings: HoursWarning[] = []
  for (const s of subs) {
    const info = await sched.hoursCheck(s.userId, [{ dateIso: s.dateIso, startAt: s.startAt, endAt: s.endAt }], s.name)
    lines.push(`${s.name}: ${info.weekHours}h week · ${info.periodHours}h period · ${info.consecutiveHours}h consecutive`)
    warnings.push(...info.warnings)
  }
  /* Paid time off: the requester's balance rides with the hours chips,
     and a shortage arms the same second-click confirm (going negative
     is the approver's deliberate call). */
  if (r.type === 'time_off' && (r.offType === 'vacation' || r.offType === 'sick') && r.startAt && r.endAt && r.workDate) {
    const hrs = (Date.parse(r.endAt) - Date.parse(r.startAt)) / 3600e3
    const proj = await sched.projectedLeaveBalance(r.requesterId, r.offType, r.workDate)
    lines.push(
      `${OFF_LABELS[r.offType] ?? r.offType} balance ${proj.today.toFixed(1)}h` +
      (proj.accruing > 0 ? ` → ${proj.projected.toFixed(1)}h by ${fmtShort(r.workDate)} with accruals` : '') +
      ` — this request ${hrs.toFixed(1)}h → ${(proj.projected - hrs).toFixed(1)}h after`,
    )
    if (hrs > proj.projected + 0.01) {
      warnings.push({ code: 'leave_short', hours: hrs, limit: proj.projected, message: `Only ${proj.projected.toFixed(1)} ${OFF_LABELS[r.offType] ?? r.offType} hrs by ${fmtShort(r.workDate)} (accruals counted) — approving goes ${(hrs - proj.projected).toFixed(1)}h negative.` })
    }
  }
  if (reqObj.value?.id === r.id) reqHours.value = { lines, warnings }
}

/** Chips shown before deciding: live warnings win over stored ones. */
const reqChips = computed<HoursWarning[]>(() => {
  const r = reqObj.value
  if (!r) return []
  const stored = (r.warnings as HoursWarning[]).filter(
    (w) => w && typeof w === 'object' && 'code' in w && 'message' in w,
  )
  const live = reqHours.value.warnings
  const seen = new Set(live.map((w) => w.code))
  return [...live, ...stored.filter((w) => !seen.has(w.code))]
})

const reqTitle = computed(() => {
  const r = reqObj.value
  if (!r) return 'Request'
  return `${REQ_TYPE_LABELS[r.type] ?? r.type} — ${personName(r.requesterId)}`
})

const reqRows = computed<[string, string][]>(() => {
  const r = reqObj.value
  if (!r) return []
  const rows: [string, string][] = []
  if (r.workDate) rows.push(['Date', fmtShort(r.workDate)])
  if (r.startAt && r.endAt) rows.push(['Time', `${hhmm(r.startAt)} – ${hhmm(r.endAt)}`])
  if (r.type === 'time_off') rows.push(['Type', OFF_LABELS[r.offType ?? ''] ?? r.offType ?? '—'])
  const pos = [r.unitCode, r.positionLabel].filter(Boolean).join(' ')
  if (pos) rows.push(['Shift', pos])
  if (r.type === 'extra_hours' && r.timeType) rows.push(['Time type', r.timeType])
  if (r.counterpartyId) rows.push([r.type === 'trade' ? 'Partner' : 'Claimed by', personName(r.counterpartyId)])
  if (r.type === 'trade' && r.counterWorkDate && r.counterStartAt && r.counterEndAt) {
    const cSeat = sched.seats.value.find((s) => s.id === r.counterSeatId)
    const cUnit = sched.units.value.find((u) => u.id === cSeat?.unitId)
    const cWho = r.counterpartyId
      ? (sched.personById.value.get(r.counterpartyId)?.fullName ?? 'Partner')
      : 'Partner'
    const cSeatTitle = `${cUnit?.code ?? ''} ${cSeat?.label ?? ''}`.trim()
    rows.push([
      'In return',
      `${cWho} gives ${fmtShort(r.counterWorkDate)}${cSeatTitle ? ` ${cSeatTitle}` : ''} ${hhmm(r.counterStartAt)} – ${hhmm(r.counterEndAt)}`,
    ])
    if (r.workDate && payPeriodFor(r.workDate).start !== payPeriodFor(r.counterWorkDate).start) {
      rows.push([
        'Pay periods',
        `Crosses periods (${payPeriodFor(r.workDate).label} ⇄ ${payPeriodFor(r.counterWorkDate).label}) — same-period swaps preferred, your call.`,
      ])
    }
  }
  if (r.comments) rows.push(['Comments', r.comments])
  rows.push(['Status', r.status === 'partner_accepted' ? 'Partner accepted — awaiting approval' : r.status === 'pending' ? 'Pending approval' : r.status])
  return rows
})

const reqIsMine = computed(() => reqObj.value?.requesterId === sched.myUserId.value)
/** Trades/giveaways aren't approvable until both members agree —
 *  a still-pending swap must not show Approve here (or in the queue). */
const reqDecidable = computed(() => {
  const r = reqObj.value
  if (!r || !sched.canEdit.value) return false
  if (r.status === 'partner_accepted') return true
  if (r.status !== 'pending') return false
  return r.type !== 'trade' && r.type !== 'giveaway'
})
const reqAwaitingMembers = computed(() => {
  const r = reqObj.value
  return (
    !!r &&
    sched.canEdit.value &&
    r.status === 'pending' &&
    (r.type === 'trade' || r.type === 'giveaway')
  )
})

async function reqDecide(approve: boolean) {
  const r = reqObj.value
  if (!r) return
  if (approve) {
    const needsConfirm = reqChips.value.some(
      (w) => w.code === 'consecutive_confirm' || w.code === 'check_failed' || w.code === 'leave_short',
    )
    if (needsConfirm && !reqConfirm.value) {
      reqConfirm.value = true
      return
    }
  }
  busy.value = true
  err.value = null
  const e = await sched.decideRequest(r, approve, '')
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash(approve ? 'Request approved.' : 'Request denied.')
  editor.closeAll()
}

/** The Chief already made this change by hand on the boards — close the
 *  request as approved without writing anything to the calendar. She
 *  decides from the month view's request drawer, so the third
 *  disposition lives here too (2026-09-25). */
async function reqMarkHandled() {
  const r = reqObj.value
  if (!r) return
  busy.value = true
  err.value = null
  const e = await sched.decideRequest(r, true, '', true)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Marked handled — the calendar was left as-is.')
  editor.closeAll()
}

async function reqCancel() {
  const r = reqObj.value
  if (!r) return
  busy.value = true
  err.value = null
  const e = await sched.cancelRequest(r.id)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  flash('Request cancelled.')
  editor.closeAll()
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
        <template v-if="conflict.choices">
          <button
            v-for="(c, i) in conflict.choices"
            :key="i"
            class="em__btn"
            :class="{ 'em__btn--primary': i === 0 }"
            :disabled="busy"
            @click="conflictChoice(c.run)"
          >
            {{ c.label }}
          </button>
        </template>
        <template v-else>
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
        </template>
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
          <label>From <TimeSelect24 v-model="slotFrom" class="em__input em__input--time" /></label>
          <label>Until <TimeSelect24 v-model="slotUntil" class="em__input em__input--time" /></label>
        </div>
        <input v-model="slotComments" type="text" class="em__input" placeholder="Comments (optional)" />
        <div v-if="pickupWarn && pickupWarn.length" class="em__warnbox">
          <p class="em__warnhead">Before you request this:</p>
          <ul class="em__warnlist">
            <li v-for="(w, i) in pickupWarn" :key="i">{{ w.message }}</li>
          </ul>
        </div>
        <p v-if="err" class="em__error">{{ err }}</p>

        <!-- who has already asked for this shift, in arrival order -->
        <div v-if="sched.canEdit.value && slotPickups.length" class="em__pickups">
          <p class="em__pickhead">Pickup requests — first come, first listed</p>
          <div v-for="pk in slotPickups" :key="pk.id" class="em__pickrow">
            <p class="em__pickmain">
              <span class="em__pickname">{{ pk.name }}</span>
              <span class="em__picksub">asked {{ pk.submitted }}</span>
            </p>
            <p class="em__pickhours">
              {{ pk.line }}
              <span v-for="(w, i) in pk.warnings" :key="i" class="em__pickwarn" :title="w.message">{{ slotWarnShort(w) }}</span>
            </p>
          </div>
          <p class="em__picknote">Approve or deny on the Requests tab — approving fills this seat.</p>
        </div>

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
        <button
          v-else-if="sched.canRequest.value"
          class="em__btn em__btn--primary"
          :disabled="busy"
          @click="submitPickup"
        >
          {{
            pickupWarn && pickupWarn.length
              ? pickupHasConfirm
                ? 'I understand — request admin approval'
                : 'Request anyway'
              : 'Request this shift'
          }}
        </button>
        <p v-else class="em__sub">
          Your access is view-only — contact the office if you need to pick up a shift.
        </p>

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
          <label>From <TimeSelect24 v-model="exFrom" class="em__input em__input--time" /></label>
          <label>Until <TimeSelect24 v-model="exUntil" class="em__input em__input--time" /></label>
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
            <label>From <TimeSelect24 v-model="editFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="editUntil" class="em__input em__input--time" /></label>
          </div>
          <p v-if="editLeaveBal !== null" class="em__leavebal" :class="{ 'em__leavebal--short': editLeaveShort }">
            {{ editOffType === 'vacation' ? 'Vacation' : 'Sick' }} balance by this date (accruals counted): {{ editLeaveBal.toFixed(1) }}h —
            this marks off {{ editOffHours.toFixed(1) }}h → {{ (editLeaveBal - editOffHours).toFixed(1) }}h after.
            <template v-if="editOffArm"> Click Apply again to confirm the negative balance.</template>
          </p>
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
            <label>From <TimeSelect24 v-model="editFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="editUntil" class="em__input em__input--time" /></label>
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
          <label>From <TimeSelect24 v-model="stFrom" class="em__input em__input--time" /></label>
          <label>Until <TimeSelect24 v-model="stUntil" class="em__input em__input--time" /></label>
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
          <span>Location</span>
          <input v-model="evLocation" type="text" class="em__input" placeholder="Royal High School - Falcon Stadium" />
        </label>
        <label class="em__field">
          <span>Description (shows on hover everywhere)</span>
          <textarea v-model="evNotes" class="em__input em__textarea" rows="3" placeholder="Non-dedicated event, contacts, radio channel…" />
        </label>
        <button class="em__btn" :disabled="busy" @click="saveEventNotes">Save details</button>
        <label class="em__check">
          <input
            type="checkbox"
            :checked="(eventBox?.doubleTime ?? true)"
            :disabled="busy"
            @change="toggleEventDouble(($event.target as HTMLInputElement).checked)"
          />
          Double-time event (staffed hours pay 2× on the Paycom export)
        </label>

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
                <option v-for="p in riderOptions" :key="p" :value="p">{{ p }}</option>
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
            <label>From <TimeSelect24 v-model="rsFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="rsUntil" class="em__input em__input--time" /></label>
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
            <label>From <TimeSelect24 v-model="aeFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="aeUntil" class="em__input em__input--time" /></label>
          </div>
          <div class="em__times">
            <label>Paramedic seats <input v-model.number="aeMedics" type="number" min="0" max="10" class="em__input em__input--num" /></label>
            <label>Attendant seats <input v-model.number="aeAttendants" type="number" min="0" max="10" class="em__input em__input--num" /></label>
          </div>
          <label class="em__field">
            <span>Location</span>
            <input v-model="aeLocation" type="text" class="em__input" placeholder="Royal High School - Falcon Stadium" />
          </label>
          <label class="em__field">
            <span>Notes</span>
            <input v-model="aeNotes" type="text" class="em__input" placeholder="Optional" />
          </label>
          <label class="em__check">
            <input v-model="aeDouble" type="checkbox" />
            Double-time event (staffed hours pay 2× on the Paycom export)
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
            <input v-model="noteBody" type="text" class="em__input" placeholder="Note for the day" />
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
          <button class="em__btn em__btn--primary" :disabled="busy || !noteBody.trim()" @click="submitAddNote">Save note</button>
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
            <label>From <TimeSelect24 v-model="asFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="asUntil" class="em__input em__input--time" /></label>
          </div>
          <p v-if="err" class="em__error">{{ err }}</p>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="submitAddStudent">Add student</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Cancel</button>
        </template>
      </div>
    </div>

    <!-- ── my shift: crew self-service (Aladtec's tap-your-shift trio) ── -->
    <div v-if="editor.myShift.value" class="em__overlay" @click.self="editor.closeAll()">
      <div class="em__modal">
        <h3 class="em__title">Your shift</h3>
        <p class="em__sub">
          {{ editor.myShift.value.unitCode }} {{ editor.myShift.value.seatLabel }} ·
          {{ fmtLong(editor.myShift.value.dateIso) }} ·
          {{ editor.myShift.value.start }}-{{ editor.myShift.value.end }}
        </p>
        <p v-if="err" class="em__error">{{ err }}</p>

        <template v-if="msMode === 'menu'">
          <button class="em__btn em__btn--primary" @click="msMode = 'off'">Request time off</button>
          <button class="em__btn" @click="msMode = 'trade'">Post as a trade (swap)</button>
          <button class="em__btn" @click="msMode = 'giveaway'">Give this shift away</button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
        </template>

        <template v-else>
          <select v-if="msMode === 'off'" v-model="msOffType" class="em__input" aria-label="Time-off type">
            <option value="vacation">Vacation</option>
            <option value="sick">Sick</option>
            <option value="unpaid">Unpaid time off</option>
            <option value="bereavement">Bereavement</option>
          </select>
          <div class="em__times">
            <label>From <TimeSelect24 v-model="msFrom" class="em__input em__input--time" /></label>
            <label>Until <TimeSelect24 v-model="msUntil" class="em__input em__input--time" /></label>
          </div>
          <select
            v-if="msMode !== 'off'"
            v-model="msTo"
            class="em__input"
            aria-label="Send to"
          >
            <option value="">Post to the trade board — anyone can respond</option>
            <option v-for="p in msToCandidates" :key="p.id" :value="p.id">
              {{ p.fullName }}
            </option>
          </select>
          <input
            v-model="msComment"
            type="text"
            class="em__input"
            :placeholder="msMode === 'off' ? 'Comments (optional)' : 'Anything claimants should know (optional)'"
          />
          <p class="em__notetext">
            {{
              msMode === 'off'
                ? 'Goes to the Chief for approval; the approved window posts your seat open.'
                : msTo
                  ? msMode === 'trade'
                    ? 'They get a notification to offer a shift back or decline; once you both agree, the Chief gives final approval.'
                    : 'They get a notification to accept or decline; once they accept, the Chief gives final approval.'
                  : msMode === 'trade'
                    ? 'Posts to the Trades board — you accept an offer, then the Chief approves the swap.'
                    : 'Posts to the Trades board — you accept a claim, then the Chief approves the coverage.'
            }}
          </p>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="msSubmit">
            {{ busy ? 'Submitting…' : msMode === 'off' ? 'Submit time-off request' : msTo ? 'Send the request' : msMode === 'trade' ? 'Post trade' : 'Post giveaway' }}
          </button>
          <button class="em__btn" :disabled="busy" @click="msMode = 'menu'">Back</button>
        </template>
      </div>
    </div>

    <!-- ── pending request — approve/deny in place, cancel your own ── -->
    <div v-if="editor.request.value" class="em__overlay" @click.self="editor.closeAll()">
      <div class="em__modal">
        <template v-if="reqObj">
          <h3 class="em__title">{{ reqTitle }}</h3>
          <p v-if="err" class="em__error">{{ err }}</p>
          <p v-for="[k, v] in reqRows" :key="k" class="em__notetext">
            <strong>{{ k }}:</strong> {{ v }}
          </p>
          <p v-if="reqAwaitingMembers" class="em__notetext">
            <strong>Waiting on the members</strong> — this
            {{ reqObj.type === 'trade' ? 'swap' : 'giveaway' }} becomes approvable once both
            have agreed (it moves to "Partner accepted"). Manage it on the Trades tab.
          </p>
          <template v-if="reqDecidable">
            <p v-for="(line, i) in reqHours.lines" :key="i" class="em__notetext">{{ line }}</p>
            <div v-if="reqChips.length" class="em__warnbox">
              <p class="em__warnhead">Check before approving:</p>
              <ul class="em__warnlist">
                <li v-for="w in reqChips" :key="w.code + w.message">{{ w.message }}</li>
              </ul>
            </div>
            <button class="em__btn em__btn--primary" :disabled="busy" @click="reqDecide(true)">
              {{ busy ? 'Working…' : reqConfirm ? 'Approve anyway' : 'Approve' }}
            </button>
            <button class="em__btn em__btn--danger" :disabled="busy" @click="reqDecide(false)">
              Deny
            </button>
            <button
              class="em__btn em__btn--ghost"
              :disabled="busy"
              title="Close this request without changing the schedule — for a change you already made by hand"
              @click="reqMarkHandled"
            >
              Already handled — schedule updated by hand
            </button>
          </template>
          <button
            v-else-if="reqIsMine && reqObj.status === 'pending'"
            class="em__btn em__btn--danger"
            :disabled="busy"
            @click="reqCancel"
          >
            {{ busy ? 'Working…' : 'Cancel this request' }}
          </button>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
        </template>
        <template v-else>
          <h3 class="em__title">Request</h3>
          <p class="em__notetext">
            This request has already been decided or withdrawn — the board refreshes on its own.
          </p>
          <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
        </template>
      </div>
    </div>

    <!-- ── note viewer (everyone) / editor (event + day notes, editors) ── -->
    <div v-if="editor.eventInfo.value" class="em__overlay" @click.self="editor.closeAll()">
      <div class="em__modal">
        <h3 class="em__title">{{ editor.eventInfo.value.ev.label }}</h3>
        <div class="em__evinfo">
          <p v-if="editor.eventInfo.value.ev.location"><span>Location</span>{{ editor.eventInfo.value.ev.location }}</p>
          <p><span>Date/Time</span>{{ evInfoWhen }}</p>
          <p v-if="editor.eventInfo.value.ev.notes"><span>Description</span>{{ editor.eventInfo.value.ev.notes }}</p>
          <p v-if="editor.eventInfo.value.ev.rows.length"><span>Staffing</span>{{ editor.eventInfo.value.ev.rows.length }} seat{{ editor.eventInfo.value.ev.rows.length === 1 ? '' : 's' }} on the schedule</p>
        </div>
        <button v-if="sched.canEdit.value" class="em__btn" @click="manageFromInfo">Manage event — slots, notes, delete</button>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>

    <div v-if="editor.note.value" class="em__overlay" @click.self="editor.closeAll()">
      <div class="em__modal">
        <h3 class="em__title">{{ editor.note.value.title }}</h3>
        <p v-if="err" class="em__error">{{ err }}</p>
        <template v-if="editor.note.value.event && sched.canEdit.value">
          <textarea v-model="noteBody" class="em__input em__textarea" rows="4"></textarea>
          <button class="em__btn em__btn--primary" :disabled="busy" @click="noteSave">
            {{ busy ? 'Saving…' : 'Save note' }}
          </button>
        </template>
        <template v-else-if="unitNoteDrafts.length && sched.canEdit.value">
          <div v-for="d in unitNoteDrafts" :key="d.id" class="em__daynote">
            <textarea v-model="d.text" class="em__input em__textarea" rows="2"></textarea>
            <button class="em__btn em__btn--primary" :disabled="busy || !d.text.trim()" @click="unitNoteSave(d)">
              {{ busy ? 'Saving…' : 'Save note' }}
            </button>
            <button class="em__btn em__btn--danger" :disabled="busy" @click="unitNoteDelete(d)">
              {{ noteDelArm === d.id ? 'Really delete?' : 'Delete note' }}
            </button>
          </div>
        </template>
        <p v-else class="em__notetext em__notetext--body">{{ editor.note.value.text }}</p>
        <button class="em__btn em__btn--ghost" @click="editor.closeAll()">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.em__daynote {
  display: grid;
  gap: 0.4rem;
  padding-bottom: 0.5rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-line-soft);
}

.em__daynote:last-of-type {
  border-bottom: 0;
  margin-bottom: 0;
}

.em__notetext {
  font-size: 0.8rem;
  color: var(--color-muted);
  margin: 0.1rem 0 0.2rem;
  line-height: 1.45;
}

.em__notetext--body {
  font-size: 0.9rem;
  color: var(--color-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

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

/* SIDE DRAWERS (locked 2026-09-24): every editor surface slides in
   from the right so the board stays visible behind it — desktop gets a
   full-height panel, phones get a bottom sheet. Same markup, only the
   frame changed. */
.em__overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.4);
  backdrop-filter: blur(1.5px);
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  z-index: 60;
  padding: 0;
}

.em__modal {
  background: var(--color-surface);
  border: 0;
  border-left: 1px solid var(--color-line);
  border-radius: 0;
  box-shadow: -18px 0 44px oklch(0.2 0.03 260 / 0.24);
  padding: 1.15rem 1.25rem 1.2rem;
  width: min(430px, 94vw);
  max-height: none;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  animation: em-slidein 0.16s ease-out;
}

@keyframes em-slidein {
  from {
    transform: translateX(26px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .em__modal {
    animation: none;
  }
}

/* phones: bottom sheet — same content, thumb-reachable */
@media (max-width: 700px) {
  .em__overlay {
    align-items: flex-end;
    justify-content: stretch;
  }

  .em__modal {
    width: 100%;
    height: auto;
    max-height: 88dvh;
    border-left: 0;
    border-top: 1px solid var(--color-line);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -14px 40px oklch(0.2 0.03 260 / 0.24);
    animation: em-slideup 0.16s ease-out;
  }

  @keyframes em-slideup {
    from {
      transform: translateY(30px);
      opacity: 0.6;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
}

.em__title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--color-brand-800);
  margin: 0;
}

/* pickup requests inside the open-seat drawer */
.em__pickups {
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  padding: 0.5rem 0.7rem 0.55rem;
}

.em__pickhead {
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-ink);
  margin: 0 0 0.3rem;
}

.em__pickrow {
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.em__pickrow:last-of-type {
  border-bottom: 0;
}

.em__pickmain {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
}

.em__pickname {
  font-weight: 650;
  color: var(--color-ink);
}

.em__picksub {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin-left: auto;
  white-space: nowrap;
}

.em__pickhours {
  font-size: 0.74rem;
  color: var(--color-muted);
  margin: 1px 0 0;
  font-variant-numeric: tabular-nums;
}

.em__pickwarn {
  display: inline-block;
  font-size: 0.66rem;
  font-weight: 600;
  border-radius: 5px;
  padding: 1px 6px;
  margin-left: 6px;
  background: var(--color-warning-50, oklch(0.97 0.03 86.8));
  color: oklch(0.45 0.12 60);
}

.em__picknote {
  font-size: 0.7rem;
  color: var(--color-muted);
  margin: 0.35rem 0 0;
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

/* Event Details card — labeled rows, Aladtec-dialog style. */
.em__leavebal {
  font-size: 0.74rem;
  color: var(--color-muted);
  margin: -0.1rem 0 0;
}

.em__leavebal--short {
  color: var(--color-danger-500);
  font-weight: 600;
}

.em__evinfo {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0.1rem 0 0.3rem;
}

.em__evinfo p {
  display: flex;
  gap: 0.6rem;
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.45;
}

.em__evinfo p > span {
  flex: 0 0 5.2rem;
  text-align: right;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding-top: 0.16rem;
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

/* Drawer buttons follow the system (locked 2026-09-24): quiet
   underlined text links, one flat navy 4px primary per drawer. */
.em__btn {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 650;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--color-ink-soft);
  cursor: pointer;
  text-align: left;
  align-self: flex-start;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--color-line);
}

.em__btn:hover:not(:disabled) {
  text-decoration-color: var(--color-accent-600);
}

.em__btn--primary,
.em__btn--primary:hover {
  border: 1px solid var(--color-brand-800);
  border-radius: 4px;
  background: var(--color-brand-800);
  color: white;
  font-weight: 700;
  padding: 7px 14px;
  text-align: center;
  text-decoration: none;
}

.em__btn--danger {
  color: var(--color-muted);
}

.em__btn--danger:hover:not(:disabled) {
  color: var(--color-danger-500);
  text-decoration-color: var(--color-danger-500);
}

.em__btn--ghost,
.em__btn--ghost:hover {
  color: var(--color-muted);
}

.em__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.em__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.1rem;
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
