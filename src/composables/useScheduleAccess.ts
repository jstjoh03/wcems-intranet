import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Lightweight schedule-access probe for global chrome (masthead/drawer)
 * — shows the Scheduling nav entry to exactly the people the module's
 * soft-launch gate admits (editors, supervisors, Setup-listed pilot
 * testers) with two small queries, instead of pulling the whole
 * scheduling store into every page. useSchedule.canAccessModule stays
 * the in-module authority; keep the two predicates in step when the
 * crew-wide gate opens (~Sep 24: every level except 'none').
 */

const allowed = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) return // dev derives from the role toggle below
  const uid = auth.appUser?.id
  if (!uid || auth.isKiosk) return
  const [lvlRes, pilotRes] = await Promise.all([
    supabase.rpc('sched_level'),
    supabase.from('sched_settings').select('value').eq('key', 'pilot').maybeSingle(),
  ])
  const level = (lvlRes.data as string | null) ?? 'member'
  const ids = (pilotRes.data?.value as { user_ids?: unknown } | null)?.user_ids
  allowed.value =
    level === 'global_admin' ||
    level === 'scheduler' ||
    level === 'supervisor' ||
    (Array.isArray(ids) && ids.includes(uid))
}

export function useScheduleAccess() {
  void load()
  const auth = useAuthStore()
  const canSeeSchedule = computed(() =>
    auth.usingDevStub ? auth.isAdmin || auth.isSupervisor : allowed.value,
  )
  return { canSeeSchedule }
}
