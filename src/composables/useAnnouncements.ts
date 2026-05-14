import { ref, computed, onBeforeUnmount } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { Announcement } from '@/types'

/**
 * Dashboard announcements feed.
 *
 *  - Real-session path: SELECT from public.announcements + realtime
 *    subscription. Admins see active+inactive; non-admins are filtered
 *    server-side by RLS to active rows only.
 *  - Dev-stub path: empty list (no JSON fixture seeds these — the only
 *    use case is admin posting via `+ New`, which in dev just mutates
 *    the in-memory list).
 *
 * Single module-level singleton; the dashboard card subscribes once
 * and shares state across whoever else asks.
 */

interface AnnouncementRow {
  id: string
  tag: string
  title: string
  body: string | null
  image_url: string | null
  author_name: string
  author_user_id: string | null
  published_at: string
  active: boolean
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function rowToAnnouncement(r: AnnouncementRow): Announcement {
  return {
    id: r.id,
    date: formatDateLabel(r.published_at),
    tag: r.tag,
    title: r.title,
    body: r.body ?? '',
    imageUrl: r.image_url,
    authorName: r.author_name,
    publishedAt: r.published_at,
  }
}

const announcements = ref<Announcement[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const lastFetchedAt = ref<Date | null>(null)
let loadStarted = false
let realtimeSubscribed = false

async function loadAnnouncements() {
  loading.value = true
  errorMessage.value = null
  const { data, error } = await supabase
    .from('announcements')
    .select(
      'id, tag, title, body, image_url, author_name, author_user_id, published_at, active',
    )
    .order('published_at', { ascending: false })
  if (error) {
    console.error('[announcements] load failed:', error.message)
    errorMessage.value = error.message
    loading.value = false
    return
  }
  announcements.value = (data ?? []).map((r) => rowToAnnouncement(r as AnnouncementRow))
  lastFetchedAt.value = new Date()
  loading.value = false
}

function subscribeRealtime() {
  if (realtimeSubscribed) return
  realtimeSubscribed = true
  supabase
    .channel('announcements')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'announcements' },
      (payload) => {
        const next = rowToAnnouncement(payload.new as AnnouncementRow)
        if (announcements.value.some((a) => a.id === next.id)) return
        announcements.value = [next, ...announcements.value]
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'announcements' },
      (payload) => {
        const next = rowToAnnouncement(payload.new as AnnouncementRow)
        announcements.value = announcements.value.map((a) =>
          a.id === next.id ? next : a,
        )
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'announcements' },
      (payload) => {
        const old = payload.old as { id?: string }
        if (!old.id) return
        announcements.value = announcements.value.filter((a) => a.id !== old.id)
      },
    )
    .subscribe()
}

export interface NewAnnouncementInput {
  tag: string
  title: string
  body: string
  imageUrl: string | null
}

export interface UpdateAnnouncementInput extends NewAnnouncementInput {
  id: string
}

export function useAnnouncements() {
  const auth = useAuthStore()
  const isLive = !auth.usingDevStub

  if (isLive && !loadStarted) {
    loadStarted = true
    void loadAnnouncements()
    subscribeRealtime()
  }

  onBeforeUnmount(() => {
    /* Module-level singleton — nothing to tear down per-consumer. */
  })

  async function refresh() {
    if (!isLive) return
    await loadAnnouncements()
  }

  async function publish(input: NewAnnouncementInput) {
    const author = auth.appUser
    if (usingDevStubLike()) {
      announcements.value = [
        {
          id: crypto.randomUUID(),
          date: formatDateLabel(new Date().toISOString()),
          tag: input.tag,
          title: input.title,
          body: input.body,
          imageUrl: input.imageUrl,
          authorName: author?.fullName ?? 'Admin',
          publishedAt: new Date().toISOString(),
        },
        ...announcements.value,
      ]
      return
    }
    const { error } = await supabase.from('announcements').insert({
      tag: input.tag,
      title: input.title,
      body: input.body || null,
      image_url: input.imageUrl,
      author_name: author?.fullName ?? 'Admin',
      author_user_id: author?.id ?? null,
    })
    if (error) throw error
    /* Realtime INSERT will prepend the new row; no explicit refresh
       needed unless the subscription somehow missed it (e.g. WS reconnect
       race). The card optimistic-render isn't worth the complexity here. */
  }

  async function update(input: UpdateAnnouncementInput) {
    if (usingDevStubLike()) {
      announcements.value = announcements.value.map((a) =>
        a.id === input.id
          ? {
              ...a,
              tag: input.tag,
              title: input.title,
              body: input.body,
              imageUrl: input.imageUrl,
            }
          : a,
      )
      return
    }
    const { error } = await supabase
      .from('announcements')
      .update({
        tag: input.tag,
        title: input.title,
        body: input.body || null,
        image_url: input.imageUrl,
      })
      .eq('id', input.id)
    if (error) throw error
  }

  async function remove(id: string) {
    if (usingDevStubLike()) {
      announcements.value = announcements.value.filter((a) => a.id !== id)
      return
    }
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) throw error
  }

  function usingDevStubLike() {
    return auth.usingDevStub
  }

  const ready = computed(
    () => !loading.value && (lastFetchedAt.value !== null || !isLive),
  )

  return {
    /* RLS on the server already filters inactive rows for non-admins,
       and admins want to see everything. No client-side filter needed. */
    announcements,
    loading,
    ready,
    errorMessage,
    lastFetchedAt,
    refresh,
    publish,
    update,
    remove,
  }
}
