<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, Download, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import PipelinePersonDetail from '@/components/pipeline/PipelinePersonDetail.vue'
import PipelinePersonModal from '@/components/pipeline/PipelinePersonModal.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { requirementStatus, activeTransitionFor } from '@/constants/pipelineGates'
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
} = useClinical()

const skills = useSkillsDay()
const ftep = useFtep()

const myReports = computed(() => {
  const p = person.value
  if (!p) return []
  return ftep.submittedFor(p.userId).sort((a, b) => b.evalDate.localeCompare(a.evalDate))
})
const ftepPdfBusy = ref<string | null>(null)
async function ftepPdf(reportId: string) {
  const p = person.value
  const r = ftep.reportById(reportId)
  if (!p || !r || ftepPdfBusy.value) return
  ftepPdfBusy.value = reportId
  try {
    const evaluator = personById(r.evaluatorId)?.fullName ?? 'Evaluator'
    const doc = await generateFtepReportPdf({ report: r, traineeName: p.fullName, evaluatorName: evaluator })
    const safe = p.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
  } finally {
    ftepPdfBusy.value = null
  }
}

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)

const person = computed<PipelinePerson | null>(() =>
  personById(String(route.params.id)),
)

type TabKey = 'ovr' | 'pipe' | 'skills' | 'cred' | 'comp'
const tab = ref<TabKey>('ovr')
const tabs = computed<{ key: TabKey; label: string }[]>(() => [
  { key: 'ovr', label: 'Overview' },
  ...(canEdit.value ? [{ key: 'cred', label: 'Credentials' } as const] : []),
  { key: 'pipe', label: 'Pipeline' },
  { key: 'skills', label: 'Skills' },
  ...(canEdit.value ? [{ key: 'comp', label: 'Compliance' } as const] : []),
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
    <ClinicalNav :crumbs="['Employee Files', person?.fullName ?? '…']" />

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
            <span style="margin-left:auto;font-size:11.5px;color:var(--color-muted);font-weight:600">auto-computed from submitted reports</span>
          </div>
          <div class="cf__gate">
            <span class="cf__tick" :class="(ftep.dorRollingAverage(person.userId) ?? 0) >= 3.5 ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="(ftep.dorRollingAverage(person.userId) ?? 0) >= 3.5" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">Daily Observation Reports</span>
            <span class="cf__gate-v">{{ ftep.submittedFor(person.userId, 'dor').length }} filed · rolling avg {{ ftep.dorRollingAverage(person.userId)?.toFixed(2) ?? '—' }} (floor 3.5)</span>
          </div>
          <div class="cf__gate">
            <span class="cf__tick" :class="ftep.icrCount(person.userId) >= 10 ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="ftep.icrCount(person.userId) >= 10" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">Scored ALS call evaluations (ICRs)</span>
            <span class="cf__gate-v">{{ ftep.icrCount(person.userId) }} of 10 required</span>
          </div>
          <div v-for="r in myReports.slice(0, 8)" :key="r.id" class="cf__gate cf__gate--hist">
            <span class="cf__gate-l">{{ r.kind.toUpperCase() }} · {{ fmt(r.evalDate) }}</span>
            <span class="cf__gate-v">
              <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
              <b v-if="r.payload.nrtFlagged" class="cf__late">NRT · </b>by {{ personById(r.evaluatorId)?.fullName ?? '—' }}
            </span>
            <button type="button" class="cf__mini" :disabled="ftepPdfBusy === r.id" @click="ftepPdf(r.id)">
              <Download :size="12" :stroke-width="2" /> PDF
            </button>
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
            <span class="cf__tick" :class="person.record.txJurisprudenceAt ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="person.record.txJurisprudenceAt" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">TX EMS Jurisprudence</span>
            <span class="cf__gate-v">{{ person.record.txJurisprudenceAt ? fmt(person.record.txJurisprudenceAt) : 'not on file' }}<template v-if="person.record.txLicenseExpiresAt"> · cycle ends {{ fmt(person.record.txLicenseExpiresAt) }}</template></span>
          </div>
          <div v-for="req in cycleReqs" :key="req.id" class="cf__gate">
            <span class="cf__tick" :class="reqRow(req).st.latest && reqRow(req).st.state === 'ok' ? 'cf__tick--ok' : 'cf__tick--open'">
              <Check v-if="reqRow(req).st.latest && reqRow(req).st.state === 'ok'" :size="12" :stroke-width="2.5" /><template v-else>·</template>
            </span>
            <span class="cf__gate-l">{{ req.name }}</span>
            <span class="cf__gate-v">
              <template v-if="reqRow(req).st.latest">{{ fmt(reqRow(req).st.latest!.completedAt) }}</template>
              <template v-else>due this cycle</template>
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
