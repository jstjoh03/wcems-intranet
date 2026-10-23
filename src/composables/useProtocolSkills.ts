import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type { SkillsCheckoffSection, SkillItemResult } from '@/types'

/**
 * Protocol-update skills verification (protocol_skill_* tables): when
 * a protocol revision adds skills to a scope, every credentialed
 * employee at that level gets a hands-on check-off — Skills-Day-style
 * section/item lists, dual signatures, pass or remediation. Separate
 * tables from NEOP Skills Day on purpose (that module must stay
 * stable through cohort week); same shapes so the UX carries over.
 *
 * Module-level singleton per house convention; verifications stream
 * in realtime so the board moves while crews verify in the field.
 */

export interface ProtocolSkillCampaign {
  id: string
  key: string
  title: string
  description: string
  dueBy: string | null
  active: boolean
}

export interface ProtocolSkillCheckoff {
  id: string
  campaignId: string
  key: string
  title: string
  subtitle: string
  note: string
  sections: SkillsCheckoffSection[]
  requiredLevels: string[]
  sort: number
  active: boolean
}

export interface ProtocolSkillVerification {
  id: string
  checkoffId: string
  userId: string
  evaluatorId: string
  evalDate: string
  items: Record<string, { result: SkillItemResult; comment?: string; label?: string }>
  overall: 'pass' | 'remediation'
  candidateSignature: string | null
  evaluatorSignature: string | null
  note: string | null
  submittedAt: string
}

const CAMPAIGN_COLUMNS = 'id, key, title, description, due_by, active'
const CHECKOFF_COLUMNS = 'id, campaign_id, key, title, subtitle, note, sections, required_levels, sort, active'
const VERIFICATION_COLUMNS =
  'id, checkoff_id, user_id, evaluator_id, eval_date, items, overall, candidate_signature, evaluator_signature, note, submitted_at'

const campaigns = ref<ProtocolSkillCampaign[]>([])
const checkoffs = ref<ProtocolSkillCheckoff[]>([])
const verifications = ref<ProtocolSkillVerification[]>([])
const ready = ref(false)
let loadStarted = false
let realtimeSubscribed = false

function campaignFromRow(r: Record<string, unknown>): ProtocolSkillCampaign {
  return {
    id: r.id as string,
    key: r.key as string,
    title: r.title as string,
    description: (r.description ?? '') as string,
    dueBy: (r.due_by ?? null) as string | null,
    active: r.active as boolean,
  }
}

function checkoffFromRow(r: Record<string, unknown>): ProtocolSkillCheckoff {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    key: r.key as string,
    title: r.title as string,
    subtitle: (r.subtitle ?? '') as string,
    note: (r.note ?? '') as string,
    sections: (r.sections ?? []) as SkillsCheckoffSection[],
    requiredLevels: (r.required_levels ?? []) as string[],
    sort: r.sort as number,
    active: r.active as boolean,
  }
}

function verificationFromRow(r: Record<string, unknown>): ProtocolSkillVerification {
  return {
    id: r.id as string,
    checkoffId: r.checkoff_id as string,
    userId: r.user_id as string,
    evaluatorId: r.evaluator_id as string,
    evalDate: r.eval_date as string,
    items: (r.items ?? {}) as ProtocolSkillVerification['items'],
    overall: r.overall as 'pass' | 'remediation',
    candidateSignature: (r.candidate_signature ?? null) as string | null,
    evaluatorSignature: (r.evaluator_signature ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    submittedAt: r.submitted_at as string,
  }
}

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    campaigns.value = [
      {
        id: 'dev-camp',
        key: 'protocol-2026',
        title: '2026 Protocol Update — Skills Verification',
        description: 'Dev fixture.',
        dueBy: null,
        active: true,
      },
    ]
    checkoffs.value = [
      {
        id: 'dev-ck-1',
        campaignId: 'dev-camp',
        key: 'cpap-standalone',
        title: 'Standalone CPAP',
        subtitle: '1.20 CPAP',
        note: '',
        sections: [
          { title: 'Application', items: [
            { key: '1', label: 'Assembles the device and selects the mask' },
            { key: '2', label: 'Applies at 5 cmH2O and titrates to effect' },
          ] },
        ],
        requiredLevels: ['EMT-B', 'EMT-P'],
        sort: 10,
        active: true,
      },
    ]
    ready.value = true
    return
  }
  const [cRes, kRes, vRes] = await Promise.all([
    supabase.from('protocol_skill_campaigns').select(CAMPAIGN_COLUMNS).order('created_at'),
    supabase.from('protocol_skill_checkoffs').select(CHECKOFF_COLUMNS).order('sort'),
    supabase.from('protocol_skill_verifications').select(VERIFICATION_COLUMNS),
  ])
  if (cRes.error) console.error('[protocol-skills] campaigns:', cRes.error.message)
  if (kRes.error) console.error('[protocol-skills] checkoffs:', kRes.error.message)
  if (vRes.error) console.error('[protocol-skills] verifications:', vRes.error.message)
  campaigns.value = (cRes.data ?? []).map(campaignFromRow)
  checkoffs.value = (kRes.data ?? []).map(checkoffFromRow)
  verifications.value = (vRes.data ?? []).map(verificationFromRow)
  ready.value = true

  if (!realtimeSubscribed) {
    realtimeSubscribed = true
    supabase
      .channel('protocol_skills')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'protocol_skill_verifications' },
        (payload) => {
          const row = verificationFromRow(payload.new as Record<string, unknown>)
          verifications.value = [...verifications.value.filter((v) => v.id !== row.id), row]
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'protocol_skill_verifications' },
        (payload) => {
          const oldId = (payload.old as { id?: string }).id
          if (oldId) verifications.value = verifications.value.filter((v) => v.id !== oldId)
        },
      )
      .subscribe()
  }
}

export function useProtocolSkills() {
  const auth = useAuthStore()
  void load()

  const activeCampaign = computed(() => campaigns.value.find((c) => c.active) ?? null)

  const activeCheckoffs = computed(() =>
    checkoffs.value
      .filter((k) => k.active && k.campaignId === (activeCampaign.value?.id ?? ''))
      .sort((a, b) => a.sort - b.sort),
  )

  /** The skills a given cert level owes. */
  function skillsForLevel(certLevel: string | null): ProtocolSkillCheckoff[] {
    if (!certLevel) return []
    return activeCheckoffs.value.filter((k) => k.requiredLevels.includes(certLevel))
  }

  /** Latest verification of one skill for one person (pass wins). */
  function verificationFor(userId: string, checkoffId: string): ProtocolSkillVerification | null {
    const mine = verifications.value
      .filter((v) => v.userId === userId && v.checkoffId === checkoffId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    return mine.find((v) => v.overall === 'pass') ?? mine[0] ?? null
  }

  async function submitVerification(input: {
    checkoffId: string
    userId: string
    evalDate: string
    items: ProtocolSkillVerification['items']
    overall: 'pass' | 'remediation'
    candidateSignature: string | null
    evaluatorSignature: string | null
    note?: string | null
  }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: false, error: 'Not available in dev mode.' }
    const { data, error } = await supabase
      .from('protocol_skill_verifications')
      .insert({
        checkoff_id: input.checkoffId,
        user_id: input.userId,
        evaluator_id: auth.appUser?.id,
        eval_date: input.evalDate,
        items: input.items,
        overall: input.overall,
        candidate_signature: input.candidateSignature,
        evaluator_signature: input.evaluatorSignature,
        note: input.note ?? null,
      })
      .select(VERIFICATION_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = verificationFromRow(data as Record<string, unknown>)
    verifications.value = [...verifications.value.filter((v) => v.id !== row.id), row]
    return { ok: true, id: row.id }
  }

  async function removeVerification(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: false, error: 'Not available in dev mode.' }
    const { error } = await supabase.from('protocol_skill_verifications').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    verifications.value = verifications.value.filter((v) => v.id !== id)
    return { ok: true }
  }

  /** Catalog editing (clinical editors / admins — RLS enforces). */
  async function saveCheckoff(input: Partial<ProtocolSkillCheckoff> & { id?: string }) {
    if (auth.usingDevStub) return { ok: false as const, error: 'Not available in dev mode.' }
    const campaignId = input.campaignId ?? activeCampaign.value?.id
    if (!campaignId) return { ok: false as const, error: 'No active campaign.' }
    const patch = {
      campaign_id: campaignId,
      key: input.key,
      title: input.title,
      subtitle: input.subtitle ?? '',
      note: input.note ?? '',
      sections: input.sections ?? [],
      required_levels: input.requiredLevels ?? [],
      sort: input.sort ?? 100,
      active: input.active ?? true,
    }
    const q = input.id
      ? supabase.from('protocol_skill_checkoffs').update(patch).eq('id', input.id).select(CHECKOFF_COLUMNS).single()
      : supabase.from('protocol_skill_checkoffs').insert(patch).select(CHECKOFF_COLUMNS).single()
    const { data, error } = await q
    if (error) return { ok: false as const, error: error.message }
    const row = checkoffFromRow(data as Record<string, unknown>)
    checkoffs.value = [...checkoffs.value.filter((k) => k.id !== row.id), row].sort((a, b) => a.sort - b.sort)
    return { ok: true as const }
  }

  async function setCampaignDue(id: string, dueBy: string | null) {
    if (auth.usingDevStub) return
    const { error } = await supabase.from('protocol_skill_campaigns').update({ due_by: dueBy }).eq('id', id)
    if (!error)
      campaigns.value = campaigns.value.map((c) => (c.id === id ? { ...c, dueBy } : c))
  }

  return {
    ready,
    campaigns,
    checkoffs,
    verifications,
    activeCampaign,
    activeCheckoffs,
    skillsForLevel,
    verificationFor,
    submitVerification,
    removeVerification,
    saveCheckoff,
    setCampaignDue,
  }
}
