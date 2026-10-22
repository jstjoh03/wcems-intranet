<script setup lang="ts">
import { ref, computed } from 'vue'
import { X, ChevronDown, Check, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useClinical } from '@/composables/useClinical'
import { usePipeline } from '@/composables/usePipeline'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useAuthStore } from '@/stores/auth'
import { activeTransitionFor, TRANSITIONS } from '@/constants/pipelineGates'
import {
  MEGACODE_SCENARIOS,
  MEGACODE_SECTION1,
  MEGACODE_RHYTHMS,
  MEGACODE_SECTION3,
  MEGACODE_AUTOFAILS,
  megacodeScore,
  type MegacodeChecks,
} from '@/constants/megacodeScenarios'
import { generateMegacodeEvalPdf } from '@/lib/megacodeEvalPdf'
import { supabase } from '@/lib/supabase'
import type { PipelinePerson } from '@/types'

/**
 * Megacode runner — the digital Megacode Evaluation, run Skills-Day
 * style on the EXAMINER's device (the candidate never sees this
 * screen). Pick a scenario from the v1.0 examiner-sheet bank, read the
 * script and vitals here, check the form off as the candidate works,
 * auto-score per the paper form (all of Sections 1 & 3, ≥3 rhythms,
 * no automatic fail), collect both signatures, and save: the signed
 * PDF files to the employee's documents, a pass checks the mega-code
 * gate on their active transition, and the credentialing checklist
 * ticks itself.
 */

const props = defineProps<{ preselect?: PipelinePerson | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const auth = useAuthStore()
const { clinicalPeople } = useClinical()
const pipeline = usePipeline()
const clindocs = useClinicalDocs()

const candidateId = ref(props.preselect?.userId ?? '')
const candidate = computed(
  () => clinicalPeople.value.find((p) => p.userId === candidateId.value) ?? null,
)
const people = computed(() =>
  [...clinicalPeople.value].sort((a, b) => a.fullName.localeCompare(b.fullName)),
)

const scenarioKey = ref('')
const scenario = computed(() => MEGACODE_SCENARIOS.find((s) => s.key === scenarioKey.value) ?? null)
const scriptOpen = ref(true)

const checks = ref<MegacodeChecks>({ s1: {}, rhythms: {}, s3: {}, autofails: {}, attempt: 1 })
const score = computed(() => megacodeScore(checks.value))
const comments = ref('')
const examinerSig = ref<string | null>(null)
const candidateSig = ref<string | null>(null)

const busy = ref(false)
const error = ref<string | null>(null)

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (!candidate.value) out.push('Pick the candidate.')
  if (!scenario.value) out.push('Pick the scenario.')
  if (score.value.rhythmCount < 3 && !score.value.autoFailed)
    out.push('Run at least three rhythms (check each the candidate identified AND treated).')
  if (!examinerSig.value) out.push('Examiner signature required.')
  if (!candidateSig.value) out.push('Candidate signature required.')
  return out
})

async function save() {
  if (busy.value || blockers.value.length || !candidate.value || !scenario.value) return
  if (auth.usingDevStub) {
    error.value = 'Not available in dev mode.'
    return
  }
  busy.value = true
  error.value = null
  try {
    const me = auth.appUser?.id
    if (!me) throw new Error('Not signed in.')
    const transition = activeTransitionFor(candidate.value.record)
    const passed = score.value.passed

    const { error: rErr } = await supabase.from('megacode_runs').insert({
      user_id: candidate.value.userId,
      record_id: candidate.value.record.id,
      transition,
      scenario_key: scenario.value.key,
      scenario_title: scenario.value.title,
      examiner_id: me,
      checks: checks.value,
      passed,
      summary_note: comments.value.trim() || null,
      examiner_signature: examinerSig.value,
      candidate_signature: candidateSig.value,
      completed_at: new Date().toISOString(),
    })
    if (rErr) throw new Error(rErr.message)

    /* A pass checks the mega-code gate on the active transition (when
       that transition carries one). */
    if (passed && transition && TRANSITIONS[transition].gates.some((g) => g.key === 'mega_code')) {
      await pipeline.setGate(
        candidate.value.record.id,
        transition,
        'mega_code',
        'complete',
        `${score.value.points} pts · scenario ${scenario.value.no}`,
      )
    }

    /* The signed form into the employee file. */
    const dateIso = new Date().toISOString().slice(0, 10)
    try {
      const doc = await generateMegacodeEvalPdf({
        traineeName: candidate.value.fullName,
        examinerName: auth.appUser?.fullName ?? 'Examiner',
        scenarioTitle: scenario.value.title,
        scenarioNo: scenario.value.no,
        dateIso,
        checks: checks.value,
        comments: comments.value,
        examinerSignature: examinerSig.value,
        candidateSignature: candidateSig.value,
      })
      const safe = candidate.value.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
      const blob = doc.output('blob') as Blob
      await clindocs.upload({
        userId: candidate.value.userId,
        folder: 'generated',
        file: new File([blob], `WCEMS_Megacode_Evaluation_${safe}_${dateIso}.pdf`, { type: 'application/pdf' }),
        employeeVisible: true,
        note: `Scenario ${scenario.value.no} — ${scenario.value.title} · ${passed ? 'Pass' : 'Unsuccessful'}`,
      })
    } catch (e) {
      console.error('[megacode] PDF filing failed:', e)
    }

    await supabase.from('clinical_events').insert({
      user_id: candidate.value.userId,
      kind: 'megacode',
      summary: `Megacode evaluation — ${passed ? 'Pass' : 'Unsuccessful'} (Scenario ${scenario.value.no} · ${scenario.value.title})`,
      detail: { points: score.value.points, attempt: checks.value.attempt },
      actor_id: me,
    })

    await pipeline.refresh()
    emit('saved')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mc__scrim" @click.self="emit('close')">
    <aside class="mc">
      <div class="mc__hd">
        <div>
          <div class="mc__t display">Megacode Evaluation</div>
          <div class="mc__s">
            {{ candidate?.fullName ?? 'Pick a candidate' }} · examiner view — the candidate never sees this screen
          </div>
        </div>
        <button type="button" class="mc__x" @click="emit('close')"><X :size="17" :stroke-width="2" /></button>
      </div>

      <div class="mc__bd">
        <label v-if="!props.preselect" class="mc__fld">Candidate
          <select v-model="candidateId">
            <option value="" disabled>Pick a candidate…</option>
            <option v-for="p in people" :key="p.userId" :value="p.userId">{{ p.fullName }}</option>
          </select>
        </label>

        <label class="mc__fld">Scenario — picked by the examiner
          <select v-model="scenarioKey">
            <option value="" disabled>Pick a scenario…</option>
            <option v-for="s in MEGACODE_SCENARIOS" :key="s.key" :value="s.key">
              {{ s.no }} · {{ s.title }}
            </option>
          </select>
        </label>

        <!-- Examiner script -->
        <template v-if="scenario">
          <button type="button" class="mc__script-toggle" @click="scriptOpen = !scriptOpen">
            Examiner sheet — “{{ scenario.title }}”
            <span class="mc__script-sub">{{ scenario.summary }}</span>
            <ChevronDown class="mc__chev" :class="{ 'mc__chev--open': scriptOpen }" :size="14" :stroke-width="2" />
          </button>
          <div v-if="scriptOpen" class="mc__script">
            <div class="mc__sect">Dispatch &amp; presentation</div>
            <p class="mc__p">{{ scenario.dispatch }}</p>
            <template v-for="ph in scenario.phases" :key="ph.title">
              <div class="mc__sect">{{ ph.title }}</div>
              <div v-if="ph.vitals" class="mc__tablewrap">
                <table class="mc__vitals">
                  <thead>
                    <tr><th></th><th v-for="c in ph.vitals.cols" :key="c">{{ c }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in ph.vitals.rows" :key="r.label">
                      <td class="mc__vl">{{ r.label }}</td>
                      <td v-for="(c, i) in r.cells" :key="i">{{ c }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="mc__p"><b>Expected.</b> {{ ph.expected }}</p>
              <p v-if="ph.trigger" class="mc__trigger">{{ ph.trigger }}</p>
            </template>
            <div class="mc__sect">Branch at the next rhythm check</div>
            <p v-for="b in scenario.branches" :key="b.path" class="mc__p">
              <b>Path {{ b.path }}.</b> {{ b.text }}
            </p>
            <div class="mc__sect">Scoring</div>
            <p class="mc__p">{{ scenario.scoringNote }}</p>
            <div class="mc__sect">Prompts if stuck</div>
            <p class="mc__p">{{ scenario.prompts }}</p>
          </div>
        </template>

        <!-- The form -->
        <div class="mc__sect mc__sect--form">Section 1 — Arrest management <small>one point each</small></div>
        <label v-for="i in MEGACODE_SECTION1" :key="i.key" class="mc__check">
          <input v-model="checks.s1[i.key]" type="checkbox" />
          <span :class="{ 'mc__done': checks.s1[i.key] }">{{ i.label }}</span>
        </label>

        <div class="mc__sect mc__sect--form">Section 2 — Rhythm management <small>run at least three · identified AND treated per protocol</small></div>
        <label v-for="i in MEGACODE_RHYTHMS" :key="i.key" class="mc__check">
          <input v-model="checks.rhythms[i.key]" type="checkbox" />
          <span :class="{ 'mc__done': checks.rhythms[i.key] }">{{ i.label }}</span>
        </label>

        <div class="mc__sect mc__sect--form">Section 3 — Post-resuscitation <small>one point each</small></div>
        <label v-for="i in MEGACODE_SECTION3" :key="i.key" class="mc__check">
          <input v-model="checks.s3[i.key]" type="checkbox" />
          <span :class="{ 'mc__done': checks.s3[i.key] }">{{ i.label }}</span>
        </label>

        <div class="mc__sect mc__sect--form mc__sect--af">Automatic fail <small>any one = Unsuccessful regardless of score</small></div>
        <label v-for="i in MEGACODE_AUTOFAILS" :key="i.key" class="mc__check mc__check--af">
          <input v-model="checks.autofails[i.key]" type="checkbox" />
          <span :class="{ 'mc__failed': checks.autofails[i.key] }">{{ i.label }}</span>
        </label>

        <div class="mc__scorebar" :class="score.passed ? 'mc__scorebar--ok' : 'mc__scorebar--no'">
          <component :is="score.passed ? Check : AlertTriangle" :size="14" :stroke-width="2.5" />
          <b>{{ score.points }} / 12 minimum</b>
          <span v-if="score.autoFailed">· AUTOMATIC FAIL flagged</span>
          <span v-else-if="!score.s1Done">· Section 1 incomplete</span>
          <span v-else-if="score.rhythmCount < 3">· {{ 3 - score.rhythmCount }} more rhythm{{ 3 - score.rhythmCount === 1 ? '' : 's' }} needed</span>
          <span v-else-if="!score.s3Done">· Section 3 incomplete</span>
          <span v-else>· on track to pass</span>
        </div>

        <label class="mc__fld">Attempt
          <select v-model.number="checks.attempt">
            <option :value="1">1st</option>
            <option :value="2">2nd</option>
            <option :value="3">3rd</option>
          </select>
        </label>
        <label class="mc__fld">Comments
          <input v-model="comments" type="text" maxlength="400" placeholder="debrief notes for the record (optional)" />
        </label>

        <div class="mc__sect mc__sect--form">Signatures — on completion</div>
        <div class="mc__sig">
          <div class="mc__sig-l">Examiner — {{ auth.appUser?.fullName ?? 'Examiner' }}</div>
          <SignaturePad :height="84" @change="(d: string) => (examinerSig = d)" />
        </div>
        <div class="mc__sig">
          <div class="mc__sig-l">Candidate — {{ candidate?.fullName ?? '—' }}</div>
          <SignaturePad :height="84" @change="(d: string) => (candidateSig = d)" />
        </div>
        <p class="mc__note">
          The signed evaluation files to the employee's documents as a PDF; a pass writes the
          mega-code gate on their active transition and checks itself off on the credentialing
          checklist. An unsuccessful attempt stays on the record — re-evaluation per the Program Guide.
        </p>

        <div v-if="blockers.length" class="mc__blockers">
          <div v-for="b in blockers" :key="b" class="mc__blocker">
            <AlertTriangle :size="12" :stroke-width="2" /> {{ b }}
          </div>
        </div>
        <div v-if="error" class="mc__error">{{ error }}</div>
      </div>

      <div class="mc__ft">
        <button type="button" class="mc__go" :disabled="busy || blockers.length > 0" @click="save">
          {{ busy ? 'Filing…' : `Score & sign — ${score.passed ? 'Pass' : 'Unsuccessful'}` }}
        </button>
        <button type="button" class="mc__lnk" @click="emit('close')">Cancel</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.mc__scrim {
  position: fixed; inset: 0; z-index: 90;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex; justify-content: flex-end;
}
.mc {
  width: min(520px, 96vw); height: 100%;
  background: var(--color-surface);
  box-shadow: -12px 0 40px oklch(0.2 0.05 260 / 0.25);
  display: flex; flex-direction: column;
}
.mc__hd {
  display: flex; align-items: flex-start; gap: 10px;
  background: linear-gradient(180deg, var(--color-brand-800), var(--color-brand-950));
  color: #fff; padding: 14px 18px;
  border-bottom: 2px solid var(--color-accent-600, oklch(0.664 0.119 86.8));
}
.mc__t { font-size: 20px; }
.mc__s { font-size: 11.5px; color: oklch(0.8 0.035 250); margin-top: 2px; }
.mc__x { margin-left: auto; background: none; border: none; color: oklch(0.8 0.035 250); cursor: pointer; padding: 2px; }
.mc__x:hover { color: #fff; }
.mc__bd { padding: 14px 18px; overflow: auto; flex: 1; }
.mc__ft { padding: 12px 18px; border-top: 1px solid var(--color-line); display: flex; gap: 14px; align-items: center; }
.mc__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 7px;
  padding: 9px 16px; font-family: var(--font-sans); font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.mc__go:hover:not(:disabled) { background: var(--color-brand-700); }
.mc__go:disabled { opacity: 0.5; cursor: default; }
.mc__lnk {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-muted); font-size: 12px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.mc__fld { display: grid; gap: 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); margin: 8px 0; }
.mc__fld input, .mc__fld select {
  font-family: var(--font-sans); font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.mc__fld input:focus, .mc__fld select:focus { outline: none; border-color: var(--color-brand-600); }
.mc__script-toggle {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; width: 100%;
  margin: 10px 0 0; padding: 10px 12px; text-align: left; cursor: pointer;
  background: oklch(0.975 0.01 255); border: 1px solid var(--color-line); border-radius: 10px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-ink);
}
.mc__script-sub { font-weight: 500; font-size: 11px; color: var(--color-muted); }
.mc__chev { margin-left: auto; color: var(--color-muted); transition: transform 0.15s ease; flex-shrink: 0; align-self: center; }
.mc__chev--open { transform: rotate(180deg); }
.mc__script {
  border: 1px solid var(--color-line); border-top: 0; border-radius: 0 0 10px 10px;
  padding: 4px 12px 10px; background: var(--color-surface);
}
.mc__sect {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-muted); margin: 14px 0 6px;
}
.mc__sect small { font-weight: 500; letter-spacing: 0.01em; text-transform: none; font-size: 10.5px; }
.mc__sect--form { border-top: 1px solid var(--color-line-soft); padding-top: 10px; }
.mc__sect--af { color: oklch(0.5 0.16 30); }
.mc__p { font-size: 12px; line-height: 1.55; color: var(--color-ink-soft); margin: 4px 0; }
.mc__p b { color: var(--color-ink); }
.mc__trigger {
  font-size: 12px; line-height: 1.5; font-weight: 650; color: oklch(0.45 0.12 50);
  background: oklch(0.985 0.015 60); border: 1px solid oklch(0.87 0.06 60);
  border-radius: 8px; padding: 7px 10px; margin: 6px 0;
}
.mc__tablewrap { overflow-x: auto; margin: 4px 0; }
.mc__vitals { border-collapse: collapse; width: 100%; }
.mc__vitals th {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--color-muted); text-align: left; padding: 3px 8px 3px 0;
  border-bottom: 1px solid var(--color-line);
}
.mc__vitals td {
  font-size: 11.5px; color: var(--color-ink-soft); padding: 4px 8px 4px 0;
  border-bottom: 1px solid var(--color-line-soft); vertical-align: top;
}
.mc__vl { font-weight: 650; color: var(--color-ink); white-space: nowrap; }
.mc__check {
  display: flex; align-items: flex-start; gap: 9px; padding: 5px 0;
  font-size: 12.5px; color: var(--color-ink-soft); cursor: pointer;
  border-bottom: 1px solid var(--color-line-soft);
}
.mc__check:last-of-type { border-bottom: 0; }
.mc__check input { margin-top: 2px; accent-color: var(--color-brand-700); }
.mc__check--af input { accent-color: oklch(0.5 0.16 30); }
.mc__done { color: var(--color-ink); }
.mc__failed { color: oklch(0.5 0.16 30); font-weight: 650; }
.mc__scorebar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 12px 0 4px; padding: 9px 12px; border-radius: 9px;
  font-size: 12.5px; font-weight: 600;
}
.mc__scorebar--ok { background: var(--color-success-50, oklch(0.96 0.02 150)); color: var(--color-success-500); }
.mc__scorebar--no { background: oklch(0.985 0.015 60); color: oklch(0.45 0.12 50); border: 1px solid oklch(0.87 0.06 60); }
.mc__sig { margin: 8px 0 12px; }
.mc__sig-l { font-size: 11.5px; font-weight: 650; color: var(--color-ink-soft); margin-bottom: 5px; }
.mc__note { font-size: 11px; color: var(--color-muted); line-height: 1.5; margin: 8px 0; }
.mc__blockers { margin-top: 10px; display: grid; gap: 4px; }
.mc__blocker { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: oklch(0.5 0.13 45); }
.mc__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
</style>
