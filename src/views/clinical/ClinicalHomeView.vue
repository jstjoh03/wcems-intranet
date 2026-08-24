<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, ArrowRight, CalendarDays, AlertTriangle, ChevronRight, Upload } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import PipelineActionCenter from '@/components/pipeline/PipelineActionCenter.vue'
import { useClinical } from '@/composables/useClinical'
import type { PipelinePerson } from '@/types'

/**
 * Clinical Development hub — the CDO's landing page. Search that jumps
 * straight to a person's file, clickable stat tiles that pre-filter
 * the roster, the Action Center, and the next-90-days horizon.
 * (Phase 1 of the approved redesign; the legacy /clinical-development
 * board stays live until the section is complete.)
 */

const router = useRouter()
const {
  ready,
  canViewBoard,
  canEdit,
  clinicalPeople,
  attentionPeopleCount,
  inPipeline,
  missingCertPeople,
  comingUp,
} = useClinical()

/* Crew have their own My Progress on the legacy route; the new section
   is for board viewers. */
watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)

const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

/* ── Search with typeahead ─────────────────────────────────────────── */
const query = ref('')
const matches = computed<PipelinePerson[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (q.length < 2) return []
  return clinicalPeople.value
    .filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        (p.station ?? '').toLowerCase().includes(q) ||
        (p.record.certLevel ?? '').toLowerCase().includes(q),
    )
    .slice(0, 7)
})

function openFile(p: PipelinePerson) {
  router.push(`/clinical/people/${p.userId}`)
}

function onSearchEnter() {
  if (matches.value.length > 0) openFile(matches.value[0])
}

function goFiltered(f: string) {
  router.push({ path: '/clinical/people', query: f === 'all' ? {} : { f } })
}

function fmtWhen(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="ch">
    <ClinicalNav :crumbs="[]" />

    <header class="ch__head">
      <div>
        <h1 class="display ch__title">Clinical Development</h1>
        <div class="ch__sub">{{ today }} · {{ clinicalPeople.length }} clinical files</div>
      </div>
    </header>

    <div v-if="!ready" class="ch__empty">Loading…</div>

    <template v-else>
      <div class="ch__search">
        <Search :size="17" :stroke-width="1.9" />
        <input
          v-model="query"
          type="search"
          placeholder="Search an employee — name, cert, station…"
          @keydown.enter="onSearchEnter"
        />
        <span class="ch__search-k">↵ opens their file</span>
        <div v-if="matches.length" class="ch__results">
          <button
            v-for="m in matches"
            :key="m.userId"
            type="button"
            class="ch__result"
            @click="openFile(m)"
          >
            <span class="ch__avatar">{{ m.fullName.split(' ').map(w => w[0]).slice(0, 2).join('') }}</span>
            <span class="ch__result-name">{{ m.fullName }}</span>
            <span class="ch__result-sub">{{ m.record.certLevel }}<template v-if="m.station"> · {{ m.station }}</template></span>
            <ChevronRight :size="13" :stroke-width="2" />
          </button>
        </div>
      </div>

      <div class="ch__tiles">
        <button type="button" class="ch__tile" @click="goFiltered('all')">
          <span class="ch__tile-n">{{ clinicalPeople.length }}</span>
          <span class="ch__tile-l">Clinical files</span>
          <ArrowRight :size="15" :stroke-width="2" class="ch__tile-go" />
        </button>
        <button type="button" class="ch__tile ch__tile--due" @click="goFiltered('attention')">
          <span class="ch__tile-n">{{ attentionPeopleCount }}</span>
          <span class="ch__tile-l">Need attention</span>
          <ArrowRight :size="15" :stroke-width="2" class="ch__tile-go" />
        </button>
        <button type="button" class="ch__tile" @click="goFiltered('pipeline')">
          <span class="ch__tile-n">{{ inPipeline.length }}</span>
          <span class="ch__tile-l">In pipeline</span>
          <ArrowRight :size="15" :stroke-width="2" class="ch__tile-go" />
        </button>
        <button type="button" class="ch__tile ch__tile--warn" @click="goFiltered('missing')">
          <span class="ch__tile-n">{{ missingCertPeople.length }}</span>
          <span class="ch__tile-l">Missing a required cert</span>
          <ArrowRight :size="15" :stroke-width="2" class="ch__tile-go" />
        </button>
      </div>

      <div class="ch__cols">
        <div class="ch__main">
          <PipelineActionCenter :people="clinicalPeople" @open="openFile" />
        </div>
        <aside class="ch__side">
          <div class="ch__card">
            <div class="ch__card-hd">
              <CalendarDays :size="15" :stroke-width="2" />
              Coming up — next 90 days
            </div>
            <button
              v-for="(u, i) in comingUp"
              :key="i"
              type="button"
              class="ch__up"
              @click="u.person && openFile(u.person)"
            >
              <span class="ch__up-when">{{ fmtWhen(u.when) }}</span>
              <span class="ch__up-what">{{ u.detail }}</span>
            </button>
            <div v-if="comingUp.length === 0" class="ch__card-empty">
              Nothing on the 90-day horizon.
            </div>
          </div>
          <div v-if="canEdit" class="ch__hint">
            <AlertTriangle :size="13" :stroke-width="2" />
            Weekly Paycom &amp; EMS1 imports live in the Action Center — “Import reports.”
            <Upload :size="12" :stroke-width="2" />
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ch {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .ch { padding: 24px 32px 80px; }
}
.ch__head {
  margin-bottom: 20px;
}
.ch__title {
  font-size: 32px;
  line-height: 1.1;
  color: var(--color-ink);
}
.ch__sub {
  margin-top: 5px;
  font-size: 13px;
  color: var(--color-muted);
}
.ch__empty {
  padding: 48px 0;
  text-align: center;
  color: var(--color-muted);
}

/* Search */
.ch__search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 12px;
  padding: 12px 16px;
  max-width: 580px;
  color: var(--color-muted);
  transition: border-color 140ms var(--ease-out), box-shadow 140ms var(--ease-out);
}
.ch__search:focus-within {
  border-color: var(--color-accent-strong, #a8842c);
  box-shadow: 0 0 0 3px oklch(0.75 0.09 85 / 0.18);
}
.ch__search input {
  flex: 1;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
}
.ch__search-k {
  font-size: 10px;
  border: 1px solid var(--color-line);
  border-radius: 5px;
  padding: 2px 7px;
  white-space: nowrap;
}
.ch__results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: 0 8px 28px oklch(0.2 0.03 260 / 0.14);
  padding: 6px;
  z-index: 30;
}
.ch__result {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 9px;
  padding: 8px 10px;
  font-family: var(--font-sans);
  cursor: pointer;
}
.ch__result:hover {
  background: var(--color-surface-soft);
}
.ch__result-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.ch__result-sub {
  font-size: 12px;
  color: var(--color-muted);
  flex: 1;
}
.ch__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-brand-950);
  color: var(--color-accent-on-dark, #e8cb72);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Tiles */
.ch__tiles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin: 22px 0;
}
@media (min-width: 900px) {
  .ch__tiles { grid-template-columns: repeat(4, 1fr); }
}
.ch__tile {
  position: relative;
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 17px 18px 15px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: border-color 160ms var(--ease-out), transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out);
}
.ch__tile:hover {
  border-color: var(--color-accent-strong, #a8842c);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px oklch(0.2 0.03 260 / 0.09);
}
.ch__tile-n {
  font-family: var(--font-serif, 'Instrument Serif', serif);
  font-size: 34px;
  line-height: 1;
  color: var(--color-brand-950);
  font-variant-numeric: tabular-nums;
}
.ch__tile--due .ch__tile-n { color: oklch(0.45 0.15 30); }
.ch__tile--warn .ch__tile-n { color: oklch(0.5 0.12 75); }
.ch__tile-l {
  display: block;
  margin-top: 8px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.ch__tile-go {
  position: absolute;
  top: 15px;
  right: 15px;
  color: var(--color-line);
  transition: color 160ms var(--ease-out), transform 160ms var(--ease-out);
}
.ch__tile:hover .ch__tile-go {
  color: var(--color-accent-strong, #a8842c);
  transform: translateX(2px);
}

/* Columns */
.ch__cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
@media (min-width: 1000px) {
  .ch__cols { grid-template-columns: 1.5fr 1fr; align-items: start; }
}
.ch__card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  overflow: hidden;
}
.ch__card-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--color-line);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
}
.ch__card-hd svg { color: var(--color-accent-strong, #a8842c); }
.ch__card-empty {
  padding: 18px 16px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.ch__up {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-surface-soft);
  padding: 10px 16px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.ch__up:hover { background: var(--color-surface-soft); }
.ch__up:last-of-type { border-bottom: none; }
.ch__up-when {
  width: 58px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-accent-strong, #a8842c);
  font-variant-numeric: tabular-nums;
}
.ch__up-what {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  line-height: 1.4;
}
.ch__hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--color-muted);
  padding: 0 4px;
}
</style>
