import { ref, computed, onMounted, onUnmounted } from 'vue'
import holidays from '@/data/holidays-2026.json'

/**
 * Greeting + today's date string in America/Chicago. Updates hourly so the
 * greeting flips at noon/5pm without a refresh.
 */
export function useGreeting() {
  const now = ref(new Date())
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(() => (now.value = new Date()), 60_000 * 5)
  })
  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  const centralHourStr = computed(() =>
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Chicago',
    }).format(now.value),
  )

  const greeting = computed(() => {
    const h = parseInt(centralHourStr.value, 10)
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })

  const todayStr = computed(() =>
    now.value.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Chicago',
    }),
  )

  const isoDate = computed(() => {
    const central = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'America/Chicago',
    }).format(now.value)
    const [m, d, y] = central.split('/')
    return `${y}-${m}-${d}`
  })

  const todayHoliday = computed(() => {
    return holidays.find((h) => h.date === isoDate.value) ?? null
  })

  return { now, greeting, todayStr, isoDate, todayHoliday }
}
