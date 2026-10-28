<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { QrCode, Check, RotateCcw, ChevronRight } from 'lucide-vue-next'
import { useSkillsDay } from '@/composables/useSkillsDay'
import type { SkillsCheckoff } from '@/types'

/**
 * QR landing page. Each trainee carries a badge whose QR encodes
 * /skills/scan/<their id>; the evaluator scans it, picks the station
 * they are evaluating, and the check-off form opens pre-loaded with
 * that candidate — no scrolling through names at the station.
 */

const route = useRoute()
const router = useRouter()
const {
  ready,
  days,
  dayStationIds,
  dayCandidates,
  isEvaluator,
  candidateById,
  checkoffById,
  evaluationFor,
  redoKeys,
} = useSkillsDay()

const userId = computed(() => String(route.params.userId ?? ''))
const candidate = computed(() => candidateById(userId.value))

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

/* The day this scan applies to: today's assigned day first, else the
   nearest upcoming one, else the most recent past one. */
const day = computed(() => {
  const mine = days.value.filter(
    (d) => d.active && (dayCandidates.value[d.id] ?? []).some((c) => c.userId === userId.value),
  )
  if (!mine.length) return null
  const today = chicagoToday()
  const exact = mine.find((d) => d.onDate === today)
  if (exact) return exact
  const upcoming = mine
    .filter((d) => d.onDate > today)
    .sort((a, b) => a.onDate.localeCompare(b.onDate))
  if (upcoming.length) return upcoming[0]
  return (
    mine
      .filter((d) => d.onDate < today)
      .sort((a, b) => b.onDate.localeCompare(a.onDate))[0] ?? null
  )
})

const stations = computed<SkillsCheckoff[]>(() => {
  if (!day.value) return []
  const entry = (dayCandidates.value[day.value.id] ?? []).find((c) => c.userId === userId.value)
  if (!entry) return []
  const ids = entry.stationIds ?? dayStationIds.value[day.value.id] ?? []
  return ids
    .map((id) => checkoffById(id))
    .filter((c): c is SkillsCheckoff => c !== null && c.active)
    .sort((a, b) => a.sort - b.sort)
})

type StationState = 'pending' | 'recheck' | 'done'

function stateFor(c: SkillsCheckoff): StationState {
  const ev = evaluationFor(c.id, userId.value)
  if (!ev) return 'pending'
  return redoKeys(ev).length ? 'recheck' : 'done'
}

const doneCount = computed(
  () => stations.value.filter((c) => stateFor(c) === 'done').length,
)

function fmtDate(onDate: string): string {
  const [y, m, d] = onDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function go(c: SkillsCheckoff) {
  /* The rhythm quiz is self-service on the trainee's own login — the
     evaluator form never applies. Once recorded, open it read-only. */
  if (c.key === 'rhythm_self' && stateFor(c) === 'pending') return
  router.push(`/skills/${c.id}/${userId.value}`)
}

function subtitleFor(c: SkillsCheckoff): string {
  if (c.key === 'rhythm_self' && stateFor(c) === 'pending')
    return 'Self-service — trainee completes it on their own login at /skills/rhythms'
  return c.subtitle
}
</script>

<template>
  <div class="scan">
    <div v-if="!ready" class="scan__empty">Loading…</div>

    <template v-else-if="!isEvaluator">
      <div class="scan__empty">
        <QrCode :size="28" :stroke-width="1.6" />
        <p>This page is for Skills Day evaluators. Ask an evaluator to scan the badge.</p>
      </div>
    </template>

    <template v-else-if="!candidate">
      <div class="scan__empty">Trainee not found for this badge.</div>
    </template>

    <template v-else>
      <header class="scan__header">
        <div class="scan__kicker">Skills Day check-off</div>
        <h1 class="display scan__name">{{ candidate.fullName }}</h1>
        <div v-if="day" class="scan__daymeta">
          {{ day.label }} · {{ fmtDate(day.onDate) }} · {{ doneCount }}/{{ stations.length }} complete
        </div>
      </header>

      <div v-if="!day" class="scan__empty">
        {{ candidate.fullName }} isn’t assigned to a Skills Day yet — set them up in
        Skills Day → Setup first.
      </div>

      <div v-else class="scan__list">
        <button
          v-for="c in stations"
          :key="c.id"
          type="button"
          class="scan__station"
          :data-state="stateFor(c)"
          @click="go(c)"
        >
          <span class="scan__station-main">
            <span class="scan__station-title">{{ c.title }}</span>
            <span v-if="subtitleFor(c)" class="scan__station-sub">{{ subtitleFor(c) }}</span>
          </span>
          <span class="scan__station-side">
            <span v-if="stateFor(c) === 'done'" class="scan__chip scan__chip--done">
              <Check :size="13" :stroke-width="2.4" /> Complete
            </span>
            <span v-else-if="stateFor(c) === 'recheck'" class="scan__chip scan__chip--redo">
              <RotateCcw :size="13" :stroke-width="2.2" /> Recheck
            </span>
            <span v-else class="scan__chip">Pending</span>
            <ChevronRight :size="18" :stroke-width="2" class="scan__arrow" />
          </span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scan {
  max-width: 560px;
  margin: 0 auto;
  padding: 18px 16px 48px;
}
.scan__header {
  margin-bottom: 18px;
}
.scan__kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.scan__name {
  margin: 2px 0 4px;
  font-size: 30px;
  color: var(--color-brand-700);
}
.scan__daymeta {
  font-size: 13.5px;
  color: var(--color-muted);
}
.scan__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scan__station {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 14px 14px 14px 16px;
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, transform 0.08s ease;
}
.scan__station:active {
  transform: scale(0.99);
}
.scan__station[data-state='done'] {
  border-color: oklch(0.85 0.07 155);
  background: oklch(0.98 0.015 155);
}
.scan__station[data-state='recheck'] {
  border-color: oklch(0.84 0.09 80);
  background: oklch(0.985 0.02 90);
}
.scan__station-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.scan__station-title {
  font-size: 15.5px;
  font-weight: 650;
  color: var(--color-ink);
}
.scan__station-sub {
  font-size: 12px;
  color: var(--color-muted);
}
.scan__station-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.scan__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  font-size: 11.5px;
  font-weight: 650;
  color: var(--color-muted);
  background: var(--color-surface-soft);
}
.scan__chip--done {
  border-color: oklch(0.8 0.09 155);
  background: oklch(0.95 0.045 155);
  color: oklch(0.42 0.1 155);
}
.scan__chip--redo {
  border-color: oklch(0.8 0.1 80);
  background: oklch(0.96 0.05 90);
  color: oklch(0.5 0.11 70);
}
.scan__arrow {
  color: var(--color-muted-soft);
}
.scan__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
</style>
