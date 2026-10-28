<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardCheck, Check, RotateCcw, Download } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { generateSkillsDayPacketPdf } from '@/lib/skillsDayPacketPdf'
import SkillsSetupPanel from '@/views/skills/SkillsSetupPanel.vue'
import type { SkillsDaySession } from '@/types'

/**
 * Skills Day home. Evaluators get the Stations and Board tabs; when
 * Skills Days are scheduled, a day selector scopes both to exactly the
 * stations and trainees assigned to that day. Admins get a Setup tab:
 * create Skills Days, manage stations and their requirements, and the
 * extra-evaluator grant list. Non-evaluators (a candidate who signs in
 * later) see their own results read-only.
 */

const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  checkoffs,
  evaluations,
  days,
  isEvaluator,
  nameFor,
  evaluationFor,
  redoKeys,
  stationsForDay,
  candidatesForDay,
  appliesTo,
} = useSkillsDay()

const tab = ref<'stations' | 'board' | 'setup'>('stations')
const activeCheckoffId = ref<string | null>(null)

/* ── Day selection ──────────────────────────────────────────────── */
const activeDays = computed(() => days.value.filter((d) => d.active))
const selectedDayId = ref<string | null>(null)
let dayDefaulted = false
watch(
  [ready, activeDays],
  () => {
    if (!ready.value || dayDefaulted) return
    dayDefaulted = true
    const list = activeDays.value
    if (!list.length) return
    const today = new Date().toLocaleDateString('en-CA')
    const todays = list.find((d) => d.onDate === today)
    const upcoming = list.find((d) => d.onDate > today)
    selectedDayId.value = (todays ?? upcoming ?? list[list.length - 1]).id
  },
  { immediate: true },
)

function fmtDay(d: SkillsDaySession): string {
  const date = new Date(`${d.onDate}T12:00:00`)
  const base = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return d.label ? `${base} · ${d.label}` : base
}

/* Stations and trainees scoped to the selected day (everything when
   no day is selected). */
const dayCheckoffs = computed(() => stationsForDay(selectedDayId.value))
const dayCands = computed(() => candidatesForDay(selectedDayId.value))
const activeCheckoff = computed(
  () => dayCheckoffs.value.find((c) => c.id === activeCheckoffId.value) ?? null,
)

function candidatesAt(checkoffId: string) {
  return dayCands.value.filter((c) => appliesTo(selectedDayId.value, checkoffId, c.id))
}

function statusFor(checkoffId: string, candidateId: string): 'pass' | 'redo' | 'open' {
  const e = evaluationFor(checkoffId, candidateId)
  if (!e) return 'open'
  return redoKeys(e).length > 0 ? 'redo' : 'pass'
}

function checkoffProgress(checkoffId: string): { done: number; total: number } {
  const eligible = candidatesAt(checkoffId)
  const done = eligible.filter((c) => statusFor(checkoffId, c.id) === 'pass').length
  return { done, total: eligible.length }
}

function goEvaluate(checkoffId: string, candidateId: string) {
  router.push(`/skills/${checkoffId}/${candidateId}`)
}

/* ── Remediation queue ──────────────────────────────────────────── */
interface QueueEntry {
  checkoffId: string
  checkoffTitle: string
  candidateId: string
  candidateName: string
  items: string[]
}
const remediationQueue = computed<QueueEntry[]>(() => {
  const out: QueueEntry[] = []
  const rosterIds = new Set(dayCands.value.map((c) => c.id))
  for (const e of evaluations.value) {
    const keys = redoKeys(e)
    if (keys.length === 0) continue
    /* With a day selected, only that day's trainees are in play —
       rechecks can run at any station, so the station set isn't
       filtered. */
    if (selectedDayId.value && !rosterIds.has(e.candidateId)) continue
    const checkoff = checkoffs.value.find((c) => c.id === e.checkoffId)
    if (!checkoff) continue
    const labels = keys.map(
      (k) =>
        checkoff.sections.flatMap((s) => s.items).find((it) => it.key === k)?.label ?? k,
    )
    out.push({
      checkoffId: e.checkoffId,
      checkoffTitle: checkoff.title,
      candidateId: e.candidateId,
      candidateName: nameFor(e.candidateId),
      items: labels,
    })
  }
  return out.sort((a, b) => a.candidateName.localeCompare(b.candidateName))
})

/* ── Packet PDF ─────────────────────────────────────────────────── */
const generatingFor = ref<string | null>(null)
async function downloadPacket(candidateId: string) {
  generatingFor.value = candidateId
  try {
    /* Packets always cover every active station, not just the
       selected day's. */
    const doc = await generateSkillsDayPacketPdf({
      candidateName: nameFor(candidateId),
      checkoffs: checkoffs.value,
      evaluations: evaluations.value.filter((e) => e.candidateId === candidateId),
      nameFor,
    })
    const safe = nameFor(candidateId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_NEOP_Skills_Day_${safe}.pdf`)
  } finally {
    generatingFor.value = null
  }
}

/* ── My results (non-evaluator) ─────────────────────────────────── */
const myEvaluations = computed(() =>
  evaluations.value.filter((e) => e.candidateId === auth.appUser?.id),
)
</script>

<template>
  <div class="sd">
    <header class="sd__header">
      <div class="sd__head-left">
        <ClipboardCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <div>
          <h1 class="display sd__title">NEOP Skills Day</h1>
          <div class="sd__meta">
            Competency check-offs · signed at the station ·
            <RouterLink to="/skills/protocol-updates" class="sd__protolink">2026 protocol skills verification</RouterLink>
          </div>
        </div>
      </div>
      <div v-if="isEvaluator" class="sd__tabs">
        <button
          type="button"
          class="sd__tab"
          :class="{ 'sd__tab--on': tab === 'stations' }"
          @click="tab = 'stations'"
        >
          Stations
        </button>
        <button
          type="button"
          class="sd__tab"
          :class="{ 'sd__tab--on': tab === 'board' }"
          @click="tab = 'board'"
        >
          Board
        </button>
        <button
          v-if="auth.isAdmin"
          type="button"
          class="sd__tab"
          :class="{ 'sd__tab--on': tab === 'setup' }"
          @click="tab = 'setup'"
        >
          Setup
        </button>
      </div>
    </header>

    <!-- Day selector -->
    <div
      v-if="ready && isEvaluator && tab !== 'setup' && activeDays.length"
      class="sd__days"
    >
      <button
        v-for="d in activeDays"
        :key="d.id"
        type="button"
        class="sd__day-chip"
        :class="{ 'sd__day-chip--on': selectedDayId === d.id }"
        @click="selectedDayId = d.id; activeCheckoffId = null"
      >
        {{ fmtDay(d) }}
      </button>
      <button
        type="button"
        class="sd__day-chip"
        :class="{ 'sd__day-chip--on': selectedDayId === null }"
        @click="selectedDayId = null; activeCheckoffId = null"
      >
        All
      </button>
      <RouterLink
        v-if="selectedDayId"
        :to="`/skills/day/${selectedDayId}/badges`"
        class="sd__day-chip sd__day-chip--link"
      >
        QR badges
      </RouterLink>
      <RouterLink to="/skills/station-setup" class="sd__day-chip sd__day-chip--link">
        Station setup
      </RouterLink>
    </div>

    <div v-if="!ready" class="sd__empty">Loading…</div>

    <!-- Candidate self-view -->
    <template v-else-if="!isEvaluator">
      <div v-if="myEvaluations.length === 0" class="sd__empty">
        No check-offs recorded for you yet.
      </div>
      <div v-else class="sd__mylist">
        <div v-for="e in myEvaluations" :key="e.id" class="sd__myrow">
          <span class="sd__myrow-title">
            {{ checkoffs.find((c) => c.id === e.checkoffId)?.title }}
          </span>
          <span
            class="sd__chip"
            :class="redoKeys(e).length ? 'sd__chip--redo' : 'sd__chip--pass'"
          >
            {{ redoKeys(e).length ? 'Remediation' : 'Pass' }}
          </span>
        </div>
      </div>
    </template>

    <!-- Stations tab -->
    <template v-else-if="tab === 'stations'">
      <!-- Station picker -->
      <div v-if="!activeCheckoff" class="sd__stations">
        <div v-if="dayCheckoffs.length === 0" class="sd__empty sd__empty--wide">
          No stations scheduled for this day yet<span v-if="auth.isAdmin">
            — add them under Setup</span
          >.
        </div>
        <button
          v-for="c in dayCheckoffs"
          :key="c.id"
          type="button"
          class="sd__station"
          @click="activeCheckoffId = c.id"
        >
          <div class="sd__station-sub">{{ c.subtitle }}</div>
          <div class="sd__station-title">{{ c.title }}</div>
          <div class="sd__station-progress">
            <div class="sd__station-bar">
              <div
                class="sd__station-fill"
                :style="{
                  width:
                    (checkoffProgress(c.id).total
                      ? (checkoffProgress(c.id).done / checkoffProgress(c.id).total) * 100
                      : 0) + '%',
                }"
              ></div>
            </div>
            {{ checkoffProgress(c.id).done }}/{{ checkoffProgress(c.id).total }}
          </div>
        </button>
      </div>

      <!-- Candidate list for the chosen station -->
      <template v-else>
        <button type="button" class="sd__back" @click="activeCheckoffId = null">
          ← All stations
        </button>
        <h2 class="sd__station-head display">{{ activeCheckoff.title }}</h2>
        <div v-if="candidatesAt(activeCheckoff.id).length === 0" class="sd__empty">
          No trainees assigned to this station<span v-if="selectedDayId"> for this day</span
          ><span v-if="auth.isAdmin"> — assign them under Setup</span>.
        </div>
        <div v-else class="sd__candidates">
          <button
            v-for="cand in candidatesAt(activeCheckoff.id)"
            :key="cand.id"
            type="button"
            class="sd__cand"
            @click="goEvaluate(activeCheckoff!.id, cand.id)"
          >
            <span class="sd__cand-name">{{ cand.fullName }}</span>
            <span
              class="sd__chip"
              :class="{
                'sd__chip--pass': statusFor(activeCheckoff!.id, cand.id) === 'pass',
                'sd__chip--redo': statusFor(activeCheckoff!.id, cand.id) === 'redo',
                'sd__chip--open': statusFor(activeCheckoff!.id, cand.id) === 'open',
              }"
            >
              <Check
                v-if="statusFor(activeCheckoff!.id, cand.id) === 'pass'"
                :size="11"
                :stroke-width="2.5"
              />
              <RotateCcw
                v-else-if="statusFor(activeCheckoff!.id, cand.id) === 'redo'"
                :size="11"
                :stroke-width="2.5"
              />
              {{
                statusFor(activeCheckoff!.id, cand.id) === 'pass'
                  ? 'Pass'
                  : statusFor(activeCheckoff!.id, cand.id) === 'redo'
                    ? 'Redo items'
                    : 'Start'
              }}
            </span>
          </button>
        </div>
      </template>
    </template>

    <!-- Board tab -->
    <template v-else-if="tab === 'board'">
      <div v-if="dayCheckoffs.length === 0 || dayCands.length === 0" class="sd__empty">
        Nothing on the board<span v-if="selectedDayId"> for this day</span> yet<span
          v-if="auth.isAdmin"
        >
          — schedule stations and trainees under Setup</span
        >.
      </div>
      <div v-else class="sd__board-wrap">
        <table class="sd__board">
          <thead>
            <tr>
              <th class="sd__board-name">Trainee</th>
              <th v-for="c in dayCheckoffs" :key="c.id">{{ c.title.replace('Cardiac Monitor (LP15)', 'LP15').replace('Sapphire IV Pump', 'IV Pump') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cand in dayCands" :key="cand.id">
              <td class="sd__board-name">{{ cand.fullName }}</td>
              <td v-for="c in dayCheckoffs" :key="c.id">
                <button
                  v-if="appliesTo(selectedDayId, c.id, cand.id)"
                  type="button"
                  class="sd__tile"
                  :class="`sd__tile--${statusFor(c.id, cand.id)}`"
                  @click="goEvaluate(c.id, cand.id)"
                >
                  <Check v-if="statusFor(c.id, cand.id) === 'pass'" :size="14" :stroke-width="2.5" />
                  <RotateCcw v-else-if="statusFor(c.id, cand.id) === 'redo'" :size="13" :stroke-width="2.5" />
                </button>
                <span v-else class="sd__tile sd__tile--na" title="Not assigned to this station">—</span>
              </td>
              <td>
                <button
                  type="button"
                  class="sd__pdf-btn"
                  :disabled="generatingFor === cand.id"
                  title="Download signed packet PDF"
                  @click="downloadPacket(cand.id)"
                >
                  <Download :size="13" :stroke-width="2" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Remediation queue -->
      <section class="sd__queue">
        <h2 class="sd__queue-title">
          Second-attempt queue
          <span v-if="remediationQueue.length" class="sd__queue-count">{{ remediationQueue.length }}</span>
        </h2>
        <div v-if="remediationQueue.length === 0" class="sd__queue-empty">
          Nothing outstanding — every submitted check-off is clean.
        </div>
        <button
          v-for="q in remediationQueue"
          :key="q.checkoffId + q.candidateId"
          type="button"
          class="sd__queue-row"
          @click="goEvaluate(q.checkoffId, q.candidateId)"
        >
          <div class="sd__queue-who">
            <strong>{{ q.candidateName }}</strong> · {{ q.checkoffTitle }}
          </div>
          <div class="sd__queue-items">{{ q.items.join(' · ') }}</div>
        </button>
      </section>

    </template>

    <!-- Setup tab (admin) -->
    <template v-else-if="tab === 'setup' && auth.isAdmin">
      <SkillsSetupPanel />
    </template>
  </div>
</template>

<style scoped>
.sd {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px;
}
.sd__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.sd__head-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.sd__title {
  font-size: 26px;
  line-height: 1.15;
  color: var(--color-ink);
}
.sd__protolink {
  color: var(--color-brand-600);
  font-weight: 650;
  text-decoration: underline dotted var(--color-line);
  text-underline-offset: 3px;
}
.sd__protolink:hover { color: var(--color-ink); }
.sd__meta {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.sd__tabs {
  display: flex;
  gap: 4px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 3px;
}
.sd__tab {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  border-radius: 8px;
  padding: 7px 16px;
  cursor: pointer;
}
.sd__tab--on {
  background: var(--color-brand-800);
  color: white;
}
.sd__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
}

/* Stations */
.sd__stations {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.sd__station {
  text-align: left;
  padding: 16px;
  border: 2px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: border-color 120ms var(--ease-out);
}
.sd__station:hover {
  border-color: var(--color-brand-600);
}
.sd__station-sub {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-strong, #a8842c);
}
.sd__station-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-ink);
  margin: 3px 0 10px;
}
.sd__station-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.sd__station-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  overflow: hidden;
}
.sd__station-fill {
  height: 100%;
  background: oklch(0.55 0.13 150);
  border-radius: 999px;
  transition: width 300ms var(--ease-out);
}

.sd__back {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  padding: 0;
  margin-bottom: 10px;
  cursor: pointer;
}
.sd__station-head {
  font-size: 21px;
  color: var(--color-ink);
  margin-bottom: 12px;
}
.sd__candidates {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
}
.sd__cand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border: none;
  border-bottom: 1px solid var(--color-line);
  background: none;
  cursor: pointer;
  font-family: var(--font-sans);
}
.sd__cand:last-child {
  border-bottom: none;
}
.sd__cand:hover {
  background: var(--color-surface-soft);
}
.sd__cand-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.sd__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 4px 10px;
}
.sd__chip--pass {
  background: oklch(0.95 0.05 150);
  color: oklch(0.42 0.13 150);
}
.sd__chip--redo {
  background: oklch(0.96 0.05 60);
  color: oklch(0.45 0.12 60);
}
.sd__chip--open {
  background: var(--color-surface-soft);
  color: var(--color-muted);
  border: 1px dashed var(--color-muted-soft);
}

/* Board */
.sd__board-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
}
.sd__board {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
}
.sd__board th {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 10px 6px;
  text-align: center;
  border-bottom: 1px solid var(--color-line);
  white-space: nowrap;
}
.sd__board td {
  padding: 6px;
  text-align: center;
  border-bottom: 1px solid var(--color-line);
}
.sd__board tr:last-child td {
  border-bottom: none;
}
.sd__board-name {
  text-align: left !important;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  padding-left: 12px !important;
  white-space: nowrap;
}
.sd__tile {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  border: 2px solid var(--color-line);
  background: var(--color-surface-soft);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.sd__tile--pass {
  background: oklch(0.55 0.13 150);
  border-color: oklch(0.55 0.13 150);
}
.sd__tile--redo {
  background: oklch(0.65 0.13 60);
  border-color: oklch(0.65 0.13 60);
}
.sd__pdf-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.sd__pdf-btn:disabled {
  opacity: 0.4;
}

/* Queue */
.sd__queue {
  margin-top: 22px;
}
.sd__queue-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.sd__queue-count {
  background: oklch(0.96 0.05 60);
  color: oklch(0.45 0.12 60);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
}
.sd__queue-empty {
  font-size: 13px;
  color: var(--color-muted);
}
.sd__queue-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid oklch(0.88 0.05 60);
  border-radius: 10px;
  background: oklch(0.98 0.02 60);
  cursor: pointer;
  font-family: var(--font-sans);
}
.sd__queue-who {
  font-size: 13px;
  color: var(--color-ink);
}
.sd__queue-items {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-ink-soft);
}

/* Day selector */
.sd__days {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin: -6px 0 16px;
}
.sd__day-chip {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 7px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.sd__day-chip--link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  border-style: dashed;
  color: var(--color-accent-700);
}
.sd__day-chip--on {
  color: white;
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
}

.sd__tile--na {
  background: none;
  border-color: transparent;
  color: var(--color-muted-soft, var(--color-muted));
  cursor: default;
  font-size: 13px;
}
.sd__empty--wide {
  grid-column: 1 / -1;
}

/* My results */
.sd__mylist {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
}
.sd__myrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-line);
}
.sd__myrow:last-child {
  border-bottom: none;
}
.sd__myrow-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
</style>
