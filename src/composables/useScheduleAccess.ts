import { ref, computed, watch, effectScope } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Lightweight schedule-access probe for global chrome (masthead/drawer)
 * — one small query instead of pulling the whole scheduling store into
 * every page. COMPANY-WIDE since 2026-09-17: everyone except explicit
 * 'none' sees the nav entry. useSchedule.canAccessModule stays the
 * in-module authority; keep the two predicates in step.
 */

const allowed = ref(false)
const probedLevel = ref('member')
let loadStarted = false
let retryArmed = false

async function load() {
  const auth = useAuthStore()
  if (auth.usingDevStub) return // dev derives from the role toggle below
  const uid = auth.appUser?.id
  /* No signed-in person yet (or a shared kiosk account) — bail WITHOUT
     latching, so the retry watcher below can probe once auth lands.
     The old version set loadStarted before this check, which could
     stick `allowed=false` for the whole app session if the first
     chrome component mounted before the auth row hydrated. */
  if (!uid || auth.isKiosk) return
  if (loadStarted) return
  loadStarted = true
  const lvlRes = await supabase.rpc('sched_level')
  const level = (lvlRes.data as string | null) ?? 'member'
  probedLevel.value = level
  allowed.value = level !== 'none'
}

/** Re-probe when the signed-in user appears or changes (sign-in without
 *  a reload, auth row landing after chrome mounted). Detached scope so
 *  the watcher survives whichever component armed it. */
function armRetry() {
  if (retryArmed) return
  retryArmed = true
  const scope = effectScope(true)
  scope.run(() => {
    const auth = useAuthStore()
    watch(
      () => auth.appUser?.id,
      () => {
        void load()
      },
    )
  })
}

export function useScheduleAccess() {
  void load()
  armRetry()
  const auth = useAuthStore()
  const canSeeSchedule = computed(() => (auth.usingDevStub ? true : allowed.value))
  /** The probed sched_level — lets light consumers (profile modal's
   *  Scheduling section) branch on editor/supervisor without booting
   *  the scheduling store. */
  const level = computed(() =>
    auth.usingDevStub
      ? auth.isAdmin
        ? 'global_admin'
        : auth.isSupervisor
          ? 'supervisor'
          : 'member'
      : probedLevel.value,
  )
  return { canSeeSchedule, level }
}
