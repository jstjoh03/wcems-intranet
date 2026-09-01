<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GateItem } from '@/constants/pipelineGates'

/**
 * One credentialing-gate line: status icon · label · evidence value.
 * Editable mode (pipeline editors only) turns the icon into a
 * click-to-cycle control (→ complete → n/a → pending) and gives
 * metric gates a small evidence input ("3.7 / 3.5", "8 / 10").
 */

const props = defineProps<{
  item: GateItem
  editable: boolean
}>()

const emit = defineEmits<{
  (e: 'cycle'): void
  (e: 'set-value', value: string): void
}>()

const draft = ref(props.item.value ?? '')
watch(
  () => props.item.value,
  (v) => {
    draft.value = v ?? ''
  },
)

function commitValue() {
  const v = draft.value.trim()
  if (v !== (props.item.value ?? '')) emit('set-value', v)
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function icon(): string {
  switch (props.item.status) {
    case 'complete':
      return '✓'
    case 'na':
      return '–'
    case 'untracked':
      return '–'
    default:
      return '·'
  }
}
</script>

<template>
  <div class="gate" :class="{ 'gate--untracked': item.status === 'untracked' }">
    <button
      v-if="editable && item.kind !== 'access'"
      type="button"
      class="gate__ic"
      :class="`gate__ic--${item.status}`"
      :title="`Mark (now: ${item.status})`"
      @click="emit('cycle')"
    >
      {{ icon() }}
    </button>
    <span v-else class="gate__ic" :class="`gate__ic--${item.status}`">{{ icon() }}</span>

    <span class="gate__label">
      {{ item.label }}
      <span v-if="item.hint" class="gate__hint">{{ item.hint }}</span>
    </span>

    <input
      v-if="editable && item.kind === 'metric'"
      v-model="draft"
      class="gate__input"
      type="text"
      placeholder="value"
      @blur="commitValue"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    />
    <input
      v-else-if="editable && item.kind === 'date'"
      v-model="draft"
      class="gate__input gate__input--date"
      type="date"
      @change="commitValue"
    />
    <span v-else class="gate__value">
      <template v-if="item.status === 'untracked'">not yet tracked</template>
      <template v-else-if="item.status === 'na'">n/a</template>
      <template v-else-if="item.kind === 'date' && item.value">{{ fmtDate(item.value) }}</template>
      <template v-else>{{ item.value || item.completedAt || (item.status === 'complete' ? 'done' : 'pending') }}</template>
    </span>
  </div>
</template>

<style scoped>
.gate {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13px;
  color: var(--color-ink);
}
.gate:last-child {
  border-bottom: none;
}
.gate--untracked {
  color: var(--color-muted-soft);
}
.gate__ic {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  border: 1.5px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
}
button.gate__ic {
  cursor: pointer;
}
button.gate__ic:hover {
  border-color: var(--color-accent-600);
}
.gate__ic--complete {
  background: var(--color-success-50);
  border-color: var(--color-success-500);
  color: var(--color-success-500);
}
.gate__ic--pending {
  border-style: solid;
}
.gate__ic--untracked {
  border-style: dashed;
}
.gate__ic--na {
  background: var(--color-surface-soft);
}
.gate__label {
  flex: 1;
  min-width: 0;
}
.gate__hint {
  margin-left: 6px;
  font-size: 11px;
  color: var(--color-muted-soft);
}
.gate__value {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
  white-space: nowrap;
}
.gate__input {
  width: 90px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  padding: 3px 8px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.gate__input:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.gate__input--date {
  width: 140px;
  font-family: var(--font-sans);
}
</style>
