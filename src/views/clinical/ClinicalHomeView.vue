<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, ChevronRight, CalendarDays, GraduationCap, BadgeCheck, School } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import PipelineActionCenter from '@/components/pipeline/PipelineActionCenter.vue'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import { useExams } from '@/composables/useExams'
import { useClinicalMessages, type FtepMessage } from '@/composables/useClinicalMessages'
import type { PipelinePerson } from '@/types'

/**
 * Today — the Clinical Development work queue. Every row is a pending
 * decision with its action one click away; when the queues are empty,
 * the department is caught up. The stat cards isolate their own slice
 * on the Board (the items behind the number, never the full grid), and
 * anyone covering this desk starts here cold.
 */

const router = useRouter()
const clinical = useClinical()
const {
  ready,
  canViewBoard,
  canEdit,
  clinicalPeople,
  inPipeline,
  complianceItems,
  fullyCurrentCount,
  comingUp,
  personById,
  phasesFor,
} = clinical

const ftep = useFtep()
const exams = useExams()
const { loadRecent } = useClinicalMessages()

/* The queue is the clinical department's surface. Supervisors/FTOs get
   FTEP as their home; crew get My Progress on the legacy route. */
watch(
  [ready, canEdit, canViewBoard],
  ([r, edit, board]) => {
    if (r && !edit) router.replace(board ? '/clinical/ftep' : '/clinical-development')
  },
  { immediate: true },
)

const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

/* ── Search with typeahead (kept from the hub) ─────────────────────── */
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

/* ── stat cards — each isolates its slice on the Board ─────────────── */
const expiredItems = computed(() => complianceItems.value.filter((i) => i.state === 'expired'))
const missingItems = computed(() => complianceItems.value.filter((i) => i.state === 'missing'))
const soonItems = computed(() => complianceItems.value.filter((i) => i.state === 'soon'))

function goBoard(focus: string) {
  router.push({ path: '/clinical/board', query: focus ? { focus } : {} })
}

/* ── Field training queue ──────────────────────────────────────────── */

/** Trainees whose active transition has no anchored (started) phase —
 *  day counts and projections can't run until a start date is set. */
const unanchored = computed(() =>
  inPipeline.value.filter((p) => {
    const rows = phasesFor(p.record.id)
    return !rows.some((r) => r.startedAt && !r.completedAt)
  }),
)

const unreviewed = computed(() =>
  ftep.reports.value.filter((r) => r.status === 'submitted' && !r.reviewedAt),
)
const newestUnreviewed = computed(() => unreviewed.value[0] ?? null)

const awaitingRelease = computed(() =>
  exams.assignments.value.filter((a) => a.status === 'assigned'),
)

const recentMessages = ref<FtepMessage[]>([])
onMounted(async () => {
  recentMessages.value = (await loadRecent(7)).slice(0, 3)
})

function traineeNameForRecord(recordId: string): { name: string; userId: string | null } {
  const p = clinicalPeople.value.find((x) => x.record.id === recordId)
  return p ? { name: p.fullName, userId: p.userId } : { name: 'a trainee', userId: null }
}

const queueCount = computed(
  () =>
    unanchored.value.length +
    (unreviewed.value.length > 0 ? 1 : 0) +
    awaitingRelease.value.length +
    recentMessages.value.length +
    expiredItems.value.length +
    missingItems.value.length,
)

/* ── classes to schedule — renewal clusters ────────────────────────── */
const classClusters = computed(() => {
  const byName = new Map<string, { count: number; soonest: number; expired: number }>()
  for (const i of complianceItems.value) {
    if (i.name === 'TX License') continue
    const cur = byName.get(i.name) ?? { count: 0, soonest: Infinity, expired: 0 }
    cur.count++
    if (i.state === 'expired' || i.state === 'missing') cur.expired++
    if (i.days !== null && i.days >= 0) cur.soonest = Math.min(cur.soonest, i.days)
    byName.set(i.name, cur)
  }
  return [...byName.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.expired - a.expired || a.soonest - b.soonest)
})

function fmtWhen(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtMsgWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="ch">
    <ClinicalNav :crumbs="[]" />

    <header class="ch__head">
      <div>
        <h1 class="display ch__title">{{ today }}</h1>
        <div class="ch__sub">
          The work queue · {{ clinicalPeople.length }} clinical files ·
          {{ queueCount }} item{{ queueCount === 1 ? '' : 's' }} waiting
        </div>
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

      <!-- Stat cards: each opens ITS slice on the Board — the items
           behind the number, never the full grid. -->
      <div class="ch__tiles">
        <button type="button" class="ch__tile" @click="goBoard('current')">
          <span class="ch__tile-n">{{ fullyCurrentCount }}</span>
          <span class="ch__tile-l">Fully current</span>
        </button>
        <button type="button" class="ch__tile ch__tile--warn" @click="goBoard('soon')">
          <span class="ch__tile-n">{{ soonItems.length }}</span>
          <span class="ch__tile-l">Expiring ≤ 90 days</span>
        </button>
        <button type="button" class="ch__tile ch__tile--due" @click="goBoard('expired')">
          <span class="ch__tile-n">{{ expiredItems.length }}</span>
          <span class="ch__tile-l">Expired</span>
        </button>
        <button type="button" class="ch__tile ch__tile--due" @click="goBoard('missing')">
          <span class="ch__tile-n">{{ missingItems.length }}</span>
          <span class="ch__tile-l">Missing required</span>
        </button>
        <button type="button" class="ch__tile" @click="router.push('/clinical/ftep')">
          <span class="ch__tile-n">{{ inPipeline.length }}</span>
          <span class="ch__tile-l">In FTEP</span>
        </button>
      </div>

      <div class="ch__cols">
        <div class="ch__main">
          <!-- ── Field training queue ── -->
          <section class="ch__card ch__card--navy">
            <div class="ch__card-hd">
              <GraduationCap :size="15" :stroke-width="2" />
              Field training
              <RouterLink to="/clinical/ftep" class="ch__hdlnk">open FTEP</RouterLink>
            </div>
            <button
              v-for="p in unanchored"
              :key="p.userId"
              type="button"
              class="ch__row"
              @click="openFile(p)"
            >
              <span class="ch__row-who">{{ p.fullName }} <small>· {{ p.record.certLevel }}</small></span>
              <span class="ch__row-what">No phase anchored — day counts and projections can't run</span>
              <span class="ch__row-st ch__warn">Set start date →</span>
            </button>
            <button
              v-if="unreviewed.length"
              type="button"
              class="ch__row"
              @click="router.push('/clinical/submissions')"
            >
              <span class="ch__row-who">{{ unreviewed.length }} report{{ unreviewed.length === 1 ? '' : 's' }} <small>· unreviewed</small></span>
              <span class="ch__row-what">
                Newest: {{ newestUnreviewed?.kind.toUpperCase() }} on
                {{ personById(newestUnreviewed?.traineeId ?? '')?.fullName ?? 'a trainee' }} —
                {{ newestUnreviewed ? fmtWhen(newestUnreviewed.evalDate) : '' }}
              </span>
              <span class="ch__row-st ch__mut">Review →</span>
            </button>
            <button
              v-for="a in awaitingRelease"
              :key="a.id"
              type="button"
              class="ch__row"
              @click="router.push('/clinical/exams')"
            >
              <span class="ch__row-who">{{ personById(a.userId)?.fullName ?? 'Candidate' }} <small>· exam</small></span>
              <span class="ch__row-what">Protocol exam assigned — not yet released</span>
              <span class="ch__row-st ch__mut">Release →</span>
            </button>
            <button
              v-for="m in recentMessages"
              :key="m.id"
              type="button"
              class="ch__row"
              @click="traineeNameForRecord(m.recordId).userId && router.push(`/clinical/people/${traineeNameForRecord(m.recordId).userId}`)"
            >
              <span class="ch__row-who">{{ traineeNameForRecord(m.recordId).name }} <small>· message</small></span>
              <span class="ch__row-what">
                {{ personById(m.authorId)?.fullName ?? 'Staff' }}:
                “{{ m.body.length > 70 ? m.body.slice(0, 68) + '…' : m.body }}” — {{ fmtMsgWhen(m.createdAt) }}
              </span>
              <span class="ch__row-st ch__mut">Reply →</span>
            </button>
            <div
              v-if="!unanchored.length && !unreviewed.length && !awaitingRelease.length && !recentMessages.length"
              class="ch__card-empty"
            >
              Nothing waiting — every trainee is anchored, reviewed, and quiet.
            </div>
          </section>

          <!-- ── Credentials queue ── -->
          <section class="ch__card ch__card--due">
            <div class="ch__card-hd">
              <BadgeCheck :size="15" :stroke-width="2" />
              Credentials
              <button type="button" class="ch__hdlnk" @click="goBoard('')">open the board</button>
            </div>
            <button
              v-for="(i, idx) in complianceItems.filter((x) => x.state !== 'soon').slice(0, 8)"
              :key="idx"
              type="button"
              class="ch__row"
              @click="openFile(i.person)"
            >
              <span class="ch__row-who">{{ i.person.fullName }} <small>· {{ i.person.record.certLevel }}</small></span>
              <span class="ch__row-what">
                <b>{{ i.name }}</b> —
                {{ i.state === 'missing' ? 'no card on file, required' : `expired${i.when ? ' ' + fmtWhen(i.when) : ''}` }}
              </span>
              <span class="ch__row-st ch__bad">{{ i.days !== null && i.days < 0 ? `${-i.days}d overdue` : 'missing' }}</span>
            </button>
            <div v-if="complianceItems.filter((x) => x.state !== 'soon').length === 0" class="ch__card-empty">
              No expired or missing items — the board is clean.
            </div>
          </section>

          <!-- ── Classes to schedule ── -->
          <section class="ch__card ch__card--gold">
            <div class="ch__card-hd">
              <School :size="15" :stroke-width="2" />
              Classes to schedule
            </div>
            <button
              v-for="c in classClusters"
              :key="c.name"
              type="button"
              class="ch__row"
              @click="router.push('/training/manage')"
            >
              <span class="ch__row-who">{{ c.name }} <small>· cluster</small></span>
              <span class="ch__row-what">
                {{ c.count }} in the window{{ c.expired ? ` (${c.expired} already expired/missing)` : '' }}
                — one course covers them
              </span>
              <span class="ch__row-st ch__warn">Plan a class →</span>
            </button>
            <div v-if="classClusters.length === 0" class="ch__card-empty">
              No renewal clusters inside 90 days.
            </div>
          </section>

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

/* Stat cards — number + label only; clicking isolates the slice */
.ch__tiles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin: 22px 0;
}
@media (min-width: 900px) {
  .ch__tiles { grid-template-columns: repeat(5, 1fr); }
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

/* Columns */
.ch__cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
@media (min-width: 1000px) {
  .ch__cols { grid-template-columns: 1.5fr 1fr; align-items: start; }
}
.ch__main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.ch__card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  overflow: hidden;
}
.ch__card--navy { border-left: 3px solid var(--color-brand-700, var(--color-brand-800)); }
.ch__card--due { border-left: 3px solid oklch(0.52 0.17 25); }
.ch__card--gold { border-left: 3px solid var(--color-accent-strong, #a8842c); }
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
.ch__hdlnk {
  margin-left: auto;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 650;
  color: var(--color-brand-700, var(--color-brand-800));
  text-decoration: underline dotted var(--color-line);
  text-underline-offset: 3px;
  cursor: pointer;
}
.ch__card-empty {
  padding: 16px;
  font-size: 12.5px;
  color: var(--color-muted);
}

/* queue rows */
.ch__row {
  display: grid;
  grid-template-columns: minmax(150px, 200px) 1fr auto;
  gap: 12px;
  align-items: baseline;
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
.ch__row:hover { background: var(--color-surface-soft); }
.ch__row:last-of-type { border-bottom: none; }
.ch__row-who {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch__row-who small {
  font-weight: 600;
  color: var(--color-muted);
}
.ch__row-what {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  line-height: 1.45;
  min-width: 0;
}
.ch__row-st {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.ch__bad { color: oklch(0.5 0.17 25); }
.ch__warn { color: oklch(0.5 0.12 70); }
.ch__mut { color: var(--color-muted); }
@media (max-width: 560px) {
  .ch__row { grid-template-columns: 1fr auto; }
  .ch__row-what { grid-column: 1 / -1; order: 3; }
}

/* coming-up rail */
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
</style>
