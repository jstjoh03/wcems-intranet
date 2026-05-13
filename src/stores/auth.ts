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
  title: 'Paramedic',
  shift: 'C',
  station: 'S202',
  fuelNumber: '30988',
  dateOfBirth: '1991-04-03',
  showBirthday: true,
  phone: '(979) 555-0123',
  inDirectory: true,
  photoUrl: null,
  featuredQuickLinkIds: [],
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
    title: null,
    shift: null,
    station: null,
    fuelNumber: null,
    dateOfBirth: null,
    showBirthday: true,
    phone: null,
    inDirectory: true,
    photoUrl: null,
    featuredQuickLinkIds: [],
  }
}

interface AppUserRow {
  id: string
  auth_user_id: string | null
  email: string
  first_name: string
  last_name: string
  full_name: string
  role: Role
  title: string | null
  shift: ShiftLetter | null
  station: string | null
  fuel_number: string | null
  date_of_birth: string | null
  show_birthday: boolean
  phone: string | null
  in_directory: boolean | null
  photo_url: string | null
  active: boolean
  featured_quick_link_ids: string[] | null
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
    title: row.title,
    shift: row.shift,
    station: row.station,
    fuelNumber: row.fuel_number,
    dateOfBirth: row.date_of_birth,
    showBirthday: row.show_birthday,
    phone: row.phone,
    /* Default to true if the column hasn't been migrated yet — keeps
       existing UI behavior (users visible) and matches the column's
       SQL default once the migration lands. */
    inDirectory: row.in_directory ?? true,
    photoUrl: row.photo_url,
    featuredQuickLinkIds: row.featured_quick_link_ids ?? [],
  }
}

async function fetchAppUserRow(authUserId: string): Promise<AppUserRow | null> {
  /* Look up by auth_user_id rather than id — after the
     20260509001100_app_users_decouple_auth migration, app_users.id is
     a stable internal uuid that doesn't necessarily equal auth.uid()
     (so pre-seeded rows can exist before sign-in). The auth_user_id
     column is the bridge from the auth provider's UID to the row. */
  const { data, error } = await supabase
    .from('app_users')
    .select(
      'id, auth_user_id, email, first_name, last_name, full_name, role, title, shift, station, fuel_number, date_of_birth, show_birthday, phone, in_directory, photo_url, active, featured_quick_link_ids',
    )
    .eq('auth_user_id', authUserId)
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
   * Dev-stub mode mutates the in-memory user only. Real-session mode
   * UPDATEs and re-fetches. The column-lock trigger admits station +
   * shift + show_birthday from non-admins; everything else 42501s.
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

  /** Update the signed-in user's shift assignment. Same dev/real split
   *  as updateOwnStation. */
  async function updateOwnShift(next: 'A' | 'B' | 'C' | null) {
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, shift: next }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ shift: next })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Update the signed-in user's phone number (free text, ≤30 chars).
   *  Pass null/empty to clear. */
  async function updateOwnPhone(next: string | null) {
    const value = next?.trim() ? next.trim().slice(0, 30) : null
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, phone: value }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ phone: value })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Toggle the signed-in user's Employee Directory visibility. */
  async function updateOwnInDirectory(next: boolean) {
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, inDirectory: next }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ in_directory: next })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Update the signed-in user's profile photo URL. Pass null to clear
   *  (Avatar falls back to initials). The upload itself happens in the
   *  caller via supabase.storage; this just persists the resulting
   *  public URL on app_users. */
  async function updateOwnPhotoUrl(next: string | null) {
    const value = next?.trim() ? next.trim() : null
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, photoUrl: value }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ photo_url: value })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Toggle the signed-in user's birthday-on-dashboard opt-in. */
  async function updateOwnShowBirthday(next: boolean) {
    if (usingDevStub.value) {
      if (appUser.value) appUser.value = { ...appUser.value, showBirthday: next }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ show_birthday: next })
      .eq('id', id)
    if (error) throw error
    await refresh()
  }

  /** Update the signed-in user's customized featured-shortcut list.
   *  Pass an array of quick_links.id values (up to 4). Empty array
   *  resets to role-based defaults. */
  async function updateOwnFeaturedQuickLinks(ids: string[]) {
    const next = ids.slice(0, 4)
    if (usingDevStub.value) {
      if (appUser.value) {
        appUser.value = { ...appUser.value, featuredQuickLinkIds: next }
      }
      return
    }
    const id = appUser.value?.id
    if (!id) throw new Error('Not signed in')
    const { error } = await supabase
      .from('app_users')
      .update({ featured_quick_link_ids: next })
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
    updateOwnShift,
    updateOwnPhone,
    updateOwnInDirectory,
    updateOwnShowBirthday,
    updateOwnPhotoUrl,
    updateOwnFeaturedQuickLinks,
    signInWithMicrosoft,
    signOut,
    setRole,
  }
})
