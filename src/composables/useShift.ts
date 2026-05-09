import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ShiftLetter } from '@/types'

/**
 * WCEMS shift rotation — 48-hour shifts cycling B → C → A.
 * Anchor 2026-04-06 is Day 1 of B-Shift. All math runs in America/Chicago
 * so it's stable for users hitting the app from out-of-state.
 *
 * Lifted verbatim from the SPFx DutyStatus webpart so the new app stays in
 * lock-step with the legacy intranet's calculation.
 */
export function getCurrentShift(now: Date = new Date()): { shift: ShiftLetter; day: 1 | 2 } {
  const anchor = new Date('2026-04-06T00:00:00')
  const centralDateStr = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Chicago',
  }).format(now)
  const [m, d, y] = centralDateStr.split('/')
  const today = new Date(`${y}-${m}-${d}T00:00:00`)
  const daysDiff = Math.floor((today.getTime() - anchor.getTime()) / 86_400_000)
  const shifts: ShiftLetter[] = ['B', 'C', 'A']
  const shift = shifts[((Math.floor(daysDiff / 2) % 3) + 3) % 3]
  const day = ((daysDiff % 2) + 2) % 2 === 0 ? 1 : 2
  return { shift, day: day as 1 | 2 }
}

/**
 * Reactive composable wrapping `getCurrentShift`. Updates once a minute.
 * Returns the on-duty shift letter, the day-of-shift (1 or 2), and a derived
 * `isOnDuty` bool given the user's own shift letter.
 */
export function useShift(userShift?: ShiftLetter | null) {
  const now = ref(new Date())
  let intervalId: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    now.value = new Date()
  }

  onMounted(() => {
    intervalId = setInterval(tick, 60_000)
  })

  onUnmounted(() => {
    if (intervalId !== null) clearInterval(intervalId)
  })

  const current = computed(() => getCurrentShift(now.value))
  const isOnDuty = computed(() => userShift != null && userShift === current.value.shift)

  return { now, current, isOnDuty }
}
