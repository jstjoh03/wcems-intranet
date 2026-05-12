import { computed } from 'vue'
import {
  Hospital,
  GraduationCap,
  MapPin,
  BarChart3,
  Building2,
  Users,
  Image as ImageIcon,
  LayoutGrid,
  Home,
  Settings,
  type LucideIcon,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'
import { useHospitalsStore } from '@/stores/hospitals'
import { useStationsStore } from '@/stores/stations'
import { useTraining } from '@/composables/useTraining'

/**
 * Whole-site search index. Combines:
 *
 *   - Static page routes (Hospitals, Training, Insights, Gallery, etc.)
 *   - Admin-curated Quick Links catalog
 *   - Hospital directory (filterable by name)
 *   - Stations directory
 *   - Upcoming training sessions
 *
 * Filtering is case-insensitive substring match on title + subtitle.
 * Results are grouped by category for the command-palette UI.
 *
 * Internal results carry `to` (vue-router path) and optional `hash`;
 * external results (only Quick Links) carry `href` and open in a new
 * tab. Callers don't need to branch — the overlay's click handler
 * picks the right one.
 */

export type SearchCategory =
  | 'page'
  | 'quick-link'
  | 'hospital'
  | 'station'
  | 'training'

export interface SearchResult {
  id: string
  title: string
  subtitle?: string
  category: SearchCategory
  icon: LucideIcon
  /** Internal vue-router path. Mutually exclusive with `href`. */
  to?: string
  /** Optional hash to scroll to within the target route. */
  hash?: string
  /** External URL — opens in a new tab. */
  href?: string
}

/** Fixed app routes worth surfacing in search. */
const PAGE_ROUTES: SearchResult[] = [
  {
    id: 'page:home',
    title: 'Home',
    subtitle: 'Dashboard',
    category: 'page',
    icon: Home,
    to: '/',
  },
  {
    id: 'page:hospitals',
    title: 'Hospitals',
    subtitle: 'Trauma + door codes',
    category: 'page',
    icon: Hospital,
    to: '/hospitals',
  },
  {
    id: 'page:training',
    title: 'Training',
    subtitle: 'Upcoming sessions',
    category: 'page',
    icon: GraduationCap,
    to: '/training',
  },
  {
    id: 'page:insights',
    title: 'Call Volume Insights',
    subtitle: 'Monthly run reports',
    category: 'page',
    icon: BarChart3,
    to: '/insights',
  },
  {
    id: 'page:admin-staff',
    title: 'Admin Staff',
    subtitle: 'Contact directory',
    category: 'page',
    icon: Building2,
    to: '/admin-staff',
  },
  {
    id: 'page:gallery',
    title: 'Photo Gallery',
    subtitle: 'Around the County',
    category: 'page',
    icon: ImageIcon,
    to: '/gallery',
  },
  {
    id: 'page:announcements',
    title: 'Announcements',
    subtitle: 'Dashboard section',
    category: 'page',
    icon: LayoutGrid,
    to: '/',
    hash: '#announcements',
  },
  {
    id: 'page:people',
    title: 'People',
    subtitle: 'Birthdays + spotlight',
    category: 'page',
    icon: Users,
    to: '/',
    hash: '#people',
  },
  {
    id: 'page:stations-section',
    title: 'Station Directory',
    subtitle: 'Dashboard section',
    category: 'page',
    icon: MapPin,
    to: '/',
    hash: '#stations',
  },
]

/** Admin-only page routes — only surfaced if the user is admin. */
const ADMIN_PAGE_ROUTES: SearchResult[] = [
  { id: 'page:admin-employees', title: 'Manage Employees', subtitle: 'Admin', category: 'page', icon: Users, to: '/admin/employees' },
  { id: 'page:admin-stations', title: 'Manage Stations', subtitle: 'Admin', category: 'page', icon: Settings, to: '/admin/stations' },
  { id: 'page:admin-hospitals', title: 'Manage Hospitals', subtitle: 'Admin', category: 'page', icon: Hospital, to: '/admin/hospitals' },
  { id: 'page:admin-call-volume', title: 'Manage Call Volume', subtitle: 'Admin', category: 'page', icon: BarChart3, to: '/admin/call-volume' },
  { id: 'page:admin-training', title: 'Manage Training', subtitle: 'Admin', category: 'page', icon: GraduationCap, to: '/admin/training' },
  { id: 'page:admin-quick-links', title: 'Manage Quick Links', subtitle: 'Admin', category: 'page', icon: LayoutGrid, to: '/admin/quick-links' },
]

function matchesQuery(query: string, ...fields: Array<string | undefined>) {
  if (!query) return true
  const q = query.toLowerCase()
  return fields.some((f) => f && f.toLowerCase().includes(q))
}

export function useGlobalSearch() {
  const auth = useAuthStore()
  const { links: quickLinks } = useQuickLinks()
  const hospitalsStore = useHospitalsStore()
  const stationsStore = useStationsStore()
  const { events: trainingEvents } = useTraining()

  const allResults = computed<SearchResult[]>(() => {
    const role = auth.role ?? 'crew'
    const results: SearchResult[] = [...PAGE_ROUTES]

    /* Admin-only pages: only include for admins. */
    if (auth.isAdmin) {
      results.push(...ADMIN_PAGE_ROUTES)
    }

    /* Quick Links — gated by visibleTo (empty array = everyone). */
    for (const l of quickLinks.value) {
      if (l.visibleTo && l.visibleTo.length > 0 && !l.visibleTo.includes(role)) {
        continue
      }
      results.push({
        id: `quick-link:${l.id}`,
        title: l.label,
        subtitle: l.sub ?? l.category ?? undefined,
        category: 'quick-link',
        icon: LayoutGrid,
        href: l.url,
      })
    }

    /* Hospitals — only active ones, named so the icon makes sense. */
    for (const h of hospitalsStore.activeHospitals) {
      results.push({
        id: `hospital:${h.id}`,
        title: h.name,
        subtitle: `Trauma ${h.trauma}${h.stroke !== 'N' ? ` · Stroke ${h.stroke}` : ''}`,
        category: 'hospital',
        icon: Hospital,
        to: '/hospitals',
      })
    }

    /* Stations — only active ones. */
    for (const s of stationsStore.activeStations) {
      results.push({
        id: `station:${s.id}`,
        title: s.name,
        subtitle: `${s.address}, ${s.city}`,
        category: 'station',
        icon: MapPin,
        to: '/',
        hash: '#stations',
      })
    }

    /* Upcoming training sessions. */
    for (const t of trainingEvents.value) {
      const dateLabel = t.date
        ? new Date(t.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })
        : ''
      const sub = [dateLabel, t.time, t.location].filter(Boolean).join(' · ')
      results.push({
        id: `training:${t.id}`,
        title: t.title,
        subtitle: sub || undefined,
        category: 'training',
        icon: GraduationCap,
        to: '/training',
      })
    }

    return results
  })

  /** Categories rendered in this fixed order on the overlay so the
   *  most-used surfaces (pages, quick links) sit on top. */
  const CATEGORY_ORDER: SearchCategory[] = [
    'page',
    'quick-link',
    'hospital',
    'station',
    'training',
  ]
  const CATEGORY_LABELS: Record<SearchCategory, string> = {
    page: 'Pages',
    'quick-link': 'Quick Links',
    hospital: 'Hospitals',
    station: 'Stations',
    training: 'Training',
  }

  function search(query: string, limitPerCategory = 6) {
    const filtered = allResults.value.filter((r) =>
      matchesQuery(query, r.title, r.subtitle),
    )
    const buckets: Array<{ category: SearchCategory; label: string; results: SearchResult[] }> = []
    for (const cat of CATEGORY_ORDER) {
      const inCat = filtered.filter((r) => r.category === cat).slice(0, limitPerCategory)
      if (inCat.length > 0) {
        buckets.push({ category: cat, label: CATEGORY_LABELS[cat], results: inCat })
      }
    }
    return buckets
  }

  return { allResults, search, CATEGORY_LABELS }
}
