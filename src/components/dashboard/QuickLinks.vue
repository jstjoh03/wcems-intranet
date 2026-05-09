<script setup lang="ts">
import { computed, ref } from 'vue'
import { Settings2, X, Pin } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import QuickLinkTile from '@/components/primitives/QuickLinkTile.vue'
import linksData from '@/data/quicklinks.json'
import type { QuickLink } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useUserLinkPreferences } from '@/composables/useUserLinkPreferences'

const auth = useAuthStore()
const links = linksData as QuickLink[]

const customizing = ref(false)

const userId = computed(() => auth.appUser?.id ?? 'anonymous')
const { getPref, togglePin } = useUserLinkPreferences(userId.value)

const visibleLinks = computed(() => {
  const role = auth.role.value ?? 'crew'
  return links
    .filter((l) => l.visibleTo.includes(role))
    .filter((l) => customizing.value || !getPref(l.id).hidden)
})

const pinned = computed(() => visibleLinks.value.filter((l) => getPref(l.id).pinned))

const groupedUnpinned = computed(() => {
  const grouped = new Map<string, QuickLink[]>()
  for (const l of visibleLinks.value) {
    if (getPref(l.id).pinned) continue
    const arr = grouped.get(l.category) ?? []
    arr.push(l)
    grouped.set(l.category, arr)
  }
  for (const [, arr] of grouped) arr.sort((a, b) => a.defaultSort - b.defaultSort)
  return Array.from(grouped.entries())
})
</script>

<template>
  <section>
    <header class="ql__header">
      <Eyebrow>Quick Links</Eyebrow>
      <button
        type="button"
        class="ql__customize"
        :class="{ 'ql__customize--on': customizing }"
        @click="customizing = !customizing"
      >
        <component :is="customizing ? X : Settings2" :size="13" :stroke-width="1.85" />
        {{ customizing ? 'Done' : 'Customize' }}
      </button>
    </header>

    <!-- Pinned strip -->
    <div v-if="pinned.length > 0" class="ql__pinned">
      <div class="ql__pinned-label">
        <Pin :size="11" :stroke-width="2" /> Pinned
      </div>
      <div class="ql__grid">
        <QuickLinkTile
          v-for="link in pinned"
          :key="link.id"
          :link="link"
          :pinned="true"
          :show-pin-control="customizing"
          @toggle-pin="togglePin"
        />
      </div>
    </div>

    <div v-if="visibleLinks.length === 0" class="ql__empty">
      No quick links available for your role.
    </div>

    <!-- Categorized lists -->
    <div class="ql__groups">
      <div v-for="[category, items] in groupedUnpinned" :key="category" class="ql__group">
        <Eyebrow class="ql__group-label">{{ category }}</Eyebrow>
        <div class="ql__grid">
          <QuickLinkTile
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

    <p v-if="customizing" class="ql__hint">
      Tap the pin icon on any tile to pin it to the top. Pin/hide preferences are
      stored locally for now and will sync to your account when the database is restored.
    </p>
  </section>
</template>

<style scoped>
.ql__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.ql__customize {
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
.ql__customize:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.ql__customize--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.ql__pinned {
  margin-bottom: 18px;
  padding: 12px;
  border-radius: 12px;
  background: oklch(0.99 0.01 86.8);
  border: 1px dashed oklch(0.85 0.07 86.8);
}
.ql__pinned-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  margin-bottom: 10px;
}

.ql__empty {
  padding: 24px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.ql__groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ql__group-label {
  margin-bottom: 8px;
}

/* Compact tile grid: 2 cols on phone, 3 on tablet, 4 on desktop */
.ql__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
@media (min-width: 480px) {
  .ql__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 768px) {
  .ql__grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.ql__hint {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
}
</style>
