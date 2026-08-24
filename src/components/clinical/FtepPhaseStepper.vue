<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import type { PipelinePerson } from '@/types'
import { activeTransitionFor } from '@/constants/pipelineGates'
import { FTEP_PROGRAM_PHASES, type FtepProgramPhase } from '@/constants/ftepForms'
import { usePipeline } from '@/composables/usePipeline'

/**
 * The Program Guide phase ladder for one trainee — which phase they're
 * in, per-phase FTO assignment, start/complete dates. Editors click a
 * phase to assign the FTO and move it along; everyone else reads it.
 * Renders only for tracks that HAVE a phase ladder (paramedic P1C→P1
 * and P1→P2) — legacy/ride-up/AEMT tracks are gate-driven instead.
 */

const props = defineProps<{
  person: PipelinePerson
  editable?: boolean
}>()

const { phasesFor, setPhaseProgress, clearPhaseProgress, people } = usePipeline()

const record = computed(() => props.person.record)

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

type StepState = 'done' | 'current' | 'todo'
function stateFor(key: string): StepState {
  const row = rowByKey.value.get(key)
  if (row?.completedAt) return 'done'
  if (row?.startedAt) return 'current'
  return 'todo'
}

function daysIn(key: string): number | null {
  const row = rowByKey.value.get(key)
  if (!row?.startedAt || row.completedAt) return null
  return Math.max(0, Math.floor((Date.now() - new Date(`${row.startedAt}T00:00:00`).getTime()) / 86_400_000))
}

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
const draft = reactive({ ftoUserId: '', startedAt: '', completedAt: '' })
const busy = ref(false)
const error = ref<string | null>(null)

function toggle(key: string) {
  if (!props.editable) return
  if (open.value === key) {
    open.value = null
    return
  }
  const row = rowByKey.value.get(key)
  draft.ftoUserId = row?.ftoUserId ?? ''
  draft.startedAt = row?.startedAt ?? ''
  draft.completedAt = row?.completedAt ?? ''
  error.value = null
  open.value = key
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
          <template v-if="rowByKey.get(ph.key)?.ftoName">FTO {{ rowByKey.get(ph.key)!.ftoName }}</template>
          <template v-else>{{ ph.hint }}</template>
        </span>
        <span v-if="stateFor(ph.key) === 'current'" class="fps__now">
          day {{ (daysIn(ph.key) ?? 0) + 1 }}
        </span>
        <span v-else-if="stateFor(ph.key) === 'done'" class="fps__done-date">
          {{ fmt(rowByKey.get(ph.key)!.completedAt) }}
        </span>
      </component>
    </div>

    <div v-if="open && openDef && editable" class="fps__editor">
      <span class="fps__editor-title">Phase {{ openDef.no }} — {{ openDef.label }}</span>
      <label class="fps__field">
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
