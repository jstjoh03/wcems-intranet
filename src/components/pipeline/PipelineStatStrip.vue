<script setup lang="ts">
/**
 * Six click-to-filter stat tiles per the approved Clinical mockup.
 * The active tile gets a gold outline; clicking it again clears the
 * filter. Values are computed by the parent — this component is pure.
 */

export interface StatTile {
  key: string
  n: number
  label: string
  variant?: 'feature' | 'warn' | 'alert'
}

defineProps<{
  tiles: StatTile[]
  active: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle', key: string): void
}>()
</script>

<template>
  <div class="pss">
    <button
      v-for="t in tiles"
      :key="t.key"
      type="button"
      class="pss__stat"
      :class="[t.variant ? `pss__stat--${t.variant}` : '', { 'pss__stat--active': active === t.key }]"
      @click="emit('toggle', t.key)"
    >
      <span class="pss__n">{{ t.n }}</span>
      <span class="pss__l">{{ t.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.pss {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (min-width: 700px) {
  .pss {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 1100px) {
  .pss {
    grid-template-columns: repeat(6, 1fr);
    gap: 14px;
  }
}
.pss__stat {
  text-align: left;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  padding: 16px 18px;
  cursor: pointer;
  transition: transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out);
}
.pss__stat:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.pss__stat--active {
  outline: 2px solid var(--color-accent-500);
  outline-offset: 1px;
}
.pss__n {
  display: block;
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  color: var(--color-brand-800);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.pss__l {
  display: block;
  margin-top: 7px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.pss__stat--feature {
  border: none;
  background:
    radial-gradient(ellipse 70% 60% at 30% 20%, oklch(0.734 0.114 86.8 / 0.14), transparent 60%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  box-shadow: var(--shadow-md);
}
.pss__stat--feature .pss__n {
  color: var(--color-accent-on-dark);
}
.pss__stat--feature .pss__l {
  color: oklch(0.78 0.03 250);
}
.pss__stat--warn .pss__n {
  color: oklch(0.55 0.13 75);
}
.pss__stat--alert .pss__n {
  color: var(--color-danger-500);
}
</style>
