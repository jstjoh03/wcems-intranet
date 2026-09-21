<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFtep } from '@/composables/useFtep'
import { buildFtepTimeline, type FtepTimeline } from '@/composables/useFtepTimeline'
import type { PipelinePerson } from '@/types'

/**
 * Schedule-linked training timeline — the automated replacement for
 * hand-tracking phase days. Reads the live schedule (days on a truck
 * WITH an FTO), matches DORs by date, and projects phase completion +
 * testing eligibility against the Program Guide day tables.
 */

const props = defineProps<{ person: PipelinePerson }>()

const ftep = useFtep()
const tl = ref<FtepTimeline | null>(null)
const busy = ref(false)
const err = ref<string | null>(null)
const openPhase = ref<string | null>(null)

async function rebuild() {
  busy.value = true
  err.value = null
  try {
    tl.value = await buildFtepTimeline(props.person)
    openPhase.value = tl.value?.phases.find((p) => p.status === 'current')?.key ?? null
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  }
  busy.value = false
}

watch(() => props.person.userId, rebuild, { immediate: true })
/* DORs load async — refresh the day chips once reports arrive. */
watch(ftep.ready, (r) => {
  if (r) void rebuild()
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/* Final evaluation must run under an FTO the trainee has NOT had —
   cross-station pairing takes advance planning, so surface the
   projected start early. */
const finalPlan = computed(() => {
  if (!tl.value) return null
  const ph = tl.value.phases.find((p) => p.key === tl.value!.finalPhaseKey)
  if (!ph || ph.status === 'complete') return null
  return { start: ph.status === 'current' ? ph.startedAt : ph.estStdStart, current: ph.status === 'current' }
})

function fmtY(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
</script>

<template>
  <section v-if="tl || busy" class="ftl">
    <div class="ftl__head">
      <h3 class="ftl__h">Training days — linked from the schedule</h3>
      <span class="ftl__note">days on a truck with an FTO count · DORs match by date</span>
    </div>

    <p v-if="busy" class="ftl__muted">Reading the schedule…</p>
    <p v-else-if="err" class="ftl__err">{{ err }}</p>

    <template v-else-if="tl">
      <div class="ftl__est">
        <div class="ftl__est-main">
          <span class="ftl__est-label">Estimated ready to test{{ tl.transition === 'P1C_P1' ? ' (P1)' : ' (P2)' }}</span>
          <span class="ftl__est-date">{{ fmtY(tl.estTestStd) }}</span>
          <span class="ftl__est-sub">standard pace · minimum {{ fmtY(tl.estTestMin) }}</span>
          <span v-if="tl.accelerated" class="ftl__accel">Accelerated pathway</span>
        </div>
        <div class="ftl__gates">
          <span
            v-for="g in tl.gates"
            :key="g.key"
            class="ftl__gate"
            :class="{ 'ftl__gate--ok': g.complete }"
          >
            {{ g.label }} — {{ g.complete ? 'complete' : g.key === 'mega_code' ? 'needs scheduling' : 'not yet' }}
          </span>
        </div>
      </div>

      <p v-if="finalPlan" class="ftl__final">
        <b>Final evaluation needs a DIFFERENT FTO</b> —
        {{ finalPlan.current ? 'started' : 'projected to start' }} ≈ <b>{{ fmtY(finalPlan.start) }}</b>.
        FTOs used so far: {{ tl.ftosUsed.length ? tl.ftosUsed.join(', ') : 'none yet' }} — plan the
        pairing (and station move) ahead with scheduling.
      </p>

      <p v-if="tl.unanchored" class="ftl__hint">
        No phase has a start date yet — set the phase start in the stepper above and the
        schedule days link up from there.
      </p>

      <div v-for="ph in tl.phases" :key="ph.key" class="ftl__phase" :class="`ftl__phase--${ph.status}`">
        <button type="button" class="ftl__phead" @click="openPhase = openPhase === ph.key ? null : ph.key">
          <span class="ftl__pname">
            Phase {{ ph.no }} · {{ ph.label }}
            <span v-if="ph.status === 'current'" class="ftl__now">current</span>
          </span>
          <span class="ftl__pmeta">
            <template v-if="ph.startedAt">started {{ fmt(ph.startedAt) }}</template>
            <template v-if="ph.ftoName"> · FTO {{ ph.ftoName }}</template>
            <template v-if="ph.completedAt"> · completed {{ fmt(ph.completedAt) }}</template>
          </span>
          <span v-if="ph.standard" class="ftl__counts">
            <span class="ftl__count"><b>{{ ph.actual }}</b> actual</span>
            <span class="ftl__count">min {{ ph.standard.min }}</span>
            <span class="ftl__count">std {{ ph.standard.std }}</span>
            <span class="ftl__count">max {{ ph.standard.max }}</span>
          </span>
        </button>

        <p v-if="ph.status !== 'complete' && ph.standard" class="ftl__proj">
          <template v-if="ph.status === 'current' && ph.actual >= ph.standard.min">
            Minimum met.
          </template>
          Standard count lands ≈ <b>{{ fmt(ph.estStdEnd) }}</b>
          <template v-if="ph.estMinEnd && ph.estMinEnd !== ph.estStdEnd"> · minimum ≈ {{ fmt(ph.estMinEnd) }}</template>
        </p>

        <div v-if="openPhase === ph.key && ph.days.length" class="ftl__days">
          <div v-for="(d, i) in ph.days" :key="d.dateIso" class="ftl__day" :class="{ 'ftl__day--no': !d.counts }">
            <span class="ftl__dayn">Day {{ i + 1 }}</span>
            <span class="ftl__daydate">{{ fmtY(d.dateIso) }}</span>
            <span class="ftl__dayunit">{{ d.unitCode }}</span>
            <span class="ftl__dayfto">
              <template v-if="d.ftoNames.length">{{ d.ftoNames.join(', ') }}</template>
              <template v-else>no FTO — doesn't count</template>
            </span>
            <span
              class="ftl__dor"
              :class="{ 'ftl__dor--ok': d.dor === 'submitted', 'ftl__dor--miss': d.dor === 'missing' }"
            >
              {{ d.dor === 'submitted' ? 'DOR submitted' : d.dor === 'missing' ? 'DOR missing' : '' }}
            </span>
          </div>
        </div>
        <p v-else-if="openPhase === ph.key && ph.startedAt" class="ftl__muted">
          No schedule days with an FTO found in this phase's window yet.
        </p>
      </div>

      <div v-if="tl.upcoming.length" class="ftl__next">
        <span class="ftl__next-h">Next scheduled with an FTO:</span>
        <span v-for="d in tl.upcoming" :key="d.dateIso" class="ftl__next-day">
          {{ fmt(d.dateIso) }} · {{ d.unitCode }}<template v-if="d.ftoNames.length"> ({{ d.ftoNames[0] }})</template>
        </span>
      </div>

      <p v-if="tl.notCounting.length" class="ftl__warn">
        Worked without an FTO (doesn't count):
        {{ tl.notCounting.map((d) => `${fmt(d.dateIso)} · ${d.unitCode}`).join(' · ') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.ftl {
  margin-top: 1rem;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.85rem 1rem 1rem;
}

.ftl__head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}

.ftl__h {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-ink);
  margin: 0;
}

.ftl__note {
  font-size: 0.72rem;
  color: var(--color-muted);
}

.ftl__muted {
  font-size: 0.82rem;
  color: var(--color-muted);
  margin: 0.3rem 0;
}

.ftl__err {
  font-size: 0.82rem;
  color: var(--color-danger-500);
  margin: 0.3rem 0;
}

.ftl__final {
  font-size: 0.8rem;
  color: var(--color-ink);
  background: oklch(0.985 0.012 86.8);
  border: 1px solid oklch(0.85 0.07 86.8);
  border-left: 3px solid var(--color-accent-600);
  border-radius: 8px;
  padding: 0.45rem 0.6rem;
  margin: 0 0 0.6rem;
}

.ftl__hint {
  font-size: 0.8rem;
  color: oklch(0.5 0.12 75);
  background: var(--color-warning-50, oklch(0.97 0.03 86.8));
  border: 1px solid oklch(0.85 0.07 86.8);
  border-radius: 8px;
  padding: 0.45rem 0.6rem;
  margin: 0 0 0.6rem;
}

.ftl__est {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
  border: 1px solid oklch(0.86 0.03 260);
  background: linear-gradient(180deg, oklch(0.975 0.008 260), oklch(0.955 0.012 260));
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  margin-bottom: 0.7rem;
}

.ftl__est-label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.ftl__est-date {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-brand-800);
  margin-right: 0.4rem;
}

.ftl__est-sub {
  font-size: 0.75rem;
  color: var(--color-muted);
}

.ftl__accel {
  display: inline-block;
  margin-left: 0.5rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-accent-700);
  border: 1px solid var(--color-accent-600);
  border-radius: 999px;
  padding: 0.08rem 0.5rem;
}

.ftl__gates {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.ftl__gate {
  font-size: 0.7rem;
  font-weight: 600;
  border: 1px solid oklch(0.85 0.07 86.8);
  color: oklch(0.5 0.12 75);
  background: oklch(0.985 0.012 86.8);
  border-radius: 999px;
  padding: 0.14rem 0.55rem;
}

.ftl__gate--ok {
  border-color: oklch(0.8 0.1 148);
  color: oklch(0.42 0.12 148);
  background: oklch(0.98 0.02 148);
}

.ftl__phase {
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  padding: 0.45rem 0.65rem;
  margin-bottom: 0.45rem;
}

.ftl__phase--current {
  border-color: var(--color-brand-300);
  box-shadow: 0 1px 4px oklch(0.3 0.03 260 / 0.08);
}

.ftl__phase--complete {
  background: var(--color-surface-soft);
}

.ftl__phead {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  padding: 0;
  cursor: pointer;
}

.ftl__pname {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-ink);
}

.ftl__now {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: white;
  background: var(--color-brand-700);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  margin-left: 0.35rem;
}

.ftl__pmeta {
  font-size: 0.74rem;
  color: var(--color-muted);
}

.ftl__counts {
  margin-left: auto;
  display: flex;
  gap: 0.3rem;
}

.ftl__count {
  font-size: 0.7rem;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  background: var(--color-surface);
}

.ftl__count b {
  color: var(--color-brand-800);
}

.ftl__proj {
  font-size: 0.76rem;
  color: var(--color-muted);
  margin: 0.3rem 0 0;
}

.ftl__days {
  margin-top: 0.45rem;
  border-top: 1px solid var(--color-line-soft);
}

.ftl__day {
  display: grid;
  grid-template-columns: 3.4rem 8.5rem 4rem 1fr auto;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.24rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.8rem;
}

.ftl__day:last-child {
  border-bottom: 0;
}

.ftl__day--no {
  opacity: 0.6;
}

.ftl__dayn {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.ftl__dayunit {
  font-weight: 600;
}

.ftl__dayfto {
  color: var(--color-muted);
}

.ftl__dor {
  font-size: 0.7rem;
  font-weight: 600;
}

.ftl__dor--ok {
  color: oklch(0.42 0.12 148);
}

.ftl__dor--miss {
  color: var(--color-danger-500);
}

.ftl__next {
  font-size: 0.78rem;
  color: var(--color-ink);
  margin-top: 0.5rem;
  display: flex;
  gap: 0.45rem;
  flex-wrap: wrap;
  align-items: baseline;
}

.ftl__next-h {
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.ftl__next-day {
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
  background: var(--color-surface-soft);
}

.ftl__warn {
  font-size: 0.75rem;
  color: oklch(0.5 0.12 75);
  margin: 0.5rem 0 0;
}

@media (max-width: 640px) {
  .ftl__day {
    grid-template-columns: 3rem 1fr auto;
  }

  .ftl__dayunit,
  .ftl__dayfto {
    grid-column: 2 / 4;
  }

  .ftl__counts {
    margin-left: 0;
  }
}
</style>
