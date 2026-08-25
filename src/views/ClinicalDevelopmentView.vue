<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, GraduationCap, Plus, Users, X } from 'lucide-vue-next'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'
import { useClinicalDocs, FOLDER_LABELS } from '@/composables/useClinicalDocs'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import FtepResourcesCard from '@/components/clinical/FtepResourcesCard.vue'
import type { FtepReport } from '@/types'
import {
  activeTransitionFor,
  openGapCount,
  phaseLabel,
  pillFor,
  progressPct,
} from '@/constants/pipelineGates'
import type { PipelinePerson, PipelinePhase } from '@/types'
import PipelineStatStrip, { type StatTile } from '@/components/pipeline/PipelineStatStrip.vue'
import PipelineFilterBar, { type PipelineFilters } from '@/components/pipeline/PipelineFilterBar.vue'
import PipelineTable from '@/components/pipeline/PipelineTable.vue'
import PipelinePersonDetail from '@/components/pipeline/PipelinePersonDetail.vue'
import PipelinePersonModal from '@/components/pipeline/PipelinePersonModal.vue'
import PipelineActionCenter from '@/components/pipeline/PipelineActionCenter.vue'

/**
 * Clinical Development — the live FTEP pipeline.
 *
 * One adaptive route: board viewers (supervisors/admins, pipeline
 * editors, FTOs) get the stat strip + filters + expandable table;
 * everyone else gets their own record as a "My Progress" page. RLS
 * enforces the same split server-side, so the board shell simply never
 * has other people's rows to show a crew member.
 */

const auth = useAuthStore()
const {
  people,
  editorIds,
  ready,
  errorMessage,
  canEdit,
  canViewBoard,
  myRecord,
  gatesFor,
  startOnboarding,
  addEditor,
  removeEditor,
} = usePipeline()

const router = useRouter()

/* Supervisors/FTOs work from the FTEP page — the full board is a
   clinical-department surface (Justin, 2026-08-24). Crew stay here on
   My Progress. */
watch(
  [ready, canViewBoard, canEdit],
  ([r, board, edit]) => {
    if (r && board && !edit) router.replace('/clinical/ftep')
  },
  { immediate: true },
)

/* ── Stat tiles ─────────────────────────────────────────────────────── */

const today = new Date()

function licDays(p: PipelinePerson): number | null {
  const iso = p.record.txLicenseExpiresAt
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000)
}

function overTarget(p: PipelinePerson): boolean {
  const t = p.record.workingTargetAt
  if (!p.record.workingPhase || !t) return false
  return new Date(`${t}T00:00:00`).getTime() < today.getTime()
}

const inPipe = (p: PipelinePerson) => !p.record.pending && activeTransitionFor(p.record) !== null

const STAT_FILTERS: Record<string, (p: PipelinePerson) => boolean> = {
  roster: (p) => !p.record.pending,
  cohort: (p) => p.record.pending,
  inpipe: inPipe,
  gaps: (p) => inPipe(p) && openGapCount(p.record, gatesFor(p.record.id)) > 0,
  lic90: (p) => {
    const d = licDays(p)
    return d !== null && d >= 0 && d <= 90
  },
  overdue: (p) => overTarget(p) || (licDays(p) ?? 1) < 0,
}

const tiles = computed<StatTile[]>(() => [
  { key: 'roster', n: people.value.filter(STAT_FILTERS.roster).length, label: 'On roster' },
  { key: 'cohort', n: people.value.filter(STAT_FILTERS.cohort).length, label: 'Aug 17 cohort', variant: 'feature' },
  { key: 'inpipe', n: people.value.filter(STAT_FILTERS.inpipe).length, label: 'In pipeline' },
  { key: 'gaps', n: people.value.filter(STAT_FILTERS.gaps).length, label: 'Lacking gates', variant: 'warn' },
  { key: 'lic90', n: people.value.filter(STAT_FILTERS.lic90).length, label: 'Licenses ≤ 90d', variant: 'warn' },
  { key: 'overdue', n: people.value.filter(STAT_FILTERS.overdue).length, label: 'Overdue', variant: 'alert' },
])

const activeStat = ref<string | null>(null)
function toggleStat(key: string) {
  activeStat.value = activeStat.value === key ? null : key
}

/* ── Filters ────────────────────────────────────────────────────────── */

const filters = ref<PipelineFilters>({ credential: '', phase: '', shift: '', search: '' })

const credentialOptions = computed(() =>
  [...new Set(people.value.map((p) => p.record.level).filter((l): l is string => !!l))].sort(),
)

const phaseOptions = [
  { value: 'pending', label: 'Pending — Aug 17 cohort' },
  ...(['NEOP', 'FTR', 'P1', 'P2', 'P3', 'FinalRelease'] as PipelinePhase[]).map((p) => ({
    value: p,
    label: phaseLabel(p),
  })),
]

function matchesPhase(p: PipelinePerson, phase: string): boolean {
  if (!phase) return true
  if (phase === 'pending') return p.record.pending
  if (p.record.workingPhase) return p.record.workingPhase === phase
  return p.record.clearedPhase === phase
}

const filtered = computed<PipelinePerson[]>(() => {
  const f = filters.value
  const q = f.search.trim().toLowerCase()
  return people.value.filter((p) => {
    if (activeStat.value && !STAT_FILTERS[activeStat.value](p)) return false
    if (f.credential && p.record.level !== f.credential) return false
    if (!matchesPhase(p, f.phase)) return false
    if (f.shift && p.shift !== f.shift) return false
    if (q && !`${p.fullName} ${p.station ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
})

/* Active progressions first, pending cohort second, credentialed rest. */
const sorted = computed(() =>
  [...filtered.value].sort((a, b) => {
    const key = (p: PipelinePerson) => (inPipe(p) ? 0 : p.record.pending ? 1 : 2)
    return key(a) - key(b) || a.fullName.localeCompare(b.fullName)
  }),
)

/* ── Person edit modal ──────────────────────────────────────────────── */

const editingPerson = ref<PipelinePerson | null>(null)

/** Keep the modal's person fresh across realtime reloads (people array
 *  is replaced wholesale on every refetch). */
const editingPersonLive = computed(() =>
  editingPerson.value
    ? (people.value.find((p) => p.userId === editingPerson.value!.userId) ?? editingPerson.value)
    : null,
)

/* ── Start onboarding dialog ────────────────────────────────────────── */

const showOnboard = ref(false)
const onboard = reactive({
  userId: '',
  phase: 'NEOP' as PipelinePhase,
  startedAt: new Date().toISOString().slice(0, 10),
  targetAt: '',
  saving: false,
  error: null as string | null,
})

const onboardCandidates = computed(() =>
  people.value
    .filter((p) => !activeTransitionFor(p.record))
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
)

async function submitOnboard() {
  if (!onboard.userId) return
  onboard.saving = true
  onboard.error = null
  try {
    await startOnboarding(onboard.userId, onboard.phase, onboard.startedAt, onboard.targetAt || null)
    showOnboard.value = false
    onboard.userId = ''
  } catch (err) {
    onboard.error = (err as Error).message
  } finally {
    onboard.saving = false
  }
}

/* ── Editors panel ──────────────────────────────────────────────────── */

const showEditors = ref(false)
const editorPick = ref('')
const editorBusy = ref(false)

const editorPeople = computed(() =>
  editorIds.value
    .map((id) => people.value.find((p) => p.userId === id))
    .filter((p): p is PipelinePerson => !!p),
)

const editorCandidates = computed(() =>
  people.value.filter((p) => !editorIds.value.includes(p.userId)),
)

async function doAddEditor() {
  if (!editorPick.value) return
  editorBusy.value = true
  try {
    await addEditor(editorPick.value)
    editorPick.value = ''
  } finally {
    editorBusy.value = false
  }
}

async function doRemoveEditor(userId: string, name: string) {
  if (!confirm(`Remove ${name} from clinical editors?`)) return
  editorBusy.value = true
  try {
    await removeEditor(userId)
  } finally {
    editorBusy.value = false
  }
}

/* ── My Progress summary bits (crew view) ───────────────────────────── */

const myPct = computed(() =>
  myRecord.value ? progressPct(myRecord.value.record, gatesFor(myRecord.value.record.id)) : 0,
)
const myPill = computed(() =>
  myRecord.value ? pillFor(myRecord.value.record, gatesFor(myRecord.value.record.id)) : null,
)
const myPhaseText = computed(() => {
  const r = myRecord.value?.record
  if (!r) return ''
  if (r.pending) return 'NEOP Academy — awaiting clearance'
  if (r.workingPhase) return phaseLabel(r.workingPhase)
  if (r.clearedPhase) return `Cleared · ${phaseLabel(r.clearedPhase)}`
  return '—'
})

/* ── My file (crew): shared documents + my submitted FTEP reports ──
   RLS already scopes both loads — crew get only their own
   employee-visible docs and their own submitted reports. */

const clindocs = useClinicalDocs()
const ftep = useFtep()

const myDocs = computed(() =>
  myRecord.value ? clindocs.docsFor(myRecord.value.userId) : [],
)
const myFtepReports = computed(() =>
  myRecord.value
    ? ftep.submittedFor(myRecord.value.userId).sort((a, b) => b.evalDate.localeCompare(a.evalDate))
    : [],
)

/* Evaluator names — crew's pipeline load holds only their own row, so
   look the names up from the directory. */
const evalNames = ref<Record<string, string>>({})
watch(
  myFtepReports,
  async (rs) => {
    const missing = [...new Set(rs.map((r) => r.evaluatorId))].filter((id) => !evalNames.value[id])
    if (!missing.length || auth.usingDevStub) return
    const { data } = await supabase.from('app_users').select('id, full_name').in('id', missing)
    for (const u of data ?? []) evalNames.value[u.id as string] = u.full_name as string
  },
  { immediate: true },
)

async function openMyDoc(docId: string) {
  const d = myDocs.value.find((x) => x.id === docId)
  if (!d) return
  const res = await clindocs.openDoc(d)
  if (res.ok) window.open(res.url, '_blank', 'noopener')
}

const myPdfBusy = ref<string | null>(null)
async function viewMyReport(reportId: string) {
  const r = myFtepReports.value.find((x) => x.id === reportId)
  if (!r || !myRecord.value || myPdfBusy.value) return
  myPdfBusy.value = reportId
  try {
    const doc = await generateFtepReportPdf({
      report: r,
      traineeName: myRecord.value.fullName,
      evaluatorName: evalNames.value[r.evaluatorId] ?? 'Evaluator',
    })
    window.open(doc.output('bloburl'), '_blank', 'noopener')
  } finally {
    myPdfBusy.value = null
  }
}

function fmtDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/* Deferred signatures: reports the FTO submitted while this trainee
   was unavailable (asleep at shift change) — review & sign here,
   view-only. */
const awaitingSign = computed(() =>
  myFtepReports.value.filter((r) => !r.traineeSignature && !r.payload.legacyManual),
)

const signTarget = ref<FtepReport | null>(null)
const signSig = ref<string | null>(null)
const signBusy = ref(false)
const signError = ref<string | null>(null)

function openSign(r: FtepReport) {
  signTarget.value = r
  signSig.value = null
  signError.value = null
}

async function submitSign() {
  if (!signTarget.value || !signSig.value || signBusy.value) return
  signBusy.value = true
  signError.value = null
  const res = await ftep.signAsTrainee(signTarget.value.id, signSig.value)
  signBusy.value = false
  if (!res.ok) {
    signError.value = res.error
    return
  }
  signTarget.value = null
}
</script>

<template>
  <div class="cd">
    <!-- ══ Board (supervisors / editors / FTOs) ══ -->
    <template v-if="canViewBoard">
      <header class="cd__head">
        <div>
          <div class="flex items-center gap-2">
            <GraduationCap :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
            <h1 class="display cd__title">Clinical Development</h1>
          </div>
          <p class="cd__sub">Training pipeline · credentialing · compliance — live from the WCEMS Roster.</p>
        </div>
        <div v-if="canEdit" class="cd__actions">
          <button type="button" class="btn" @click="showEditors = !showEditors">
            <Users :size="15" :stroke-width="2" /> Editors
          </button>
          <button type="button" class="btn btn-primary" @click="showOnboard = true">
            <Plus :size="15" :stroke-width="2.2" /> Start onboarding
          </button>
        </div>
      </header>

      <!-- Editors management -->
      <section v-if="showEditors && canEdit" class="cd__editors">
        <div class="cd__editors-head">
          <span>Clinical editors — who can check off gates and edit records</span>
          <button type="button" class="cd__close" @click="showEditors = false"><X :size="15" /></button>
        </div>
        <ul class="cd__editor-list">
          <li v-for="e in editorPeople" :key="e.userId">
            {{ e.fullName }} <span class="cd__editor-title">{{ e.title }}</span>
            <button
              type="button"
              class="cd__editor-remove"
              :disabled="editorBusy || e.userId === auth.appUser?.id"
              :title="e.userId === auth.appUser?.id ? 'You cannot remove yourself' : 'Remove'"
              @click="doRemoveEditor(e.userId, e.fullName)"
            >Remove</button>
          </li>
        </ul>
        <div class="cd__editor-add">
          <select v-model="editorPick">
            <option value="">Add an editor…</option>
            <option v-for="p in editorCandidates" :key="p.userId" :value="p.userId">{{ p.fullName }}</option>
          </select>
          <button type="button" class="btn" :disabled="!editorPick || editorBusy" @click="doAddEditor">Add</button>
        </div>
      </section>

      <div v-if="!ready" class="cd__empty">Loading the pipeline…</div>
      <div v-else-if="errorMessage" class="cd__empty">{{ errorMessage }}</div>
      <template v-else>
        <div v-if="canEdit" class="cd__actioncenter reveal" style="animation-delay: 40ms">
          <PipelineActionCenter :people="people" @open="(p) => (editingPerson = p)" />
        </div>
        <div class="reveal" style="animation-delay: 60ms">
          <PipelineStatStrip :tiles="tiles" :active="activeStat" @toggle="toggleStat" />
        </div>
        <div class="cd__filters reveal" style="animation-delay: 100ms">
          <PipelineFilterBar
            v-model="filters"
            :credential-options="credentialOptions"
            :phase-options="phaseOptions"
            :shown="sorted.length"
            :total="people.length"
          />
        </div>
        <div class="reveal" style="animation-delay: 140ms">
          <PipelineTable :people="sorted" @edit="(p) => (editingPerson = p)" />
        </div>
        <p class="cd__footnote">
          Gate items with a dashed circle aren't tracked yet — they fill in as documentation is
          entered. Licenses and cert levels update automatically from the HR roster.
        </p>
      </template>

      <PipelinePersonModal
        v-if="editingPersonLive"
        :person="editingPersonLive"
        @close="editingPerson = null"
      />

      <!-- Start onboarding dialog -->
      <div v-if="showOnboard" class="cd__overlay" @click.self="showOnboard = false">
        <div class="cd__dialog">
          <h3 class="display cd__dialog-title">Start onboarding</h3>
          <p class="cd__dialog-sub">Put someone into a working phase — they'll appear in the active pipeline.</p>
          <label class="cd__field">
            <span>Person</span>
            <select v-model="onboard.userId">
              <option value="">Select…</option>
              <option v-for="p in onboardCandidates" :key="p.userId" :value="p.userId">
                {{ p.fullName }}{{ p.record.level ? ` (${p.record.level})` : '' }}
              </option>
            </select>
          </label>
          <label class="cd__field">
            <span>Working phase</span>
            <select v-model="onboard.phase">
              <option v-for="p in (['NEOP', 'FTR', 'P1', 'P2', 'P3'] as PipelinePhase[])" :key="p" :value="p">
                {{ phaseLabel(p) }}
              </option>
            </select>
          </label>
          <div class="cd__field-row">
            <label class="cd__field"><span>Start date</span><input v-model="onboard.startedAt" type="date" /></label>
            <label class="cd__field"><span>Target date</span><input v-model="onboard.targetAt" type="date" /></label>
          </div>
          <p v-if="onboard.error" class="cd__err">{{ onboard.error }}</p>
          <div class="cd__dialog-actions">
            <button type="button" class="btn" @click="showOnboard = false">Cancel</button>
            <button type="button" class="btn btn-primary" :disabled="!onboard.userId || onboard.saving" @click="submitOnboard">
              {{ onboard.saving ? 'Starting…' : 'Start onboarding' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ══ My Progress (crew) ══ -->
    <template v-else>
      <header class="cd__head">
        <div>
          <div class="flex items-center gap-2">
            <GraduationCap :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
            <h1 class="display cd__title">My Progress</h1>
          </div>
          <p class="cd__sub">Your credentialing track, gates, and license dates.</p>
        </div>
      </header>

      <div v-if="!ready" class="cd__empty">Loading your record…</div>
      <div v-else-if="!myRecord" class="cd__empty">
        No pipeline record yet — it appears automatically once you're on the roster. Ask your CDO
        if you think this is a mistake.
      </div>
      <template v-else>
        <!-- Deferred-signature prompt -->
        <div v-if="awaitingSign.length" class="cd__signbanner reveal">
          <b>{{ awaitingSign.length }} report{{ awaitingSign.length === 1 ? '' : 's' }} need{{ awaitingSign.length === 1 ? 's' : '' }} your signature.</b>
          Your FTO submitted {{ awaitingSign.length === 1 ? 'it' : 'them' }} while you were unavailable —
          review and sign below under "My FTEP reports."
        </div>

        <div class="cd__me reveal">
          <div class="cd__me-line">
            <span class="cd__me-phase">{{ myPhaseText }}</span>
            <span v-if="myPill && myPill.variant !== 'none'" class="cd__me-pill" :class="`cd__me-pill--${myPill.variant}`">
              {{ myPill.text }}
            </span>
          </div>
          <div class="cd__me-track"><i :style="{ width: `${myPct}%` }"></i></div>
        </div>
        <div class="cd__me-detail reveal" style="animation-delay: 80ms">
          <PipelinePersonDetail :person="myRecord" />
        </div>

        <!-- My documents — files clinical has shared with this employee -->
        <div class="cd__mycard reveal" style="animation-delay: 140ms">
          <div class="cd__mycard-hd">My documents</div>
          <button
            v-for="d in myDocs"
            :key="d.id"
            type="button"
            class="cd__myrow"
            @click="openMyDoc(d.id)"
          >
            <FileText :size="14" :stroke-width="1.9" class="cd__myrow-ic" />
            <span class="cd__myrow-name">{{ d.name }}</span>
            <span class="cd__myrow-meta">{{ FOLDER_LABELS[d.folder] }} · {{ fmtDate(d.createdAt) }}</span>
          </button>
          <div v-if="myDocs.length === 0" class="cd__myempty">
            Nothing shared with you yet — documents appear here when the Clinical Department
            shares them (cert copies, signed forms, completion certificates).
          </div>
        </div>

        <!-- My FTEP reports — submitted DORs/ICRs about this employee -->
        <div class="cd__mycard reveal" style="animation-delay: 200ms">
          <div class="cd__mycard-hd">My FTEP reports</div>
          <button
            v-for="r in myFtepReports"
            :key="r.id"
            type="button"
            class="cd__myrow"
            :disabled="myPdfBusy === r.id || !!r.payload.legacyManual"
            @click="viewMyReport(r.id)"
          >
            <FileText :size="14" :stroke-width="1.9" class="cd__myrow-ic" />
            <span class="cd__myrow-name">{{ r.kind.toUpperCase() }} · {{ fmtDate(r.evalDate) }}</span>
            <span class="cd__myrow-meta">
              <template v-if="r.payload.legacyManual">call evaluation (Jotform)</template>
              <template v-else>
                <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
                by {{ evalNames[r.evaluatorId] ?? '—' }} · tap to view PDF
              </template>
            </span>
            <span
              v-if="!r.traineeSignature && !r.payload.legacyManual"
              class="cd__signchip"
              role="button"
              tabindex="0"
              @click.stop="openSign(r)"
              @keydown.enter.stop.prevent="openSign(r)"
            >Needs your signature</span>
          </button>
          <div v-if="myFtepReports.length === 0" class="cd__myempty">
            No submitted evaluations yet — DORs and ICRs your FTO submits will appear here.
          </div>
        </div>

        <!-- Program resources — trainee-audience library docs -->
        <div class="cd__mycard-wrap reveal" style="animation-delay: 260ms">
          <FtepResourcesCard title="Program resources" />
        </div>

        <!-- Trainee Evaluation of FTO — phase-transition feedback, CDO-only -->
        <div v-if="myRecord.record.workingPhase || myRecord.record.pending" class="cd__ftoeval reveal" style="animation-delay: 320ms">
          <div class="cd__ftoeval-copy">
            <b>Finishing a phase?</b>
            Complete your Trainee Evaluation of FTO — it goes to the Clinical Development Officer
            only, never to your FTO.
          </div>
          <button type="button" class="btn" @click="router.push('/clinical-development/fto-eval')">
            Evaluate my FTO
          </button>
        </div>

        <!-- Review & sign modal (view-only — trainees can never edit) -->
        <div v-if="signTarget" class="cd__signoverlay" @click.self="signTarget = null">
          <div class="cd__signmodal">
            <h2 class="display cd__signmodal-title">
              {{ signTarget.kind.toUpperCase() }} · {{ fmtDate(signTarget.evalDate) }} — review &amp; sign
            </h2>
            <p class="cd__signmodal-sub">
              Submitted by {{ evalNames[signTarget.evaluatorId] ?? 'your FTO' }}<template v-if="signTarget.payload.average !== undefined"> · shift average {{ signTarget.payload.average?.toFixed(2) }}</template>.
              Review the finished report, then sign — your signature attests you reviewed it; the
              report itself can't be changed.
            </p>
            <button type="button" class="btn cd__signmodal-view" :disabled="myPdfBusy === signTarget.id" @click="viewMyReport(signTarget.id)">
              <FileText :size="14" :stroke-width="2" />
              {{ myPdfBusy === signTarget.id ? 'Opening…' : 'View the report (PDF)' }}
            </button>
            <div class="cd__signmodal-pad">
              <div class="cd__signmodal-padlabel">Trainee — {{ myRecord?.fullName }}</div>
              <SignaturePad :height="110" @change="(v: string) => (signSig = v || null)" />
            </div>
            <div v-if="signError" class="cd__signmodal-err">{{ signError }}</div>
            <div class="cd__signmodal-actions">
              <button type="button" class="btn" @click="signTarget = null">Not now</button>
              <button type="button" class="btn btn-primary" :disabled="!signSig || signBusy" @click="submitSign">
                {{ signBusy ? 'Saving…' : 'Sign & save' }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.cd {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
@media (min-width: 768px) {
  .cd {
    padding: 36px 40px 64px;
  }
}
.cd__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 22px;
}
.cd__title {
  font-size: 30px;
  color: var(--color-brand-800);
}
.cd__sub {
  margin-top: 5px;
  font-size: 13.5px;
  color: var(--color-muted);
}
.cd__actions {
  display: flex;
  gap: 10px;
}
.cd__actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cd__actioncenter {
  margin-bottom: 18px;
}
.cd__filters {
  margin: 18px 0 14px;
}
.cd__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted-soft);
}
.cd__footnote {
  margin-top: 14px;
  font-size: 12px;
  color: var(--color-muted-soft);
}

/* Editors panel */
.cd__editors {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  padding: 14px 16px;
  margin-bottom: 18px;
}
.cd__editors-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 10px;
}
.cd__close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  padding: 2px;
}
.cd__editor-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cd__editor-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13.5px;
  color: var(--color-ink);
}
.cd__editor-title {
  flex: 1;
  font-size: 11.5px;
  color: var(--color-muted-soft);
}
.cd__editor-remove {
  font-size: 11.5px;
  color: var(--color-danger-500);
  background: none;
  border: none;
  cursor: pointer;
}
.cd__editor-remove:disabled {
  color: var(--color-muted-soft);
  cursor: not-allowed;
}
.cd__editor-add {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.cd__editor-add select {
  flex: 1;
  font-size: 13px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}

/* Dialog */
.cd__overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: oklch(0.2 0.04 250 / 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cd__dialog {
  width: 100%;
  max-width: 440px;
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 22px 24px;
}
.cd__dialog-title {
  font-size: 22px;
  color: var(--color-brand-800);
}
.cd__dialog-sub {
  margin: 4px 0 14px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.cd__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  margin-bottom: 10px;
  flex: 1;
}
.cd__field input,
.cd__field select {
  font-size: 13.5px;
  font-weight: 400;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.cd__field-row {
  display: flex;
  gap: 12px;
}
.cd__err {
  font-size: 12.5px;
  color: var(--color-danger-500);
  margin-bottom: 8px;
}
.cd__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

/* Deferred-signature prompt + modal (crew) */
.cd__signbanner {
  margin-bottom: 14px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--color-warning-50);
  border: 1px solid oklch(0.85 0.07 90);
  font-size: 13px;
  line-height: 1.5;
  color: oklch(0.42 0.1 75);
}
.cd__signbanner b { color: oklch(0.35 0.1 75); }
.cd__signchip {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
  border: 1px solid oklch(0.85 0.07 90);
  cursor: pointer;
  white-space: nowrap;
}
.cd__signchip:hover { background: oklch(0.93 0.06 90); }
.cd__signoverlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.2 0.04 250 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.cd__signmodal {
  width: 100%;
  max-width: 520px;
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cd__signmodal-title { font-size: 20px; color: var(--color-brand-800); }
.cd__signmodal-sub { font-size: 12.5px; line-height: 1.55; color: var(--color-ink-soft); }
.cd__signmodal-view { align-self: flex-start; display: inline-flex; align-items: center; gap: 7px; }
.cd__signmodal-padlabel {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 5px;
}
.cd__signmodal-err { font-size: 12.5px; color: var(--color-danger-500); }
.cd__signmodal-actions { display: flex; justify-content: flex-end; gap: 10px; }

.cd__mycard-wrap { margin-top: 14px; }
.cd__ftoeval {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 13px 18px;
  border-radius: 13px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
}
.cd__ftoeval-copy {
  flex: 1;
  min-width: 260px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.cd__ftoeval-copy b { color: var(--color-ink); display: block; }

/* My file cards (crew) */
.cd__mycard {
  margin-top: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  padding: 14px 18px;
}
.cd__mycard-hd {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.cd__myrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 4px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.cd__myrow:last-of-type { border-bottom: none; }
.cd__myrow:hover:not(:disabled) { background: var(--color-surface-soft); }
.cd__myrow:disabled { cursor: default; }
.cd__myrow-ic { color: var(--color-brand-600); flex-shrink: 0; }
.cd__myrow-name {
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd__myrow-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--color-muted);
  white-space: nowrap;
}
.cd__myempty {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-muted);
  padding: 4px 0;
}

/* My Progress */
.cd__me {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  padding: 18px 20px;
}
.cd__me-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.cd__me-phase {
  font-family: var(--font-display);
  font-size: 20px;
  color: var(--color-brand-800);
}
.cd__me-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 999px;
  white-space: nowrap;
}
.cd__me-pill--open {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.cd__me-pill--ready {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.cd__me-pill--hold {
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
}
.cd__me-pill--credentialed {
  background: linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  color: var(--color-accent-on-dark);
}
.cd__me-track {
  height: 7px;
  border-radius: 999px;
  background: var(--color-line-soft);
  overflow: hidden;
}
.cd__me-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent-400));
}
.cd__me-detail {
  margin-top: 16px;
}
.cd__me-detail :deep(.pd) {
  background: transparent;
  border-top: none;
  padding: 0;
}
</style>
