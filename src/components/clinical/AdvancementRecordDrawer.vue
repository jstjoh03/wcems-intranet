<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { X, Check, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useClinical } from '@/composables/useClinical'
import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useAuthStore } from '@/stores/auth'
import { gateItemsFor } from '@/constants/pipelineGates'
import { generateAdvancementRecordPdf, type AdvancementCertLine } from '@/lib/advancementRecordPdf'
import { supabase } from '@/lib/supabase'
import type { FtepTimeline } from '@/composables/useFtepTimeline'
import type { PipelinePerson } from '@/types'

/**
 * Phase Advancement Record — the Program Guide's paper form run
 * digitally at the moment of advancement. Four certifications of
 * completion (the computable ones verify themselves and show their
 * evidence; the paper-world ones the CDO certifies by hand), any
 * one-time documented exception (ftep_rule_waivers — the program rule
 * itself is unchanged), the next phase's start + FTO, and the
 * employee + FTO signatures on this device. Saving signs as the CDO:
 * it closes the phase, opens the next, files the PDF to the employee's
 * documents, logs a clinical event, and — when the FTO changes for the
 * final evaluation — sends the trainee their Evaluation of FTO.
 */

const props = defineProps<{
  person: PipelinePerson
  timeline: FtepTimeline | null
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const auth = useAuthStore()
const { gatesFor, gateStatsFor, clinicalPeople, ftepTrackFor } = useClinical()
const pipeline = usePipeline()
const ftep = useFtep()
const clindocs = useClinicalDocs()

const todayIso = new Date().toISOString().slice(0, 10)

/* ── The move ───────────────────────────────────────────────────────── */

const cur = computed(() => props.timeline?.phases.find((p) => p.status === 'current') ?? null)
const next = computed(() => {
  const tl = props.timeline
  if (!tl || !cur.value) return null
  const idx = tl.phases.findIndex((p) => p.key === cur.value!.key)
  return tl.phases[idx + 1] ?? null
})
const isFinalClose = computed(() => !!cur.value && cur.value.key === props.timeline?.finalPhaseKey)
const nextIsFinal = computed(() => !!next.value && next.value.key === props.timeline?.finalPhaseKey)

const effectiveDate = ref(todayIso)
const nextStartDate = ref('')
const note = ref('')

onMounted(() => {
  nextStartDate.value = props.timeline?.upcoming[0]?.dateIso ?? todayIso
})

/* ── Certifications of completion ───────────────────────────────────── */

const floor = computed(() => (props.timeline?.transition === 'P1_P2' ? 4.0 : 3.5))

const dorEvidence = computed(() => {
  const c = cur.value
  if (!c) return { ok: false, text: 'no phase in progress' }
  const days = c.days.filter((d) => d.counts && !d.future)
  const missing = days.filter((d) => d.dor !== 'submitted')
  const avg = ftep.dorRollingAverage(props.person.userId, ftepTrackFor(props.person)?.dorWindow ?? 4)
  const parts = [`${days.length - missing.length} of ${days.length} days`]
  if (avg !== null) parts.push(`avg ${avg.toFixed(2)}`)
  if (missing.length) parts.push(`${missing.length} missing`)
  if (avg !== null && avg < floor.value) parts.push(`below ${floor.value} floor`)
  return {
    ok: days.length > 0 && missing.length === 0 && avg !== null && avg >= floor.value,
    text: parts.join(' · '),
  }
})

const gateEvidence = computed(() => {
  const items = gateItemsFor(
    props.person.record,
    gatesFor(props.person.record.id),
    gateStatsFor(props.person),
  )
  const done = items.filter((i) => i.status === 'complete' || i.status === 'na').length
  return {
    ok: items.length > 0 && done === items.length,
    text: `${done} of ${items.length} documented`,
  }
})

const lastDor = computed(() => ftep.lastDorDate(props.person.userId))

interface CertRow {
  key: 'dors' | 'gates' | 'workbook' | 'recommendation'
  label: string
  auto: boolean | null // null = not computable, CDO certifies by hand
  evidenceAuto: string
  hint?: string
}
const certRows = computed<CertRow[]>(() => [
  {
    key: 'dors',
    label: 'A DOR is on file for every training day, each meeting the passing standard',
    auto: dorEvidence.value.ok,
    evidenceAuto: dorEvidence.value.text,
  },
  {
    key: 'gates',
    label: 'All gate requirements completed & documented to date',
    auto: gateEvidence.value.ok,
    evidenceAuto: gateEvidence.value.text,
    hint: isFinalClose.value
      ? 'closing the program — every gate must be documented'
      : 'mid-program phases certify what is documented so far',
  },
  {
    key: 'workbook',
    label: 'Phase objectives & workbook tasks signed off',
    auto: null,
    evidenceAuto: props.person.record.ftoName ? `FTO ${props.person.record.ftoName}` : '',
  },
  {
    key: 'recommendation',
    label: 'Transition recommendation documented & filed',
    auto: null,
    evidenceAuto: lastDor.value ? `latest DOR ${fmt(lastDor.value)}` : '',
  },
])

const checked = ref<Record<string, boolean>>({})
const evidence = ref<Record<string, string>>({})
onMounted(() => {
  for (const c of certRows.value) {
    checked.value[c.key] = c.auto === true
    evidence.value[c.key] = c.evidenceAuto
  }
})

const allCertified = computed(() => certRows.value.every((c) => checked.value[c.key]))

/* ── Rules: day minimum + different final FTO ───────────────────────── */

const belowMin = computed(() => {
  const c = cur.value
  if (!c?.standard) return null
  const counted = c.days.filter((d) => d.counts && !d.future).length
  return counted < c.standard.min ? { counted, min: c.standard.min } : null
})
const dayWaiverReason = ref('')

const ftoOptions = computed(() => {
  const opts = clinicalPeople.value
    .filter((p) => p.record.isFto && p.userId !== props.person.userId)
    .map((p) => ({ userId: p.userId, name: p.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return opts
})
const usedFtos = computed(() => props.timeline?.ftosUsed ?? [])
function ftoUsed(name: string): boolean {
  return usedFtos.value.some((u) => u.toLowerCase() === name.toLowerCase())
}
const nextFtoPick = ref('') // userId or '__other'
const nextFtoCustom = ref('')
const ftoWaiverOpen = ref(false)
const ftoWaiverReason = ref('')

const nextFtoName = computed(() => {
  if (nextFtoPick.value === '__other') return nextFtoCustom.value.trim()
  return ftoOptions.value.find((o) => o.userId === nextFtoPick.value)?.name ?? ''
})

const ftoRuleBlocked = computed(
  () =>
    nextIsFinal.value &&
    !!nextFtoName.value &&
    ftoUsed(nextFtoName.value) &&
    !ftoWaiverReason.value.trim(),
)

/* ── Signatures ─────────────────────────────────────────────────────── */

const empSig = ref<string | null>(null)
const ftoSig = ref<string | null>(null)

/* ── Save ───────────────────────────────────────────────────────────── */

const busy = ref(false)
const error = ref<string | null>(null)

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (!cur.value) out.push('No phase is currently in progress.')
  if (!allCertified.value) out.push('All four certifications must be checked (or documented and checked by you).')
  if (belowMin.value && !dayWaiverReason.value.trim())
    out.push(`Below the ${belowMin.value.min}-day minimum (${belowMin.value.counted} counted) — document the exception.`)
  if (!isFinalClose.value) {
    if (!nextStartDate.value) out.push(`Set the ${next.value?.label ?? 'next phase'} start date.`)
    if (!nextFtoName.value) out.push('Pick the next phase’s FTO.')
    if (ftoRuleBlocked.value)
      out.push(`${nextFtoName.value} has already trained this employee — the Final Evaluation needs a different FTO, or waive the rule with a reason.`)
  }
  if (!empSig.value) out.push('Employee signature required (sign on this device).')
  return out
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function save() {
  if (busy.value || blockers.value.length || !cur.value) return
  if (auth.usingDevStub) {
    error.value = 'Not available in dev mode.'
    return
  }
  busy.value = true
  error.value = null
  try {
    const recordId = props.person.record.id
    const me = auth.appUser?.id
    if (!me) throw new Error('Not signed in.')

    /* 1 — documented exceptions */
    const waivers: { rule: string; reason: string }[] = []
    let waiverId: string | null = null
    async function fileWaiver(ruleKey: string, ruleLabel: string, reason: string) {
      const { data, error: wErr } = await supabase
        .from('ftep_rule_waivers')
        .insert({ record_id: recordId, rule_key: ruleKey, reason, waived_by: me })
        .select('id')
        .single()
      if (wErr) throw new Error(wErr.message)
      waivers.push({ rule: ruleLabel, reason })
      if (!waiverId) waiverId = data.id as string
    }
    if (belowMin.value && dayWaiverReason.value.trim())
      await fileWaiver(
        'phase_day_min',
        `${cur.value.label} closed below the ${belowMin.value.min}-day minimum (${belowMin.value.counted} counted)`,
        dayWaiverReason.value.trim(),
      )
    if (nextIsFinal.value && nextFtoName.value && ftoUsed(nextFtoName.value) && ftoWaiverReason.value.trim())
      await fileWaiver(
        'final_fto_different',
        `Final Evaluation runs with ${nextFtoName.value}, who has trained this employee`,
        ftoWaiverReason.value.trim(),
      )

    /* 2 — the record itself */
    const certsSnapshot = Object.fromEntries(
      certRows.value.map((c) => [
        c.key,
        {
          label: c.label,
          checked: !!checked.value[c.key],
          auto: c.auto,
          evidence: (evidence.value[c.key] ?? '').trim(),
        },
      ]),
    )
    const nextFtoUserId =
      nextFtoPick.value && nextFtoPick.value !== '__other' ? nextFtoPick.value : null
    const { data: adv, error: aErr } = await supabase
      .from('ftep_advancement_records')
      .insert({
        record_id: recordId,
        from_phase_key: cur.value.key,
        to_phase_key: isFinalClose.value ? null : (next.value?.key ?? null),
        effective_date: effectiveDate.value,
        next_start_date: isFinalClose.value ? null : nextStartDate.value,
        next_fto_user_id: isFinalClose.value ? null : nextFtoUserId,
        next_fto_name: isFinalClose.value ? null : nextFtoName.value || null,
        certs: certsSnapshot,
        waiver_id: waiverId,
        employee_signature: empSig.value,
        fto_signature: ftoSig.value,
        cdo_user_id: me,
        note: note.value.trim() || null,
      })
      .select('id')
      .single()
    if (aErr) throw new Error(aErr.message)

    /* 3 — close the phase, open the next */
    const closingFto = cur.value.ftoName ?? props.person.record.ftoName ?? null
    await pipeline.setPhaseProgress(recordId, cur.value.key, { completedAt: effectiveDate.value })
    if (!isFinalClose.value && next.value) {
      await pipeline.setPhaseProgress(recordId, next.value.key, {
        startedAt: nextStartDate.value,
        ftoUserId: nextFtoUserId,
        ftoName: nextFtoName.value || null,
      })
      if (nextFtoName.value && nextFtoName.value !== props.person.record.ftoName)
        await pipeline.saveRecord({ userId: props.person.userId, ftoName: nextFtoName.value })
    }

    /* 4 — FTO change into the final evaluation → the trainee owes an
       Evaluation of FTO for the FTO they just finished with */
    if (
      nextIsFinal.value &&
      closingFto &&
      nextFtoName.value &&
      closingFto.toLowerCase() !== nextFtoName.value.toLowerCase()
    ) {
      const { data: req } = await supabase
        .from('ftep_fto_eval_requests')
        .upsert(
          {
            trainee_user_id: props.person.userId,
            fto_name: closingFto,
            phase_label: `${cur.value.label} — completed ${fmt(effectiveDate.value)}`,
            reason: 'fto_change',
            dedup_key: `adv:${adv.id}`,
            created_by: me,
          },
          { onConflict: 'dedup_key' },
        )
        .select('id')
        .single()
      if (req?.id) {
        void supabase.functions.invoke('sched-notify', {
          body: { kind: 'clinical_fto_eval_request', requestId: req.id },
        })
      }
    }

    /* 5 — the PDF into the employee file */
    try {
      const doc = await generateAdvancementRecordPdf({
        traineeName: props.person.fullName,
        certLevel: props.person.record.certLevel ?? '',
        programLabel:
          props.timeline?.transition === 'P1_P2'
            ? `P1 -> P2${props.timeline.accelerated ? ' (accelerated)' : ''}`
            : 'P1C -> P1',
        fromPhaseLabel: cur.value.label,
        toPhaseLabel: isFinalClose.value ? null : (next.value?.label ?? null),
        effectiveDate: effectiveDate.value,
        certs: certRows.value.map<AdvancementCertLine>((c) => ({
          label: c.label,
          checked: !!checked.value[c.key],
          evidence: (evidence.value[c.key] ?? '').trim(),
        })),
        waivers,
        nextStartDate: isFinalClose.value ? null : nextStartDate.value,
        nextFtoName: isFinalClose.value ? null : nextFtoName.value || null,
        note: note.value,
        employeeSignature: empSig.value,
        ftoSignature: ftoSig.value,
        ftoName: closingFto,
        cdoName: auth.appUser?.fullName ?? 'Clinical Development Officer',
      })
      const safe = props.person.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
      const name = `WCEMS_Phase_Advancement_${safe}_${effectiveDate.value}.pdf`
      const blob = doc.output('blob') as Blob
      await clindocs.upload({
        userId: props.person.userId,
        folder: 'generated',
        file: new File([blob], name, { type: 'application/pdf' }),
        employeeVisible: true,
        note: `${cur.value.label} -> ${isFinalClose.value ? 'program complete' : next.value?.label}`,
      })
    } catch (e) {
      console.error('[advancement] PDF filing failed:', e)
    }

    /* 6 — the activity timeline */
    await supabase.from('clinical_events').insert({
      user_id: props.person.userId,
      kind: 'phase_advanced',
      summary: isFinalClose.value
        ? `${cur.value.label} closed — program complete (Advancement Record on file)`
        : `${cur.value.label} -> ${next.value?.label} (Advancement Record on file)`,
      detail: { advancementId: adv.id, effectiveDate: effectiveDate.value },
      actor_id: me,
    })

    emit('saved')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ad__scrim" @click.self="emit('close')">
    <aside class="ad">
      <div class="ad__hd">
        <div>
          <div class="ad__t display">Phase Advancement Record</div>
          <div class="ad__s">
            {{ person.fullName }} ·
            {{ cur?.label ?? '—' }} → {{ isFinalClose ? 'program complete' : (next?.label ?? '—') }}
          </div>
        </div>
        <button type="button" class="ad__x" @click="emit('close')"><X :size="17" :stroke-width="2" /></button>
      </div>

      <div class="ad__bd">
        <div v-if="!timeline || !cur" class="ad__note">
          No phase is currently in progress — anchor a phase start first (Actions → Edit phases &amp; days).
        </div>

        <template v-else>
          <label class="ad__fld">Effective date
            <input v-model="effectiveDate" type="date" />
          </label>

          <div class="ad__sect">Certification of completion</div>
          <div v-for="c in certRows" :key="c.key" class="ad__cert">
            <label class="ad__cert-main">
              <input v-model="checked[c.key]" type="checkbox" />
              <span class="ad__cert-label" :class="{ 'ad__ok': checked[c.key] }">{{ c.label }}</span>
            </label>
            <div class="ad__cert-ev">
              <span v-if="c.auto !== null" class="ad__auto" :class="c.auto ? 'ad__ok' : 'ad__warn'">
                <component :is="c.auto ? Check : AlertTriangle" :size="11" :stroke-width="2.5" />
                {{ c.evidenceAuto }} · auto
              </span>
              <input
                v-else
                v-model="evidence[c.key]"
                type="text"
                maxlength="120"
                placeholder="Evidence — e.g. FTO signed Oct 18 / DOR #14"
              />
              <span v-if="c.hint" class="ad__hint">{{ c.hint }}</span>
            </div>
          </div>
          <p class="ad__note">
            The four certifications from the paper record — the computable ones verify themselves
            and show their evidence; checking a row certifies it over your signature.
          </p>

          <div v-if="belowMin" class="ad__waive">
            <div class="ad__waive-hd">
              <AlertTriangle :size="13" :stroke-width="2" />
              {{ cur.label }} is below the {{ belowMin.min }}-day minimum ({{ belowMin.counted }} counted)
            </div>
            <input
              v-model="dayWaiverReason"
              type="text"
              maxlength="200"
              placeholder="Exception reason — files on the record (required to advance)"
            />
          </div>

          <template v-if="!isFinalClose">
            <div class="ad__sect">{{ next?.label }} opens</div>
            <label class="ad__fld">Start date
              <input v-model="nextStartDate" type="date" />
            </label>
            <label class="ad__fld">
              Field Training Officer
              <small v-if="nextIsFinal" class="ad__hint">— must differ from the earlier phases</small>
              <select v-model="nextFtoPick">
                <option value="" disabled>Pick an FTO…</option>
                <option
                  v-for="o in ftoOptions"
                  :key="o.userId"
                  :value="o.userId"
                  :disabled="nextIsFinal && ftoUsed(o.name) && !ftoWaiverReason.trim()"
                >
                  {{ o.name }}{{ nextIsFinal && ftoUsed(o.name) ? ' — used in earlier phases' : '' }}
                </option>
                <option value="__other">Other (type a name)…</option>
              </select>
            </label>
            <label v-if="nextFtoPick === '__other'" class="ad__fld">FTO name
              <input v-model="nextFtoCustom" type="text" maxlength="80" placeholder="e.g. J. Cates" />
            </label>
            <template v-if="nextIsFinal">
              <button v-if="!ftoWaiverOpen" type="button" class="ad__lnk" @click="ftoWaiverOpen = true">
                No different FTO available? Waive the rule for this advancement
              </button>
              <div v-else class="ad__waive">
                <input
                  v-model="ftoWaiverReason"
                  type="text"
                  maxlength="200"
                  placeholder="Exception reason — e.g. only one FTO available on A shift this period"
                />
                <p class="ad__hint" style="margin: 4px 0 0">
                  One-time, documented exception on <b>this</b> Advancement Record only — the
                  program rule is unchanged. Used FTOs become selectable once a reason is given.
                </p>
              </div>
            </template>
          </template>
          <div v-else class="ad__note">
            This closes the program's final phase. Credentialing (effective date, signed form,
            badge) runs from the employee's file — the sign-off package is already on their gates.
          </div>

          <label class="ad__fld">Note (optional)
            <input v-model="note" type="text" maxlength="300" placeholder="anything the record should carry" />
          </label>

          <div class="ad__sect">Signatures</div>
          <div class="ad__sig">
            <div class="ad__sig-l">Employee — {{ person.fullName }} · sign on this device</div>
            <SignaturePad :height="90" @change="(d: string) => (empSig = d)" />
          </div>
          <div class="ad__sig">
            <div class="ad__sig-l">
              Field Training Officer — {{ cur.ftoName ?? person.record.ftoName ?? 'FTO' }}
              <span class="ad__hint">· optional here — collect on the printed copy if absent</span>
            </div>
            <SignaturePad :height="90" @change="(d: string) => (ftoSig = d)" />
          </div>
          <p class="ad__note">
            Your save signs as CDO. The finished record files to the employee's documents as a PDF;
            the phase closes{{ isFinalClose ? '' : ' and ' + (next?.label ?? 'the next phase') + ' opens on its start date' }}.
            <template v-if="nextIsFinal">An FTO change also sends the trainee their <b>Evaluation of FTO</b> — it files to Clinical, never to the FTO.</template>
          </p>

          <div v-if="blockers.length" class="ad__blockers">
            <div v-for="b in blockers" :key="b" class="ad__blocker">
              <AlertTriangle :size="12" :stroke-width="2" /> {{ b }}
            </div>
          </div>
          <div v-if="error" class="ad__error">{{ error }}</div>
        </template>
      </div>

      <div class="ad__ft">
        <button
          type="button"
          class="ad__go"
          :disabled="busy || blockers.length > 0"
          @click="save"
        >
          {{ busy ? 'Filing…' : 'Sign as CDO & advance' }}
        </button>
        <button type="button" class="ad__lnk ad__lnk--mut" @click="emit('close')">Cancel</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.ad__scrim {
  position: fixed; inset: 0; z-index: 90;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex; justify-content: flex-end;
}
.ad {
  width: min(480px, 96vw); height: 100%;
  background: var(--color-surface);
  box-shadow: -12px 0 40px oklch(0.2 0.05 260 / 0.25);
  display: flex; flex-direction: column;
}
.ad__hd {
  display: flex; align-items: flex-start; gap: 10px;
  background: linear-gradient(180deg, var(--color-brand-800), var(--color-brand-950));
  color: #fff; padding: 14px 18px;
  border-bottom: 2px solid var(--color-accent-600, oklch(0.664 0.119 86.8));
}
.ad__t { font-size: 20px; }
.ad__s { font-size: 11.5px; color: oklch(0.8 0.035 250); margin-top: 2px; }
.ad__x {
  margin-left: auto; background: none; border: none; color: oklch(0.8 0.035 250);
  cursor: pointer; padding: 2px;
}
.ad__x:hover { color: #fff; }
.ad__bd { padding: 14px 18px; overflow: auto; flex: 1; }
.ad__ft {
  padding: 12px 18px; border-top: 1px solid var(--color-line);
  display: flex; gap: 14px; align-items: center;
}
.ad__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 7px;
  padding: 9px 16px; font-family: var(--font-sans); font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.ad__go:hover:not(:disabled) { background: var(--color-brand-700); }
.ad__go:disabled { opacity: 0.5; cursor: default; }
.ad__lnk {
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
  font-family: var(--font-sans); color: var(--color-brand-600); font-size: 12px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.ad__lnk--mut { color: var(--color-muted); }
.ad__sect {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); margin: 16px 0 8px;
}
.ad__sect::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.ad__fld {
  display: grid; gap: 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); margin: 8px 0;
}
.ad__fld input, .ad__fld select {
  font-family: var(--font-sans); font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.ad__fld input:focus, .ad__fld select:focus { outline: none; border-color: var(--color-brand-600); }
.ad__cert { padding: 6px 0; border-bottom: 1px solid var(--color-line-soft); }
.ad__cert:last-of-type { border-bottom: 0; }
.ad__cert-main { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
.ad__cert-main input { margin-top: 2px; accent-color: var(--color-brand-700); }
.ad__cert-label { font-size: 12.5px; color: var(--color-ink-soft); line-height: 1.4; }
.ad__cert-label.ad__ok { color: var(--color-ink); }
.ad__cert-ev { margin: 4px 0 0 24px; display: flex; flex-direction: column; gap: 3px; }
.ad__cert-ev input {
  font-family: var(--font-sans); font-size: 11.5px; padding: 5px 8px;
  border: 1px solid var(--color-line); border-radius: 6px;
  background: var(--color-surface); color: var(--color-ink);
}
.ad__cert-ev input:focus { outline: none; border-color: var(--color-brand-600); }
.ad__auto { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 650; }
.ad__ok { color: var(--color-success-500); }
.ad__warn { color: oklch(0.55 0.13 60); }
.ad__hint { font-size: 10.5px; color: var(--color-muted); font-weight: 500; }
.ad__note { font-size: 11px; color: var(--color-muted); line-height: 1.5; margin: 8px 0; }
.ad__waive {
  border: 1px solid oklch(0.87 0.06 60); background: oklch(0.985 0.015 60);
  border-radius: 9px; padding: 9px 11px; margin: 10px 0; display: grid; gap: 6px;
}
.ad__waive-hd {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 700; color: oklch(0.45 0.12 50);
}
.ad__waive input {
  font-family: var(--font-sans); font-size: 12px; padding: 6px 9px;
  border: 1px solid oklch(0.85 0.08 60); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.ad__waive input:focus { outline: none; border-color: var(--color-brand-600); }
.ad__sig { margin: 8px 0 12px; }
.ad__sig-l { font-size: 11.5px; font-weight: 650; color: var(--color-ink-soft); margin-bottom: 5px; }
.ad__blockers { margin-top: 10px; display: grid; gap: 4px; }
.ad__blocker {
  display: flex; align-items: center; gap: 7px;
  font-size: 11.5px; font-weight: 600; color: oklch(0.5 0.13 45);
}
.ad__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
</style>
