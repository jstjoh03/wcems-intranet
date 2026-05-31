import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import type {
  RequiredTraining,
  RequiredTrainingCompletion,
  Role,
  ShiftLetter,
  VideoSource,
} from '@/types'

/**
 * Required training: crew-facing list + a single admin CRUD surface.
 *
 * Module-singleton refs are shared across consumers (dashboard banner,
 * /training/required, /admin/required-training). One load on first use,
 * realtime keeps it fresh.
 */

interface TrainingRow {
  id: string
  title: string
  description: string
  video_source: VideoSource
  video_ref: string
  duration_seconds: number | null
  required_by: string | null
  audience_roles: string[] | null
  audience_shifts: string[] | null
  attestation_statement: string
  quiz: unknown | null
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface CompletionRow {
  id: string
  required_training_id: string
  user_id: string
  started_at: string
  completed_at: string | null
  signature_data: string | null
  signed_method: 'self' | 'admin_marked'
  marked_by: string | null
  marked_note: string | null
  quiz_score: number | null
  attestation_signed: boolean
  certificate_storage_path: string | null
  created_at: string
  updated_at: string
}

function trainingFromRow(r: TrainingRow): RequiredTraining {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    videoSource: r.video_source,
    videoRef: r.video_ref,
    durationSeconds: r.duration_seconds,
    requiredBy: r.required_by,
    audienceRoles: (r.audience_roles ?? []) as Role[],
    audienceShifts: (r.audience_shifts ?? []) as ShiftLetter[],
    attestationStatement: r.attestation_statement,
    quiz: r.quiz,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function completionFromRow(r: CompletionRow): RequiredTrainingCompletion {
  return {
    id: r.id,
    requiredTrainingId: r.required_training_id,
    userId: r.user_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    signatureData: r.signature_data,
    signedMethod: r.signed_method,
    markedBy: r.marked_by,
    markedNote: r.marked_note,
    quizScore: r.quiz_score,
    attestationSigned: r.attestation_signed,
    certificateStoragePath: r.certificate_storage_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const trainings = ref<RequiredTraining[]>([])
const completions = ref<RequiredTrainingCompletion[]>([])
const ready = ref(false)
let loadStarted = false

const TRAINING_COLUMNS =
  'id, title, description, video_source, video_ref, duration_seconds, required_by, audience_roles, audience_shifts, attestation_statement, quiz, active, created_by, created_at, updated_at'

const COMPLETION_COLUMNS =
  'id, required_training_id, user_id, started_at, completed_at, signature_data, signed_method, marked_by, marked_note, quiz_score, attestation_signed, certificate_storage_path, created_at, updated_at'

async function load() {
  if (loadStarted) return
  loadStarted = true
  const auth = useAuthStore()
  if (auth.usingDevStub) {
    // Dev-stub has no required-training data — keep arrays empty.
    ready.value = true
    return
  }

  const [tRes, cRes] = await Promise.all([
    supabase
      .from('required_trainings')
      .select(TRAINING_COLUMNS)
      .order('created_at', { ascending: false }),
    supabase
      .from('required_training_completions')
      .select(COMPLETION_COLUMNS),
  ])
  if (tRes.error) console.error('[required-training] modules load:', tRes.error.message)
  if (cRes.error) console.error('[required-training] completions load:', cRes.error.message)
  trainings.value = (tRes.data ?? []).map((r) => trainingFromRow(r as TrainingRow))
  completions.value = (cRes.data ?? []).map((r) => completionFromRow(r as CompletionRow))
  ready.value = true
}

export interface SaveTrainingInput {
  id?: string
  title: string
  description: string
  videoSource: VideoSource
  videoRef: string
  durationSeconds: number | null
  requiredBy: string | null
  audienceRoles: Role[]
  audienceShifts: ShiftLetter[]
  attestationStatement: string
  active: boolean
}

export function useRequiredTraining() {
  const auth = useAuthStore()
  void load()

  /* Filter to the modules this user is in the audience for. Admins see
     every active module on the crew list too, but the banner / status
     pills are still computed against their own completion record. */
  const activeForUser = computed<RequiredTraining[]>(() => {
    const u = auth.appUser
    if (!u) return []
    return trainings.value.filter((t) => {
      if (!t.active) return false
      const roleOk = t.audienceRoles.length === 0 || t.audienceRoles.includes(u.role)
      const shiftOk =
        t.audienceShifts.length === 0 ||
        (u.shift !== null && t.audienceShifts.includes(u.shift))
      return roleOk && shiftOk
    })
  })

  function completionFor(trainingId: string, userId?: string): RequiredTrainingCompletion | null {
    const uid = userId ?? auth.appUser?.id
    if (!uid) return null
    return completions.value.find(
      (c) => c.requiredTrainingId === trainingId && c.userId === uid,
    ) ?? null
  }

  function isComplete(trainingId: string, userId?: string): boolean {
    return completionFor(trainingId, userId)?.attestationSigned === true
  }

  const outstandingCount = computed(() =>
    activeForUser.value.filter((t) => !isComplete(t.id)).length,
  )

  /* Mark "started" — fire once when the user first plays the video so
     even partial views are recorded. Idempotent: if a row already
     exists (started or signed), no-op. */
  async function markStarted(trainingId: string): Promise<void> {
    if (auth.usingDevStub) return
    const uid = auth.appUser?.id
    if (!uid) return
    const existing = completionFor(trainingId)
    if (existing) return
    const { data, error } = await supabase
      .from('required_training_completions')
      .insert({
        required_training_id: trainingId,
        user_id: uid,
        signed_method: 'self',
        attestation_signed: false,
      })
      .select(COMPLETION_COLUMNS)
      .single()
    if (error) {
      // Race: someone else may have inserted. Ignore.
      if (error.code !== '23505') console.warn('[required-training] markStarted:', error.message)
      return
    }
    completions.value = [...completions.value, completionFromRow(data as CompletionRow)]
  }

  /* Self-attest: flip the existing (or insert + flip) completion row
     to attestation_signed=true with the signature data url. */
  async function submitAttestation(
    trainingId: string,
    signatureData: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const uid = auth.appUser?.id
    if (!uid) return { ok: false, error: 'Sign in first.' }
    if (auth.usingDevStub) {
      const existing = completionFor(trainingId)
      const next: RequiredTrainingCompletion = existing
        ? { ...existing, attestationSigned: true, completedAt: new Date().toISOString(), signatureData, signedMethod: 'self' }
        : {
            id: crypto.randomUUID(),
            requiredTrainingId: trainingId,
            userId: uid,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            signatureData,
            signedMethod: 'self',
            markedBy: null,
            markedNote: null,
            quizScore: null,
            attestationSigned: true,
            certificateStoragePath: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
      completions.value = [
        ...completions.value.filter((c) => c.id !== next.id),
        next,
      ]
      return { ok: true }
    }
    const { data, error } = await supabase
      .from('required_training_completions')
      .upsert(
        {
          required_training_id: trainingId,
          user_id: uid,
          signature_data: signatureData,
          signed_method: 'self',
          attestation_signed: true,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'required_training_id,user_id' },
      )
      .select(COMPLETION_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const row = completionFromRow(data as CompletionRow)
    completions.value = [
      ...completions.value.filter((c) => c.id !== row.id),
      row,
    ]
    return { ok: true }
  }

  /* Admin: mark a specific user complete (Teams session attendance,
     in-person sign-off, etc.) via the SECURITY DEFINER RPC. */
  async function adminMarkComplete(
    trainingId: string,
    targetUserId: string,
    note?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (auth.usingDevStub) return { ok: true }
    const { error } = await supabase.rpc('admin_mark_required_training_complete', {
      training_id: trainingId,
      target_user_id: targetUserId,
      note: note ?? null,
    })
    if (error) return { ok: false, error: error.message }
    // Re-fetch the affected completion so the cache reflects the change.
    const { data } = await supabase
      .from('required_training_completions')
      .select(COMPLETION_COLUMNS)
      .eq('required_training_id', trainingId)
      .eq('user_id', targetUserId)
      .maybeSingle()
    if (data) {
      const row = completionFromRow(data as CompletionRow)
      completions.value = [
        ...completions.value.filter((c) => c.id !== row.id),
        row,
      ]
    }
    return { ok: true }
  }

  /* Admin CRUD on modules. */
  async function saveTraining(input: SaveTrainingInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const row = {
      title: input.title.trim(),
      description: input.description.trim(),
      video_source: input.videoSource,
      video_ref: input.videoRef.trim(),
      duration_seconds: input.durationSeconds,
      required_by: input.requiredBy,
      audience_roles: input.audienceRoles,
      audience_shifts: input.audienceShifts,
      attestation_statement: input.attestationStatement,
      active: input.active,
    }
    if (input.id) {
      const { data, error } = await supabase
        .from('required_trainings')
        .update(row)
        .eq('id', input.id)
        .select(TRAINING_COLUMNS)
        .single()
      if (error) return { ok: false, error: error.message }
      const next = trainingFromRow(data as TrainingRow)
      trainings.value = trainings.value.map((t) => (t.id === next.id ? next : t))
      return { ok: true, id: next.id }
    }
    const { data, error } = await supabase
      .from('required_trainings')
      .insert({ ...row, created_by: auth.appUser?.id ?? null })
      .select(TRAINING_COLUMNS)
      .single()
    if (error) return { ok: false, error: error.message }
    const inserted = trainingFromRow(data as TrainingRow)
    trainings.value = [inserted, ...trainings.value]
    return { ok: true, id: inserted.id }
  }

  async function deleteTraining(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.from('required_trainings').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    trainings.value = trainings.value.filter((t) => t.id !== id)
    completions.value = completions.value.filter((c) => c.requiredTrainingId !== id)
    return { ok: true }
  }

  function trainingById(id: string): RequiredTraining | null {
    return trainings.value.find((t) => t.id === id) ?? null
  }

  function completionsFor(trainingId: string): RequiredTrainingCompletion[] {
    return completions.value.filter((c) => c.requiredTrainingId === trainingId)
  }

  return {
    ready,
    trainings,
    completions,
    activeForUser,
    outstandingCount,
    completionFor,
    isComplete,
    completionsFor,
    trainingById,
    markStarted,
    submitAttestation,
    adminMarkComplete,
    saveTraining,
    deleteTraining,
  }
}
