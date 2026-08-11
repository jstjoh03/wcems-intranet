<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Film, Clock } from 'lucide-vue-next'
import { useTrainingRecordings } from '@/composables/useTrainingRecordings'
import Eyebrow from '@/components/primitives/Eyebrow.vue'

/**
 * "Latest from the Training Library" — the three most recent active
 * recordings, replacing the photo gallery + newsletter dashboard slots
 * (unused) with content Justin actually wants engaged with. Whole card
 * routes into the library.
 */
const { visibleRecordings, ready } = useTrainingRecordings()

const latest = computed(() =>
  [...visibleRecordings.value]
    .sort((a, b) => String(b.recordedAt ?? b.createdAt).localeCompare(String(a.recordedAt ?? a.createdAt)))
    .slice(0, 3),
)

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <section v-if="ready && latest.length" class="tl">
    <div class="tl__head">
      <div>
        <Eyebrow>Training Library</Eyebrow>
        <h2 class="tl__title display">Latest recordings</h2>
      </div>
      <RouterLink to="/training/recordings" class="tl__more">Browse the library →</RouterLink>
    </div>

    <div class="tl__grid">
      <RouterLink
        v-for="r in latest"
        :key="r.id"
        to="/training/recordings"
        class="tl__card"
      >
        <div class="tl__card-icon">
          <Film :size="17" :stroke-width="1.8" />
        </div>
        <div class="tl__card-body">
          <div class="tl__card-title">{{ r.title }}</div>
          <div class="tl__card-meta">
            <span v-if="r.category" class="tl__chip">{{ r.category }}</span>
            <span v-if="r.instructor">{{ r.instructor }}</span>
            <span v-if="r.recordedAt">{{ fmtDate(r.recordedAt) }}</span>
            <span v-if="r.durationMinutes" class="tl__dur">
              <Clock :size="11" :stroke-width="2" />{{ r.durationMinutes }} min
            </span>
          </div>
        </div>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.tl {
  margin-top: 48px;
}
.tl__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.tl__title {
  font-size: 26px;
  color: var(--color-ink);
  margin-top: 4px;
}
.tl__more {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
  white-space: nowrap;
  padding-bottom: 3px;
}
.tl__more:hover {
  text-decoration: underline;
}

.tl__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 900px) {
  .tl__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.tl__card {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  transition: box-shadow 160ms var(--ease-out), transform 160ms var(--ease-out), border-color 160ms var(--ease-out);
}
.tl__card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
  border-color: var(--color-accent-500);
}
.tl__card-icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-brand-900);
  color: var(--color-accent-on-dark);
}
.tl__card-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-ink);
}
.tl__card-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--color-muted);
}
.tl__chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-surface-sunk);
  border: 1px solid var(--color-line);
  font-weight: 500;
  color: var(--color-ink-soft);
}
.tl__dur {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
</style>
