import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { SocialMediaRelease } from '@/types'

/**
 * Social media photo/video release. Structurally the little sibling of
 * usePolicies: RLS trims the load to the current user's own row for
 * crew and the full set for admins, so one composable serves both the
 * sign-it form and the admin roster.
 *
 * One row per person — submitting again upserts (an employee can
 * revise restrictions or revoke authorization at any time).
 */

interface ReleaseRow {
  id: string
  user_id: string
  authorized: boolean
  restrictions: string
  signature_data: string | null
  signed_method: 'self' | 'admin_marked'
  marked_by: string | null
  marked_note: string | null
  signed_at: string
}

const COLUMNS =
  'id, user_id, authorized, restrictions, signature_data, signed_method, marked_by, marked_note, signed_at'

function fromRow(r: ReleaseRow): SocialMediaRelease {
  return {
    id: r.id,
    userId: r.user_id,
    authorized: r.authorized,
    restrictions: r.restrictions,
    signatureData: r.signature_data,
    signedMethod: r.signed_method,
    markedBy: r.marked_by,
    markedNote: r.marked_note,
    signedAt: r.signed_at,
  }
}

const releases = ref<SocialMediaRelease[]>([])
const ready = ref(false)
let loadStarted = false

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }
  const { data, error } = await supabase
    .from('social_media_releases')
    .select(COLUMNS)
  if (error) console.error('[smr] load:', error.message)
  releases.value = (data ?? []).map((r) => fromRow(r as ReleaseRow))
  ready.value = true
}

export function useSocialMediaRelease() {
  const auth = useAuthStore()
  void load()

  const myRelease = computed<SocialMediaRelease | null>(() => {
    const uid = auth.appUser?.id
    if (!uid) return null
    return releases.value.find((r) => r.userId === uid) ?? null
  })

  function releaseFor(userId: string): SocialMediaRelease | null {
    return releases.value.find((r) => r.userId === userId) ?? null
  }

  /* Self-sign (or revise): upsert the caller's own row. */
  async function submitRelease(input: {
    authorized: boolean
    restrictions: string
    signatureData: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (auth.isKiosk) {
      return { ok: false, error: 'Releases can’t be signed on station kiosks.' }
    }

    if (auth.usingDevStub) {
      const next: SocialMediaRelease = {
        id: crypto.randomUUID(),
        userId: uid,
        authorized: input.authorized,
        restrictions: input.restrictions,
        signatureData: input.signatureData,
        signedMethod: 'self',
        markedBy: null,
        markedNote: null,
        signedAt: new Date().toISOString(),
      }
      releases.value = [...releases.value.filter((r) => r.userId !== uid), next]
      return { ok: true }
    }

    const { data, error } = await supabase
      .from('social_media_releases')
      .upsert(
        {
          user_id: uid,
          authorized: input.authorized,
          restrictions: input.restrictions.trim(),
          signature_data: input.signatureData,
          signed_method: 'self',
          marked_by: null,
          marked_note: null,
          signed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReleaseRow)
    releases.value = [...releases.value.filter((r) => r.userId !== uid), row]
    return { ok: true }
  }

  /* Admin: record a paper form already on file (no drawn signature). */
  async function adminMark(input: {
    userId: string
    authorized: boolean
    restrictions: string
    note: string
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const { data, error } = await supabase
      .from('social_media_releases')
      .upsert(
        {
          user_id: input.userId,
          authorized: input.authorized,
          restrictions: input.restrictions.trim(),
          signature_data: null,
          signed_method: 'admin_marked',
          marked_by: auth.appUser?.id ?? null,
          marked_note: input.note.trim() || null,
          signed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select(COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = fromRow(data as ReleaseRow)
    releases.value = [...releases.value.filter((r) => r.userId !== input.userId), row]
    return { ok: true }
  }

  async function adminRemove(
    userId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const { error } = await supabase
      .from('social_media_releases')
      .delete()
      .eq('user_id', userId)
    if (error) return { ok: false, error: error.message }
    releases.value = releases.value.filter((r) => r.userId !== userId)
    return { ok: true }
  }

  return {
    ready,
    releases,
    myRelease,
    releaseFor,
    submitRelease,
    adminMark,
    adminRemove,
  }
}
