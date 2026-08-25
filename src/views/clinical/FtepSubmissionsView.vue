<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, FileText, Check } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import type { FtepReport } from '@/types'

/**
 * FTEP submissions — the Jotform-style inbox: every submitted DOR and
 * ICR in one chronological table (submission date · who submitted ·
 * who it's for), each row opening the same PDF as everywhere else.
 * Built for the clinical department (Heather's Jotform workflow);
 * editors only.
 */

const router = useRouter()
const { ready, canEdit, canViewBoard, personById } = useClinical()
const ftep = useFtep()

watch(
  [ready, canEdit, canViewBoard],
  ([r, edit, board]) => {
    if (r && !edit) router.replace(board ? '/clinical/ftep' : '/clinical-development')
  },
  { immediate: true },
)

const query = ref('')
const kindFilter = ref<'all' | 'dor' | 'icr'>('all')

function nameOf(userId: string): string {
  return personById(userId)?.fullName ?? 'Staff'
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return ftep.reports.value
    .filter((r) => r.status === 'submitted')
    .filter((r) => kindFilter.value === 'all' || r.kind === kindFilter.value)
    .filter(
      (r) =>
        !q ||
        nameOf(r.traineeId).toLowerCase().includes(q) ||
        nameOf(r.evaluatorId).toLowerCase().includes(q),
    )
    .sort((a, b) => (b.submittedAt ?? b.evalDate).localeCompare(a.submittedAt ?? a.evalDate))
})

const counts = computed(() => {
  const submitted = ftep.reports.value.filter((r) => r.status === 'submitted')
  return {
    all: submitted.length,
    dor: submitted.filter((r) => r.kind === 'dor').length,
    icr: submitted.filter((r) => r.kind === 'icr').length,
  }
})

function fmtSubmitted(r: FtepReport): string {
  const iso = r.submittedAt
  if (!iso) return new Date(`${r.evalDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* ── ICR triage ────────────────────────────────────────────────────
   Some submitted ICRs don't meet the ALS criteria to count toward the
   required 10 — exclude them here with a documented reason. The x/10
   counters everywhere recompute automatically. */
const triageOpen = ref<string | null>(null)
const triageReason = ref('')
const triageBusy = ref(false)
const triageError = ref<string | null>(null)

function openTriage(r: FtepReport) {
  triageOpen.value = triageOpen.value === r.id ? null : r.id
  triageReason.value = r.payload.triageNote ?? ''
  triageError.value = null
}

async function excludeIcr() {
  if (!triageOpen.value || triageBusy.value || !triageReason.value.trim()) return
  triageBusy.value = true
  triageError.value = null
  const res = await ftep.setIcrCounts(triageOpen.value, false, triageReason.value)
  triageBusy.value = false
  if (!res.ok) { triageError.value = res.error; return }
  triageOpen.value = null
}

async function includeIcr(r: FtepReport) {
  if (triageBusy.value) return
  triageBusy.value = true
  await ftep.setIcrCounts(r.id, true)
  triageBusy.value = false
  triageOpen.value = null
}

const pdfBusy = ref<string | null>(null)
async function openPdf(r: FtepReport, mode: 'view' | 'download') {
  if (pdfBusy.value || r.payload.legacyManual) return
  pdfBusy.value = r.id
  try {
    const doc = await generateFtepReportPdf({
      report: r,
      traineeName: nameOf(r.traineeId),
      evaluatorName: nameOf(r.evaluatorId),
    })
    if (mode === 'view') {
      window.open(doc.output('bloburl'), '_blank', 'noopener')
    } else {
      const safe = nameOf(r.traineeId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
      doc.save(`WCEMS_${r.kind.toUpperCase()}_${safe}_${r.evalDate}.pdf`)
    }
  } finally {
    pdfBusy.value = null
  }
}
</script>

<template>
  <div class="fs">
    <ClinicalNav :crumbs="['Submissions']" />

    <header class="fs__head">
      <div>
        <h1 class="display fs__title">FTEP Submissions</h1>
        <div class="fs__sub">Every submitted DOR and ICR, newest first — tap a row to open the PDF</div>
      </div>
    </header>

    <div v-if="!ready || !ftep.ready.value" class="fs__empty">Loading…</div>

    <template v-else>
      <div class="fs__bar">
        <button
          v-for="k in (['all', 'dor', 'icr'] as const)"
          :key="k"
          type="button"
          class="fs__kind"
          :class="{ 'fs__kind--on': kindFilter === k }"
          @click="kindFilter = k"
        >{{ k === 'all' ? 'All' : k.toUpperCase() }} <span class="fs__kind-n">{{ counts[k] }}</span></button>
        <input
          v-model="query"
          type="search"
          class="fs__search"
          placeholder="Search trainee or evaluator…"
        />
      </div>

      <div class="fs__table">
        <template v-for="r in rows" :key="r.id">
          <button
            type="button"
            class="fs__row"
            :class="{ 'fs__row--static': !!r.payload.legacyManual }"
            :title="r.payload.legacyManual ? 'Recorded from Jotform — original in Documents' : 'Open the report PDF'"
            @click="openPdf(r, 'view')"
          >
            <span class="fs__kindchip" :class="`fs__kindchip--${r.kind}`">{{ r.kind.toUpperCase() }}</span>
            <span class="fs__who">{{ nameOf(r.traineeId) }}</span>
            <span class="fs__by">by {{ nameOf(r.evaluatorId) }}</span>
            <span class="fs__meta">
              <template v-if="r.payload.legacyManual">call eval (Jotform)</template>
              <template v-else>
                <template v-if="r.payload.average !== undefined">avg {{ r.payload.average?.toFixed(2) }} · </template>
                <b v-if="r.payload.nrtFlagged" class="fs__nrt">NRT · </b>call {{ new Date(`${r.evalDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
              </template>
              <span v-if="r.reviewedAt" class="fs__reviewed"><Check :size="11" :stroke-width="2.5" /> reviewed</span>
              <span
                v-if="!r.traineeSignature && !r.payload.legacyManual"
                class="fs__unsigned"
                title="Submitted with the trainee signature deferred — they're prompted on My Progress"
              >awaiting trainee signature</span>
            </span>
            <span
              v-if="r.kind === 'icr'"
              class="fs__count"
              :class="r.payload.countsToward10 ? 'fs__count--yes' : 'fs__count--no'"
              role="button"
              :title="r.payload.countsToward10
                ? 'Counts toward the required 10 — click to exclude with a reason'
                : `Excluded from the 10${r.payload.triageNote ? ` — ${r.payload.triageNote}` : ''} — click to manage`"
              @click.stop="openTriage(r)"
            >{{ r.payload.countsToward10 ? 'counts' : 'excluded' }}</span>
            <span class="fs__when">{{ fmtSubmitted(r) }}</span>
            <span
              v-if="!r.payload.legacyManual"
              class="fs__dl"
              role="button"
              title="Download PDF"
              @click.stop="openPdf(r, 'download')"
            ><Download :size="13" :stroke-width="2" /></span>
            <span v-else class="fs__dl fs__dl--none"><FileText :size="13" :stroke-width="2" /></span>
          </button>
          <div v-if="triageOpen === r.id" class="fs__triage">
            <template v-if="r.payload.countsToward10">
              <span class="fs__triage-l">Exclude this ICR from the required 10 — document why:</span>
              <input
                v-model="triageReason"
                type="text"
                maxlength="200"
                placeholder="e.g. BLS-level call — does not meet ALS ICR criteria"
                @keydown.enter="excludeIcr"
              />
              <button type="button" class="fs__triage-btn fs__triage-btn--danger" :disabled="triageBusy || !triageReason.trim()" @click="excludeIcr">
                Exclude
              </button>
            </template>
            <template v-else>
              <span class="fs__triage-l">
                Excluded from the 10<template v-if="r.payload.triageNote"> — “{{ r.payload.triageNote }}”</template>.
              </span>
              <button type="button" class="fs__triage-btn" :disabled="triageBusy" @click="includeIcr(r)">
                Count it again
              </button>
            </template>
            <button type="button" class="fs__triage-btn" @click="triageOpen = null">Close</button>
            <span v-if="triageError" class="fs__triage-err">{{ triageError }}</span>
          </div>
        </template>
        <div v-if="rows.length === 0" class="fs__empty">No submissions match.</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fs {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .fs { padding: 24px 32px 80px; }
}
.fs__head {
  margin-bottom: 16px;
}
.fs__title {
  font-size: 26px;
  color: var(--color-brand-800);
}
.fs__sub {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.fs__empty {
  padding: 24px 0;
  font-size: 13px;
  color: var(--color-muted);
}
.fs__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.fs__kind {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}
.fs__kind--on {
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
  color: #fff;
}
.fs__kind-n {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
  margin-left: 2px;
}
.fs__search {
  flex: 1;
  min-width: 180px;
  max-width: 320px;
  margin-left: auto;
  padding: 7px 11px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__search:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.fs__table {
  border: 1px solid var(--color-line-soft);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-surface);
}
.fs__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}
.fs__row:last-child { border-bottom: none; }
.fs__row:nth-child(even) {
  background: color-mix(in oklab, var(--color-surface-soft) 45%, var(--color-surface));
}
.fs__row:hover:not(:disabled) { background: var(--color-surface-soft); }
.fs__row:disabled { cursor: default; }
.fs__kindchip {
  flex-shrink: 0;
  width: 38px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 3px 0;
  border-radius: 6px;
}
.fs__kindchip--dor { background: oklch(0.93 0.02 250); color: var(--color-brand-700); }
.fs__kindchip--icr { background: oklch(0.95 0.06 90); color: var(--color-accent-strong, #a8842c); }
.fs__who {
  flex: 0 0 160px;
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fs__by {
  flex: 0 0 150px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fs__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-ink-soft);
  white-space: nowrap;
  overflow: hidden;
}
.fs__nrt { color: var(--color-danger-500); }
.fs__reviewed {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-success-500);
}
.fs__when {
  flex-shrink: 0;
  width: 138px;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-accent-strong, #a8842c);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fs__dl {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--color-muted);
}
.fs__dl:hover { background: var(--color-line-soft); color: var(--color-ink); }
.fs__dl--none { color: var(--color-muted-soft); }
.fs__row--static { cursor: default; }
.fs__unsigned {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
  white-space: nowrap;
}
.fs__count {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.fs__count--yes { background: var(--color-success-50); color: var(--color-success-500); }
.fs__count--yes:hover { background: oklch(0.9 0.06 150); }
.fs__count--no { background: var(--color-danger-50); color: var(--color-danger-500); }
.fs__triage {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  font-size: 12.5px;
}
.fs__triage-l { color: var(--color-ink-soft); }
.fs__triage input {
  flex: 1;
  min-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fs__triage-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
}
.fs__triage-btn--danger {
  background: var(--color-danger-500);
  border-color: var(--color-danger-500);
  color: #fff;
}
.fs__triage-btn:disabled { opacity: 0.55; cursor: default; }
.fs__triage-err { flex-basis: 100%; font-size: 12px; color: var(--color-danger-500); }
@media (max-width: 640px) {
  .fs__by { display: none; }
  .fs__who { flex-basis: 110px; }
  .fs__when { width: 92px; }
}
</style>
