<script setup lang="ts">
import { onMounted } from 'vue'
import { BarChart3, RefreshCw } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useUsageMetrics } from '@/composables/useUsageMetrics'

const auth = useAuthStore()
const {
  overview,
  topRoutes,
  topUsers,
  neverSignedIn,
  loading,
  error,
  reachPct,
  load,
} = useUsageMetrics()

onMounted(() => {
  if (auth.isAdmin) void load()
})

/* Human-friendly "5m ago / 3h ago / 2d ago" — keeps the table scan
   speed up vs full timestamps. Falls back to a date once we're past
   the 30-day window the metrics page reports on anyway. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  const hour = Math.floor(min / 60)
  const day = Math.floor(hour / 24)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hour < 24) return `${hour}h ago`
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="usage">
    <header class="usage__header">
      <div class="flex items-center gap-2">
        <BarChart3 :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display usage__title">Usage</h1>
      </div>
      <p class="usage__sub">
        Real engagement — bumped whenever someone changes routes inside the app, so
        <em>active in 7 days</em> reflects actual use, not just sign-in churn.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="usage__gate">Admin only.</div>

    <template v-else>
      <div class="usage__toolbar">
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="load">
          <RefreshCw :size="14" :stroke-width="2" />
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>

      <div v-if="error" class="usage__error">{{ error }}</div>

      <!-- OVERVIEW STRIP -->
      <div v-if="overview" class="usage__metrics">
        <AppCard class="usage__metric">
          <Eyebrow>Roster</Eyebrow>
          <div class="usage__num">{{ overview.roster }}</div>
          <div class="usage__hint">active employees</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Ever signed in</Eyebrow>
          <div class="usage__num">{{ overview.everSignedIn }}</div>
          <div class="usage__hint">{{ reachPct }}% of roster</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 30 days</Eyebrow>
          <div class="usage__num">{{ overview.active30d }}</div>
          <div class="usage__hint">opened the app this month</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 7 days</Eyebrow>
          <div class="usage__num">{{ overview.active7d }}</div>
          <div class="usage__hint">opened the app this week</div>
        </AppCard>
        <AppCard class="usage__metric">
          <Eyebrow>Active · 24 hours</Eyebrow>
          <div class="usage__num">{{ overview.active24h }}</div>
          <div class="usage__hint">opened the app today</div>
        </AppCard>
      </div>

      <!-- TOP ROUTES -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Top pages · last 7 days</Eyebrow>
        <p v-if="!topRoutes.length && !loading" class="usage__empty">
          No route activity logged yet — give it a day or two for events to accrue
          after this change deploys.
        </p>
        <table v-else class="usage__table">
          <thead>
            <tr>
              <th>Route</th>
              <th class="num">Views</th>
              <th class="num">Unique users</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in topRoutes" :key="r.route">
              <td><code class="usage__path">{{ r.route }}</code></td>
              <td class="num">{{ r.views }}</td>
              <td class="num">{{ r.unique_users }}</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- TOP USERS -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Most engaged · last 30 days</Eyebrow>
        <p v-if="!topUsers.length && !loading" class="usage__empty">
          No data yet.
        </p>
        <table v-else class="usage__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th class="num">Views</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in topUsers" :key="u.user_id">
              <td>{{ u.full_name }}</td>
              <td><span class="usage__chip">{{ u.role }}</span></td>
              <td class="num">{{ u.views }}</td>
              <td class="usage__rel">{{ relativeTime(u.last_seen_at) }}</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- NEVER SIGNED IN -->
      <AppCard class="usage__panel">
        <Eyebrow class="mb-2">Never signed in</Eyebrow>
        <p v-if="!neverSignedIn.length && !loading" class="usage__empty usage__empty--good">
          Nobody — the entire active roster has signed in at least once.
        </p>
        <ul v-else class="usage__list">
          <li v-for="u in neverSignedIn" :key="u.id" class="usage__list-item">
            <span>{{ u.full_name }}</span>
            <span class="usage__chip">{{ u.role }}</span>
          </li>
        </ul>
        <p v-if="neverSignedIn.length" class="usage__hint usage__hint--block">
          These are people in the roster whose account hasn't been linked to a sign-in
          yet — they've never opened the intranet. Good candidates for a personal nudge.
        </p>
      </AppCard>
    </template>
  </div>
</template>

<style scoped>
.usage {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .usage {
    padding: 40px 40px 80px;
  }
}

.usage__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .usage__title {
    font-size: 36px;
  }
}
.usage__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
  max-width: 720px;
}

.usage__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.usage__toolbar {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}

.usage__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

/* OVERVIEW STRIP */
.usage__metrics {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (min-width: 640px) {
  .usage__metrics {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 960px) {
  .usage__metrics {
    grid-template-columns: repeat(5, 1fr);
  }
}
.usage__metric {
  padding: 14px 16px !important;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage__num {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-brand-600);
  line-height: 1;
  margin-top: 4px;
}
.usage__hint {
  font-size: 11.5px;
  color: var(--color-muted);
}
.usage__hint--block {
  display: block;
  margin-top: 12px;
}

/* PANELS */
.usage__panel {
  margin-top: 16px;
  padding: 18px !important;
}
.usage__empty {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.usage__empty--good {
  color: var(--color-success-500);
  font-weight: 600;
}

/* TABLE */
.usage__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.usage__table th,
.usage__table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.usage__table th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.usage__table th.num,
.usage__table td.num {
  text-align: right;
  font-family: var(--font-mono);
}
.usage__path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 1px 6px;
}
.usage__rel {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-muted);
}
.usage__chip {
  display: inline-flex;
  align-items: center;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-ink-soft);
}

/* NEVER-SIGNED-IN LIST */
.usage__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}
@media (min-width: 640px) {
  .usage__list {
    grid-template-columns: 1fr 1fr;
  }
}
.usage__list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-surface-soft);
}

/* BUTTONS */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover:not(:disabled) {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
