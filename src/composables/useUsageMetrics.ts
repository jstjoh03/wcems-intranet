import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

/**
 * Admin-facing usage metrics for the /admin/usage page.
 *
 * Pulls four things in parallel:
 *  - overview counts (roster, ever-signed-in, active 24h/7d/30d)
 *  - top routes (last 7 days) via admin_usage_top_routes RPC
 *  - top users (last 30 days) via admin_usage_top_users RPC
 *  - never-signed-in roster slice (auth_user_id IS NULL)
 *
 * All counts derive from app_users.last_seen_at (bumped by
 * useUsageTracking on every route change) so they reflect real
 * engagement, not just sign-in timestamps. Anyone who closed the tab
 * three weeks ago and never came back stops counting toward "active 7d"
 * but stays in "ever signed in."
 */

export interface UsageOverview {
  roster: number
  everSignedIn: number
  active24h: number
  active7d: number
  active30d: number
}

export interface TopRoute {
  route: string
  views: number
  unique_users: number
}

export interface TopUser {
  user_id: string
  full_name: string
  role: string
  views: number
  last_seen_at: string | null
}

export interface NeverSignedInUser {
  id: string
  full_name: string
  role: string
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

export function useUsageMetrics() {
  const overview = ref<UsageOverview | null>(null)
  const topRoutes = ref<TopRoute[]>([])
  const topUsers = ref<TopUser[]>([])
  const neverSignedIn = ref<NeverSignedInUser[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [roster, ever, a24, a7, a30, routesRes, usersRes, neverRes] = await Promise.all([
        supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .eq('active', true),
        supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .not('auth_user_id', 'is', null),
        supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .gte('last_seen_at', isoDaysAgo(1)),
        supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .gte('last_seen_at', isoDaysAgo(7)),
        supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .gte('last_seen_at', isoDaysAgo(30)),
        supabase.rpc('admin_usage_top_routes', { days: 7, max_rows: 25 }),
        supabase.rpc('admin_usage_top_users', { days: 30, max_rows: 15 }),
        supabase
          .from('app_users')
          .select('id, full_name, role')
          .is('auth_user_id', null)
          .eq('active', true)
          .order('full_name'),
      ])

      overview.value = {
        roster: roster.count ?? 0,
        everSignedIn: ever.count ?? 0,
        active24h: a24.count ?? 0,
        active7d: a7.count ?? 0,
        active30d: a30.count ?? 0,
      }
      topRoutes.value = (routesRes.data ?? []) as TopRoute[]
      topUsers.value = (usersRes.data ?? []) as TopUser[]
      neverSignedIn.value = (neverRes.data ?? []) as NeverSignedInUser[]

      // Surface the first non-trivial error if any sub-query failed.
      const firstErr =
        roster.error ??
        ever.error ??
        a24.error ??
        a7.error ??
        a30.error ??
        routesRes.error ??
        usersRes.error ??
        neverRes.error
      if (firstErr) {
        error.value = firstErr.message
      }
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      loading.value = false
    }
  }

  const reachPct = computed(() => {
    const o = overview.value
    if (!o || o.roster === 0) return 0
    return Math.round((o.everSignedIn / o.roster) * 100)
  })

  return {
    overview,
    topRoutes,
    topUsers,
    neverSignedIn,
    loading,
    error,
    reachPct,
    load,
  }
}
