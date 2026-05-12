import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import seed from '@/data/quicklinks.json'
import type { QuickLink, Role } from '@/types'

/**
 * Quick Links catalog — admin-curated.
 *
 * Real-session: reads from `public.quick_links` and subscribes to
 * realtime so admin edits propagate live to every dashboard.
 *
 * Dev-stub: falls back to the legacy JSON fixture so dev iteration
 * works offline.
 *
 * Per-user pin / hide state still lives in `useUserLinkPreferences`
 * (one user per session, scoped via RLS).
 */

interface QuickLinkRow {
  id: string
  label: string
  sub: string
  url: string
  icon_name: string
  category: string
  visible_to: string[]
  sort_order: number
  active: boolean
}

const links = ref<QuickLink[]>([])
const ready = ref(false)
let loadStarted = false
let realtimeSubscribed = false

function rowToLink(r: QuickLinkRow): QuickLink {
  return {
    id: r.id,
    label: r.label,
    sub: r.sub ?? null,
    url: r.url,
    iconName: r.icon_name ?? 'Link2',
    category: r.category ?? '',
    visibleTo: ((r.visible_to ?? []) as Role[]),
    defaultSort: r.sort_order ?? 0,
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub || !auth.appUser) {
    /* Dev-stub: hydrate from the JSON fixture so the dock renders
       without a real session. */
    links.value = (seed as QuickLink[]).map((l) => ({ ...l }))
    ready.value = true
    return
  }

  const { data, error } = await supabase
    .from('quick_links')
    .select(
      'id, label, sub, url, icon_name, category, visible_to, sort_order, active',
    )
    .eq('active', true)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[quick-links] load failed:', error.message)
    /* Fall back to the JSON so the dock isn't blank on a transient
       Supabase error. */
    links.value = (seed as QuickLink[]).map((l) => ({ ...l }))
    ready.value = true
    return
  }

  links.value = (data ?? []).map((r) => rowToLink(r as QuickLinkRow))
  ready.value = true
  subscribeRealtime()
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('quick_links')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'quick_links' },
      (payload) => {
        const next = rowToLink(payload.new as QuickLinkRow)
        if (links.value.some((l) => l.id === next.id)) return
        links.value = [...links.value, next]
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'quick_links' },
      (payload) => {
        const next = rowToLink(payload.new as QuickLinkRow)
        links.value = links.value.map((l) => (l.id === next.id ? next : l))
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'quick_links' },
      (payload) => {
        const old = payload.old as { id?: string }
        if (!old.id) return
        links.value = links.value.filter((l) => l.id !== old.id)
      },
    )
    .subscribe()
}

export function useQuickLinks() {
  void load()

  /** Refetch from the DB — used by the admin save handler so newly
   *  added entries appear immediately without waiting on realtime. */
  async function refresh() {
    const auth = useAuthStore()
    if (auth.usingDevStub) return
    loadStarted = false
    await load()
  }

  /** Unique categories present in the current catalog — used by the
   *  admin form's category-suggest datalist. */
  const categories = computed(() => {
    const set = new Set<string>()
    for (const l of links.value) {
      if (l.category) set.add(l.category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  })

  return { links, ready, refresh, categories }
}
