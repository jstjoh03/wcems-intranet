import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type {
  EmploymentType,
  Policy,
  PolicyAcknowledgement,
  PolicyCategory,
  PolicyOverride,
  PolicyReviewCycle,
  Role,
  ShiftLetter,
} from '@/types'

/**
 * Policies: document-based acknowledgement flow. Mirrors
 * useRequiredTraining structurally — audience filter × per-user
 * overrides × current-user signed status — but content is a PDF and
 * the row is stale when the policy's `version` advances past the
 * user's `policy_version_at_signing`.
 *
 * Module-singleton refs share state across the dashboard banner,
 * /policies list, /policies/:id detail, and /admin/policies.
 */

interface PolicyRow {
  id: string
  title: string
  summary: string
  category: PolicyCategory
  document_storage_path: string | null
  document_filename: string | null
  version: number
  effective_date: string | null
  review_cycle: PolicyReviewCycle
  audience_roles: string[] | null
  audience_shifts: string[] | null
  audience_employment_types: string[] | null
  attestation_statement: string
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface AckRow {
  id: string
  policy_id: string
  user_id: string
  policy_version_at_signing: number
  acknowledged_at: string
  signature_data: string | null
  signed_method: 'self' | 'admin_marked'
  marked_by: string | null
  marked_note: string | null
}

interface OverrideRow {
  id: string
  policy_id: string
  user_id: string
  included: boolean
}

function policyFromRow(r: PolicyRow): Policy {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    category: r.category,
    documentStoragePath: r.document_storage_path,
    documentFilename: r.document_filename,
    version: r.version,
    effectiveDate: r.effective_date,
    reviewCycle: r.review_cycle,
    audienceRoles: (r.audience_roles ?? []) as Role[],
    audienceShifts: (r.audience_shifts ?? []) as ShiftLetter[],
    audienceEmploymentTypes: (r.audience_employment_types ?? []) as EmploymentType[],
    attestationStatement: r.attestation_statement,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function ackFromRow(r: AckRow): PolicyAcknowledgement {
  return {
    id: r.id,
    policyId: r.policy_id,
    userId: r.user_id,
    policyVersionAtSigning: r.policy_version_at_signing,
    acknowledgedAt: r.acknowledged_at,
    signatureData: r.signature_data,
    signedMethod: r.signed_method,
    markedBy: r.marked_by,
    markedNote: r.marked_note,
  }
}

function overrideFromRow(r: OverrideRow): PolicyOverride {
  return {
    id: r.id,
    policyId: r.policy_id,
    userId: r.user_id,
    included: r.included,
  }
}

const policies = ref<Policy[]>([])
const acknowledgements = ref<PolicyAcknowledgement[]>([])
const overrides = ref<PolicyOverride[]>([])
const ready = ref(false)
let loadStarted = false

const POLICY_COLUMNS =
  'id, title, summary, category, document_storage_path, document_filename, version, effective_date, review_cycle, audience_roles, audience_shifts, audience_employment_types, attestation_statement, active, created_by, created_at, updated_at'

const ACK_COLUMNS =
  'id, policy_id, user_id, policy_version_at_signing, acknowledged_at, signature_data, signed_method, marked_by, marked_note'

const OVERRIDE_COLUMNS = 'id, policy_id, user_id, included'

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    ready.value = true
    return
  }

  const [pRes, aRes, oRes] = await Promise.all([
    supabase
      .from('policies')
      .select(POLICY_COLUMNS)
      .order('category')
      .order('title'),
    supabase.from('policy_acknowledgements').select(ACK_COLUMNS),
    supabase.from('policy_user_overrides').select(OVERRIDE_COLUMNS),
  ])
  if (pRes.error) console.error('[policies] modules load:', pRes.error.message)
  if (aRes.error) console.error('[policies] acks load:', aRes.error.message)
  if (oRes.error) console.error('[policies] overrides load:', oRes.error.message)
  policies.value = (pRes.data ?? []).map((r) => policyFromRow(r as PolicyRow))
  acknowledgements.value = (aRes.data ?? []).map((r) => ackFromRow(r as AckRow))
  overrides.value = (oRes.data ?? []).map((r) => overrideFromRow(r as OverrideRow))
  ready.value = true
}

export interface SavePolicyInput {
  id?: string
  title: string
  summary: string
  category: PolicyCategory
  effectiveDate: string | null
  reviewCycle: PolicyReviewCycle
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  audienceEmploymentTypes: EmploymentType[]
  attestationStatement: string
  active: boolean
}

export function usePolicies() {
  const auth = useAuthStore()
  void load()

  /* Audience filter check for an arbitrary user. Three-axis intersect
     with empty-array-means-match-all. */
  function matchesAudienceFilterForUser(
    p: Policy,
    user: { role: Role; shift: ShiftLetter | null; employmentType: EmploymentType },
  ): boolean {
    const roleOk = p.audienceRoles.length === 0 || p.audienceRoles.includes(user.role)
    const shiftOk =
      p.audienceShifts.length === 0 ||
      (user.shift !== null && p.audienceShifts.includes(user.shift))
    const etOk =
      p.audienceEmploymentTypes.length === 0 ||
      p.audienceEmploymentTypes.includes(user.employmentType)
    return roleOk && shiftOk && etOk
  }

  function isRequiredForUser(
    p: Policy,
    user: { id: string; role: Role; shift: ShiftLetter | null; employmentType: EmploymentType },
  ): boolean {
    const override = overrides.value.find(
      (o) => o.policyId === p.id && o.userId === user.id,
    )
    if (override) return override.included
    return matchesAudienceFilterForUser(p, user)
  }

  /* Active policies the signed-in user is in audience of. */
  const activeForUser = computed<Policy[]>(() => {
    const u = auth.appUser
    if (!u) return []
    return policies.value.filter((p) => {
      if (!p.active) return false
      return isRequiredForUser(p, {
        id: u.id,
        role: u.role,
        shift: u.shift,
        employmentType: u.employmentType,
      })
    })
  })

  function ackFor(policyId: string, userId?: string): PolicyAcknowledgement | null {
    const uid = userId ?? auth.appUser?.id
    if (!uid) return null
    /* If there are multiple acks (one per version), return the most
       recent. */
    const rows = acknowledgements.value
      .filter((a) => a.policyId === policyId && a.userId === uid)
      .sort((a, b) => b.policyVersionAtSigning - a.policyVersionAtSigning)
    return rows[0] ?? null
  }

  /* "Current" = ack exists AND it's for the current policy version. A
     stale ack (older version) reads as not-current and re-prompts. */
  function isAcknowledged(policyId: string, userId?: string): boolean {
    const ack = ackFor(policyId, userId)
    if (!ack) return false
    const policy = policies.value.find((p) => p.id === policyId)
    if (!policy) return false
    return ack.policyVersionAtSigning >= policy.version
  }

  /* Stale = there's a prior-version ack but the policy advanced. Used
     to surface a "policy was updated, please re-acknowledge" hint. */
  function isStale(policyId: string, userId?: string): boolean {
    const ack = ackFor(policyId, userId)
    if (!ack) return false
    const policy = policies.value.find((p) => p.id === policyId)
    if (!policy) return false
    return ack.policyVersionAtSigning < policy.version
  }

  const outstandingCount = computed(() =>
    activeForUser.value.filter((p) => !isAcknowledged(p.id)).length,
  )

  function policyById(id: string): Policy | null {
    return policies.value.find((p) => p.id === id) ?? null
  }

  function acksFor(policyId: string): PolicyAcknowledgement[] {
    return acknowledgements.value.filter((a) => a.policyId === policyId)
  }

  /* Self-acknowledge: insert a new ack row stamped with the policy's
     current version. Re-acknowledging a new version inserts a fresh
     row (the unique constraint is on policy/user/version). */
  async function submitAcknowledgement(
    policyId: string,
    signatureData: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (auth.isKiosk) {
      return {
        ok: false,
        error: 'Acknowledgements aren’t allowed on station kiosks.',
      }
    }
    const policy = policyById(policyId)
    if (!policy) return { ok: false, error: 'Policy not found.' }

    if (auth.usingDevStub) {
      const next: PolicyAcknowledgement = {
        id: crypto.randomUUID(),
        policyId,
        userId: uid,
        policyVersionAtSigning: policy.version,
        acknowledgedAt: new Date().toISOString(),
        signatureData,
        signedMethod: 'self',
        markedBy: null,
        markedNote: null,
      }
      acknowledgements.value = [...acknowledgements.value, next]
      return { ok: true }
    }

    const { data, error } = await supabase
      .from('policy_acknowledgements')
      .insert({
        policy_id: policyId,
        user_id: uid,
        policy_version_at_signing: policy.version,
        signature_data: signatureData,
        signed_method: 'self',
      })
      .select(ACK_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = ackFromRow(data as AckRow)
    acknowledgements.value = [...acknowledgements.value, row]
    return { ok: true }
  }

  /* Admin: mark a specific user acknowledged via SECURITY DEFINER RPC. */
  async function adminMarkAcknowledged(
    policyId: string,
    targetUserId: string,
    note?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const { error } = await supabase.rpc('admin_mark_policy_acknowledged', {
      p_policy_id: policyId,
      p_user_id: targetUserId,
      p_note: note ?? null,
    })
    if (error) return { ok: false, error: error.message }
    const { data } = await supabase
      .from('policy_acknowledgements')
      .select(ACK_COLUMNS)
      .eq('policy_id', policyId)
      .eq('user_id', targetUserId)
      .order('policy_version_at_signing', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      const row = ackFromRow(data as AckRow)
      acknowledgements.value = [
        ...acknowledgements.value.filter((a) => a.id !== row.id),
        row,
      ]
    }
    return { ok: true }
  }

  function getOverride(policyId: string, userId: string): PolicyOverride | null {
    return (
      overrides.value.find((o) => o.policyId === policyId && o.userId === userId) ?? null
    )
  }

  async function setOverride(
    policyId: string,
    userId: string,
    included: boolean | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const existing = getOverride(policyId, userId)
    if (included === null) {
      if (!existing) return { ok: true }
      const { error } = await supabase
        .from('policy_user_overrides')
        .delete()
        .eq('id', existing.id)
      if (error) return { ok: false, error: error.message }
      overrides.value = overrides.value.filter((o) => o.id !== existing.id)
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('policy_user_overrides')
      .upsert(
        {
          policy_id: policyId,
          user_id: userId,
          included,
          created_by: auth.appUser?.id ?? null,
        },
        { onConflict: 'policy_id,user_id' },
      )
      .select(OVERRIDE_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = overrideFromRow(data as OverrideRow)
    overrides.value = [...overrides.value.filter((o) => o.id !== row.id), row]
    return { ok: true }
  }

  /* Public URL for the PDF (bucket is public-read so we don't need a
     signed URL). Returns null if no file uploaded yet. */
  function documentPublicUrl(p: Policy): string | null {
    if (!p.documentStoragePath) return null
    const { data } = supabase.storage
      .from('policy-documents')
      .getPublicUrl(p.documentStoragePath)
    return data.publicUrl
  }

  /* Admin CRUD on policy metadata. PDF upload is a separate step
     (uploadDocument below) so we can keep metadata edits cheap. */
  async function savePolicy(
    input: SavePolicyInput,
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const row = {
      title: input.title.trim(),
      summary: input.summary.trim(),
      category: input.category,
      effective_date: input.effectiveDate,
      review_cycle: input.reviewCycle,
      audience_roles: input.audienceRoles,
      audience_shifts: input.audienceShifts,
      audience_employment_types: input.audienceEmploymentTypes,
      attestation_statement: input.attestationStatement.trim(),
      active: input.active,
    }
    if (input.id) {
      const { data, error } = await supabase
        .from('policies')
        .update(row)
        .eq('id', input.id)
        .select(POLICY_COLUMNS)
        .single()
      if (error) return { ok: false, error: error.message }
      const next = policyFromRow(data as PolicyRow)
      policies.value = policies.value.map((p) => (p.id === next.id ? next : p))
      return { ok: true, id: next.id }
    }
    const { data, error } = await supabase
      .from('policies')
      .insert({ ...row, created_by: auth.appUser?.id ?? null })
      .select(POLICY_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const inserted = policyFromRow(data as PolicyRow)
    policies.value = [inserted, ...policies.value]
    return { ok: true, id: inserted.id }
  }

  /* Upload a PDF for a policy. Bumps `version`. The path convention is
     `{policy_id}/v{N}.pdf` so prior versions stay accessible in
     Storage for audit. Old acknowledgements aren't deleted — they're
     now stale relative to the new version. */
  async function uploadDocument(
    policyId: string,
    file: File,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: false, error: 'Not supported in dev mode.' }
    const policy = policyById(policyId)
    if (!policy) return { ok: false, error: 'Policy not found.' }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return { ok: false, error: 'PDF files only.' }
    }
    const nextVersion = policy.version + (policy.documentStoragePath ? 1 : 0)
    const path = `${policyId}/v${nextVersion}.pdf`

    const { error: uploadErr } = await supabase.storage
      .from('policy-documents')
      .upload(path, file, { upsert: true, contentType: 'application/pdf' })
    if (uploadErr) return { ok: false, error: uploadErr.message }

    const { data, error } = await supabase
      .from('policies')
      .update({
        document_storage_path: path,
        document_filename: file.name,
        version: nextVersion,
      })
      .eq('id', policyId)
      .select(POLICY_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const next = policyFromRow(data as PolicyRow)
    policies.value = policies.value.map((p) => (p.id === next.id ? next : p))
    return { ok: true, version: next.version }
  }

  async function deletePolicy(
    policyId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const { error } = await supabase.from('policies').delete().eq('id', policyId)
    if (error) return { ok: false, error: error.message }
    policies.value = policies.value.filter((p) => p.id !== policyId)
    return { ok: true }
  }

  return {
    ready,
    policies,
    acknowledgements,
    overrides,
    activeForUser,
    outstandingCount,
    policyById,
    ackFor,
    acksFor,
    isAcknowledged,
    isStale,
    matchesAudienceFilterForUser,
    isRequiredForUser,
    submitAcknowledgement,
    adminMarkAcknowledged,
    getOverride,
    setOverride,
    documentPublicUrl,
    savePolicy,
    uploadDocument,
    deletePolicy,
  }
}
