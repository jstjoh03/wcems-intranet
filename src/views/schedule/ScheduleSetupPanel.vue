<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  type Platoon,
  type SchedSeat,
  type SchedUnit,
} from '@/composables/useSchedule'

/**
 * Setup — rotation template, unit display order, and scheduler access.
 * Template edits are effective-dated: assigning a person to a seat from a
 * date forward closes the previous assignment the day before, so past
 * days keep showing who actually held the seat.
 */

const sched = useSchedule()
const PLATOONS: Platoon[] = ['A', 'B', 'C']

// ── rotation template editing ────────────────────────────────────────

const editing = ref<{ seatId: string; platoon: Platoon } | null>(null)
const editUserId = ref<string>('')
const editFrom = ref(todayCentralIso())
const saving = ref(false)
const saveError = ref<string | null>(null)

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

function upcoming(seatId: string, platoon: Platoon) {
  const today = todayCentralIso()
  return sched.rotation.value
    .filter((a) => a.seatId === seatId && a.platoon === platoon && a.effectiveFrom > today)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

function occupantName(seatId: string, platoon: Platoon): string {
  const id = currentOccupant(seatId, platoon)
  if (!id) return ''
  return sched.personById.value.get(id)?.fullName ?? 'Unknown'
}

function startEdit(seatId: string, platoon: Platoon) {
  editing.value = { seatId, platoon }
  editUserId.value = currentOccupant(seatId, platoon) ?? ''
  editFrom.value = todayCentralIso()
  saveError.value = null
}

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  saveError.value = null
  const err = await sched.assignRotation(
    editing.value.seatId,
    editing.value.platoon,
    editUserId.value || null,
    editFrom.value,
  )
  saving.value = false
  if (err) {
    saveError.value = err
    return
  }
  editing.value = null
}

const unitsWithSeats = computed(() =>
  sched.units.value
    .filter((u) => u.active)
    .map((u: SchedUnit) => ({
      unit: u,
      seats: sched.seats.value
        .filter((s: SchedSeat) => s.unitId === u.id && s.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    })),
)

// ── unit order ───────────────────────────────────────────────────────

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

// ── access levels ────────────────────────────────────────────────────

const access = ref<Map<string, string>>(new Map())
const accessLoaded = ref(false)

onMounted(async () => {
  await sched.ensureLoaded()
  const rows = await sched.fetchAccessList()
  access.value = new Map(rows.map((r) => [r.userId, r.level]))
  accessLoaded.value = true
})

const LEVEL_LABELS: Record<string, string> = {
  global_admin: 'Global admin',
  scheduler: 'Scheduler',
  supervisor: 'Supervisor',
  member: 'Member',
}

function effectiveLevel(p: { id: string; role: string }): string {
  const granted = access.value.get(p.id)
  if (granted) return granted
  if (p.role === 'admin' || p.role === 'supervisor') return 'supervisor'
  return 'member'
}

async function changeAccess(userId: string, ev: Event) {
  const val = (ev.target as HTMLSelectElement).value
  const lvl = val === 'global_admin' || val === 'scheduler' ? val : null
  const err = await sched.setAccess(userId, lvl)
  if (err) {
    saveError.value = err
    return
  }
  if (lvl) access.value.set(userId, lvl)
  else access.value.delete(userId)
  access.value = new Map(access.value)
}
</script>

<template>
  <div class="setup">
    <p v-if="saveError" class="setup__error">{{ saveError }}</p>

    <section class="setup__section">
      <h2 class="setup__h">Rotation template</h2>
      <p class="setup__sub">
        Who holds each seat on each platoon. Changes take effect from the date you pick —
        earlier days keep the previous assignment.
      </p>

      <div v-for="uw in unitsWithSeats" :key="uw.unit.id" class="setup__unit">
        <div class="setup__unit-head">
          <span class="setup__unit-code">{{ uw.unit.code }}</span>
          <span class="setup__unit-station">{{ uw.unit.station }}</span>
          <span class="setup__unit-order">
            <button class="setup__order-btn" :disabled="orderSaving" aria-label="Move up" @click="moveUnit(uw.unit.id, -1)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg>
            </button>
            <button class="setup__order-btn" :disabled="orderSaving" aria-label="Move down" @click="moveUnit(uw.unit.id, 1)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </span>
        </div>

        <table class="setup__table">
          <thead>
            <tr>
              <th>Seat</th>
              <th v-for="p in PLATOONS" :key="p">{{ p }} Shift</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="seat in uw.seats" :key="seat.id">
              <td class="setup__seatname">{{ seat.label }}</td>
              <td v-for="p in PLATOONS" :key="p">
                <template v-if="editing && editing.seatId === seat.id && editing.platoon === p">
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
                  <button class="setup__cellbtn" @click="startEdit(seat.id, p)">
                    <span v-if="occupantName(seat.id, p)">{{ occupantName(seat.id, p) }}</span>
                    <span v-else class="setup__open">Open</span>
                  </button>
                  <p v-for="up in upcoming(seat.id, p)" :key="up.id" class="setup__upcoming">
                    {{ up.userId ? (sched.personById.value.get(up.userId)?.fullName ?? 'Unknown') : 'Open' }}
                    from {{ up.effectiveFrom }}
                  </p>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="setup__section">
      <h2 class="setup__h">Access levels</h2>
      <p class="setup__sub">
        Global admins manage everything including this list; Schedulers edit the schedule and
        students. Supervisors (from portal roles) can view everything and send page-outs.
        Everyone else is a Member.
      </p>
      <table class="setup__table setup__table--access" v-if="accessLoaded">
        <thead>
          <tr>
            <th>Name</th>
            <th>Level</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in sched.people.value" :key="p.id">
            <td>{{ p.fullName }}</td>
            <td>{{ LEVEL_LABELS[effectiveLevel(p)] }}</td>
            <td>
              <select
                v-if="sched.isGlobalAdmin.value"
                class="setup__select setup__select--sm"
                :value="access.get(p.id) ?? ''"
                @change="changeAccess(p.id, $event)"
              >
                <option value="">Default ({{ p.role === 'admin' || p.role === 'supervisor' ? 'Supervisor' : 'Member' }})</option>
                <option value="scheduler">Scheduler</option>
                <option value="global_admin">Global admin</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.setup__section {
  margin-bottom: 2rem;
}

.setup__h {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-brand-800);
  margin: 0 0 0.25rem;
}

.setup__sub {
  font-size: 0.85rem;
  color: var(--color-muted);
  margin: 0 0 0.9rem;
  max-width: 60ch;
}

.setup__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.setup__unit {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.8rem;
  box-shadow: var(--shadow-sm);
}

.setup__unit-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.setup__unit-code {
  font-weight: 700;
  color: var(--color-brand-700);
}

.setup__unit-station {
  font-size: 0.78rem;
  color: var(--color-muted);
}

.setup__unit-order {
  margin-left: auto;
  display: inline-flex;
  gap: 3px;
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

.setup__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.setup__table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--color-line);
}

.setup__table td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: top;
}

.setup__table tr:last-child td {
  border-bottom: 0;
}

.setup__seatname {
  color: var(--color-muted);
  white-space: nowrap;
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
}

.setup__cellbtn:hover {
  background: var(--color-surface-sunk);
}

.setup__open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.setup__upcoming {
  font-size: 0.72rem;
  color: var(--color-accent-700);
  margin: 0.15rem 0 0;
}

.setup__editcell {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 190px;
}

.setup__select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  max-width: 220px;
}

.setup__select--sm {
  font-size: 0.8rem;
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
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.setup__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}

.setup__table--access {
  max-width: 640px;
}
</style>
