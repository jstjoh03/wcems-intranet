import { ref, computed, onBeforeUnmount } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { VideoSource } from '@/lib/videoSource'

/**
 * Strict preset list for the admin category selector. Free-text fallback
 * is the literal value `Other` — when the admin picks Other, a text
 * input appears for one-off categories. Edit this list to add/remove
 * top-level categories; existing rows on the renamed category keep
 * working until you migrate them.
 */
export const RECORDING_CATEGORY_PRESETS = [
  'Doc Day',
  'Protocol Updates',
  'Skills',
  'Community Paramedicine',
  'Operations',
  'Equipment',
  'Annual / Required',
] as const
export const RECORDING_CATEGORY_OTHER = 'Other' as const

export type SortKey = 'newest' | 'oldest' | 'most-viewed' | 'alpha'

/**
 * Browsable library of past training recordings. RLS on the server hides
 * inactive rows and rows whose `visible_to_roles` doesn't include the
 * current user's role, so we don't need to re-filter client-side beyond
 * what the admin page itself shows.
 *
 * Realtime keeps every signed-in user's library in sync — when an admin
 * publishes a new recording it appears in crew dashboards within seconds.
 */

export interface TrainingRecording {
  id: string
  title: string
  description: string | null
  instructor: string | null
  recordedAt: string | null            // YYYY-MM-DD
  durationMinutes: number | null
  category: string | null
  /** Free-form chip tags — secondary axis for cross-cutting discovery. */
  tags: string[]
  thumbnailUrl: string | null
  videoSource: VideoSource
  videoRef: string
  visibleToRoles: string[]
  viewCount: number
  active: boolean
}

interface TrainingRecordingRow {
  id: string
  title: string
  description: string | null
  instructor: string | null
  recorded_at: string | null
  duration_minutes: number | null
  category: string | null
  tags: string[] | null
  thumbnail_url: string | null
  video_source: VideoSource
  video_ref: string
  visible_to_roles: string[]
  view_count: number
  active: boolean
}

function rowToRecording(r: TrainingRecordingRow): TrainingRecording {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    instructor: r.instructor,
    recordedAt: r.recorded_at,
    durationMinutes: r.duration_minutes,
    category: r.category,
    tags: r.tags ?? [],
    thumbnailUrl: r.thumbnail_url,
    videoSource: r.video_source,
    videoRef: r.video_ref,
    visibleToRoles: r.visible_to_roles ?? [],
    viewCount: r.view_count ?? 0,
    active: r.active,
  }
}

const recordings = ref<TrainingRecording[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const lastFetchedAt = ref<Date | null>(null)
let realtimeSubscribed = false
let loadStarted = false

async function loadRecordings() {
  loading.value = true
  errorMessage.value = null
  const { data, error } = await supabase
    .from('training_recordings')
    .select(
      'id, title, description, instructor, recorded_at, duration_minutes, category, tags, thumbnail_url, video_source, video_ref, visible_to_roles, view_count, active',
    )
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[training-recordings] load failed:', error.message)
    errorMessage.value = error.message
    loading.value = false
    return
  }
  recordings.value = (data ?? []).map((r) => rowToRecording(r as TrainingRecordingRow))
  lastFetchedAt.value = new Date()
  loading.value = false
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('training_recordings')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'training_recordings' },
      (payload) => {
        const next = rowToRecording(payload.new as TrainingRecordingRow)
        if (recordings.value.some((r) => r.id === next.id)) return
        recordings.value = [next, ...recordings.value]
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'training_recordings' },
      (payload) => {
        const next = rowToRecording(payload.new as TrainingRecordingRow)
        recordings.value = recordings.value.map((r) => (r.id === next.id ? next : r))
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'training_recordings' },
      (payload) => {
        const old = payload.old as { id?: string }
        if (!old.id) return
        recordings.value = recordings.value.filter((r) => r.id !== old.id)
      },
    )
    .subscribe()
}

/**
 * Fire-and-forget view counter. Called from the player when the user
 * actually starts watching (not just opening the modal). Failures are
 * swallowed — the count is a nice-to-have, not a correctness concern.
 */
export async function incrementRecordingView(id: string) {
  try {
    await supabase.rpc('increment_training_recording_view', { p_id: id })
  } catch (e) {
    console.warn('[training-recordings] view increment failed:', e)
  }
}

export function useTrainingRecordings() {
  const auth = useAuthStore()
  const isLive = !auth.usingDevStub

  if (isLive && !loadStarted) {
    loadStarted = true
    void loadRecordings()
    subscribeRealtime()
  }

  onBeforeUnmount(() => {
    // Module-level singleton — nothing to tear down per-consumer.
  })

  async function refresh() {
    if (!isLive) return
    await loadRecordings()
  }

  const visibleRecordings = computed(() => recordings.value.filter((r) => r.active))

  const categories = computed(() => {
    const set = new Set<string>()
    for (const r of recordings.value) {
      if (r.category && r.category.trim()) set.add(r.category.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  })

  /** Every tag that exists on any recording — used by the admin chip
   *  input for autocomplete suggestions. */
  const allTags = computed(() => {
    const set = new Set<string>()
    for (const r of recordings.value) {
      for (const t of r.tags) {
        const v = t.trim()
        if (v) set.add(v)
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  })

  const ready = computed(() => !loading.value && (lastFetchedAt.value !== null || !isLive))

  return {
    recordings,           // all rows (admins see inactive too)
    visibleRecordings,    // active-only (for crew library)
    categories,
    allTags,
    loading,
    ready,
    errorMessage,
    lastFetchedAt,
    refresh,
  }
}

/**
 * Sort a recording list by the given key. Pure function — caller passes
 * the slice, gets a new array back. Stable within ties on title.
 */
export function sortRecordings(
  list: TrainingRecording[],
  key: SortKey,
): TrainingRecording[] {
  const arr = [...list]
  switch (key) {
    case 'newest':
      return arr.sort((a, b) => {
        const ad = a.recordedAt ?? ''
        const bd = b.recordedAt ?? ''
        if (ad !== bd) return bd.localeCompare(ad)
        return a.title.localeCompare(b.title)
      })
    case 'oldest':
      return arr.sort((a, b) => {
        const ad = a.recordedAt ?? ''
        const bd = b.recordedAt ?? ''
        if (ad !== bd) return ad.localeCompare(bd)
        return a.title.localeCompare(b.title)
      })
    case 'most-viewed':
      return arr.sort((a, b) => {
        if (b.viewCount !== a.viewCount) return b.viewCount - a.viewCount
        return a.title.localeCompare(b.title)
      })
    case 'alpha':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
  }
}
