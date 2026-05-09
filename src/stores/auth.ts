import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppUser, Role } from '@/types'

/**
 * Auth store — Phase 1 stub.
 *
 * Phase 2 will:
 *   1. Initialize MSAL (`@azure/msal-browser`) against the WCEMS-only
 *      Entra app registration (single-tenant, see decisions memo).
 *   2. After successful Microsoft sign-in, exchange the ID token for a
 *      Supabase JWT (custom claim with `role`).
 *   3. Hydrate `appUser` from the `app_users` table keyed by Entra `oid`.
 *
 * For now we hard-code Justin so all role-aware UI can be exercised.
 * Toggle the role via the demo switcher in the TopBar to preview each
 * permission boundary while we build.
 */
export const useAuthStore = defineStore('auth', () => {
  const appUser = ref<AppUser>({
    id: '1507',
    email: 'justin.stjohn@wallercountyems.com',
    firstName: 'Justin',
    lastName: 'St. John',
    fullName: 'Justin St. John',
    initials: 'JS',
    role: 'admin',
    shift: 'C',
    station: 'S202 / M271',
    fuelNumber: '30988',
    dateOfBirth: '1991-04-03',
    showBirthday: true,
  })

  const role = computed<Role | null>(() => appUser.value?.role ?? null)
  const isAdmin = computed(() => role.value === 'admin')
  const isSupervisor = computed(
    () => role.value === 'supervisor' || role.value === 'admin',
  )

  function setRole(next: Role) {
    if (appUser.value) appUser.value = { ...appUser.value, role: next }
  }

  function signOut() {
    // Phase 2: msal.logoutRedirect()
    appUser.value = null as unknown as AppUser
  }

  return {
    appUser,
    role,
    isAdmin,
    isSupervisor,
    setRole,
    signOut,
  }
})
