<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  holidaysForYear,
  type AuditRow,
  type Platoon,
  type SchedSeat,
  type UnitPreset,
} from '@/composables/useSchedule'

/**
 * Setup — mirrors the approved mockup: one compact rotation-template
 * table (all seats × A/B/C, click a cell to reassign with an effective
 * date), a scheduled-changes list beneath it, and the Units & display
 * order panel alongside.
 */

const sched = useSchedule()
const PLATOONS: Platoon[] = ['A', 'B', 'C']

onMounted(async () => {
  await sched.ensureLoaded()
  void loadLog()
})

// ── activity log ─────────────────────────────────────────────────────

const logRows = ref<AuditRow[]>([])
const logLoaded = ref(false)
const logBusy = ref(false)
const logDone = ref(false)
const logFilter = ref('')

async function loadLog(more = false) {
  logBusy.value = true
  const before = more && logRows.value.length > 0 ? logRows.value[logRows.value.length - 1].id : undefined
  const rows = await sched.fetchAuditLog(before)
  logRows.value = more ? [...logRows.value, ...rows] : rows
  logDone.value = rows.length < 80
  logLoaded.value = true
  logBusy.value = false
}

function actorName(id: string | null): string {
  if (!id) return 'System'
  return sched.personById.value.get(id)?.fullName ?? 'Former member'
}

const logShown = computed(() => {
  const q = logFilter.value.trim().toLowerCase()
  if (!q) return logRows.value
  return logRows.value.filter(
    (r) =>
      r.summary.toLowerCase().includes(q) ||
      r.action.toLowerCase().includes(q) ||
      actorName(r.actorId).toLowerCase().includes(q),
  )
})

function logWhen(at: string): string {
  return new Date(at).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// ── rotation template ────────────────────────────────────────────────

const editing = ref<{ seatId: string; platoon: Platoon } | null>(null)
const editUserId = ref('')
const editFrom = ref(todayCentralIso())
const saving = ref(false)
const err = ref<string | null>(null)

function currentOccupant(seatId: string, platoon: Platoon): string | null {
  const today = todayCentralIso()
  let best: { from: string; userId: string | null } | null = null
  for (const a of sched.rotation.value) {
    if (a.seatId !== seatId || a.platoon !== platoon) continue
    if (a.effectiveFrom > today) continue
    if (a.effectiveTo !== null && a.effectiveTo < today) continue
    if (best === null || a.effectiveFrom > best.from) best = { from: a.effectiveFrom, userId: a.userId }
  }
  return best?.userId ?? null
}

function occupantName(seatId: string, platoon: Platoon): string {
  const id = currentOccupant(seatId, platoon)
  return id ? (sched.personById.value.get(id)?.fullName ?? 'Unknown') : ''
}

function upcoming(seatId: string, platoon: Platoon) {
  const today = todayCentralIso()
  return sched.rotation.value
    .filter((a) => a.seatId === seatId && a.platoon === platoon && a.effectiveFrom > today)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

function startEdit(seatId: string, platoon: Platoon) {
  editing.value = { seatId, platoon }
  editUserId.value = currentOccupant(seatId, platoon) ?? ''
  editFrom.value = todayCentralIso()
  err.value = null
}

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  err.value = null
  const e = await sched.assignRotation(
    editing.value.seatId,
    editing.value.platoon,
    editUserId.value || null,
    editFrom.value,
  )
  saving.value = false
  if (e) {
    err.value = e
    return
  }
  editing.value = null
}

interface TplRow {
  seat: SchedSeat
  unitCode: string
  firstOfUnit: boolean
}

const QUAL_LABELS: Record<string, string> = {
  p2: 'P2',
  aemt_or_higher: 'AEMT or higher',
  any_field: 'any field cert',
  supervisor: 'Supervisor',
  any: 'any',
}

const tplRows = computed<TplRow[]>(() => {
  const out: TplRow[] = []
  for (const u of sched.units.value.filter((x) => x.active)) {
    const seats = sched.seats.value
      .filter((s) => s.unitId === u.id && s.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    seats.forEach((seat, i) => out.push({ seat, unitCode: u.code, firstOfUnit: i === 0 }))
  }
  return out
})

// ── scheduled changes ────────────────────────────────────────────────

const scheduledChanges = computed(() => {
  const today = todayCentralIso()
  return sched.rotation.value
    .filter((a) => a.effectiveFrom > today)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((a) => {
      const seat = sched.seats.value.find((s) => s.id === a.seatId)
      const unit = sched.units.value.find((u) => u.id === seat?.unitId)
      const prior = currentOccupant(a.seatId, a.platoon)
      const days = Math.round(
        (new Date(`${a.effectiveFrom}T00:00:00`).getTime() -
          new Date(`${today}T00:00:00`).getTime()) /
          86_400_000,
      )
      return {
        id: a.id,
        label: `${unit?.code ?? ''} ${seat?.label ?? ''} · ${a.platoon} Shift`,
        detail: `${prior ? (sched.personById.value.get(prior)?.fullName ?? 'Unknown') : 'Open'} → ${
          a.userId ? (sched.personById.value.get(a.userId)?.fullName ?? 'Unknown') : 'open'
        } · effective ${fmtDate(a.effectiveFrom)}${a.effectiveTo ? ` – ${fmtDate(a.effectiveTo)}` : ' · indefinite'}`,
        days,
      }
    })
})

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const cancelArm = ref<string | null>(null)

async function cancelChange(id: string) {
  if (cancelArm.value !== id) {
    cancelArm.value = id
    return
  }
  cancelArm.value = null
  const e = await sched.removeRotationAssignment(id)
  if (e) err.value = e
}

// ── units panel ──────────────────────────────────────────────────────

const orderSaving = ref(false)

async function moveUnit(unitId: string, delta: number) {
  const ids = sched.units.value.filter((u) => u.active).map((u) => u.id)
  const i = ids.indexOf(unitId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  orderSaving.value = true
  await sched.saveUnitOrder(ids)
  orderSaving.value = false
}

function seatSummary(unitId: string): string {
  return sched.seats.value
    .filter((s) => s.unitId === unitId && s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => s.label)
    .join(' + ')
}

const addingUnit = ref(false)
const nuCode = ref('')
const nuLabel = ref('')
const nuStation = ref('')
const nuPreset = ref<UnitPreset>('medic')
const nuBusy = ref(false)

async function submitUnit() {
  if (!nuCode.value.trim()) {
    err.value = 'Unit code is required.'
    return
  }
  nuBusy.value = true
  err.value = null
  const e = await sched.addUnit({
    code: nuCode.value.trim().toUpperCase(),
    label: nuLabel.value.trim(),
    station: nuStation.value.trim(),
    preset: nuPreset.value,
  })
  nuBusy.value = false
  if (e) {
    err.value = e
    return
  }
  addingUnit.value = false
  nuCode.value = nuLabel.value = nuStation.value = ''
  nuPreset.value = 'medic'
}

// ── unit lifecycle: deactivate / reactivate / delete ─────────────────

const inactiveUnits = computed(() => sched.units.value.filter((u) => !u.active))
const deactArm = ref<string | null>(null)
const delArm = ref<string | null>(null)
const lifeBusy = ref(false)

async function deactivateUnit(unitId: string) {
  if (deactArm.value !== unitId) {
    deactArm.value = unitId
    return
  }
  deactArm.value = null
  lifeBusy.value = true
  err.value = null
  const e = await sched.setUnitActive(unitId, false)
  lifeBusy.value = false
  if (e) err.value = e
}

async function reactivateUnit(unitId: string) {
  lifeBusy.value = true
  err.value = null
  const e = await sched.setUnitActive(unitId, true)
  lifeBusy.value = false
  if (e) err.value = e
}

async function removeUnit(unitId: string) {
  if (delArm.value !== unitId) {
    delArm.value = unitId
    return
  }
  delArm.value = null
  lifeBusy.value = true
  err.value = null
  const e = await sched.deleteUnit(unitId)
  lifeBusy.value = false
  if (e) err.value = e
}

// ── per-unit rotation patterns ───────────────────────────────────────

const rotUnit = ref<string | null>(null) // unit whose pattern editor is open
const rotCustom = ref(false)
const rotPattern = ref('')
const rotAnchor = ref(todayCentralIso())
const rotFrom = ref('06:00')
const rotUntil = ref('06:00')
const rotBusy = ref(false)

interface RotUnitLike {
  id: string
  rotationPattern: string[] | null
  rotationAnchor: string | null
  shiftStart: string | null
  shiftEnd: string | null
}

function rotationLabel(u: RotUnitLike): string {
  const hours =
    u.shiftStart || u.shiftEnd
      ? ` · ${(u.shiftStart ?? '06:00').replace(':', '')}–${(u.shiftEnd ?? '06:00').replace(':', '')}`
      : ''
  if (!u.rotationPattern || u.rotationPattern.length === 0) {
    return `48/96 (agency default)${hours}`
  }
  const days = u.rotationPattern.map((t) => (t === '' ? '–' : t)).join(' ')
  return `${u.rotationPattern.length}-day pattern: ${days}${u.rotationAnchor ? ` · from ${fmtDate(u.rotationAnchor)}` : ''}${hours}`
}

function startRotEdit(u: RotUnitLike) {
  if (rotUnit.value === u.id) {
    rotUnit.value = null
    return
  }
  rotUnit.value = u.id
  rotCustom.value = !!u.rotationPattern && u.rotationPattern.length > 0
  rotPattern.value = (u.rotationPattern ?? []).map((t) => (t === '' ? '-' : t)).join(',')
  rotAnchor.value = u.rotationAnchor ?? todayCentralIso()
  rotFrom.value = u.shiftStart ?? '06:00'
  rotUntil.value = u.shiftEnd ?? '06:00'
  err.value = null
}

async function saveRotEdit(unitId: string) {
  rotBusy.value = true
  err.value = null
  let e: string | null
  if (!rotCustom.value) {
    e = await sched.saveUnitRotation(unitId, null, null, rotFrom.value, rotUntil.value)
  } else {
    const pattern = rotPattern.value
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .map((t) => (t === '-' || t === 'OFF' ? '' : t))
    e = await sched.saveUnitRotation(unitId, pattern, rotAnchor.value, rotFrom.value, rotUntil.value)
  }
  rotBusy.value = false
  if (e) {
    err.value = e
    return
  }
  rotUnit.value = null
}

// ── rider-seat positions (global admins) ─────────────────────────────

const rpList = ref<string[]>([])
const rpNew = ref('')
const rpBusy = ref(false)
const rpDone = ref<string | null>(null)
const rpInit = ref(false)

watch(
  () => sched.settings.value,
  () => {
    if (rpInit.value) return
    rpList.value = [...sched.riderPositions()]
    rpInit.value = true
  },
  { immediate: true, deep: true },
)

function rpAdd() {
  const v = rpNew.value.trim()
  if (!v) return
  if (rpList.value.some((p) => p.toLowerCase() === v.toLowerCase())) {
    rpNew.value = ''
    return
  }
  rpList.value = [...rpList.value, v]
  rpNew.value = ''
}

function rpRemove(p: string) {
  rpList.value = rpList.value.filter((x) => x !== p)
}

async function rpSave() {
  if (rpList.value.length === 0) {
    err.value = 'Keep at least one position in the list.'
    return
  }
  rpBusy.value = true
  rpDone.value = null
  err.value = null
  const e = await sched.saveSetting('rider_positions', { options: rpList.value })
  rpBusy.value = false
  if (e) {
    err.value = e
    return
  }
  rpDone.value = 'Saved — the Add-seat dropdown uses this list everywhere.'
}

// ── Pilot access (global admins) ─────────────────────────────────────

/* Pre-launch testers: named field staff get the crew experience before
   the crew-wide opening (canAccessModule reads settings.pilot). Clear
   the list at launch — the gate covers everyone from then on. */
const ptIds = ref<string[]>([])
const ptPick = ref('')
const ptBusy = ref(false)
const ptDone = ref<string | null>(null)
const ptInit = ref(false)

watch(
  () => sched.settings.value,
  () => {
    if (ptInit.value) return
    const p = (sched.settings.value['pilot'] ?? {}) as { user_ids?: unknown }
    ptIds.value = Array.isArray(p.user_ids)
      ? (p.user_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    if (Object.keys(sched.settings.value).length > 0) ptInit.value = true
  },
  { immediate: true },
)

const ptCandidates = computed(() => sched.people.value.filter((p) => !ptIds.value.includes(p.id)))

function ptName(id: string): string {
  return sched.personById.value.get(id)?.fullName ?? 'Unknown'
}

function ptAdd() {
  if (ptPick.value && !ptIds.value.includes(ptPick.value)) {
    ptIds.value = [...ptIds.value, ptPick.value]
  }
  ptPick.value = ''
}

function ptRemove(id: string) {
  ptIds.value = ptIds.value.filter((x) => x !== id)
}

async function ptSave() {
  ptBusy.value = true
  ptDone.value = null
  err.value = null
  const e = await sched.saveSetting('pilot', { user_ids: ptIds.value })
  ptBusy.value = false
  if (e) {
    err.value = e
    return
  }
  ptDone.value = ptIds.value.length
    ? 'Saved — these members can open the module now.'
    : 'Saved — pilot access cleared.'
}

// ── Paycom earning codes (global admins) ─────────────────────────────

/* One row per earning code: pick the time category the schedule
   supports, type the Paycom code beside it — categories are a fixed
   dropdown so codes and pay types can't mismatch. */
const PAY_CATEGORIES: { key: string; label: string }[] = [
  { key: 'holiday', label: 'Holiday (double time)' },
  { key: 'event', label: 'Special event (double time)' },
  { key: 'instructor', label: 'Instructor hours' },
  { key: 'meeting', label: 'Meeting hours' },
  { key: 'vacation', label: 'Vacation Time' },
  { key: 'sick', label: 'Sick Time' },
  { key: 'unpaid', label: 'Unpaid Time Off' },
  { key: 'bereavement', label: 'Bereavement' },
  { key: 'other', label: 'Other Time Off' },
]

interface PcRow {
  key: string
  code: string
}

const pcRows = ref<PcRow[]>([])
const pcBusy = ref(false)
const pcDone = ref<string | null>(null)
const pcInit = ref(false)

watch(
  () => sched.settings.value,
  () => {
    if (pcInit.value) return
    const existing = sched.paycomCodes()
    if (Object.keys(existing).length === 0 && !sched.loaded.value) return
    pcRows.value = PAY_CATEGORIES.filter((c) => existing[c.key]).map((c) => ({
      key: c.key,
      code: existing[c.key],
    }))
    pcInit.value = true
  },
  { immediate: true, deep: true },
)

function pcCatOptions(row: PcRow) {
  const used = new Set(pcRows.value.filter((r) => r !== row).map((r) => r.key))
  return PAY_CATEGORIES.filter((c) => c.key === row.key || !used.has(c.key))
}

function pcAdd() {
  const used = new Set(pcRows.value.map((r) => r.key))
  const next = PAY_CATEGORIES.find((c) => !used.has(c.key))
  if (!next) return
  pcRows.value = [...pcRows.value, { key: next.key, code: '' }]
}

function pcRemove(row: PcRow) {
  pcRows.value = pcRows.value.filter((r) => r !== row)
}

async function pcSave() {
  pcBusy.value = true
  pcDone.value = null
  err.value = null
  const codes: Record<string, string> = {}
  for (const r of pcRows.value) {
    if (r.code.trim()) codes[r.key] = r.code.trim()
  }
  const e = await sched.saveSetting('paycom', { codes })
  pcBusy.value = false
  if (e) {
    err.value = e
    return
  }
  pcDone.value = 'Saved — coded categories now export as hours rows in the Paycom file.'
}

const thisYear = Number(todayCentralIso().slice(0, 4))
const holidayPreview = [...holidaysForYear(thisYear), ...holidaysForYear(thisYear + 1)].filter(
  (h) => h.dateIso >= todayCentralIso(),
).slice(0, 8)

function fmtHoliday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── hour warnings & overtime (global admins) ─────────────────────────

const wWarn = ref(60)
const wConfirm = ref(72)
const wWeekly = ref(84)
const wOt = ref(40)
const wBusy = ref(false)
const wDone = ref<string | null>(null)
const wInit = ref(false)

watch(
  () => sched.settings.value,
  (s) => {
    if (wInit.value) return
    const w = (s['warnings'] ?? {}) as Record<string, unknown>
    const p = (s['pay'] ?? {}) as Record<string, unknown>
    if (Object.keys(w).length === 0 && Object.keys(p).length === 0) return
    wWarn.value = Number(w.consecutive_warn_hours ?? 60)
    wConfirm.value = Number(w.consecutive_confirm_hours ?? 72)
    wWeekly.value = Number(w.weekly_warn_hours ?? 84)
    wOt.value = Number(p.ot_week_hours ?? 40)
    wInit.value = true
  },
  { immediate: true, deep: true },
)

// ── page-out settings ────────────────────────────────────────────────

const PO_NOTE_DEFAULT = 'Immediate opening — call S201 or S202 to pick up.'
const poNote = ref('')
const poBusy = ref(false)
const poSaved = ref(false)

watch(
  () => sched.settings.value['pageout'],
  (v) => {
    poNote.value = String((v as { urgent_note?: string } | undefined)?.urgent_note ?? '')
  },
  { immediate: true },
)

async function savePageoutCfg() {
  poBusy.value = true
  poSaved.value = false
  err.value = null
  const existing = (sched.settings.value['pageout'] ?? {}) as Record<string, unknown>
  const e = await sched.saveSetting('pageout', {
    ...existing,
    urgent_note: poNote.value.trim(),
  })
  poBusy.value = false
  if (e) {
    err.value = e
    return
  }
  poSaved.value = true
}

async function saveWarnCfg() {
  wBusy.value = true
  wDone.value = null
  err.value = null
  const w = {
    ...(sched.settings.value['warnings'] ?? {}),
    consecutive_warn_hours: wWarn.value,
    consecutive_confirm_hours: wConfirm.value,
    weekly_warn_hours: wWeekly.value,
  }
  const e1 = await sched.saveSetting('warnings', w)
  const p = { ...(sched.settings.value['pay'] ?? {}), ot_week_hours: wOt.value }
  const e2 = e1 ? null : await sched.saveSetting('pay', p)
  wBusy.value = false
  const e = e1 ?? e2
  if (e) {
    err.value = e
    return
  }
  wDone.value = 'Saved — new thresholds apply to every check immediately.'
}
</script>

<template>
  <div class="setup">
    <p v-if="err" class="setup__error">{{ err }}</p>

    <div class="setup__cols">
      <div class="setup__main">
        <section class="setup__card">
          <div class="setup__card-head">
            <h2 class="setup__h">Rotation template — who holds each seat, per shift</h2>
          </div>

          <div class="setup__scroll">
            <table class="setup__table">
              <thead>
                <tr>
                  <th class="setup__th-seat">Seat</th>
                  <th v-for="p in PLATOONS" :key="p" class="setup__th" :data-platoon="p">
                    {{ p }} Shift
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in tplRows"
                  :key="row.seat.id"
                  :class="{ 'setup__tr--unit': row.firstOfUnit }"
                >
                  <td class="setup__seatcell">
                    <span class="setup__unitcode">{{ row.unitCode }}</span>
                    <span class="setup__seatlabel">{{ row.seat.label }}</span>
                    <span class="setup__qual">qual: {{ QUAL_LABELS[row.seat.qualRule] ?? row.seat.qualRule }}</span>
                  </td>
                  <td v-for="p in PLATOONS" :key="p" class="setup__cell">
                    <template v-if="editing && editing.seatId === row.seat.id && editing.platoon === p">
                      <div class="setup__editcell">
                        <select v-model="editUserId" class="setup__select">
                          <option value="">— open seat —</option>
                          <option v-for="person in sched.people.value" :key="person.id" :value="person.id">
                            {{ person.fullName }}
                          </option>
                        </select>
                        <label class="setup__from">
                          <span>Effective</span>
                          <input v-model="editFrom" type="date" class="setup__date" />
                        </label>
                        <div class="setup__editbtns">
                          <button class="setup__btn setup__btn--primary" :disabled="saving" @click="saveEdit">
                            {{ saving ? 'Saving…' : 'Save' }}
                          </button>
                          <button class="setup__btn" :disabled="saving" @click="editing = null">Cancel</button>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <button class="setup__cellbtn" @click="startEdit(row.seat.id, p)">
                        <span v-if="occupantName(row.seat.id, p)">{{ occupantName(row.seat.id, p) }}</span>
                        <span v-else class="setup__open">Open</span>
                        <span
                          v-for="up in upcoming(row.seat.id, p)"
                          :key="up.id"
                          class="setup__upcoming"
                        >
                          → {{ up.userId ? (sched.personById.value.get(up.userId)?.fullName ?? 'Unknown') : 'open' }}
                          eff. {{ fmtDate(up.effectiveFrom) }}
                        </span>
                      </button>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="setup__foot">
            Click any cell to reassign with an <strong>effective date</strong> (earlier days keep
            the previous assignment; a vacancy posts as open seats automatically). Seat
            qualifications enforce from the clinical pipeline.
          </p>
        </section>

        <section class="setup__card">
          <h2 class="setup__h">Scheduled template changes</h2>
          <p v-if="scheduledChanges.length === 0" class="setup__muted">
            None scheduled — changes with a future effective date appear here.
          </p>
          <div v-for="ch in scheduledChanges" :key="ch.id" class="setup__change">
            <div class="setup__change-main">
              <p class="setup__change-label">{{ ch.label }}</p>
              <p class="setup__change-detail">{{ ch.detail }}</p>
            </div>
            <span class="setup__chip">Takes effect in {{ ch.days }} {{ ch.days === 1 ? 'day' : 'days' }}</span>
            <button class="setup__btn setup__btn--danger" @click="cancelChange(ch.id)">
              {{ cancelArm === ch.id ? 'Confirm cancel' : 'Cancel' }}
            </button>
          </div>
        </section>

        <section class="setup__card">
          <div class="setup__card-head">
            <h2 class="setup__h">Activity log</h2>
            <input
              v-model="logFilter"
              type="search"
              class="setup__loginput"
              placeholder="Filter actions"
              aria-label="Filter activity log"
            />
          </div>
          <p class="setup__muted">Every change made in the scheduler — who did what, when (Central time).</p>
          <p v-if="logLoaded && logRows.length === 0" class="setup__muted">Nothing recorded yet.</p>
          <ul v-else class="setup__log">
            <li v-for="r in logShown" :key="r.id" class="setup__logrow">
              <span class="setup__logwhen">{{ logWhen(r.at) }}</span>
              <span class="setup__logwho">{{ actorName(r.actorId) }}</span>
              <span class="setup__logwhat">{{ r.summary }}</span>
            </li>
          </ul>
          <button
            v-if="logLoaded && !logDone && !logFilter"
            class="setup__btn"
            :disabled="logBusy"
            @click="loadLog(true)"
          >
            {{ logBusy ? 'Loading…' : 'Load older entries' }}
          </button>
        </section>
      </div>

      <aside class="setup__side">
        <section class="setup__card">
          <div class="setup__card-head">
            <h2 class="setup__h">Units &amp; display order</h2>
            <button class="setup__btn" @click="addingUnit = !addingUnit">
              {{ addingUnit ? 'Close' : 'Add unit' }}
            </button>
          </div>

          <form v-if="addingUnit" class="setup__addunit" @submit.prevent="submitUnit">
            <div class="setup__addgrid">
              <label class="setup__field">
                <span>Code</span>
                <input v-model="nuCode" type="text" class="setup__input" placeholder="M251" />
              </label>
              <label class="setup__field">
                <span>Label</span>
                <input v-model="nuLabel" type="text" class="setup__input" placeholder="Medic 251" />
              </label>
              <label class="setup__field">
                <span>Station</span>
                <input v-model="nuStation" type="text" class="setup__input" placeholder="Station 201 · Hempstead" />
              </label>
              <label class="setup__field">
                <span>Seats</span>
                <select v-model="nuPreset" class="setup__select">
                  <option value="medic">Paramedic + Attendant</option>
                  <option value="aic">AIC/Medic + Attendant</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </label>
            </div>
            <button type="submit" class="setup__btn setup__btn--primary" :disabled="nuBusy">
              {{ nuBusy ? 'Adding…' : 'Add unit' }}
            </button>
          </form>

          <div
            v-for="u in sched.units.value.filter((x) => x.active)"
            :key="u.id"
            class="setup__unitblock"
          >
            <div class="setup__unitrow">
              <div class="setup__unitinfo">
                <span class="setup__unitcode">{{ u.code }}</span>
                <span class="setup__unitseats">{{ seatSummary(u.id) }}</span>
                <span v-if="u.station" class="setup__unitstation">{{ u.station }}</span>
                <button class="setup__rotbtn" @click="startRotEdit(u)">
                  {{ rotationLabel(u) }}
                </button>
                <button
                  class="setup__rotbtn setup__rotbtn--danger"
                  :disabled="lifeBusy"
                  @click="deactivateUnit(u.id)"
                >
                  {{ deactArm === u.id ? 'Confirm — hide from all schedules' : 'Deactivate' }}
                </button>
              </div>
              <span class="setup__unit-order">
                <button class="setup__order-btn" :disabled="orderSaving" aria-label="Move up" @click="moveUnit(u.id, -1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                </button>
                <button class="setup__order-btn" :disabled="orderSaving" aria-label="Move down" @click="moveUnit(u.id, 1)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </span>
            </div>

            <div v-if="rotUnit === u.id" class="setup__rotedit">
              <label class="setup__rotchoice">
                <input v-model="rotCustom" type="radio" :value="false" />
                Agency default — 48/96 (B B C C A A)
              </label>
              <label class="setup__rotchoice">
                <input v-model="rotCustom" type="radio" :value="true" />
                Custom repeating pattern for this unit
              </label>
              <template v-if="rotCustom">
                <label class="setup__field">
                  <span>Day sequence — one letter per day, repeat forever. A / B / C, or "-" for not staffed.</span>
                  <input
                    v-model="rotPattern"
                    type="text"
                    class="setup__input"
                    placeholder="A,-,A,-,A,-,-  (Mon/Wed/Fri day truck on a 7-day cycle)"
                  />
                </label>
                <label class="setup__field">
                  <span>Pattern starts on (day 1 of the sequence)</span>
                  <input v-model="rotAnchor" type="date" class="setup__input" />
                </label>
                <p class="setup__muted">
                  Seats are still assigned per letter in the rotation table — the pattern just
                  decides which letter (if any) works each date for this unit.
                </p>
              </template>
              <div class="setup__rothours">
                <span class="setup__rothours-label">Daily shift hours</span>
                <label>From <input v-model="rotFrom" type="time" class="setup__input setup__input--time" /></label>
                <label>Until <input v-model="rotUntil" type="time" class="setup__input setup__input--time" /></label>
              </div>
              <p class="setup__muted">
                06:00 – 06:00 = the standard 24-hour shift. A part-time window (e.g. 08:00 –
                20:00) applies to every rotation day for this unit; it must fit inside the
                0600-anchored work date.
              </p>
              <div class="setup__editbtns">
                <button class="setup__btn setup__btn--primary" :disabled="rotBusy" @click="saveRotEdit(u.id)">
                  {{ rotBusy ? 'Saving…' : 'Save rotation' }}
                </button>
                <button class="setup__btn" :disabled="rotBusy" @click="rotUnit = null">Cancel</button>
              </div>
            </div>
          </div>

          <div v-if="inactiveUnits.length > 0" class="setup__inactive">
            <p class="setup__h">Inactive units</p>
            <div v-for="u in inactiveUnits" :key="u.id" class="setup__unitrow">
              <div class="setup__unitinfo">
                <span class="setup__unitcode setup__unitcode--off">{{ u.code }}</span>
                <span class="setup__unitseats">{{ seatSummary(u.id) }}</span>
              </div>
              <span class="setup__unit-order">
                <button class="setup__btn" :disabled="lifeBusy" @click="reactivateUnit(u.id)">
                  Reactivate
                </button>
                <button
                  class="setup__btn setup__btn--danger"
                  :disabled="lifeBusy"
                  @click="removeUnit(u.id)"
                >
                  {{ delArm === u.id ? 'Confirm — delete forever' : 'Delete' }}
                </button>
              </span>
            </div>
            <p class="setup__muted">
              Inactive units are hidden from every board, picker, and count — their history
              stays in the database. Delete only works when a unit has no schedule entries at
              all (test units); anything with history must stay deactivated instead.
            </p>
          </div>
        </section>

        <section v-if="sched.isGlobalAdmin.value" class="setup__card">
          <h2 class="setup__h">Rider seat positions</h2>
          <p class="setup__muted">
            The position choices offered when adding an extra seat (3rd rider) to a unit.
            "Other…" with free text is always available on top of these.
          </p>
          <div class="setup__rplist">
            <span v-for="p in rpList" :key="p" class="setup__rpchip">
              {{ p }}
              <button class="setup__rpx" :aria-label="`Remove ${p}`" @click="rpRemove(p)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </span>
          </div>
          <form class="setup__rpadd" @submit.prevent="rpAdd">
            <input v-model="rpNew" type="text" class="setup__input" placeholder="Add a position…" />
            <button type="submit" class="setup__btn">Add</button>
          </form>
          <p v-if="rpDone" class="setup__done">{{ rpDone }}</p>
          <button class="setup__btn setup__btn--primary" :disabled="rpBusy" @click="rpSave">
            {{ rpBusy ? 'Saving…' : 'Save positions' }}
          </button>
        </section>

        <section v-if="sched.isGlobalAdmin.value" class="setup__card">
          <h2 class="setup__h">Pilot access</h2>
          <p class="setup__muted">
            Pre-launch testers: these members get the crew experience — My schedule, open-shift
            pickups, requests, trades, notification settings — before the module opens to the
            whole crew. Clear the list at launch; the crew-wide gate covers everyone from then
            on.
          </p>
          <div class="setup__rplist">
            <span v-for="id in ptIds" :key="id" class="setup__rpchip">
              {{ ptName(id) }}
              <button class="setup__rpx" :aria-label="`Remove ${ptName(id)}`" @click="ptRemove(id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </span>
            <span v-if="!ptIds.length" class="setup__muted">No testers yet.</span>
          </div>
          <form class="setup__rpadd" @submit.prevent="ptAdd">
            <select v-model="ptPick" class="setup__input">
              <option value="" disabled>Add a member…</option>
              <option v-for="p in ptCandidates" :key="p.id" :value="p.id">{{ p.fullName }}</option>
            </select>
            <button type="submit" class="setup__btn" :disabled="!ptPick">Add</button>
          </form>
          <p v-if="ptDone" class="setup__done">{{ ptDone }}</p>
          <button class="setup__btn setup__btn--primary" :disabled="ptBusy" @click="ptSave">
            {{ ptBusy ? 'Saving…' : 'Save pilot list' }}
          </button>
        </section>

        <section v-if="sched.isGlobalAdmin.value" class="setup__card">
          <h2 class="setup__h">Paycom earning codes</h2>
          <p class="setup__muted">
            Regular shifts export as ID/OD punches and need no code. Everything else — special
            events and holidays (double time), instructor/meeting hours, and approved time
            off — exports as hours rows with the earning code you map here. One row per code:
            pick the category, type its Paycom code.
          </p>

          <div v-for="row in pcRows" :key="row.key" class="setup__pcrow">
            <select v-model="row.key" class="setup__input setup__pccat">
              <option v-for="c in pcCatOptions(row)" :key="c.key" :value="c.key">{{ c.label }}</option>
            </select>
            <input v-model="row.code" type="text" class="setup__input setup__pccode" placeholder="Paycom code" />
            <button class="setup__rpx" :aria-label="`Remove ${row.key} code`" @click="pcRemove(row)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>

          <button
            class="setup__btn"
            :disabled="pcRows.length >= PAY_CATEGORIES.length"
            @click="pcAdd"
          >
            Add a code
          </button>

          <p class="setup__muted">
            Holidays run 0600 the day of until 0600 the next day (handbook 5.5). Upcoming:
            <template v-for="(h, i) in holidayPreview" :key="h.dateIso">{{ i > 0 ? ' · ' : '' }}{{ h.name }} {{ fmtHoliday(h.dateIso) }}</template>
          </p>
          <p v-if="pcDone" class="setup__done">{{ pcDone }}</p>
          <button class="setup__btn setup__btn--primary" :disabled="pcBusy" @click="pcSave">
            {{ pcBusy ? 'Saving…' : 'Save earning codes' }}
          </button>
        </section>

        <section v-if="sched.isGlobalAdmin.value" class="setup__card">
          <h2 class="setup__h">Hour warnings &amp; overtime</h2>
          <p class="setup__muted">
            Pickups, extra hours, trades, and direct assignments that push someone past these
            thresholds get flagged — the admin sign-off level requires an extra confirmation
            to approve.
          </p>
          <div class="setup__warngrid">
            <label class="setup__field">
              <span>Consecutive hours — warn</span>
              <input v-model.number="wWarn" type="number" min="0" max="240" class="setup__input" />
            </label>
            <label class="setup__field">
              <span>Consecutive — admin sign-off</span>
              <input v-model.number="wConfirm" type="number" min="0" max="240" class="setup__input" />
            </label>
            <label class="setup__field">
              <span>Weekly hours — warn</span>
              <input v-model.number="wWeekly" type="number" min="0" max="168" class="setup__input" />
            </label>
            <label class="setup__field">
              <span>Overtime after (hrs/week)</span>
              <input v-model.number="wOt" type="number" min="0" max="168" class="setup__input" />
            </label>
          </div>
          <p v-if="wDone" class="setup__done">{{ wDone }}</p>
          <button class="setup__btn setup__btn--primary" :disabled="wBusy" @click="saveWarnCfg">
            {{ wBusy ? 'Saving…' : 'Save thresholds' }}
          </button>
        </section>

        <section v-if="sched.isGlobalAdmin.value" class="setup__card">
          <h2 class="setup__h">Page-outs</h2>
          <p class="setup__muted">
            The line added to every URGENT page-out. Leave blank for the default:
            “{{ PO_NOTE_DEFAULT }}”
          </p>
          <label class="setup__muted" for="po-note">Urgent page-out note</label>
          <input
            id="po-note"
            v-model="poNote"
            type="text"
            class="setup__input"
            maxlength="180"
            :placeholder="PO_NOTE_DEFAULT"
          />
          <div class="setup__row">
            <span v-if="poSaved" class="setup__saved">Saved.</span>
            <button class="setup__btn setup__btn--primary" :disabled="poBusy" @click="savePageoutCfg">
              {{ poBusy ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </section>

        <section class="setup__card">
          <h2 class="setup__h">Access</h2>
          <p class="setup__muted">Access levels are managed on the Members tab.</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.setup__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
  margin: 0 0 0.6rem;
}

.setup__done {
  color: var(--color-success-500);
  font-size: 0.82rem;
  margin: 0.4rem 0;
}

/* elevation recipe shared with the nav bar and modals */
.setup__btn {
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-soft)) !important;
  box-shadow: 0 1px 2px oklch(0.3 0.03 260 / 0.08);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.setup__btn:hover:not(:disabled) {
  border-color: var(--color-brand-300);
  box-shadow: 0 2px 6px oklch(0.3 0.03 260 / 0.14);
}

.setup__btn--primary,
.setup__btn--primary:hover:not(:disabled) {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)) !important;
  border-color: var(--color-brand-800) !important;
  color: white !important;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.18),
    0 2px 6px oklch(0.3 0.06 260 / 0.35);
}

.setup__warngrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
  margin: 0.6rem 0;
}

/* subtle zebra so long tables scan row-by-row at a glance */
.setup__table tbody tr:nth-child(even) {
  background: oklch(0.45 0.02 260 / 0.045);
}

.setup__unitblock:nth-child(even) .setup__unitrow {
  background: oklch(0.45 0.02 260 / 0.045);
  border-radius: 6px;
}

.setup__unitblock {
  border-bottom: 1px solid var(--color-line-soft);
}

.setup__unitblock:last-child {
  border-bottom: 0;
}

.setup__rotbtn {
  display: block;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-brand-600);
  background: transparent;
  border: 0;
  padding: 0.1rem 0 0;
  cursor: pointer;
  text-align: left;
}

.setup__rotbtn:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.setup__rotbtn--danger {
  color: var(--color-danger-500);
}

.setup__inactive {
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px dashed var(--color-line);
}

.setup__unitcode--off {
  color: var(--color-muted);
  text-decoration: line-through;
}

.setup__rotedit {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface-soft);
  padding: 0.6rem 0.7rem;
  margin: 0.2rem 0 0.6rem;
}

.setup__rotchoice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: var(--color-ink-soft);
}

.setup__rplist {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.5rem 0;
}

.setup__rpchip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  background: var(--color-surface);
  padding: 0.2rem 0.4rem 0.2rem 0.7rem;
}

.setup__rpx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 0;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
}

.setup__rpx svg {
  width: 11px;
  height: 11px;
}

.setup__rpx:hover {
  color: var(--color-danger-500);
}

.setup__rpadd {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.setup__rpadd .setup__input {
  flex: 1;
  min-width: 0;
}

.setup__pcrow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}

.setup__pccat {
  flex: 1.4;
  min-width: 0;
}

.setup__pccode {
  flex: 1;
  min-width: 0;
}

.setup__rothours {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.8rem;
  color: var(--color-muted);
  flex-wrap: wrap;
}

.setup__rothours-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.setup__input--time {
  width: 110px;
}

.setup__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
  gap: 1rem;
  align-items: start;
}

.setup__log {
  list-style: none;
  margin: 0.5rem 0 0.7rem;
  padding: 0;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-surface);
}

.setup__logrow {
  display: grid;
  grid-template-columns: 92px 160px 1fr;
  gap: 0.7rem;
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
  border-bottom: 1px solid var(--color-line-soft);
  align-items: baseline;
}

.setup__logrow:last-child {
  border-bottom: 0;
}

.setup__logrow:nth-child(even) {
  background: oklch(0.45 0.02 260 / 0.045);
}

.setup__logwhen {
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.setup__logwho {
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setup__logwhat {
  color: var(--color-ink-soft);
  min-width: 0;
  overflow-wrap: anywhere;
}

.setup__loginput {
  font: inherit;
  font-size: 0.8rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.25rem 0.6rem;
  background: var(--color-surface);
  margin-left: auto;
}

@media (max-width: 700px) {
  .setup__logrow {
    grid-template-columns: 1fr;
    gap: 0.1rem;
  }
}

.setup__card {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.8rem 0.95rem;
  box-shadow: var(--shadow-sm);
  margin-bottom: 1rem;
}

.setup__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}

.setup__h {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0;
}

.setup__scroll {
  overflow-x: auto;
}

.setup__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.setup__th-seat,
.setup__th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--color-line);
}

.setup__th[data-platoon='A'] {
  border-top: 3px solid oklch(0.55 0.2 27);
}

.setup__th[data-platoon='B'] {
  border-top: 3px solid oklch(0.5 0.16 255);
}

.setup__th[data-platoon='C'] {
  border-top: 3px solid oklch(0.55 0.15 150);
}

.setup__table td {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: top;
}

.setup__tr--unit td {
  border-top: 1px solid var(--color-line);
}

.setup__seatcell {
  white-space: nowrap;
}

.setup__unitcode {
  font-weight: 700;
  color: var(--color-brand-700);
  margin-right: 0.35rem;
}

.setup__seatlabel {
  color: var(--color-ink);
}

.setup__qual {
  display: block;
  font-size: 0.68rem;
  color: var(--color-muted);
}

.setup__cellbtn {
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--color-ink);
  padding: 0.1rem 0.3rem;
  margin: -0.1rem -0.3rem;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  display: block;
  width: 100%;
}

.setup__cellbtn:hover {
  background: var(--color-surface-sunk);
}

.setup__open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.setup__upcoming {
  display: block;
  font-size: 0.7rem;
  color: var(--color-accent-700);
  margin-top: 0.1rem;
}

.setup__editcell {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 185px;
}

.setup__select,
.setup__input {
  font: inherit;
  font-size: 0.84rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  max-width: 230px;
}

.setup__from {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--color-muted);
}

.setup__date {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
}

.setup__editbtns {
  display: flex;
  gap: 0.35rem;
}

.setup__btn {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
  white-space: nowrap;
}

.setup__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.setup__btn--danger {
  color: var(--color-danger-500);
}

.setup__foot {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0.6rem 0 0;
}

.setup__muted {
  font-size: 0.82rem;
  color: var(--color-muted);
  margin: 0;
}

.setup__change {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.setup__change:last-child {
  border-bottom: 0;
}

.setup__change-main {
  min-width: 0;
  flex: 1;
}

.setup__change-label {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0;
}

.setup__change-detail {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0.05rem 0 0;
}

.setup__chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-700);
  border: 1px solid oklch(0.85 0.06 86.8);
  background: oklch(0.98 0.02 86.8);
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}

.setup__addunit {
  border-bottom: 1px solid var(--color-line-soft);
  padding-bottom: 0.7rem;
  margin-bottom: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.setup__addgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.setup__field {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  color: var(--color-muted);
}

.setup__unitrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.setup__unitrow:last-child {
  border-bottom: 0;
}

.setup__unitinfo {
  min-width: 0;
}

.setup__unitseats {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin-left: 0.15rem;
}

.setup__unitstation {
  display: block;
  font-size: 0.7rem;
  color: var(--color-muted-soft);
}

.setup__unit-order {
  display: inline-flex;
  gap: 3px;
  flex: none;
}

.setup__order-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}

.setup__order-btn svg {
  width: 13px;
  height: 13px;
}

@media (max-width: 980px) {
  .setup__cols {
    grid-template-columns: 1fr;
  }
}
</style>
