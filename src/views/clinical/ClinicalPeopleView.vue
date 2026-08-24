<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, X } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import { useClinical } from '@/composables/useClinical'
import { activeTransitionFor } from '@/constants/pipelineGates'
import type { PipelinePerson } from '@/types'

/**
 * Employee Files roster: every clinical file, searchable and
 * filterable, each row navigating to that person's dedicated file
 * page. Arrives pre-filtered from the hub tiles via ?f=.
 */

const route = useRoute()
const router = useRouter()
const {
  ready,
  canEdit,
  canViewBoard,
  clinicalPeople,
  attentionFor,
  missingRequired,
  statusChip,
  attentionChip,
  licDays,
} = useClinical()

/* Full files are clinical-department territory; supervisors/FTOs get
   the credential roster on the FTEP page instead. */
watch(
  [ready, canEdit, canViewBoard],
  ([r, edit, board]) => {
    if (r && !edit) router.replace(board ? '/clinical/ftep' : '/clinical-development')
  },
  { immediate: true },
)

type TileFilter = 'all' | 'attention' | 'pipeline' | 'missing'
const tileFilter = ref<TileFilter>((route.query.f as TileFilter) || 'all')
watch(
  () => route.query.f,
  (f) => { tileFilter.value = (f as TileFilter) || 'all' },
)
const TILE_LABELS: Record<TileFilter, string> = {
  all: '',
  attention: 'Needs attention',
  pipeline: 'In pipeline',
  missing: 'Missing a required cert',
}

const search = ref('')
const levelFilter = ref<'all' | 'medic' | 'aemt' | 'emt'>('all')
const shiftFilter = ref<'all' | 'A' | 'B' | 'C'>('all')

function matchesTile(p: PipelinePerson): boolean {
  switch (tileFilter.value) {
    case 'attention': return attentionFor(p).length > 0
    case 'pipeline': return activeTransitionFor(p.record) !== null
    case 'missing': return missingRequired(p).length > 0
    default: return true
  }
}

const rows = computed(() =>
  clinicalPeople.value
    .filter((p) => {
      if (!matchesTile(p)) return false
      if (search.value && !p.fullName.toLowerCase().includes(search.value.toLowerCase()))
        return false
      const lvl = p.record.certLevel ?? ''
      if (levelFilter.value === 'medic' && !/EMT-P|^LP$/i.test(lvl)) return false
      if (levelFilter.value === 'aemt' && !/ADV/i.test(lvl)) return false
      if (levelFilter.value === 'emt' && !/EMT-B/i.test(lvl)) return false
      if (shiftFilter.value !== 'all' && p.shift !== shiftFilter.value) return false
      return true
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
)

function clearTile() {
  router.replace({ path: '/clinical/people' })
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('')
}

function open(p: PipelinePerson) {
  router.push(`/clinical/people/${p.userId}`)
}

function licText(p: PipelinePerson): { text: string; late: boolean } {
  const exp = p.record.txLicenseExpiresAt
  if (!exp) return { text: '—', late: false }
  const d = licDays(p)
  const late = d !== null && d <= 90
  const text = new Date(`${exp}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    ...(late ? { day: 'numeric' } : {}),
  })
  return { text, late }
}
</script>

<template>
  <div class="cp">
    <ClinicalNav :crumbs="['Employee Files']" />

    <header class="cp__head">
      <h1 class="display cp__title">Employee Files</h1>
      <div class="cp__sub">
        {{ clinicalPeople.length }} clinical staff · admin staff without clinical requirements are excluded
      </div>
    </header>

    <div v-if="!ready" class="cp__empty">Loading…</div>

    <template v-else>
      <div class="cp__filters">
        <span class="cp__searchbox">
          <Search :size="14" :stroke-width="2" />
          <input v-model="search" type="search" placeholder="Search name…" />
        </span>
        <select v-model="levelFilter">
          <option value="all">All levels</option>
          <option value="medic">EMT-P / LP</option>
          <option value="aemt">ADV EMT</option>
          <option value="emt">EMT-B</option>
        </select>
        <select v-model="shiftFilter">
          <option value="all">All shifts</option>
          <option value="A">A shift</option>
          <option value="B">B shift</option>
          <option value="C">C shift</option>
        </select>
        <button v-if="tileFilter !== 'all'" type="button" class="cp__chip-filter" @click="clearTile">
          Filtered: {{ TILE_LABELS[tileFilter] }}
          <X :size="12" :stroke-width="2.5" />
        </button>
        <span class="cp__count">{{ rows.length }} shown</span>
      </div>

      <div class="cp__tablewrap">
        <table class="cp__table">
          <thead>
            <tr><th>Employee</th><th>Level</th><th>Status</th><th>License</th><th>Attention</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.userId" @click="open(p)">
              <td>
                <span class="cp__avatar">{{ initials(p.fullName) }}</span>
                <span class="cp__cell-name">
                  <span class="cp__name">{{ p.fullName }}</span>
                  <span class="cp__namesub">
                    <template v-if="p.station">{{ p.station }}</template>
                    <template v-if="p.shift"> · {{ p.shift }} shift</template>
                    <template v-if="p.record.isFto"> · FTO</template>
                  </span>
                </span>
              </td>
              <td class="cp__lvl">{{ p.record.certLevel }}</td>
              <td>
                <span class="cp__chip" :class="`cp__chip--${statusChip(p).kind}`">{{ statusChip(p).text }}</span>
              </td>
              <td :class="{ 'cp__lic-late': licText(p).late }">{{ licText(p).text }}</td>
              <td>
                <span v-if="attentionChip(p)" class="cp__chip" :class="attentionChip(p)!.severity === 'due' ? 'cp__chip--due' : 'cp__chip--warn'">
                  {{ attentionChip(p)!.text }}
                </span>
                <span v-else class="cp__none">—</span>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="5" class="cp__noneRow">No one matches these filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cp {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .cp { padding: 24px 32px 80px; }
}
.cp__head { margin-bottom: 18px; }
.cp__title { font-size: 30px; line-height: 1.1; color: var(--color-ink); }
.cp__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
.cp__empty { padding: 48px 0; text-align: center; color: var(--color-muted); }

.cp__filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.cp__filters select {
  font-family: var(--font-sans);
  font-size: 13px;
  border: 1.5px solid var(--color-line);
  border-radius: 9px;
  padding: 8px 11px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
}
.cp__searchbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 240px;
  border: 1.5px solid var(--color-line);
  border-radius: 9px;
  padding: 8px 11px;
  background: var(--color-surface);
  color: var(--color-muted);
}
.cp__searchbox input {
  flex: 1;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
}
.cp__chip-filter {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: oklch(0.96 0.03 85);
  border: 1px solid oklch(0.85 0.06 85);
  color: var(--color-accent-strong, #a8842c);
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 12px;
  border-radius: 999px;
  padding: 6px 13px;
  cursor: pointer;
}
.cp__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-muted);
}

.cp__tablewrap { overflow-x: auto; }
.cp__table {
  width: 100%;
  min-width: 760px;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  overflow: hidden;
}
.cp__table th {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  text-align: left;
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-surface-soft);
}
.cp__table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-surface-soft);
  vertical-align: middle;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.cp__table tbody tr {
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.cp__table tbody tr:hover { background: oklch(0.985 0.008 90); }
.cp__table tbody tr:hover .cp__name { color: var(--color-brand-800); }
.cp__table tbody tr:last-child td { border-bottom: none; }
.cp__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-brand-950);
  color: var(--color-accent-on-dark, #e8cb72);
  font-size: 10.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  vertical-align: middle;
}
.cp__cell-name { display: inline-flex; flex-direction: column; vertical-align: middle; }
.cp__name { font-weight: 700; color: var(--color-ink); transition: color 120ms; }
.cp__namesub { font-size: 11.5px; color: var(--color-muted); }
.cp__lvl { color: var(--color-ink-soft); }
.cp__lic-late { color: oklch(0.45 0.15 30); font-weight: 700; }
.cp__none { color: var(--color-muted-soft, #c8c4b8); }
.cp__noneRow { text-align: center; color: var(--color-muted); padding: 22px !important; }

.cp__chip {
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 3.5px 10px;
  white-space: nowrap;
}
.cp__chip--navy { background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260); }
.cp__chip--ok { background: oklch(0.95 0.05 150); color: oklch(0.4 0.12 150); }
.cp__chip--hold { background: var(--color-surface-soft); color: var(--color-muted); border: 1px dashed var(--color-line); }
.cp__chip--due { background: oklch(0.95 0.04 30); color: oklch(0.45 0.15 30); }
.cp__chip--warn { background: oklch(0.96 0.05 80); color: oklch(0.48 0.11 75); }
</style>
