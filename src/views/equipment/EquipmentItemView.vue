<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, PackageOpen, Pencil, ArrowRight, UserRound } from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import EquipmentTimeline from '@/components/equipment/EquipmentTimeline.vue'
import { useEquipment } from '@/composables/useEquipment'
import {
  STATUS_LABEL,
  formatEventDate,
  formatWhen,
  groupActions,
  statusLine,
} from '@/lib/equipment'
import type { EquipmentCustodyEvent } from '@/types'

/**
 * /equipment/item/:tag — one asset's current whereabouts and its full
 * custody history across every check-out. Addressed by PSTrax tag so a
 * future QR sticker can point straight here.
 */

const route = useRoute()
const {
  ready,
  version,
  canHandle,
  assetByTag,
  stateOf,
  typeName,
  openCheckoutById,
  fetchAssetHistory,
} = useEquipment()

const tag = computed(() => String(route.params.tag ?? ''))
const asset = computed(() => assetByTag(tag.value))
const state = computed(() => (asset.value ? stateOf(asset.value.id) : null))
const liveCheckout = computed(() =>
  state.value?.checkoutId ? (openCheckoutById.value[state.value.checkoutId] ?? null) : null,
)

const history = ref<EquipmentCustodyEvent[]>([])
const historyLoading = ref(true)
const historyErr = ref<string | null>(null)

async function loadHistory() {
  const a = asset.value
  if (!a) {
    historyLoading.value = false
    return
  }
  try {
    history.value = await fetchAssetHistory(a.id)
    historyErr.value = null
  } catch (e) {
    historyErr.value = e instanceof Error ? e.message : String(e)
  }
  historyLoading.value = false
}

watch(() => [asset.value?.id, version.value], () => void loadHistory(), { immediate: true })

const actions = computed(() => groupActions(history.value))

/** The check-out it's tied to right now — open, or (for a lost item)
 *  the closed one it was written off on. */
const currentCheckout = computed(() => {
  if (liveCheckout.value) return liveCheckout.value
  const id = state.value?.checkoutId
  const ev = id ? history.value.find((e) => e.checkoutId === id) : null
  return ev
    ? {
        id: ev.checkoutId,
        purpose: ev.checkoutPurpose ?? 'Check-out',
        destination: ev.checkoutDestination ?? ev.destination,
        eventDate: null as string | null,
      }
    : null
})
const timesOut = computed(() => new Set(history.value.map((e) => e.checkoutId)).size)
const lastReturned = computed(
  () => history.value.find((e) => e.kind === 'returned' || e.kind === 'canceled')?.at ?? null,
)

/** Who physically has it while it's moving. */
const custodian = computed(() => {
  const s = state.value
  if (!s || (s.status !== 'in_transit' && s.status !== 'returning')) return null
  return s.lastEvent?.actorName || null
})
</script>

<template>
  <div class="eq-page eqi">
    <RouterLink to="/equipment" class="eq-back">
      <ArrowLeft :size="15" :stroke-width="2" /> Equipment
    </RouterLink>

    <div v-if="!ready" class="eq-empty">Loading…</div>

    <div v-else-if="!asset || !state" class="eqi__missing">
      <h1 class="eq-h1">No item tagged <span class="eqi__missing-tag">{{ tag }}</span></h1>
      <p class="eq-sub">
        It isn’t in the registry. Check the PSTrax tag, or add it from the registry.
      </p>
      <RouterLink v-if="canHandle" to="/equipment/manage" class="eq-btn eq-btn--secondary eqi__missing-btn">
        Open the registry
      </RouterLink>
    </div>

    <template v-else>
      <header class="eqi__head">
        <div class="eq-eyebrow">{{ typeName(asset.typeId) }} · PSTrax asset</div>
        <div class="eqi__title-row">
          <span class="eqi__tag">{{ asset.tag }}</span>
          <span v-if="!asset.active" class="eqi__retired">Retired</span>
        </div>
        <h1 class="eq-h1 eqi__name">{{ asset.name }}</h1>
        <p v-if="asset.notes" class="eqi__notes">{{ asset.notes }}</p>
      </header>

      <!-- Where it is now -->
      <section class="eqi__now" :class="`eqi__now--${state.status}`">
        <div class="eqi__now-top">
          <span class="eqi__now-label">Right now</span>
          <EquipmentStatusChip :status="state.status" :label="STATUS_LABEL[state.status]" size="md" />
        </div>
        <div class="eqi__now-where">{{ statusLine(state) }}</div>
        <div class="eqi__now-meta">
          <span v-if="custodian"><UserRound :size="13" :stroke-width="2" /> With {{ custodian }}</span>
          <span v-if="state.since">Since {{ formatWhen(state.since) }}</span>
        </div>
        <RouterLink
          v-if="currentCheckout"
          :to="`/equipment/checkout/${currentCheckout.id}`"
          class="eqi__now-link"
        >
          <span>
            <strong>{{ currentCheckout.purpose }}</strong>
            · {{ currentCheckout.destination }}<template v-if="currentCheckout.eventDate">
              · {{ formatEventDate(currentCheckout.eventDate) }}</template>
          </span>
          <ArrowRight :size="16" :stroke-width="2" />
        </RouterLink>
        <p v-if="state.status === 'lost' && canHandle" class="eqi__lost-hint">
          Turned up? Open its check-out and drop it off at Admin — that puts it back on the shelf.
        </p>
        <div v-if="canHandle" class="eqi__now-actions">
          <RouterLink
            v-if="state.status === 'available' && asset.active"
            :to="{ path: '/equipment/checkout/new', query: { tag: asset.tag } }"
            class="eq-btn eq-btn--primary"
          >
            <PackageOpen :size="16" :stroke-width="2" /> Check out this item
          </RouterLink>
          <RouterLink
            :to="{ path: '/equipment/manage', query: { edit: asset.id } }"
            class="eq-btn eq-btn--secondary"
          >
            <Pencil :size="14" :stroke-width="2" /> Edit in registry
          </RouterLink>
        </div>
      </section>

      <div class="eqi__stats">
        <div>
          <b>{{ timesOut }}</b>
          <span>{{ timesOut === 1 ? 'Check-out' : 'Check-outs' }}</span>
        </div>
        <div>
          <b class="eqi__stats-date">{{ lastReturned ? formatWhen(lastReturned) : '—' }}</b>
          <span>Last back at Admin</span>
        </div>
      </div>

      <section class="eqi__history">
        <div class="eq-section-head">
          <h2 class="eq-section-title">Custody history</h2>
        </div>
        <div v-if="historyLoading && !history.length" class="eq-empty">Loading history…</div>
        <div v-else-if="historyErr" class="eq-error">{{ historyErr }}</div>
        <div v-else-if="!actions.length" class="eqi__none">
          No custody history yet — this item hasn’t left Admin.
        </div>
        <EquipmentTimeline v-else :actions="actions" show-checkout />
      </section>
    </template>
  </div>
</template>

<style scoped>
.eqi {
  max-width: 760px;
}
.eqi__head {
  margin: 12px 0 20px;
}
.eqi__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.eqi__tag {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-on-dark);
  background: linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border-radius: 8px;
  padding: 4px 11px;
  box-shadow: var(--shadow-sm);
}
.eqi__retired {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 3px 9px;
}
.eqi__name {
  margin-top: 10px;
}
.eqi__notes {
  margin-top: 8px;
  font-size: 14px;
  color: var(--color-ink-soft);
}

.eqi__now {
  padding: 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}
.eqi__now--missing {
  border-color: oklch(0.87 0.07 25);
  background: linear-gradient(180deg, oklch(0.985 0.012 25), var(--color-surface) 60%);
}
.eqi__now-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.eqi__now-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.eqi__now-where {
  margin-top: 10px;
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1.1;
  color: var(--color-ink);
}
.eqi__now-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.eqi__now-meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.eqi__now-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  padding: 12px 14px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
  text-decoration: none;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  transition: border-color 140ms var(--ease-out);
}
.eqi__now-link:hover {
  border-color: var(--color-accent-600);
}
.eqi__now-link strong {
  font-weight: 700;
  color: var(--color-ink);
}
.eqi__now-link svg {
  flex-shrink: 0;
  color: var(--color-accent-700);
}
.eqi__lost-hint {
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-muted);
}
.eqi__now-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.eqi__stats {
  display: flex;
  gap: 32px;
  margin: 22px 2px 6px;
}
.eqi__stats div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.eqi__stats b {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 30px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink);
}
.eqi__stats-date {
  font-size: 20px !important;
  line-height: 1.5 !important;
}
.eqi__stats span {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.eqi__history {
  margin-top: 26px;
}
.eqi__none {
  padding: 16px 0;
  font-size: 14px;
  color: var(--color-muted);
  border-top: 1px solid var(--color-line);
}
.eqi__missing {
  margin-top: 16px;
}
.eqi__missing-tag {
  font-family: var(--font-mono);
  font-size: 0.7em;
}
.eqi__missing-btn {
  margin-top: 18px;
}
</style>
