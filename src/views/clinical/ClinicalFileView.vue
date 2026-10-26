<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, FileText, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepTraineeCard from '@/components/clinical/FtepTraineeCard.vue'
import FtepTraineeQuickview from '@/components/clinical/FtepTraineeQuickview.vue'
import AdvancementRecordDrawer from '@/components/clinical/AdvancementRecordDrawer.vue'
import ClinicalCredentialChecklist from '@/components/clinical/ClinicalCredentialChecklist.vue'
import ClinicalRecordDrawer, { type DrawerTarget } from '@/components/clinical/ClinicalRecordDrawer.vue'
import PipelinePersonDetail from '@/components/pipeline/PipelinePersonDetail.vue'
import PipelinePersonModal from '@/components/pipeline/PipelinePersonModal.vue'
import ClinicalMessageThread from '@/components/clinical/ClinicalMessageThread.vue'
import { useExamCertAutoFile } from '@/composables/useExamCertAutoFile'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs, FOLDER_LABELS, type ClinicalDocFolder } from '@/composables/useClinicalDocs'
import { useClinicalEvents } from '@/composables/useClinicalEvents'
import { useExams } from '@/composables/useExams'
import { useFtep } from '@/composables/useFtep'
import { buildFtepTimeline, type FtepTimeline } from '@/composables/useFtepTimeline'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import { generateCompletedExamPdf } from '@/lib/examPrintPdf'
import { supabase } from '@/lib/supabase'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { useClinicalConversations } from '@/composables/useClinicalConversations'
import { usePipeline } from '@/composables/usePipeline'
import { requirementStatus, activeTransitionFor, jurisprudenceStatus, ENROLLMENT_TRACKS } from '@/constants/pipelineGates'
import { generateSkillsDayPacketPdf } from '@/lib/skillsDayPacketPdf'
import { useAuthStore } from '@/stores/auth'
import type { PipelinePerson, PipelineRequirement } from '@/types'

/**
 * One employee's clinical file — the ADAPTIVE file from the approved
 * mockup: identity band with the compliance ring, then only the
 * sections that apply to this person (an EMT never sees ACLS rows or
 * an empty FTEP panel). Every compliance row IS the edit surface —
 * click it and the record drawer opens (record / correct / waive, a
 * card PDF rides into Documents). The right rail carries the activity
 * timeline every console write appends to, the document cabinet, and
 * the message thread. Field training embeds the same V6 trainee card,
 * credentialing checklist, Advancement Record and megacode runner the
 * FTEP and Exams pages use — one system, one file.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
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
  ftepTrackFor,
  manualRideouts,
} = useClinical()

const skills = useSkillsDay()
const { saveRecord, promote } = usePipeline()
const ftep = useFtep()
const events = useClinicalEvents()

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

function fmtMY(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const attention = computed(() => (person.value ? attentionFor(person.value) : []))
const juris = computed(() => (person.value ? jurisprudenceStatus(person.value.record) : null))

/* ── Compliance rows — every row opens the record drawer ───────────── */

interface FileRow {
  key: string
  label: string
  dates: string
  src: string
  state: 'ok' | 'soon' | 'bad' | 'req'
  stLabel: string
  target: DrawerTarget
}

const DAY = 86_400_000
function daysUntil(iso: string): number {
  return Math.ceil((new Date(`${iso}T00:00:00`).getTime() - Date.now()) / DAY)
}

const cardReqs = computed<PipelineRequirement[]>(() =>
  person.value ? requirementsFor(person.value).filter((r) => r.cycle === 'certification') : [],
)
const agencyReqs = computed<PipelineRequirement[]>(() =>
  person.value
    ? requirementsFor(person.value).filter((r) => r.cycle === 'annual' || r.cycle === 'per_cert_cycle' || r.cycle === 'one_time')
    : [],
)

function reqFileRow(req: PipelineRequirement): FileRow {
  const p = person.value!
  const st = requirementStatus(req, completionsFor(p.userId), p.record)
  const required = missingRequired(p).some((m) => m.id === req.id)
  const waived = st.latest?.source === 'waived'
  const base = {
    key: req.id,
    label: req.name,
    src: waived ? 'waived' : (st.latest?.source ?? '—'),
    target: { kind: 'requirement', req } as DrawerTarget,
  }
  if (!st.latest) {
    return {
      ...base,
      dates: 'no record on file',
      state: required ? 'req' : st.state === 'required' ? 'soon' : 'bad',
      stLabel: required ? 'REQUIRED' : st.state === 'required' ? (st.dueAt ? `by ${fmtMY(st.dueAt)}` : 'this cycle') : 'due',
    }
  }
  const dates =
    req.cycle === 'certification' && st.latest.expiresAt
      ? `expires ${fmtMY(st.latest.expiresAt)}`
      : waived
        ? `waived ${fmtMY(st.latest.completedAt)}`
        : `done ${fmtMY(st.latest.completedAt)}${st.dueAt ? ` · next ${fmtMY(st.dueAt)}` : ''}`
  if (st.state === 'ok') return { ...base, dates, state: 'ok', stLabel: 'current' }
  if (st.state === 'expiring') {
    const d = st.dueAt ? daysUntil(st.dueAt) : null
    return { ...base, dates, state: 'soon', stLabel: d !== null ? `in ${d}d` : 'expiring' }
  }
  if (st.state === 'required')
    return { ...base, dates, state: 'soon', stLabel: st.dueAt ? `by ${fmtMY(st.dueAt)}` : 'this cycle' }
  const over = st.dueAt ? -daysUntil(st.dueAt) : null
  return { ...base, dates, state: 'bad', stLabel: over !== null && over > 0 ? `expired ${over}d` : 'due' }
}

const licenseRows = computed<FileRow[]>(() => {
  const p = person.value
  if (!p) return []
  const rows: FileRow[] = []
  const exp = p.record.txLicenseExpiresAt
  const licDates = p.record.txLicenseNumber
    ? `#${p.record.txLicenseNumber}${exp ? ` · expires ${fmtMY(exp)}` : ''}`
    : exp
      ? `expires ${fmtMY(exp)}`
      : 'no license dates on file'
  let licState: FileRow['state'] = 'ok'
  let licLabel = 'current'
  if (!exp) {
    licState = 'req'
    licLabel = 'needs dates'
  } else {
    const d = daysUntil(exp)
    if (d < 0) { licState = 'bad'; licLabel = `expired ${-d}d` }
    else if (d <= 90) { licState = 'soon'; licLabel = `in ${d}d` }
  }
  rows.push({ key: 'license', label: 'TX certification', dates: licDates, src: 'record', state: licState, stLabel: licLabel, target: { kind: 'license' } })

  const j = juris.value
  rows.push({
    key: 'juris',
    label: 'TX EMS Jurisprudence',
    dates: p.record.txJurisprudenceAt ? `done ${fmtMY(p.record.txJurisprudenceAt)}` : 'not this cycle',
    src: 'record',
    state: j?.state === 'ok' ? 'ok' : j?.state === 'due' ? 'bad' : 'soon',
    stLabel: j?.state === 'ok' ? 'current' : j?.state === 'due' ? 'due' : j?.requiredBefore ? `by ${fmtMY(j.requiredBefore)}` : 'this cycle',
    target: { kind: 'jurisprudence' },
  })

  const bbp = p.record.bloodbornePathogenAt
  let bbpState: FileRow['state'] = 'req'
  let bbpLabel = 'REQUIRED'
  let bbpDates = 'not on file'
  if (bbp) {
    const due = new Date(`${bbp}T00:00:00`)
    due.setFullYear(due.getFullYear() + 1)
    const d = Math.ceil((due.getTime() - Date.now()) / DAY)
    bbpDates = `done ${fmtMY(bbp)} · next ${fmtMY(due.toISOString().slice(0, 10))}`
    if (d < 0) { bbpState = 'bad'; bbpLabel = `overdue ${-d}d` }
    else if (d <= 60) { bbpState = 'soon'; bbpLabel = `in ${d}d` }
    else { bbpState = 'ok'; bbpLabel = 'current' }
  }
  rows.push({ key: 'bbp', label: 'Bloodborne / Airborne Pathogens', dates: bbpDates, src: 'record', state: bbpState, stLabel: bbpLabel, target: { kind: 'bbp' } })
  return rows
})

const cardRows = computed<FileRow[]>(() => cardReqs.value.map(reqFileRow))
const agencyRows = computed<FileRow[]>(() => agencyReqs.value.map(reqFileRow))

/* Ring: share of tracked items that are current (ok, or inside their
   expiring window — the card is still valid). */
const ringPct = computed(() => {
  const rows = [...licenseRows.value, ...cardRows.value, ...agencyRows.value]
  if (!rows.length) return 100
  const cur = rows.filter((r) => r.state === 'ok' || r.state === 'soon').length
  return Math.round((cur / rows.length) * 100)
})
const nextRenewal = computed(() => {
  const p = person.value
  if (!p) return null
  const dated: { label: string; at: string }[] = []
  if (p.record.txLicenseExpiresAt && daysUntil(p.record.txLicenseExpiresAt) >= 0)
    dated.push({ label: 'TX certification', at: p.record.txLicenseExpiresAt })
  for (const req of cardReqs.value) {
    const st = requirementStatus(req, completionsFor(p.userId), p.record)
    if (st.dueAt && daysUntil(st.dueAt) >= 0) dated.push({ label: req.name, at: st.dueAt })
  }
  dated.sort((a, b) => a.at.localeCompare(b.at))
  return dated[0] ?? null
})

/* The banner and the ring read the SAME rows — a green "all current"
   over red rows is exactly the incoherence this rebuild removes. */
const allClear = computed(() =>
  [...licenseRows.value, ...cardRows.value, ...agencyRows.value].every(
    (r) => r.state === 'ok' || r.state === 'soon',
  ),
)

const recordTarget = ref<DrawerTarget | null>(null)
function openRow(r: FileRow) {
  if (!canEdit.value) return
  recordTarget.value = r.target
}

/* ── Access flags ───────────────────────────────────────────────────── */
const accessBusy = ref(false)
async function toggleAccess(key: 'opIqAccess' | 'narcSafeAccess') {
  const p = person.value
  if (!p || !canEdit.value || accessBusy.value) return
  accessBusy.value = true
  try {
    const had = p.record[key]
    await saveRecord({ userId: p.userId, [key]: !had })
    await events.log(p.userId, 'record_updated', `${key === 'opIqAccess' ? 'Operative IQ' : 'NarcSafe'} access ${had ? 'removed' : 'granted'}`)
  } finally {
    accessBusy.value = false
  }
}

/* ── Header actions: enroll / promote / edit / exclude ──────────────── */
const editing = ref(false)
const editingLive = computed(() => (editing.value ? person.value : null))
const actionsOpen = ref(false)
const enrollOpen = ref(false)
const enroll = reactive({
  trackKey: '',
  startedAt: new Date().toISOString().slice(0, 10),
  targetAt: '',
  targetTouched: false,
  busy: false,
})
const enrollTrack = computed(() => ENROLLMENT_TRACKS.find((t) => t.key === enroll.trackKey) ?? null)
watch(
  () => [enroll.trackKey, enroll.startedAt],
  () => {
    if (enroll.targetTouched || !enrollTrack.value || !enroll.startedAt) return
    const d = new Date(`${enroll.startedAt}T00:00:00`)
    d.setDate(d.getDate() + enrollTrack.value.days)
    enroll.targetAt = d.toISOString().slice(0, 10)
  },
)
function openEnroll() {
  actionsOpen.value = false
  enroll.trackKey = ''
  enroll.startedAt = new Date().toISOString().slice(0, 10)
  enroll.targetAt = ''
  enroll.targetTouched = false
  enroll.busy = false
  enrollOpen.value = true
}
async function saveEnroll() {
  const p = person.value
  const track = enrollTrack.value
  if (!p || !track || enroll.busy) return
  enroll.busy = true
  try {
    await saveRecord({
      userId: p.userId,
      ...track.patch,
      workingStartedAt: enroll.startedAt || null,
      workingTargetAt: enroll.targetAt || null,
      pending: false,
    })
    await events.log(p.userId, 'enrolled', `Enrolled — ${track.label} (start ${fmt(enroll.startedAt)})`)
    enrollOpen.value = false
    void buildTl()
  } finally {
    enroll.busy = false
  }
}
const promoteBusy = ref(false)
async function doPromote() {
  const p = person.value
  if (!p?.record.workingPhase || promoteBusy.value) return
  actionsOpen.value = false
  if (!confirm(`Promote ${p.fullName}: cleared ${p.record.workingPhase}?`)) return
  promoteBusy.value = true
  try {
    const phase = p.record.workingPhase
    await promote(p)
    await events.log(p.userId, 'promoted', `Credentialed — cleared ${phase}`)
  } finally {
    promoteBusy.value = false
  }
}
async function toggleExcluded() {
  const p = person.value
  if (!p || !canEdit.value) return
  actionsOpen.value = false
  const excluding = !p.record.clinicalExcluded
  if (
    excluding &&
    !confirm(
      `Exclude ${p.fullName} from clinical tracking? They drop off the clinical roster, Action Center and compliance emails until re-included from this page.`,
    )
  )
    return
  await saveRecord({ userId: p.userId, clinicalExcluded: excluding })
}

/* ── Field training ─────────────────────────────────────────────────── */

function hasPhaseLadder(p: PipelinePerson): boolean {
  const t = activeTransitionFor(p.record)
  const paramedic = /emt-p|^lp$/i.test(p.record.certLevel ?? '')
  return ((t === 'NEOP' || t === 'P1C_P1') && paramedic) || t === 'P1_P2'
}

const tl = ref<FtepTimeline | null>(null)
const tlBusy = ref(false)
async function buildTl() {
  const p = person.value
  if (!p || !hasPhaseLadder(p)) {
    tl.value = null
    return
  }
  if (tlBusy.value) return
  tlBusy.value = true
  try {
    tl.value = await buildFtepTimeline(p)
  } catch {
    tl.value = null
  } finally {
    tlBusy.value = false
  }
}
watch(person, () => void buildTl(), { immediate: true })

/* ── Clinical conversations — documentation log for this employee ──── */
const convs = useClinicalConversations()
const myConversations = computed(() => (person.value ? convs.listFor(person.value.userId) : []))
watch(
  person,
  (p) => {
    if (p) void convs.loadFor(p.userId)
  },
  { immediate: true },
)
function conversationSigState(c: (typeof myConversations.value)[number]): string {
  if (!c.requireSignatures) return ''
  const signed = c.participants.filter((p) => p.signatureData).length
  return `${signed}/${c.participants.length} signed`
}

const quickview = ref<PipelinePerson | null>(null)
const advOpen = ref(false)

/** "Start credentialing" from the embedded card — the checklist and
 *  exam assignment are right on this page; bring them into view. */
function scrollToExams() {
  document.getElementById('cf-exams')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const myReports = computed(() => {
  const p = person.value
  if (!p) return []
  return ftep.submittedFor(p.userId).sort((a, b) => b.evalDate.localeCompare(a.evalDate))
})
const historyOpen = ref(false)
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

const rideouts = computed(() => {
  const p = person.value
  if (!p) return { dors: 0, manual: 0, count: 0 }
  const dors = ftep.activeDors(p.userId).length
  const manual = manualRideouts(p)
  return { dors, manual, count: Math.max(dors, manual) }
})

/* Advancement Records + megacode history for this person. */
interface AdvRow { id: string; from: string; to: string | null; effective: string; createdAt: string }
const advRows = ref<AdvRow[]>([])
interface McRow { id: string; title: string; passed: boolean | null; at: string | null }
const mcRows = ref<McRow[]>([])
watch(
  person,
  async (p) => {
    advRows.value = []
    mcRows.value = []
    if (!p || auth.usingDevStub) return
    const [aRes, mRes] = await Promise.all([
      supabase
        .from('ftep_advancement_records')
        .select('id, from_phase_key, to_phase_key, effective_date, created_at')
        .eq('record_id', p.record.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('megacode_runs')
        .select('id, scenario_title, passed, completed_at')
        .eq('user_id', p.userId)
        .order('started_at', { ascending: false }),
    ])
    advRows.value = (aRes.data ?? []).map((r) => ({
      id: r.id as string,
      from: r.from_phase_key as string,
      to: (r.to_phase_key ?? null) as string | null,
      effective: r.effective_date as string,
      createdAt: r.created_at as string,
    }))
    mcRows.value = (mRes.data ?? []).map((r) => ({
      id: r.id as string,
      title: r.scenario_title as string,
      passed: (r.passed ?? null) as boolean | null,
      at: (((r.completed_at as string | null) ?? '').slice(0, 10)) || null,
    }))
  },
  { immediate: true },
)

const PHASE_NAMES: Record<string, string> = {
  phase0: 'NEOP Academy', phase1: 'EMT Orientation', phase2: 'Clinical Integration',
  phase3: 'Partner Phase', phase4: 'Final Evaluation', phase5: 'P2 Development',
  phase6: 'Ghost Phase', phase7: 'P2 Final Evaluation',
}
const gatesOpen = ref(false)

const showFtep = computed(() => {
  const p = person.value
  if (!p) return false
  return activeTransitionFor(p.record) !== null || myReports.value.length > 0 || advRows.value.length > 0
})

/* ── Activity rail ──────────────────────────────────────────────────── */
watch(
  person,
  (p) => {
    if (p) void events.loadFor(p.userId)
  },
  { immediate: true },
)
const activity = computed(() => (person.value ? events.eventsFor(person.value.userId) : []))
function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Protocol exams (editors assign / release / results) ────────────── */
const exams = useExams()
const { certNameFor } = useExamCertAutoFile()

const examPrintBusy = ref<string | null>(null)
async function printExam(a: (typeof myExamAssignments)['value'][number]) {
  const d = exams.definitionById(a.examId)
  const p = person.value
  if (!d || !p || examPrintBusy.value) return
  examPrintBusy.value = a.id
  try {
    const { data, error } = await supabase.rpc('exam_review', { p_assignment: a.id })
    if (error) throw new Error(error.message)
    const missed = new Set<number>((data ?? []).map((r: { no: number }) => Number(r.no)))
    const doc = await generateCompletedExamPdf({
      definition: d,
      assignment: a,
      candidateName: p.fullName,
      missed,
      imageUrlFor: async (q) => {
        if (!q.image || !d.slug) return null
        const { data: u } = await supabase.storage.from('exam-assets').createSignedUrl(`${d.slug}/${q.image}`, 600)
        return u?.signedUrl ?? null
      },
    })
    const safe = p.fullName.replace(/[^A-Za-z0-9]+/g, '_')
    doc.save(`WCEMS_Completed_Exam_${d.slug ?? 'exam'}_${safe}_${(a.submittedAt ?? '').slice(0, 10)}.pdf`)
  } catch (e) {
    alert(`Could not build the exam printout: ${(e as Error).message}`)
  } finally {
    examPrintBusy.value = null
  }
}

function examCertDoc(a: { userId: string } & Parameters<typeof certNameFor>[0]) {
  const name = certNameFor(a)
  return clindocs
    .docsFor(a.userId)
    .find((d) => (d.folder === 'protocol_exams' || d.folder === 'certs') && d.name === name)
}
async function viewExamCert(a: Parameters<typeof certNameFor>[0]) {
  const doc = examCertDoc(a)
  if (!doc) return
  const res = await clindocs.openDoc(doc)
  if (res.ok) window.open(res.url, '_blank', 'noopener')
}
const myExamAssignments = computed(() =>
  person.value ? exams.assignmentsFor(person.value.userId).filter((a) => a.status !== 'cancelled') : [],
)
const examToAssign = ref('')
const examBusy = ref(false)
const examError = ref<string | null>(null)
async function assignExam() {
  const p = person.value
  if (!p || !examToAssign.value || examBusy.value) return
  examBusy.value = true
  examError.value = null
  const res = await exams.assign(examToAssign.value, p.userId)
  examBusy.value = false
  if (!res.ok) { examError.value = res.error ?? 'Failed.'; return }
  examToAssign.value = ''
}
async function releaseExam(id: string) {
  if (examBusy.value) return
  examBusy.value = true
  await exams.release(id)
  examBusy.value = false
}
async function cancelExam(id: string) {
  if (examBusy.value) return
  examBusy.value = true
  await exams.cancel(id)
  examBusy.value = false
}
const EXAM_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned — awaiting release',
  released: 'Released — ready to begin',
  in_progress: 'In progress',
  submitted: 'Submitted',
}

/* ── Skills ─────────────────────────────────────────────────────────── */
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

/* ── Documents rail ─────────────────────────────────────────────────── */
const clindocs = useClinicalDocs()
const docFolder = ref<ClinicalDocFolder | 'all'>('all')
const FOLDERS = Object.keys(FOLDER_LABELS) as ClinicalDocFolder[]
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
      <!-- Identity band -->
      <header class="cf__band">
        <img v-if="person.photoUrl" :src="person.photoUrl" class="cf__photo" alt="" />
        <span v-else class="cf__mono">{{ initials(person.fullName) }}</span>
        <div class="cf__id">
          <h1 class="display cf__name">{{ person.fullName }}</h1>
          <div class="cf__meta">
            <b>{{ person.record.certLevel ?? '—' }}</b>
            <template v-if="person.record.level"> · {{ person.record.level }}</template>
            <template v-if="person.station"> · {{ person.station }}</template>
            <template v-if="person.shift"> · {{ person.shift }} shift</template>
            · {{ statusChip(person).text }}
            <template v-if="person.record.ftoName"> · FTO {{ person.record.ftoName }}</template>
          </div>
          <div class="cf__chips">
            <span v-if="person.record.isFto" class="cf__chip cf__chip--gold">FTO</span>
            <span v-if="person.record.pipActive" class="cf__chip cf__chip--warn">PIP</span>
            <span v-if="person.record.clinicalExcluded" class="cf__chip cf__chip--warn">NOT TRACKED</span>
          </div>
        </div>
        <div class="cf__ringwrap">
          <div class="cf__ring" :class="{ 'cf__ring--bad': ringPct < 100 }" :style="{ '--p': ringPct }">
            <span>{{ ringPct }}%</span>
          </div>
          <div class="cf__ring-l">current</div>
        </div>
        <div v-if="canEdit" class="cf__actionswrap">
          <button type="button" class="cf__edit" @click="actionsOpen = !actionsOpen">
            <Pencil :size="13" :stroke-width="2" />
            Actions
            <ChevronDown :size="13" :stroke-width="2" />
          </button>
          <div v-if="actionsOpen" class="cf__menu">
            <button type="button" class="cf__menu-it" @click="openEnroll">Enroll in a program track…</button>
            <button v-if="person.record.workingPhase" type="button" class="cf__menu-it" @click="doPromote">
              Promote — clear {{ person.record.workingPhase }}
            </button>
            <button type="button" class="cf__menu-it" @click="editing = true; actionsOpen = false">Edit full record</button>
            <button type="button" class="cf__menu-it cf__menu-it--dim" @click="toggleExcluded">
              {{ person.record.clinicalExcluded ? 'Include in clinical tracking' : 'Exclude from clinical tracking' }}
            </button>
          </div>
        </div>
      </header>
      <div v-if="actionsOpen" class="cf__menu-veil" @click="actionsOpen = false"></div>

      <div v-if="enrollOpen && canEdit" class="cf__enroll">
        <span class="cf__enroll-t">Enroll in a program track</span>
        <select v-model="enroll.trackKey" class="cf__enroll-sel">
          <option value="" disabled>Select track…</option>
          <option v-for="t in ENROLLMENT_TRACKS" :key="t.key" :value="t.key">{{ t.label }}</option>
        </select>
        <label class="cf__enroll-f">Start <input v-model="enroll.startedAt" type="date" class="cf__inline-date" /></label>
        <label class="cf__enroll-f">Target <input v-model="enroll.targetAt" type="date" class="cf__inline-date" @input="enroll.targetTouched = true" /></label>
        <span v-if="enrollTrack?.hint" class="cf__enroll-hint">{{ enrollTrack.hint }}</span>
        <span class="cf__enroll-btns">
          <button type="button" class="cf__mini cf__mini--primary" :disabled="!enrollTrack || enroll.busy" @click="saveEnroll">Enroll</button>
          <button type="button" class="cf__mini" @click="enrollOpen = false">Cancel</button>
        </span>
      </div>

      <!-- All clear -->
      <div v-if="allClear && attention.length === 0" class="cf__allgood">
        <Check :size="15" :stroke-width="2.5" />
        Everything tracked for {{ person.fullName.split(' ')[0] }} is current<template v-if="nextRenewal"> — next renewal: {{ nextRenewal.label }} · {{ fmtMY(nextRenewal.at) }}</template>.
      </div>

      <div class="cf__grid">
        <!-- ── Main column ── -->
        <div class="cf__main">
          <!-- Licensure -->
          <div class="cf__sectitle">Licensure</div>
          <div class="cf__panel">
            <button v-for="r in licenseRows" :key="r.key" type="button" class="cf__frow" @click="openRow(r)">
              <span class="cf__frow-item"><span class="cf__fdot" :class="`cf__fdot--${r.state}`"></span>{{ r.label }}</span>
              <span class="cf__frow-dates">{{ r.dates }}</span>
              <span class="cf__frow-src">{{ r.src }}</span>
              <span class="cf__frow-st" :class="`cf__st--${r.state}`">{{ r.stLabel }}</span>
              <ChevronRight v-if="canEdit" class="cf__frow-chev" :size="13" :stroke-width="2" />
            </button>
          </div>

          <!-- Cards -->
          <template v-if="cardRows.length">
            <div class="cf__sectitle">Required cards — {{ person.record.certLevel ?? 'all levels' }}</div>
            <div class="cf__panel">
              <button v-for="r in cardRows" :key="r.key" type="button" class="cf__frow" @click="openRow(r)">
                <span class="cf__frow-item"><span class="cf__fdot" :class="`cf__fdot--${r.state}`"></span>{{ r.label }}</span>
                <span class="cf__frow-dates">{{ r.dates }}</span>
                <span class="cf__frow-src">{{ r.src }}</span>
                <span class="cf__frow-st" :class="`cf__st--${r.state}`">{{ r.stLabel }}</span>
                <ChevronRight v-if="canEdit" class="cf__frow-chev" :size="13" :stroke-width="2" />
              </button>
            </div>
          </template>

          <!-- Agency -->
          <template v-if="agencyRows.length">
            <div class="cf__sectitle">Agency requirements</div>
            <div class="cf__panel">
              <button v-for="r in agencyRows" :key="r.key" type="button" class="cf__frow" @click="openRow(r)">
                <span class="cf__frow-item"><span class="cf__fdot" :class="`cf__fdot--${r.state}`"></span>{{ r.label }}</span>
                <span class="cf__frow-dates">{{ r.dates }}</span>
                <span class="cf__frow-src">{{ r.src }}</span>
                <span class="cf__frow-st" :class="`cf__st--${r.state}`">{{ r.stLabel }}</span>
                <ChevronRight v-if="canEdit" class="cf__frow-chev" :size="13" :stroke-width="2" />
              </button>
              <div class="cf__accessrow">
                <button type="button" class="cf__access" :disabled="accessBusy" @click="toggleAccess('opIqAccess')">
                  <span class="cf__fdot" :class="person.record.opIqAccess ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                  Operative IQ — <b>{{ person.record.opIqAccess ? 'held' : 'not held' }}</b>
                  <em v-if="canEdit">tap to toggle</em>
                </button>
                <button type="button" class="cf__access" :disabled="accessBusy" @click="toggleAccess('narcSafeAccess')">
                  <span class="cf__fdot" :class="person.record.narcSafeAccess ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                  NarcSafe — <b>{{ person.record.narcSafeAccess ? 'held' : 'not held' }}</b>
                  <em v-if="canEdit">tap to toggle</em>
                </button>
              </div>
            </div>
          </template>

          <!-- Field training (adaptive) -->
          <template v-if="showFtep">
            <div class="cf__sectitle">
              Field training
              <span v-if="ftepTrackFor(person)" class="cf__trackchip">{{ ftepTrackFor(person)!.label }}</span>
            </div>

            <FtepTraineeCard
              v-if="hasPhaseLadder(person) && activeTransitionFor(person.record)"
              :person="person"
              :timeline="tl"
              :can-edit="canEdit"
              @advance="advOpen = true"
              @quickview="quickview = person"
              @refresh="buildTl()"
              @report="(k) => router.push(`/clinical/ftep/${k}/${person!.userId}`)"
              @credential="scrollToExams"
            />

            <!-- Track rollups for the non-ladder tracks -->
            <div v-else-if="activeTransitionFor(person.record)" class="cf__panel cf__panel--pad">
              <template v-if="ftepTrackFor(person)?.key === 'rideup'">
                <div class="cf__roll">
                  <span class="cf__fdot" :class="rideouts.count >= 4 ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                  12-hr supervisor rideouts — <b>{{ rideouts.count }} of 4</b>
                  <template v-if="rideouts.manual > rideouts.dors"> · {{ rideouts.manual }} recorded manually (pre-portal)</template>
                </div>
                <div class="cf__roll">
                  <span class="cf__fdot cf__fdot--soon"></span>
                  Skills check-offs — set to be built · no ICR requirement on this track
                </div>
              </template>
              <template v-else-if="ftepTrackFor(person)?.key === 'legacy'">
                <div class="cf__roll">
                  <span class="cf__fdot" :class="ftep.icrCount(person.userId, ftepTrackFor(person)?.legacyPhase) >= 10 ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                  Call evaluations toward {{ ftepTrackFor(person)?.legacyPhase === 'P1' ? 'P1 credentialing' : 'P2 in-charge' }}
                  — <b>{{ ftep.icrCount(person.userId, ftepTrackFor(person)?.legacyPhase) }} of 10</b> · each rung needs its own 10
                </div>
              </template>
              <template v-else>
                <div class="cf__roll">
                  <span class="cf__fdot cf__fdot--soon"></span>
                  {{ ftepTrackFor(person)?.label }} — day tracking runs from the FTEP page for this track
                </div>
              </template>
            </div>

            <!-- Credentialing checklist (surfaces for transitions that have one) -->
            <ClinicalCredentialChecklist v-if="canEdit" :person="person" @megacode="router.push(`/clinical/megacode/${person.userId}`)" />

            <!-- Advancement Records -->
            <div v-if="advRows.length" class="cf__panel cf__panel--pad">
              <div class="cf__panel-hd">Phase Advancement Records</div>
              <div v-for="a in advRows" :key="a.id" class="cf__roll">
                <span class="cf__fdot cf__fdot--ok"></span>
                {{ PHASE_NAMES[a.from] ?? a.from }} → {{ a.to ? (PHASE_NAMES[a.to] ?? a.to) : 'program complete' }}
                — effective {{ fmt(a.effective) }}
                <span class="cf__roll-src">PDF in Documents</span>
              </div>
            </div>

            <!-- Megacodes -->
            <div v-if="mcRows.length" class="cf__panel cf__panel--pad">
              <div class="cf__panel-hd">Megacode evaluations</div>
              <div v-for="m in mcRows" :key="m.id" class="cf__roll">
                <span class="cf__fdot" :class="m.passed ? 'cf__fdot--ok' : 'cf__fdot--bad'"></span>
                {{ m.title }} — <b :class="m.passed ? 'cf__st--ok' : 'cf__st--bad'">{{ m.passed ? 'Pass' : 'Unsuccessful' }}</b>
                <template v-if="m.at"> · {{ fmt(m.at) }}</template>
                <span class="cf__roll-src">signed PDF in Documents</span>
              </div>
            </div>

            <!-- Report history -->
            <div v-if="myReports.length" class="cf__panel cf__panel--pad">
              <button type="button" class="cf__histtoggle" @click="historyOpen = !historyOpen">
                <ChevronDown class="cf__chev" :class="{ 'cf__chev--open': historyOpen }" :size="14" :stroke-width="2" />
                Report history — {{ myReports.length }} on file (DORs · ICRs · call evals)
              </button>
              <template v-if="historyOpen">
                <div v-for="r in myReports" :key="r.id" class="cf__roll">
                  <template v-if="r.payload.legacyManual">
                    <span class="cf__roll-l">Call eval (Jotform) · {{ fmt(r.evalDate) }}</span>
                    <span class="cf__roll-meta"><template v-if="r.payload.legacyPhase">→ {{ r.payload.legacyPhase }} rung · </template>recorded by {{ personById(r.evaluatorId)?.fullName ?? '—' }}</span>
                  </template>
                  <template v-else>
                    <button type="button" class="cf__roll-link" title="Open the report PDF" @click="ftepPdf(r.id, 'view')">
                      {{ r.kind.toUpperCase() }} · {{ fmt(r.evalDate) }}
                    </button>
                    <span class="cf__roll-meta">
                      <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
                      <b v-if="r.payload.nrtFlagged" class="cf__st--bad">NRT · </b>by {{ personById(r.evaluatorId)?.fullName ?? '—' }}
                      <template v-if="r.kind === 'icr' && r.payload.countsToward10 === false"> · <b class="cf__st--bad">excluded</b></template>
                      <b v-if="!r.traineeSignature" class="cf__st--soon"> · awaiting trainee signature</b>
                    </span>
                    <button type="button" class="cf__mini" :disabled="ftepPdfBusy === r.id" @click="ftepPdf(r.id, 'download')">
                      <Download :size="12" :stroke-width="2" /> PDF
                    </button>
                  </template>
                </div>
              </template>
            </div>

            <!-- Gates & record detail -->
            <div class="cf__panel cf__panel--pad">
              <button type="button" class="cf__histtoggle" @click="gatesOpen = !gatesOpen">
                <ChevronDown class="cf__chev" :class="{ 'cf__chev--open': gatesOpen }" :size="14" :stroke-width="2" />
                Credentialing gates &amp; record detail
              </button>
              <div v-if="gatesOpen" class="cf__gateswrap">
                <PipelinePersonDetail :person="person" />
              </div>
            </div>
          </template>

          <!-- Protocol exams -->
          <template v-if="canEdit">
            <div id="cf-exams" class="cf__sectitle">Protocol examinations</div>
            <div class="cf__panel cf__panel--pad">
              <div v-for="a in myExamAssignments" :key="a.id" class="cf__roll">
                <span class="cf__fdot" :class="a.status === 'submitted' ? (a.passed ? 'cf__fdot--ok' : 'cf__fdot--bad') : 'cf__fdot--soon'"></span>
                {{ exams.definitionById(a.examId)?.title ?? 'Examination' }}
                <span class="cf__roll-meta">
                  <template v-if="a.status === 'submitted'">
                    {{ a.scorePct?.toFixed(1) }}% — <b :class="a.passed ? 'cf__st--ok' : 'cf__st--bad'">{{ a.passed ? 'passed' : 'not passed' }}</b>
                    <template v-if="(a.criticalMissed?.length ?? 0) > 0"> · {{ a.criticalMissed!.length }} critical missed</template>
                    · {{ fmt((a.submittedAt ?? '').slice(0, 10)) }}
                  </template>
                  <template v-else>{{ EXAM_STATUS_LABELS[a.status] ?? a.status }}</template>
                </span>
                <span class="cf__roll-actions">
                  <button v-if="a.status === 'submitted' && a.passed && examCertDoc(a)" type="button" class="cf__mini" @click="viewExamCert(a)">Certificate</button>
                  <button v-if="a.status === 'submitted'" type="button" class="cf__mini" :disabled="examPrintBusy === a.id" @click="printExam(a)">
                    {{ examPrintBusy === a.id ? 'Building…' : 'Completed exam' }}
                  </button>
                  <button v-if="a.status === 'assigned'" type="button" class="cf__mini cf__mini--primary" :disabled="examBusy" @click="releaseExam(a.id)">Release</button>
                  <button v-if="a.status === 'assigned' || a.status === 'released'" type="button" class="cf__mini" :disabled="examBusy" @click="cancelExam(a.id)">Cancel</button>
                </span>
              </div>
              <div v-if="myExamAssignments.length === 0" class="cf__quiet">No exams assigned.</div>
              <div class="cf__assign">
                <select v-model="examToAssign">
                  <option value="" disabled>Assign an examination…</option>
                  <option v-for="d in exams.activeDefinitions.value" :key="d.id" :value="d.id">{{ d.title }}</option>
                </select>
                <button type="button" class="cf__mini cf__mini--primary" :disabled="!examToAssign || examBusy" @click="assignExam">
                  <Plus :size="12" :stroke-width="2.5" /> Assign
                </button>
                <span v-if="examError" class="cf__st--bad">{{ examError }}</span>
              </div>
            </div>
          </template>

          <!-- Clinical conversations -->
          <template v-if="canEdit">
            <div class="cf__sectitle">
              Clinical conversations
              <button
                type="button"
                class="cf__lnk"
                style="margin-left: auto"
                @click="router.push(`/clinical/conversation/new?user=${person.userId}`)"
              >Log conversation</button>
            </div>
            <div class="cf__panel cf__panel--pad">
              <div v-for="c in myConversations" :key="c.id" class="cf__roll">
                <span class="cf__fdot" :class="c.response ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                {{ fmt(c.occurredAt.slice(0, 10)) }}
                <template v-if="c.callType"> · {{ c.callType }}</template>
                <template v-if="c.incidentNumber"> · #{{ c.incidentNumber }}</template>
                <span class="cf__roll-meta">
                  by {{ c.createdByName || '—' }}
                  <template v-if="c.requireSignatures"> · {{ conversationSigState(c) }}</template>
                  · {{ c.response ? 'employee commented' : 'no employee comments yet' }}
                </span>
                <span class="cf__roll-actions">
                  <button type="button" class="cf__mini" @click="router.push(`/clinical/conversation/${c.id}`)">Open</button>
                </span>
              </div>
              <div v-if="myConversations.length === 0" class="cf__quiet">
                Nothing documented yet — conversations logged here notify the employee and give
                them space to add their own comments. Not disciplinary.
              </div>
            </div>
          </template>

          <!-- Skills (adaptive) -->
          <template v-if="myEvals.length">
            <div class="cf__sectitle">
              Skills Day
              <button type="button" class="cf__lnk" style="margin-left: auto" :disabled="packetBusy" @click="downloadPacket">
                {{ packetBusy ? 'Generating…' : 'Skills packet PDF' }}
              </button>
            </div>
            <div class="cf__panel cf__panel--pad">
              <div v-for="row in myEvals" :key="row.e.id" class="cf__roll">
                <span class="cf__fdot" :class="row.redo === 0 ? 'cf__fdot--ok' : 'cf__fdot--soon'"></span>
                {{ row.checkoff?.title ?? 'Check-off' }}
                <span class="cf__roll-meta">
                  {{ row.redo === 0 ? 'Pass' : `${row.redo} item${row.redo === 1 ? '' : 's'} to redo` }}
                  · {{ skills.nameFor(row.e.evaluatorId) }} · {{ fmtDateTime(row.e.submittedAt) }}
                </span>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Rail ── -->
        <div class="cf__rail">
          <div class="cf__sectitle">Recent activity</div>
          <div class="cf__panel cf__panel--pad">
            <div v-for="ev in activity.slice(0, 14)" :key="ev.id" class="cf__act">
              <span class="cf__act-d">{{ fmtShort(ev.createdAt) }}</span>
              <span class="cf__act-t">{{ ev.summary }}</span>
            </div>
            <div v-if="activity.length === 0" class="cf__quiet">
              Console writes land here automatically — recorded cards, phase advancements,
              megacodes, waivers.
            </div>
          </div>

          <div class="cf__sectitle">Documents</div>
          <div class="cf__panel cf__panel--pad">
            <div class="cf__folderbar">
              <button type="button" class="cf__folder" :class="{ 'cf__folder--on': docFolder === 'all' }" @click="docFolder = 'all'">
                All <span class="cf__folder-n">{{ person ? clindocs.docsFor(person.userId).length : 0 }}</span>
              </button>
              <button
                v-for="f in FOLDERS.filter((x) => folderCount(x) > 0)"
                :key="f"
                type="button"
                class="cf__folder"
                :class="{ 'cf__folder--on': docFolder === f }"
                @click="docFolder = f"
              >{{ FOLDER_LABELS[f] }} <span class="cf__folder-n">{{ folderCount(f) }}</span></button>
            </div>
            <div v-for="d in myDocs" :key="d.id" class="cf__docrow">
              <FileText :size="14" :stroke-width="1.9" class="cf__doc-ico" />
              <div class="cf__doc-id">
                <button type="button" class="cf__doc-name" @click="viewDoc(d.id)">{{ d.name }}</button>
                <div class="cf__doc-meta">
                  {{ FOLDER_LABELS[d.folder] }} · {{ fmt(d.createdAt.slice(0, 10)) }}
                  <template v-if="d.sizeBytes"> · {{ fmtSize(d.sizeBytes) }}</template>
                </div>
              </div>
              <button
                type="button"
                class="cf__vis"
                :class="{ 'cf__vis--emp': d.employeeVisible }"
                :disabled="d.folder === 'counseling'"
                :title="d.folder === 'counseling' ? 'Counseling documents are always staff-only' : 'Toggle employee visibility'"
                @click="toggleDocVisibility(d.id)"
              >{{ d.folder === 'counseling' ? 'locked' : d.employeeVisible ? 'employee' : 'staff' }}</button>
              <button type="button" class="cf__trash" @click="deleteDoc(d.id)">
                <Trash2 :size="12" :stroke-width="2" />{{ docDeleteArm === d.id ? ' confirm?' : '' }}
              </button>
            </div>
            <div v-if="myDocs.length === 0" class="cf__quiet">Nothing in this folder yet.</div>
            <div class="cf__uploader">
              <select v-model="uploadFolder">
                <option v-for="f in FOLDERS" :key="f" :value="f">{{ FOLDER_LABELS[f] }}</option>
              </select>
              <label v-if="uploadFolder !== 'counseling'" class="cf__upcheck">
                <input v-model="uploadVisible" type="checkbox" />
                employee can see it
              </label>
              <button type="button" class="cf__mini cf__mini--primary" :disabled="uploadBusy" @click="fileInput?.click()">
                <Plus :size="12" :stroke-width="2.5" />
                {{ uploadBusy ? 'Uploading…' : 'Upload' }}
              </button>
              <input ref="fileInput" type="file" accept=".pdf,image/*" style="display: none" @change="onUploadPick" />
            </div>
            <div v-if="uploadError" class="cf__st--bad" style="font-size: 11.5px">{{ uploadError }}</div>
            <div class="cf__quiet" style="padding-top: 6px">
              PDFs and photos — a phone picture of a signed form works. Counseling uploads stay staff-only.
            </div>
          </div>

          <div class="cf__sectitle">Messages</div>
          <div class="cf__panel cf__panel--pad">
            <ClinicalMessageThread :record-id="person.record.id" :trainee-user-id="person.userId" />
            <div class="cf__quiet" style="padding-top: 6px">
              Clinical · FTO · trainee · supervisors — new posts notify by push + email.
            </div>
          </div>
        </div>
      </div>

      <!-- Drawers & overlays -->
      <ClinicalRecordDrawer
        v-if="recordTarget"
        :person="person"
        :target="recordTarget"
        @close="recordTarget = null"
      />
      <AdvancementRecordDrawer
        v-if="advOpen"
        :person="person"
        :timeline="tl"
        @close="advOpen = false"
        @saved="advOpen = false; void buildTl()"
      />
      <FtepTraineeQuickview :person="quickview" @close="quickview = null" />
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

/* ── Identity band ──────────────────────────────────────────────────── */
.cf__band {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  background: linear-gradient(145deg, oklch(0.3 0.115 250), oklch(0.2 0.095 250));
  border-radius: 14px;
  padding: 18px 22px;
  color: white;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.14), 0 8px 24px oklch(0.2 0.03 260 / 0.18);
  margin-bottom: 14px;
}
.cf__mono, .cf__photo {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cf__mono {
  background: oklch(0.36 0.09 250);
  box-shadow: inset 0 0 0 2px oklch(0.5 0.08 250);
  color: var(--color-accent-on-dark, #e8cb72);
  font-size: 16px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cf__photo { object-fit: cover; border: 2px solid oklch(0.5 0.08 250); }
.cf__id { min-width: 220px; }
.cf__name { font-size: 25px; line-height: 1.1; color: white; }
.cf__meta { margin-top: 3px; font-size: 11.5px; color: oklch(0.8 0.035 250); }
.cf__meta b { color: var(--color-accent-on-dark, #e8cb72); }
.cf__chips { margin-top: 7px; display: flex; gap: 7px; flex-wrap: wrap; }
.cf__chip {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 3px 10px;
  background: oklch(0.85 0.09 90 / 0.16);
  color: var(--color-accent-on-dark, #e8cb72);
}
.cf__chip--gold { background: oklch(0.85 0.09 90 / 0.3); }
.cf__chip--warn { background: oklch(0.6 0.15 30 / 0.32); color: oklch(0.9 0.05 30); }
.cf__ringwrap { margin-left: auto; text-align: center; }
.cf__ring {
  --p: 100;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin: 0 auto;
  background: conic-gradient(oklch(0.734 0.114 86.8) calc(var(--p) * 1%), oklch(0.34 0.07 250) 0);
}
.cf__ring--bad { background: conic-gradient(oklch(0.62 0.19 25) calc(var(--p) * 1%), oklch(0.34 0.07 250) 0); }
.cf__ring > span {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: oklch(0.23 0.095 250);
  display: grid;
  place-items: center;
  font-family: var(--font-serif, 'Instrument Serif', serif);
  font-size: 15px;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.cf__ring-l {
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: oklch(0.72 0.04 250);
  margin-top: 4px;
  font-weight: 700;
}
.cf__actionswrap { position: relative; z-index: 31; }
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
.cf__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 250px;
  z-index: 31;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgb(16 24 40 / 0.16);
  padding: 5px;
  display: flex;
  flex-direction: column;
}
.cf__menu-it {
  text-align: left;
  padding: 9px 11px;
  border: 0;
  background: none;
  border-radius: 7px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
}
.cf__menu-it:hover { background: var(--color-surface-soft); }
.cf__menu-it--dim { color: var(--color-muted); font-weight: 500; }
.cf__menu-veil { position: fixed; inset: 0; z-index: 30; }

.cf__enroll {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-brand-800);
  border-radius: 10px;
  font-size: 13px;
  color: var(--color-ink);
}
.cf__enroll-t { font-weight: 700; }
.cf__enroll-sel {
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-ink);
  max-width: 340px;
}
.cf__enroll-f {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.cf__enroll-hint { font-size: 12px; color: var(--color-muted); }
.cf__enroll-btns { display: inline-flex; gap: 8px; margin-left: auto; }
.cf__inline-date {
  padding: 3px 7px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.cf__inline-date:focus { outline: none; border-color: var(--color-accent-strong, #a8842c); }

.cf__allgood {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 11px 16px;
  background: var(--color-success-50, oklch(0.96 0.02 150));
  border: 1px solid oklch(0.88 0.05 150);
  border-radius: 10px;
  color: oklch(0.4 0.11 150);
  font-weight: 650;
  font-size: 13px;
  margin-bottom: 14px;
}

/* ── Grid ───────────────────────────────────────────────────────────── */
.cf__grid { display: grid; grid-template-columns: 1fr; gap: 0 18px; align-items: start; }
@media (min-width: 980px) { .cf__grid { grid-template-columns: 1.55fr 1fr; } }
.cf__main, .cf__rail { min-width: 0; }

.cf__sectitle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 18px 0 10px;
  scroll-margin-top: 80px;
}
.cf__sectitle::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.cf__trackchip {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  border-radius: 5px;
  padding: 2px 8px;
  background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-800));
  color: #fff;
  text-transform: none;
}

.cf__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px oklch(0.2 0.03 260 / 0.05), 0 6px 18px oklch(0.2 0.03 260 / 0.05);
  margin-bottom: 8px;
}
.cf__panel--pad { padding: 10px 16px; }
.cf__panel-hd { font-size: 12.5px; font-weight: 700; color: var(--color-ink); padding: 2px 0 6px; }

/* Compliance rows — the edit surface */
.cf__frow {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 9px 16px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background-color 120ms ease;
}
.cf__frow:hover { background: oklch(0.985 0.004 255); }
.cf__frow:last-of-type { border-bottom: 0; }
.cf__frow-item { min-width: 175px; font-weight: 700; font-size: 12.5px; color: var(--color-ink); }
.cf__frow-dates { flex: 1; font-variant-numeric: tabular-nums; font-size: 11.5px; color: var(--color-ink-soft); min-width: 0; }
.cf__frow-src {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted-soft);
}
.cf__frow-st { font-size: 12px; font-weight: 700; min-width: 86px; text-align: right; }
.cf__frow-chev { color: var(--color-muted-soft); align-self: center; flex-shrink: 0; }
@media (max-width: 560px) {
  .cf__frow { flex-wrap: wrap; }
  .cf__frow-item { min-width: 0; flex: 1 1 100%; }
  .cf__frow-st { min-width: 0; margin-left: auto; }
}

.cf__fdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 7px;
  vertical-align: 1px;
  flex-shrink: 0;
}
.cf__fdot--ok { background: var(--color-success-500); }
.cf__fdot--soon { background: oklch(0.65 0.13 70); }
.cf__fdot--bad, .cf__fdot--req { background: oklch(0.55 0.19 25); }
.cf__st--ok { color: var(--color-success-500); }
.cf__st--soon { color: oklch(0.5 0.13 60); }
.cf__st--bad, .cf__st--req { color: oklch(0.52 0.19 25); }

.cf__accessrow {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  padding: 9px 16px;
  border-top: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
}
.cf__access {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.cf__access b { color: var(--color-ink); }
.cf__access em { font-style: normal; font-size: 10px; color: var(--color-muted-soft); margin-left: 3px; }

/* Rollup rows */
.cf__roll {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.cf__roll:last-of-type { border-bottom: 0; }
.cf__roll b { color: var(--color-ink); }
.cf__roll-meta { color: var(--color-muted); font-size: 11.5px; min-width: 0; }
.cf__roll-src { margin-left: auto; font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-muted-soft); }
.cf__roll-l { font-weight: 650; color: var(--color-ink); }
.cf__roll-link {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 650;
  color: var(--color-brand-600);
  text-decoration: underline dotted var(--color-line);
  text-underline-offset: 3px;
}
.cf__roll-link:hover { color: var(--color-ink); }
.cf__roll-actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }

.cf__histtoggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 2px 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-ink);
  cursor: pointer;
  text-align: left;
}
.cf__chev { color: var(--color-muted); transition: transform 0.15s ease; flex-shrink: 0; }
.cf__chev--open { transform: rotate(180deg); }
.cf__gateswrap { margin-top: 10px; border-top: 1px solid var(--color-line-soft); padding-top: 10px; }

.cf__quiet { font-size: 12px; color: var(--color-muted); padding: 6px 0; line-height: 1.5; }

.cf__assign {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 10px;
  margin-top: 6px;
  border-top: 1px solid var(--color-line-soft);
}
.cf__assign select {
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 7px;
  padding: 7px 9px;
  background: var(--color-surface);
  min-width: 220px;
}

/* ── Rail ───────────────────────────────────────────────────────────── */
.cf__act {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 12px;
}
.cf__act:last-of-type { border-bottom: 0; }
.cf__act-d { font-variant-numeric: tabular-nums; font-size: 10.5px; color: var(--color-muted); min-width: 48px; font-weight: 650; }
.cf__act-t { color: var(--color-ink-soft); line-height: 1.45; min-width: 0; }

.cf__folderbar { display: flex; gap: 6px; flex-wrap: wrap; padding-bottom: 8px; }
.cf__folder {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 650;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
}
.cf__folder--on { background: var(--color-brand-800); border-color: var(--color-brand-800); color: #fff; }
.cf__folder-n { font-size: 10px; font-weight: 800; opacity: 0.75; font-variant-numeric: tabular-nums; }
.cf__docrow {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-line-soft);
}
.cf__docrow:last-of-type { border-bottom: 0; }
.cf__doc-ico { color: var(--color-muted); flex-shrink: 0; }
.cf__doc-id { min-width: 0; flex: 1; }
.cf__doc-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 650;
  color: var(--color-brand-600);
  text-align: left;
}
.cf__doc-name:hover { color: var(--color-ink); }
.cf__doc-meta { font-size: 10.5px; color: var(--color-muted); }
.cf__vis {
  font-family: var(--font-sans);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  padding: 3px 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.cf__vis--emp { border-color: oklch(0.8 0.08 150); color: var(--color-success-500); }
.cf__vis:disabled { opacity: 0.6; cursor: default; }
.cf__trash {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 650;
  color: var(--color-danger-500);
  flex-shrink: 0;
}
.cf__uploader {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 10px;
  margin-top: 4px;
  border-top: 1px solid var(--color-line-soft);
}
.cf__uploader select {
  font-family: var(--font-sans);
  font-size: 11.5px;
  color: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 7px;
  padding: 5px 8px;
  background: var(--color-surface);
}
.cf__upcheck { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--color-muted); font-weight: 600; }

/* Shared minis/links */
.cf__mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
}
.cf__mini:hover { border-color: var(--color-accent-strong, #a8842c); }
.cf__mini:disabled { opacity: 0.5; }
.cf__mini--primary { background: var(--color-brand-800); border-color: var(--color-brand-800); color: #fff; }
.cf__mini--primary:hover:not(:disabled) { background: var(--color-brand-700); border-color: var(--color-brand-700); }
.cf__lnk {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--color-brand-600);
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-transform: none;
  text-decoration: underline dotted var(--color-line);
  text-underline-offset: 3px;
}
.cf__lnk:hover { color: var(--color-ink); }
</style>
