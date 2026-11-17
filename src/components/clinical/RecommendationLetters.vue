<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Check, FileText, X } from 'lucide-vue-next'
import { supabase } from '@/lib/supabase'
import { TRANSITIONS } from '@/constants/pipelineGates'
import { generateRecommendationPdf } from '@/lib/recommendationPdf'
import { useAuthStore } from '@/stores/auth'
import type { PipelinePerson, PipelineTransition } from '@/types'

/**
 * Advancement recommendation letters on a person's credentialing file
 * (Justin, 2026-11-17: "where can I find the completed record?").
 * Lists every ftep_recommendations row for the person; "View letter"
 * regenerates the letterhead PDF from the stored data (attestations,
 * basis, signature), so the record never depends on the cabinet-filing
 * step — which silently fails for non-editor recommenders anyway.
 */

const props = defineProps<{ person: PipelinePerson }>()
const auth = useAuthStore()

interface Letter {
  id: string
  recommenderName: string
  recommenderRole: string
  transition: string
  knowledge: boolean
  safeEthical: boolean
  comfortable: boolean
  recommendation: 'release' | 'extend' | 'separate'
  basis: string | null
  evalDate: string
}

const letters = ref<Letter[]>([])
const loaded = ref(false)
const busyId = ref<string | null>(null)

onMounted(async () => {
  if (auth.usingDevStub) {
    loaded.value = true
    return
  }
  const { data } = await supabase
    .from('ftep_recommendations')
    .select(
      'id, recommender_role, transition, knowledge, safe_ethical, comfortable, recommendation, basis, eval_date, recommender:app_users!ftep_recommendations_recommender_id_fkey(full_name)',
    )
    .eq('trainee_id', props.person.userId)
    .order('created_at', { ascending: false })
  letters.value = ((data ?? []) as unknown as Array<Record<string, never>>).map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any
    return {
      id: row.id,
      recommenderName: row.recommender?.full_name ?? '—',
      recommenderRole: row.recommender_role,
      transition: row.transition,
      knowledge: row.knowledge,
      safeEthical: row.safe_ethical,
      comfortable: row.comfortable,
      recommendation: row.recommendation,
      basis: row.basis,
      evalDate: row.eval_date,
    }
  })
  loaded.value = true
})

const ROLE_LABELS: Record<string, string> = {
  fto: 'Field Training Officer',
  supervisor: 'Field Supervisor',
  cdo: 'Clinical Development Officer',
}
const CHOICE_LABELS: Record<Letter['recommendation'], string> = {
  release: 'Release',
  extend: 'Extend training',
  separate: 'Separation',
}

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function transitionLabel(t: string): string {
  return TRANSITIONS[t as PipelineTransition]?.label ?? t
}

async function viewLetter(l: Letter) {
  if (busyId.value) return
  busyId.value = l.id
  try {
    /* The signature is a fat data URL — fetched only when viewing. */
    const { data } = await supabase
      .from('ftep_recommendations')
      .select('signature')
      .eq('id', l.id)
      .maybeSingle()
    const def = TRANSITIONS[l.transition as PipelineTransition]
    const pdf = await generateRecommendationPdf({
      traineeName: props.person.fullName,
      certLevel: props.person.record.certLevel ?? '—',
      toLabel: def?.toLabel ?? '—',
      transitionLabel: def?.label ?? l.transition,
      recommenderName: l.recommenderName,
      recommenderRole: ROLE_LABELS[l.recommenderRole] ?? l.recommenderRole,
      knowledge: l.knowledge,
      safeEthical: l.safeEthical,
      comfortable: l.comfortable,
      recommendation: l.recommendation,
      basis: l.basis ?? '',
      signature: (data as { signature: string | null } | null)?.signature ?? null,
      evalDate: l.evalDate,
    })
    window.open(pdf.output('bloburl'), '_blank')
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div v-if="loaded && letters.length" class="rl">
    <div class="rl__hd">Advancement recommendations <span class="rl__n">{{ letters.length }}</span></div>
    <div v-for="l in letters" :key="l.id" class="rl__row">
      <span class="rl__mark" :class="l.recommendation === 'release' ? 'rl__mark--ok' : 'rl__mark--warn'">
        <Check v-if="l.recommendation === 'release'" :size="12" :stroke-width="2.6" />
        <X v-else :size="12" :stroke-width="2.6" />
      </span>
      <div class="rl__main">
        <b>{{ l.recommenderName }}</b> · {{ ROLE_LABELS[l.recommenderRole] ?? l.recommenderRole }}
        · {{ CHOICE_LABELS[l.recommendation] }} · {{ fmt(l.evalDate) }}
        <span class="rl__trans">{{ transitionLabel(l.transition) }}</span>
      </div>
      <button type="button" class="rl__btn" :disabled="busyId === l.id" @click="viewLetter(l)">
        <FileText :size="12" :stroke-width="2" />
        {{ busyId === l.id ? 'Building…' : 'View letter' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rl {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 14px;
}
.rl__hd {
  font-size: 11px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--color-muted); margin-bottom: 6px;
}
.rl__n {
  font-family: var(--font-mono); font-size: 10.5px; color: var(--color-muted-soft);
  margin-left: 4px;
}
.rl__row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid var(--color-line-soft, #eee);
  font-size: 12.5px; color: var(--color-ink-soft);
}
.rl__row:last-child { border-bottom: none; }
.rl__mark {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
.rl__mark--ok { background: oklch(0.55 0.12 150); }
.rl__mark--warn { background: oklch(0.65 0.12 75); }
.rl__main { flex: 1; min-width: 0; }
.rl__main b { color: var(--color-ink); }
.rl__trans {
  margin-left: 8px; font-size: 10.5px; font-weight: 700;
  color: var(--color-muted); letter-spacing: 0.04em;
}
.rl__btn {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none;
  border: 1px solid var(--color-line); border-radius: 7px; padding: 4px 9px; cursor: pointer;
}
.rl__btn:hover:not(:disabled) { border-color: var(--color-brand-600); }
.rl__btn:disabled { opacity: 0.6; cursor: wait; }
</style>
