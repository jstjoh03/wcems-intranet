<script setup lang="ts">
import { Check, Minus } from 'lucide-vue-next'
import type { CheckoutStep } from '@/lib/equipment'

/**
 * The six custody steps of a check-out, stated honestly: done (every
 * item), partial (some items), skipped (optional step nobody recorded
 * before a later one), pending. `compact` renders the thin bar version
 * for board cards.
 */
defineProps<{
  steps: CheckoutStep[]
  compact?: boolean
}>()

function shortTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  })
}
</script>

<template>
  <div v-if="compact" class="eqsl-bars" role="img" :aria-label="steps.map((s) => `${s.label}: ${s.state}`).join(', ')">
    <span v-for="s in steps" :key="s.kind" class="eqsl-bar" :class="`eqsl-bar--${s.state}`"></span>
  </div>

  <ol v-else class="eqsl">
    <li v-for="(s, i) in steps" :key="s.kind" class="eqsl__step" :class="`eqsl__step--${s.state}`">
      <div class="eqsl__track">
        <span v-if="i > 0" class="eqsl__line eqsl__line--in"></span>
        <span class="eqsl__node">
          <Check v-if="s.state === 'done'" :size="12" :stroke-width="3" />
          <Minus v-else-if="s.state === 'skipped'" :size="12" :stroke-width="3" />
          <span v-else-if="s.state === 'partial'" class="eqsl__half"></span>
        </span>
        <span v-if="i < steps.length - 1" class="eqsl__line eqsl__line--out"></span>
      </div>
      <div class="eqsl__label">{{ s.label }}</div>
      <div class="eqsl__time">
        <template v-if="s.state === 'done' || s.state === 'partial'">{{ shortTime(s.at) }}</template>
        <template v-else-if="s.state === 'skipped'">Skipped</template>
      </div>
    </li>
  </ol>
</template>

<style scoped>
/* ── compact bars ── */
.eqsl-bars {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.eqsl-bar {
  height: 5px;
  border-radius: 999px;
  background: var(--color-line-soft);
  box-shadow: inset 0 0 0 1px var(--color-line);
}
.eqsl-bar--done {
  background: var(--color-brand-600);
  box-shadow: none;
}
.eqsl-bar--partial {
  background: linear-gradient(90deg, var(--color-brand-600) 50%, var(--color-line-soft) 50%);
}
.eqsl-bar--skipped {
  background: repeating-linear-gradient(
    -45deg,
    var(--color-line) 0 3px,
    transparent 3px 6px
  );
  box-shadow: none;
}

/* ── full ladder ── */
.eqsl {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}
.eqsl__step {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  text-align: center;
}
.eqsl__track {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 26px;
}
.eqsl__line {
  position: absolute;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: var(--color-line);
}
.eqsl__line--in {
  left: 0;
  right: 50%;
}
.eqsl__line--out {
  left: 50%;
  right: 0;
}
.eqsl__step--done .eqsl__line--in,
.eqsl__step--partial .eqsl__line--in,
.eqsl__step--skipped .eqsl__line--in {
  background: var(--color-brand-600);
}
.eqsl__step--done .eqsl__line--out {
  background: var(--color-brand-600);
}
.eqsl__node {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  color: white;
}
.eqsl__step--done .eqsl__node {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
  box-shadow: 0 0 0 3px var(--color-brand-50);
}
.eqsl__step--partial .eqsl__node {
  border-color: var(--color-brand-600);
}
.eqsl__half {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--color-brand-600) 50%, transparent 50%);
}
.eqsl__step--skipped .eqsl__node {
  background: var(--color-surface-soft);
  border-style: dashed;
  border-color: var(--color-muted-soft);
  color: var(--color-muted);
}
.eqsl__label {
  margin-top: 7px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-ink-soft);
}
.eqsl__step--pending .eqsl__label,
.eqsl__step--skipped .eqsl__label {
  color: var(--color-muted);
  font-weight: 600;
}
.eqsl__time {
  margin-top: 2px;
  min-height: 14px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}
@media (max-width: 419px) {
  .eqsl__label {
    font-size: 10px;
    letter-spacing: -0.01em;
  }
  .eqsl__time {
    font-size: 10px;
  }
}
@media (min-width: 640px) {
  .eqsl__label {
    font-size: 12px;
  }
  .eqsl__time {
    font-size: 11px;
  }
}
</style>
