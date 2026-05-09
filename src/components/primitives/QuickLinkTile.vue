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
    class="qlink"
    :class="{ 'qlink--pinned': pinned }"
  >
    <div class="qlink__icon">
      <IconRender :name="link.iconName" :size="18" />
    </div>
    <div class="qlink__name display">{{ link.label }}</div>
    <div v-if="link.sub" class="qlink__sub">{{ link.sub }}</div>

    <button
      v-if="showPinControl"
      class="qlink__pin"
      :class="{ 'qlink__pin--on': pinned }"
      :aria-label="pinned ? 'Unpin link' : 'Pin link'"
      :aria-pressed="pinned ?? false"
      @click.stop.prevent="$emit('togglePin', link.id)"
    >
      <Pin :size="12" :stroke-width="2" />
    </button>
    <ExternalLink v-else :size="11" class="qlink__arrow" />
  </a>
</template>

<style scoped>
.qlink {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 12px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 150ms var(--ease-out),
    box-shadow 150ms var(--ease-out),
    transform 150ms var(--ease-out);
  min-height: 78px;
  overflow: hidden;
}
.qlink:hover {
  border-color: var(--color-muted-soft);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}
.qlink--pinned {
  border-color: oklch(0.85 0.07 86.8);
  background: oklch(0.99 0.01 86.8);
}

.qlink__icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--color-brand-50);
  border: 1px solid var(--color-brand-100);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-600);
  flex-shrink: 0;
  margin-bottom: 4px;
}

.qlink__name {
  font-size: 13.5px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  line-height: 1.15;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qlink__sub {
  font-size: 10.5px;
  color: var(--color-muted);
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.qlink__arrow {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--color-muted-soft);
  opacity: 0;
  transition: opacity 150ms var(--ease-out);
}
.qlink:hover .qlink__arrow {
  opacity: 1;
}

.qlink__pin {
  position: absolute;
  top: 6px;
  right: 6px;
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
.qlink__pin:hover {
  background: var(--color-surface-soft);
  color: var(--color-accent-700);
}
.qlink__pin--on {
  color: var(--color-accent-600);
}
</style>
