<script setup lang="ts">
import { Lock, Eye, EyeOff } from 'lucide-vue-next'
import { useCodeReveal } from '@/composables/useCodeReveal'
import { computed } from 'vue'

const props = defineProps<{
  /** The actual code to reveal — null/undefined renders the no-code state */
  code: string | null | undefined
  /** Override the default "Tap for code" placeholder */
  placeholder?: string
  /** Treat code as a special "App Access" badge instead of a reveal target */
  badge?: 'App Access' | null
  /** Compact size — used inside small chips and table cells */
  compact?: boolean
}>()

const { revealed, progressPct, toggle, hide } = useCodeReveal()

const isAppAccess = computed(
  () => props.badge === 'App Access' || props.code === 'App Access',
)
</script>

<template>
  <span v-if="isAppAccess" class="reveal-code reveal-code--badge" aria-label="App access only">
    <Lock :size="10" :stroke-width="2" />
    App Access
  </span>

  <span v-else-if="!code" class="reveal-code reveal-code--empty">—</span>

  <button
    v-else-if="!revealed"
    type="button"
    class="reveal-code reveal-code--placeholder"
    :class="{ 'reveal-code--compact': compact }"
    @click="toggle"
  >
    <Eye :size="11" :stroke-width="1.85" />
    {{ placeholder ?? 'Tap to reveal' }}
  </button>

  <button
    v-else
    type="button"
    class="reveal-code reveal-code--revealed"
    :class="{ 'reveal-code--compact': compact }"
    aria-label="Hide code"
    title="Tap to hide"
    @click="hide"
  >
    <EyeOff :size="11" :stroke-width="1.85" />
    <span class="reveal-code__value">{{ code }}</span>
    <span class="reveal-code__progress" :style="{ width: progressPct }" />
  </button>
</template>

<style scoped>
.reveal-code {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 3px 9px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  line-height: 1.4;
  cursor: pointer;
  overflow: hidden;
  transition: background 150ms var(--ease-out), border-color 150ms var(--ease-out);
}

.reveal-code--badge {
  background: oklch(0.96 0.025 250);
  color: var(--color-brand-700);
  border-color: oklch(0.88 0.05 250);
  font-weight: 600;
  font-family: var(--font-sans);
  letter-spacing: 0.04em;
  font-size: 10.5px;
  text-transform: uppercase;
  cursor: default;
}

.reveal-code--empty {
  color: var(--color-muted);
  cursor: default;
  background: transparent;
  border: none;
  padding: 0;
}

.reveal-code--placeholder {
  border-color: var(--color-line);
  color: var(--color-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
}
.reveal-code--placeholder:hover {
  border-color: var(--color-accent-500);
  color: var(--color-accent-700);
}

.reveal-code--revealed {
  background: oklch(0.97 0.04 86.8);
  border-color: oklch(0.92 0.07 86.8);
  color: var(--color-brand-700);
  font-weight: 600;
}

.reveal-code--compact {
  padding: 2px 7px;
  font-size: 11px;
}

.reveal-code__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 1.5px;
  background: var(--color-accent-500);
  transition: width 0.05s linear;
  pointer-events: none;
}
</style>
