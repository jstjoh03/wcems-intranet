<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, Download, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepPhaseStepper from '@/components/clinical/FtepPhaseStepper.vue'
import PipelinePersonDetail from '@/components/pipeline/PipelinePersonDetail.vue'
import PipelinePersonModal from '@/components/pipeline/PipelinePersonModal.vue'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs, FOLDER_LABELS, type ClinicalDocFolder } from '@/composables/useClinicalDocs'
import { useFtep } from '@/composables/useFtep'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { requirementStatus, activeTransitionFor, jurisprudenceStatus } from '@/constants/pipelineGates'
import { generateSkillsDayPacketPdf } from '@/lib/skillsDayPacketPdf'
import type { PipelinePerson, PipelineRequirement } from '@/types'

/**
 * One employee's clinical file — the dedicated page the redesign is
 * built around. Tabs by role:
 *   everyone with board access: Overview · Pipeline · Skills
 *   clinical editors add:       Credentials · Compliance
 * (Documents and Notes ship in phase 2.)
 */

const route = useRoute()
const router = useRouter()
const {
  ready,
  canViewBoard,
  canEdit,
  personById,
  attentionFor,
  requirementsFor,
  missingRequired,
  statusChip,
  completionsFor,
  addCompletion,
  removeCompletion,
  requirements,
  ftepTrackFor,
  manualRideouts,
} = useClinical()

const skills = useSkillsDay()
const ftep = useFtep()

const myReports = computed(() => {
  const p = person.value
  if (!p) return []
  return ftep.submittedFor(p.userId).sort((a, b) => b.evalDate.localeCompare(a.evalDate))
})
const ftepPdfBusy = ref<string | null>(null)
async function ftepPdf(reportId: string, mode: 'view' | 'download' = 'download') {
  const p = person.value
  const r = ftep.reportById(reportId)
  if (!p || !r || ftepPdfBusy.value) return
  ftepPdfBusy.value = reportId
  try {
    const evaluator = personById(r.evaluatorId)?.fullName ?? 'Evaluator'
    const doc = await generateFtepReportPdf({ report: r, traineeName: p.fullName, evaluatorName: evaluator })
    if (mode === 'view') {
      window.open(doc.output('bloburl'), '_blank', 'noopener')
    } else {
      const safe = p.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
      doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
    }
  } finally {
    ftepPdfBusy.value = null
  }
}

/* Full files are clinical-only (Justin, 2026-08-24): supervisors/FTOs
   work from the FTEP page; crew have My Progress. */
watch(
  [ready, canEdit, canViewBoard],
  ([r, edit, board]) => {
    if (r && !edit) router.replace(board ? '/clinical/ftep' : '/clinical-development')
  },
  { immediate: true },
)

const person = computed<PipelinePerson | null>(() =>
  personById(String(route.params.id)),
)

type TabKey = 'ovr' | 'pipe' | 'skills' | 'cred' | 'comp' | 'docs'
const tab = ref<TabKey>('ovr')
const tabs = computed<{ key: TabKey; label: string }[]>(() => [
  { key: 'ovr', label: 'Overview' },
  ...(canEdit.value ? [{ key: 'cred', label: 'Credentials' } as const] : []),
  { key: 'pipe', label: 'Pipeline' },
  { key: 'skills', label: 'Skills' },
  ...(canEdit.value
    ? [
        { key: 'docs', label: 'Documents' } as const,
        { key: 'comp', label: 'Compliance' } as const,
      ]
    : []),
])

const editing = ref(false)
/* Keep the modal's person fresh across realtime reloads. */
const editingLive = computed(() => (editing.value ? person.value : null))

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('')
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const attention = computed(() => (person.value ? attentionFor(person.value) : []))

/* Rideout credit = submitted rideout DORs, or the number typed into the
   P2→P3 gate for rideouts completed before the portal (whichever is
   greater). */
const rideouts = computed(() => {
  const p = person.value
  if (!p) return { dors: 0, manual: 0, count: 0 }
  const dors = ftep.submittedFor(p.userId, 'dor').length
  const manual = manualRideouts(p)
  return { dors, manual, count: Math.max(dors, manual) }
})

const juris = computed(() => (person.value ? jurisprudenceStatus(person.value.record) : null))

/* ── Credentials tab ─────────────────────────────────────────────── */
const cardReqs = computed<PipelineRequirement[]>(() =>
  person.value
    ? requirementsFor(person.value).filter((r) => r.cycle === 'certification')
    : [],
)

function reqRow(req: PipelineRequirement) {
  const p = person.value!
  const st = requirementStatus(req, completionsFor(p.userId), p.record)
  const required = missingRequired(p).some((m) => m.id === req.id)
  return { st, required }
}

const compOpen = ref<string | null>(null)
const compDraft = reactive<Record<string, { completedAt: string; expiresAt: string }>>({})
const compBusy = ref(false)

function toggleComp(reqId: string) {
  if (!compDraft[reqId]) {
    compDraft[reqId] = { completedAt: new Date().toISOString().slice(0, 10), expiresAt: '' }
  }
  compOpen.value = compOpen.value === reqId ? null : reqId
}

async function submitComp(reqId: string) {
  const p = person.value
  const d = compDraft[reqId]
  if (!p || !d?.completedAt || compBusy.value) return
  compBusy.value = true
  try {
    await addCompletion({
      requirementId: reqId,
      userId: p.userId,
      completedAt: d.completedAt,
      expiresAt: d.expiresAt || null,
      source: 'manual',
    })
    compOpen.value = null
  } finally {
    compBusy.value = false
  }
}

async function removeComp(id: string) {
  if (compBusy.value) return
  compBusy.value = true
  try {
    await removeCompletion(id)
  } finally {
    compBusy.value = false
  }
}

function historyFor(reqId: string) {
  const p = person.value
  if (!p) return []
  return completionsFor(p.userId)
    .filter((c) => c.requirementId === reqId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
}

/* ── Compliance tab groupings ────────────────────────────────────── */
const annualReqs = computed(() =>
  requirements.value.filter((r) => r.active && r.cycle === 'annual'),
)
const cycleReqs = computed(() =>
  requirements.value.filter((r) => r.active && r.cycle === 'per_cert_cycle'),
)

/* ── Skills tab ──────────────────────────────────────────────────── */
const myEvals = computed(() => {
  const p = person.value
  if (!p) return []
  return skills.evaluations.value
    .filter((e) => e.candidateId === p.userId)
    .map((e) => ({
      e,
      checkoff: skills.checkoffById(e.checkoffId),
      redo: Object.values(e.items).filter((v) => v.result === 'redo').length,
    }))
    .sort((a, b) => (a.checkoff?.sort ?? 99) - (b.checkoff?.sort ?? 99))
})

const packetBusy = ref(false)
async function downloadPacket() {
  const p = person.value
  if (!p || packetBusy.value) return
  packetBusy.value = true
  try {
    const doc = await generateSkillsDayPacketPdf({
      candidateName: p.fullName,
      checkoffs: skills.checkoffs.value,
      evaluations: skills.evaluations.value.filter((e) => e.candidateId === p.userId),
      nameFor: skills.nameFor,
    })
    const safe = p.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_Skills_Packet_${safe}.pdf`)
  } finally {
    packetBusy.value = false
  }
}

/* ── Documents tab ───────────────────────────────────────────────── */
const clindocs = useClinicalDocs()
const docFolder = ref<ClinicalDocFolder | 'all'>('all')
const FOLDERS: ClinicalDocFolder[] = ['signed_forms', 'certs', 'ce_certs', 'counseling', 'generated', 'other']

const myDocs = computed(() => {
  const p = person.value
  if (!p) return []
  const all = clindocs.docsFor(p.userId)
  return docFolder.value === 'all' ? all : all.filter((d) => d.folder === docFolder.value)
})
function folderCount(f: ClinicalDocFolder): number {
  const p = person.value
  return p ? clindocs.docsFor(p.userId).filter((d) => d.folder === f).length : 0
}

const uploadFolder = ref<ClinicalDocFolder>('signed_forms')
const uploadVisible = ref(false)
const uploadBusy = ref(false)
const uploadError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

async function onUploadPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const p = person.value
  if (!file || !p || uploadBusy.value) return
  uploadBusy.value = true
  uploadError.value = null
  const res = await clindocs.upload({
    userId: p.userId,
    folder: uploadFolder.value,
    file,
    employeeVisible: uploadVisible.value,
  })
  uploadBusy.value = false
  if (!res.ok) uploadError.value = res.error
}

async function viewDoc(docId: string) {
  const d = myDocs.value.find((x) => x.id === docId)
  if (!d) return
  const res = await clindocs.openDoc(d)
  if (res.ok) window.open(res.url, '_blank', 'noopener')
}

async function toggleDocVisibility(docId: string) {
  const d = myDocs.value.find((x) => x.id === docId)
  if (!d) return
  await clindocs.setVisibility(d, !d.employeeVisible)
}

const docDeleteArm = ref<string | null>(null)
async function deleteDoc(docId: string) {
  if (docDeleteArm.value !== docId) {
    docDeleteArm.value = docId
    setTimeout(() => { if (docDeleteArm.value === docId) docDeleteArm.value = null }, 4000)
    return
  }
  const d = myDocs.value.find((x) => x.id === docId)
  docDeleteArm.value = null
  if (d) await clindocs.remove(d)
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="cf">
    <ClinicalNav :crumbs="[{ label: 'Employee Files', to: '/clinical/people' }, person?.fullName ?? '…']" />

    <button type="button" class="cf__back" @click="router.push('/clinical/people')">
      <ArrowLeft :size="14" :stroke-width="2" />
      Employee Files
    </button>

    <div v-if="!ready" class="cf__empty">Loading…</div>
    <div v-else-if="!person" class="cf__empty">No clinical file for this employee.</div>

    <template v-else>
      <header class="cf__filehead">
        <img v-if="person.photoUrl" :src="person.photoUrl" class="cf__photo" alt="" />
        <span v-else class="cf__avatar">{{ initials(person.fullName) }}</span>
        <div class="cf__id">
          <h1 class="display cf__name">{{ person.fullName }}</h1>
          <div class="cf__meta">
            {{ person.record.certLevel }}<template v-if="person.title"> · {{ person.title }}</template>
            <template v-if="person.station"> · {{ person.station }}</template>
            <template v-if="person.shift"> · {{ person.shift }} shift</template>
            <template v-if="person.record.txLicenseNumber"> · TX Lic {{ person.record.txLicenseNumber }}</template>
            <template v-if="person.record.txLicenseExpiresAt"> exp {{ fmt(person.record.txLicenseExpiresAt) }}</template>
          </div>
        </div>
        <div class="cf__chips">
          <span class="cf__chip">{{ statusChip(person).text }}</span>
          <span v-if="person.record.isFto" class="cf__chip cf__chip--gold">FTO</span>
          <span v-if="person.record.pipActive" class="cf__chip cf__chip--warn">PIP</span>
        </div>
        <button v-if="canEdit" type="button" class="cf__edit" @click="editing = true">
          <Pencil :size="13" :stroke-width="2" />
          Edit record
        </button>
      </header>

      <nav class="cf__tabs" aria-label="File sections">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          :class="{ 'cf__tab--on': tab === t.key }"
          class="cf__tab"
          @click="tab = t.key"
        >{{ t.label }}</button>
      </nav>

      <!-- Overview -->
      <section v-if="tab === 'ovr'" class="cf__grid2">
        <div class="cf__card">
          <div class="cf__card-hd">Identity &amp; status</div>
          <div class="cf__facts">
            <div class="cf__fact"><span>Cert level</span><b>{{ person.record.certLevel ?? '—' }}</b></div>
            <div class="cf__fact"><span>TX license</span><b>{{ person.record.txLicenseNumber ?? '—' }}<template v-if="person.record.txLicenseExpiresAt"> · exp {{ fmt(person.record.txLicenseExpiresAt) }}</template></b></div>
            <div class="cf__fact"><span>Status</span><b>{{ statusChip(person).text }}</b></div>
            <div class="cf__fact" v-if="person.record.workingPhase"><span>Working phase</span><b>{{ person.record.workingPhase }}<template v-if="person.record.workingStartedAt"> — since {{ fmt(person.record.workingStartedAt) }}</template></b></div>
            <div class="cf__fact" v-if="person.record.ftoName"><span>FTO assigned</span><b>{{ person.record.ftoName }}</b></div>
            <div class="cf__fact" v-if="person.record.workingTargetAt"><span>Phase target</span><b>{{ fmt(person.record.workingTargetAt) }}</b></div>
            <div class="cf__fact" v-if="person.record.estP2ReadyAt"><span>Est. P2 ready</span><b>{{ fmt(person.record.estP2ReadyAt) }}</b></div>
            <div class="cf__fact" v-if="person.record.coverageNote"><span>Coverage</span><b>{{ person.record.coverageNote }}</b></div>
          </div>
        </div>
        <div class="cf__card">
          <div class="cf__card-hd">Needs attention <span v-if="attention.length" class="cf__cnt">{{ attention.length }}</span></div>
          <div v-for="(a, i) in attention" :key="i" class="cf__aitem">
            <span class="cf__dot" :class="`cf__dot--${a.severity}`"></span>
            <span>{{ a.detail }}</span>
          </div>
          <div v-if="attention.length === 0" class="cf__card-empty">
            <Check :size="14" :stroke-width="2" /> Nothing outstanding.
          </div>
        </div>
      </section>

      <!-- Credentials (editors) -->
      <section v-if="tab === 'cred' && canEdit">
        <div class="cf__card">
          <div class="cf__card-hd">Card classes &amp; certifications</div>
          <div v-for="req in cardReqs" :key="req.id" class="cf__gate">
            <span class="cf__tick" :class="reqRow(req).st.latest && reqRow(req).st.state !== 'due' ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="reqRow(req).st.latest && reqRow(req).st.state !== 'due'" :size="12" :stroke-width="2.5" />
              <template v-else>·</template>
            </span>
            <span class="cf__gate-l">{{ req.name }}</span>
            <span class="cf__gate-v">
              <template v-if="reqRow(req).st.latest">
                {{ fmt(reqRow(req).st.latest!.completedAt) }}
                <template v-if="reqRow(req).st.latest!.expiresAt"> → {{ fmt(reqRow(req).st.latest!.expiresAt) }}</template>
                · {{ reqRow(req).st.latest!.source }}
                <b v-if="reqRow(req).st.state === 'due'" class="cf__late"> — expired</b>
                <b v-else-if="reqRow(req).st.state === 'expiring'" class="cf__soon"> — expiring</b>
              </template>
              <b v-else-if="reqRow(req).required" class="cf__late">no card on file — required</b>
              <template v-else>—</template>
            </span>
            <button type="button" class="cf__mini" @click="toggleComp(req.id)">
              <Plus :size="12" :stroke-width="2.5" /> Add
            </button>
          </div>
        </div>
        <div v-if="compOpen" class="cf__compform">
          <span class="cf__compform-l">{{ requirements.find(r => r.id === compOpen)?.name }} — new completion</span>
          <label>Completed <input v-model="compDraft[compOpen].completedAt" type="date" /></label>
          <label>Expires <input v-model="compDraft[compOpen].expiresAt" type="date" /></label>
          <button type="button" class="cf__mini cf__mini--primary" :disabled="compBusy" @click="submitComp(compOpen)">Save</button>
          <button type="button" class="cf__mini" @click="compOpen = null">Cancel</button>
        </div>

        <div class="cf__sectitle">History</div>
        <div class="cf__card">
          <template v-for="req in cardReqs" :key="`h-${req.id}`">
            <div v-for="c in historyFor(req.id)" :key="c.id" class="cf__gate cf__gate--hist">
              <span class="cf__gate-l">{{ req.name }}</span>
              <span class="cf__gate-v">{{ fmt(c.completedAt) }}<template v-if="c.expiresAt"> → {{ fmt(c.expiresAt) }}</template> · {{ c.source }}</span>
              <button type="button" class="cf__mini cf__mini--danger" :disabled="compBusy" title="Remove this entry" @click="removeComp(c.id)">
                <Trash2 :size="12" :stroke-width="2" />
              </button>
            </div>
          </template>
          <div v-if="cardReqs.every(r => historyFor(r.id).length === 0)" class="cf__card-empty">No completions recorded yet.</div>
        </div>
      </section>

      <!-- Pipeline -->
      <section v-if="tab === 'pipe'">
        <div v-if="activeTransitionFor(person.record) === null && person.record.clearedPhase === 'FinalRelease'" class="cf__note">
          Credentialed — no active progression. The gate record below is the historical credentialing path.
        </div>
        <div v-if="myReports.length || activeTransitionFor(person.record)" class="cf__card">
          <div class="cf__card-hd">FTEP records
            <span v-if="ftepTrackFor(person)" class="cf__trackchip" :class="`cf__trackchip--${ftepTrackFor(person)!.key}`">{{ ftepTrackFor(person)!.label }}</span>
            <span style="margin-left:auto;font-size:11.5px;color:var(--color-muted);font-weight:600">auto-computed from submitted reports</span>
          </div>
          <div class="cf__stepper">
            <FtepPhaseStepper :person="person" :editable="canEdit" />
          </div>
          <template v-if="ftepTrackFor(person)?.key === 'rideup'">
            <div class="cf__gate">
              <span class="cf__tick" :class="rideouts.count >= 4 ? 'cf__tick--ok' : 'cf__tick--open'">
                <Check v-if="rideouts.count >= 4" :size="12" :stroke-width="2.5" /><template v-else>·</template>
              </span>
              <span class="cf__gate-l">12-hr supervisor rideouts</span>
              <span class="cf__gate-v">{{ rideouts.count }} of 4 required<template v-if="rideouts.manual > rideouts.dors"> · {{ rideouts.manual }} recorded manually (pre-portal)</template></span>
            </div>
            <div class="cf__gate">
              <span class="cf__tick cf__tick--open">·</span>
              <span class="cf__gate-l">Skills check-offs</span>
              <span class="cf__gate-v">check-off set to be built — no ICR requirement on this track</span>
            </div>
          </template>
          <template v-else-if="ftepTrackFor(person)?.key === 'legacy'">
            <div class="cf__gate">
              <span class="cf__tick" :class="ftep.icrCount(person.userId, ftepTrackFor(person)?.legacyPhase) >= 10 ? 'cf__tick--ok' : 'cf__tick--open'">
                <Check v-if="ftep.icrCount(person.userId, ftepTrackFor(person)?.legacyPhase) >= 10" :size="12" :stroke-width="2.5" /><template v-else>·</template>
              </span>
              <span class="cf__gate-l">Call evaluations toward {{ ftepTrackFor(person)?.legacyPhase === 'P1' ? 'P1 credentialing' : 'P2 in-charge' }} (Jotform · narrative)</span>
              <span class="cf__gate-v">{{ ftep.icrCount(person.userId, ftepTrackFor(person)?.legacyPhase) }} of 10 for this rung · each rung needs its own 10</span>
            </div>
          </template>
          <template v-else>
            <div class="cf__gate">
              <span class="cf__tick" :class="(ftep.dorRollingAverage(person.userId, ftepTrackFor(person)?.dorWindow ?? 4) ?? 0) >= 3.5 ? 'cf__tick--ok' : 'cf__tick--open'">
                <Check v-if="(ftep.dorRollingAverage(person.userId, ftepTrackFor(person)?.dorWindow ?? 4) ?? 0) >= 3.5" :size="12" :stroke-width="2.5" /><template v-else>·</template>
              </span>
              <span class="cf__gate-l">Daily Observation Reports</span>
              <span class="cf__gate-v">{{ ftep.submittedFor(person.userId, 'dor').length }} filed · avg last {{ ftepTrackFor(person)?.dorWindow ?? 4 }}: {{ ftep.dorRollingAverage(person.userId, ftepTrackFor(person)?.dorWindow ?? 4)?.toFixed(2) ?? '—' }} (floor 3.5)</span>
            </div>
            <div v-if="ftepTrackFor(person)?.icrTarget" class="cf__gate">
              <span class="cf__tick" :class="ftep.icrCount(person.userId) >= ftepTrackFor(person)!.icrTarget! ? 'cf__tick--ok' : 'cf__tick--open'">
                <Check v-if="ftep.icrCount(person.userId) >= ftepTrackFor(person)!.icrTarget!" :size="12" :stroke-width="2.5" /><template v-else>·</template>
              </span>
              <span class="cf__gate-l">Scored ALS call evaluations (ICRs)</span>
              <span class="cf__gate-v">{{ ftep.icrCount(person.userId) }} of {{ ftepTrackFor(person)!.icrTarget }} required</span>
            </div>
          </template>
          <div v-for="r in myReports.slice(0, 8)" :key="r.id" class="cf__gate cf__gate--hist">
            <template v-if="r.payload.legacyManual">
              <span class="cf__gate-l">Call eval (Jotform) · {{ fmt(r.evalDate) }}</span>
              <span class="cf__gate-v"><template v-if="r.payload.legacyPhase">→ {{ r.payload.legacyPhase }} rung · </template>{{ r.payload.note ?? '' }}<template v-if="r.payload.note"> · </template>recorded by {{ personById(r.evaluatorId)?.fullName ?? '—' }} · original in Documents</span>
            </template>
            <template v-else>
              <button
                type="button"
                class="cf__gate-l cf__gate-link"
                title="Open the report PDF in a new window"
                @click="ftepPdf(r.id, 'view')"
              >{{ r.kind.toUpperCase() }} · {{ fmt(r.evalDate) }}</button>
              <span class="cf__gate-v">
                <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
                <b v-if="r.payload.nrtFlagged" class="cf__late">NRT · </b>by {{ personById(r.evaluatorId)?.fullName ?? '—' }}
                <template v-if="r.kind === 'icr' && r.payload.countsToward10 === false">
                  · <b class="cf__late">excluded from the 10</b><template v-if="r.payload.triageNote"> — {{ r.payload.triageNote }}</template>
                </template>
                <b v-if="!r.traineeSignature" class="cf__soon"> · awaiting trainee signature</b>
              </span>
              <button type="button" class="cf__mini" :disabled="ftepPdfBusy === r.id" @click="ftepPdf(r.id, 'download')">
                <Download :size="12" :stroke-width="2" /> PDF
              </button>
            </template>
          </div>
        </div>
        <PipelinePersonDetail :person="person" />
      </section>

      <!-- Skills -->
      <section v-if="tab === 'skills'">
        <div class="cf__card">
          <div class="cf__card-hd">
            Evaluations
            <button v-if="myEvals.length" type="button" class="cf__mini" style="margin-left:auto" :disabled="packetBusy" @click="downloadPacket">
              <Download :size="12" :stroke-width="2" />
              {{ packetBusy ? 'Generating…' : 'Skills packet PDF' }}
            </button>
          </div>
          <div v-for="row in myEvals" :key="row.e.id" class="cf__gate">
            <span class="cf__tick" :class="row.redo === 0 ? 'cf__tick--ok' : 'cf__tick--warn'">
              <Check v-if="row.redo === 0" :size="12" :stroke-width="2.5" />
              <template v-else>!</template>
            </span>
            <span class="cf__gate-l">{{ row.checkoff?.title ?? 'Check-off' }}</span>
            <span class="cf__gate-v">
              {{ row.redo === 0 ? 'Pass' : `${row.redo} item${row.redo === 1 ? '' : 's'} to redo` }}
              · {{ skills.nameFor(row.e.evaluatorId) }} · {{ fmtDateTime(row.e.submittedAt) }}
            </span>
          </div>
          <div v-if="myEvals.length === 0" class="cf__card-empty">No skills evaluations on record.</div>
        </div>
      </section>

      <!-- Documents (editors) -->
      <section v-if="tab === 'docs' && canEdit">
        <div class="cf__folderbar">
          <button
            type="button"
            class="cf__folder"
            :class="{ 'cf__folder--on': docFolder === 'all' }"
            @click="docFolder = 'all'"
          >All <span class="cf__folder-n">{{ person ? clindocs.docsFor(person.userId).length : 0 }}</span></button>
          <button
            v-for="f in FOLDERS"
            :key="f"
            type="button"
            class="cf__folder"
            :class="{ 'cf__folder--on': docFolder === f }"
            @click="docFolder = f"
          >{{ FOLDER_LABELS[f] }} <span class="cf__folder-n">{{ folderCount(f) }}</span></button>
        </div>

        <div class="cf__card">
          <div v-for="d in myDocs" :key="d.id" class="cf__docrow">
            <span class="cf__doc-ico"><FileText :size="16" :stroke-width="1.9" /></span>
            <div class="cf__doc-id">
              <button type="button" class="cf__doc-name" @click="viewDoc(d.id)">{{ d.name }}</button>
              <div class="cf__doc-meta">
                {{ FOLDER_LABELS[d.folder] }} · {{ fmt(d.createdAt.slice(0, 10)) }}
                · by {{ personById(d.uploadedBy ?? '')?.fullName ?? 'staff' }}
                <template v-if="d.sizeBytes"> · {{ fmtSize(d.sizeBytes) }}</template>
              </div>
            </div>
            <button
              type="button"
              class="cf__vis"
              :class="{ 'cf__vis--emp': d.employeeVisible, 'cf__vis--locked': d.folder === 'counseling' }"
              :disabled="d.folder === 'counseling'"
              :title="d.folder === 'counseling' ? 'Counseling documents are always staff-only' : 'Toggle whether the employee can see this document'"
              @click="toggleDocVisibility(d.id)"
            >{{ d.folder === 'counseling' ? 'Staff only · locked' : d.employeeVisible ? 'Visible to employee' : 'Clinical staff only' }}</button>
            <button type="button" class="cf__mini" @click="viewDoc(d.id)">
              <Download :size="12" :stroke-width="2" /> View
            </button>
            <button
              type="button"
              class="cf__mini cf__mini--danger"
              @click="deleteDoc(d.id)"
            >
              <Trash2 :size="12" :stroke-width="2" />
              {{ docDeleteArm === d.id ? 'Confirm?' : '' }}
            </button>
          </div>
          <div v-if="myDocs.length === 0" class="cf__card-empty">Nothing in this folder yet.</div>
        </div>

        <div class="cf__uploader">
          <div class="cf__uploader-row">
            <label>Folder
              <select v-model="uploadFolder">
                <option v-for="f in FOLDERS" :key="f" :value="f">{{ FOLDER_LABELS[f] }}</option>
              </select>
            </label>
            <label v-if="uploadFolder !== 'counseling'" class="cf__uploader-check">
              <input v-model="uploadVisible" type="checkbox" />
              Visible to employee
            </label>
            <span v-else class="cf__uploader-locknote">Counseling uploads are always staff-only.</span>
            <button type="button" class="cf__mini cf__mini--primary" :disabled="uploadBusy" @click="fileInput?.click()">
              <Plus :size="12" :stroke-width="2.5" />
              {{ uploadBusy ? 'Uploading…' : 'Upload scanned document' }}
            </button>
            <input ref="fileInput" type="file" accept=".pdf,image/*" style="display:none" @change="onUploadPick" />
          </div>
          <div v-if="uploadError" class="cf__uploader-err">{{ uploadError }}</div>
          <div class="cf__uploader-hint">PDFs and photos (a phone picture of a signed paper form works). Files live in private storage — only clinical editors and, when you flip the toggle, the employee can open them.</div>
        </div>
      </section>

      <!-- Compliance (editors) -->
      <section v-if="tab === 'comp' && canEdit">
        <div class="cf__sectitle" style="margin-top:0">Annual — due every year</div>
        <div class="cf__card">
          <div class="cf__gate">
            <span class="cf__tick" :class="person.record.bloodbornePathogenAt ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="person.record.bloodbornePathogenAt" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">Bloodborne / Airborne Pathogens</span>
            <span class="cf__gate-v">{{ person.record.bloodbornePathogenAt ? fmt(person.record.bloodbornePathogenAt) : 'not on file' }}</span>
          </div>
          <div v-for="req in annualReqs" :key="req.id" class="cf__gate">
            <span class="cf__tick" :class="reqRow(req).st.latest && reqRow(req).st.state === 'ok' ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="reqRow(req).st.latest && reqRow(req).st.state === 'ok'" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">{{ req.name }}</span>
            <span class="cf__gate-v">
              <template v-if="reqRow(req).st.latest">{{ fmt(reqRow(req).st.latest!.completedAt) }}<template v-if="reqRow(req).st.dueAt"> · next due {{ fmt(reqRow(req).st.dueAt) }}</template></template>
              <template v-else>not on file</template>
            </span>
            <button type="button" class="cf__mini" @click="toggleComp(req.id)"><Plus :size="12" :stroke-width="2.5" /> Add</button>
          </div>
        </div>

        <div class="cf__sectitle">Per certification cycle</div>
        <div class="cf__card">
          <div class="cf__gate">
            <span class="cf__tick" :class="juris?.state === 'ok' ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="juris?.state === 'ok'" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">TX EMS Jurisprudence</span>
            <span class="cf__gate-v">
              <template v-if="juris?.state === 'ok'">{{ fmt(person.record.txJurisprudenceAt) }}<template v-if="juris?.requiredBefore"> · cycle ends {{ fmt(juris.requiredBefore) }}</template></template>
              <b v-else-if="juris?.state === 'due'" class="cf__late">due — required before {{ juris.requiredBefore ? fmt(juris.requiredBefore) : 'license renewal' }}</b>
              <template v-else>required before {{ juris?.requiredBefore ? fmt(juris.requiredBefore) : 'license renewal' }}</template>
            </span>
          </div>
          <div v-for="req in cycleReqs" :key="req.id" class="cf__gate">
            <span class="cf__tick" :class="reqRow(req).st.state === 'ok' ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="reqRow(req).st.state === 'ok'" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">{{ req.name }}</span>
            <span class="cf__gate-v">
              <template v-if="reqRow(req).st.state === 'ok'">{{ fmt(reqRow(req).st.latest!.completedAt) }}</template>
              <b v-else-if="reqRow(req).st.state === 'due'" class="cf__late">due — required before {{ reqRow(req).st.dueAt ? fmt(reqRow(req).st.dueAt) : 'license renewal' }}</b>
              <template v-else>required before {{ reqRow(req).st.dueAt ? fmt(reqRow(req).st.dueAt) : 'license renewal' }}</template>
            </span>
            <button type="button" class="cf__mini" @click="toggleComp(req.id)"><Plus :size="12" :stroke-width="2.5" /> Add</button>
          </div>
        </div>
        <div v-if="compOpen" class="cf__compform">
          <span class="cf__compform-l">{{ requirements.find(r => r.id === compOpen)?.name }} — new completion</span>
          <label>Completed <input v-model="compDraft[compOpen].completedAt" type="date" /></label>
          <button type="button" class="cf__mini cf__mini--primary" :disabled="compBusy" @click="submitComp(compOpen)">Save</button>
          <button type="button" class="cf__mini" @click="compOpen = null">Cancel</button>
        </div>
        <div class="cf__note">Cards live on the Credentials tab. This list is driven by the requirements catalog — add an item there and it appears here for every matching level.</div>
      </section>

      <PipelinePersonModal v-if="editingLive" :person="editingLive" @close="editing = false" />
    </template>
  </div>
</template>

<style scoped>
.cf {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .cf { padding: 24px 32px 80px; }
}
.cf__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  padding: 0;
  margin-bottom: 14px;
  cursor: pointer;
}
.cf__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }

.cf__filehead {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: linear-gradient(135deg, var(--color-brand-950) 0%, oklch(0.3 0.06 265) 100%);
  border-radius: 16px;
  padding: 22px 24px;
  color: white;
  box-shadow: 0 8px 24px oklch(0.2 0.03 260 / 0.18);
}
.cf__avatar, .cf__photo {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cf__avatar {
  background: oklch(1 0 0 / 0.08);
  border: 1.5px solid oklch(0.85 0.09 90 / 0.55);
  color: var(--color-accent-on-dark, #e8cb72);
  font-size: 16px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cf__photo { object-fit: cover; border: 1.5px solid oklch(0.85 0.09 90 / 0.55); }
.cf__id { min-width: 220px; }
.cf__name { font-size: 26px; line-height: 1.1; color: white; }
.cf__meta { margin-top: 4px; font-size: 12.5px; color: oklch(0.78 0.02 260); }
.cf__chips { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.cf__chip {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 4px 11px;
  background: oklch(0.85 0.09 90 / 0.16);
  color: var(--color-accent-on-dark, #e8cb72);
}
.cf__chip--gold { background: oklch(0.85 0.09 90 / 0.28); }
.cf__chip--warn { background: oklch(0.6 0.15 30 / 0.3); color: oklch(0.9 0.05 30); }
.cf__edit {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-brand-950);
  background: var(--color-accent-on-dark, #e8cb72);
  border: none;
  border-radius: 9px;
  padding: 9px 15px;
  cursor: pointer;
}

.cf__tabs {
  display: flex;
  gap: 2px;
  border-bottom: 2px solid var(--color-line);
  margin: 18px 0 20px;
  overflow-x: auto;
}
.cf__tab {
  padding: 10px 16px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 140ms var(--ease-out);
}
.cf__tab:hover { color: var(--color-ink-soft); }
.cf__tab--on { color: var(--color-ink); border-color: var(--color-accent-strong, #a8842c); }

.cf__grid2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 900px) { .cf__grid2 { grid-template-columns: 1fr 1fr; align-items: start; } }
.cf__card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 14px;
}
.cf__card-hd {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--color-line);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
}
.cf__cnt {
  background: oklch(0.95 0.04 30);
  color: oklch(0.45 0.15 30);
  border-radius: 999px;
  font-size: 11px;
  padding: 2px 9px;
}
.cf__card-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 16px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.cf__facts { padding: 4px 16px 10px; }
.cf__fact {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 0;
  border-bottom: 1px solid var(--color-surface-soft);
  font-size: 13px;
}
.cf__fact:last-child { border-bottom: none; }
.cf__fact span { color: var(--color-muted); }
.cf__fact b { font-weight: 600; color: var(--color-ink); text-align: right; }
.cf__aitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-surface-soft);
  font-size: 13px;
  color: var(--color-ink-soft);
}
.cf__aitem:last-child { border-bottom: none; }
.cf__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.cf__dot--due { background: oklch(0.5 0.16 30); }
.cf__dot--warn { background: oklch(0.6 0.13 75); }
.cf__dot--info { background: oklch(0.55 0.1 260); }

.cf__gate {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-surface-soft);
  font-size: 13px;
}
.cf__gate:last-child { border-bottom: none; }
.cf__gate--hist { color: var(--color-ink-soft); }
.cf__tick {
  width: 21px;
  height: 21px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 700;
}
.cf__tick--ok { background: oklch(0.95 0.05 150); color: oklch(0.42 0.13 150); }
.cf__tick--open { background: var(--color-surface-soft); color: var(--color-muted); border: 1.5px dashed var(--color-line); }
.cf__tick--warn { background: oklch(0.96 0.05 80); color: oklch(0.48 0.11 75); }
.cf__gate-l { flex: 1; font-weight: 500; color: var(--color-ink); }
.cf__gate-link {
  font-family: var(--font-sans);
  font-size: 13px;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.cf__gate-link:hover { color: var(--color-brand-800); text-decoration: underline; text-underline-offset: 3px; }
.cf__gate-v { font-size: 12px; color: var(--color-muted); text-align: right; font-variant-numeric: tabular-nums; }
.cf__late { color: oklch(0.45 0.15 30); }
.cf__soon { color: oklch(0.48 0.11 75); }

.cf__mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.cf__mini:hover { border-color: var(--color-accent-strong, #a8842c); color: var(--color-ink); }
.cf__mini--primary { background: var(--color-brand-800); border-color: var(--color-brand-800); color: white; }
.cf__mini--danger:hover { border-color: oklch(0.55 0.15 30); color: oklch(0.45 0.15 30); }
.cf__mini:disabled { opacity: 0.5; cursor: not-allowed; }

.cf__compform {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--color-surface);
  border: 1px solid var(--color-accent-strong, #a8842c);
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 14px;
  font-size: 12.5px;
}
.cf__compform-l { font-weight: 700; color: var(--color-ink); }
.cf__compform label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-muted);
}
.cf__compform input {
  font-family: var(--font-sans);
  font-size: 12.5px;
  border: 1.5px solid var(--color-line);
  border-radius: 7px;
  padding: 5px 8px;
  color: var(--color-ink);
  background: var(--color-surface);
}
.cf__sectitle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 20px 0 10px;
}
.cf__sectitle::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.cf__folderbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.cf__folder {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 10px; padding: 8px 14px;
  cursor: pointer; transition: border-color 140ms var(--ease-out), background 140ms var(--ease-out);
}
.cf__folder:hover { border-color: oklch(0.85 0.06 90); }
.cf__folder--on { border-color: var(--color-accent-strong, #a8842c); background: oklch(0.98 0.015 90); color: var(--color-ink); }
.cf__folder-n { font-size: 11px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.cf__docrow {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 11px 16px; border-bottom: 1px solid var(--color-surface-soft);
}
.cf__docrow:last-child { border-bottom: none; }
.cf__doc-ico {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--color-surface-soft); color: var(--color-ink-soft);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cf__doc-id { flex: 1; min-width: 200px; }
.cf__doc-name {
  font-family: var(--font-sans); font-size: 13.5px; font-weight: 600;
  color: var(--color-ink); background: none; border: none; padding: 0;
  cursor: pointer; text-align: left;
}
.cf__doc-name:hover { color: var(--color-brand-800); text-decoration: underline; text-underline-offset: 3px; }
.cf__doc-meta { font-size: 11.5px; color: var(--color-muted); margin-top: 2px; }
.cf__vis {
  font-family: var(--font-sans); font-size: 10.5px; font-weight: 700;
  border-radius: 999px; padding: 4px 11px; cursor: pointer;
  border: 1px solid var(--color-line); background: var(--color-surface-soft);
  color: var(--color-muted); transition: all 140ms var(--ease-out);
}
.cf__vis--emp { background: oklch(0.94 0.03 260); color: oklch(0.35 0.07 260); border-color: oklch(0.85 0.05 260); }
.cf__vis--locked { opacity: 0.6; cursor: not-allowed; }
.cf__uploader {
  border: 1.5px dashed var(--color-line); border-radius: 14px;
  padding: 14px 16px; margin-top: 14px; background: var(--color-surface);
}
.cf__uploader-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.cf__uploader-row label {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; color: var(--color-muted);
}
.cf__uploader-row select {
  font-family: var(--font-sans); font-size: 12.5px; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 8px; padding: 6px 9px;
  background: var(--color-surface);
}
.cf__uploader-check input { accent-color: var(--color-brand-600); }
.cf__uploader-locknote { font-size: 11.5px; color: var(--color-muted); font-style: italic; }
.cf__uploader-err { margin-top: 8px; font-size: 12.5px; color: oklch(0.5 0.16 30); }
.cf__uploader-hint { margin-top: 8px; font-size: 11.5px; line-height: 1.5; color: var(--color-muted); }

.cf__stepper:not(:empty) {
  padding: 2px 0 8px;
  border-bottom: 1px solid var(--color-line-soft);
  margin-bottom: 6px;
}

.cf__trackchip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.cf__trackchip--new { background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260); }
.cf__trackchip--legacy { background: oklch(0.96 0.05 80); color: oklch(0.45 0.1 75); }
.cf__trackchip--rideup { background: oklch(0.95 0.06 90); color: var(--color-accent-strong, #a8842c); }
.cf__trackchip--aemt { background: var(--color-surface-soft); color: var(--color-muted); }
.cf__note {
  background: oklch(0.98 0.015 90);
  border: 1px solid oklch(0.88 0.05 90);
  border-radius: 12px;
  padding: 12px 15px;
  font-size: 12.5px;
  color: oklch(0.42 0.06 80);
  line-height: 1.55;
  margin-bottom: 14px;
}
</style>
