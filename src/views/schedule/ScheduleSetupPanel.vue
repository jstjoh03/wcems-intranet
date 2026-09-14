<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  useSchedule,
  todayCentralIso,
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
})

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
            class="setup__unitrow"
          >
            <div class="setup__unitinfo">
              <span class="setup__unitcode">{{ u.code }}</span>
              <span class="setup__unitseats">{{ seatSummary(u.id) }}</span>
              <span v-if="u.station" class="setup__unitstation">{{ u.station }}</span>
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

.setup__warngrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
  margin: 0.6rem 0;
}

.setup__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
  gap: 1rem;
  align-items: start;
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
