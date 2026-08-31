<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, FileText } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepSectionTabs from '@/components/clinical/FtepSectionTabs.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { useAuthStore } from '@/stores/auth'
import { generateFtepReportPdf } from '@/lib/ftepReportPdf'
import type { FtepReport } from '@/types'

/**
 * FTEP → Reports: every submitted DOR/ICR in one searchable place
 * (previously a 12-row strip at the bottom of the FTEP home).
 * Editors see all evaluators' reports; FTOs/supervisors see their own.
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

const query = ref('')
const kind = ref<'all' | 'dor' | 'icr'>('all')
const shown = ref(40)

function nameOf(userId: string): string {
  return clinicalPeople.value.find((p) => p.userId === userId)?.fullName ?? 'Staff'
}

const filtered = computed<FtepReport[]>(() => {
  const uid = auth.appUser?.id
  const q = query.value.trim().toLowerCase()
  return ftep.reports.value
    .filter((r) => r.status === 'submitted' && (canEdit.value || r.evaluatorId === uid))
    .filter((r) => kind.value === 'all' || r.kind === kind.value)
    .filter(
      (r) =>
        !q ||
        nameOf(r.traineeId).toLowerCase().includes(q) ||
        nameOf(r.evaluatorId).toLowerCase().includes(q),
    )
})
const visible = computed(() => filtered.value.slice(0, shown.value))

watch([query, kind], () => {
  shown.value = 40
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const pdfBusy = ref<string | null>(null)
async function makePdf(r: FtepReport) {
  return generateFtepReportPdf({
    report: r,
    traineeName: nameOf(r.traineeId),
    evaluatorName: nameOf(r.evaluatorId),
  })
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
</script>

<template>
  <div class="fr">
    <ClinicalNav :crumbs="[{ label: 'FTEP', to: '/clinical/ftep' }, 'Reports']" />
    <FtepSectionTabs />

    <header class="fr__head">
      <div>
        <h1 class="display fr__title">Reports</h1>
        <div class="fr__sub">
          {{ canEdit ? 'Every submitted DOR and ICR, all evaluators' : 'Your submitted DORs and ICRs' }}
        </div>
      </div>
      <div class="fr__filters">
        <select v-model="kind" class="fr__select" aria-label="Report kind">
          <option value="all">All kinds</option>
          <option value="dor">DORs</option>
          <option value="icr">ICRs</option>
        </select>
        <input
          v-model="query"
          type="search"
          class="fr__search"
          placeholder="Search trainee or evaluator…"
        />
      </div>
    </header>

    <div v-if="!ready || !ftep.ready.value" class="fr__empty">Loading…</div>
    <template v-else>
      <div class="fr__card">
        <div v-for="r in visible" :key="r.id" class="fr__row">
          <span class="fr__kind" :class="`fr__kind--${r.kind}`">{{ r.kind.toUpperCase() }}</span>
          <span class="fr__who">{{ nameOf(r.traineeId) }}</span>
          <span class="fr__meta">
            {{ fmt(r.evalDate) }} · by {{ nameOf(r.evaluatorId) }}
            <template v-if="r.payload.average !== undefined"> · avg {{ r.payload.average?.toFixed(2) }}</template>
            <b v-if="r.payload.nrtFlagged" class="fr__nrt"> · NRT</b>
            <template v-if="r.kind === 'icr' && r.payload.countsToward10 === false"> · excluded from the 10</template>
            <template v-if="r.kind === 'dor' && r.payload.excludedFromRecord"> · excluded from record</template>
            <template v-if="r.reviewedAt"> · reviewed</template>
          </span>
          <span v-if="!r.payload.legacyManual" class="fr__actions">
            <button type="button" class="fr__mini" :disabled="pdfBusy === r.id" @click="viewPdf(r)">
              <FileText :size="12" :stroke-width="2" /> View
            </button>
            <button type="button" class="fr__mini" :disabled="pdfBusy === r.id" @click="downloadPdf(r)">
              <Download :size="12" :stroke-width="2" /> {{ pdfBusy === r.id ? '…' : 'PDF' }}
            </button>
          </span>
          <span v-else class="fr__jotform">Jotform — original in Documents</span>
        </div>
        <div v-if="filtered.length === 0" class="fr__card-empty">No reports match.</div>
        <button
          v-if="filtered.length > shown"
          type="button"
          class="fr__more"
          @click="shown += 40"
        >
          Show more ({{ filtered.length - shown }} remaining)
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fr { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .fr { padding: 24px 32px 80px; } }
.fr__head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
}
.fr__title { font-size: 26px; line-height: 1.1; color: var(--color-ink); }
.fr__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
.fr__filters { display: flex; gap: 8px; }
.fr__select, .fr__search {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  border: 1px solid var(--color-line); border-radius: 9px; padding: 7px 11px;
  background: var(--color-surface);
}
.fr__search { min-width: 220px; }
.fr__select:focus, .fr__search:focus { outline: none; border-color: var(--color-accent-600); }
.fr__empty { padding: 28px 0; text-align: center; color: var(--color-muted); font-size: 13px; }
.fr__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; overflow: hidden;
}
.fr__card-empty { padding: 18px 16px; font-size: 12.5px; color: var(--color-muted); }
.fr__row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--color-surface-soft); font-size: 13px;
}
.fr__row:last-of-type { border-bottom: none; }
.fr__who { font-weight: 700; color: var(--color-ink); }
.fr__meta { color: var(--color-muted); font-size: 12px; }
.fr__nrt { color: oklch(0.45 0.15 30); }
.fr__actions { margin-left: auto; display: flex; gap: 8px; }
.fr__jotform { margin-left: auto; font-size: 11px; color: var(--color-muted); }
.fr__kind {
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em;
  border-radius: 6px; padding: 3px 7px;
}
.fr__kind--dor { background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260); }
.fr__kind--icr { background: oklch(0.95 0.04 150); color: oklch(0.4 0.12 150); }
.fr__mini {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 7px; padding: 5px 10px; cursor: pointer;
}
.fr__mini:hover { border-color: var(--color-accent-strong, #a8842c); }
.fr__mini:disabled { opacity: 0.5; }
.fr__more {
  display: block; width: 100%; padding: 10px;
  background: var(--color-surface-soft); border: none; border-top: 1px solid var(--color-line);
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600; color: var(--color-brand-600);
  cursor: pointer;
}
.fr__more:hover { color: var(--color-brand-700); }
</style>
