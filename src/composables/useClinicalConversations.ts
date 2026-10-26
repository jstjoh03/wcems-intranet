import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Clinical conversations — documentation that a clinical conversation
 * took place (incident, call type/details, discussion, when/where, who
 * was present). Explicitly NOT disciplinary: the employee sees theirs
 * immediately, gets a push+email notice (sched-notify kind
 * 'clinical_conversation'), and can leave one response and sign when
 * signatures were requested.
 *
 * Staff (clinical editors + supervisors + admins — is_clinical_staff()
 * server-side) create and edit; the employee responds/signs through the
 * two SECURITY DEFINER RPCs. Module singleton with per-person caches.
 */

export interface ConversationParticipant {
  id: string
  userId: string | null
  displayName: string
  isEmployee: boolean
  signatureData: string | null
  signedAt: string | null
}

export interface ClinicalConversation {
  id: string
  userId: string
  createdBy: string
  createdByName: string
  occurredAt: string
  location: string
  incidentNumber: string
  callType: string
  callDetails: string
  discussion: string
  requireSignatures: boolean
  response: string | null
  responseAt: string | null
  createdAt: string
  participants: ConversationParticipant[]
}

export interface ConversationDraft {
  userId: string
  occurredAt: string
  location: string
  incidentNumber: string
  callType: string
  callDetails: string
  discussion: string
  requireSignatures: boolean
  /** Everyone present (the employee included — isEmployee flags them). */
  participants: { userId: string | null; displayName: string; isEmployee: boolean }[]
}

interface ConvRow {
  id: string
  user_id: string
  created_by: string
  created_by_name: string
  occurred_at: string
  location: string
  incident_number: string
  call_type: string
  call_details: string
  discussion: string
  require_signatures: boolean
  response: string | null
  response_at: string | null
  created_at: string
  clinical_conversation_participants: PartRow[]
}

interface PartRow {
  id: string
  user_id: string | null
  display_name: string
  is_employee: boolean
  signature_data: string | null
  signed_at: string | null
}

const SELECT =
  'id, user_id, created_by, created_by_name, occurred_at, location, incident_number, ' +
  'call_type, call_details, discussion, require_signatures, response, response_at, created_at, ' +
  'clinical_conversation_participants ( id, user_id, display_name, is_employee, signature_data, signed_at )'

function fromRow(r: ConvRow): ClinicalConversation {
  return {
    id: r.id,
    userId: r.user_id,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    occurredAt: r.occurred_at,
    location: r.location,
    incidentNumber: r.incident_number,
    callType: r.call_type,
    callDetails: r.call_details,
    discussion: r.discussion,
    requireSignatures: r.require_signatures,
    response: r.response,
    responseAt: r.response_at,
    createdAt: r.created_at,
    participants: (r.clinical_conversation_participants ?? [])
      .map((p) => ({
        id: p.id,
        userId: p.user_id,
        displayName: p.display_name,
        isEmployee: p.is_employee,
        signatureData: p.signature_data,
        signedAt: p.signed_at,
      }))
      .sort((a, b) => Number(b.isEmployee) - Number(a.isEmployee) || a.displayName.localeCompare(b.displayName)),
  }
}

const byPerson = ref<Record<string, ClinicalConversation[]>>({})
const byId = ref<Record<string, ClinicalConversation>>({})

/* Dev stub: in-memory store so the pages work in the role-switcher. */
const stubStore = ref<ClinicalConversation[]>([])

export function useClinicalConversations() {
  const auth = useAuthStore()

  function cache(c: ClinicalConversation) {
    byId.value = { ...byId.value, [c.id]: c }
    const list = (byPerson.value[c.userId] ?? []).filter((x) => x.id !== c.id)
    byPerson.value = {
      ...byPerson.value,
      [c.userId]: [...list, c].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    }
  }

  function listFor(userId: string): ClinicalConversation[] {
    if (auth.usingDevStub) return stubStore.value.filter((c) => c.userId === userId)
    return byPerson.value[userId] ?? []
  }

  async function loadFor(userId: string): Promise<void> {
    if (auth.usingDevStub) return
    const { data, error } = await supabase
      .from('clinical_conversations')
      .select(SELECT)
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
    if (error) {
      console.warn('[conversations] load failed:', error.message)
      return
    }
    byPerson.value = { ...byPerson.value, [userId]: [] }
    for (const r of (data ?? []) as unknown as ConvRow[]) cache(fromRow(r))
  }

  async function get(id: string): Promise<ClinicalConversation | null> {
    if (auth.usingDevStub) return stubStore.value.find((c) => c.id === id) ?? null
    const { data, error } = await supabase
      .from('clinical_conversations')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    const c = fromRow(data as unknown as ConvRow)
    cache(c)
    return c
  }

  /** Create + participants + employee notice. Returns the new id. */
  async function create(draft: ConversationDraft): Promise<{ id: string | null; error: string | null }> {
    const me = auth.appUser
    if (!me) return { id: null, error: 'Not signed in' }
    if (auth.usingDevStub) {
      const id = `stub-${Date.now()}`
      stubStore.value = [
        {
          id,
          userId: draft.userId,
          createdBy: me.id,
          createdByName: me.fullName ?? 'You',
          occurredAt: draft.occurredAt,
          location: draft.location,
          incidentNumber: draft.incidentNumber,
          callType: draft.callType,
          callDetails: draft.callDetails,
          discussion: draft.discussion,
          requireSignatures: draft.requireSignatures,
          response: null,
          responseAt: null,
          createdAt: new Date().toISOString(),
          participants: draft.participants.map((p, i) => ({
            id: `stub-p-${i}`,
            userId: p.userId,
            displayName: p.displayName,
            isEmployee: p.isEmployee,
            signatureData: null,
            signedAt: null,
          })),
        },
        ...stubStore.value,
      ]
      return { id, error: null }
    }
    const { data, error } = await supabase
      .from('clinical_conversations')
      .insert({
        user_id: draft.userId,
        created_by: me.id,
        created_by_name: me.fullName ?? '',
        occurred_at: draft.occurredAt,
        location: draft.location.trim(),
        incident_number: draft.incidentNumber.trim(),
        call_type: draft.callType.trim(),
        call_details: draft.callDetails.trim(),
        discussion: draft.discussion.trim(),
        require_signatures: draft.requireSignatures,
      })
      .select('id')
      .single()
    if (error || !data) return { id: null, error: error?.message ?? 'Save failed' }
    const convId = data.id as string
    const { error: pErr } = await supabase.from('clinical_conversation_participants').insert(
      draft.participants.map((p) => ({
        conversation_id: convId,
        user_id: p.userId,
        display_name: p.displayName,
        is_employee: p.isEmployee,
      })),
    )
    if (pErr) return { id: convId, error: pErr.message }
    /* Employee notice — fire-and-forget like the FTEP messages. */
    supabase.functions
      .invoke('sched-notify', { body: { kind: 'clinical_conversation', conversationId: convId } })
      .then(({ error: e }) => {
        if (e) console.warn('[conversations] notify failed:', e.message)
      })
      .catch((e: unknown) => console.warn('[conversations] notify failed:', e))
    await get(convId)
    return { id: convId, error: null }
  }

  /** Staff edit of the record fields (not participants). */
  async function update(
    id: string,
    patch: Omit<ConversationDraft, 'participants' | 'userId'>,
  ): Promise<string | null> {
    if (auth.usingDevStub) {
      stubStore.value = stubStore.value.map((c) =>
        c.id === id
          ? {
              ...c,
              occurredAt: patch.occurredAt,
              location: patch.location,
              incidentNumber: patch.incidentNumber,
              callType: patch.callType,
              callDetails: patch.callDetails,
              discussion: patch.discussion,
              requireSignatures: patch.requireSignatures,
            }
          : c,
      )
      return null
    }
    const { error } = await supabase
      .from('clinical_conversations')
      .update({
        occurred_at: patch.occurredAt,
        location: patch.location.trim(),
        incident_number: patch.incidentNumber.trim(),
        call_type: patch.callType.trim(),
        call_details: patch.callDetails.trim(),
        discussion: patch.discussion.trim(),
        require_signatures: patch.requireSignatures,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return error.message
    await get(id)
    return null
  }

  /** Staff: replace the unsigned attendee list (signed rows are kept). */
  async function setParticipants(
    id: string,
    participants: ConversationDraft['participants'],
    keepIds: string[],
  ): Promise<string | null> {
    if (auth.usingDevStub) return null
    const del = await supabase
      .from('clinical_conversation_participants')
      .delete()
      .eq('conversation_id', id)
      .is('signature_data', null)
      .not('id', 'in', `(${['00000000-0000-0000-0000-000000000000', ...keepIds].join(',')})`)
    if (del.error) return del.error.message
    if (participants.length) {
      const ins = await supabase.from('clinical_conversation_participants').insert(
        participants.map((p) => ({
          conversation_id: id,
          user_id: p.userId,
          display_name: p.displayName,
          is_employee: p.isEmployee,
        })),
      )
      if (ins.error) return ins.error.message
    }
    await get(id)
    return null
  }

  /** Staff device: capture a signature straight onto a participant row. */
  async function signParticipant(participantId: string, dataUrl: string): Promise<string | null> {
    if (auth.usingDevStub) return null
    const { error } = await supabase
      .from('clinical_conversation_participants')
      .update({ signature_data: dataUrl, signed_at: new Date().toISOString() })
      .eq('id', participantId)
      .is('signature_data', null)
    return error?.message ?? null
  }

  /** The employee's own feedback box. */
  async function respond(conversationId: string, text: string): Promise<string | null> {
    if (auth.usingDevStub) return null
    const { error } = await supabase.rpc('clinical_conversation_respond', {
      p_conversation: conversationId,
      p_response: text,
    })
    if (error) return error.message
    await get(conversationId)
    return null
  }

  /** The employee signing remotely from their own device. */
  async function signMine(conversationId: string, dataUrl: string): Promise<string | null> {
    if (auth.usingDevStub) return null
    const { error } = await supabase.rpc('clinical_conversation_sign_mine', {
      p_conversation: conversationId,
      p_signature: dataUrl,
    })
    if (error) return error.message
    await get(conversationId)
    return null
  }

  /** The employee's own list (newest first). */
  async function listMine(): Promise<ClinicalConversation[]> {
    const me = auth.appUser?.id
    if (!me) return []
    if (auth.usingDevStub) return stubStore.value.filter((c) => c.userId === me)
    await loadFor(me)
    return listFor(me)
  }

  async function remove(id: string): Promise<string | null> {
    if (auth.usingDevStub) {
      stubStore.value = stubStore.value.filter((c) => c.id !== id)
      return null
    }
    const { error } = await supabase.from('clinical_conversations').delete().eq('id', id)
    if (error) return error.message
    const c = byId.value[id]
    if (c) {
      byPerson.value = {
        ...byPerson.value,
        [c.userId]: (byPerson.value[c.userId] ?? []).filter((x) => x.id !== id),
      }
      const next = { ...byId.value }
      delete next[id]
      byId.value = next
    }
    return null
  }

  return {
    listFor,
    loadFor,
    get,
    create,
    update,
    setParticipants,
    signParticipant,
    respond,
    signMine,
    listMine,
    remove,
  }
}
