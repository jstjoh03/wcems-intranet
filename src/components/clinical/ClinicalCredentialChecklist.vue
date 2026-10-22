<script setup lang="ts">
import { ref, computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { useClinical } from '@/composables/useClinical'
import { usePipeline } from '@/composables/usePipeline'
import { useFtoEvalRequests } from '@/composables/useFtoEvalRequests'
import { activeTransitionFor, TRANSITIONS } from '@/constants/pipelineGates'
import { CREDENTIALING_CHECKLISTS, type ChecklistItemDef } from '@/constants/credentialingChecklist'
import type { PipelinePerson } from '@/types'

/**
 * The in-office credentialing checklist for one candidate — surfaces
 * with their protocol-test assignment on the Exams page. Auto rows
 * verify themselves (gates, access flags, the FTO-eval request);
 * manual rows the CDO ticks while the employee is in the building,
 * stored as chk_* gate rows for the who/when audit trail.
 */

const props = defineProps<{ person: PipelinePerson }>()
const emit = defineEmits<{ megacode: [] }>()

const { gatesFor } = useClinical()
const pipeline = usePipeline()
const evalReqs = useFtoEvalRequests()

const transition = computed(() => activeTransitionFor(props.person.record))
const items = computed(() => (transition.value ? (CREDENTIALING_CHECKLISTS[transition.value] ?? []) : []))

interface RowState {
  def: ChecklistItemDef
  done: boolean
  detail: string
  toggleable: boolean
}

const rows = computed<RowState[]>(() => {
  const t = transition.value
  if (!t) return []
  const gateRows = gatesFor(props.person.record.id).filter((g) => g.transition === t)
  const byKey = new Map(gateRows.map((g) => [g.gateKey, g]))
  return items.value.map((def) => {
    if (def.kind === 'manual') {
      const row = byKey.get(def.key)
      const done = row?.status === 'complete'
      return {
        def,
        done,
        detail: done
          ? [fmt(row?.completedAt ?? null), row?.completedByName].filter(Boolean).join(' · ')
          : '',
        toggleable: true,
      }
    }
    switch (def.auto) {
      case 'workbook':
      case 'p2_workbook':
      case 'protocol_exam':
      case 'mega_code': {
        const row = byKey.get(def.key)
        const done = row?.status === 'complete' || row?.status === 'na'
        return {
          def,
          done,
          detail: done ? [row?.value, fmt(row?.completedAt ?? null)].filter(Boolean).join(' · ') + ' · auto' : '',
          toggleable: false,
        }
      }
      case 'rec_letters': {
        const row = byKey.get('rec_letters')
        const n = row?.value?.match(/\d+/)
        const done = row?.status === 'complete' || (!!n && parseInt(n[0]!, 10) >= 2)
        return { def, done, detail: row?.value ? `${row.value} on file` : '', toggleable: false }
      }
      case 'op_iq': {
        const done = props.person.record.opIqAccess || !!props.person.record.opIqGrantedAt
        return {
          def,
          done,
          detail: done ? (props.person.record.opIqGrantedAt ?? 'held') : '',
          toggleable: false,
        }
      }
      case 'fto_eval': {
        const reqs = evalReqs.anyFor(props.person.userId)
        const doneReq = reqs.find((r) => r.status === 'done')
        const pendingReq = reqs.find((r) => r.status === 'pending')
        return {
          def,
          done: !!doneReq,
          detail: doneReq
            ? 'submitted · auto'
            : pendingReq
              ? 'sent — awaiting the trainee'
              : 'sends on pass',
          toggleable: false,
        }
      }
      default:
        return { def, done: false, detail: '', toggleable: false }
    }
  })
})

const doneCount = computed(() => rows.value.filter((r) => r.done).length)

function fmt(iso: string | null): string {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

const busy = ref<string | null>(null)
async function toggle(r: RowState) {
  const t = transition.value
  if (!r.toggleable || !t || busy.value) return
  busy.value = r.def.key
  try {
    if (r.done) await pipeline.clearGate(props.person.record.id, t, r.def.key)
    else await pipeline.setGate(props.person.record.id, t, r.def.key, 'complete')
    await pipeline.refresh()
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div v-if="transition && items.length" class="cc">
    <div class="cc__hd">
      <b>{{ person.fullName }}</b>
      <span class="cc__trans">{{ TRANSITIONS[transition].label }}</span>
      <span class="cc__count">{{ doneCount }} of {{ rows.length }}</span>
    </div>
    <div class="cc__sub">
      The in-office paperwork — check it off while they're in the building. The item list is per
      transition.
    </div>
    <div v-for="r in rows" :key="r.def.key" class="cc__row">
      <button
        type="button"
        class="cc__tick"
        :class="{ 'cc__tick--done': r.done, 'cc__tick--ro': !r.toggleable }"
        :disabled="!r.toggleable || busy === r.def.key"
        :title="r.toggleable ? (r.done ? 'Un-check' : 'Check off') : 'Verifies itself'"
        @click="toggle(r)"
      >
        <Check v-if="r.done" :size="12" :stroke-width="3" />
      </button>
      <span class="cc__label" :class="{ 'cc__label--done': r.done }">{{ r.def.label }}</span>
      <span class="cc__detail">
        <button
          v-if="r.def.action === 'megacode' && !r.done"
          type="button"
          class="cc__lnk"
          @click="emit('megacode')"
        >Open the runner</button>
        <template v-else>{{ r.detail }}</template>
        <span v-if="r.def.hint" class="cc__hint"> {{ r.def.hint }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.cc {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-brand-700);
  border-radius: 14px;
  padding: 12px 16px;
  margin-bottom: 10px;
}
.cc__hd { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--color-ink); }
.cc__trans {
  font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
  border-radius: 5px; padding: 2px 7px;
  background: oklch(0.93 0.02 260); color: oklch(0.35 0.07 260);
}
.cc__count { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.cc__sub { font-size: 11px; color: var(--color-muted); margin: 3px 0 7px; }
.cc__row {
  display: flex; align-items: baseline; gap: 10px;
  padding: 6px 0; border-top: 1px solid var(--color-line-soft);
  font-size: 12.5px;
}
.cc__tick {
  flex-shrink: 0; width: 17px; height: 17px; border-radius: 5px;
  border: 1.5px solid var(--color-line); background: var(--color-surface);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; color: #fff; align-self: center;
}
.cc__tick--done { background: var(--color-success-500); border-color: var(--color-success-500); }
.cc__tick--ro { cursor: default; opacity: 0.9; }
.cc__tick:disabled:not(.cc__tick--done) { opacity: 0.6; }
.cc__label { color: var(--color-ink-soft); min-width: 0; }
.cc__label--done { color: var(--color-ink); }
.cc__detail { margin-left: auto; font-size: 11px; color: var(--color-muted); font-variant-numeric: tabular-nums; text-align: right; flex-shrink: 0; }
.cc__hint { color: var(--color-muted-soft); }
.cc__lnk {
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); color: var(--color-brand-600); font-size: 11.5px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.cc__lnk:hover { color: var(--color-ink); }
</style>
