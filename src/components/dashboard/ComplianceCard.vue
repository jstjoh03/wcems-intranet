<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { CheckCircle2 } from 'lucide-vue-next'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { usePolicies } from '@/composables/usePolicies'
import Eyebrow from '@/components/primitives/Eyebrow.vue'

/**
 * "Your compliance" rail tile (approved portal mockup v2) — the
 * always-visible personal status readout: outstanding required-training
 * modules + unacknowledged policies, with direct resolve links. Reads
 * the same outstandingCount the top banners use; when everything is
 * done it flips to a quiet all-clear instead of disappearing.
 */
const { ready: rtReady, outstandingCount: rtOutstanding } = useRequiredTraining()
const { ready: polReady, outstandingCount: polOutstanding } = usePolicies()

const ready = computed(() => rtReady.value && polReady.value)
const total = computed(() => rtOutstanding.value + polOutstanding.value)
</script>

<template>
  <section v-if="ready" class="comp" :class="{ 'comp--clear': total === 0 }">
    <Eyebrow>Your compliance</Eyebrow>

    <template v-if="total === 0">
      <div class="comp__clear">
        <CheckCircle2 :size="26" :stroke-width="1.8" class="comp__clear-icon" />
        <div>
          <div class="comp__clear-title">All caught up</div>
          <p class="comp__note">No required training or policy sign-offs outstanding.</p>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="comp__big display">{{ total }}<span class="comp__big-unit"> open</span></div>
      <ul class="comp__items">
        <li v-if="rtOutstanding > 0">
          <RouterLink to="/training/required" class="comp__item">
            {{ rtOutstanding }} required training {{ rtOutstanding === 1 ? 'module' : 'modules' }}
            <span class="comp__arrow">→</span>
          </RouterLink>
        </li>
        <li v-if="polOutstanding > 0">
          <RouterLink to="/policies" class="comp__item">
            {{ polOutstanding }} {{ polOutstanding === 1 ? 'policy' : 'policies' }} to read and sign
            <span class="comp__arrow">→</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.comp {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-accent-500);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  padding: 20px 22px;
}
.comp--clear {
  border-left-color: var(--color-success-500);
}

.comp__big {
  margin-top: 10px;
  font-size: 40px;
  line-height: 1;
  color: var(--color-ink);
}
.comp__big-unit {
  font-size: 17px;
  color: var(--color-muted);
}
.comp__items {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.comp__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  margin: 0 -10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
  transition: background 120ms var(--ease-out);
}
.comp__item:hover {
  background: var(--color-surface-soft);
}
.comp__arrow {
  color: var(--color-accent-600);
}

.comp__clear {
  margin-top: 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.comp__clear-icon {
  color: var(--color-success-500);
  flex-shrink: 0;
  margin-top: 1px;
}
.comp__clear-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.comp__note {
  margin-top: 3px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-muted);
}
</style>
