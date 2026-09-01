<script setup lang="ts">
import { computed } from 'vue'
import { X, Check, AlertTriangle, CalendarDays } from 'lucide-vue-next'
import type { PipelinePerson } from '@/types'
import { activeTransitionFor, gateItemsFor, petitionItemsFor } from '@/constants/pipelineGates'
import { FTEP_PROGRAM_PHASES, type FtepProgramPhase } from '@/constants/ftepForms'
import { usePipeline } from '@/composables/usePipeline'
import { useClinical } from '@/composables/useClinical'
import { useFtep } from '@/composables/useFtep'
import {
  buildDorDateSet,
  dayState as sharedDayState,
  scheduleSatisfied,
  todayIso,
  type ScheduledDayState,
} from '@/lib/ftepSchedule'

/**
 * Trainee quickview — click a card on the FTEP page and get the
 * planning picture in one place: current phase and days remaining,
 * the scheduled days matched against submitted DORs, what's still
 * needed to advance, and recent performance. Read-only; the stepper
 * and Actions menu stay the editing surfaces.
 */

const props = defineProps<{
  person: PipelinePerson | null
}>()
const emit = defineEmits<{ close: [] }>()

const { phasesFor } = usePipeline()
const { ftepTrackFor, gatesFor, manualRideouts, gateStatsFor } = useClinical()
const ftep = useFtep()

const record = computed(() => props.person?.record ?? null)
const track = computed(() => (props.person ? ftepTrackFor(props.person) : null))

const phaseSet = computed<FtepProgramPhase[]>(() => {
  if (!record.value) return []
  const t = activeTransitionFor(record.value)
  const paramedic = /emt-p|^lp$/i.test(record.value.certLevel ?? '')
  if ((t === 'NEOP' || t === 'P1C_P1') && paramedic) return FTEP_PROGRAM_PHASES.P1C_P1
  if (t === 'P1_P2') return FTEP_PROGRAM_PHASES.P1_P2
  return []
})

const rowByKey = computed(() => {
  const map = new Map<string, ReturnType<typeof phasesFor>[number]>()
  if (record.value) for (const r of phasesFor(record.value.id)) map.set(r.phaseKey, r)
  return map
})

const dorDates = computed(() =>
  buildDorDateSet(props.person ? ftep.activeDors(props.person.userId) : []),
)

function dayState(day: string, noFto?: boolean): ScheduledDayState {
  return sharedDayState(dorDates.value, day, noFto)
}

function phaseState(ph: FtepProgramPhase): 'done' | 'current' | 'scheduled' | 'todo' {
  const row = rowByKey.value.get(ph.key)
  if (!row) return 'todo'
  if (row.completedAt && row.completedAt <= todayIso()) return 'done'
  if (scheduleSatisfied(row, dorDates.value, ph.noFto)) return 'done'
  const days = row.scheduledDays
  const started =
    (row.startedAt && row.startedAt <= todayIso()) || (days[0] && days[0] <= todayIso())
  if (started) return 'current'
  if (row.startedAt || days.length > 0 || row.completedAt) return 'scheduled'
  return 'todo'
}

const currentPhase = computed(
  () =>
    phaseSet.value.find((p) => phaseState(p) === 'current') ??
    phaseSet.value.find((p) => phaseState(p) === 'scheduled') ??
    null,
)

/** Scheduled days still ahead across every phase. */
const upcomingDays = computed(() =>
  phaseSet.value
    .flatMap((ph) => (rowByKey.value.get(ph.key)?.scheduledDays ?? []).map((d) => ({ d, ph })))
    .filter(({ d }) => d >= todayIso())
    .sort((a, b) => a.d.localeCompare(b.d)),
)

const programDays = computed(() => {
  const r = record.value
  if (!r?.workingStartedAt) return null
  const used = Math.max(
    0,
    Math.floor((Date.now() - new Date(`${r.workingStartedAt}T00:00:00`).getTime()) / 86_400_000),
  )
  let left: number | null = null
  if (r.workingTargetAt) {
    left = Math.ceil(
      (new Date(`${r.workingTargetAt}T00:00:00`).getTime() - Date.now()) / 86_400_000,
    )
  }
  return { used, left, target: r.workingTargetAt }
})

const needs = computed(() => {
  if (!record.value) return { items: [], pets: [] }
  const rows = gatesFor(record.value.id)
  return {
    items: gateItemsFor(record.value, rows, props.person ? gateStatsFor(props.person) : undefined).filter(
      (i) => i.status !== 'complete' && i.status !== 'na',
    ),
    pets: petitionItemsFor(record.value, rows).filter((i) => i.status !== 'complete'),
  }
})

const recentDors = computed(() =>
  props.person
    ? ftep
        .activeDors(props.person.userId)
        .sort((a, b) => b.evalDate.localeCompare(a.evalDate))
        .slice(0, 4)
    : [],
)

const progressLine = computed(() => {
  if (!props.person || !track.value) return null
  const t = track.value
  if (t.key === 'rideup') {
    const dors = ftep.activeDors(props.person.userId).length
    const manual = manualRideouts(props.person)
    return `${Math.max(dors, manual)}/${t.rideoutTarget} supervisor rideouts`
  }
  if (t.icrTarget) {
    return `${ftep.icrCount(props.person.userId, t.legacyPhase)}/${t.icrTarget} ${t.icrLabel}`
  }
  return null
})

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <Teleport to="body">
    <Transition name="qv-fade" :duration="160">
      <div v-if="person && record" class="qv-overlay" @click.self="emit('close')">
        <div class="qv" role="dialog" aria-modal="true" :aria-label="`Quick view: ${person.fullName}`">
          <button class="qv__close" aria-label="Close" @click="emit('close')">
            <X :size="17" />
          </button>

          <div class="qv__head">
            <h2 class="qv__name display">{{ person.fullName }}</h2>
            <div class="qv__sub">
              {{ record.certLevel }}
              <template v-if="record.workingPhase"> · working {{ record.workingPhase }}</template>
              <template v-if="track"> · {{ track.label }}</template>
            </div>
          </div>

          <!-- Phase & time -->
          <div class="qv__grid">
            <div class="qv__stat">
              <b>{{ currentPhase?.label ?? '—' }}</b>
              <span>current phase</span>
            </div>
            <div class="qv__stat">
              <b>{{ programDays ? `Day ${programDays.used + 1}` : '—' }}</b>
              <span>in program</span>
            </div>
            <div class="qv__stat">
              <b>{{ programDays?.left !== null && programDays?.left !== undefined ? `${programDays.left} d` : '—' }}</b>
              <span>until target{{ programDays?.target ? ` (${fmt(programDays.target)})` : '' }}</span>
            </div>
            <div v-if="progressLine" class="qv__stat">
              <b>{{ progressLine.split(' ')[0] }}</b>
              <span>{{ progressLine.split(' ').slice(1).join(' ') }}</span>
            </div>
          </div>

          <!-- Schedule vs DORs -->
          <template v-if="phaseSet.length">
            <div class="qv__sect">
              <CalendarDays :size="13" :stroke-width="2" /> Schedule vs DORs
            </div>
            <div class="qv__sched">
              <template v-for="ph in phaseSet" :key="ph.key">
                <div
                  v-if="rowByKey.get(ph.key)?.scheduledDays.length || phaseState(ph) !== 'todo'"
                  class="qv__phase"
                >
                  <span class="qv__phase-name" :class="`qv__phase-name--${phaseState(ph)}`">
                    {{ ph.label }}
                    <em v-if="rowByKey.get(ph.key)?.ftoName" class="qv__phase-fto">· {{ rowByKey.get(ph.key)!.ftoName }}</em>
                  </span>
                  <span v-if="rowByKey.get(ph.key)?.scheduledDays.length" class="qv__days">
                    <span
                      v-for="d in rowByKey.get(ph.key)!.scheduledDays"
                      :key="d"
                      class="qv__day"
                      :class="`qv__day--${dayState(d, ph.noFto)}`"
                      :title="dayState(d, ph.noFto) === 'missed' ? 'No DOR on file for this day' : undefined"
                    >
                      <Check v-if="dayState(d, ph.noFto) === 'done'" :size="10" :stroke-width="3" />
                      <AlertTriangle v-else-if="dayState(d, ph.noFto) === 'missed'" :size="10" :stroke-width="2.5" />
                      {{ fmt(d) }}
                    </span>
                  </span>
                  <span v-else class="qv__days-none">no days scheduled</span>
                </div>
              </template>
              <div v-if="upcomingDays.length" class="qv__next">
                Next scheduled day: <b>{{ fmt(upcomingDays[0].d) }}</b> ({{ upcomingDays[0].ph.label }})
              </div>
            </div>
          </template>

          <!-- What's still needed -->
          <div class="qv__sect">What's still needed</div>
          <div v-if="needs.items.length || needs.pets.length" class="qv__needs">
            <div v-for="i in needs.items" :key="i.key" class="qv__need">
              <span class="qv__need-dot"></span>
              <span>{{ i.label }}</span>
              <span v-if="i.hint || i.value" class="qv__need-hint">{{ i.value ?? i.hint }}</span>
            </div>
            <div v-for="i in needs.pets" :key="i.key" class="qv__need">
              <span class="qv__need-dot"></span>
              <span>Petition signature — {{ i.label }}</span>
            </div>
          </div>
          <div v-else class="qv__all-done">
            <Check :size="13" :stroke-width="2.5" /> All tracked requirements complete.
          </div>

          <!-- Recent performance -->
          <template v-if="track?.dorTracked">
            <div class="qv__sect">Recent performance</div>
            <div v-if="recentDors.length" class="qv__recent">
              <div v-for="r in recentDors" :key="r.id" class="qv__recent-row">
                <span>{{ fmt(r.evalDate) }}</span>
                <span class="qv__recent-avg">{{ r.payload.average?.toFixed(2) ?? '—' }}</span>
                <span v-if="r.payload.nrtFlagged" class="qv__recent-nrt">NRT</span>
              </div>
            </div>
            <div v-else class="qv__days-none">No DORs on file yet.</div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.qv-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: oklch(0.18 0.03 260 / 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
@media (min-width: 640px) {
  .qv-overlay {
    align-items: center;
    padding: 24px;
  }
}
.qv {
  position: relative;
  width: 100%;
  max-width: 560px;
  max-height: 90dvh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: 16px 16px 0 0;
  box-shadow: var(--shadow-lg);
  padding: 22px 22px 26px;
}
@media (min-width: 640px) {
  .qv {
    border-radius: 16px;
  }
}
.qv__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
}
.qv__name {
  font-size: 22px;
  color: var(--color-ink);
}
.qv__sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-muted);
}
.qv__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.qv__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  padding: 10px 12px;
}
.qv__stat b {
  font-size: 14px;
  color: var(--color-ink);
  line-height: 1.2;
}
.qv__stat span {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.qv__sect {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 18px 0 8px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.qv__phase {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-line-soft);
}
.qv__phase:last-of-type {
  border-bottom: none;
}
.qv__phase-name {
  flex: 0 0 170px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.qv__phase-name--done {
  color: var(--color-success-500);
}
.qv__phase-name--todo {
  color: var(--color-muted);
  font-weight: 600;
}
.qv__phase-fto {
  font-style: normal;
  font-weight: 500;
  font-size: 11px;
  color: var(--color-muted);
}
.qv__days {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.qv__day {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 9px;
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
}
.qv__day--done {
  background: var(--color-success-50, oklch(0.96 0.03 150));
  border-color: oklch(0.85 0.07 150);
  color: oklch(0.4 0.12 150);
}
.qv__day--missed {
  background: oklch(0.96 0.05 60);
  border-color: oklch(0.85 0.08 60);
  color: oklch(0.48 0.13 45);
}
.qv__day--upcoming {
  background: var(--color-surface);
  border-style: dashed;
  color: var(--color-brand-600);
}
.qv__days-none {
  font-size: 11.5px;
  color: var(--color-muted-soft);
}
.qv__next {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-ink-soft);
}
.qv__need {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.qv__need-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-warning-500, oklch(0.68 0.14 75));
}
.qv__need-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-muted-soft);
  font-variant-numeric: tabular-nums;
}
.qv__all-done {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-success-500);
}
.qv__recent-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--color-ink-soft);
  border-bottom: 1px solid var(--color-line-soft);
}
.qv__recent-row:last-child {
  border-bottom: none;
}
.qv__recent-avg {
  margin-left: auto;
  font-weight: 700;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}
.qv__recent-nrt {
  font-size: 10px;
  font-weight: 800;
  color: oklch(0.45 0.15 30);
}
.qv-fade-enter-active,
.qv-fade-leave-active {
  transition: opacity 160ms var(--ease-out);
}
.qv-fade-enter-from,
.qv-fade-leave-to {
  opacity: 0;
}
</style>
