import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Role, ShiftLetter } from '@/types'

/**
 * Employee Directory feed.
 *
 * Reads via the SECURITY DEFINER `get_employee_directory()` SQL function
 * — that's the only path non-admins have into the directory-safe slice
 * of `app_users`. The function filters to `active = true AND in_directory
 * = true` server-side, so the client never has to know about the opt-out
 * flag here.
 *
 * Module-level singleton + lazy load to match the project's other
 * composable conventions. The list rarely changes within a session, so
 * we don't subscribe to realtime — admins editing the roster will see
 * updates after refresh, and crew opt-outs propagate on next page load.
 * If we ever want live updates we can add a postgres_changes subscription
 * filtered on app_users INSERT/UPDATE/DELETE.
 */

export interface DirectoryEntry {
  id: string
  fullName: string
  firstName: string
  lastName: string
  title: string | null
  role: Role
  shift: ShiftLetter | null
  station: string | null
  email: string
  phone: string | null
  photoUrl: string | null
  initials: string
}

interface DirectoryRow {
  id: string
  full_name: string
  first_name: string
  last_name: string
  title: string | null
  role: Role
  shift: ShiftLetter | null
  station: string | null
  email: string
  phone: string | null
  photo_url: string | null
}

function computeInitials(fullName: string): string {
  return (
    fullName
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

function rowToEntry(r: DirectoryRow): DirectoryEntry {
  return {
    id: r.id,
    fullName: r.full_name,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title,
    role: r.role,
    shift: r.shift,
    station: r.station,
    email: r.email,
    phone: r.phone,
    photoUrl: r.photo_url,
    initials: computeInitials(r.full_name || r.email),
  }
}

const entries = ref<DirectoryEntry[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const lastFetchedAt = ref<Date | null>(null)
let loadStarted = false

async function loadDirectory() {
  loading.value = true
  errorMessage.value = null
  const { data, error } = await supabase.rpc('get_employee_directory')
  if (error) {
    console.error('[directory] load failed:', error.message)
    errorMessage.value = error.message
    loading.value = false
    return
  }
  entries.value = ((data ?? []) as DirectoryRow[]).map(rowToEntry)
  lastFetchedAt.value = new Date()
  loading.value = false
}

export function useEmployeeDirectory() {
  const auth = useAuthStore()
  const isLive = !auth.usingDevStub

  if (isLive && !loadStarted) {
    loadStarted = true
    void loadDirectory()
  }

  async function refresh() {
    if (!isLive) return
    await loadDirectory()
  }

  const ready = computed(() => !loading.value && (lastFetchedAt.value !== null || !isLive))

  return {
    entries,
    loading,
    ready,
    errorMessage,
    lastFetchedAt,
    refresh,
  }
}
