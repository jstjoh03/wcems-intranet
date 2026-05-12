import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Comment threads on gallery photos.
 *
 * Real-session: backed by `photo_comments` table. Counts come from a
 * single bulk SELECT (photo_id, count) that hydrates once per session
 * — actual comment bodies are fetched per-photo when a thread opens,
 * so we don't pull every comment in the gallery into memory upfront.
 *
 * Dev-stub: full state in localStorage, no lazy thread fetch.
 *
 * Optimistic mutations: posts append to the local cache immediately,
 * deletes splice immediately; we roll back on DB error.
 */

const STORAGE_KEY = 'wcems:photo-comments'

export interface PhotoComment {
  id: string
  photoId: string
  userId: string
  authorName: string
  authorInitials: string
  body: string
  createdAt: string
}

interface CommentRow {
  id: string
  photo_id: string
  user_id: string
  body: string
  created_at: string
  app_users: { full_name: string | null; email: string } | null
}

const counts = ref<Record<string, number>>({})
const threads = ref<Record<string, PhotoComment[]>>({})
const ready = ref(false)
let loadStarted = false

/* Dedupe sets for realtime echo: a comment we just inserted (or
   deleted) via our own optimistic path will arrive again as a
   postgres_changes event. We register the id here on the way out and
   skip it on the way back in, then clear the entry. */
const pendingInsertIds = new Set<string>()
const pendingDeleteIds = new Set<string>()

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

function rowToComment(r: CommentRow): PhotoComment {
  const fullName =
    r.app_users?.full_name?.trim() || r.app_users?.email?.split('@')[0] || 'Crew'
  return {
    id: r.id,
    photoId: r.photo_id,
    userId: r.user_id,
    authorName: fullName,
    authorInitials: initials(fullName),
    body: r.body,
    createdAt: r.created_at,
  }
}

function loadFromLocalStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PhotoComment[]>
      threads.value = parsed
      counts.value = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, v.length]),
      )
    }
  } catch {
    /* ignore */
  }
}

function persistToLocalStorage() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.value))
  } catch {
    /* quota exceeded */
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()

  if (auth.usingDevStub) {
    loadFromLocalStorage()
    ready.value = true
    return
  }

  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)

  /* Bulk count fetch — one row per comment, group client-side. The
     table is small (community comments) so this is fine; if it grows
     we'll move to a view that does the aggregation server-side. */
  const { data, error } = await supabase
    .from('photo_comments')
    .select('photo_id')
  if (error) {
    console.error('[photo-comments] count load failed:', error.message)
    ready.value = true
    return
  }
  const next: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ photo_id: string }>) {
    next[r.photo_id] = (next[r.photo_id] ?? 0) + 1
  }
  counts.value = next
  ready.value = true

  subscribeRealtime()
}

/**
 * Fetch a single comment row (with the joined author name) — used by
 * the realtime handler to enrich the bare INSERT payload before
 * appending to an open thread.
 */
async function fetchOne(id: string): Promise<PhotoComment | null> {
  const { data, error } = await supabase
    .from('photo_comments')
    .select(
      'id, photo_id, user_id, body, created_at, app_users:app_users!photo_comments_user_id_fkey(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return rowToComment(data as unknown as CommentRow)
}

function subscribeRealtime() {
  const channel = supabase
    .channel('photo_comments')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'photo_comments' },
      async (payload) => {
        const row = payload.new as { id: string; photo_id: string }
        if (pendingInsertIds.has(row.id)) {
          pendingInsertIds.delete(row.id)
          return
        }
        counts.value = {
          ...counts.value,
          [row.photo_id]: (counts.value[row.photo_id] ?? 0) + 1,
        }
        /* If the thread is already loaded (modal open), enrich + append. */
        if (threads.value[row.photo_id]) {
          const enriched = await fetchOne(row.id)
          if (!enriched) return
          const existing = threads.value[row.photo_id] ?? []
          if (existing.some((c) => c.id === enriched.id)) return
          threads.value = {
            ...threads.value,
            [row.photo_id]: [...existing, enriched],
          }
        }
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'photo_comments' },
      (payload) => {
        const row = payload.old as { id?: string; photo_id?: string }
        if (!row.id || !row.photo_id) return
        if (pendingDeleteIds.has(row.id)) {
          pendingDeleteIds.delete(row.id)
          return
        }
        counts.value = {
          ...counts.value,
          [row.photo_id]: Math.max(0, (counts.value[row.photo_id] ?? 0) - 1),
        }
        const existing = threads.value[row.photo_id]
        if (!existing) return
        threads.value = {
          ...threads.value,
          [row.photo_id]: existing.filter((c) => c.id !== row.id),
        }
      },
    )
    .subscribe()
  return channel
}

async function fetchThread(photoId: string) {
  const auth = useAuthStore()
  if (auth.usingDevStub) return

  const { data, error } = await supabase
    .from('photo_comments')
    .select(
      'id, photo_id, user_id, body, created_at, app_users:app_users!photo_comments_user_id_fkey(full_name, email)',
    )
    .eq('photo_id', photoId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[photo-comments] thread load failed:', error.message)
    return
  }
  threads.value = {
    ...threads.value,
    [photoId]: (data ?? []).map((r) => rowToComment(r as unknown as CommentRow)),
  }
  counts.value = { ...counts.value, [photoId]: threads.value[photoId].length }
}

export function usePhotoComments(currentUserId: string) {
  void load()

  function getCount(photoId: string): number {
    return counts.value[photoId] ?? 0
  }

  function getThread(photoId: string): PhotoComment[] {
    return threads.value[photoId] ?? []
  }

  async function ensureThreadLoaded(photoId: string) {
    if (threads.value[photoId]) return
    await fetchThread(photoId)
  }

  async function post(
    photoId: string,
    body: string,
    author: { name: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = body.trim()
    if (!trimmed) return { ok: false, error: 'Type a comment first.' }
    if (trimmed.length > 500) {
      return { ok: false, error: 'Comments are capped at 500 characters.' }
    }

    const auth = useAuthStore()

    if (auth.usingDevStub) {
      const next: PhotoComment = {
        id: `dev-${crypto.randomUUID()}`,
        photoId,
        userId: currentUserId,
        authorName: author.name,
        authorInitials: initials(author.name),
        body: trimmed,
        createdAt: new Date().toISOString(),
      }
      threads.value = {
        ...threads.value,
        [photoId]: [...(threads.value[photoId] ?? []), next],
      }
      counts.value = { ...counts.value, [photoId]: getCount(photoId) + 1 }
      persistToLocalStorage()
      return { ok: true }
    }

    const { data, error } = await supabase
      .from('photo_comments')
      .insert({ photo_id: photoId, user_id: currentUserId, body: trimmed })
      .select(
        'id, photo_id, user_id, body, created_at, app_users:app_users!photo_comments_user_id_fkey(full_name, email)',
      )
      .single()
    if (error) return { ok: false, error: error.message }

    const inserted = rowToComment(data as unknown as CommentRow)
    /* Register the id so the realtime echo skips itself. */
    pendingInsertIds.add(inserted.id)
    threads.value = {
      ...threads.value,
      [photoId]: [...(threads.value[photoId] ?? []), inserted],
    }
    counts.value = { ...counts.value, [photoId]: getCount(photoId) + 1 }
    return { ok: true }
  }

  async function remove(
    photoId: string,
    commentId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = useAuthStore()
    const before = threads.value[photoId] ?? []
    const beforeCount = counts.value[photoId] ?? 0

    threads.value = {
      ...threads.value,
      [photoId]: before.filter((c) => c.id !== commentId),
    }
    counts.value = { ...counts.value, [photoId]: Math.max(0, beforeCount - 1) }

    if (auth.usingDevStub) {
      persistToLocalStorage()
      return { ok: true }
    }

    pendingDeleteIds.add(commentId)
    const { error } = await supabase
      .from('photo_comments')
      .delete()
      .eq('id', commentId)
    if (error) {
      /* DB rejected — roll back and unregister so a later realtime
         delete (e.g. by an admin) can still apply. */
      pendingDeleteIds.delete(commentId)
      threads.value = { ...threads.value, [photoId]: before }
      counts.value = { ...counts.value, [photoId]: beforeCount }
      return { ok: false, error: error.message }
    }
    return { ok: true }
  }

  const totalReady = computed(() => ready.value)

  return {
    getCount,
    getThread,
    ensureThreadLoaded,
    post,
    remove,
    ready: totalReady,
  }
}
