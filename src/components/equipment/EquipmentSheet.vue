<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'

/**
 * Bottom sheet on phones, centered dialog from 640px up. Locks page
 * scroll while open; Esc and backdrop taps close it. Enter animation
 * is a self-completing keyframe (no <Transition> — see the bubbling
 * transitionend gotcha in the architecture notes).
 */
const props = defineProps<{
  open: boolean
  title: string
  eyebrow?: string
}>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKey)
    } else {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="eqs" @click.self="emit('close')">
      <div class="eqs__panel" role="dialog" aria-modal="true" :aria-label="title">
        <div class="eqs__grab" aria-hidden="true"></div>
        <header class="eqs__head">
          <div class="eqs__head-text">
            <div v-if="eyebrow" class="eqs__eyebrow">{{ eyebrow }}</div>
            <h2 class="eqs__title">{{ title }}</h2>
          </div>
          <button type="button" class="eqs__close" aria-label="Close" @click="emit('close')">
            <X :size="18" :stroke-width="2" />
          </button>
        </header>
        <div class="eqs__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="eqs__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.eqs {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: oklch(0.18 0.015 260 / 0.48);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: eqs-fade 200ms var(--ease-out);
}
.eqs__panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 92dvh;
  background: var(--color-canvas);
  border-radius: 20px 20px 0 0;
  box-shadow: var(--shadow-lg);
  animation: eqs-up 340ms var(--ease-out);
}
.eqs__grab {
  width: 38px;
  height: 4px;
  margin: 8px auto 0;
  border-radius: 999px;
  background: var(--color-line);
}
.eqs__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px 12px 20px;
  border-bottom: 1px solid var(--color-line);
}
.eqs__head-text {
  min-width: 0;
}
.eqs__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eqs__title {
  margin-top: 3px;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 25px;
  line-height: 1.1;
  color: var(--color-ink);
}
.eqs__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  margin-top: 2px;
  border-radius: 999px;
  border: none;
  background: var(--color-surface-sunk);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqs__close:hover {
  color: var(--color-ink);
}
.eqs__body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px 22px;
}
.eqs__foot {
  padding: 12px 20px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-line);
  background: var(--color-surface);
}
@media (min-width: 640px) {
  .eqs {
    align-items: center;
    padding: 24px;
  }
  .eqs__panel {
    width: min(560px, 100%);
    max-height: 88dvh;
    border-radius: 18px;
    animation-name: eqs-pop;
  }
  .eqs__grab {
    display: none;
  }
  .eqs__head {
    padding-top: 18px;
  }
  .eqs__foot {
    border-radius: 0 0 18px 18px;
    padding-bottom: 14px;
  }
}
@keyframes eqs-fade {
  from {
    opacity: 0;
  }
}
@keyframes eqs-up {
  from {
    transform: translateY(40px);
    opacity: 0.4;
  }
}
@keyframes eqs-pop {
  from {
    transform: translateY(10px) scale(0.985);
    opacity: 0;
  }
}
</style>
