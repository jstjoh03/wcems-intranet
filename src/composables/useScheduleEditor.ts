import { ref } from 'vue'
import type { SeatRow, DayEventBox, LabeledRow } from './useSchedule'

/**
 * Shared modal state for the scheduling boards. The modals themselves
 * render once in ScheduleView (ScheduleEditModals.vue); every calendar
 * view — Month, Day, Week, Pay period — opens them through these
 * functions, so clicking a person, open seat, student, or event behaves
 * identically everywhere.
 */

export interface SlotCtx {
  dateIso: string
  seatId: string | null // null = special-event slot (entryId set)
  entryId: string | null
  label: string
  start: string // 'HHmm'
  end: string
}

export interface PersonCtx {
  dateIso: string
  seatId: string
  seatLabel: string
  unitCode: string
  userId: string
  personName: string
  start: string
  end: string
}

export interface StudentCtx {
  dateIso: string
  entryId: string
  label: string
  note: string
  start: string
  end: string
}

export interface EventCtx {
  dateIso: string
  label: string
  eventId: string | null
  start: string | null
  end: string | null
  notes: string | null
  location: string | null
}

export type AddKind = 'menu' | 'event' | 'note' | 'student' | 'seat' | 'timeoff'

/** Crew tapping their OWN shift — Aladtec's self-service trio:
 *  request time off, post a trade, or give the shift away. */
export interface MyShiftCtx {
  dateIso: string
  unitCode: string
  seatId: string
  seatLabel: string
  start: string // 'HHmm'
  end: string
}

/** Read a note in a modal (tooltips don't exist on phones). When the
 *  note belongs to an event listing, editors can save changes here;
 *  unit/day notes (sched_day_notes rows) are editable the same way. */
export interface NoteCtx {
  title: string
  text: string
  event?: {
    dateIso: string
    label: string
    eventId: string | null
    startHm: string | null
    endHm: string | null
  }
  dayNotes?: { id: string; note: string }[]
}

/** A pending request opened from its red calendar row — editors decide
 *  it in place, the requester can cancel their own. */
export interface RequestCtx {
  requestId: string
}

export interface AddCtx {
  dateIso: string
  kind: AddKind
  unitId: string | null // preselected unit for students
  /** preselected member for 'timeoff' (My schedule hands the viewed
   *  person in; the month add menu leaves it null for a picker) */
  userId: string | null
}

export interface ExtraCtx {
  dateIso: string
  entryId: string
  name: string
  sub: string
  start: string
  end: string
  canUnassign: boolean // rider seats: keep the slot, clear the person
}

const slot = ref<SlotCtx | null>(null)
const person = ref<PersonCtx | null>(null)
const student = ref<StudentCtx | null>(null)
const eventEdit = ref<EventCtx | null>(null)
const eventInfo = ref<{ dateIso: string; ev: DayEventBox } | null>(null)
const add = ref<AddCtx | null>(null)
const extra = ref<ExtraCtx | null>(null)
const myShift = ref<MyShiftCtx | null>(null)
const note = ref<NoteCtx | null>(null)
const request = ref<RequestCtx | null>(null)

function closeAll(): void {
  slot.value = null
  person.value = null
  student.value = null
  eventEdit.value = null
  eventInfo.value = null
  add.value = null
  extra.value = null
  myShift.value = null
  note.value = null
  request.value = null
}

export function useScheduleEditor() {
  /** Open seat (or partial open segment) → pickup request / direct assign. */
  function openSlot(dateIso: string, seatId: string, label: string, row: SeatRow): void {
    closeAll()
    slot.value = { dateIso, seatId, entryId: row.entryId, label, start: row.start, end: row.end }
  }

  /** Page-out deep link (?pickup=<entryId>): the caller has already
   *  fetched the open entry fresh and built the context. */
  function openSlotDirect(ctx: SlotCtx): void {
    closeAll()
    slot.value = ctx
  }

  /** Open special-event slot → pickup request / direct assign. */
  function openEventSlot(dateIso: string, ev: DayEventBox, row: SeatRow): void {
    closeAll()
    slot.value = {
      dateIso,
      seatId: null,
      entryId: row.entryId,
      label: `${ev.label} — ${row.name}`,
      start: row.start,
      end: row.end,
    }
  }

  /** Chief: click an assigned person on any view. */
  function openPerson(
    dateIso: string,
    unitCode: string,
    seatId: string,
    seatLabel: string,
    row: SeatRow,
  ): void {
    if (!row.userId) return
    closeAll()
    person.value = {
      dateIso,
      seatId,
      seatLabel,
      unitCode,
      userId: row.userId,
      personName: row.name,
      start: row.start,
      end: row.end,
    }
  }

  /** Chief: click a student row to edit / annotate / remove. */
  function openStudent(dateIso: string, row: SeatRow): void {
    if (!row.entryId) return
    closeAll()
    student.value = {
      dateIso,
      entryId: row.entryId,
      label: row.name,
      note: row.note ?? '',
      start: row.start,
      end: row.end,
    }
  }

  /** Chief: manage an established event — notes, slots, delete. */
  function openEvent(dateIso: string, ev: DayEventBox): void {
    closeAll()
    eventEdit.value = {
      dateIso,
      label: ev.label,
      eventId: ev.eventId,
      start: ev.start,
      end: ev.end,
      notes: ev.notes,
      location: ev.location,
    }
  }

  /** Anyone: the event details card — title, location, time, description. */
  function openEventInfo(dateIso: string, ev: DayEventBox): void {
    closeAll()
    eventInfo.value = { dateIso, ev }
  }

  /** Chief: add event / note / student on a date ('menu' shows choices). */
  function openAdd(
    dateIso: string,
    kind: AddKind = 'menu',
    unitId: string | null = null,
    userId: string | null = null,
  ): void {
    closeAll()
    add.value = { dateIso, kind, unitId, userId }
  }

  /** Chief: click an approved extra-hours row — change times or delete. */
  function openExtra(dateIso: string, row: LabeledRow): void {
    closeAll()
    extra.value = {
      dateIso,
      entryId: row.entryId,
      name: row.name,
      sub: row.sub,
      start: row.start,
      end: row.end,
      canUnassign: false,
    }
  }

  /** Open extra RIDER seat → pickup request / direct assign. */
  function openRiderSlot(dateIso: string, label: string, row: SeatRow): void {
    if (!row.entryId) return
    closeAll()
    slot.value = {
      dateIso,
      seatId: null,
      entryId: row.entryId,
      label,
      start: row.start,
      end: row.end,
    }
  }

  /** Chief: click an ASSIGNED rider — retime, unassign, or remove. */
  function openRiderRow(dateIso: string, sub: string, row: SeatRow): void {
    if (!row.entryId) return
    closeAll()
    extra.value = {
      dateIso,
      entryId: row.entryId,
      name: row.name,
      sub,
      start: row.start,
      end: row.end,
      canUnassign: true,
    }
  }

  /** Crew: tap your own shift → time off / trade / giveaway. */
  function openMyShift(
    dateIso: string,
    unitCode: string,
    seatId: string,
    seatLabel: string,
    row: SeatRow,
  ): void {
    closeAll()
    myShift.value = { dateIso, unitCode, seatId, seatLabel, start: row.start, end: row.end }
  }

  /** Anyone: read a note; editors save event notes in place. */
  function openNote(ctx: NoteCtx): void {
    closeAll()
    note.value = ctx
  }

  /** A red pending row on any board — editors approve/deny in place,
   *  the requester can cancel their own while it's still pending. */
  function openRequest(requestId: string): void {
    closeAll()
    request.value = { requestId }
  }

  return {
    slot,
    person,
    student,
    eventEdit,
    eventInfo,
    add,
    extra,
    myShift,
    note,
    request,
    openSlot,
    openSlotDirect,
    openEventSlot,
    openPerson,
    openStudent,
    openEvent,
    openEventInfo,
    openAdd,
    openExtra,
    openRiderSlot,
    openRiderRow,
    openMyShift,
    openNote,
    openRequest,
    closeAll,
  }
}
