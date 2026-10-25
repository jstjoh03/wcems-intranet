<script setup lang="ts">
/**
 * Landing pad for FTEP message deep links (push + email). The notify
 * fan-out sends ONE url per thread — /clinical/thread/:recordId — to
 * every recipient, so this route answers "where does THIS user read
 * that thread?":
 *   clinical editors    → the employee file (Messages section)
 *   the trainee         → My Progress
 *   FTOs / supervisors  → FTEP home (thread opens from the trainee card)
 * Probes run here instead of useClinicalAccess so the redirect never
 * races that composable's one-shot load.
 */
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  if (auth.usingDevStub) {
    void router.replace(auth.isAdmin ? '/clinical' : '/clinical-development')
    return
  }
  const uid = auth.appUser?.id ?? null
  const recordId = String(route.params.recordId ?? '')

  const [ed, rec, own] = await Promise.all([
    uid
      ? supabase.from('pipeline_editors').select('user_id').eq('user_id', uid).maybeSingle()
      : Promise.resolve({ data: null }),
    recordId
      ? supabase.from('pipeline_records').select('user_id').eq('id', recordId).maybeSingle()
      : Promise.resolve({ data: null }),
    uid
      ? supabase.from('pipeline_records').select('is_fto').eq('user_id', uid).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const traineeUserId = (rec.data?.user_id as string | undefined) ?? null

  if (ed.data && traineeUserId) void router.replace(`/clinical/people/${traineeUserId}`)
  else if (ed.data) void router.replace('/clinical')
  else if (traineeUserId && traineeUserId === uid) void router.replace('/clinical-development')
  else if (auth.isSupervisor || own.data?.is_fto) void router.replace('/clinical/ftep')
  else void router.replace('/clinical-development')
})
</script>

<template>
  <div class="thread-redirect">Opening the thread…</div>
</template>

<style scoped>
.thread-redirect {
  padding: 64px 20px;
  text-align: center;
  color: var(--color-text-soft, #5b6372);
  font-size: 15px;
}
</style>
