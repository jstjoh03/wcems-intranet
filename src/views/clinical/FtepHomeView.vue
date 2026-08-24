<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Download, FileText, Check, AlertTriangle } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { useAuthStore } from '@/stores/auth'
import { activeTransitionFor } from '@/constants/pipelineGates'
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
const { ready, canViewBoard, canEdit, clinicalPeople } = useClinical()
const ftep = useFtep()

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)

/** Trainees = anyone actively progressing. "Mine" (ftoName matches the
 *  signed-in evaluator) sort first. */
const trainees = computed<PipelinePerson[]>(() => {
  const myLast = (auth.appUser?.lastName ?? '').toLowerCase()
  const mine = (p: PipelinePerson) =>
    !!myLast && (p.record.ftoName ?? '').toLowerCase().includes(myLast) ? 0 : 1
  return clinicalPeople.value
    .filter((p) => activeTransitionFor(p.record) !== null)
    .sort((a, b) => mine(a) - mine(b) || a.fullName.localeCompare(b.fullName))
})

const openMenu = ref<string | null>(null)
function toggleMenu(id: string) {
  openMenu.value = openMenu.value === id ? null : id
}
function onDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest?.('.fh__menuwrap')) openMenu.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function startReport(p: PipelinePerson, kind: 'dor' | 'icr') {
  openMenu.value = null
  router.push(`/clinical/ftep/${kind}/${p.userId}`)
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('')
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function statsFor(p: PipelinePerson) {
  return {
    dors: ftep.submittedFor(p.userId, 'dor').length,
    avg: ftep.dorRollingAverage(p.userId),
    icrs: ftep.icrCount(p.userId),
    lastDor: ftep.lastDorDate(p.userId),
    dorDraft: ftep.myDraft(p.userId, 'dor'),
    icrDraft: ftep.myDraft(p.userId, 'icr'),
  }
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
async function downloadPdf(r: FtepReport) {
  if (pdfBusy.value) return
  pdfBusy.value = r.id
  try {
    const doc = await generateFtepReportPdf({
      report: r,
      traineeName: nameOf(r.traineeId),
      evaluatorName: nameOf(r.evaluatorId),
    })
    const safe = nameOf(r.traineeId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
  } finally {
    pdfBusy.value = null
  }
}

async function review(r: FtepReport) {
  await ftep.markReviewed(r.id)
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
            <button type="button" class="fh__mini" :disabled="pdfBusy === r.id" @click="downloadPdf(r)">
              <Download :size="12" :stroke-width="2" /> PDF
            </button>
            <button type="button" class="fh__mini fh__mini--ok" @click="review(r)">
              <Check :size="12" :stroke-width="2.5" /> Reviewed
            </button>
          </span>
        </div>
      </div>

      <!-- Trainees -->
      <div class="fh__sectitle">Trainees in the program</div>
      <div v-for="p in trainees" :key="p.userId" class="fh__trainee">
        <span class="fh__avatar">{{ initials(p.fullName) }}</span>
        <div class="fh__tc">
          <div class="fh__tc-name">{{ p.fullName }}</div>
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
          <span><b>{{ statsFor(p).dors }}</b>DORs</span>
          <span><b>{{ statsFor(p).avg !== null ? statsFor(p).avg!.toFixed(2) : '—' }}</b>avg (last 4)</span>
          <span><b>{{ statsFor(p).icrs }}/10</b>ICRs</span>
          <span><b>{{ fmt(statsFor(p).lastDor) }}</b>last DOR</span>
        </div>
        <div class="fh__menuwrap">
          <button type="button" class="fh__actions" @click.stop="toggleMenu(p.userId)">
            Actions <ChevronDown :size="13" :stroke-width="2" />
          </button>
          <div v-if="openMenu === p.userId" class="fh__menu">
            <button type="button" @click="startReport(p, 'dor')">
              <FileText :size="13" :stroke-width="2" />
              {{ statsFor(p).dorDraft ? 'Resume DOR draft' : 'New Daily Observation Report' }}
            </button>
            <button type="button" @click="startReport(p, 'icr')">
              <FileText :size="13" :stroke-width="2" />
              {{ statsFor(p).icrDraft ? 'Resume ICR draft' : 'New Individual Call Report' }}
            </button>
            <button type="button" @click="router.push(`/clinical/people/${p.userId}`)">
              Open credentialing file
            </button>
          </div>
        </div>
      </div>
      <div v-if="trainees.length === 0" class="fh__empty">No trainees actively progressing.</div>

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
          <button type="button" class="fh__mini" style="margin-left:auto" :disabled="pdfBusy === r.id" @click="downloadPdf(r)">
            <Download :size="12" :stroke-width="2" /> {{ pdfBusy === r.id ? '…' : 'PDF' }}
          </button>
        </div>
        <div v-if="recent.length === 0" class="fh__card-empty">No submitted reports yet.</div>
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
</style>
