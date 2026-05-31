<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { ShieldCheck, Check, Clock, AlertTriangle, ChevronRight } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { ready, activeForUser, isComplete, completionFor } = useRequiredTraining()

interface RowVM {
  id: string
  title: string
  description: string
  requiredBy: string | null
  status: 'complete' | 'in_progress' | 'not_started' | 'overdue'
  statusLabel: string
  completedAt: string | null
}

function formatRequiredBy(iso: string | null): string {
  if (!iso) return 'No deadline'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isOverdue(requiredBy: string | null): boolean {
  if (!requiredBy) return false
  const due = new Date(requiredBy).getTime()
  // Compare against today at midnight to avoid 1-minute-after-midnight surprises.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today.getTime()
}

const rows = computed<RowVM[]>(() =>
  activeForUser.value.map((t) => {
    const completion = completionFor(t.id)
    const complete = isComplete(t.id)
    const overdue = !complete && isOverdue(t.requiredBy)
    const status: RowVM['status'] = complete
      ? 'complete'
      : overdue
        ? 'overdue'
        : completion
          ? 'in_progress'
          : 'not_started'
    const statusLabel = {
      complete: 'Complete',
      overdue: 'Overdue',
      in_progress: 'In progress',
      not_started: 'Not started',
    }[status]
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      requiredBy: t.requiredBy,
      status,
      statusLabel,
      completedAt: completion?.completedAt ?? null,
    }
  }),
)

const outstanding = computed(() => rows.value.filter((r) => r.status !== 'complete'))
const done = computed(() => rows.value.filter((r) => r.status === 'complete'))
</script>

<template>
  <div class="rt">
    <header class="rt__header">
      <div class="flex items-center gap-2">
        <ShieldCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display rt__title">Required Training</h1>
      </div>
      <p class="rt__sub">
        Compliance modules from the Chief and Medical Director. Watch the full video and sign
        the attestation. A certificate downloads automatically when you finish.
      </p>
    </header>

    <div v-if="!auth.appUser" class="rt__gate">Sign in to view your required training.</div>

    <template v-else>
      <div v-if="!ready" class="rt__empty">Loading…</div>

      <template v-else>
        <Eyebrow class="mt-6 mb-2">
          Outstanding · {{ outstanding.length }}
        </Eyebrow>
        <div v-if="!outstanding.length" class="rt__empty rt__empty--good">
          You're all caught up. Nothing outstanding right now.
        </div>
        <div v-else class="rt__list">
          <RouterLink
            v-for="r in outstanding"
            :key="r.id"
            :to="`/training/required/${r.id}`"
            class="rt-row-link"
          >
            <AppCard class="rt-row" :class="`rt-row--${r.status}`">
              <div class="rt-row__main">
                <div class="rt-row__head">
                  <span class="rt-row__title display">{{ r.title }}</span>
                  <span class="rt-row__chip" :class="`rt-row__chip--${r.status}`">
                    <Clock v-if="r.status === 'in_progress'" :size="12" :stroke-width="2" />
                    <AlertTriangle v-else-if="r.status === 'overdue'" :size="12" :stroke-width="2" />
                    {{ r.statusLabel }}
                  </span>
                </div>
                <p v-if="r.description" class="rt-row__desc">{{ r.description }}</p>
                <div class="rt-row__meta">
                  <span>Due: <strong>{{ formatRequiredBy(r.requiredBy) }}</strong></span>
                </div>
              </div>
              <ChevronRight :size="18" :stroke-width="1.85" class="rt-row__chev" />
            </AppCard>
          </RouterLink>
        </div>

        <template v-if="done.length">
          <Eyebrow class="mt-8 mb-2">
            Completed · {{ done.length }}
          </Eyebrow>
          <div class="rt__list">
            <RouterLink
              v-for="r in done"
              :key="r.id"
              :to="`/training/required/${r.id}`"
              class="rt-row-link"
            >
              <AppCard class="rt-row rt-row--complete">
                <div class="rt-row__main">
                  <div class="rt-row__head">
                    <span class="rt-row__title display">{{ r.title }}</span>
                    <span class="rt-row__chip rt-row__chip--complete">
                      <Check :size="12" :stroke-width="2.5" />
                      {{ formatRelative(r.completedAt) }}
                    </span>
                  </div>
                </div>
                <ChevronRight :size="18" :stroke-width="1.85" class="rt-row__chev" />
              </AppCard>
            </RouterLink>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
.rt {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .rt {
    padding: 40px 40px 80px;
  }
}
.rt__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .rt__title {
    font-size: 36px;
  }
}
.rt__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}
.rt__gate {
  margin-top: 32px;
  padding: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.rt__empty {
  padding: 24px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.rt__empty--good {
  color: var(--color-success-500);
  font-weight: 600;
}
.rt__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rt-row-link {
  text-decoration: none;
  color: inherit;
  display: block;
}
.rt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px !important;
  transition: border-color 120ms var(--ease-out);
}
.rt-row:hover {
  border-color: var(--color-muted-soft);
}
.rt-row--overdue {
  border-color: var(--color-danger-500);
}
.rt-row--complete {
  opacity: 0.85;
}
.rt-row__main {
  flex: 1;
  min-width: 0;
}
.rt-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rt-row__title {
  font-size: 16px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.rt-row__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.rt-row__chip--in_progress {
  color: var(--color-brand-700);
  border-color: var(--color-brand-100);
  background: var(--color-brand-50);
}
.rt-row__chip--overdue {
  color: var(--color-danger-500);
  border-color: oklch(0.85 0.07 20);
  background: oklch(0.97 0.04 20);
}
.rt-row__chip--complete {
  color: var(--color-success-500);
  border-color: #c6e4d2;
  background: #f0f8f3;
}
.rt-row__desc {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.rt-row__meta {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
}
.rt-row__chev {
  color: var(--color-muted);
}
</style>
