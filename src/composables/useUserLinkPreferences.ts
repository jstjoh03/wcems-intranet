import { ref, computed } from 'vue'
import type { UserLinkPref } from '@/types'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Per-user pin / hide / sort state for Quick Links.
 *
 * Real-session mode: backed by `user_link_preferences` (RLS scopes
 * everything to the signed-in user). Dev-stub mode: backed by
 * localStorage keyed on the stub user id so dev iteration keeps state
 * across reloads.
 *
 * The composable is a singleton — there's only one current user per
 * session, so we share one ref across all callers and load once.
 */

const STORAGE_KEY_PREFIX = 'wcems:user-link-prefs:'

const prefs = ref<Map<string, UserLinkPref>>(new Map())
const ready = ref(false)
let loadStarted = false

function loadFromLocalStorage(userId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId)
    if (!raw) return
    const arr = JSON.parse(raw) as UserLinkPref[]
    prefs.value = new Map(arr.map((p) => [p.linkId, p]))
  } catch {
    /* ignore corrupt local copy */
  }
}

function persistToLocalStorage(userId: string) {
  if (typeof localStorage === 'undefined') return
  const arr = Array.from(prefs.value.values())
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(arr))
  } catch {
    /* quota exceeded — silently no-op */
  }
}

async function load(userId: string) {
  if (loadStarted) return
  loadStarted = true

  const auth = useAuthStore()

  if (auth.usingDevStub) {
    loadFromLocalStorage(userId)
    ready.value = true
    return
  }

  /* Clean up legacy dev keys so they don't linger on user devices. */
  if (typeof localStorage !== 'undefined') {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_KEY_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  }

  const { data, error } = await supabase
    .from('user_link_preferences')
    .select('link_id, pinned, hidden, custom_sort')
    .eq('user_id', userId)
  if (error) {
    console.error('[user-link-prefs] failed to load:', error.message)
    ready.value = true
    return
  }

  prefs.value = new Map(
    (data ?? []).map((r: { link_id: string; pinned: boolean; hidden: boolean; custom_sort: number | null }) => [
      r.link_id,
      {
        linkId: r.link_id,
        pinned: r.pinned,
        hidden: r.hidden,
        customSort: r.custom_sort,
      },
    ]),
  )
  ready.value = true
}

export function useUserLinkPreferences(userId: string) {
  void load(userId)

  function getPref(linkId: string): UserLinkPref {
    return (
      prefs.value.get(linkId) ?? {
        linkId,
        pinned: false,
        hidden: false,
        customSort: null,
      }
    )
  }

  async function setPref(linkId: string, patch: Partial<UserLinkPref>) {
    const before = prefs.value
    const merged: UserLinkPref = { ...getPref(linkId), ...patch, linkId }
    const next = new Map(prefs.value)
    next.set(linkId, merged)
    prefs.value = next

    const auth = useAuthStore()
    if (auth.usingDevStub) {
      persistToLocalStorage(userId)
      return
    }

    const { error } = await supabase
      .from('user_link_preferences')
      .upsert(
        {
          user_id: userId,
          link_id: linkId,
          pinned: merged.pinned,
          hidden: merged.hidden,
          custom_sort: merged.customSort,
        },
        { onConflict: 'user_id,link_id' },
      )
    if (error) {
      console.error('[user-link-prefs] save failed:', error.message)
      prefs.value = before
    }
  }

  function togglePin(linkId: string) {
    const cur = getPref(linkId)
    void setPref(linkId, { pinned: !cur.pinned })
  }

  function toggleHide(linkId: string) {
    const cur = getPref(linkId)
    void setPref(linkId, { hidden: !cur.hidden })
  }

  function setCustomSort(linkId: string, sort: number | null) {
    void setPref(linkId, { customSort: sort })
  }

  async function reset() {
    const before = prefs.value
    prefs.value = new Map()

    const auth = useAuthStore()
    if (auth.usingDevStub) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_PREFIX + userId)
      }
      return
    }

    const { error } = await supabase
      .from('user_link_preferences')
      .delete()
      .eq('user_id', userId)
    if (error) {
      console.error('[user-link-prefs] reset failed:', error.message)
      prefs.value = before
    }
  }

  const pinnedIds = computed(() =>
    Array.from(prefs.value.values())
      .filter((p) => p.pinned)
      .map((p) => p.linkId),
  )

  return {
    prefs,
    ready,
    pinnedIds,
    getPref,
    setPref,
    togglePin,
    toggleHide,
    setCustomSort,
    reset,
  }
}
