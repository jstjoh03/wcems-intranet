import { ref, computed, onBeforeUnmount } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Upcoming training sessions, read from the `training_sessions` table.
 *
 * Both sources are populated server-side by the `sync-wix-training`
 * Edge Function (every 15 min via Supabase cron):
 *
 *   • source='wix'      — Wix Bookings time slots (seat counts).
 *   • source='calendar' — Internal Education group calendar events
 *                          tagged "blue" in Outlook.
 *
 * The browser only ever reads from Supabase — no MSAL, no popups,
 * no Graph calls. Realtime subscription pushes upserts/deletes from
 * the Edge Function straight to the dashboard cache.
 */

export interface TrainingEvent {
  id: string
  title: string
  /** YYYY-MM-DD (calendar date for the date pill). */
  date: string
  /** Free-text time label (e.g. "9:00 AM"). */
  time: string
  /** Registered count — 0 for calendar-only events. */
  filled: number
  /** Seat cap — 0 for calendar-only events. */
  total: number
  location: string
  instructor: string
  source: 'wix' | 'calendar'
}

interface TrainingSessionRow {
  id: string
  service_id: string | null
  title: string
  local_start: string
  total_capacity: number
  remaining_capacity: number
  location: string
  instructor: string
  source: 'wix' | 'calendar'
  synced_at: string
}

const events = ref<TrainingEvent[]>([])
const loading = ref(false)
const lastFetchedAt = ref<Date | null>(null)
const errorMessage = ref<string | null>(null)
let realtimeSubscribed = false
let activeConsumers = 0

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function isoDateLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatTimeOfDay(d: Date) {
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m === 0 ? `${h}:00 ${ampm}` : `${h}:${pad2(m)} ${ampm}`
}

function rowToEvent(r: TrainingSessionRow): TrainingEvent {
  /* local_start is stored as `YYYY-MM-DDTHH:MM:SS` (no TZ) reflecting
     Central Time. Parse positionally to avoid the viewer's local
     offset shifting the date. */
  const parts = r.local_start.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!parts) {
    return {
      id: r.id,
      title: r.title,
      date: '',
      time: '',
      filled: Math.max(0, r.total_capacity - r.remaining_capacity),
      total: r.total_capacity,
      location: r.location,
      instructor: r.instructor,
      source: r.source,
    }
  }
  const [, y, mo, d, hh, mm] = parts
  const localForTime = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
  )
  return {
    id: r.id,
    title: r.title,
    date: `${y}-${mo}-${d}`,
    time: formatTimeOfDay(localForTime),
    filled: Math.max(0, r.total_capacity - r.remaining_capacity),
    total: r.total_capacity,
    location: r.location,
    instructor: r.instructor,
    source: r.source,
  }
}

async function loadEvents() {
  loading.value = true
  errorMessage.value = null
  const todayIso = isoDateLocal(new Date())
  const { data, error } = await supabase
    .from('training_sessions')
    .select(
      'id, service_id, title, local_start, total_capacity, remaining_capacity, location, instructor, source, synced_at',
    )
    .gte('local_start', `${todayIso}T00:00:00`)
    .order('local_start', { ascending: true })
  if (error) {
    console.error('[training] load failed:', error.message)
    errorMessage.value = error.message
    loading.value = false
    return
  }
  events.value = (data ?? []).map((r) => rowToEvent(r as TrainingSessionRow))
  lastFetchedAt.value = new Date()
  loading.value = false
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('training_sessions')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'training_sessions' },
      (payload) => {
        const next = rowToEvent(payload.new as TrainingSessionRow)
        if (events.value.some((e) => e.id === next.id)) return
        events.value = [...events.value, next].sort((a, b) =>
          a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date),
        )
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'training_sessions' },
      (payload) => {
        const next = rowToEvent(payload.new as TrainingSessionRow)
        events.value = events.value.map((e) => (e.id === next.id ? next : e))
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'training_sessions' },
      (payload) => {
        const old = payload.old as { id?: string }
        if (!old.id) return
        events.value = events.value.filter((e) => e.id !== old.id)
      },
    )
    .subscribe()
}

export function useTraining() {
  const auth = useAuthStore()
  const isLive = !auth.usingDevStub

  activeConsumers += 1
  if (isLive) {
    void loadEvents()
    subscribeRealtime()
  }

  onBeforeUnmount(() => {
    activeConsumers -= 1
  })

  async function refresh() {
    if (!isLive) return
    await loadEvents()
  }

  const sortedEvents = computed(() =>
    [...events.value].sort((a, b) =>
      a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date),
    ),
  )

  const ready = computed(() => !loading.value && (lastFetchedAt.value !== null || !isLive))

  return {
    events: sortedEvents,
    loading,
    ready,
    lastFetchedAt,
    errorMessage,
    refresh,
    isLive,
  }
}
