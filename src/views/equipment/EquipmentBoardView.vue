<script setup lang="ts">
import { ref, computed, type Component } from 'vue'
import { useRouter } from 'vue-router'
import {
  PackageOpen,
  Settings2,
  Search,
  ArrowRight,
  Truck,
  CalendarDays,
  TriangleAlert,
  Radio,
  Tablet,
  Package,
  ChevronRight,
  X,
} from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import EquipmentStepLadder from '@/components/equipment/EquipmentStepLadder.vue'
import { useEquipment } from '@/composables/useEquipment'
import {
  HOME_LOCATION,
  formatEventDate,
  formatWhen,
  groupActions,
  itemMatches,
  pluralize,
  statusChip,
  summarizeCheckout,
  type CustodyAction,
} from '@/lib/equipment'
import type { EquipmentAsset, EquipmentStatus } from '@/types'

/**
 * /equipment — the live "where is everything" board. Everyone signed in
 * sees it; handlers get the check-out and registry entry points.
 * Soft-launched: reachable by URL, no nav entry yet.
 */

const router = useRouter()
const {
  ready,
  loadError,
  canHandle,
  canRecord,
  counts,
  boardAssets,
  openCheckouts,
  recentEvents,
  activeTypes,
  assetById,
  typeName,
  stateOf,
  eventsForCheckout,
  refresh,
} = useEquipment()

/* ── Out now ───────────────────────────────────────────────────────── */
const outCards = computed(() =>
  openCheckouts.value
    .map((c) => {
      const s = summarizeCheckout(c, eventsForCheckout(c.id))
      const mix = new Map<string, number>()
      for (const id of s.openAssetIds) {
        const t = typeName(assetById.value[id]?.typeId ?? null)
        mix.set(t, (mix.get(t) ?? 0) + 1)
      }
      return {
        c,
        s,
        mix: [...mix.entries()].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(' · '),
      }
    })
    .sort(
      (a, b) =>
        (a.c.eventDate ?? '9999').localeCompare(b.c.eventDate ?? '9999') ||
        a.c.createdAt.localeCompare(b.c.createdAt),
    ),
)

/* ── Inventory ─────────────────────────────────────────────────────── */
type StatusFilter = 'all' | 'available' | 'out' | 'moving' | 'missing'
const statusFilter = ref<StatusFilter>('all')
const typeFilter = ref<string>('all')
const q = ref('')

const FILTER_STATUSES: Record<Exclude<StatusFilter, 'all'>, EquipmentStatus[]> = {
  available: ['available'],
  /* Not-found items count as out: the unit is their last known place. */
  out: ['on_unit', 'missing'],
  moving: ['in_transit', 'returning'],
  missing: ['missing'],
}

const inventory = computed(() =>
  boardAssets.value.filter((a) => {
    if (typeFilter.value !== 'all' && (a.typeId ?? 'none') !== typeFilter.value) return false
    if (statusFilter.value !== 'all') {
      if (!FILTER_STATUSES[statusFilter.value].includes(stateOf(a.id).status)) return false
    }
    return itemMatches(a, typeName(a.typeId), q.value)
  }),
)

const typeCounts = computed(() => {
  const m: Record<string, number> = {}
  for (const a of boardAssets.value) {
    const k = a.typeId ?? 'none'
    m[k] = (m[k] ?? 0) + 1
  }
  return m
})

const hasUncategorized = computed(() => (typeCounts.value.none ?? 0) > 0)

function setStatusFilter(f: StatusFilter) {
  statusFilter.value = statusFilter.value === f ? 'all' : f
  document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function clearFilters() {
  statusFilter.value = 'all'
  typeFilter.value = 'all'
  q.value = ''
}

const TYPE_ICONS: [RegExp, Component][] = [
  [/radio|portable|apx/i, Radio],
  [/ipad|tablet|toughbook|laptop/i, Tablet],
]
function typeIcon(a: EquipmentAsset): Component {
  const name = typeName(a.typeId)
  return TYPE_ICONS.find(([re]) => re.test(name))?.[1] ?? Package
}

/** The second line under an item: who has it or which event it's at. */
function detailLine(a: EquipmentAsset): string {
  const st = stateOf(a.id)
  const ev = st.lastEvent
  const co = st.checkoutId ? openCheckouts.value.find((c) => c.id === st.checkoutId) : null
  switch (st.status) {
    case 'in_transit':
    case 'returning':
      return ev?.actorName ? `With ${ev.actorName}` : ''
    case 'on_unit':
      return co?.purpose ?? ''
    case 'missing':
      return ev?.actorName ? `Reported by ${ev.actorName}` : ''
    case 'lost':
      return ev?.actorName ? `Written off by ${ev.actorName}` : ''
    default:
      return ev ? `Back ${formatWhen(ev.at)}` : ''
  }
}

function openItem(a: EquipmentAsset) {
  router.push(`/equipment/item/${encodeURIComponent(a.tag)}`)
}

/* ── Activity ──────────────────────────────────────────────────────── */
const activity = computed(() => groupActions(recentEvents.value).slice(0, 10))

function sentence(a: CustodyAction): string {
  const items = pluralize(a.assetIds.length, 'item')
  const unit = a.checkoutDestination ?? a.destination
  switch (a.kind) {
    case 'checked_out':
      return `checked out ${items} to ${a.destination}`
    case 'delivered':
      return `delivered ${items} to ${unit}`
    case 'confirmed_present':
      return a.missingAssetIds.length
        ? `confirmed ${a.assetIds.length} on ${unit}, ${a.missingAssetIds.length} not found`
        : `confirmed ${items} on ${unit}`
    case 'reported_missing':
      return `reported ${items} not found on ${unit}`
    case 'event_closed':
      return `closed out the event on ${unit}`
    case 'picked_up':
      return `picked up ${items} from ${unit}`
    case 'returned':
      return `returned ${items} to ${HOME_LOCATION}`
    case 'canceled':
      return `canceled ${items} before delivery`
    case 'written_off':
      return `wrote off ${items} as lost`
  }
}

const heroOut = computed(() => counts.value.on_unit + counts.value.missing)
const heroMoving = computed(() => counts.value.in_transit + counts.value.returning)
</script>

<template>
  <div class="eqb">
    <!-- Navy hero: the numbers that answer "where is everything?" -->
    <header class="eqb-hero">
      <div class="eqb-hero__wrap">
        <div class="eqb-hero__eyebrow">Event equipment · Chain of custody</div>
        <h1 class="eqb-hero__title">Where <em>everything</em> is.</h1>
        <p class="eqb-hero__sub">
          Radios, iPads, and event gear from {{ HOME_LOCATION }} — who has it, where it went, and
          when it came back.
        </p>

        <div class="eqb-hero__stats" :class="{ 'eqb-hero__stats--4': counts.missing > 0 }">
          <button
            type="button"
            class="eqb-stat"
            :class="{ 'eqb-stat--on': statusFilter === 'available' }"
            @click="setStatusFilter('available')"
          >
            <b>{{ counts.available }}</b>
            <span>On the shelf</span>
          </button>
          <button
            type="button"
            class="eqb-stat"
            :class="{ 'eqb-stat--on': statusFilter === 'out' }"
            @click="setStatusFilter('out')"
          >
            <b class="eqb-stat__gold">{{ heroOut }}</b>
            <span>Out at events</span>
          </button>
          <button
            type="button"
            class="eqb-stat"
            :class="{ 'eqb-stat--on': statusFilter === 'moving' }"
            @click="setStatusFilter('moving')"
          >
            <b>{{ heroMoving }}</b>
            <span>In transit</span>
          </button>
          <button
            v-if="counts.missing > 0"
            type="button"
            class="eqb-stat eqb-stat--alert"
            :class="{ 'eqb-stat--on': statusFilter === 'missing' }"
            @click="setStatusFilter('missing')"
          >
            <b>{{ counts.missing }}</b>
            <span>Not found</span>
          </button>
        </div>

        <div v-if="canHandle" class="eqb-hero__actions">
          <RouterLink to="/equipment/checkout/new" class="eq-btn eq-btn--gold eq-btn--lg">
            <PackageOpen :size="18" :stroke-width="2" /> Check out equipment
          </RouterLink>
          <RouterLink
            to="/equipment/manage"
            class="eq-btn eq-btn--ghost-dark eq-btn--lg eqb-hero__reg"
            aria-label="Registry"
          >
            <Settings2 :size="17" :stroke-width="2" /> <span class="eqb-hero__reg-text">Registry</span>
          </RouterLink>
        </div>
      </div>
      <div class="eq-goldseam"></div>
    </header>

    <div class="eq-page eqb__page">
      <div v-if="!canRecord && ready" class="eqb__kiosk">
        Viewing on a shared account. Sign in with your own account to record custody.
      </div>

      <div v-if="loadError" class="eq-error eqb__error">
        <TriangleAlert :size="16" :stroke-width="2" />
        <span>
          Couldn’t load equipment: {{ loadError }}
          <button type="button" class="eqb__retry" @click="refresh()">Try again</button>
        </span>
      </div>

      <div v-if="!ready" class="eq-empty">Loading equipment…</div>

      <div v-else class="eqb__cols">
        <div class="eqb__main">
          <!-- Out now -->
          <section class="eqb__section">
            <div class="eq-section-head">
              <h2 class="eq-section-title">Out now</h2>
              <span class="eq-section-meta">
                {{ outCards.length ? pluralize(outCards.length, 'check-out') : '' }}
              </span>
            </div>

            <div v-if="!outCards.length" class="eqb__none">
              Nothing is out. Everything is on the shelf at {{ HOME_LOCATION }}.
            </div>

            <div v-else class="eqb__cards">
              <RouterLink
                v-for="({ c, s, mix }, i) in outCards"
                :key="c.id"
                :to="`/equipment/checkout/${c.id}`"
                class="eqb-card eq-reveal"
                :style="{ animationDelay: `${Math.min(i, 6) * 45}ms` }"
              >
                <div class="eqb-card__top">
                  <span class="eqb-card__unit">
                    <Truck :size="13" :stroke-width="2.2" /> {{ c.destination }}
                    <template v-if="c.eventDate">
                      <span class="eqb-card__dot">·</span>
                      <CalendarDays :size="12" :stroke-width="2.2" /> {{ formatEventDate(c.eventDate) }}
                    </template>
                  </span>
                  <span class="eqb-card__phase" :class="`eqb-card__phase--${s.phase}`">
                    {{ s.phaseLabel }}
                  </span>
                </div>
                <div class="eqb-card__purpose">{{ c.purpose }}</div>
                <div class="eqb-card__mix">
                  {{ pluralize(s.openAssetIds.length, 'item') }}<template v-if="mix"> · {{ mix }}</template>
                </div>
                <EquipmentStepLadder :steps="s.steps" compact class="eqb-card__ladder" />
                <div class="eqb-card__foot">
                  <span v-if="s.missing" class="eqb-card__missing">
                    <TriangleAlert :size="13" :stroke-width="2.2" />
                    {{ s.missing }} not found
                  </span>
                  <span class="eqb-card__hint">{{ s.nextHint }}</span>
                  <ArrowRight :size="15" :stroke-width="2" class="eqb-card__go" />
                </div>
              </RouterLink>
            </div>
          </section>

          <!-- Inventory -->
          <section id="inventory" class="eqb__section">
            <div class="eq-section-head">
              <h2 class="eq-section-title">Inventory</h2>
              <span class="eq-section-meta">
                {{ inventory.length === boardAssets.length ? pluralize(boardAssets.length, 'item') : `${inventory.length} of ${boardAssets.length}` }}
              </span>
            </div>

            <template v-if="boardAssets.length">
              <div class="eqb__search">
                <Search :size="17" :stroke-width="1.9" />
                <input
                  v-model="q"
                  type="search"
                  placeholder="Search tag, name, or type…"
                  autocomplete="off"
                  enterkeyhint="search"
                />
                <button v-if="q" type="button" class="eqb__search-clear" aria-label="Clear search" @click="q = ''">
                  <X :size="15" :stroke-width="2" />
                </button>
              </div>

              <div class="eqb__filters">
                <button
                  type="button"
                  class="eq-sug"
                  :class="{ 'eq-sug--on': typeFilter === 'all' }"
                  @click="typeFilter = 'all'"
                >
                  All types
                </button>
                <button
                  v-for="t in activeTypes.filter((t) => typeCounts[t.id])"
                  :key="t.id"
                  type="button"
                  class="eq-sug"
                  :class="{ 'eq-sug--on': typeFilter === t.id }"
                  @click="typeFilter = typeFilter === t.id ? 'all' : t.id"
                >
                  {{ t.name }} <span class="eq-sug__meta">{{ typeCounts[t.id] }}</span>
                </button>
                <button
                  v-if="hasUncategorized"
                  type="button"
                  class="eq-sug"
                  :class="{ 'eq-sug--on': typeFilter === 'none' }"
                  @click="typeFilter = typeFilter === 'none' ? 'all' : 'none'"
                >
                  Uncategorized <span class="eq-sug__meta">{{ typeCounts.none }}</span>
                </button>
                <button
                  v-if="statusFilter !== 'all'"
                  type="button"
                  class="eq-sug eq-sug--on"
                  @click="statusFilter = 'all'"
                >
                  {{ { available: 'On the shelf', out: 'Out at events', moving: 'In transit', missing: 'Not found' }[statusFilter] }}
                  <X :size="13" :stroke-width="2.2" />
                </button>
              </div>

              <div v-if="inventory.length" class="eq-list eqb-inv">
                <button
                  v-for="a in inventory"
                  :key="a.id"
                  type="button"
                  class="eqb-inv__row"
                  @click="openItem(a)"
                >
                  <span class="eqb-inv__icon" aria-hidden="true">
                    <component :is="typeIcon(a)" :size="17" :stroke-width="1.8" />
                  </span>
                  <span class="eqb-inv__line">
                    <span class="eq-tag">{{ a.tag }}</span>
                    <span class="eqb-inv__name">{{ a.name }}</span>
                    <span v-if="!a.active" class="eqb-inv__retired">Retired</span>
                  </span>
                  <span class="eqb-inv__meta">
                    <EquipmentStatusChip
                      class="eqb-inv__chip"
                      :status="stateOf(a.id).status"
                      :label="statusChip(stateOf(a.id))"
                    />
                    <span class="eqb-inv__sub">
                      {{ typeName(a.typeId) }}<template v-if="detailLine(a)"> · {{ detailLine(a) }}</template>
                    </span>
                  </span>
                  <ChevronRight :size="16" :stroke-width="2" class="eqb-inv__go" />
                </button>
              </div>
              <div v-else class="eq-list eq-empty">
                Nothing matches.
                <button type="button" class="eqb__retry" @click="clearFilters">Clear filters</button>
              </div>
            </template>

            <div v-else class="eq-list eq-empty">
              The registry is empty.
              <template v-if="canHandle">
                <RouterLink to="/equipment/manage" class="eqb__retry">Add equipment</RouterLink>
                to start tracking it.
              </template>
            </div>
          </section>
        </div>

        <!-- Activity -->
        <aside class="eqb__side">
          <div class="eq-section-head">
            <h2 class="eq-section-title">Recent activity</h2>
          </div>
          <div v-if="!activity.length" class="eqb__none">No custody activity yet.</div>
          <ol v-else class="eqb-feed">
            <li v-for="a in activity" :key="a.actionId">
              <RouterLink :to="`/equipment/checkout/${a.checkoutId}`" class="eqb-feed__row">
                <span class="eqb-feed__dot" :class="`eqb-feed__dot--${a.kind}`" aria-hidden="true"></span>
                <span class="eqb-feed__text">
                  <strong>{{ a.actorName || 'Someone' }}</strong> {{ sentence(a) }}
                  <span class="eqb-feed__meta">
                    {{ a.checkoutPurpose }}<template v-if="a.checkoutPurpose"> · </template>{{ formatWhen(a.at) }}
                  </span>
                </span>
              </RouterLink>
            </li>
          </ol>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Hero ── */
.eqb-hero {
  background:
    radial-gradient(ellipse 90% 70% at 15% 0%, oklch(0.4 0.13 250 / 0.55), transparent 60%),
    radial-gradient(ellipse 70% 60% at 85% 100%, oklch(0.32 0.12 250 / 0.5), transparent 60%),
    radial-gradient(ellipse 45% 40% at 78% 18%, oklch(0.734 0.114 86.8 / 0.12), transparent 65%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
}
.eqb-hero__wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 30px 16px 28px;
}
@media (min-width: 768px) {
  .eqb-hero__wrap {
    padding: 46px 32px 40px;
  }
}
.eqb-hero__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
  opacity: 0.88;
}
.eqb-hero__title {
  margin-top: 10px;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 40px;
  line-height: 1.02;
  letter-spacing: -0.01em;
  color: white;
}
.eqb-hero__title em {
  font-style: italic;
  color: var(--color-accent-on-dark);
}
@media (min-width: 768px) {
  .eqb-hero__title {
    font-size: 54px;
  }
}
.eqb-hero__sub {
  margin-top: 10px;
  max-width: 540px;
  font-size: 14px;
  line-height: 1.55;
  color: oklch(0.8 0.03 250);
}
.eqb-hero__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 0;
  max-width: 640px;
  margin: 22px 0 0 -14px;
}
.eqb-hero__stats--4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 640px) {
  .eqb-hero__stats--4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.eqb-stat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 6px 14px;
  font-family: var(--font-sans);
  text-align: left;
  background: none;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: background 140ms var(--ease-out);
}
/* feathered gold rule between stats */
.eqb-stat + .eqb-stat::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: linear-gradient(
    to bottom,
    transparent,
    oklch(0.734 0.114 86.8 / 0.45) 30%,
    oklch(0.734 0.114 86.8 / 0.45) 70%,
    transparent
  );
}
@media (max-width: 639px) {
  .eqb-hero__stats--4 .eqb-stat:nth-child(3)::before {
    display: none;
  }
}
.eqb-stat:hover,
.eqb-stat--on {
  background: oklch(1 0 0 / 0.08);
}
.eqb-stat b {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 38px;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: white;
}
.eqb-stat__gold {
  color: var(--color-accent-on-dark) !important;
}
.eqb-stat--alert b {
  color: oklch(0.78 0.12 30) !important;
}
.eqb-stat span {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: oklch(0.72 0.035 250);
}
.eqb-hero__actions {
  display: flex;
  gap: 10px;
  margin-top: 24px;
}
@media (max-width: 639px) {
  .eqb-hero__actions .eq-btn--gold {
    flex: 1;
  }
}
@media (max-width: 419px) {
  .eqb-hero__reg {
    padding: 0 15px;
  }
  .eqb-hero__reg-text {
    display: none;
  }
}

/* ── Page ── */
.eqb__page {
  padding-top: 24px;
}
.eqb__kiosk {
  margin-bottom: 16px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--color-ink-soft);
  background: var(--color-surface-sunk);
  border-radius: 10px;
}
.eqb__error {
  margin-bottom: 16px;
}
.eqb__retry {
  margin-left: 6px;
  padding: 0;
  font-family: var(--font-sans);
  font-size: inherit;
  font-weight: 700;
  color: var(--color-brand-600);
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
}
.eqb__cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 34px;
}
@media (min-width: 1024px) {
  .eqb__cols {
    grid-template-columns: minmax(0, 1fr) 320px;
    align-items: start;
    gap: 40px;
  }
  .eqb__side {
    position: sticky;
    top: 24px;
  }
}
.eqb__section + .eqb__section {
  margin-top: 34px;
}
.eqb__none {
  padding: 18px 0;
  font-size: 14px;
  color: var(--color-muted);
  border-top: 1px solid var(--color-line);
}

/* ── Out-now cards ── */
.eqb__cards {
  display: grid;
  gap: 12px;
}
@media (min-width: 720px) {
  .eqb__cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.eqb-card {
  display: flex;
  flex-direction: column;
  padding: 16px 16px 14px;
  color: inherit;
  text-decoration: none;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
  transition:
    border-color 160ms var(--ease-out),
    box-shadow 160ms var(--ease-out),
    transform 160ms var(--ease-out);
}
.eqb-card:hover {
  border-color: var(--color-accent-600);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.eqb-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.eqb-card__unit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-accent-700);
  white-space: nowrap;
}
.eqb-card__dot {
  margin: 0 2px;
  color: var(--color-muted-soft);
}
.eqb-card__phase {
  flex-shrink: 0;
  padding: 3px 9px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 999px;
  color: var(--color-brand-600);
  background: var(--color-brand-50);
}
.eqb-card__phase--closed {
  color: oklch(0.43 0.09 78);
  background: oklch(0.955 0.045 86.8);
}
.eqb-card__phase--missing {
  color: oklch(0.5 0.19 25);
  background: var(--color-danger-50);
}
.eqb-card__phase--returning {
  color: oklch(0.42 0.08 220);
  background: oklch(0.95 0.025 220);
}
.eqb-card__purpose {
  margin-top: 8px;
  font-family: var(--font-display);
  font-size: 23px;
  line-height: 1.12;
  color: var(--color-ink);
}
.eqb-card__mix {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}
.eqb-card__ladder {
  margin-top: 14px;
}
.eqb-card__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12.5px;
}
.eqb-card__missing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-weight: 700;
  color: oklch(0.5 0.19 25);
}
.eqb-card__hint {
  flex: 1;
  min-width: 0;
  color: var(--color-ink-soft);
  font-weight: 500;
}
.eqb-card__go {
  flex-shrink: 0;
  color: var(--color-muted-soft);
  transition:
    transform 160ms var(--ease-out),
    color 160ms var(--ease-out);
}
.eqb-card:hover .eqb-card__go {
  color: var(--color-accent-700);
  transform: translateX(2px);
}

/* ── Inventory ── */
.eqb__search {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 14px;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 12px;
  transition:
    border-color 140ms var(--ease-out),
    box-shadow 140ms var(--ease-out);
}
.eqb__search:focus-within {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqb__search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 16px;
  color: var(--color-ink);
}
.eqb__search-clear {
  display: inline-flex;
  padding: 6px;
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
}
.eqb__filters {
  display: flex;
  gap: 6px;
  margin: 10px 0 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.eqb__filters::-webkit-scrollbar {
  display: none;
}
.eqb__filters .eq-sug {
  flex-shrink: 0;
}
/* Phones: tag + name on top, status chip + detail beneath (names stay
   readable). From 560px the chip moves to its own right-hand column. */
.eqb-inv__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'line go'
    'meta go';
  align-items: center;
  gap: 7px 10px;
  width: 100%;
  min-height: 64px;
  padding: 11px 12px 11px 14px;
  text-align: left;
  font-family: var(--font-sans);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.eqb-inv__row:last-child {
  border-bottom: none;
}
.eqb-inv__row:hover {
  background: var(--color-surface-soft);
}
.eqb-inv__icon {
  display: none;
}
.eqb-inv__line {
  grid-area: line;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqb-inv__name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqb-inv__retired {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.eqb-inv__meta {
  grid-area: meta;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqb-inv__chip {
  flex-shrink: 0;
}
.eqb-inv__sub {
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqb-inv__go {
  grid-area: go;
  color: var(--color-muted-soft);
}
@media (min-width: 560px) {
  .eqb-inv__row {
    grid-template-columns: 36px minmax(0, 1fr) auto 16px;
    grid-template-areas:
      'icon line chip go'
      'icon sub chip go';
    gap: 3px 12px;
  }
  .eqb-inv__icon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--color-brand-600);
    background: var(--color-brand-50);
  }
  .eqb-inv__meta {
    display: contents;
  }
  .eqb-inv__chip {
    grid-area: chip;
  }
  .eqb-inv__sub {
    grid-area: sub;
  }
}

/* ── Activity feed ── */
.eqb-feed {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--color-line);
}
.eqb-feed__row {
  display: flex;
  gap: 11px;
  padding: 12px 4px;
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid var(--color-line-soft);
  border-radius: 6px;
  transition: background 120ms var(--ease-out);
}
.eqb-feed__row:hover {
  background: var(--color-surface-soft);
}
.eqb-feed__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 999px;
  background: var(--color-brand-400);
}
.eqb-feed__dot--checked_out,
.eqb-feed__dot--picked_up {
  background: var(--color-accent-500);
}
.eqb-feed__dot--returned {
  background: oklch(0.6 0.13 150);
}
.eqb-feed__dot--reported_missing {
  background: oklch(0.58 0.19 25);
}
.eqb-feed__dot--written_off {
  background: oklch(0.42 0.12 25);
}
.eqb-feed__dot--canceled {
  background: var(--color-muted-soft);
}
.eqb-feed__text {
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--color-ink-soft);
}
.eqb-feed__text strong {
  font-weight: 600;
  color: var(--color-ink);
}
.eqb-feed__meta {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-muted);
}
</style>
