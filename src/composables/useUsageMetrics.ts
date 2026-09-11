import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

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

export interface DailyPoint {
  day: string
  views: number
  unique_users: number
}

export interface HourPoint {
  hour: number
  views: number
}

export interface EngagementRow {
  user_id: string
  full_name: string
  days_active: number
  ever_signed_in: boolean
}

export interface SectionShare {
  label: string
  views: number
  pct: number
}

/* Route prefix → human section, first match wins. */
const SECTIONS: Array<[string, string]> = [
  ['/protocols', 'Protocols'],
  ['/clinical-development', 'My Progress'],
  ['/clinical', 'Clinical Development'],
  ['/exam', 'Protocol exams'],
  ['/training/manage', 'Training admin'],
  ['/training-library', 'Training Library'],
  ['/training', 'Upcoming Classes'],
  ['/required-training', 'Required Training'],
  ['/directory', 'Directory'],
  ['/policies', 'Policies'],
  ['/hospitals', 'Hospitals'],
  ['/mih-referral', 'MIH Referral'],
  ['/skills', 'Skills Day'],
  ['/admin-staff', 'Admin Staff'],
  ['/admin', 'Admin tools'],
  ['/profile', 'Profiles'],
  ['/', 'Home'],
]

function sectionFor(route: string): string {
  for (const [prefix, label] of SECTIONS) {
    if (prefix === '/' ? route === '/' : route.startsWith(prefix)) return label
  }
  return 'Other'
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

export interface UserRouteRow {
  route: string
  views: number
  last_at: string | null
}

export function useUsageMetrics() {
  const overview = ref<UsageOverview | null>(null)
  const daily = ref<DailyPoint[]>([])
  const hourly = ref<HourPoint[]>([])
  const engagement = ref<EngagementRow[]>([])
  const sections = ref<SectionShare[]>([])
  const topRoutes = ref<TopRoute[]>([])
  const topUsers = ref<TopUser[]>([])
  const neverSignedIn = ref<NeverSignedInUser[]>([])
  const detailUser = ref<{ id: string; name: string } | null>(null)
  const detailRoutes = ref<UserRouteRow[]>([])
  const detailDaily = ref<Array<{ day: string; views: number }>>([])
  const detailLoading = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    const auth = useAuthStore()
    if (auth.usingDevStub) {
      /* Deterministic sample series so the page demos offline. */
      const days: DailyPoint[] = []
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000)
        const iso = d.toISOString().slice(0, 10)
        const wk = d.getDay()
        const base = wk === 0 || wk === 6 ? 14 : 26
        const uniques = base + ((i * 7) % 9)
        days.push({ day: iso, views: uniques * (4 + (i % 3)), unique_users: uniques })
      }
      daily.value = days
      hourly.value = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        views: Math.round(220 * Math.exp(-((h - 13) ** 2) / 28)) + (h >= 6 && h <= 21 ? 18 : 2),
      }))
      engagement.value = [
        ...Array.from({ length: 11 }, (_, i) => ({ user_id: `p${i}`, full_name: `Power ${i}`, days_active: 20, ever_signed_in: true })),
        ...Array.from({ length: 27 }, (_, i) => ({ user_id: `r${i}`, full_name: `Regular ${i}`, days_active: 8, ever_signed_in: true })),
        ...Array.from({ length: 22 }, (_, i) => ({ user_id: `o${i}`, full_name: `Occasional ${i}`, days_active: 2, ever_signed_in: true })),
        ...Array.from({ length: 9 }, (_, i) => ({ user_id: `d${i}`, full_name: `Dormant Sample ${i + 1}`, days_active: 0, ever_signed_in: true })),
        ...Array.from({ length: 3 }, (_, i) => ({ user_id: `n${i}`, full_name: `Never ${i}`, days_active: 0, ever_signed_in: false })),
      ]
      sections.value = [
        { label: 'Home', views: 1480, pct: 31 },
        { label: 'Protocols', views: 940, pct: 20 },
        { label: 'Clinical Development', views: 760, pct: 16 },
        { label: 'Directory', views: 430, pct: 9 },
        { label: 'Upcoming Classes', views: 350, pct: 7 },
        { label: 'Policies', views: 300, pct: 6 },
        { label: 'Hospitals', views: 250, pct: 5 },
        { label: 'Other', views: 280, pct: 6 },
      ]
      overview.value = { roster: 72, everSignedIn: 69, active24h: 24, active30d: 63, active7d: 51 }
      topRoutes.value = [
        { route: '/', views: 420, unique_users: 48 },
        { route: '/protocols', views: 260, unique_users: 39 },
        { route: '/clinical-development', views: 150, unique_users: 22 },
      ]
      topUsers.value = []
      neverSignedIn.value = []
      loading.value = false
      return
    }
    try {
      const [roster, ever, a24, a7, a30, routesRes, usersRes, dailyRes, hourlyRes, engageRes, allRoutesRes, neverRes] = await Promise.all([
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
        supabase.rpc('admin_usage_daily', { days: 30 }),
        supabase.rpc('admin_usage_hourly', { days: 30 }),
        supabase.rpc('admin_usage_engagement', { days: 30 }),
        supabase.rpc('admin_usage_top_routes', { days: 30, max_rows: 400 }),
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
      daily.value = ((dailyRes.data ?? []) as Array<{ day: string; views: number; unique_users: number }>).map(
        (d) => ({ day: d.day, views: Number(d.views), unique_users: Number(d.unique_users) }),
      )
      hourly.value = ((hourlyRes.data ?? []) as Array<{ hour: number; views: number }>).map((h) => ({
        hour: Number(h.hour),
        views: Number(h.views),
      }))
      engagement.value = ((engageRes.data ?? []) as Array<{ user_id: string; full_name: string; days_active: number; ever_signed_in: boolean }>).map(
        (r) => ({ ...r, days_active: Number(r.days_active) }),
      )
      /* Section rollup from the full 30-day route list. */
      const byLabel = new Map<string, number>()
      let totalViews = 0
      for (const r of (allRoutesRes.data ?? []) as TopRoute[]) {
        const v = Number(r.views)
        totalViews += v
        const label = sectionFor(r.route)
        byLabel.set(label, (byLabel.get(label) ?? 0) + v)
      }
      sections.value = [...byLabel.entries()]
        .map(([label, views]) => ({ label, views, pct: totalViews ? Math.round((views / totalViews) * 100) : 0 }))
        .sort((a, b) => b.views - a.views)

      // Surface the first non-trivial error if any sub-query failed.
      const firstErr =
        roster.error ??
        ever.error ??
        a24.error ??
        a7.error ??
        a30.error ??
        routesRes.error ??
        usersRes.error ??
        dailyRes.error ??
        hourlyRes.error ??
        engageRes.error ??
        allRoutesRes.error ??
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

  async function loadUserDetail(userId: string, name: string) {
    detailUser.value = { id: userId, name }
    detailLoading.value = true
    const auth2 = useAuthStore()
    if (auth2.usingDevStub) {
      detailRoutes.value = [
        { route: '/', views: 42, last_at: new Date().toISOString() },
        { route: '/protocols', views: 31, last_at: new Date(Date.now() - 86400000).toISOString() },
        { route: '/clinical-development', views: 12, last_at: new Date(Date.now() - 3 * 86400000).toISOString() },
        { route: '/directory', views: 6, last_at: new Date(Date.now() - 5 * 86400000).toISOString() },
      ]
      detailDaily.value = Array.from({ length: 30 }, (_, i) => ({
        day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
        views: (i * 13) % 7 === 0 ? 0 : 2 + ((i * 5) % 9),
      }))
      detailLoading.value = false
      return
    }
    try {
      const [routesRes, dailyRes] = await Promise.all([
        supabase.rpc('admin_usage_user_routes', { p_user: userId, days: 30, max_rows: 20 }),
        supabase.rpc('admin_usage_user_daily', { p_user: userId, days: 30 }),
      ])
      if (routesRes.error || dailyRes.error) {
        error.value = (routesRes.error ?? dailyRes.error)!.message
      }
      detailRoutes.value = ((routesRes.data ?? []) as UserRouteRow[]).map((r) => ({
        ...r,
        views: Number(r.views),
      }))
      detailDaily.value = ((dailyRes.data ?? []) as Array<{ day: string; views: number }>).map((d) => ({
        day: d.day,
        views: Number(d.views),
      }))
    } finally {
      detailLoading.value = false
    }
  }

  function closeUserDetail() {
    detailUser.value = null
    detailRoutes.value = []
    detailDaily.value = []
  }

  const reachPct = computed(() => {
    const o = overview.value
    if (!o || o.roster === 0) return 0
    return Math.round((o.everSignedIn / o.roster) * 100)
  })

  /* This week (last 7 complete-ish days) vs the 7 before — computed
     from the daily series so the deltas match the chart. */
  const weekCompare = computed(() => {
    const pts = daily.value
    if (pts.length < 8) return null
    const last7 = pts.slice(-7)
    const prev7 = pts.slice(-14, -7)
    if (prev7.length < 7) return null
    const sum = (a: DailyPoint[], k: 'views' | 'unique_users') => a.reduce((n, p) => n + p[k], 0)
    const views = sum(last7, 'views')
    const viewsPrev = sum(prev7, 'views')
    return {
      views,
      viewsDeltaPct: viewsPrev ? Math.round(((views - viewsPrev) / viewsPrev) * 100) : null,
    }
  })

  return {
    overview,
    daily,
    hourly,
    engagement,
    sections,
    weekCompare,
    detailUser,
    detailRoutes,
    detailDaily,
    detailLoading,
    loadUserDetail,
    closeUserDetail,
    topRoutes,
    topUsers,
    neverSignedIn,
    loading,
    error,
    reachPct,
    load,
  }
}
