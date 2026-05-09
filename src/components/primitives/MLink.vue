<script setup lang="ts">
import { ExternalLink, Pin } from 'lucide-vue-next'
import IconRender from './IconRender.vue'
import type { QuickLink } from '@/types'

defineProps<{
  link: QuickLink
  pinned?: boolean
  showPinControl?: boolean
}>()

defineEmits<{
  togglePin: [linkId: string]
}>()
</script>

<template>
  <a
    :href="link.url"
    target="_blank"
    rel="noopener noreferrer"
    class="mlink group"
    :class="{ 'mlink--pinned': pinned }"
  >
    <div class="mlink__icon">
      <IconRender :name="link.iconName" :size="15" />
    </div>
    <div class="mlink__text">
      <div class="mlink__name display">{{ link.label }}</div>
      <div v-if="link.sub" class="mlink__sub">{{ link.sub }}</div>
    </div>

    <button
      v-if="showPinControl"
      class="mlink__pin"
      :class="{ 'mlink__pin--on': pinned }"
      :aria-label="pinned ? 'Unpin link' : 'Pin link'"
      :aria-pressed="pinned ?? false"
      @click.stop.prevent="$emit('togglePin', link.id)"
    >
      <Pin :size="13" :stroke-width="1.85" />
    </button>
    <ExternalLink v-else :size="13" class="mlink__arrow" />
  </a>
</template>

<style scoped>
.mlink {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  cursor: pointer;
  text-decoration: none;
  transition:
    border-color 150ms var(--ease-out),
    box-shadow 150ms var(--ease-out),
    transform 150ms var(--ease-out);
}
.mlink:hover {
  border-color: var(--color-muted-soft);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}
.mlink--pinned {
  border-color: oklch(0.85 0.07 86.8);
  background: oklch(0.99 0.01 86.8);
}

.mlink__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-brand-50);
  border: 1px solid var(--color-brand-100);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-600);
  flex-shrink: 0;
}
.mlink__text {
  min-width: 0;
}
.mlink__name {
  font-size: 16px;
  color: var(--color-ink);
  letter-spacing: -0.01em;
  line-height: 1.15;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.mlink__sub {
  font-size: 11px;
  color: var(--color-muted);
  font-weight: 500;
  margin-top: 1px;
  letter-spacing: 0.005em;
}

.mlink__arrow {
  color: var(--color-muted-soft);
  opacity: 0;
  transition:
    opacity 150ms var(--ease-out),
    transform 150ms var(--ease-out);
}
.mlink:hover .mlink__arrow {
  opacity: 1;
  transform: translateX(2px);
}

.mlink__pin {
  background: transparent;
  border: none;
  border-radius: 6px;
  padding: 4px;
  color: var(--color-muted-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 150ms var(--ease-out), background 150ms var(--ease-out);
}
.mlink__pin:hover {
  background: var(--color-surface-soft);
  color: var(--color-accent-700);
}
.mlink__pin--on {
  color: var(--color-accent-600);
}
.mlink__pin--on:hover {
  color: var(--color-accent-700);
}

@media (max-width: 640px) {
  .mlink {
    padding: 9px 10px;
    gap: 10px;
  }
  .mlink__icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }
  .mlink__name {
    font-size: 15px;
  }
  .mlink__sub {
    font-size: 10.5px;
  }
  .mlink__arrow {
    display: none;
  }
}
</style>
