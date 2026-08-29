<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Download, FileText, Check, AlertTriangle } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepPhaseStepper from '@/components/clinical/FtepPhaseStepper.vue'
import FtepResourcesCard from '@/components/clinical/FtepResourcesCard.vue'
import FtepTraineeQuickview from '@/components/clinical/FtepTraineeQuickview.vue'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { useAuthStore } from '@/stores/auth'
import { activeTransitionFor, gateItemsFor, petitionItemsFor } from '@/constants/pipelineGates'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import type { FtepReport, PipelinePerson } from '@/types'

/**
 * FTEP home — the FTO's working surface. Active trainees with live
 * DOR/ICR rollups, one Actions menu per trainee (resume-aware), the
 * evaluator's open drafts, and — for clinical editors — the
 * unreviewed-submissions queue (the "Clinical gets notified" loop).
 */

const router = useRouter()
const auth = useAuthStore()
const { ready, canViewBoard, canEdit, clinicalPeople, ftepTrackFor, manualRideouts, gatesFor, statusChip } = useClinical()
const ftep = useFtep()

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)

/** Trainees grouped by FTEP track — the programs carry different
 *  requirements and must read as distinct. "Mine" (ftoName matches
 *  the signed-in evaluator) sort first within each group. */
const TRACK_ORDER = ['new', 'legacy', 'rideup', 'aemt'] as const
const TRACK_HINTS: Record<string, string> = {
  new: 'DOR average over the final four (floor 3.5) · 10 scored ALS ICRs',
  legacy: '10 call evaluations via Jotform (narrative format) — recorded here manually until the webhook lands · DORs stay in Jotform',
  rideup: '4 × 12-hr rideouts with a supervisor · skills check-offs · protocol test — no ICR count',
  aemt: 'Skills checklists · medication administration sign-off · protocol exam',
}
const groups = computed(() => {
  const myLast = (auth.appUser?.lastName ?? '').toLowerCase()
  const mine = (p: PipelinePerson) =>
    !!myLast && (p.record.ftoName ?? '').toLowerCase().includes(myLast) ? 0 : 1
  const all = clinicalPeople.value.filter((p) => activeTransitionFor(p.record) !== null)
  return TRACK_ORDER.map((key) => ({
    key,
    label: {
      new: 'FTEP — new program',
      legacy: 'Legacy track',
      rideup: 'Ride-up supervisor (P2 → P3)',
      aemt: 'AEMT upgrade',
    }[key],
    hint: TRACK_HINTS[key],
    people: all
      .filter((p) => ftepTrackFor(p)?.key === key)
      .sort((a, b) => mine(a) - mine(b) || a.fullName.localeCompare(b.fullName)),
  })).filter((g) => g.people.length > 0)
})

const openMenu = ref<string | null>(null)
function toggleMenu(id: string) {
  openMenu.value = openMenu.value === id ? null : id
}
function onDocClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest?.('.fh__menuwrap')) openMenu.value = null
  if (!t.closest?.('.fh__triagewrap')) triageOpen.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

/* ── Queue triage — include/exclude right from the review line ──────
   ICRs: counts toward the required 10 (same flag Submissions edits).
   DORs: excluded from the record entirely (rolling average, rideout
   counts, scheduled-day matching). Excluding documents a reason. */
const triageOpen = ref<string | null>(null)
const triageExcluding = ref<string | null>(null)
const triageReason = ref('')
const triageBusy = ref(false)

function triageState(r: FtepReport): 'counts' | 'excluded' {
  if (r.kind === 'icr') return r.payload.countsToward10 ? 'counts' : 'excluded'
  return r.payload.excludedFromRecord ? 'excluded' : 'counts'
}

function toggleTriage(r: FtepReport) {
  triageExcluding.value = null
  triageReason.value = ''
  triageOpen.value = triageOpen.value === r.id ? null : r.id
}

async function triageInclude(r: FtepReport) {
  if (triageBusy.value) return
  triageBusy.value = true
  const res =
    r.kind === 'icr' ? await ftep.setIcrCounts(r.id, true) : await ftep.setDorExcluded(r.id, false)
  triageBusy.value = false
  if (res.ok) triageOpen.value = null
}

function startExclude(r: FtepReport) {
  triageExcluding.value = r.id
  triageReason.value = ''
}

async function confirmExclude(r: FtepReport) {
  if (triageBusy.value || !triageReason.value.trim()) return
  triageBusy.value = true
  const reason = triageReason.value.trim()
  const res =
    r.kind === 'icr'
      ? await ftep.setIcrCounts(r.id, false, reason)
      : await ftep.setDorExcluded(r.id, true, reason)
  triageBusy.value = false
  if (res.ok) {
    triageOpen.value = null
    triageExcluding.value = null
    triageReason.value = ''
  }
}

/* ── Trainee quickview — click the card for the planning picture ──── */
const quickview = ref<PipelinePerson | null>(null)
function openQuickview(p: PipelinePerson, e: MouseEvent) {
  const t = e.target as HTMLElement
  /* Interactive regions keep their own behavior. */
  if (t.closest('button, a, select, input, textarea, .fh__menuwrap, .fh__stepper, .fh__needs')) return
  quickview.value = p
}

function startReport(p: PipelinePerson, kind: 'dor' | 'icr') {
  openMenu.value = null
  router.push(`/clinical/ftep/${kind}/${p.userId}`)
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('')
}

/** Whether the Program Guide has a phase ladder for this trainee (the
 *  stepper's own render guard, mirrored so the wrapper strip doesn't
 *  draw empty for e.g. an EMT new hire). */
function hasPhaseLadder(p: PipelinePerson): boolean {
  const t = activeTransitionFor(p.record)
  const paramedic = /emt-p|^lp$/i.test(p.record.certLevel ?? '')
  return ((t === 'NEOP' || t === 'P1C_P1') && paramedic) || t === 'P1_P2'
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function statsFor(p: PipelinePerson) {
  const track = ftepTrackFor(p)
  const dors = ftep.activeDors(p.userId).length
  const cells: { v: string; l: string }[] = []
  if (track?.key === 'rideup') {
    /* Credit rideouts typed into the P2→P3 gate (pre-portal) alongside
       submitted rideout DORs. */
    const manual = manualRideouts(p)
    cells.push({ v: `${Math.max(dors, manual)}/${track.rideoutTarget}`, l: manual > dors ? 'rideouts (manual)' : 'rideouts' })
    cells.push({ v: dors === 0 && manual > 0 ? 'pre-portal' : fmt(ftep.lastDorDate(p.userId)), l: 'last rideout' })
  } else if (track?.key === 'legacy') {
    const evals = ftep.submittedFor(p.userId, 'icr').sort((a, b) => b.evalDate.localeCompare(a.evalDate))
    cells.push({ v: `${ftep.icrCount(p.userId, track.legacyPhase)}/${track.icrTarget}`, l: `evals → ${track.legacyPhase}` })
    cells.push({ v: fmt(evals[0]?.evalDate ?? null), l: 'last call eval' })
  } else {
    cells.push({ v: String(dors), l: 'DORs' })
    const avg = ftep.dorRollingAverage(p.userId, track?.dorWindow ?? 4)
    cells.push({ v: avg !== null ? avg.toFixed(2) : '—', l: `avg (last ${track?.dorWindow ?? 4})` })
    if (track?.icrTarget)
      cells.push({ v: `${ftep.icrCount(p.userId)}/${track.icrTarget}`, l: track.icrLabel })
    cells.push({ v: fmt(ftep.lastDorDate(p.userId)), l: 'last DOR' })
  }
  return {
    cells,
    dorDraft: ftep.myDraft(p.userId, 'dor'),
    icrDraft: ftep.myDraft(p.userId, 'icr'),
    track,
  }
}

/* "What's still needed" — the open credentialing gates for a trainee,
   read-only, so evaluators can see the remaining requirements without
   opening the full file (which is clinical-only). */
const needsOpen = ref<string | null>(null)
function toggleNeeds(id: string) {
  needsOpen.value = needsOpen.value === id ? null : id
}
function needsFor(p: PipelinePerson) {
  const rows = gatesFor(p.record.id)
  const items = gateItemsFor(p.record, rows).filter((i) => i.status !== 'complete' && i.status !== 'na')
  const pets = petitionItemsFor(p.record, rows).filter((i) => i.status !== 'complete')
  return { items, pets, count: items.length + pets.length }
}

/* Credential roster — the informational list supervisors/FTOs get in
   place of Employee Files: who's credentialed at what level. */
const rosterQuery = ref('')
const rosterRows = computed(() => {
  const q = rosterQuery.value.trim().toLowerCase()
  return clinicalPeople.value
    .filter((p) => !q || p.fullName.toLowerCase().includes(q))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
})

/* Legacy manual call-eval recording (until the Jotform webhook). */
const legacyDialog = ref<PipelinePerson | null>(null)
const legacyDate = ref(new Date().toISOString().slice(0, 10))
const legacyNote = ref('')
const legacyPhase = ref<'P1' | 'P2'>('P2')
const legacyBusy = ref(false)
const legacyError = ref<string | null>(null)

function openLegacyDialog(p: PipelinePerson) {
  openMenu.value = null
  legacyDialog.value = p
  legacyDate.value = new Date().toISOString().slice(0, 10)
  legacyNote.value = ''
  legacyPhase.value = ftepTrackFor(p)?.legacyPhase ?? 'P2'
  legacyError.value = null
}

async function saveLegacyEval() {
  if (!legacyDialog.value || legacyBusy.value) return
  legacyBusy.value = true
  legacyError.value = null
  const res = await ftep.recordLegacyCallEval({
    traineeId: legacyDialog.value.userId,
    evalDate: legacyDate.value,
    note: legacyNote.value,
    legacyPhase: legacyPhase.value,
  })
  legacyBusy.value = false
  if (!res.ok) { legacyError.value = res.error; return }
  legacyDialog.value = null
}

function nameOf(userId: string): string {
  return clinicalPeople.value.find((p) => p.userId === userId)?.fullName ?? 'Staff'
}

/* Recent submitted reports (mine unless editor — editors see all). */
const recent = computed<FtepReport[]>(() => {
  const uid = auth.appUser?.id
  return ftep.reports.value
    .filter((r) => r.status === 'submitted' && (canEdit.value || r.evaluatorId === uid))
    .slice(0, 12)
})

const pdfBusy = ref<string | null>(null)
async function makePdf(r: FtepReport) {
  return generateFtepReportPdf({
    report: r,
    traineeName: nameOf(r.traineeId),
    evaluatorName: nameOf(r.evaluatorId),
  })
}
async function downloadPdf(r: FtepReport) {
  if (pdfBusy.value) return
  pdfBusy.value = r.id
  try {
    const doc = await makePdf(r)
    const safe = nameOf(r.traineeId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
  } finally {
    pdfBusy.value = null
  }
}
async function viewPdf(r: FtepReport) {
  if (pdfBusy.value) return
  pdfBusy.value = r.id
  try {
    const doc = await makePdf(r)
    window.open(doc.output('bloburl'), '_blank', 'noopener')
  } finally {
    pdfBusy.value = null
  }
}

const clindocs = useClinicalDocs()

async function review(r: FtepReport) {
  await ftep.markReviewed(r.id)
  /* Auto-file the letterhead PDF into the trainee's Documents
     (generated folder) so the employee file carries the complete
     record without an extra step. Same-name re-reviews replace the
     old copy (e.g. after a deferred trainee signature lands). */
  if (r.payload.legacyManual) return
  try {
    const doc = await makePdf(r)
    const safe = nameOf(r.traineeId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const name = `WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`
    const existing = clindocs
      .docsFor(r.traineeId)
      .find((d) => d.folder === 'generated' && d.name === name)
    if (existing) await clindocs.remove(existing)
    const blob = doc.output('blob') as Blob
    await clindocs.upload({
      userId: r.traineeId,
      folder: 'generated',
      file: new File([blob], name, { type: 'application/pdf' }),
      employeeVisible: true,
    })
  } catch (e) {
    console.error('[ftep] auto-filing the reviewed PDF failed:', e)
  }
}
</script>

<template>
  <div class="fh">
    <ClinicalNav :crumbs="['FTEP']" />

    <header class="fh__head">
      <div>
        <h1 class="display fh__title">Field Training &amp; Evaluation</h1>
        <div class="fh__sub">DORs and ICRs file straight into the trainee's record — drafts save to the server, resume from any device</div>
      </div>
    </header>

    <div v-if="!ready || !ftep.ready.value" class="fh__empty">Loading…</div>

    <template v-else>
      <!-- CDO queue -->
      <div v-if="canEdit && ftep.unreviewed.value.length" class="fh__queue">
        <div class="fh__queue-hd">
          <AlertTriangle :size="15" :stroke-width="2" />
          {{ ftep.unreviewed.value.length }} new report{{ ftep.unreviewed.value.length === 1 ? '' : 's' }} awaiting your review
        </div>
        <div v-for="r in ftep.unreviewed.value" :key="r.id" class="fh__queue-row">
          <span class="fh__kind" :class="`fh__kind--${r.kind}`">{{ r.kind.toUpperCase() }}</span>
          <span class="fh__queue-who">{{ nameOf(r.traineeId) }}</span>
          <span class="fh__queue-meta">
            by {{ nameOf(r.evaluatorId) }} · {{ fmt(r.evalDate) }}
            <template v-if="r.payload.average !== undefined"> · avg {{ r.payload.average?.toFixed(2) }}</template>
            <b v-if="r.payload.nrtFlagged" class="fh__nrt-flag"> · NRT FLAGGED</b>
          </span>
          <span class="fh__queue-actions">
            <span class="fh__triagewrap">
              <button
                type="button"
                class="fh__mini"
                :class="{ 'fh__mini--excl': triageState(r) === 'excluded' }"
                @click.stop="toggleTriage(r)"
              >
                {{ triageState(r) === 'excluded' ? 'Excluded' : (r.kind === 'icr' ? 'Counts' : 'Included') }}
                <ChevronDown :size="11" :stroke-width="2" />
              </button>
              <div v-if="triageOpen === r.id" class="fh__triage">
                <button type="button" :disabled="triageBusy" @click="triageInclude(r)">
                  <Check :size="12" :stroke-width="2.5" />
                  {{ r.kind === 'icr' ? 'Counts toward the 10' : 'Include in the record' }}
                </button>
                <button type="button" :disabled="triageBusy" @click="startExclude(r)">
                  {{ r.kind === 'icr' ? 'Exclude from the 10…' : 'Exclude from the record…' }}
                </button>
                <div v-if="triageExcluding === r.id" class="fh__triage-form" @click.stop>
                  <input
                    v-model="triageReason"
                    type="text"
                    maxlength="200"
                    placeholder="Reason (required — kept with the report)"
                    @keydown.enter.prevent="confirmExclude(r)"
                  />
                  <button
                    type="button"
                    class="fh__mini fh__mini--excl"
                    :disabled="triageBusy || !triageReason.trim()"
                    @click="confirmExclude(r)"
                  >Exclude</button>
                </div>
              </div>
            </span>
            <button type="button" class="fh__mini" :disabled="pdfBusy === r.id" @click="viewPdf(r)">
              <FileText :size="12" :stroke-width="2" /> View
            </button>
            <button type="button" class="fh__mini" :disabled="pdfBusy === r.id" @click="downloadPdf(r)">
              <Download :size="12" :stroke-width="2" /> PDF
            </button>
            <button type="button" class="fh__mini fh__mini--ok" @click="review(r)">
              <Check :size="12" :stroke-width="2.5" /> Reviewed
            </button>
          </span>
        </div>
      </div>

      <!-- Trainees, grouped by track -->
      <template v-for="g in groups" :key="g.key">
        <div class="fh__sectitle">
          <span class="fh__track" :class="`fh__track--${g.key}`">{{ g.label }}</span>
          <span class="fh__track-hint">{{ g.hint }}</span>
        </div>
        <div
          v-for="p in g.people"
          :key="p.userId"
          class="fh__trainee fh__trainee--clickable"
          :class="`fh__trainee--${g.key}`"
          title="Click for quick view"
          @click="openQuickview(p, $event)"
        >
          <span class="fh__avatar">{{ initials(p.fullName) }}</span>
          <div class="fh__tc">
            <button
              v-if="canEdit"
              type="button"
              class="fh__tc-name fh__tc-name--link"
              title="Open clinical file"
              @click="router.push(`/clinical/people/${p.userId}`)"
            >{{ p.fullName }}</button>
            <div v-else class="fh__tc-name">{{ p.fullName }}</div>
            <div class="fh__tc-sub">
              {{ p.record.certLevel }}
              <template v-if="p.record.workingPhase"> · working {{ p.record.workingPhase }}</template>
              <template v-if="p.record.ftoName"> · FTO: {{ p.record.ftoName }}</template>
            </div>
            <div v-if="statsFor(p).dorDraft || statsFor(p).icrDraft" class="fh__draftnote">
              <FileText :size="12" :stroke-width="2" />
              <template v-if="statsFor(p).dorDraft">DOR draft in progress — resume from Actions.</template>
              <template v-else>ICR draft in progress — resume from Actions.</template>
            </div>
          </div>
          <div class="fh__stats">
            <span v-for="c in statsFor(p).cells" :key="c.l"><b>{{ c.v }}</b>{{ c.l }}</span>
          </div>
          <div class="fh__menuwrap">
            <button type="button" class="fh__actions" @click.stop="toggleMenu(p.userId)">
              Actions <ChevronDown :size="13" :stroke-width="2" />
            </button>
            <div v-if="openMenu === p.userId" class="fh__menu" @click="openMenu = null">
              <template v-if="g.key === 'legacy'">
                <button type="button" @click="openLegacyDialog(p)">
                  <FileText :size="13" :stroke-width="2" />
                  Record call evaluation (from Jotform)
                </button>
              </template>
              <template v-else>
                <button type="button" @click="startReport(p, 'dor')">
                  <FileText :size="13" :stroke-width="2" />
                  {{ statsFor(p).dorDraft
                    ? (g.key === 'rideup' ? 'Resume rideout DOR draft' : 'Resume DOR draft')
                    : (g.key === 'rideup' ? 'New rideout DOR (12-hr supervisor)' : 'New Daily Observation Report') }}
                </button>
                <button v-if="statsFor(p).track?.icrTarget" type="button" @click="startReport(p, 'icr')">
                  <FileText :size="13" :stroke-width="2" />
                  {{ statsFor(p).icrDraft ? 'Resume ICR draft' : 'New Individual Call Report' }}
                </button>
              </template>
              <button type="button" @click="quickview = p">
                Quick view — schedule &amp; progress
              </button>
              <button type="button" @click="toggleNeeds(p.userId)">
                What's still needed
              </button>
              <button v-if="canEdit" type="button" @click="router.push(`/clinical/people/${p.userId}`)">
                Open credentialing file
              </button>
            </div>
          </div>
          <div v-if="g.key === 'new' && hasPhaseLadder(p)" class="fh__stepper">
            <FtepPhaseStepper :person="p" :editable="canEdit" />
          </div>
          <div v-if="needsOpen === p.userId" class="fh__needs">
            <div class="fh__needs-hd">Still needed to advance</div>
            <template v-if="needsFor(p).count">
              <div v-for="i in needsFor(p).items" :key="i.key" class="fh__needs-row">
                <span class="fh__needs-dot"></span>
                <span>{{ i.label }}</span>
                <span v-if="i.hint || i.value" class="fh__needs-hint">{{ i.value ?? i.hint }}</span>
              </div>
              <div v-for="i in needsFor(p).pets" :key="i.key" class="fh__needs-row">
                <span class="fh__needs-dot"></span>
                <span>Petition signature — {{ i.label }}</span>
              </div>
            </template>
            <div v-else class="fh__needs-row fh__needs-row--done">
              <Check :size="13" :stroke-width="2.5" /> All tracked requirements complete.
            </div>
          </div>
        </div>
      </template>
      <div v-if="groups.length === 0" class="fh__empty">No trainees actively progressing.</div>

      <!-- Recent reports -->
      <div class="fh__sectitle">{{ canEdit ? 'Recent reports — all evaluators' : 'My recent reports' }}</div>
      <div class="fh__card">
        <div v-for="r in recent" :key="r.id" class="fh__report">
          <span class="fh__kind" :class="`fh__kind--${r.kind}`">{{ r.kind.toUpperCase() }}</span>
          <span class="fh__report-who">{{ nameOf(r.traineeId) }}</span>
          <span class="fh__report-meta">
            {{ fmt(r.evalDate) }} · by {{ nameOf(r.evaluatorId) }}
            <template v-if="r.payload.average !== undefined"> · avg {{ r.payload.average?.toFixed(2) }}</template>
            <template v-if="r.reviewedAt"> · reviewed</template>
          </span>
          <span v-if="!r.payload.legacyManual" style="margin-left:auto;display:flex;gap:8px">
            <button type="button" class="fh__mini" :disabled="pdfBusy === r.id" @click="viewPdf(r)">
              <FileText :size="12" :stroke-width="2" /> View
            </button>
            <button type="button" class="fh__mini" :disabled="pdfBusy === r.id" @click="downloadPdf(r)">
              <Download :size="12" :stroke-width="2" /> {{ pdfBusy === r.id ? '…' : 'PDF' }}
            </button>
          </span>
          <span v-else style="margin-left:auto;font-size:11px;color:var(--color-muted)">Jotform — original in Documents</span>
        </div>
        <div v-if="recent.length === 0" class="fh__card-empty">No submitted reports yet.</div>
      </div>

      <!-- Resources library — handbooks, guides, workbooks, blank forms -->
      <div class="fh__sectitle">Resources</div>
      <FtepResourcesCard :editable="canEdit" />

      <!-- Credential roster — informational stand-in for Employee Files
           (which is clinical-only): who holds what level. -->
      <template v-if="!canEdit">
        <div class="fh__sectitle">
          Credential roster
          <span class="fh__track-hint">every clinical employee · cert &amp; credential level</span>
        </div>
        <div class="fh__card">
          <input
            v-model="rosterQuery"
            type="search"
            class="fh__roster-search"
            placeholder="Search by name…"
          />
          <div v-for="p in rosterRows" :key="p.userId" class="fh__roster-row">
            <span class="fh__roster-name">{{ p.fullName }}</span>
            <span class="fh__roster-cert">{{ p.record.certLevel ?? '—' }}</span>
            <span class="fh__roster-level">{{ p.record.level ?? '—' }}</span>
            <span class="fh__roster-chip" :class="`fh__roster-chip--${statusChip(p).kind}`">{{ statusChip(p).text }}</span>
          </div>
          <div v-if="rosterRows.length === 0" class="fh__card-empty">No one matches that search.</div>
        </div>
      </template>

      <!-- Trainee quickview -->
      <FtepTraineeQuickview :person="quickview" @close="quickview = null" />

      <!-- Legacy call-eval dialog -->
      <div v-if="legacyDialog" class="fh__overlay" @click.self="legacyDialog = null">
        <div class="fh__dialog">
          <h2 class="display fh__dialog-title">Record call evaluation — {{ legacyDialog.fullName }}</h2>
          <p class="fh__dialog-sub">
            Legacy track: the call evaluation itself lives in Jotform. This records it toward the
            required 10; upload the Jotform PDF to the employee's Documents tab for the file.
          </p>
          <label class="fh__dialog-field">Date of call <input v-model="legacyDate" type="date" /></label>
          <label class="fh__dialog-field">Counts toward
            <select v-model="legacyPhase">
              <option value="P1">Credentialing as P1 (10 required)</option>
              <option value="P2">P1 → P2 in-charge (10 required)</option>
            </select>
          </label>
          <label class="fh__dialog-field">Note (optional)
            <input v-model="legacyNote" type="text" placeholder="e.g. incident #, chief complaint" />
          </label>
          <div v-if="legacyError" class="fh__dialog-err">{{ legacyError }}</div>
          <div class="fh__dialog-actions">
            <button type="button" class="fh__mini" @click="legacyDialog = null">Cancel</button>
            <button type="button" class="fh__actions" :disabled="legacyBusy" @click="saveLegacyEval">
              {{ legacyBusy ? 'Saving…' : 'Record call eval' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fh { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .fh { padding: 24px 32px 80px; } }
.fh__head { margin-bottom: 18px; }
.fh__title { font-size: 30px; line-height: 1.1; color: var(--color-ink); }
.fh__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
.fh__empty { padding: 28px 0; text-align: center; color: var(--color-muted); font-size: 13px; }
.fh__sectitle {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); margin: 22px 0 12px;
}
.fh__sectitle::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.fh__track {
  display: inline-flex; align-items: center;
  border-radius: 999px; padding: 4px 12px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.07em;
}
.fh__track--new { background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260); }
.fh__track--legacy { background: oklch(0.96 0.05 80); color: oklch(0.45 0.1 75); }
.fh__track--rideup { background: oklch(0.95 0.06 90); color: var(--color-accent-strong, #a8842c); border: 1px solid oklch(0.85 0.07 90); }
.fh__track--aemt { background: var(--color-surface-soft); color: var(--color-muted); }
.fh__track-hint { font-weight: 500; letter-spacing: 0.01em; text-transform: none; font-size: 11px; color: var(--color-muted); }
.fh__trainee--legacy { border-left: 3px solid oklch(0.75 0.09 80); }
.fh__trainee--rideup { border-left: 3px solid var(--color-accent-strong, #a8842c); }
.fh__trainee--new { border-left: 3px solid oklch(0.55 0.07 260); }
.fh__trainee--aemt { border-left: 3px solid var(--color-line); }

.fh__queue {
  background: oklch(0.97 0.03 80); border: 1px solid oklch(0.86 0.06 80);
  border-radius: 14px; padding: 4px 0 6px; margin-bottom: 6px;
}
.fh__queue-hd {
  display: flex; align-items: center; gap: 9px;
  padding: 11px 16px 8px; font-size: 13px; font-weight: 700; color: oklch(0.42 0.09 75);
}
.fh__queue-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 16px; border-top: 1px solid oklch(0.92 0.04 80); font-size: 13px;
}
.fh__queue-who { font-weight: 700; color: var(--color-ink); }
.fh__queue-meta { color: var(--color-ink-soft); font-size: 12px; }
.fh__nrt-flag { color: oklch(0.45 0.15 30); }
.fh__queue-actions { margin-left: auto; display: flex; gap: 8px; }
.fh__triagewrap { position: relative; }
.fh__triage {
  position: absolute; right: 0; top: calc(100% + 5px); z-index: 45;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 10px; box-shadow: 0 8px 24px oklch(0.2 0.03 260 / 0.16);
  min-width: 235px; padding: 5px;
}
.fh__triage > button {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 7px; padding: 8px 10px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; color: var(--color-ink);
  cursor: pointer;
}
.fh__triage > button:hover { background: var(--color-surface-soft); }
.fh__triage > button svg { color: var(--color-success-500); }
.fh__triage-form {
  display: flex; gap: 6px; padding: 6px 8px 5px;
  border-top: 1px solid var(--color-line-soft); margin-top: 3px;
}
.fh__triage-form input {
  flex: 1; min-width: 0;
  font-family: var(--font-sans); font-size: 12px; color: var(--color-ink);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 6px 8px;
  background: var(--color-surface);
}
.fh__triage-form input:focus { outline: none; border-color: var(--color-brand-600); }
.fh__mini--excl { color: oklch(0.48 0.13 45); border-color: oklch(0.85 0.08 60); background: oklch(0.97 0.04 75); }
.fh__trainee--clickable { cursor: pointer; }
.fh__trainee--clickable:hover { border-color: var(--color-muted-soft); box-shadow: 0 2px 10px oklch(0.2 0.03 260 / 0.06); }

.fh__trainee {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; padding: 14px 18px; margin-bottom: 10px;
}
.fh__avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--color-brand-950); color: var(--color-accent-on-dark, #e8cb72);
  font-size: 12px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.fh__tc { min-width: 180px; }
.fh__tc-name { font-size: 14.5px; font-weight: 700; color: var(--color-ink); }
.fh__tc-name--link {
  background: none; border: none; padding: 0; cursor: pointer;
  font-family: var(--font-sans); text-align: left;
}
.fh__tc-name--link:hover { color: var(--color-brand-600); text-decoration: underline; text-underline-offset: 3px; }
.fh__stepper {
  flex-basis: 100%;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 6px;
}
.fh__needs {
  flex-basis: 100%;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 8px;
}
.fh__needs-hd {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.fh__needs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.fh__needs-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-warning-500, oklch(0.68 0.14 75));
}
.fh__needs-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-muted-soft);
  font-variant-numeric: tabular-nums;
}
.fh__needs-row--done {
  color: var(--color-success-500);
  font-weight: 600;
}
.fh__roster-search {
  width: 100%;
  max-width: 320px;
  margin-bottom: 8px;
  padding: 7px 11px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fh__roster-search:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.fh__roster-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 12.5px;
}
.fh__roster-row:last-of-type {
  border-bottom: none;
}
.fh__roster-name {
  flex: 0 0 190px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fh__roster-cert {
  flex: 0 0 76px;
  color: var(--color-muted);
}
.fh__roster-level {
  flex: 0 0 60px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.fh__roster-chip {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.fh__roster-chip--ok { background: var(--color-success-50); color: var(--color-success-500); }
.fh__roster-chip--navy { background: oklch(0.93 0.02 250); color: var(--color-brand-700); }
.fh__roster-chip--hold { background: var(--color-warning-50); color: oklch(0.5 0.12 75); }
@media (max-width: 560px) {
  .fh__roster-name { flex-basis: 130px; }
  .fh__roster-cert { flex-basis: 60px; }
}
.fh__tc-sub { font-size: 11.5px; color: var(--color-muted); margin-top: 1px; }
.fh__draftnote {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
  font-size: 11.5px; font-weight: 600; color: var(--color-accent-strong, #a8842c);
}
.fh__stats { display: flex; gap: 18px; margin-left: auto; }
.fh__stats span { display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-muted); }
.fh__stats b { font-size: 14px; color: var(--color-ink); font-variant-numeric: tabular-nums; }

.fh__menuwrap { position: relative; }
.fh__actions {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 700;
  color: white; background: var(--color-brand-800);
  border: none; border-radius: 9px; padding: 9px 14px; cursor: pointer;
}
.fh__menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 40;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 12px; box-shadow: 0 8px 28px oklch(0.2 0.03 260 / 0.16);
  min-width: 250px; padding: 6px;
}
.fh__menu button {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 8px; padding: 9px 11px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-ink);
  cursor: pointer;
}
.fh__menu button:hover { background: var(--color-surface-soft); }
.fh__menu button svg { color: var(--color-accent-strong, #a8842c); }

.fh__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; overflow: hidden;
}
.fh__card-empty { padding: 18px 16px; font-size: 12.5px; color: var(--color-muted); }
.fh__report {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--color-surface-soft); font-size: 13px;
}
.fh__report:last-child { border-bottom: none; }
.fh__report-who { font-weight: 700; color: var(--color-ink); }
.fh__report-meta { color: var(--color-muted); font-size: 12px; }
.fh__kind {
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em;
  border-radius: 6px; padding: 3px 7px;
}
.fh__kind--dor { background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260); }
.fh__kind--icr { background: oklch(0.95 0.04 150); color: oklch(0.4 0.12 150); }
.fh__mini {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 10px; cursor: pointer;
}
.fh__mini:hover { border-color: var(--color-accent-strong, #a8842c); }
.fh__mini--ok { color: oklch(0.42 0.13 150); border-color: oklch(0.85 0.07 150); background: oklch(0.97 0.03 150); }
.fh__mini:disabled { opacity: 0.5; }

.fh__overlay {
  position: fixed; inset: 0; background: oklch(0.2 0.03 260 / 0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 90;
}
.fh__dialog {
  width: 100%; max-width: 460px;
  background: var(--color-surface); border-radius: 16px; padding: 22px;
  display: flex; flex-direction: column; gap: 12px;
}
.fh__dialog-title { font-size: 20px; color: var(--color-ink); }
.fh__dialog-sub { font-size: 12.5px; line-height: 1.55; color: var(--color-ink-soft); }
.fh__dialog-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--color-muted); }
.fh__dialog-field input {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 1.5px solid var(--color-line); border-radius: 8px; padding: 8px 10px;
  background: var(--color-surface);
}
.fh__dialog-field input:focus { outline: none; border-color: var(--color-brand-600); }
.fh__dialog-err { font-size: 12.5px; color: oklch(0.5 0.16 30); }
.fh__dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
