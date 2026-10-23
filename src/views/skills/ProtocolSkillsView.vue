<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Check, Download, FileText, Plus, X, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useClinicalEvents } from '@/composables/useClinicalEvents'
import { useSkillsDay } from '@/composables/useSkillsDay'
import {
  useProtocolSkills,
  type ProtocolSkillCheckoff,
  type ProtocolSkillVerification,
} from '@/composables/useProtocolSkills'
import {
  generateProtocolSkillBlankPdf,
  generateProtocolSkillVerificationPdf,
} from '@/lib/protocolSkillPdf'
import type { PipelinePerson, SkillsCheckoffSection } from '@/types'

/**
 * Protocol-update skills verification — the rollout board. Every
 * credentialed employee owes a hands-on check-off for each skill new
 * to their scope (2026: EMT CPAP/acetaminophen/naloxone · AEMT
 * 12-lead/epi-in-arrest/ondansetron/diphenhydramine · Paramedic
 * cefazolin/acetaminophen IV/push-dose norepi/needle cric).
 *
 * Evaluators (the Skills Day grant: admins, supervisors, FTOs,
 * person-grants) run the check-offs anywhere — the board streams live.
 * Crew see their own list. Blank letterhead PDFs back the digital flow
 * on paper; every signed verification can be reprinted.
 */

const router = useRouter()
const auth = useAuthStore()
const { ready: clinReady, clinicalPeople, canEdit, personById } = useClinical()
const skillsDay = useSkillsDay()
const ps = useProtocolSkills()
const clindocs = useClinicalDocs()
const events = useClinicalEvents()

const isEvaluator = skillsDay.isEvaluator
const ready = computed(() => clinReady.value && ps.ready.value)

const LEVELS: { key: string; label: string }[] = [
  { key: 'EMT-B', label: 'EMT' },
  { key: 'ADV EMT', label: 'Advanced EMT' },
  { key: 'EMT-P', label: 'Paramedic' },
  { key: 'LP', label: 'Licensed Paramedic' },
]

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Roster by level ────────────────────────────────────────────────── */

interface PersonRow {
  p: PipelinePerson
  skills: ProtocolSkillCheckoff[]
  done: number
  remediation: number
}

function rowsForLevel(level: string): PersonRow[] {
  const skills = ps.skillsForLevel(level)
  if (!skills.length) return []
  return clinicalPeople.value
    .filter((p) => p.record.certLevel === level)
    .map((p) => {
      let done = 0
      let remediation = 0
      for (const k of skills) {
        const v = ps.verificationFor(p.userId, k.id)
        if (v?.overall === 'pass') done++
        else if (v?.overall === 'remediation') remediation++
      }
      return { p, skills, done, remediation }
    })
    .sort((a, b) => {
      const ac = a.done === a.skills.length ? 1 : 0
      const bc = b.done === b.skills.length ? 1 : 0
      return ac - bc || a.p.fullName.localeCompare(b.p.fullName)
    })
}

const levelSections = computed(() =>
  LEVELS.map((l) => ({ ...l, rows: rowsForLevel(l.key), skills: ps.skillsForLevel(l.key) })).filter(
    (l) => l.rows.length > 0,
  ),
)

const stats = computed(() => {
  let people = 0
  let complete = 0
  let filed = 0
  let remediation = 0
  for (const sec of levelSections.value) {
    for (const r of sec.rows) {
      people++
      if (r.done === r.skills.length) complete++
      filed += r.done
      remediation += r.remediation
    }
  }
  return { people, complete, filed, remediation }
})

/** The signed-in user's own slice (crew view). */
const mySkills = computed(() => {
  const me = clinicalPeople.value.find((p) => p.userId === auth.appUser?.id)
  if (!me) return null
  const skills = ps.skillsForLevel(me.record.certLevel)
  if (!skills.length) return null
  return {
    p: me,
    skills: skills.map((k) => ({ k, v: ps.verificationFor(me.userId, k.id) })),
  }
})

function stateFor(userId: string, checkoffId: string): 'pass' | 'remediation' | 'pending' {
  const v = ps.verificationFor(userId, checkoffId)
  return v?.overall === 'pass' ? 'pass' : v?.overall === 'remediation' ? 'remediation' : 'pending'
}

function shortTitle(t: string): string {
  return t
    .replace('Cardiac monitor & 12-lead acquisition', '12 lead')
    .replace('Epinephrine in cardiac arrest', 'Epi · arrest')
    .replace('Diphenhydramine IV/IO/IM', 'Diphenhydramine')
    .replace('Cefazolin (Ancef) — mixing & administration', 'Cefazolin')
    .replace('Acetaminophen PO & IV infusion', 'Acetaminophen PO/IV')
    .replace('Push-dose norepinephrine', 'Push-dose norepi')
    .replace('Needle cricothyrotomy', 'Needle cric')
    .replace('Standalone CPAP', 'CPAP')
}

/* ── Runner ─────────────────────────────────────────────────────────── */

const run = ref<{ person: PipelinePerson; checkoff: ProtocolSkillCheckoff } | null>(null)
const runChecks = ref<Record<string, boolean>>({})
const runDate = ref('')
const runNote = ref('')
const empSig = ref<string | null>(null)
const evalSig = ref<string | null>(null)
const runBusy = ref(false)
const runError = ref<string | null>(null)

function openRun(person: PipelinePerson, checkoff: ProtocolSkillCheckoff) {
  if (!isEvaluator.value) return
  run.value = { person, checkoff }
  runChecks.value = {}
  runDate.value = new Date().toISOString().slice(0, 10)
  runNote.value = ''
  empSig.value = null
  evalSig.value = null
  runError.value = null
}

const runItems = computed(() => run.value?.checkoff.sections.flatMap((s) => s.items) ?? [])
const runAllChecked = computed(
  () => runItems.value.length > 0 && runItems.value.every((i) => runChecks.value[i.key]),
)
const runOverall = computed<'pass' | 'remediation'>(() => (runAllChecked.value ? 'pass' : 'remediation'))

const runBlockers = computed<string[]>(() => {
  const out: string[] = []
  if (!runAllChecked.value && !runNote.value.trim())
    out.push('Unchecked criteria save as REMEDIATION — add a note saying what to work on, or check everything off.')
  if (!empSig.value) out.push('Employee signature required.')
  if (!evalSig.value) out.push('Evaluator signature required.')
  return out
})

async function saveRun() {
  const r = run.value
  if (!r || runBusy.value || runBlockers.value.length) return
  runBusy.value = true
  runError.value = null
  try {
    const items: ProtocolSkillVerification['items'] = {}
    for (const s of r.checkoff.sections) {
      for (const i of s.items) {
        items[i.key] = { result: runChecks.value[i.key] ? 'pass' : 'redo', label: i.label }
      }
    }
    const res = await ps.submitVerification({
      checkoffId: r.checkoff.id,
      userId: r.person.userId,
      evalDate: runDate.value,
      items,
      overall: runOverall.value,
      candidateSignature: empSig.value,
      evaluatorSignature: evalSig.value,
      note: runNote.value.trim() || null,
    })
    if (!res.ok) throw new Error(res.error)

    /* File the signed PDF + timeline entry when this session may —
       clinical editors only; a field FTO's record still lives in the
       table and can be filed from here later. */
    if (canEdit.value) {
      try {
        const v = ps.verifications.value.find((x) => x.id === res.id)
        if (v) {
          const doc = await generateProtocolSkillVerificationPdf({
            campaignTitle: ps.activeCampaign.value?.title ?? 'Protocol skills verification',
            checkoff: r.checkoff,
            verification: v,
            candidateName: r.person.fullName,
            evaluatorName: auth.appUser?.fullName ?? 'Evaluator',
          })
          const safe = r.person.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
          const blob = doc.output('blob') as Blob
          await clindocs.upload({
            userId: r.person.userId,
            folder: 'generated',
            file: new File([blob], `WCEMS_Protocol_Skill_${r.checkoff.key}_${safe}_${runDate.value}.pdf`, { type: 'application/pdf' }),
            employeeVisible: true,
            note: `${r.checkoff.title} · ${runOverall.value === 'pass' ? 'verified' : 'remediation'}`,
          })
          await events.log(
            r.person.userId,
            'protocol_skill',
            `${r.checkoff.title} — ${runOverall.value === 'pass' ? 'verified' : 'remediation required'} (2026 protocol update)`,
          )
        }
      } catch (e) {
        console.error('[protocol-skills] filing failed:', e)
      }
    }
    run.value = null
  } catch (e) {
    runError.value = (e as Error).message
  } finally {
    runBusy.value = false
  }
}

/* ── PDFs ───────────────────────────────────────────────────────────── */

const pdfBusy = ref<string | null>(null)
async function blankPdf(k: ProtocolSkillCheckoff) {
  if (pdfBusy.value) return
  pdfBusy.value = k.id
  try {
    const doc = await generateProtocolSkillBlankPdf({
      campaignTitle: ps.activeCampaign.value?.title ?? 'Protocol skills verification',
      checkoff: k,
    })
    doc.save(`WCEMS_Skill_Form_${k.key}.pdf`)
  } finally {
    pdfBusy.value = null
  }
}

async function allBlanks() {
  for (const k of ps.activeCheckoffs.value) {
    // eslint-disable-next-line no-await-in-loop
    await blankPdf(k)
  }
}

async function signedPdf(p: PipelinePerson, k: ProtocolSkillCheckoff) {
  const v = ps.verificationFor(p.userId, k.id)
  if (!v || pdfBusy.value) return
  pdfBusy.value = `${p.userId}-${k.id}`
  try {
    const doc = await generateProtocolSkillVerificationPdf({
      campaignTitle: ps.activeCampaign.value?.title ?? 'Protocol skills verification',
      checkoff: k,
      verification: v,
      candidateName: p.fullName,
      evaluatorName: personById(v.evaluatorId)?.fullName ?? skillsDay.nameFor(v.evaluatorId),
    })
    window.open(doc.output('bloburl'), '_blank', 'noopener')
  } finally {
    pdfBusy.value = null
  }
}

/* ── Completed-chip menu (view PDF / remove) ────────────────────────── */
const chipMenu = ref<string | null>(null)
function chipKey(p: PipelinePerson, k: ProtocolSkillCheckoff) {
  return `${p.userId}|${k.id}`
}
async function removeVerification(p: PipelinePerson, k: ProtocolSkillCheckoff) {
  const v = ps.verificationFor(p.userId, k.id)
  if (!v) return
  if (!confirm(`Remove the ${k.title} verification for ${p.fullName}? The skill goes back to pending.`)) return
  chipMenu.value = null
  await ps.removeVerification(v.id)
}

/* ── CSV ────────────────────────────────────────────────────────────── */
function csvEscape(v: string | number | null | undefined): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function exportCsv() {
  const lines: string[] = ['Name,Level,Skill,Status,Date,Evaluator']
  for (const sec of levelSections.value) {
    for (const r of sec.rows) {
      for (const k of r.skills) {
        const v = ps.verificationFor(r.p.userId, k.id)
        lines.push(
          [
            csvEscape(r.p.fullName),
            csvEscape(sec.label),
            csvEscape(k.title),
            csvEscape(v ? (v.overall === 'pass' ? 'Verified' : 'Remediation') : 'Pending'),
            csvEscape(v?.evalDate ?? ''),
            csvEscape(v ? (personById(v.evaluatorId)?.fullName ?? '') : ''),
          ].join(','),
        )
      }
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `WCEMS_Protocol_Skills_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* ── Catalog manage (clinical editors) ──────────────────────────────── */
const manageOpen = ref(false)
const editing = ref<ProtocolSkillCheckoff | null>(null)
const edit = ref({
  id: '' as string | undefined,
  key: '',
  title: '',
  subtitle: '',
  note: '',
  levels: [] as string[],
  sort: 100,
  active: true,
  sectionsText: '',
})
const editBusy = ref(false)
const editError = ref<string | null>(null)

function sectionsToText(sections: SkillsCheckoffSection[]): string {
  return sections
    .map((s) => [s.title, ...s.items.map((i) => `- ${i.label}`)].join('\n'))
    .join('\n\n')
}
function textToSections(text: string): SkillsCheckoffSection[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  let n = 0
  return blocks.map((b) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean)
    const title = lines[0]?.replace(/^#+\s*/, '') ?? 'Criteria'
    const items = lines
      .slice(1)
      .map((l) => l.replace(/^[-•*]\s*/, ''))
      .filter(Boolean)
      .map((label) => ({ key: String(++n), label }))
    return { title, items }
  })
}

function openEdit(k: ProtocolSkillCheckoff | null) {
  editing.value = k
  edit.value = k
    ? {
        id: k.id,
        key: k.key,
        title: k.title,
        subtitle: k.subtitle,
        note: k.note,
        levels: [...k.requiredLevels],
        sort: k.sort,
        active: k.active,
        sectionsText: sectionsToText(k.sections),
      }
    : {
        id: undefined,
        key: '',
        title: '',
        subtitle: '',
        note: '',
        levels: [],
        sort: (ps.activeCheckoffs.value.at(-1)?.sort ?? 100) + 10,
        active: true,
        sectionsText: 'Criteria\n- ',
      }
  editError.value = null
}
function toggleLevel(l: string) {
  edit.value.levels = edit.value.levels.includes(l)
    ? edit.value.levels.filter((x) => x !== l)
    : [...edit.value.levels, l]
}
async function saveEdit() {
  if (editBusy.value) return
  if (!edit.value.title.trim() || edit.value.levels.length === 0) {
    editError.value = 'A title and at least one level are required.'
    return
  }
  editBusy.value = true
  editError.value = null
  const res = await ps.saveCheckoff({
    id: edit.value.id,
    key: edit.value.key.trim() || edit.value.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title: edit.value.title.trim(),
    subtitle: edit.value.subtitle.trim(),
    note: edit.value.note.trim(),
    sections: textToSections(edit.value.sectionsText),
    requiredLevels: edit.value.levels,
    sort: edit.value.sort,
    active: edit.value.active,
  })
  editBusy.value = false
  if (!res.ok) {
    editError.value = res.error
    return
  }
  editing.value = null
  edit.value.id = undefined
  manageOpen.value = true
  editOpen.value = false
}
const editOpen = ref(false)

/* Campaign due date (editors). */
const dueBusy = ref(false)
async function setDue(ev: Event) {
  const c = ps.activeCampaign.value
  if (!c || dueBusy.value) return
  dueBusy.value = true
  await ps.setCampaignDue(c.id, (ev.target as HTMLInputElement).value || null)
  dueBusy.value = false
}
</script>

<template>
  <div class="pv" @click="chipMenu = null">
    <button type="button" class="pv__back" @click="router.push('/skills')">
      <ArrowLeft :size="14" :stroke-width="2" />
      Skills Day
    </button>

    <div v-if="!ready" class="pv__empty">Loading…</div>
    <div v-else-if="!ps.activeCampaign.value" class="pv__empty">No active skills campaign.</div>

    <template v-else>
      <header class="pv__head">
        <div class="pv__head-id">
          <h1 class="display pv__title">{{ ps.activeCampaign.value.title }}</h1>
          <p class="pv__sub">{{ ps.activeCampaign.value.description }}</p>
          <div class="pv__due">
            <template v-if="canEdit">
              <label class="pv__due-edit">Due by
                <input type="date" :value="ps.activeCampaign.value.dueBy ?? ''" :disabled="dueBusy" @change="setDue" />
              </label>
            </template>
            <span v-else-if="ps.activeCampaign.value.dueBy" class="pv__due-chip">
              due {{ fmt(ps.activeCampaign.value.dueBy) }}
            </span>
          </div>
        </div>
        <div v-if="isEvaluator" class="pv__stats">
          <div class="pv__stat"><span class="pv__stat-n display">{{ stats.complete }}<small> / {{ stats.people }}</small></span><span class="pv__stat-l">people complete</span></div>
          <div class="pv__stat"><span class="pv__stat-n display">{{ stats.filed }}</span><span class="pv__stat-l">verifications filed</span></div>
          <div class="pv__stat" :class="{ 'pv__stat--warn': stats.remediation > 0 }"><span class="pv__stat-n display">{{ stats.remediation }}</span><span class="pv__stat-l">remediations open</span></div>
        </div>
      </header>

      <!-- ── My skills (everyone) ── -->
      <section v-if="mySkills" class="pv__mine">
        <div class="pv__sectitle">My skills — {{ mySkills.p.record.certLevel }}</div>
        <div class="pv__panel pv__panel--pad">
          <div v-for="s in mySkills.skills" :key="s.k.id" class="pv__myrow">
            <span class="pv__mydot" :class="s.v?.overall === 'pass' ? 'pv__mydot--ok' : s.v ? 'pv__mydot--warn' : ''"></span>
            <span class="pv__myname">{{ s.k.title }}</span>
            <span class="pv__mymeta">{{ s.k.subtitle }}</span>
            <span class="pv__myst" :class="s.v?.overall === 'pass' ? 'pv__ok' : s.v ? 'pv__warn' : 'pv__mut'">
              {{ s.v?.overall === 'pass' ? `verified ${fmt(s.v.evalDate)}` : s.v ? 'remediation — see your evaluator' : 'pending' }}
            </span>
          </div>
          <div class="pv__quiet">
            An evaluator — any FTO or supervisor — signs these off with you in person. Catch one on
            shift; the paper form backs it up if a device isn't handy.
          </div>
        </div>
      </section>

      <!-- ── Board (evaluators) ── -->
      <template v-if="isEvaluator">
        <template v-for="sec in levelSections" :key="sec.key">
          <div class="pv__sectitle">
            {{ sec.label }}
            <span class="pv__seccount">{{ sec.rows.filter(r => r.done === r.skills.length).length }} of {{ sec.rows.length }} complete</span>
          </div>
          <div class="pv__panel">
            <div v-for="r in sec.rows" :key="r.p.userId" class="pv__row" :class="{ 'pv__row--done': r.done === r.skills.length }">
              <span class="pv__who">{{ r.p.fullName }}</span>
              <span class="pv__progress">{{ r.done }} of {{ r.skills.length }}</span>
              <span class="pv__chips" @click.stop>
                <span v-for="k in r.skills" :key="k.id" class="pv__chipwrap">
                  <button
                    type="button"
                    class="pv__chip"
                    :class="`pv__chip--${stateFor(r.p.userId, k.id)}`"
                    :title="k.title"
                    @click="stateFor(r.p.userId, k.id) === 'pending' ? openRun(r.p, k) : (chipMenu = chipMenu === chipKey(r.p, k) ? null : chipKey(r.p, k))"
                  >
                    <Check v-if="stateFor(r.p.userId, k.id) === 'pass'" :size="11" :stroke-width="3" />
                    <AlertTriangle v-else-if="stateFor(r.p.userId, k.id) === 'remediation'" :size="11" :stroke-width="2.5" />
                    {{ shortTitle(k.title) }}
                  </button>
                  <span v-if="chipMenu === chipKey(r.p, k)" class="pv__chipmenu">
                    <button type="button" @click="signedPdf(r.p, k); chipMenu = null">
                      <FileText :size="12" :stroke-width="2" /> View the signed form
                    </button>
                    <button type="button" @click="openRun(r.p, k); chipMenu = null">Re-verify</button>
                    <button v-if="canEdit" type="button" class="pv__chipmenu-danger" @click="removeVerification(r.p, k)">Remove</button>
                  </span>
                </span>
              </span>
            </div>
          </div>
        </template>

        <!-- Catalog + exports -->
        <div class="pv__sectitle">
          Skill forms &amp; catalog
          <span class="pv__secactions">
            <button type="button" class="pv__lnk" @click="allBlanks">Download all blank PDFs</button>
            <button type="button" class="pv__lnk" @click="exportCsv">Export CSV</button>
            <button v-if="canEdit" type="button" class="pv__lnk" @click="manageOpen = !manageOpen">
              {{ manageOpen ? 'Done managing' : 'Manage skills' }}
            </button>
          </span>
        </div>
        <div class="pv__panel">
          <div v-for="k in ps.activeCheckoffs.value" :key="k.id" class="pv__catrow">
            <span class="pv__who">{{ k.title }}</span>
            <span class="pv__catmeta">{{ k.requiredLevels.join(' · ') }} · {{ k.sections.reduce((a, s) => a + s.items.length, 0) }} criteria</span>
            <span class="pv__catactions">
              <button v-if="manageOpen && canEdit" type="button" class="pv__lnk" @click="openEdit(k); editOpen = true">Edit</button>
              <button type="button" class="pv__mini" :disabled="pdfBusy === k.id" @click="blankPdf(k)">
                <Download :size="12" :stroke-width="2" /> Blank PDF
              </button>
            </span>
          </div>
          <div v-if="manageOpen && canEdit" class="pv__cataddwrap">
            <button type="button" class="pv__mini" @click="openEdit(null); editOpen = true">
              <Plus :size="12" :stroke-width="2.5" /> Add a skill
            </button>
          </div>
        </div>
      </template>

      <!-- ── Runner drawer ── -->
      <div v-if="run" class="pv__scrim" @click.self="run = null">
        <aside class="pv__drawer">
          <div class="pv__dr-hd">
            <div>
              <div class="pv__dr-t display">{{ run.checkoff.title }}</div>
              <div class="pv__dr-s">{{ run.person.fullName }} · {{ run.person.record.certLevel }} · evaluator: {{ auth.appUser?.fullName }}</div>
            </div>
            <button type="button" class="pv__dr-x" @click="run = null"><X :size="17" :stroke-width="2" /></button>
          </div>
          <div class="pv__dr-bd">
            <p v-if="run.checkoff.subtitle" class="pv__dr-sub">{{ run.checkoff.subtitle }}</p>
            <p v-if="run.checkoff.note" class="pv__note">{{ run.checkoff.note }}</p>
            <template v-for="s in run.checkoff.sections" :key="s.title">
              <div class="pv__dr-sect">{{ s.title }}</div>
              <label v-for="i in s.items" :key="i.key" class="pv__check">
                <input v-model="runChecks[i.key]" type="checkbox" />
                <span :class="{ 'pv__done': runChecks[i.key] }">{{ i.label }}</span>
              </label>
            </template>

            <div class="pv__scorebar" :class="runAllChecked ? 'pv__scorebar--ok' : 'pv__scorebar--warn'">
              <component :is="runAllChecked ? Check : AlertTriangle" :size="14" :stroke-width="2.5" />
              {{ runAllChecked ? 'All criteria met — saves as VERIFIED' : 'Unchecked criteria save as REMEDIATION' }}
            </div>

            <label class="pv__fld">Date
              <input v-model="runDate" type="date" />
            </label>
            <label class="pv__fld">Note{{ runAllChecked ? ' (optional)' : ' — what to work on' }}
              <input v-model="runNote" type="text" maxlength="300" />
            </label>

            <div class="pv__dr-sect">Signatures</div>
            <div class="pv__sig">
              <div class="pv__sig-l">Employee — {{ run.person.fullName }}</div>
              <SignaturePad :height="84" @change="(d: string) => (empSig = d)" />
            </div>
            <div class="pv__sig">
              <div class="pv__sig-l">Evaluator — {{ auth.appUser?.fullName }}</div>
              <SignaturePad :height="84" @change="(d: string) => (evalSig = d)" />
            </div>

            <div v-if="runBlockers.length" class="pv__blockers">
              <div v-for="b in runBlockers" :key="b" class="pv__blocker">
                <AlertTriangle :size="12" :stroke-width="2" /> {{ b }}
              </div>
            </div>
            <div v-if="runError" class="pv__error">{{ runError }}</div>
          </div>
          <div class="pv__dr-ft">
            <button type="button" class="pv__go" :disabled="runBusy || runBlockers.length > 0" @click="saveRun">
              {{ runBusy ? 'Filing…' : runAllChecked ? 'Sign & verify' : 'Sign — remediation' }}
            </button>
            <button type="button" class="pv__lnk pv__lnk--mut" @click="run = null">Cancel</button>
          </div>
        </aside>
      </div>

      <!-- ── Catalog edit dialog ── -->
      <div v-if="editOpen && canEdit" class="pv__scrim" @click.self="editOpen = false">
        <aside class="pv__drawer">
          <div class="pv__dr-hd">
            <div>
              <div class="pv__dr-t display">{{ editing ? 'Edit skill' : 'Add a skill' }}</div>
              <div class="pv__dr-s">The catalog is live data — changes apply to everyone immediately</div>
            </div>
            <button type="button" class="pv__dr-x" @click="editOpen = false"><X :size="17" :stroke-width="2" /></button>
          </div>
          <div class="pv__dr-bd">
            <label class="pv__fld">Title <input v-model="edit.title" type="text" maxlength="120" /></label>
            <label class="pv__fld">Subtitle (protocol references) <input v-model="edit.subtitle" type="text" maxlength="200" /></label>
            <label class="pv__fld">Note <input v-model="edit.note" type="text" maxlength="240" /></label>
            <div class="pv__fld">Levels that owe this skill
              <div class="pv__lvls">
                <label v-for="l in LEVELS" :key="l.key" class="pv__lvl">
                  <input type="checkbox" :checked="edit.levels.includes(l.key)" @change="toggleLevel(l.key)" />
                  {{ l.label }}
                </label>
              </div>
            </div>
            <label class="pv__fld">Criteria — one section per block: first line is the section title, each “- ” line is a criterion; blank line starts a new section
              <textarea v-model="edit.sectionsText" rows="14"></textarea>
            </label>
            <label class="pv__fld pv__fld--row">
              <input v-model="edit.active" type="checkbox" />
              Active — appears on the board and in My skills
            </label>
            <div v-if="editError" class="pv__error">{{ editError }}</div>
          </div>
          <div class="pv__dr-ft">
            <button type="button" class="pv__go" :disabled="editBusy" @click="saveEdit">
              {{ editBusy ? 'Saving…' : 'Save skill' }}
            </button>
            <button type="button" class="pv__lnk pv__lnk--mut" @click="editOpen = false">Cancel</button>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pv { max-width: 1080px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .pv { padding: 24px 32px 80px; } }
.pv__back {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none; border: none; padding: 0;
  margin-bottom: 14px; cursor: pointer;
}
.pv__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }

.pv__head { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 6px; }
.pv__head-id { min-width: 280px; flex: 1; }
.pv__title { font-size: 28px; line-height: 1.1; color: var(--color-ink); }
.pv__sub { margin-top: 5px; font-size: 12.5px; color: var(--color-ink-soft); line-height: 1.55; max-width: 640px; }
.pv__due { margin-top: 8px; }
.pv__due-edit { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 700; color: var(--color-muted); }
.pv__due-edit input {
  font-family: var(--font-sans); font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.pv__due-chip {
  display: inline-flex; font-size: 10.5px; font-weight: 800; letter-spacing: 0.05em;
  text-transform: uppercase; border-radius: 999px; padding: 3px 10px;
  background: linear-gradient(180deg, oklch(0.78 0.11 86.8), oklch(0.664 0.119 86.8));
  color: var(--color-brand-950);
}
.pv__stats { display: flex; gap: 0; border: 1px solid var(--color-line); border-radius: 12px; overflow: hidden; background: var(--color-surface); box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.05), 0 6px 18px oklch(0.2 0.03 260 / 0.06); }
.pv__stat { padding: 10px 18px; border-right: 1px solid var(--color-line-soft); text-align: center; }
.pv__stat:last-child { border-right: 0; }
.pv__stat-n { display: block; font-size: 24px; color: var(--color-brand-950); font-variant-numeric: tabular-nums; }
.pv__stat-n small { font-size: 14px; color: var(--color-muted); }
.pv__stat-l { font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted); }
.pv__stat--warn .pv__stat-n { color: oklch(0.5 0.14 50); }

.pv__sectitle {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); margin: 20px 0 10px;
}
.pv__sectitle::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.pv__seccount { font-weight: 650; letter-spacing: 0.01em; text-transform: none; font-size: 11.5px; color: var(--color-muted); }
.pv__secactions { display: flex; gap: 14px; order: 3; }
.pv__panel {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-brand-800);
  border-radius: 12px; overflow: visible; margin-bottom: 8px;
  box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.05), 0 6px 18px oklch(0.2 0.03 260 / 0.05);
}
.pv__panel--pad { padding: 10px 16px; }

.pv__mine .pv__panel { border-left-color: var(--color-accent-600, oklch(0.664 0.119 86.8)); }
.pv__myrow {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 8px 0; border-bottom: 1px solid var(--color-line-soft); font-size: 13px;
}
.pv__myrow:last-of-type { border-bottom: 0; }
.pv__mydot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-muted-soft); flex-shrink: 0; align-self: center; }
.pv__mydot--ok { background: var(--color-success-500); }
.pv__mydot--warn { background: oklch(0.55 0.19 25); }
.pv__myname { font-weight: 700; color: var(--color-ink); }
.pv__mymeta { font-size: 11px; color: var(--color-muted); min-width: 0; }
.pv__myst { margin-left: auto; font-size: 12px; font-weight: 700; }
.pv__ok { color: var(--color-success-500); }
.pv__warn { color: oklch(0.5 0.14 50); }
.pv__mut { color: var(--color-muted); }
.pv__quiet { font-size: 11.5px; color: var(--color-muted); padding: 8px 0 2px; line-height: 1.5; }

.pv__row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 9px 16px; border-bottom: 1px solid var(--color-line-soft);
}
.pv__row:last-of-type { border-bottom: 0; }
.pv__row--done { background: oklch(0.985 0.008 150); }
.pv__who { font-weight: 700; font-size: 13px; color: var(--color-ink); min-width: 150px; }
.pv__progress { font-size: 11.5px; font-weight: 700; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.pv__chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.pv__chipwrap { position: relative; }
.pv__chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 10.5px; font-weight: 750;
  border-radius: 999px; padding: 4px 10px; cursor: pointer;
  border: 1px solid var(--color-line); background: var(--color-surface); color: var(--color-ink-soft);
}
.pv__chip--pending:hover { border-color: var(--color-brand-700); color: var(--color-brand-700); }
.pv__chip--pass {
  background: linear-gradient(180deg, oklch(0.6 0.14 150), oklch(0.52 0.13 150));
  border-color: oklch(0.5 0.12 150); color: #fff;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18);
}
.pv__chip--remediation {
  background: linear-gradient(180deg, oklch(0.62 0.18 27), oklch(0.53 0.18 27));
  border-color: oklch(0.5 0.17 27); color: #fff;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18);
}
.pv__chipmenu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 50;
  display: flex; flex-direction: column; min-width: 190px;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 10px; box-shadow: 0 8px 24px oklch(0.2 0.03 260 / 0.16); padding: 5px;
}
.pv__chipmenu button {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 7px; padding: 8px 10px;
  font-family: var(--font-sans); font-size: 12px; font-weight: 550; color: var(--color-ink);
  cursor: pointer;
}
.pv__chipmenu button:hover { background: var(--color-surface-soft); }
.pv__chipmenu-danger { color: var(--color-danger-500) !important; }

.pv__catrow {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 9px 16px; border-bottom: 1px solid var(--color-line-soft); font-size: 13px;
}
.pv__catrow:last-of-type { border-bottom: 0; }
.pv__catmeta { font-size: 11px; color: var(--color-muted); }
.pv__catactions { margin-left: auto; display: flex; gap: 12px; align-items: center; }
.pv__cataddwrap { padding: 10px 16px; border-top: 1px solid var(--color-line-soft); }

.pv__mini {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 10px; cursor: pointer;
}
.pv__mini:hover { border-color: var(--color-accent-strong, #a8842c); }
.pv__mini:disabled { opacity: 0.5; }
.pv__lnk {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-brand-600); font-size: 11.5px; font-weight: 650;
  letter-spacing: 0.01em; text-transform: none;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.pv__lnk:hover { color: var(--color-ink); }
.pv__lnk--mut { color: var(--color-muted); }

/* Drawer */
.pv__scrim {
  position: fixed; inset: 0; z-index: 90;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex; justify-content: flex-end;
}
.pv__drawer {
  width: min(480px, 96vw); height: 100%;
  background: var(--color-surface);
  box-shadow: -12px 0 40px oklch(0.2 0.05 260 / 0.25);
  display: flex; flex-direction: column;
}
.pv__dr-hd {
  display: flex; align-items: flex-start; gap: 10px;
  background: linear-gradient(180deg, var(--color-brand-800), var(--color-brand-950));
  color: #fff; padding: 14px 18px;
  border-bottom: 2px solid var(--color-accent-600, oklch(0.664 0.119 86.8));
}
.pv__dr-t { font-size: 20px; }
.pv__dr-s { font-size: 11.5px; color: oklch(0.8 0.035 250); margin-top: 2px; }
.pv__dr-x { margin-left: auto; background: none; border: none; color: oklch(0.8 0.035 250); cursor: pointer; padding: 2px; }
.pv__dr-x:hover { color: #fff; }
.pv__dr-bd { padding: 14px 18px; overflow: auto; flex: 1; }
.pv__dr-ft { padding: 12px 18px; border-top: 1px solid var(--color-line); display: flex; gap: 14px; align-items: center; }
.pv__dr-sub { font-size: 12px; color: var(--color-ink-soft); margin: 0 0 4px; }
.pv__dr-sect {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-muted); margin: 14px 0 6px;
}
.pv__dr-sect::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.pv__check {
  display: flex; align-items: flex-start; gap: 9px; padding: 5px 0;
  font-size: 12.5px; color: var(--color-ink-soft); cursor: pointer;
  border-bottom: 1px solid var(--color-line-soft);
}
.pv__check:last-of-type { border-bottom: 0; }
.pv__check input { margin-top: 2px; accent-color: var(--color-brand-700); }
.pv__done { color: var(--color-ink); }
.pv__scorebar {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 0 4px; padding: 9px 12px; border-radius: 9px;
  font-size: 12.5px; font-weight: 600;
}
.pv__scorebar--ok { background: var(--color-success-50, oklch(0.96 0.02 150)); color: var(--color-success-500); }
.pv__scorebar--warn { background: oklch(0.985 0.015 60); color: oklch(0.45 0.12 50); border: 1px solid oklch(0.87 0.06 60); }
.pv__fld { display: grid; gap: 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); margin: 8px 0; }
.pv__fld input, .pv__fld textarea {
  font-family: var(--font-sans); font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.pv__fld textarea { line-height: 1.5; resize: vertical; }
.pv__fld input:focus, .pv__fld textarea:focus { outline: none; border-color: var(--color-brand-600); }
.pv__fld--row { display: flex; align-items: center; gap: 8px; }
.pv__lvls { display: flex; gap: 14px; flex-wrap: wrap; padding: 4px 0; }
.pv__lvl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-ink-soft); }
.pv__sig { margin: 8px 0 12px; }
.pv__sig-l { font-size: 11.5px; font-weight: 650; color: var(--color-ink-soft); margin-bottom: 5px; }
.pv__note { font-size: 11px; color: var(--color-muted); line-height: 1.5; margin: 6px 0; }
.pv__blockers { margin-top: 10px; display: grid; gap: 4px; }
.pv__blocker { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: oklch(0.5 0.13 45); }
.pv__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
.pv__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 7px;
  padding: 9px 16px; font-family: var(--font-sans); font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.pv__go:hover:not(:disabled) { background: var(--color-brand-700); }
.pv__go:disabled { opacity: 0.5; cursor: default; }
</style>
