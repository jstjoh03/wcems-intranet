<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useClinicalEvents } from '@/composables/useClinicalEvents'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { useProtocolSkills, type ProtocolSkillVerification } from '@/composables/useProtocolSkills'
import { generateProtocolSkillVerificationPdf } from '@/lib/protocolSkillPdf'

/**
 * Protocol skill check-off — the full-page runner, laid out like the
 * paper verification form (Justin, 2026-10-23: no side drawers for
 * check-offs on desktop). The letterhead sheet mirrors the printed
 * blank: criteria with check boxes, result, and the dual signature
 * block at the foot. Works the same on phone and iPad — the sheet
 * just narrows.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { ready: clinReady, clinicalPeople, canEdit } = useClinical()
const skillsDay = useSkillsDay()
const ps = useProtocolSkills()
const clindocs = useClinicalDocs()
const events = useClinicalEvents()

const ready = computed(() => clinReady.value && ps.ready.value)

const checkoff = computed(
  () => ps.activeCheckoffs.value.find((k) => k.id === String(route.params.checkoffId)) ?? null,
)
const person = computed(
  () => clinicalPeople.value.find((p) => p.userId === String(route.params.userId)) ?? null,
)

/* Only evaluators run check-offs; everyone else lands back on the board. */
watch(
  [ready, skillsDay.isEvaluator],
  ([r, ev]) => {
    if (r && !ev) void router.replace('/skills/protocol-updates')
  },
  { immediate: true },
)

/** Local calendar date — toISOString() is UTC and rolls to tomorrow
 *  after 1900 Central. */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const checks = ref<Record<string, boolean>>({})
const evalDate = ref(todayLocal())
const note = ref('')
const empSig = ref<string | null>(null)
const evalSig = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

/* Re-verifying: pre-tick from the latest filed verification. */
watch(
  [checkoff, person, ready],
  () => {
    if (!checkoff.value || !person.value) return
    const v = ps.verificationFor(person.value.userId, checkoff.value.id)
    if (v) {
      const next: Record<string, boolean> = {}
      for (const [k, it] of Object.entries(v.items)) next[k] = it.result === 'pass'
      checks.value = next
    }
  },
  { immediate: true },
)

const items = computed(() => checkoff.value?.sections.flatMap((s) => s.items) ?? [])
const allChecked = computed(
  () => items.value.length > 0 && items.value.every((i) => checks.value[i.key]),
)
const overall = computed<'pass' | 'remediation'>(() => (allChecked.value ? 'pass' : 'remediation'))

const blockers = computed<string[]>(() => {
  const out: string[] = []
  if (!allChecked.value && !note.value.trim())
    out.push('Unchecked criteria save as REMEDIATION — add a note saying what to work on, or check everything off.')
  if (!empSig.value) out.push('Employee signature required.')
  if (!evalSig.value) out.push('Evaluator signature required.')
  return out
})

let itemNo = 0
function numbered(): number {
  return ++itemNo
}
const numberedSections = computed(() => {
  itemNo = 0
  return (checkoff.value?.sections ?? []).map((s) => ({
    title: s.title,
    items: s.items.map((i) => ({ ...i, no: numbered() })),
  }))
})

async function save() {
  const k = checkoff.value
  const p = person.value
  if (!k || !p || busy.value || blockers.value.length) return
  busy.value = true
  error.value = null
  try {
    const payload: ProtocolSkillVerification['items'] = {}
    for (const s of k.sections) {
      for (const i of s.items) payload[i.key] = { result: checks.value[i.key] ? 'pass' : 'redo', label: i.label }
    }
    const res = await ps.submitVerification({
      checkoffId: k.id,
      userId: p.userId,
      evalDate: evalDate.value,
      items: payload,
      overall: overall.value,
      candidateSignature: empSig.value,
      evaluatorSignature: evalSig.value,
      note: note.value.trim() || null,
    })
    if (!res.ok) throw new Error(res.error)

    /* File the signed PDF + timeline entry when this session may —
       clinical editors only; a field FTO's record still lives in the
       table and can be filed later. */
    if (canEdit.value) {
      try {
        const v = ps.verifications.value.find((x) => x.id === res.id)
        if (v) {
          const doc = await generateProtocolSkillVerificationPdf({
            campaignTitle: ps.activeCampaign.value?.title ?? 'Protocol skills verification',
            checkoff: k,
            verification: v,
            candidateName: p.fullName,
            evaluatorName: auth.appUser?.fullName ?? 'Evaluator',
          })
          const safe = p.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
          const blob = doc.output('blob') as Blob
          await clindocs.upload({
            userId: p.userId,
            folder: 'generated',
            file: new File([blob], `WCEMS_Protocol_Skill_${k.key}_${safe}_${evalDate.value}.pdf`, { type: 'application/pdf' }),
            employeeVisible: true,
            note: `${k.title} · ${overall.value === 'pass' ? 'verified' : 'remediation'}`,
          })
          await events.log(
            p.userId,
            'protocol_skill',
            `${k.title} — ${overall.value === 'pass' ? 'verified' : 'remediation required'} (2026 protocol update)`,
          )
        }
      } catch (e) {
        console.error('[protocol-skills] filing failed:', e)
      }
    }
    void router.push('/skills/protocol-updates')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pr">
    <button type="button" class="pr__back" @click="router.push('/skills/protocol-updates')">
      <ArrowLeft :size="14" :stroke-width="2" />
      Protocol updates board
    </button>

    <div v-if="!ready" class="pr__empty">Loading…</div>
    <div v-else-if="!checkoff || !person" class="pr__empty">
      That check-off isn't here — it may have been removed from the campaign.
    </div>

    <template v-else>
      <!-- The sheet — mirrors the printed verification form -->
      <div class="pr__sheet">
        <header class="pr__lh">
          <img class="pr__crest" src="/wcems-patch.png" alt="" />
          <div class="pr__lh-mid">
            <div class="pr__org">WALLER COUNTY EMS</div>
            <h1 class="pr__form display">{{ checkoff.title }}</h1>
            <div class="pr__campaign">{{ ps.activeCampaign.value?.title ?? 'Protocol skills verification' }}</div>
          </div>
          <div class="pr__formno">
            <span>FORM</span>
            <b>{{ checkoff.key }}</b>
          </div>
        </header>
        <div class="pr__rule" aria-hidden="true"></div>

        <div class="pr__meta">
          <div class="pr__mfld">
            <span class="pr__mlab">Employee</span>
            <span class="pr__mval">{{ person.fullName }}</span>
          </div>
          <div class="pr__mfld">
            <span class="pr__mlab">Credential</span>
            <span class="pr__mval">{{ person.record.certLevel }}</span>
          </div>
          <div class="pr__mfld">
            <span class="pr__mlab">Evaluator</span>
            <span class="pr__mval">{{ auth.appUser?.fullName }}</span>
          </div>
          <div class="pr__mfld">
            <span class="pr__mlab">Date</span>
            <input v-model="evalDate" type="date" class="pr__mdate" />
          </div>
        </div>

        <p v-if="checkoff.subtitle" class="pr__refs">{{ checkoff.subtitle }}</p>
        <p v-if="checkoff.note" class="pr__note">{{ checkoff.note }}</p>

        <section v-for="s in numberedSections" :key="s.title" class="pr__sect">
          <h2 class="pr__secthead">{{ s.title }}</h2>
          <label v-for="i in s.items" :key="i.key" class="pr__crit">
            <input v-model="checks[i.key]" type="checkbox" />
            <span class="pr__critno">{{ i.no }}.</span>
            <span class="pr__critlabel" :class="{ 'pr__critlabel--done': checks[i.key] }">{{ i.label }}</span>
          </label>
        </section>

        <div class="pr__result" :class="allChecked ? 'pr__result--ok' : 'pr__result--warn'">
          <component :is="allChecked ? Check : AlertTriangle" :size="15" :stroke-width="2.5" />
          <b>{{ allChecked ? 'VERIFIED' : 'REMEDIATION' }}</b>
          <span>{{ allChecked ? 'all criteria met' : 'unchecked criteria save as remediation' }}</span>
        </div>

        <label class="pr__notefld">
          <span class="pr__mlab">Note{{ allChecked ? ' (optional)' : ' — what to work on' }}</span>
          <input v-model="note" type="text" maxlength="300" />
        </label>

        <div class="pr__sigs">
          <div class="pr__sig">
            <SignaturePad :height="96" @change="(d: string) => (empSig = d)" />
            <div class="pr__sigline">Employee — {{ person.fullName }}</div>
          </div>
          <div class="pr__sig">
            <SignaturePad :height="96" @change="(d: string) => (evalSig = d)" />
            <div class="pr__sigline">Evaluator — {{ auth.appUser?.fullName }}</div>
          </div>
        </div>
      </div>

      <div v-if="blockers.length" class="pr__blockers">
        <div v-for="b in blockers" :key="b" class="pr__blocker">
          <AlertTriangle :size="12" :stroke-width="2" /> {{ b }}
        </div>
      </div>
      <div v-if="error" class="pr__error">{{ error }}</div>

      <div class="pr__actions">
        <button type="button" class="pr__go" :disabled="busy || blockers.length > 0" @click="save">
          {{ busy ? 'Filing…' : allChecked ? 'Sign & verify' : 'Sign — remediation' }}
        </button>
        <button type="button" class="pr__cancel" @click="router.push('/skills/protocol-updates')">Cancel</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pr { max-width: 880px; margin: 0 auto; padding: 20px 16px 110px; }
@media (min-width: 768px) { .pr { padding: 24px 32px 80px; } }
.pr__back {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none; border: none; padding: 0;
  margin-bottom: 14px; cursor: pointer;
}
.pr__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }

/* ── The paper sheet ── */
.pr__sheet {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.06), 0 14px 40px oklch(0.2 0.03 260 / 0.08);
  padding: 26px 26px 30px;
}
@media (min-width: 768px) { .pr__sheet { padding: 38px 48px 44px; } }

.pr__lh { display: flex; align-items: center; gap: 16px; }
.pr__crest { width: 58px; height: auto; flex-shrink: 0; }
.pr__lh-mid { flex: 1; min-width: 0; text-align: center; }
.pr__org {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.22em;
  color: var(--color-accent-strong, #a8842c);
}
.pr__form { font-size: clamp(21px, 4.5vw, 30px); line-height: 1.12; color: var(--color-ink); margin: 3px 0 2px; }
.pr__campaign { font-size: 11px; color: var(--color-muted); }
.pr__formno {
  flex-shrink: 0; text-align: right; display: grid; gap: 1px;
  font-size: 9px; font-weight: 800; letter-spacing: 0.14em; color: var(--color-muted);
}
.pr__formno b { font-size: 10.5px; letter-spacing: 0.04em; color: var(--color-ink-soft); font-weight: 700; }
.pr__rule {
  height: 0; margin: 14px 0 18px;
  border-top: 2.5px solid var(--color-brand-900);
  border-bottom: 1px solid var(--color-accent-strong, #a8842c);
  padding-top: 2px;
}

.pr__meta {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 22px; margin-bottom: 16px;
}
@media (min-width: 768px) { .pr__meta { grid-template-columns: repeat(4, 1fr); } }
.pr__mfld { display: grid; gap: 3px; border-bottom: 1px solid var(--color-ink-soft); padding-bottom: 4px; }
.pr__mlab { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); }
.pr__mval { font-size: 13.5px; font-weight: 700; color: var(--color-ink); }
.pr__mdate {
  font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-ink);
  border: 0; background: none; padding: 0;
}
.pr__mdate:focus { outline: none; }

.pr__refs { font-size: 12px; color: var(--color-ink-soft); margin: 0 0 4px; }
.pr__note {
  font-size: 11.5px; font-style: italic; color: var(--color-muted); line-height: 1.55;
  border-left: 3px solid var(--color-line); padding-left: 10px; margin: 8px 0 4px;
}

.pr__sect { margin-top: 18px; }
.pr__secthead {
  font-size: 11px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-brand-900); margin: 0 0 4px;
  display: flex; align-items: center; gap: 10px;
}
.pr__secthead::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.pr__crit {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 2px; cursor: pointer;
  border-bottom: 1px dotted var(--color-line);
  font-size: 13px; line-height: 1.45; color: var(--color-ink-soft);
}
.pr__crit:last-of-type { border-bottom: 0; }
.pr__crit input { margin-top: 3px; width: 15px; height: 15px; accent-color: var(--color-brand-800); flex-shrink: 0; }
.pr__critno { font-weight: 700; color: var(--color-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.pr__critlabel--done { color: var(--color-ink); }

.pr__result {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  margin: 20px 0 6px; padding: 10px 14px; border-radius: 8px;
  font-size: 13px;
}
.pr__result b { letter-spacing: 0.08em; }
.pr__result--ok { background: var(--color-success-50, oklch(0.96 0.02 150)); color: var(--color-success-500); border: 1px solid oklch(0.85 0.06 150); }
.pr__result--warn { background: oklch(0.985 0.015 60); color: oklch(0.45 0.12 50); border: 1px solid oklch(0.87 0.06 60); }

.pr__notefld { display: grid; gap: 4px; margin: 10px 0 4px; }
.pr__notefld input {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 0; border-bottom: 1px solid var(--color-ink-soft); border-radius: 0;
  background: none; padding: 4px 2px;
}
.pr__notefld input:focus { outline: none; border-bottom-color: var(--color-brand-700); }

.pr__sigs { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 22px; }
@media (min-width: 640px) { .pr__sigs { grid-template-columns: 1fr 1fr; gap: 28px; } }
.pr__sigline {
  margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--color-ink-soft);
  font-size: 11px; font-weight: 650; color: var(--color-ink-soft);
}

/* ── Below the sheet ── */
.pr__blockers { margin-top: 14px; display: grid; gap: 4px; }
.pr__blocker { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: oklch(0.5 0.13 45); }
.pr__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
.pr__actions {
  display: flex; gap: 16px; align-items: center; margin-top: 16px;
}
@media (max-width: 639px) {
  .pr__actions {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    margin: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: var(--color-surface); border-top: 1px solid var(--color-line);
    box-shadow: 0 -8px 24px oklch(0.2 0.03 260 / 0.08);
  }
}
.pr__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 8px;
  padding: 11px 20px; font-family: var(--font-sans); font-size: 13px; font-weight: 700; cursor: pointer;
}
.pr__go:hover:not(:disabled) { background: var(--color-brand-700); }
.pr__go:disabled { opacity: 0.5; cursor: default; }
.pr__cancel {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-muted); font-size: 12.5px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
</style>
