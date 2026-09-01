import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import type { AppUser, Discipline, Instructor, Role } from '@/training/types'
import { supabase } from '@/training/lib/supabase'
import { useAuthStore as usePortalAuth } from '@/stores/auth'

/**
 * Auth store. Mirrors the WCEMS intranet model: the user signs in with
 * Microsoft/Entra via Supabase, and we hydrate `appUser` from the shared
 * `app_users` table (looked up by `auth_user_id`).
 *
 * Phase-1 access control: after sign-in we ALSO look up the user's row
 * in `training_instructors` (by email). If no row, or `active=false`,
 * the user is blocked — the router pushes them to /access-denied. This
 * is independent of `app_users.role` — an admin in the intranet is not
 * automatically a training instructor.
 *
 * `isAdmin` here means "training admin" (can manage instructors). The
 * intranet's `app_users.role` is loaded but no longer gates anything
 * inside the training PWA.
 */

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

function deriveFromSession(supaUser: User): AppUser {
  const email = supaUser.email ?? ''
  const meta = supaUser.user_metadata ?? {}
  const fullName: string =
    meta.full_name ?? meta.name ?? email.split('@')[0] ?? ''
  const parts = fullName.trim().split(/\s+/)
  return {
    id: supaUser.id,
    email,
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    fullName: fullName || email,
    initials: computeInitials(fullName || email),
    role: 'crew',
    title: null,
    station: null,
  }
}

interface AppUserRow {
  id: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  role: Role
  title: string | null
  station: string | null
}

async function fetchAppUserRow(authUserId: string): Promise<AppUserRow | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, first_name, last_name, full_name, role, title, station')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (error) {
    console.error('[auth] failed to load app_users row:', error.message)
    return null
  }
  return data as AppUserRow | null
}

interface InstructorRow {
  id: string
  email: string
  full_name: string
  instructor_number: string | null
  is_admin: boolean
  active: boolean
  created_at: string
  training_instructor_disciplines:
    | Array<{
        card_exp: string | null
        training_disciplines: { code: string } | null
      }>
    | null
}

async function fetchInstructorRow(email: string): Promise<Instructor | null> {
  // PostgREST is case-sensitive on filters but the unique index is on
  // lower(email). Use ilike with the exact escaped email so we match
  // case-insensitively without a server-side function.
  const { data, error } = await supabase
    .from('training_instructors')
    .select(
      `id, email, full_name, instructor_number, is_admin, active, created_at,
       training_instructor_disciplines (
         card_exp,
         training_disciplines ( code )
       )`,
    )
    .ilike('email', email)
    .maybeSingle()

  if (error) {
    console.error('[auth] failed to load training_instructors row:', error.message)
    return null
  }
  if (!data) return null
  const row = data as unknown as InstructorRow

  const codes: string[] = []
  const cardExpByCode: Record<string, string | null> = {}
  for (const link of row.training_instructor_disciplines ?? []) {
    const code = link.training_disciplines?.code
    if (!code) continue
    codes.push(code)
    cardExpByCode[code] = link.card_exp
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    instructorNumber: row.instructor_number,
    isAdmin: row.is_admin,
    active: row.active,
    disciplineCodes: codes,
    cardExpByCode,
    createdAt: row.created_at,
  }
}

export const useAuthStore = defineStore('training-auth', () => {
  const appUser = ref<AppUser | null>(null)
  const instructor = ref<Instructor | null>(null)
  /** training_employees row id for the signed-in user, if they're in the
   *  P1/P2/P3 pipeline. Null for users without a pipeline record (most
   *  supervisors / admins / brand-new crew). */
  const employeeId = ref<string | null>(null)
  const ready = ref(false)
  const accessToken = ref<string | null>(null)

  const role = computed<Role | null>(() => appUser.value?.role ?? null)
  /** Training-system admin (manages the instructor list). NOT the same
   *  as `app_users.role === 'admin'`. */
  const isAdmin = computed(() => !!instructor.value?.isAdmin)
  const isAuthenticated = computed(() => appUser.value !== null)
  /** True iff the signed-in user has an ACTIVE row in training_instructors.
   *  The router uses this to gate every instructor-side route. */
  const isInstructor = computed(
    () => !!instructor.value && instructor.value.active,
  )
  /** Discipline codes (e.g. 'BLS', 'LECTURE') the signed-in instructor is
   *  authorized for. Empty array if not an instructor. */
  const disciplines = computed<string[]>(
    () => instructor.value?.disciplineCodes ?? [],
  )

  // ── Training-pipeline access tiers ───────────────────────────────
  // Map to the intranet app_users.role enum (crew / supervisor / admin):
  //   crew       → own self-view only (/my-progress)
  //   supervisor → master grid + read-only on every employee
  //   admin      → full edit (phase transitions, file uploads, test edits)
  // Distinct from the existing training_instructors.is_admin which gates
  // the AHA/lecture admin pages.
  const isCrew = computed(() => role.value === 'crew')
  /** Supervisor OR admin — anyone allowed to see the master employee grid. */
  const isSupervisor = computed(
    () => role.value === 'supervisor' || role.value === 'admin',
  )
  /** Full-edit access on the training pipeline. Distinct from `isAdmin`
   *  (training_instructors.is_admin, which is AHA/lecture-only). */
  const isAppAdmin = computed(() => role.value === 'admin')
  /** True iff the user has a row in training_employees (i.e. is being
   *  tracked through the P1/P2/P3 pipeline). */
  const isPipelineEmployee = computed(() => employeeId.value !== null)

  function canTeach(code: string): boolean {
    return disciplines.value.includes(code)
  }

  async function fetchEmployeeId(appUserId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('training_employees')
      .select('id')
      .eq('app_user_id', appUserId)
      .maybeSingle()
    if (error) {
      console.error('[auth] failed to load training_employees row:', error.message)
      return null
    }
    return (data?.id as string | undefined) ?? null
  }

  async function applySession(supaUser: User | null) {
    if (supaUser) {
      appUser.value = deriveFromSession(supaUser)
      const row = await fetchAppUserRow(supaUser.id)
      if (row) {
        appUser.value = {
          id: row.id,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          fullName: row.full_name,
          initials: computeInitials(row.full_name || row.email),
          role: row.role,
          title: row.title,
          station: row.station,
        }
      }
      // Training-side allowlist
      const email = appUser.value.email
      instructor.value = email ? await fetchInstructorRow(email) : null
      // Pipeline-side: is this user being tracked in training_employees?
      employeeId.value = appUser.value.id
        ? await fetchEmployeeId(appUser.value.id)
        : null
    } else {
      appUser.value = null
      instructor.value = null
      employeeId.value = null
    }
  }

  async function reloadInstructor() {
    if (!appUser.value?.email) return
    instructor.value = await fetchInstructorRow(appUser.value.email)
  }

  async function init() {
    /* Dev stub: no real Supabase session — mirror the portal's role
       switcher (admins act as training admins/instructors). */
    const portal = usePortalAuth()
    if (portal.usingDevStub) {
      const u = portal.appUser
      if (u) {
        appUser.value = {
          id: u.id,
          email: u.email,
          firstName: u.firstName ?? u.fullName.split(' ')[0] ?? '',
          lastName: u.lastName ?? '',
          fullName: u.fullName,
          initials: u.initials ?? '?',
          role: (u.role as Role) ?? 'crew',
          title: null,
          station: null,
        }
        instructor.value = portal.isAdmin
          ? {
              id: 'dev-instructor',
              email: u.email,
              fullName: u.fullName,
              instructorNumber: null,
              isAdmin: true,
              active: true,
              disciplineCodes: ['BLS', 'ACLS', 'PALS', 'LECTURE'],
              cardExpByCode: {},
              createdAt: new Date().toISOString(),
            }
          : null
      }
      ready.value = true
      return
    }
    const { data } = await supabase.auth.getSession()
    accessToken.value = data.session?.access_token ?? null
    await applySession(data.session?.user ?? null)
    ready.value = true

    supabase.auth.onAuthStateChange((_event, session) => {
      accessToken.value = session?.access_token ?? null
      void applySession(session?.user ?? null)
    })
  }

  /* Sign-in/out belong to the portal shell — the training module only
     reads the shared Supabase session. Kept as no-ops for API compat. */
  async function signInWithMicrosoft() {
    /* portal handles sign-in */
  }

  async function signOut() {
    /* portal handles sign-out */
  }

  return {
    appUser,
    instructor,
    employeeId,
    ready,
    accessToken,
    role,
    isAdmin,
    isAuthenticated,
    isInstructor,
    isCrew,
    isSupervisor,
    isAppAdmin,
    isPipelineEmployee,
    disciplines,
    canTeach,
    reloadInstructor,
    init,
    signInWithMicrosoft,
    signOut,
  }
})

// Re-export the Discipline type so callers can `import type { Discipline }
// from '@/training/stores/auth'` if they want — but the canonical home is `@/types`.
export type { Discipline }
