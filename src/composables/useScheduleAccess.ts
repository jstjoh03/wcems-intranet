import { ref, computed } from 'vue'
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

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) return // dev derives from the role toggle below
  const uid = auth.appUser?.id
  if (!uid || auth.isKiosk) return
  const lvlRes = await supabase.rpc('sched_level')
  const level = (lvlRes.data as string | null) ?? 'member'
  probedLevel.value = level
  allowed.value = level !== 'none'
}

export function useScheduleAccess() {
  void load()
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
