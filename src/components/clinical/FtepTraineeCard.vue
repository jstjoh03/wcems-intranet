<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, FileText, Check } from 'lucide-vue-next'
import ClinicalMessageThread from '@/components/clinical/ClinicalMessageThread.vue'
import FtepPhaseStepper from '@/components/clinical/FtepPhaseStepper.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { useFtepDayOverrides } from '@/composables/useFtepDayOverrides'
import { gateItemsFor, petitionItemsFor, TRANSITIONS } from '@/constants/pipelineGates'
import { FTEP_PROGRAM_PHASES, FTEP_DAY_STANDARDS } from '@/constants/ftepForms'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import type { FtepTimeline, FtepDayRow } from '@/composables/useFtepTimeline'
import type { PipelinePerson } from '@/types'

/**
 * The V6 trainee card (mockup contract, 2026-10-22) — one card per
 * new-program trainee with everything a CDO or FTO needs at a glance:
 * phase rail with the Guide's real names, four stat cells (days ·
 * last DOR · gates · eligibility), one "Next" line, and the detail
 * collapsed behind it: the schedule-derived day ledger (per-date
 * count/exclude corrections), the message thread, and the open-gates
 * list. Numbers come from the records — nothing here is hand-typed.
 */

const props = defineProps<{
  person: PipelinePerson
  timeline: FtepTimeline | null
  canEdit: boolean
}>()

const emit = defineEmits<{
  advance: []
  quickview: []
  refresh: []
  report: [kind: 'dor' | 'icr']
}>()

const router = useRouter()
const { ftepTrackFor, gateStatsFor, gatesFor, personById } = useClinical()
const ftep = useFtep()
const dayOv = useFtepDayOverrides()

const track = computed(() => ftepTrackFor(props.person))

/* ── Phase rail ─────────────────────────────────────────────────────── */

const allPhases = computed(() => {
  const t = props.timeline?.transition
  if (!t) return []
  return FTEP_PROGRAM_PHASES[t]
})

const standards = computed(() => {
  const tl = props.timeline
  if (!tl) return {}
  return FTEP_DAY_STANDARDS[tl.accelerated ? 'P1_P2_ACCEL' : tl.transition] ?? {}
})

const currentPhase = computed(() => props.timeline?.phases.find((p) => p.status === 'current') ?? null)
const allComplete = computed(
  () => !!props.timeline && props.timeline.phases.length > 0 && props.timeline.phases.every((p) => p.status === 'complete'),
)

/** Rail segments — widths proportional to the Guide's standard days
 *  (classroom phase0 uses its published day count). */
const rail = computed(() => {
  const tl = props.timeline
  if (!tl || !allPhases.value.length) return []
  const stds = allPhases.value.map((p) => standards.value[p.key]?.std ?? p.tours ?? 2)
  const total = stds.reduce((a, b) => a + b, 0) || 1
  const timelineByKey = new Map(tl.phases.map((p) => [p.key, p]))
  const curIdx = allPhases.value.findIndex((p) => timelineByKey.get(p.key)?.status === 'current')
  return allPhases.value.map((p, i) => {
    const row = timelineByKey.get(p.key)
    let state: 'done' | 'cur' | 'rest' = 'rest'
    if (p.noFto) {
      /* Classroom phase: done once any field phase has begun. */
      state = curIdx >= 0 || tl.phases.some((x) => x.status !== 'upcoming') ? 'done' : 'rest'
    } else if (row?.status === 'complete') state = 'done'
    else if (row?.status === 'current') state = 'cur'
    const short = p.label
      .replace('NEOP Academy', 'Academy')
      .replace('EMT Orientation', 'Orient.')
      .replace('Clinical Integration', 'Integration')
      .replace('Partner Phase', 'Partner')
      .replace('Final Evaluation', 'Final')
      .replace('P2 Development', 'Development')
      .replace('Ghost Phase', 'Ghost')
      .replace('P2 Final Evaluation', 'Final')
    return { key: p.key, label: short, pct: (stds[i]! / total) * 100, state }
  })
})

const phaseHeadline = computed(() => {
  const tl = props.timeline
  if (!tl) return { name: track.value?.label ?? 'FTEP', count: '' }
  if (allComplete.value) return { name: 'Program complete', count: '' }
  const cur = currentPhase.value
  if (!cur) {
    const next = tl.phases.find((p) => p.status === 'upcoming')
    return { name: next?.label ?? 'Not started', count: 'not started' }
  }
  const idx = tl.phases.findIndex((p) => p.key === cur.key)
  return { name: cur.label, count: `${idx + 1} of ${tl.phases.length}` }
})

/* ── Stat cells ─────────────────────────────────────────────────────── */

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const daysCell = computed(() => {
  const tl = props.timeline
  const cur = currentPhase.value
  if (!tl || tl.unanchored)
    return { v: '—', sub: "phase not anchored — days can't count", warn: true }
  if (!cur) {
    if (allComplete.value) {
      const total = tl.phases.reduce((a, p) => a + p.actual, 0)
      return { v: String(total), sub: 'program days · from the schedule', warn: false }
    }
    return { v: '—', sub: 'no phase in progress', warn: true }
  }
  const std = cur.standard
  return {
    v: std ? `${cur.actual} of ${std.std}` : String(cur.actual),
    sub: std ? `min ${std.min} · max ${std.max} · from the schedule` : 'from the schedule',
    warn: false,
  }
})

const floorFor = computed(() => (props.timeline?.transition === 'P1_P2' ? 4.0 : 3.5))

const dorCell = computed(() => {
  const last = ftep.lastDorDate(props.person.userId)
  const avg = ftep.dorRollingAverage(props.person.userId, track.value?.dorWindow ?? 4)
  if (!last) return { v: '—', sub: 'no DORs on file yet', warn: false }
  /* Categories below 3 across the final-four window — the Guide's
     "no category below 3" standard. */
  const window = ftep
    .submittedFor(props.person.userId, 'dor')
    .filter((r) => !r.payload.excludedFromRecord)
    .sort((a, b) => b.evalDate.localeCompare(a.evalDate))
    .slice(0, track.value?.dorWindow ?? 4)
  let below = 0
  for (const r of window) {
    for (const rating of Object.values(r.payload.ratings ?? {})) {
      if (typeof rating.score === 'number' && rating.score < 3) below++
    }
  }
  const belowTxt = below === 0 ? 'none below 3' : `${below} below 3`
  return {
    v: fmt(last),
    sub: avg !== null ? `avg ${avg.toFixed(2)} · floor ${floorFor.value} · ${belowTxt}` : belowTxt,
    warn: below > 0 || (avg !== null && avg < floorFor.value),
  }
})

const gateItems = computed(() =>
  gateItemsFor(props.person.record, gatesFor(props.person.record.id), gateStatsFor(props.person)),
)
const petItems = computed(() =>
  petitionItemsFor(props.person.record, gatesFor(props.person.record.id)),
)
const gatesCell = computed(() => {
  const items = gateItems.value
  const done = items.filter((i) => i.status === 'complete' || i.status === 'na')
  const open = items.filter((i) => i.status !== 'complete' && i.status !== 'na')
  if (!items.length) return { v: '—', sub: 'no tracked requirements', warn: false, open }
  if (!open.length) return { v: `${done.length} of ${items.length}`, sub: 'all documented', warn: false, open }
  const first = open
    .slice(0, 2)
    .map((i) => (i.value ? `${shortGate(i.label)} ${i.value}` : shortGate(i.label)))
    .join(' · ')
  const more = open.length > 2 ? ` +${open.length - 2}` : ''
  return { v: `${done.length} of ${items.length}`, sub: `open: ${first}${more}`, warn: false, open }
})

function shortGate(label: string): string {
  return label
    .replace('DOR average (final four)', 'DOR avg')
    .replace('Scored ICRs', 'ICRs')
    .replace(' sign-offs', '')
    .replace('Workbook', 'workbook')
    .replace('Protocol exam', 'protocol exam')
    .replace('Letters of recommendation', 'rec letters')
    .replace('New credential effective', 'effective date')
    .replace('Credentialing form signed & filed', 'form filed')
    .replace('New badge issued', 'badge')
    .replace('Operative IQ access', 'OpIQ')
}

const eligibleCell = computed(() => {
  const tl = props.timeline
  const toLabel = TRANSITIONS[tl?.transition ?? 'P1C_P1']?.toLabel ?? ''
  if (!tl || tl.unanchored)
    return { v: '—', sub: 'anchor a phase start to project', warn: true, ok: false }
  if (allComplete.value)
    return { v: 'Now', sub: `phases complete — credential as ${toLabel}`, warn: false, ok: true }
  const cur = currentPhase.value
  const remStd = tl.phases
    .filter((p) => p.status !== 'complete')
    .reduce((a, p) => a + Math.max(0, (p.standard?.std ?? 0) - (p.status === 'current' ? p.actual : 0)), 0)
  if (remStd === 0 && gatesCell.value.open.length === 0)
    return { v: 'Now', sub: `all days + gates met → ${toLabel}`, warn: false, ok: true }
  const isFinal = cur?.key === tl.finalPhaseKey
  if (isFinal) {
    const rem = Math.max(0, (cur?.standard?.std ?? 0) - (cur?.actual ?? 0))
    return {
      v: fmt(tl.estTestStd),
      sub: `Final Eval ${rem} day${rem === 1 ? '' : 's'} → ${toLabel} ~${fmt(tl.estTestStd)}`,
      warn: false,
      ok: false,
    }
  }
  return {
    v: fmt(tl.estTestStd),
    sub: `std pace · min pace ${fmt(tl.estTestMin)}`,
    warn: false,
    ok: false,
  }
})

/* ── Next line ──────────────────────────────────────────────────────── */

const nextLine = computed(() => {
  const tl = props.timeline
  if (!tl) return 'Schedule link unavailable for this track.'
  if (tl.unanchored)
    return 'No phase is anchored — set a start date and the schedule starts counting by itself.'
  const up = tl.upcoming[0]
  const cur = currentPhase.value
  const finalNote =
    cur?.key === tl.finalPhaseKey || (cur && tl.phases[tl.phases.length - 2]?.key === cur.key)
      ? ` — Final Evaluation needs a different FTO (${tl.ftosUsed.length ? tl.ftosUsed.join(', ') + ' used' : 'none used yet'})`
      : ''
  if (!up) return `No FTO-paired days on the schedule yet — line one up with scheduling${finalNote}`
  const fto = up.ftoNames.join(', ')
  return `Next: ${fmt(up.dateIso)} · ${up.unitCode}${fto ? ` · FTO ${fto}` : ''}${finalNote}`
})

/* ── Collapsible blocks ─────────────────────────────────────────────── */

const openBlock = ref<'' | 'days' | 'msgs' | 'needs' | 'phases'>('')
function toggle(b: 'days' | 'msgs' | 'needs' | 'phases') {
  openBlock.value = openBlock.value === b ? '' : b
}

/* ── Day ledger ─────────────────────────────────────────────────────── */

const showAllDays = ref(false)
const ledger = computed(() => {
  const tl = props.timeline
  if (!tl) return { past: [] as FtepDayRow[], hidden: 0, upcoming: [] as FtepDayRow[] }
  const all = [...tl.phases.flatMap((p) => p.days), ...tl.notCounting]
    .filter((d, i, arr) => arr.findIndex((x) => x.dateIso === d.dateIso) === i)
    .filter((d) => !d.future)
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
  const past = showAllDays.value ? all : all.slice(0, 5)
  return { past, hidden: all.length - past.length, upcoming: tl.upcoming.slice(0, 3) }
})

const ovForm = ref<{ date: string; counts: boolean } | null>(null)
const ovReason = ref('')
const ovBusy = ref(false)
function startOverride(d: FtepDayRow, counts: boolean) {
  ovForm.value = { date: d.dateIso, counts }
  ovReason.value = ''
}
async function saveOverride() {
  if (!ovForm.value || ovBusy.value) return
  /* Excluding needs its reason on the record; counting an edge case
     may stand on the schedule facts alone. */
  if (!ovForm.value.counts && !ovReason.value.trim()) return
  ovBusy.value = true
  const res = await dayOv.setOverride(
    props.person.record.id,
    ovForm.value.date,
    ovForm.value.counts,
    ovReason.value,
  )
  ovBusy.value = false
  if (res.ok) {
    ovForm.value = null
    emit('refresh')
  }
}
async function undoOverride(d: FtepDayRow) {
  if (ovBusy.value) return
  ovBusy.value = true
  const res = await dayOv.clearOverride(props.person.record.id, d.dateIso)
  ovBusy.value = false
  if (res.ok) emit('refresh')
}

const pdfBusy = ref(false)
async function viewDor(reportId: string | null) {
  if (!reportId || pdfBusy.value) return
  const r = ftep.reports.value.find((x) => x.id === reportId)
  if (!r) return
  pdfBusy.value = true
  try {
    const doc = await generateFtepReportPdf({
      report: r,
      traineeName: personById(r.traineeId)?.fullName ?? 'Trainee',
      evaluatorName: personById(r.evaluatorId)?.fullName ?? 'Evaluator',
    })
    window.open(doc.output('bloburl'), '_blank', 'noopener')
  } finally {
    pdfBusy.value = false
  }
}

/* ── Drafts + thread count ──────────────────────────────────────────── */

const dorDraft = computed(() => ftep.myDraft(props.person.userId, 'dor'))
const icrDraft = computed(() => ftep.myDraft(props.person.userId, 'icr'))

const menuOpen = ref(false)
</script>

<template>
  <div class="tc" @click="menuOpen = false">
    <!-- Header -->
    <div class="tc__hd">
      <div class="tc__id">
        <button
          v-if="canEdit"
          type="button"
          class="tc__name tc__name--link"
          title="Open clinical file"
          @click="router.push(`/clinical/people/${person.userId}`)"
        >{{ person.fullName }}</button>
        <span v-else class="tc__name">{{ person.fullName }}</span>
        <span class="tc__sub">{{ person.record.certLevel }}<template v-if="person.record.ftoName"> · FTO {{ person.record.ftoName }}</template></span>
        <span class="tc__track">{{ timeline?.transition === 'P1_P2' ? (timeline.accelerated ? 'P1 → P2 · accelerated' : 'P1 → P2 · 6-month cap') : 'P1C → P1 · 90-day cap' }}</span>
      </div>
      <div class="tc__phasebox">
        <div class="tc__phase display">
          {{ phaseHeadline.name }}
          <span v-if="phaseHeadline.count" class="tc__phase-n">· {{ phaseHeadline.count }}</span>
        </div>
        <div class="tc__hdbtns">
          <div class="tc__menuwrap" @click.stop>
            <button type="button" class="tc__btn" @click="menuOpen = !menuOpen">
              Actions <ChevronDown :size="12" :stroke-width="2" />
            </button>
            <div v-if="menuOpen" class="tc__menu" @click="menuOpen = false">
              <button type="button" @click="emit('report', 'dor')">
                <FileText :size="13" :stroke-width="2" />
                {{ dorDraft ? 'Resume DOR draft' : 'New Daily Observation Report' }}
              </button>
              <button v-if="track?.icrTarget" type="button" @click="emit('report', 'icr')">
                <FileText :size="13" :stroke-width="2" />
                {{ icrDraft ? 'Resume ICR draft' : 'New Individual Call Report' }}
              </button>
              <button type="button" @click="emit('quickview')">Quick view — schedule &amp; progress</button>
              <button v-if="canEdit" type="button" @click="toggle('phases')">
                {{ openBlock === 'phases' ? 'Hide phase editor' : 'Edit phases & days (manual)' }}
              </button>
              <button v-if="canEdit" type="button" @click="router.push(`/clinical/people/${person.userId}`)">
                Open credentialing file
              </button>
            </div>
          </div>
          <button
            v-if="canEdit && timeline && !timeline.unanchored && currentPhase"
            type="button"
            class="tc__go"
            @click="emit('advance')"
          >
            {{ currentPhase.key === timeline.finalPhaseKey
              ? 'Close Final Evaluation'
              : `Advance to ${timeline.phases[timeline.phases.findIndex(p => p.key === currentPhase!.key) + 1]?.label ?? 'next phase'}` }}
          </button>
          <button
            v-else-if="canEdit && timeline?.unanchored"
            type="button"
            class="tc__go tc__go--soft"
            @click="toggle('phases')"
          >Set the start date</button>
        </div>
      </div>
    </div>

    <div v-if="dorDraft || icrDraft" class="tc__draft">
      <FileText :size="12" :stroke-width="2" />
      {{ dorDraft ? 'DOR' : 'ICR' }} draft in progress — resume from Actions.
    </div>

    <!-- Phase rail -->
    <template v-if="rail.length">
      <div class="tc__rail">
        <i v-for="s in rail" :key="s.key" :class="`tc__rb tc__rb--${s.state}`" :style="{ width: s.pct + '%' }"></i>
      </div>
      <div class="tc__raillbls">
        <span v-for="s in rail" :key="s.key" :style="{ width: s.pct + '%' }">{{ s.label }}</span>
      </div>
    </template>

    <!-- Stat cells -->
    <div class="tc__stats">
      <div class="tc__stat">
        <div class="tc__stat-l">Training days</div>
        <div class="tc__stat-n display" :class="{ 'tc__warn': daysCell.warn }">{{ daysCell.v }}</div>
        <div class="tc__stat-s" :title="daysCell.sub">{{ daysCell.sub }}</div>
      </div>
      <div class="tc__stat">
        <div class="tc__stat-l">Last DOR</div>
        <div class="tc__stat-n display" :class="{ 'tc__warn': dorCell.warn }">{{ dorCell.v }}</div>
        <div class="tc__stat-s" :class="{ 'tc__warn': dorCell.warn }" :title="dorCell.sub">{{ dorCell.sub }}</div>
      </div>
      <button type="button" class="tc__stat tc__stat--btn" title="Show the open requirements" @click="toggle('needs')">
        <div class="tc__stat-l">Gates</div>
        <div class="tc__stat-n display">{{ gatesCell.v }}</div>
        <div class="tc__stat-s" :title="gatesCell.sub">{{ gatesCell.sub }}</div>
      </button>
      <div class="tc__stat">
        <div class="tc__stat-l">Eligible</div>
        <div class="tc__stat-n display" :class="{ 'tc__warn': eligibleCell.warn, 'tc__ok': eligibleCell.ok }">{{ eligibleCell.v }}</div>
        <div class="tc__stat-s" :title="eligibleCell.sub">{{ eligibleCell.sub }}</div>
      </div>
    </div>

    <!-- Next line + toggles -->
    <div class="tc__dayline">
      <span class="tc__next">{{ nextLine }}</span>
      <span class="tc__links">
        <button v-if="timeline" type="button" class="tc__lnk" @click="toggle('days')">
          {{ openBlock === 'days' ? 'Hide the ledger' : 'Day ledger' }}
        </button>
        <button type="button" class="tc__lnk" @click="toggle('msgs')">
          {{ openBlock === 'msgs' ? 'Hide messages' : 'Messages' }}
        </button>
      </span>
    </div>

    <!-- Day ledger -->
    <div v-if="openBlock === 'days' && timeline" class="tc__block" @click.stop>
      <div class="tc__tablewrap">
        <table class="tc__days">
          <tbody>
            <tr v-for="d in ledger.past" :key="d.dateIso" :class="{ 'tc__mutrow': !d.counts }">
              <td class="tc__dd">{{ fmt(d.dateIso) }}</td>
              <td>{{ d.unitCode || (d.overridden ? 'manual' : '—') }}</td>
              <td>{{ d.ftoNames.length ? `FTO ${d.ftoNames.join(', ')}` : 'no FTO aboard' }}</td>
              <td>
                <button v-if="d.dorReportId" type="button" class="tc__lnk" :disabled="pdfBusy" @click="viewDor(d.dorReportId)">
                  DOR{{ d.dorDayNo ? ` #${d.dorDayNo}` : '' }}
                </button>
                <span v-else-if="d.counts" class="tc__warn">no DOR</span>
                <span v-else class="tc__mut">—</span>
              </td>
              <td class="tc__dright">
                <template v-if="ovForm && ovForm.date === d.dateIso">
                  <span class="tc__ovform">
                    <input
                      v-model="ovReason"
                      type="text"
                      maxlength="200"
                      :placeholder="ovForm.counts ? 'Reason (optional)' : 'Reason (required — files on the record)'"
                      @keydown.enter.prevent="saveOverride"
                    />
                    <button type="button" class="tc__mini" :disabled="ovBusy || (!ovForm.counts && !ovReason.trim())" @click="saveOverride">
                      {{ ovForm.counts ? 'Count it' : 'Exclude' }}
                    </button>
                    <button type="button" class="tc__lnk tc__lnk--mut" @click="ovForm = null">cancel</button>
                  </span>
                </template>
                <template v-else-if="d.counts">
                  <span class="tc__ok">✓ counted</span>
                  <template v-if="d.overridden"><span class="tc__mut" :title="d.overrideReason ?? ''"> · corrected</span>
                    <button v-if="canEdit" type="button" class="tc__lnk tc__lnk--mut" :disabled="ovBusy" @click="undoOverride(d)">undo</button>
                  </template>
                  <button v-else-if="canEdit" type="button" class="tc__lnk tc__lnk--mut" @click="startOverride(d, false)">exclude</button>
                </template>
                <template v-else>
                  <span class="tc__mut">not counted<template v-if="d.overridden"> · corrected</template></span>
                  <button v-if="canEdit && d.overridden" type="button" class="tc__lnk tc__lnk--mut" :disabled="ovBusy" @click="undoOverride(d)">undo</button>
                  <button v-else-if="canEdit" type="button" class="tc__lnk tc__lnk--mut" @click="startOverride(d, true)">count it</button>
                </template>
              </td>
            </tr>
            <tr v-if="ledger.hidden > 0">
              <td class="tc__dd tc__mut">+ {{ ledger.hidden }} day{{ ledger.hidden === 1 ? '' : 's' }}</td>
              <td colspan="3" class="tc__mut">earlier days in this program</td>
              <td class="tc__dright"><button type="button" class="tc__lnk tc__lnk--mut" @click="showAllDays = true">show all</button></td>
            </tr>
            <tr v-for="d in ledger.upcoming" :key="`up-${d.dateIso}`" class="tc__uprow">
              <td class="tc__dd">{{ fmt(d.dateIso) }}</td>
              <td>{{ d.unitCode }}</td>
              <td>{{ d.ftoNames.length ? `FTO ${d.ftoNames.join(', ')}` : '' }}</td>
              <td class="tc__mut">—</td>
              <td class="tc__dright tc__upnote">upcoming</td>
            </tr>
            <tr v-if="!ledger.past.length && !ledger.upcoming.length">
              <td colspan="5" class="tc__mut" style="padding: 8px 0">No schedule days found in this program's window yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="tc__note">
        A date counts when an FTO is aboard. Exclude one (e.g. rode as a third) or count an edge
        case — totals and the eligibility projection recompute.
      </div>
    </div>

    <!-- Messages -->
    <div v-if="openBlock === 'msgs'" class="tc__block" @click.stop>
      <ClinicalMessageThread :record-id="person.record.id" :trainee-user-id="person.userId" />
    </div>

    <!-- Open gates -->
    <div v-if="openBlock === 'needs'" class="tc__block" @click.stop>
      <div class="tc__needs-hd">Still needed to advance</div>
      <template v-if="gatesCell.open.length || petItems.filter((i) => i.status !== 'complete').length">
        <div v-for="i in gatesCell.open" :key="i.key" class="tc__needs-row">
          <span class="tc__needs-dot"></span>
          <span>{{ i.label }}</span>
          <span v-if="i.hint || i.value" class="tc__needs-hint">{{ i.value ?? i.hint }}</span>
        </div>
        <div v-for="i in petItems.filter((x) => x.status !== 'complete')" :key="i.key" class="tc__needs-row">
          <span class="tc__needs-dot"></span>
          <span>Petition signature — {{ i.label }}</span>
        </div>
      </template>
      <div v-else class="tc__needs-row tc__needs-row--done">
        <Check :size="13" :stroke-width="2.5" /> All tracked requirements complete.
      </div>
    </div>

    <!-- Manual phase editor (the stepper keeps full control) -->
    <div v-if="openBlock === 'phases'" class="tc__block" @click.stop>
      <FtepPhaseStepper :person="person" :editable="canEdit" />
    </div>
  </div>
</template>

<style scoped>
.tc {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-left: 3px solid oklch(0.55 0.07 260);
  border-radius: 14px;
  padding: 14px 18px 12px;
  margin-bottom: 12px;
}
.tc__hd { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.tc__id { min-width: 200px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
.tc__name { font-size: 14.5px; font-weight: 700; color: var(--color-ink); }
.tc__name--link {
  background: none; border: none; padding: 0; cursor: pointer;
  font-family: var(--font-sans); text-align: left; width: fit-content;
}
.tc__name--link:hover { color: var(--color-brand-600); text-decoration: underline; text-underline-offset: 3px; }
.tc__sub { font-size: 11.5px; color: var(--color-muted); }
.tc__track {
  width: fit-content; font-size: 10px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; border-radius: 5px; padding: 2px 7px;
  background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260);
}
.tc__phasebox { margin-left: auto; text-align: right; display: flex; flex-direction: column; gap: 7px; align-items: flex-end; }
.tc__phase { font-size: 19px; color: var(--color-ink); line-height: 1.1; }
.tc__phase-n { color: var(--color-muted); font-size: 13.5px; }
.tc__hdbtns { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.tc__go {
  font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: #fff;
  background: var(--color-brand-800); border: none; border-radius: 8px;
  padding: 8px 14px; cursor: pointer;
}
.tc__go:hover { background: var(--color-brand-700); }
.tc__go--soft { background: var(--color-surface); color: var(--color-brand-700); border: 1px solid var(--color-brand-700); }
.tc__btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 8px; padding: 7px 11px; cursor: pointer;
}
.tc__btn:hover { border-color: var(--color-accent-strong, #a8842c); }
.tc__menuwrap { position: relative; }
.tc__menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 40;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 12px; box-shadow: 0 8px 28px oklch(0.2 0.03 260 / 0.16);
  min-width: 250px; padding: 6px; text-align: left;
}
.tc__menu button {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  background: none; border: none; border-radius: 8px; padding: 9px 11px;
  font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-ink);
  cursor: pointer;
}
.tc__menu button:hover { background: var(--color-surface-soft); }
.tc__menu button svg { color: var(--color-accent-strong, #a8842c); }
.tc__draft {
  display: flex; align-items: center; gap: 6px; margin-top: 8px;
  font-size: 11.5px; font-weight: 600; color: var(--color-accent-strong, #a8842c);
}

.tc__rail {
  display: flex; height: 16px; border-radius: 5px; overflow: hidden;
  margin: 12px 0 0; border: 1px solid var(--color-line);
}
.tc__rb { display: block; height: 100%; }
.tc__rb--done { background: oklch(0.62 0.12 150); }
.tc__rb--cur {
  background: repeating-linear-gradient(45deg, oklch(0.734 0.114 86.8), oklch(0.734 0.114 86.8) 6px, oklch(0.814 0.104 86.8) 6px, oklch(0.814 0.104 86.8) 12px);
  box-shadow: inset 0 0 0 2px oklch(0.584 0.109 86.8);
}
.tc__rb--rest { background: oklch(0.94 0.008 255); }
.tc__raillbls { display: flex; margin-top: 3px; }
.tc__raillbls > span {
  font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--color-muted-soft); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; padding-right: 4px;
}

.tc__stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0;
  margin: 12px 0 0; border: 1px solid var(--color-line); border-radius: 9px;
  overflow: hidden; background: var(--color-surface-soft);
}
@media (max-width: 640px) { .tc__stats { grid-template-columns: repeat(2, 1fr); } }
.tc__stat { padding: 9px 13px 8px; border-right: 1px solid var(--color-line-soft); min-width: 0; text-align: left; }
.tc__stat:last-child { border-right: 0; }
@media (max-width: 640px) {
  .tc__stat:nth-child(2) { border-right: 0; }
  .tc__stat:nth-child(n + 3) { border-top: 1px solid var(--color-line-soft); }
}
.tc__stat--btn { background: none; border-top: 0; border-bottom: 0; border-left: 0; font-family: inherit; cursor: pointer; }
.tc__stat--btn:hover { background: oklch(0.97 0.008 255); }
.tc__stat-l { font-size: 9.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: var(--color-muted); }
.tc__stat-n { font-size: 21px; line-height: 1.2; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.tc__stat-s {
  font-size: 10.5px; color: var(--color-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tc__ok { color: var(--color-success-500); }
.tc__warn { color: oklch(0.55 0.13 60); }
.tc__mut { color: var(--color-muted-soft); }

.tc__dayline {
  display: flex; align-items: baseline; gap: 12px; justify-content: space-between; flex-wrap: wrap;
  margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--color-line-soft);
  font-size: 12px; color: var(--color-ink-soft);
}
.tc__next { min-width: 0; }
.tc__links { display: inline-flex; gap: 14px; flex-shrink: 0; }
.tc__lnk {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-brand-600);
  font-size: 12px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.tc__lnk:hover { color: var(--color-ink); text-decoration-color: var(--color-accent-strong, #a8842c); }
.tc__lnk--mut { color: var(--color-muted); }
.tc__lnk:disabled { opacity: 0.5; cursor: default; }

.tc__block { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--color-line-soft); }
.tc__tablewrap { overflow-x: auto; }
.tc__days { width: 100%; border-collapse: collapse; }
.tc__days td {
  padding: 4.5px 8px 4.5px 0; border-bottom: 1px solid var(--color-line-soft);
  font-size: 12px; white-space: nowrap; color: var(--color-ink-soft);
}
.tc__days tr:last-child td { border-bottom: 0; }
.tc__dd { font-variant-numeric: tabular-nums; color: var(--color-ink); font-weight: 650; width: 60px; }
.tc__dright { text-align: right; font-weight: 650; font-size: 11.5px; }
.tc__mutrow td { color: var(--color-muted-soft); }
.tc__uprow td { background: oklch(0.985 0.012 86.8); }
.tc__upnote { color: oklch(0.55 0.13 60); }
.tc__ovform { display: inline-flex; gap: 6px; align-items: center; }
.tc__ovform input {
  font-family: var(--font-sans); font-size: 11.5px; color: var(--color-ink);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 4px 8px;
  background: var(--color-surface); width: 230px; max-width: 45vw;
}
.tc__ovform input:focus { outline: none; border-color: var(--color-brand-600); }
.tc__mini {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 4px 9px; cursor: pointer;
}
.tc__mini:disabled { opacity: 0.5; }
.tc__note { margin-top: 6px; font-size: 11px; color: var(--color-muted); line-height: 1.45; }

.tc__needs-hd {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--color-muted); margin-bottom: 4px;
}
.tc__needs-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12.5px; color: var(--color-ink-soft); }
.tc__needs-dot {
  flex-shrink: 0; width: 6px; height: 6px; border-radius: 999px;
  background: var(--color-warning-500, oklch(0.68 0.14 75));
}
.tc__needs-hint { margin-left: auto; font-size: 11px; color: var(--color-muted-soft); font-variant-numeric: tabular-nums; }
.tc__needs-row--done { color: var(--color-success-500); font-weight: 600; }
</style>
