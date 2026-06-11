<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { FileText, ChevronRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { usePolicies } from '@/composables/usePolicies'

/**
 * Dashboard banner: visible whenever the signed-in user has one or
 * more policies awaiting acknowledgement (including stale ones — a
 * version bump puts the user back into the outstanding bucket).
 */

const auth = useAuthStore()
const { ready, outstandingCount } = usePolicies()

const visible = computed(
  () =>
    auth.appUser !== null &&
    !auth.usingDevStub &&
    ready.value &&
    outstandingCount.value > 0,
)
</script>

<template>
  <RouterLink v-if="visible" to="/policies" class="pb">
    <div class="pb__icon">
      <FileText :size="20" :stroke-width="1.85" />
    </div>
    <div class="pb__copy">
      <strong class="pb__title">Policies awaiting acknowledgement</strong>
      <span class="pb__sub">
        You have {{ outstandingCount }}
        {{ outstandingCount === 1 ? 'policy' : 'policies' }} to read and sign.
        Tap to open.
      </span>
    </div>
    <ChevronRight :size="18" :stroke-width="1.85" class="pb__chev" />
  </RouterLink>
</template>

<style scoped>
.pb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: oklch(0.97 0.04 250);
  border: 1px solid oklch(0.86 0.07 250);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms var(--ease-out);
}
.pb:hover {
  border-color: oklch(0.65 0.13 250);
}
.pb__icon {
  color: oklch(0.45 0.13 250);
  flex-shrink: 0;
}
.pb__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.pb__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.pb__sub {
  font-size: 12px;
  color: var(--color-ink-soft);
  line-height: 1.4;
}
.pb__chev {
  color: oklch(0.45 0.13 250);
  flex-shrink: 0;
}
</style>
