<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'
import { Check } from 'lucide-vue-next'
import type { PipelinePerson } from '@/types'
import { activeTransitionFor } from '@/constants/pipelineGates'
import { FTEP_PROGRAM_PHASES, type FtepProgramPhase } from '@/constants/ftepForms'
import { usePipeline } from '@/composables/usePipeline'
import { useFtep } from '@/composables/useFtep'

/**
 * The Program Guide phase ladder for one trainee — which phase they're
 * in, per-phase FTO assignment, and the SCHEDULED shift days. Editors
 * click a phase to assign the FTO and load the planned dates; everyone
 * else reads it. Each scheduled day is matched against submitted DORs
 * (eval date), and a phase auto-completes once all its days have
 * passed AND each day has its DOR (Clinical-run phases need only the
 * calendar). Future dates render as "scheduled" — never complete.
 * Renders only for tracks that HAVE a phase ladder (paramedic P1C→P1
 * and P1→P2) — legacy/ride-up/AEMT tracks are gate-driven instead.
 */

const props = defineProps<{
  person: PipelinePerson
  editable?: boolean
}>()

const { phasesFor, setPhaseProgress, clearPhaseProgress, people } = usePipeline()
const ftep = useFtep()

const record = computed(() => props.person.record)

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Eval dates of the trainee's counting DORs — the per-day match set. */
const dorDates = computed(() => new Set(ftep.activeDors(props.person.userId).map((r) => r.evalDate)))

type DayState = 'done' | 'missed' | 'upcoming'
function dayState(day: string, noFto?: boolean): DayState {
  if (noFto) return day <= todayIso() ? 'done' : 'upcoming'
  if (dorDates.value.has(day)) return 'done'
  return day < todayIso() ? 'missed' : 'upcoming'
}

/** Every scheduled day passed and (for FTO phases) has its DOR. */
function scheduleSatisfied(key: string, noFto?: boolean): boolean {
  const days = rowByKey.value.get(key)?.scheduledDays ?? []
  if (days.length === 0) return false
  return days.every((d) => d < todayIso() && (noFto || dorDates.value.has(d)))
}

/** A day is past due without its DOR — flag, and hold the phase open. */
function missingDorDays(key: string, noFto?: boolean): string[] {
  if (noFto) return []
  return (rowByKey.value.get(key)?.scheduledDays ?? []).filter((d) => dayState(d) === 'missed')
}

const phaseSet = computed<FtepProgramPhase[] | null>(() => {
  const t = activeTransitionFor(record.value)
  /* The written program covers paramedic tracks; EMT/AEMT programs are
     still to be built — no ladder to draw for them yet. */
  const paramedic = /emt-p|^lp$/i.test(record.value.certLevel ?? '')
  if ((t === 'NEOP' || t === 'P1C_P1') && paramedic) return FTEP_PROGRAM_PHASES.P1C_P1
  if (t === 'P1_P2') return FTEP_PROGRAM_PHASES.P1_P2
  return null
})

const rowByKey = computed(() => {
  const map = new Map<string, ReturnType<typeof phasesFor>[number]>()
  for (const r of phasesFor(record.value.id)) map.set(r.phaseKey, r)
  return map
})

type StepState = 'done' | 'current' | 'scheduled' | 'todo'

/** Phase state — future dates NEVER read as complete:
 *  done      completed date has passed, or the schedule is satisfied
 *  current   started (or first scheduled day reached) and not done
 *  scheduled dates loaded but none reached yet
 *  todo      nothing on file */
function stateFor(key: string): StepState {
  const row = rowByKey.value.get(key)
  const def = phaseSet.value?.find((p) => p.key === key)
  if (!row) return 'todo'
  if (row.completedAt && row.completedAt <= todayIso()) return 'done'
  if (scheduleSatisfied(key, def?.noFto)) return 'done'
  const firstDay = row.scheduledDays[0] ?? null
  const started =
    (row.startedAt && row.startedAt <= todayIso()) || (firstDay && firstDay <= todayIso())
  if (started) return 'current'
  if (row.startedAt || row.scheduledDays.length > 0 || row.completedAt) return 'scheduled'
  return 'todo'
}

/** Effective completion date for display — stamped or derived. */
function doneDate(key: string): string | null {
  const row = rowByKey.value.get(key)
  if (!row) return null
  if (row.completedAt && row.completedAt <= todayIso()) return row.completedAt
  return row.scheduledDays[row.scheduledDays.length - 1] ?? row.completedAt
}

function daysIn(key: string): number | null {
  const row = rowByKey.value.get(key)
  if (!row || stateFor(key) !== 'current') return null
  const base = row.startedAt && row.startedAt <= todayIso() ? row.startedAt : row.scheduledDays[0]
  if (!base) return null
  return Math.max(0, Math.floor((Date.now() - new Date(`${base}T00:00:00`).getTime()) / 86_400_000))
}

/** First upcoming scheduled day (for the "scheduled" meta line). */
function startsOn(key: string): string | null {
  const row = rowByKey.value.get(key)
  if (!row) return null
  return row.scheduledDays.find((d) => d >= todayIso()) ?? row.startedAt ?? null
}

/* Auto-stamp: when a phase's schedule is satisfied but completed_at is
   still open, an editor's session writes the completion (dated to the
   last scheduled day) so the record matches what the tracker derived.
   Guarded per record+phase so realtime reloads don't double-write. */
const autoStamped = new Set<string>()
watchEffect(() => {
  if (!props.editable) return
  for (const ph of phaseSet.value ?? []) {
    const row = rowByKey.value.get(ph.key)
    if (!row || row.completedAt) continue
    if (!scheduleSatisfied(ph.key, ph.noFto)) continue
    const guard = `${record.value.id}:${ph.key}`
    if (autoStamped.has(guard)) continue
    autoStamped.add(guard)
    const last = row.scheduledDays[row.scheduledDays.length - 1]
    void setPhaseProgress(record.value.id, ph.key, { completedAt: last }).catch((e) =>
      console.warn('[ftep] phase auto-complete failed:', e),
    )
  }
})

function fmt(iso: string | null): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const ftos = computed(() =>
  people.value
    .filter((p) => p.record.isFto && p.active)
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
)

/* ── Editor popover ────────────────────────────────────────────────── */

const open = ref<string | null>(null)
const draft = reactive({
  ftoUserId: '',
  startedAt: '',
  completedAt: '',
  note: '',
  days: [] as string[],
})
const busy = ref(false)
const error = ref<string | null>(null)

function toggle(key: string) {
  if (!props.editable) return
  if (open.value === key) {
    open.value = null
    return
  }
  const row = rowByKey.value.get(key)
  const def = phaseSet.value?.find((p) => p.key === key)
  draft.ftoUserId = row?.ftoUserId ?? ''
  draft.startedAt = row?.startedAt ?? ''
  draft.completedAt = row?.completedAt ?? ''
  draft.note = row?.note ?? ''
  /* Pre-fill the scheduler with the phase's standard day count so
     loading a phase is "type 4 dates", not "build 4 rows first". */
  draft.days = row?.scheduledDays.length
    ? [...row.scheduledDays]
    : Array.from({ length: def?.tours ?? 1 }, () => '')
  error.value = null
  open.value = key
}

function addDay() {
  draft.days = [...draft.days, '']
}
function removeDay(i: number) {
  draft.days = draft.days.filter((_, idx) => idx !== i)
}

const openDef = computed(() => phaseSet.value?.find((p) => p.key === open.value) ?? null)

async function save() {
  if (!open.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const fto = ftos.value.find((f) => f.userId === draft.ftoUserId)
    await setPhaseProgress(record.value.id, open.value, {
      ftoUserId: draft.ftoUserId || null,
      ftoName: fto?.fullName ?? null,
      startedAt: draft.startedAt || null,
      completedAt: draft.completedAt || null,
      note: draft.note.trim() || null,
      scheduledDays: draft.days.filter(Boolean),
    })
    open.value = null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function clearPhase() {
  if (!open.value || busy.value) return
  busy.value = true
  try {
    await clearPhaseProgress(record.value.id, open.value)
    open.value = null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

const today = () => new Date().toISOString().slice(0, 10)
</script>

<template>
  <div v-if="phaseSet" class="fps">
    <div class="fps__track">
      <component
        :is="editable ? 'button' : 'div'"
        v-for="ph in phaseSet"
        :key="ph.key"
        :type="editable ? 'button' : undefined"
        class="fps__step"
        :class="[`fps__step--${stateFor(ph.key)}`, { 'fps__step--edit': editable, 'fps__step--open': open === ph.key }]"
        :title="editable ? 'Assign FTO / set dates' : undefined"
        @click="toggle(ph.key)"
      >
        <span class="fps__dot">
          <Check v-if="stateFor(ph.key) === 'done'" :size="11" :stroke-width="3" />
          <template v-else>{{ ph.no }}</template>
        </span>
        <span class="fps__lbl">{{ ph.label }}</span>
        <span class="fps__meta">
          <template v-if="!ph.noFto && rowByKey.get(ph.key)?.ftoName">FTO {{ rowByKey.get(ph.key)!.ftoName }}</template>
          <template v-else>{{ ph.hint }}</template>
        </span>
        <span v-if="stateFor(ph.key) === 'current'" class="fps__now">
          day {{ (daysIn(ph.key) ?? 0) + 1 }}
        </span>
        <span v-else-if="stateFor(ph.key) === 'done'" class="fps__done-date">
          {{ fmt(doneDate(ph.key)) }}
        </span>
        <span v-else-if="stateFor(ph.key) === 'scheduled'" class="fps__sched">
          starts {{ fmt(startsOn(ph.key)) }}
        </span>
        <span
          v-if="missingDorDays(ph.key, ph.noFto).length"
          class="fps__missing"
          :title="`No DOR on file for: ${missingDorDays(ph.key, ph.noFto).map(fmt).join(', ')}`"
        >
          {{ missingDorDays(ph.key, ph.noFto).length }} day{{ missingDorDays(ph.key, ph.noFto).length === 1 ? '' : 's' }} missing DOR
        </span>
        <span
          v-if="rowByKey.get(ph.key)?.note"
          class="fps__note"
          :title="rowByKey.get(ph.key)!.note ?? ''"
        >{{ rowByKey.get(ph.key)!.note }}</span>
      </component>
    </div>

    <div v-if="open && openDef && editable" class="fps__editor">
      <span class="fps__editor-title">
        Phase {{ openDef.no }} — {{ openDef.label }}
        <template v-if="openDef.noFto"> · run by the Clinical Department, no FTO assigned</template>
      </span>
      <label v-if="!openDef.noFto" class="fps__field">
        <span>FTO for this phase</span>
        <select v-model="draft.ftoUserId">
          <option value="">— unassigned —</option>
          <option v-for="f in ftos" :key="f.userId" :value="f.userId">{{ f.fullName }}</option>
        </select>
      </label>
      <label class="fps__field">
        <span>Started</span>
        <span class="fps__datewrap">
          <input v-model="draft.startedAt" type="date" />
          <button v-if="!draft.startedAt" type="button" class="fps__quick" @click="draft.startedAt = today()">today</button>
        </span>
      </label>
      <label class="fps__field">
        <span>Completed</span>
        <span class="fps__datewrap">
          <input v-model="draft.completedAt" type="date" />
          <button v-if="!draft.completedAt" type="button" class="fps__quick" @click="draft.completedAt = today()">today</button>
        </span>
      </label>
      <div class="fps__field fps__field--days">
        <span>
          Scheduled shift days
          <em class="fps__field-hint">
            future dates show as scheduled — the phase completes on its own once each day has its DOR{{ openDef.noFto ? ' (Clinical-run: dates alone)' : '' }}
          </em>
        </span>
        <span class="fps__days">
          <span v-for="(_d, i) in draft.days" :key="i" class="fps__day">
            <input v-model="draft.days[i]" type="date" />
            <button type="button" class="fps__day-x" :aria-label="`Remove day ${i + 1}`" @click="removeDay(i)">×</button>
          </span>
          <button type="button" class="fps__quick" @click="addDay">+ add day</button>
        </span>
      </div>
      <label class="fps__field fps__field--note">
        <span>Note <em class="fps__field-hint">document exceptions — e.g. "Day 2 with Sarah Reyes"</em></span>
        <input v-model="draft.note" type="text" maxlength="200" placeholder="One FTO per phase is the standard — note any split here" />
      </label>
      <span class="fps__editor-actions">
        <button type="button" class="fps__btn fps__btn--primary" :disabled="busy" @click="save">
          {{ busy ? 'Saving…' : 'Save' }}
        </button>
        <button
          v-if="rowByKey.get(open)"
          type="button"
          class="fps__btn fps__btn--danger"
          :disabled="busy"
          @click="clearPhase"
        >Clear</button>
        <button type="button" class="fps__btn" @click="open = null">Cancel</button>
      </span>
      <span v-if="error" class="fps__err">{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.fps {
  width: 100%;
}
.fps__track {
  display: flex;
  align-items: flex-start;
}
.fps__step {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px 6px;
  background: none;
  border: none;
  font-family: var(--font-sans);
  text-align: center;
}
.fps__step--edit {
  cursor: pointer;
  border-radius: 8px;
}
.fps__step--edit:hover {
  background: var(--color-surface-soft);
}
.fps__step--open {
  background: var(--color-surface-soft);
}
/* connector line between dots */
.fps__step:not(:first-child)::before {
  content: '';
  position: absolute;
  top: 18px;
  left: calc(-50% + 12px);
  width: calc(100% - 24px);
  height: 2px;
  background: var(--color-line);
}
.fps__step--done:not(:first-child)::before,
.fps__step--current:not(:first-child)::before {
  background: var(--color-success-500);
}
.fps__dot {
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  color: var(--color-muted);
}
.fps__step--done .fps__dot {
  background: var(--color-success-500);
  border-color: var(--color-success-500);
  color: #fff;
}
.fps__step--current .fps__dot {
  border-color: var(--color-accent-600);
  color: var(--color-accent-700);
  box-shadow: 0 0 0 3px oklch(0.9 0.06 90 / 0.55);
}
.fps__lbl {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--color-ink-soft);
  line-height: 1.25;
}
.fps__step--current .fps__lbl {
  color: var(--color-brand-800);
}
.fps__step--todo .fps__lbl {
  color: var(--color-muted);
  font-weight: 600;
}
.fps__meta {
  font-size: 9.5px;
  color: var(--color-muted-soft);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.fps__now {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.fps__done-date {
  font-size: 9.5px;
  color: var(--color-success-500);
  font-weight: 600;
}
.fps__sched {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-brand-600);
}
.fps__step--scheduled .fps__dot {
  border-style: dashed;
  border-color: var(--color-brand-400, oklch(0.6 0.06 260));
  color: var(--color-brand-600);
}
.fps__missing {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: oklch(0.5 0.14 45);
  background: oklch(0.96 0.05 75);
  border-radius: 999px;
  padding: 1px 7px;
}
.fps__field--days {
  flex-basis: 100%;
}
.fps__days {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.fps__day {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.fps__day input {
  font-size: 12px;
  padding: 5px 7px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fps__day-x {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: var(--color-muted);
  padding: 2px 4px;
}
.fps__day-x:hover {
  color: var(--color-danger-500);
}
/* Phase exception note — e.g. a split-FTO tour */
.fps__note {
  font-size: 9px;
  font-style: italic;
  color: var(--color-accent-700);
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fps__field--note {
  flex: 1;
  min-width: 240px;
}
.fps__field--note input {
  width: 100%;
}
.fps__field-hint {
  font-style: normal;
  font-weight: 400;
  font-size: 9.5px;
  color: var(--color-muted-soft);
  margin-left: 4px;
}
.fps__editor {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  background: var(--color-surface-soft);
}
.fps__editor-title {
  flex-basis: 100%;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.fps__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-muted);
}
.fps__field select,
.fps__field input {
  font-size: 12.5px;
  font-weight: 400;
  padding: 6px 8px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.fps__datewrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fps__quick {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.fps__quick:hover {
  text-decoration: underline;
}
.fps__editor-actions {
  display: inline-flex;
  gap: 8px;
  margin-left: auto;
}
.fps__btn {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
}
.fps__btn--primary {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: #fff;
}
.fps__btn--danger {
  color: var(--color-danger-500);
}
.fps__err {
  flex-basis: 100%;
  font-size: 11.5px;
  color: var(--color-danger-500);
}
@media (max-width: 640px) {
  .fps__track {
    flex-wrap: wrap;
  }
  .fps__step {
    flex-basis: 33%;
  }
  .fps__step:not(:first-child)::before {
    display: none;
  }
}
</style>
