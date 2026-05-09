import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import type { AppUser, Role, ShiftLetter } from '@/types'
import { supabase } from '@/lib/supabase'

/**
 * Auth store.
 *
 * Two modes coexist:
 *   1. **Real session** — `appUser` is hydrated from the `app_users`
 *      row keyed to `auth.uid()`. The DB trigger (`handle_new_auth_user`)
 *      seeds the row on first sign-in; until that round-trip lands we
 *      fall back to the Microsoft ID-token claims so the UI doesn't
 *      flicker an empty state.
 *   2. **Dev stub** (only in `import.meta.env.DEV` AND no real session)
 *      — hardcoded Justin so the dashboard renders without sign-in and
 *      the dev role switcher in the topbar still works for previewing
 *      crew / supervisor / admin views.
 *
 * `init()` runs from `main.ts` before the app mounts so `appUser` is
 * resolved before the first route renders.
 */

const DEV_STUB_USER: AppUser = {
  id: '1507',
  email: 'justin.stjohn@wallercountyems.com',
  firstName: 'Justin',
  lastName: 'St. John',
  fullName: 'Justin St. John',
  initials: 'JS',
  role: 'admin',
  shift: 'C',
  station: 'S202',
  fuelNumber: '30988',
  dateOfBirth: '1991-04-03',
  showBirthday: true,
}

/**
 * Bootstrap admins keyed by email — used only as a CLIENT-SIDE fallback
 * when the `app_users` row hasn't been created yet (e.g. brand-new sign-in
 * where the trigger fired but the SELECT loses the race). The real
 * source of truth is the `role` column on `app_users`, seeded by the
 * `handle_new_auth_user` trigger.
 */
const BOOTSTRAP_ADMINS = new Set<string>([
  'justin.stjohn@wallercountyems.com',
])

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

function deriveAppUserFromSession(supaUser: User): AppUser {
  const email = supaUser.email ?? ''
  const meta = supaUser.user_metadata ?? {}
  const fullName: string =
    meta.full_name ?? meta.name ?? email.split('@')[0] ?? ''
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] ?? ''
  const lastName = parts.slice(1).join(' ')

  const role: Role = BOOTSTRAP_ADMINS.has(email.toLowerCase()) ? 'admin' : 'crew'

  return {
    id: supaUser.id,
    email,
    firstName,
    lastName,
    fullName: fullName || email,
    initials: computeInitials(fullName || email),
    role,
    shift: null,
    station: null,
    fuelNumber: null,
    dateOfBirth: null,
    showBirthday: true,
  }
}

interface AppUserRow {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  role: Role
  shift: ShiftLetter | null
  station: string | null
  fuel_number: string | null
  date_of_birth: string | null
  show_birthday: boolean
  active: boolean
}

function rowToAppUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    initials: computeInitials(row.full_name || row.email),
    role: row.role,
    shift: row.shift,
    station: row.station,
    fuelNumber: row.fuel_number,
    dateOfBirth: row.date_of_birth,
    showBirthday: row.show_birthday,
  }
}

async function fetchAppUserRow(id: string): Promise<AppUserRow | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select(
      'id, email, first_name, last_name, full_name, role, shift, station, fuel_number, date_of_birth, show_birthday, active',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[auth] failed to load app_users row:', error.message)
    return null
  }
  return data as AppUserRow | null
}

export const useAuthStore = defineStore('auth', () => {
  const appUser = ref<AppUser | null>(null)
  const ready = ref(false)
  const usingDevStub = ref(false)

  const role = computed<Role | null>(() => appUser.value?.role ?? null)
  const isAdmin = computed(() => role.value === 'admin')
  const isSupervisor = computed(
    () => role.value === 'supervisor' || role.value === 'admin',
  )
  const isAuthenticated = computed(() => appUser.value !== null)

  async function applySession(supaUser: User | null) {
    if (supaUser) {
      /* First pass — hydrate from the JWT claims so the UI has something
         to render while the app_users SELECT round-trips. The second pass
         overwrites with the canonical row (role, shift, station, fuel-#)
         once it lands. */
      appUser.value = deriveAppUserFromSession(supaUser)
      usingDevStub.value = false
      const row = await fetchAppUserRow(supaUser.id)
      if (row) appUser.value = rowToAppUser(row)
    } else if (import.meta.env.DEV) {
      appUser.value = { ...DEV_STUB_USER }
      usingDevStub.value = true
    } else {
      appUser.value = null
      usingDevStub.value = false
    }
  }

  /**
   * Update the signed-in user's home station. Pass `null` to clear it.
   *
   * In dev-stub mode we just mutate the in-memory user — no real session
   * exists so a Supabase round-trip would 401. In real-session mode we
   * UPDATE the row and re-fetch so any DB-side normalization is
   * reflected. The DB enforces that only `station` (and `show_birthday`)
   * can change on a self-update; trying anything else throws 42501.
   */
  async function updateOwnStation(next: string | null) {
    const value = next?.trim() ? next.trim() : null
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, station: value }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ station: value })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Re-fetch the current user's app_users row. Useful after self-edits
   *  (profile updates) or after an admin promotes someone. No-op when no
   *  real session is active. */
  async function refresh() {
    const { data } = await supabase.auth.getSession()
    const supaUser = data.session?.user
    if (!supaUser) return
    const row = await fetchAppUserRow(supaUser.id)
    if (row) appUser.value = rowToAppUser(row)
  }

  async function init() {
    const { data } = await supabase.auth.getSession()
    await applySession(data.session?.user ?? null)
    ready.value = true

    supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user ?? null)
    })
  }

  /**
   * Kick off Microsoft OAuth via Supabase's Azure provider.
   *
   * `prompt=select_account` forces the Microsoft account picker every
   * time, with a visible "Use another account" option. This matters on
   * shared station computers — without it, Entra silently signs the
   * user in with whatever account is cached in the browser, which is
   * almost never the EMS account they want.
   */
  async function signInWithMicrosoft() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email openid profile',
        redirectTo: `${window.location.origin}/`,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
    /* applySession will be invoked by onAuthStateChange — but in dev mode
       it falls back to the stub, which is the expected dev behavior. */
  }

  /**
   * Dev-only role override for the topbar switcher. No-ops in production
   * builds (Vite tree-shakes the dead branch) and only mutates the
   * in-memory stub user — never touches the real Supabase session.
   */
  function setRole(next: Role) {
    if (!import.meta.env.DEV || !appUser.value) return
    appUser.value = { ...appUser.value, role: next }
  }

  return {
    appUser,
    ready,
    usingDevStub,
    role,
    isAdmin,
    isSupervisor,
    isAuthenticated,
    init,
    refresh,
    updateOwnStation,
    signInWithMicrosoft,
    signOut,
    setRole,
  }
})
