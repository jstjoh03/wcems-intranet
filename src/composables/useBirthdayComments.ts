import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Comment threads on the daily birthday celebrations.
 *
 * Compound key = (birthday_date, person_key) — same as
 * birthday_reactions, so threads roll over each year automatically.
 *
 * Real-session: backed by `birthday_comments` table. Counts come from
 * one bulk SELECT; thread bodies fetched on demand when a modal opens.
 *
 * Dev-stub: localStorage.
 */

const STORAGE_KEY = 'wcems:birthday-comments'

export interface BirthdayComment {
  id: string
  birthdayDate: string
  personKey: string
  userId: string
  authorName: string
  authorInitials: string
  body: string
  createdAt: string
}

interface CommentRow {
  id: string
  birthday_date: string
  person_key: string
  user_id: string
  body: string
  created_at: string
  app_users: { full_name: string | null; email: string } | null
}

function makeKey(date: string, personKey: string) {
  return `${date}::${personKey}`
}

const counts = ref<Record<string, number>>({})
const threads = ref<Record<string, BirthdayComment[]>>({})
const ready = ref(false)
let loadStarted = false

/* Dedupe sets for realtime echo (see usePhotoComments). */
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

function rowToComment(r: CommentRow): BirthdayComment {
  const fullName =
    r.app_users?.full_name?.trim() || r.app_users?.email?.split('@')[0] || 'Crew'
  return {
    id: r.id,
    birthdayDate: r.birthday_date,
    personKey: r.person_key,
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
      const parsed = JSON.parse(raw) as Record<string, BirthdayComment[]>
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

  const { data, error } = await supabase
    .from('birthday_comments')
    .select('birthday_date, person_key')
  if (error) {
    console.error('[birthday-comments] count load failed:', error.message)
    ready.value = true
    return
  }
  const next: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{
    birthday_date: string
    person_key: string
  }>) {
    const key = makeKey(r.birthday_date, r.person_key)
    next[key] = (next[key] ?? 0) + 1
  }
  counts.value = next
  ready.value = true

  subscribeRealtime()
}

async function fetchOne(id: string): Promise<BirthdayComment | null> {
  const { data, error } = await supabase
    .from('birthday_comments')
    .select(
      'id, birthday_date, person_key, user_id, body, created_at, app_users:app_users!birthday_comments_user_id_fkey(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return rowToComment(data as unknown as CommentRow)
}

function subscribeRealtime() {
  const channel = supabase
    .channel('birthday_comments')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'birthday_comments' },
      async (payload) => {
        const row = payload.new as {
          id: string
          birthday_date: string
          person_key: string
        }
        if (pendingInsertIds.has(row.id)) {
          pendingInsertIds.delete(row.id)
          return
        }
        const key = makeKey(row.birthday_date, row.person_key)
        counts.value = {
          ...counts.value,
          [key]: (counts.value[key] ?? 0) + 1,
        }
        if (threads.value[key]) {
          const enriched = await fetchOne(row.id)
          if (!enriched) return
          const existing = threads.value[key] ?? []
          if (existing.some((c) => c.id === enriched.id)) return
          threads.value = {
            ...threads.value,
            [key]: [...existing, enriched],
          }
        }
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'birthday_comments' },
      (payload) => {
        const row = payload.old as {
          id?: string
          birthday_date?: string
          person_key?: string
        }
        if (!row.id || !row.birthday_date || !row.person_key) return
        if (pendingDeleteIds.has(row.id)) {
          pendingDeleteIds.delete(row.id)
          return
        }
        const key = makeKey(row.birthday_date, row.person_key)
        counts.value = {
          ...counts.value,
          [key]: Math.max(0, (counts.value[key] ?? 0) - 1),
        }
        const existing = threads.value[key]
        if (!existing) return
        threads.value = {
          ...threads.value,
          [key]: existing.filter((c) => c.id !== row.id),
        }
      },
    )
    .subscribe()
  return channel
}

async function fetchThread(date: string, personKey: string) {
  const auth = useAuthStore()
  if (auth.usingDevStub) return

  const { data, error } = await supabase
    .from('birthday_comments')
    .select(
      'id, birthday_date, person_key, user_id, body, created_at, app_users:app_users!birthday_comments_user_id_fkey(full_name, email)',
    )
    .eq('birthday_date', date)
    .eq('person_key', personKey)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[birthday-comments] thread load failed:', error.message)
    return
  }
  const key = makeKey(date, personKey)
  threads.value = {
    ...threads.value,
    [key]: (data ?? []).map((r) => rowToComment(r as unknown as CommentRow)),
  }
  counts.value = { ...counts.value, [key]: threads.value[key].length }
}

export function useBirthdayComments(currentUserId: string) {
  void load()

  function getCount(date: string, personKey: string): number {
    return counts.value[makeKey(date, personKey)] ?? 0
  }

  function getThread(date: string, personKey: string): BirthdayComment[] {
    return threads.value[makeKey(date, personKey)] ?? []
  }

  async function ensureThreadLoaded(date: string, personKey: string) {
    const key = makeKey(date, personKey)
    if (threads.value[key]) return
    await fetchThread(date, personKey)
  }

  async function post(
    date: string,
    personKey: string,
    body: string,
    author: { name: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = body.trim()
    if (!trimmed) return { ok: false, error: 'Type a comment first.' }
    if (trimmed.length > 500) {
      return { ok: false, error: 'Comments are capped at 500 characters.' }
    }

    const auth = useAuthStore()
    const key = makeKey(date, personKey)

    if (auth.usingDevStub) {
      const next: BirthdayComment = {
        id: `dev-${crypto.randomUUID()}`,
        birthdayDate: date,
        personKey,
        userId: currentUserId,
        authorName: author.name,
        authorInitials: initials(author.name),
        body: trimmed,
        createdAt: new Date().toISOString(),
      }
      threads.value = {
        ...threads.value,
        [key]: [...(threads.value[key] ?? []), next],
      }
      counts.value = { ...counts.value, [key]: getCount(date, personKey) + 1 }
      persistToLocalStorage()
      return { ok: true }
    }

    const { data, error } = await supabase
      .from('birthday_comments')
      .insert({
        birthday_date: date,
        person_key: personKey,
        user_id: currentUserId,
        body: trimmed,
      })
      .select(
        'id, birthday_date, person_key, user_id, body, created_at, app_users:app_users!birthday_comments_user_id_fkey(full_name, email)',
      )
      .single()
    if (error) return { ok: false, error: error.message }

    const inserted = rowToComment(data as unknown as CommentRow)
    pendingInsertIds.add(inserted.id)
    threads.value = {
      ...threads.value,
      [key]: [...(threads.value[key] ?? []), inserted],
    }
    counts.value = { ...counts.value, [key]: getCount(date, personKey) + 1 }
    return { ok: true }
  }

  async function remove(
    date: string,
    personKey: string,
    commentId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const auth = useAuthStore()
    const key = makeKey(date, personKey)
    const before = threads.value[key] ?? []
    const beforeCount = counts.value[key] ?? 0

    threads.value = {
      ...threads.value,
      [key]: before.filter((c) => c.id !== commentId),
    }
    counts.value = { ...counts.value, [key]: Math.max(0, beforeCount - 1) }

    if (auth.usingDevStub) {
      persistToLocalStorage()
      return { ok: true }
    }

    pendingDeleteIds.add(commentId)
    const { error } = await supabase
      .from('birthday_comments')
      .delete()
      .eq('id', commentId)
    if (error) {
      pendingDeleteIds.delete(commentId)
      threads.value = { ...threads.value, [key]: before }
      counts.value = { ...counts.value, [key]: beforeCount }
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
