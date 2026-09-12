<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule, addDaysIso, todayCentralIso } from '@/composables/useSchedule'

/**
 * Month calendar — the default schedule view. Each cell shows the on-duty
 * platoon (Aladtec colors: A red, B blue, C green), any open-seat count,
 * and a marker on days the signed-in member works. Clicking a day opens
 * the full day board.
 */

const props = defineProps<{ month: string }>() // 'YYYY-MM'
const emit = defineEmits<{ (e: 'open-day', iso: string): void }>()

const sched = useSchedule()
const todayIso = todayCentralIso()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Cell {
  iso: string
  dayNum: number
  inMonth: boolean
  isToday: boolean
  platoon: 'A' | 'B' | 'C'
  open: number
  mine: boolean
}

const cells = computed<Cell[]>(() => {
  const first = new Date(`${props.month}-01T00:00:00`)
  const startDow = first.getDay()
  const gridStart = addDaysIso(`${props.month}-01`, -startDow)
  const out: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const iso = addDaysIso(gridStart, i)
    const s = sched.daySummary(iso, sched.myUserId.value)
    out.push({
      iso,
      dayNum: Number(iso.slice(8, 10)),
      inMonth: iso.slice(0, 7) === props.month,
      isToday: iso === todayIso,
      platoon: s.platoon,
      open: s.open,
      mine: s.mine,
    })
  }
  // trim a trailing all-out-of-month week
  if (out.slice(35).every((c) => !c.inMonth)) return out.slice(0, 35)
  return out
})
</script>

<template>
  <div class="mb">
    <div class="mb__weekdays">
      <span v-for="w in WEEKDAYS" :key="w" class="mb__weekday">{{ w }}</span>
    </div>
    <div class="mb__grid">
      <button
        v-for="c in cells"
        :key="c.iso"
        class="mb__cell"
        :class="{
          'mb__cell--out': !c.inMonth,
          'mb__cell--today': c.isToday,
        }"
        @click="emit('open-day', c.iso)"
      >
        <span class="mb__daynum">{{ c.dayNum }}</span>
        <span class="mb__chips">
          <span class="mb__platoon" :data-platoon="c.platoon">
            <span class="mb__dot" />{{ c.platoon }} Shift
          </span>
          <span v-if="c.open > 0" class="mb__open">{{ c.open }} open</span>
          <span v-if="c.mine" class="mb__mine">My shift</span>
        </span>
      </button>
    </div>
    <div class="mb__legend">
      <span class="mb__platoon" data-platoon="A"><span class="mb__dot" />A Shift</span>
      <span class="mb__platoon" data-platoon="B"><span class="mb__dot" />B Shift</span>
      <span class="mb__platoon" data-platoon="C"><span class="mb__dot" />C Shift</span>
      <span class="mb__legend-note">48/96 rotation · 0600 changeover</span>
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

.mb__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.mb__cell {
  min-height: 84px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 0.45rem 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), box-shadow 120ms var(--ease-out);
}

.mb__cell:hover {
  border-color: var(--color-brand-300);
  box-shadow: var(--shadow-sm);
}

.mb__cell--out {
  opacity: 0.45;
  background: var(--color-surface-soft);
}

.mb__cell--today {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 1px var(--color-accent-600);
}

.mb__daynum {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.mb__chips {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.mb__platoon {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 1px 8px;
  background: var(--color-surface);
  white-space: nowrap;
}

.mb__dot {
  width: 7px;
  height: 7px;
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
  font-size: 11px;
  font-weight: 600;
  color: var(--color-danger-500);
}

.mb__mine {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-700);
}

.mb__legend {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.8rem;
}

.mb__legend-note {
  font-size: 12px;
  color: var(--color-muted);
}

@media (max-width: 700px) {
  .mb__cell {
    min-height: 64px;
    padding: 0.3rem 0.35rem;
  }

  .mb__platoon {
    padding: 1px 6px;
    font-size: 10px;
  }

  .mb__open,
  .mb__mine {
    font-size: 10px;
  }
}
</style>
