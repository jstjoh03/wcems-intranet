<script setup lang="ts">
/**
 * Credential / phase / shift selects + name-or-station search, with the
 * "Showing N of M" counter — the mockup's filter row. Stateless:
 * v-model'd objects owned by the parent view.
 */

export interface PipelineFilters {
  credential: string
  phase: string
  shift: string
  search: string
}

defineProps<{
  modelValue: PipelineFilters
  credentialOptions: string[]
  phaseOptions: Array<{ value: string; label: string }>
  shown: number
  total: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: PipelineFilters): void
}>()

function patch(partial: Partial<PipelineFilters>, current: PipelineFilters) {
  emit('update:modelValue', { ...current, ...partial })
}
</script>

<template>
  <div class="pfb">
    <select
      class="pfb__select"
      :value="modelValue.credential"
      @change="patch({ credential: ($event.target as HTMLSelectElement).value }, modelValue)"
    >
      <option value="">All credentials</option>
      <option v-for="c in credentialOptions" :key="c" :value="c">{{ c }}</option>
    </select>
    <select
      class="pfb__select"
      :value="modelValue.phase"
      @change="patch({ phase: ($event.target as HTMLSelectElement).value }, modelValue)"
    >
      <option value="">All phases</option>
      <option v-for="p in phaseOptions" :key="p.value" :value="p.value">{{ p.label }}</option>
    </select>
    <select
      class="pfb__select"
      :value="modelValue.shift"
      @change="patch({ shift: ($event.target as HTMLSelectElement).value }, modelValue)"
    >
      <option value="">All shifts</option>
      <option value="A">A</option>
      <option value="B">B</option>
      <option value="C">C</option>
    </select>
    <input
      class="pfb__search"
      type="search"
      placeholder="Search name or station…"
      :value="modelValue.search"
      @input="patch({ search: ($event.target as HTMLInputElement).value }, modelValue)"
    />
    <span class="pfb__count">Showing {{ shown }} of {{ total }}</span>
  </div>
</template>

<style scoped>
.pfb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.pfb__select,
.pfb__search {
  font-size: 13px;
  padding: 8px 11px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.pfb__select:focus,
.pfb__search:focus {
  outline: none;
  border-color: var(--color-accent-600);
}
.pfb__search {
  flex: 1;
  min-width: 180px;
}
.pfb__count {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--color-muted-soft);
  white-space: nowrap;
}
</style>
