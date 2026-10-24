<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronDown, Check, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
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

/**
 * Megacode evaluation — the full-page runner, laid out like the paper
 * WCEMS Megacode Evaluation (Justin, 2026-10-23: no side drawers for
 * check-offs on desktop). The examiner sheet (scenario script + vitals)
 * sits ABOVE the form in its own panel — it is the examiner's script,
 * not part of the record. Scoring mirrors the paper form: all of
 * Sections 1 & 3, at least three rhythms, no automatic fail.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { clinicalPeople } = useClinical()
const pipeline = usePipeline()
const clindocs = useClinicalDocs()

const candidateId = ref(String(route.params.userId ?? ''))
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

function back() {
  if (window.history.length > 1) router.back()
  else void router.push('/clinical')
}

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
    back()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mr">
    <ClinicalNav :crumbs="['Megacode evaluation']" />
    <button type="button" class="mr__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Back
    </button>

    <!-- Examiner-only script: NOT part of the form — the candidate never reads this -->
    <div class="mr__exam">
      <div class="mr__exam-tag">Examiner's sheet — the candidate never sees this</div>
      <div class="mr__exam-grid">
        <label v-if="!route.params.userId" class="mr__fld">Candidate
          <select v-model="candidateId">
            <option value="" disabled>Pick a candidate…</option>
            <option v-for="p in people" :key="p.userId" :value="p.userId">{{ p.fullName }}</option>
          </select>
        </label>
        <label class="mr__fld">Scenario — picked by the examiner
          <select v-model="scenarioKey">
            <option value="" disabled>Pick a scenario…</option>
            <option v-for="s in MEGACODE_SCENARIOS" :key="s.key" :value="s.key">
              {{ s.no }} · {{ s.title }}
            </option>
          </select>
        </label>
      </div>

      <template v-if="scenario">
        <button type="button" class="mr__script-toggle" @click="scriptOpen = !scriptOpen">
          “{{ scenario.title }}”
          <span class="mr__script-sub">{{ scenario.summary }}</span>
          <ChevronDown class="mr__chev" :class="{ 'mr__chev--open': scriptOpen }" :size="14" :stroke-width="2" />
        </button>
        <div v-if="scriptOpen" class="mr__script">
          <div class="mr__sect">Dispatch &amp; presentation</div>
          <p class="mr__p">{{ scenario.dispatch }}</p>
          <template v-for="ph in scenario.phases" :key="ph.title">
            <div class="mr__sect">{{ ph.title }}</div>
            <div v-if="ph.vitals" class="mr__tablewrap">
              <table class="mr__vitals">
                <thead>
                  <tr><th></th><th v-for="c in ph.vitals.cols" :key="c">{{ c }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in ph.vitals.rows" :key="r.label">
                    <td class="mr__vl">{{ r.label }}</td>
                    <td v-for="(c, i) in r.cells" :key="i">{{ c }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mr__p"><b>Expected.</b> {{ ph.expected }}</p>
            <p v-if="ph.trigger" class="mr__trigger">{{ ph.trigger }}</p>
          </template>
          <div class="mr__sect">Branch at the next rhythm check</div>
          <p v-for="b in scenario.branches" :key="b.path" class="mr__p">
            <b>Path {{ b.path }}.</b> {{ b.text }}
          </p>
          <div class="mr__sect">Scoring</div>
          <p class="mr__p">{{ scenario.scoringNote }}</p>
          <div class="mr__sect">Prompts if stuck</div>
          <p class="mr__p">{{ scenario.prompts }}</p>
        </div>
      </template>
    </div>

    <!-- The evaluation form — mirrors the printed sheet -->
    <div class="mr__sheet">
      <header class="mr__lh">
        <img class="mr__crest" src="/wcems-patch.png" alt="" />
        <div class="mr__lh-mid">
          <div class="mr__org">WALLER COUNTY EMS</div>
          <h1 class="mr__form display">Megacode Evaluation</h1>
          <div class="mr__campaign">Credentialing examination — v1.0 evaluation form</div>
        </div>
        <div class="mr__formno">
          <span>ATTEMPT</span>
          <select v-model.number="checks.attempt" class="mr__attempt">
            <option :value="1">1st</option>
            <option :value="2">2nd</option>
            <option :value="3">3rd</option>
          </select>
        </div>
      </header>
      <div class="mr__rule" aria-hidden="true"></div>

      <div class="mr__meta">
        <div class="mr__mfld">
          <span class="mr__mlab">Candidate</span>
          <span class="mr__mval">{{ candidate?.fullName ?? '—' }}</span>
        </div>
        <div class="mr__mfld">
          <span class="mr__mlab">Credential</span>
          <span class="mr__mval">{{ candidate?.record.certLevel ?? '—' }}</span>
        </div>
        <div class="mr__mfld">
          <span class="mr__mlab">Examiner</span>
          <span class="mr__mval">{{ auth.appUser?.fullName }}</span>
        </div>
        <div class="mr__mfld">
          <span class="mr__mlab">Scenario</span>
          <span class="mr__mval">{{ scenario ? `${scenario.no} · ${scenario.title}` : '—' }}</span>
        </div>
      </div>

      <section class="mr__fsect">
        <h2 class="mr__secthead">Section 1 — Arrest management <small>one point each</small></h2>
        <label v-for="i in MEGACODE_SECTION1" :key="i.key" class="mr__crit">
          <input v-model="checks.s1[i.key]" type="checkbox" />
          <span class="mr__critlabel" :class="{ 'mr__critlabel--done': checks.s1[i.key] }">{{ i.label }}</span>
        </label>
      </section>

      <section class="mr__fsect">
        <h2 class="mr__secthead">Section 2 — Rhythm management <small>run at least three · identified AND treated per protocol</small></h2>
        <label v-for="i in MEGACODE_RHYTHMS" :key="i.key" class="mr__crit">
          <input v-model="checks.rhythms[i.key]" type="checkbox" />
          <span class="mr__critlabel" :class="{ 'mr__critlabel--done': checks.rhythms[i.key] }">{{ i.label }}</span>
        </label>
      </section>

      <section class="mr__fsect">
        <h2 class="mr__secthead">Section 3 — Post-resuscitation <small>one point each</small></h2>
        <label v-for="i in MEGACODE_SECTION3" :key="i.key" class="mr__crit">
          <input v-model="checks.s3[i.key]" type="checkbox" />
          <span class="mr__critlabel" :class="{ 'mr__critlabel--done': checks.s3[i.key] }">{{ i.label }}</span>
        </label>
      </section>

      <section class="mr__fsect">
        <h2 class="mr__secthead mr__secthead--af">Automatic fail <small>any one = Unsuccessful regardless of score</small></h2>
        <label v-for="i in MEGACODE_AUTOFAILS" :key="i.key" class="mr__crit mr__crit--af">
          <input v-model="checks.autofails[i.key]" type="checkbox" />
          <span class="mr__critlabel" :class="{ 'mr__failed': checks.autofails[i.key] }">{{ i.label }}</span>
        </label>
      </section>

      <div class="mr__result" :class="score.passed ? 'mr__result--ok' : 'mr__result--warn'">
        <component :is="score.passed ? Check : AlertTriangle" :size="15" :stroke-width="2.5" />
        <b>{{ score.points }} / 12 minimum</b>
        <span v-if="score.autoFailed">· AUTOMATIC FAIL flagged</span>
        <span v-else-if="!score.s1Done">· Section 1 incomplete</span>
        <span v-else-if="score.rhythmCount < 3">· {{ 3 - score.rhythmCount }} more rhythm{{ 3 - score.rhythmCount === 1 ? '' : 's' }} needed</span>
        <span v-else-if="!score.s3Done">· Section 3 incomplete</span>
        <span v-else>· on track to pass</span>
      </div>

      <label class="mr__notefld">
        <span class="mr__mlab">Comments</span>
        <input v-model="comments" type="text" maxlength="400" placeholder="debrief notes for the record (optional)" />
      </label>

      <div class="mr__sigs">
        <div>
          <SignaturePad :height="96" @change="(d: string) => (examinerSig = d)" />
          <div class="mr__sigline">Examiner — {{ auth.appUser?.fullName ?? 'Examiner' }}</div>
        </div>
        <div>
          <SignaturePad :height="96" @change="(d: string) => (candidateSig = d)" />
          <div class="mr__sigline">Candidate — {{ candidate?.fullName ?? '—' }}</div>
        </div>
      </div>

      <p class="mr__filing">
        The signed evaluation files to the employee's documents as a PDF; a pass writes the
        mega-code gate on their active transition and checks itself off on the credentialing
        checklist. An unsuccessful attempt stays on the record — re-evaluation per the Program Guide.
      </p>
    </div>

    <div v-if="blockers.length" class="mr__blockers">
      <div v-for="b in blockers" :key="b" class="mr__blocker">
        <AlertTriangle :size="12" :stroke-width="2" /> {{ b }}
      </div>
    </div>
    <div v-if="error" class="mr__error">{{ error }}</div>

    <div class="mr__actions">
      <button type="button" class="mr__go" :disabled="busy || blockers.length > 0" @click="save">
        {{ busy ? 'Filing…' : `Score & sign — ${score.passed ? 'Pass' : 'Unsuccessful'}` }}
      </button>
      <button type="button" class="mr__cancel" @click="back">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.mr { max-width: 880px; margin: 0 auto; padding: 20px 16px 110px; }
@media (min-width: 768px) { .mr { padding: 24px 32px 80px; } }
.mr__back {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none; border: none; padding: 0;
  margin-bottom: 14px; cursor: pointer;
}

/* ── Examiner script panel (not part of the form) ── */
.mr__exam {
  border: 1px solid oklch(0.87 0.06 60); border-radius: 10px;
  background: oklch(0.985 0.015 60); padding: 12px 14px; margin-bottom: 18px;
}
.mr__exam-tag {
  font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
  color: oklch(0.45 0.12 50); margin-bottom: 8px;
}
.mr__exam-grid { display: grid; gap: 10px; }
@media (min-width: 640px) { .mr__exam-grid { grid-template-columns: 1fr 1fr; } }
.mr__fld { display: grid; gap: 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); }
.mr__fld select {
  font-family: var(--font-sans); font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.mr__script-toggle {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; width: 100%;
  margin: 10px 0 0; padding: 9px 12px; text-align: left; cursor: pointer;
  background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 9px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-ink);
}
.mr__script-sub { font-weight: 500; font-size: 11px; color: var(--color-muted); }
.mr__chev { margin-left: auto; color: var(--color-muted); transition: transform 0.15s ease; flex-shrink: 0; align-self: center; }
.mr__chev--open { transform: rotate(180deg); }
.mr__script {
  border: 1px solid var(--color-line); border-top: 0; border-radius: 0 0 9px 9px;
  padding: 4px 12px 10px; background: var(--color-surface);
}
.mr__sect {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-muted); margin: 12px 0 5px;
}
.mr__p { font-size: 12px; line-height: 1.55; color: var(--color-ink-soft); margin: 4px 0; }
.mr__p b { color: var(--color-ink); }
.mr__trigger {
  font-size: 12px; line-height: 1.5; font-weight: 650; color: oklch(0.45 0.12 50);
  background: oklch(0.985 0.015 60); border: 1px solid oklch(0.87 0.06 60);
  border-radius: 8px; padding: 7px 10px; margin: 6px 0;
}
.mr__tablewrap { overflow-x: auto; margin: 4px 0; }
.mr__vitals { border-collapse: collapse; width: 100%; }
.mr__vitals th {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--color-muted); text-align: left; padding: 3px 8px 3px 0;
  border-bottom: 1px solid var(--color-line);
}
.mr__vitals td {
  font-size: 11.5px; color: var(--color-ink-soft); padding: 4px 8px 4px 0;
  border-bottom: 1px solid var(--color-line-soft); vertical-align: top;
}
.mr__vl { font-weight: 650; color: var(--color-ink); white-space: nowrap; }

/* ── The paper sheet ── */
.mr__sheet {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.06), 0 14px 40px oklch(0.2 0.03 260 / 0.08);
  padding: 26px 26px 30px;
}
@media (min-width: 768px) { .mr__sheet { padding: 38px 48px 44px; } }
.mr__lh { display: flex; align-items: center; gap: 16px; }
.mr__crest { width: 58px; height: auto; flex-shrink: 0; }
.mr__lh-mid { flex: 1; min-width: 0; text-align: center; }
.mr__org {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.22em;
  color: var(--color-accent-strong, #a8842c);
}
.mr__form { font-size: clamp(21px, 4.5vw, 30px); line-height: 1.12; color: var(--color-ink); margin: 3px 0 2px; }
.mr__campaign { font-size: 11px; color: var(--color-muted); }
.mr__formno {
  flex-shrink: 0; text-align: right; display: grid; gap: 2px; justify-items: end;
  font-size: 9px; font-weight: 800; letter-spacing: 0.14em; color: var(--color-muted);
}
.mr__attempt {
  font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: var(--color-ink);
  border: 1px solid var(--color-line); border-radius: 6px; padding: 3px 6px; background: var(--color-surface);
}
.mr__rule {
  height: 0; margin: 14px 0 18px;
  border-top: 2.5px solid var(--color-brand-900);
  border-bottom: 1px solid var(--color-accent-strong, #a8842c);
  padding-top: 2px;
}
.mr__meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 22px; margin-bottom: 14px; }
@media (min-width: 768px) { .mr__meta { grid-template-columns: repeat(4, 1fr); } }
.mr__mfld { display: grid; gap: 3px; border-bottom: 1px solid var(--color-ink-soft); padding-bottom: 4px; }
.mr__mlab { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); }
.mr__mval { font-size: 13px; font-weight: 700; color: var(--color-ink); }

.mr__fsect { margin-top: 16px; }
.mr__secthead {
  font-size: 11px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-brand-900); margin: 0 0 4px;
  display: flex; align-items: baseline; gap: 10px;
}
.mr__secthead::after { content: ''; flex: 1; height: 1px; background: var(--color-line); align-self: center; }
.mr__secthead small { font-weight: 500; letter-spacing: 0.01em; text-transform: none; font-size: 10.5px; color: var(--color-muted); }
.mr__secthead--af { color: oklch(0.5 0.16 30); }
.mr__crit {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 2px; cursor: pointer;
  border-bottom: 1px dotted var(--color-line);
  font-size: 13px; line-height: 1.45; color: var(--color-ink-soft);
}
.mr__crit:last-of-type { border-bottom: 0; }
.mr__crit input { margin-top: 3px; width: 15px; height: 15px; accent-color: var(--color-brand-800); flex-shrink: 0; }
.mr__crit--af input { accent-color: oklch(0.5 0.16 30); }
.mr__critlabel--done { color: var(--color-ink); }
.mr__failed { color: oklch(0.5 0.16 30); font-weight: 650; }

.mr__result {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  margin: 20px 0 6px; padding: 10px 14px; border-radius: 8px; font-size: 13px;
}
.mr__result--ok { background: var(--color-success-50, oklch(0.96 0.02 150)); color: var(--color-success-500); border: 1px solid oklch(0.85 0.06 150); }
.mr__result--warn { background: oklch(0.985 0.015 60); color: oklch(0.45 0.12 50); border: 1px solid oklch(0.87 0.06 60); }

.mr__notefld { display: grid; gap: 4px; margin: 10px 0 4px; }
.mr__notefld input {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 0; border-bottom: 1px solid var(--color-ink-soft); border-radius: 0;
  background: none; padding: 4px 2px;
}
.mr__notefld input:focus { outline: none; border-bottom-color: var(--color-brand-700); }

.mr__sigs { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 22px; }
@media (min-width: 640px) { .mr__sigs { grid-template-columns: 1fr 1fr; gap: 28px; } }
.mr__sigline {
  margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--color-ink-soft);
  font-size: 11px; font-weight: 650; color: var(--color-ink-soft);
}
.mr__filing { font-size: 11px; color: var(--color-muted); line-height: 1.5; margin: 16px 0 0; }

.mr__blockers { margin-top: 14px; display: grid; gap: 4px; }
.mr__blocker { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: oklch(0.5 0.13 45); }
.mr__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
.mr__actions { display: flex; gap: 16px; align-items: center; margin-top: 16px; }
@media (max-width: 639px) {
  .mr__actions {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    margin: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: var(--color-surface); border-top: 1px solid var(--color-line);
    box-shadow: 0 -8px 24px oklch(0.2 0.03 260 / 0.08);
  }
}
.mr__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 8px;
  padding: 11px 20px; font-family: var(--font-sans); font-size: 13px; font-weight: 700; cursor: pointer;
}
.mr__go:hover:not(:disabled) { background: var(--color-brand-700); }
.mr__go:disabled { opacity: 0.5; cursor: default; }
.mr__cancel {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-muted); font-size: 12.5px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
</style>
