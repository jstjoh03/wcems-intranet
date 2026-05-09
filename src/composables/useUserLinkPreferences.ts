import { ref, computed, watch } from 'vue'
import type { UserLinkPref } from '@/types'

/**
 * Per-user pin/hide/reorder state for Quick Links.
 *
 * Phase 1: localStorage-backed dev stub. Phase 2: swap the body of `load`
 * and `persist` to call `supabase.from('user_link_preferences')`. The
 * component contract (the returned ref + helper methods) does not change.
 *
 * Justin specifically pushed back on localStorage for production because
 * pins wouldn't follow the user across devices — that's correct. This
 * stub exists only so the UI is complete during the Supabase outage.
 */

const STORAGE_KEY_PREFIX = 'wcems:user-link-prefs:'

function load(userId: string): Map<string, UserLinkPref> {
  if (typeof localStorage === 'undefined') return new Map()
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as UserLinkPref[]
    return new Map(parsed.map((p) => [p.linkId, p]))
  } catch {
    return new Map()
  }
}

function persist(userId: string, prefs: Map<string, UserLinkPref>) {
  if (typeof localStorage === 'undefined') return
  const arr = Array.from(prefs.values())
  localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(arr))
}

export function useUserLinkPreferences(userId: string) {
  const prefs = ref<Map<string, UserLinkPref>>(load(userId))

  watch(
    prefs,
    (val) => persist(userId, val),
    { deep: true },
  )

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

  function setPref(linkId: string, patch: Partial<UserLinkPref>) {
    const next = new Map(prefs.value)
    next.set(linkId, { ...getPref(linkId), ...patch, linkId })
    prefs.value = next
  }

  function togglePin(linkId: string) {
    const cur = getPref(linkId)
    setPref(linkId, { pinned: !cur.pinned })
  }

  function toggleHide(linkId: string) {
    const cur = getPref(linkId)
    setPref(linkId, { hidden: !cur.hidden })
  }

  function setCustomSort(linkId: string, sort: number | null) {
    setPref(linkId, { customSort: sort })
  }

  function reset() {
    prefs.value = new Map()
  }

  const pinnedIds = computed(() =>
    Array.from(prefs.value.values())
      .filter((p) => p.pinned)
      .map((p) => p.linkId),
  )

  return {
    prefs,
    pinnedIds,
    getPref,
    setPref,
    togglePin,
    toggleHide,
    setCustomSort,
    reset,
  }
}
