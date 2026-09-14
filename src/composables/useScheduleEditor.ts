import { ref } from 'vue'
import type { SeatRow, DayEventBox } from './useSchedule'

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
}

export type AddKind = 'menu' | 'event' | 'note' | 'student'

export interface AddCtx {
  dateIso: string
  kind: AddKind
  unitId: string | null // preselected unit for students
}

const slot = ref<SlotCtx | null>(null)
const person = ref<PersonCtx | null>(null)
const student = ref<StudentCtx | null>(null)
const eventEdit = ref<EventCtx | null>(null)
const add = ref<AddCtx | null>(null)

function closeAll(): void {
  slot.value = null
  person.value = null
  student.value = null
  eventEdit.value = null
  add.value = null
}

export function useScheduleEditor() {
  /** Open seat (or partial open segment) → pickup request / direct assign. */
  function openSlot(dateIso: string, seatId: string, label: string, row: SeatRow): void {
    closeAll()
    slot.value = { dateIso, seatId, entryId: row.entryId, label, start: row.start, end: row.end }
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
    }
  }

  /** Chief: add event / note / student on a date ('menu' shows choices). */
  function openAdd(dateIso: string, kind: AddKind = 'menu', unitId: string | null = null): void {
    closeAll()
    add.value = { dateIso, kind, unitId }
  }

  return {
    slot,
    person,
    student,
    eventEdit,
    add,
    openSlot,
    openEventSlot,
    openPerson,
    openStudent,
    openEvent,
    openAdd,
    closeAll,
  }
}
