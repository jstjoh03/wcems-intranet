<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { FileText, Check, AlertTriangle, ChevronRight, Clock } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import { usePolicies } from '@/composables/usePolicies'
import { useAuthStore } from '@/stores/auth'
import type { PolicyCategory } from '@/types'

const auth = useAuthStore()
const { ready, activeForUser, isAcknowledged, isStale, ackFor } = usePolicies()

interface RowVM {
  id: string
  title: string
  summary: string
  category: PolicyCategory
  status: 'acknowledged' | 'stale' | 'not_acknowledged'
  statusLabel: string
  acknowledgedAt: string | null
}

const CATEGORY_LABEL: Record<PolicyCategory, string> = {
  clinical: 'Clinical',
  operational: 'Operational',
  hr: 'HR',
  general: 'General',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const rows = computed<RowVM[]>(() =>
  activeForUser.value.map((p) => {
    const ack = ackFor(p.id)
    const acknowledged = isAcknowledged(p.id)
    const stale = isStale(p.id)
    const status: RowVM['status'] = acknowledged
      ? 'acknowledged'
      : stale
        ? 'stale'
        : 'not_acknowledged'
    const statusLabel = {
      acknowledged: 'Acknowledged',
      stale: 'Update — please re-acknowledge',
      not_acknowledged: 'Acknowledgement required',
    }[status]
    return {
      id: p.id,
      title: p.title,
      summary: p.summary,
      category: p.category,
      status,
      statusLabel,
      acknowledgedAt: ack?.acknowledgedAt ?? null,
    }
  }),
)

const outstanding = computed(() => rows.value.filter((r) => r.status !== 'acknowledged'))
const done = computed(() => rows.value.filter((r) => r.status === 'acknowledged'))

/* Group both lists by category so the page reads like a table of contents. */
function groupByCategory(list: RowVM[]): Array<{ category: PolicyCategory; rows: RowVM[] }> {
  const order: PolicyCategory[] = ['clinical', 'operational', 'hr', 'general']
  const buckets: Record<PolicyCategory, RowVM[]> = {
    clinical: [],
    operational: [],
    hr: [],
    general: [],
  }
  for (const r of list) buckets[r.category].push(r)
  return order
    .filter((c) => buckets[c].length > 0)
    .map((c) => ({ category: c, rows: buckets[c] }))
}

const outstandingGroups = computed(() => groupByCategory(outstanding.value))
const doneGroups = computed(() => groupByCategory(done.value))
</script>

<template>
  <div class="pol">
    <header class="pol__header">
      <div class="flex items-center gap-2">
        <FileText :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display pol__title">Policies</h1>
      </div>
      <p class="pol__sub">
        Clinical, operational, and administrative policies you're required to read.
        Open each one, scroll through the document, and sign the attestation.
        A signed copy downloads automatically.
      </p>
    </header>

    <div v-if="!auth.appUser" class="pol__gate">Sign in to view your assigned policies.</div>

    <div v-else-if="!ready" class="pol__empty">Loading policies…</div>

    <div v-else-if="rows.length === 0" class="pol__empty">
      No policies assigned to you yet.
    </div>

    <template v-else>
      <section v-if="outstanding.length" class="pol__section">
        <h2 class="pol__section-title">
          {{ outstanding.length }} awaiting acknowledgement
        </h2>
        <template v-for="g in outstandingGroups" :key="g.category">
          <div class="pol__group-label">{{ CATEGORY_LABEL[g.category] }}</div>
          <RouterLink
            v-for="r in g.rows"
            :key="r.id"
            :to="`/policies/${r.id}`"
            class="pol-row-link"
          >
            <AppCard class="pol-row" :class="`pol-row--${r.status}`">
              <div class="pol-row__icon">
                <AlertTriangle
                  v-if="r.status === 'stale'"
                  :size="18"
                  :stroke-width="1.85"
                />
                <FileText v-else :size="18" :stroke-width="1.85" />
              </div>
              <div class="pol-row__body">
                <div class="pol-row__title display">{{ r.title }}</div>
                <p v-if="r.summary" class="pol-row__summary">{{ r.summary }}</p>
                <div class="pol-row__meta">
                  <span class="pol-row__chip">{{ r.statusLabel }}</span>
                </div>
              </div>
              <ChevronRight :size="16" :stroke-width="1.85" class="pol-row__chev" />
            </AppCard>
          </RouterLink>
        </template>
      </section>

      <section v-if="done.length" class="pol__section">
        <h2 class="pol__section-title pol__section-title--done">
          Acknowledged ({{ done.length }})
        </h2>
        <template v-for="g in doneGroups" :key="g.category">
          <div class="pol__group-label">{{ CATEGORY_LABEL[g.category] }}</div>
          <RouterLink
            v-for="r in g.rows"
            :key="r.id"
            :to="`/policies/${r.id}`"
            class="pol-row-link"
          >
            <AppCard class="pol-row pol-row--acknowledged">
              <div class="pol-row__icon pol-row__icon--done">
                <Check :size="16" :stroke-width="2.4" />
              </div>
              <div class="pol-row__body">
                <div class="pol-row__title display">{{ r.title }}</div>
                <div class="pol-row__meta">
                  <span class="pol-row__chip pol-row__chip--ack">
                    <Clock :size="11" :stroke-width="2" />
                    Acknowledged {{ formatDate(r.acknowledgedAt) }}
                  </span>
                </div>
              </div>
              <ChevronRight :size="16" :stroke-width="1.85" class="pol-row__chev" />
            </AppCard>
          </RouterLink>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pol {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .pol {
    padding: 40px 40px 80px;
  }
}

.pol__header {
  margin-bottom: 18px;
}
.pol__title {
  font-size: 26px;
  letter-spacing: -0.01em;
}
.pol__sub {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
  max-width: 60ch;
}

.pol__gate,
.pol__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.pol__section {
  margin-top: 22px;
}
.pol__section-title {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-brand-700);
  margin-bottom: 8px;
}
.pol__section-title--done {
  color: var(--color-muted);
}

.pol__group-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 14px 0 6px;
}

/* The whole row is a RouterLink; strip default link chrome and let
   the inner AppCard do the visual work. */
.pol-row-link {
  display: block;
  text-decoration: none;
  color: inherit;
}
.pol-row {
  display: flex !important;
  align-items: flex-start;
  gap: 12px;
  padding: 14px !important;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.pol-row-link:hover .pol-row {
  border-color: var(--color-brand-600);
}
.pol-row__icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pol-row__icon--done {
  background: #e4f4eb;
  color: var(--color-success-500);
}
.pol-row--stale .pol-row__icon {
  background: oklch(0.95 0.06 60);
  color: oklch(0.5 0.13 60);
}
.pol-row__body {
  flex: 1;
  min-width: 0;
}
.pol-row__title {
  font-size: 15px;
  color: var(--color-ink);
  line-height: 1.25;
}
.pol-row__summary {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  margin-top: 3px;
  line-height: 1.4;
}
.pol-row__meta {
  margin-top: 6px;
}
.pol-row__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: 1px solid var(--color-brand-100);
}
.pol-row--stale .pol-row__chip {
  background: oklch(0.95 0.06 60);
  color: oklch(0.5 0.13 60);
  border-color: oklch(0.85 0.07 60);
}
.pol-row__chip--ack {
  color: var(--color-success-500);
  background: #f0f8f3;
  border-color: #c6e4d2;
}
.pol-row__chev {
  align-self: center;
  color: var(--color-muted);
  flex-shrink: 0;
}
.pol-row--acknowledged .pol-row__title {
  color: var(--color-muted);
}
</style>
