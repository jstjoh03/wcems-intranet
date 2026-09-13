<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule, addDaysIso, todayCentralIso, type DayModel } from '@/composables/useSchedule'

/**
 * Month board — the default view, mirroring Aladtec's monthly calendar:
 * every cell carries the full day roster (unit blocks, names with
 * credentials, right-aligned times, open seats in the seat's name).
 * On phones the roster collapses to platoon chip + open count and the
 * cell links into the Day view.
 */

const props = defineProps<{ month: string }>() // 'YYYY-MM'
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const sched = useSchedule()
const todayIso = todayCentralIso()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat']

interface Cell {
  iso: string
  dayNum: number
  inMonth: boolean
  isToday: boolean
  model: DayModel
}

const weeks = computed<Cell[][]>(() => {
  const first = new Date(`${props.month}-01T00:00:00`)
  const gridStart = addDaysIso(`${props.month}-01`, -first.getDay())
  const out: Cell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const iso = addDaysIso(gridStart, w * 7 + d)
      row.push({
        iso,
        dayNum: Number(iso.slice(8, 10)),
        inMonth: iso.slice(0, 7) === props.month,
        isToday: iso === todayIso,
        model: sched.dayModel(iso),
      })
    }
    if (row.every((c) => !c.inMonth)) break
    out.push(row)
  }
  return out
})

/** A row is worth a time label only when it isn't the standard full shift. */
function showTime(start: string, end: string): boolean {
  return !(start === '0600' && end === '0600')
}
</script>

<template>
  <div class="mb">
    <div class="mb__weekdays">
      <span v-for="w in WEEKDAYS" :key="w" class="mb__weekday">{{ w }}</span>
    </div>

    <div v-for="(week, wi) in weeks" :key="wi" class="mb__week">
      <div
        v-for="c in week"
        :key="c.iso"
        class="mb__cell"
        :class="{ 'mb__cell--out': !c.inMonth, 'mb__cell--today': c.isToday }"
      >
        <button class="mb__cellhead" @click="emit('open-day', c.iso)">
          <span class="mb__daynum">{{ c.dayNum }}</span>
          <span class="mb__platoon" :data-platoon="c.model.platoon">
            <span class="mb__dot" />{{ c.model.platoon }} Shift
          </span>
          <span v-if="c.model.openCount > 0" class="mb__open">{{ c.model.openCount }} open</span>
        </button>

        <div class="mb__roster">
          <div v-for="um in c.model.units" :key="um.unit.id" class="mb__unit">
            <p class="mb__unitname">{{ um.unit.code }}</p>
            <template v-for="sm in um.seats" :key="sm.seat.id">
              <div
                v-for="(row, ri) in sm.rows"
                :key="sm.seat.id + '-' + ri"
                class="mb__row"
              >
                <span v-if="row.open" class="mb__name mb__name--open">{{ sm.seat.label }}</span>
                <span v-else class="mb__name">
                  {{ row.name }}<span v-if="row.credential" class="mb__cred"> - {{ row.credential }}</span>
                </span>
                <span v-if="showTime(row.start, row.end)" class="mb__time">{{ row.start }}-{{ row.end }}</span>
              </div>
            </template>
            <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="mb__row mb__row--extra">
              <span class="mb__name">{{ ex.name }}</span>
              <span class="mb__time">{{ ex.start }}-{{ ex.end }}</span>
            </div>
          </div>
          <div v-for="ex in c.model.unattached" :key="ex.entryId ?? ex.name" class="mb__row mb__row--extra">
            <span class="mb__name">{{ ex.name }}</span>
            <span class="mb__time">{{ ex.start }}-{{ ex.end }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="mb__legend">
      <span class="mb__platoon" data-platoon="A"><span class="mb__dot" />A Shift</span>
      <span class="mb__platoon" data-platoon="B"><span class="mb__dot" />B Shift</span>
      <span class="mb__platoon" data-platoon="C"><span class="mb__dot" />C Shift</span>
      <span class="mb__legend-note">48/96 rotation · 0600 changeover · times shown only when not 0600–0600</span>
    </div>
  </div>
</template>

<style scoped>
.mb__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 6px;
}

.mb__weekday {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  text-align: center;
}

.mb__week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 6px;
  align-items: stretch;
}

.mb__cell {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.mb__cell--out {
  opacity: 0.45;
  background: var(--color-surface-soft);
}

.mb__cell--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 1px var(--color-accent-600);
}

.mb__cellhead {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  font: inherit;
  text-align: left;
  padding: 0.3rem 0.4rem;
  cursor: pointer;
}

.mb__cellhead:hover .mb__daynum {
  color: var(--color-brand-600);
}

.mb__daynum {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.mb__platoon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--color-surface);
  white-space: nowrap;
}

.mb__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: none;
}

.mb__platoon[data-platoon='A'] .mb__dot {
  background: oklch(0.55 0.2 27);
}

.mb__platoon[data-platoon='B'] .mb__dot {
  background: oklch(0.5 0.16 255);
}

.mb__platoon[data-platoon='C'] .mb__dot {
  background: oklch(0.55 0.15 150);
}

.mb__open {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-danger-500);
  margin-left: auto;
  white-space: nowrap;
}

.mb__roster {
  padding: 0.15rem 0.4rem 0.3rem;
}

.mb__unit {
  padding: 0.12rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.mb__unit:last-child {
  border-bottom: 0;
}

.mb__unitname {
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-brand-700);
  margin: 0 0 0.05rem;
}

.mb__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.3rem;
  line-height: 1.35;
}

.mb__name {
  font-size: 0.68rem;
  color: var(--color-ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.mb__cred {
  color: var(--color-muted);
}

.mb__time {
  font-size: 0.62rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mb__row--extra .mb__name {
  color: var(--color-accent-700);
}

.mb__legend {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}

.mb__legend-note {
  font-size: 12px;
  color: var(--color-muted);
}

/* Phone: collapse rosters — the cell header (day, platoon, opens) stays
   and taps through to the Day view. */
@media (max-width: 900px) {
  .mb__roster {
    display: none;
  }

  .mb__cellhead {
    border-bottom: 0;
    background: var(--color-surface);
    flex-direction: column;
    align-items: flex-start;
  }

  .mb__open {
    margin-left: 0;
  }
}
</style>
