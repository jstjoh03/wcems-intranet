<script setup lang="ts">
import { computed, ref } from 'vue'
import { Settings2, X } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import MLink from '@/components/primitives/MLink.vue'
import linksData from '@/data/quicklinks.json'
import type { QuickLink } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useUserLinkPreferences } from '@/composables/useUserLinkPreferences'

const auth = useAuthStore()
const links = linksData as QuickLink[]

const customizing = ref(false)

const userId = computed(() => auth.appUser?.id ?? 'anonymous')
const { getPref, togglePin, toggleHide } = useUserLinkPreferences(userId.value)

const visibleLinks = computed(() => {
  const role = auth.role.value ?? 'crew'
  return links
    .filter((l) => l.visibleTo.includes(role))
    .filter((l) => customizing.value || !getPref(l.id).hidden)
})

const pinned = computed(() => visibleLinks.value.filter((l) => getPref(l.id).pinned))
const unpinnedByCategory = computed(() => {
  const grouped = new Map<string, QuickLink[]>()
  for (const l of visibleLinks.value) {
    if (getPref(l.id).pinned) continue
    const arr = grouped.get(l.category) ?? []
    arr.push(l)
    grouped.set(l.category, arr)
  }
  for (const [, arr] of grouped) {
    arr.sort((a, b) => a.defaultSort - b.defaultSort)
  }
  return Array.from(grouped.entries())
})
</script>

<template>
  <section>
    <header class="quick-links__header">
      <Eyebrow>Quick Links</Eyebrow>
      <button
        type="button"
        class="quick-links__customize"
        :class="{ 'quick-links__customize--on': customizing }"
        @click="customizing = !customizing"
      >
        <component :is="customizing ? X : Settings2" :size="13" :stroke-width="1.85" />
        {{ customizing ? 'Done' : 'Customize' }}
      </button>
    </header>

    <!-- Pinned strip -->
    <div v-if="pinned.length > 0" class="quick-links__pinned">
      <Eyebrow class="mb-3">Pinned</Eyebrow>
      <div class="grid grid-cols-2 gap-2.5">
        <MLink
          v-for="link in pinned"
          :key="link.id"
          :link="link"
          :pinned="true"
          :show-pin-control="customizing"
          @toggle-pin="togglePin"
        />
      </div>
    </div>

    <!-- Empty state if all hidden / none visible -->
    <div v-if="visibleLinks.length === 0" class="quick-links__empty">
      No quick links available for your role yet.
    </div>

    <!-- Categorized lists -->
    <div class="quick-links__groups">
      <div v-for="[category, items] in unpinnedByCategory" :key="category">
        <Eyebrow class="mb-3">{{ category }}</Eyebrow>
        <div class="grid grid-cols-2 gap-2.5">
          <MLink
            v-for="link in items"
            :key="link.id"
            :link="link"
            :pinned="false"
            :show-pin-control="customizing"
            @toggle-pin="togglePin"
          />
        </div>
      </div>
    </div>

    <p v-if="customizing" class="quick-links__hint">
      Tap the pin icon on any link to pin it to the top of this list. Pin/hide
      preferences are stored locally during the build phase — they will move to
      your account when the database is back online.
    </p>
  </section>
</template>

<style scoped>
.quick-links__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.quick-links__customize {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.quick-links__customize:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.quick-links__customize--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.quick-links__pinned {
  margin-bottom: 28px;
  padding: 14px;
  border-radius: 12px;
  background: oklch(0.99 0.01 86.8);
  border: 1px dashed oklch(0.85 0.07 86.8);
}

.quick-links__empty {
  padding: 24px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.quick-links__groups {
  display: grid;
  grid-template-columns: 1fr;
  gap: 28px;
}
@media (min-width: 768px) {
  .quick-links__groups {
    grid-template-columns: 1fr 1fr;
    gap: 32px 32px;
  }
}

.quick-links__hint {
  margin-top: 18px;
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
}
</style>
