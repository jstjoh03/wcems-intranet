<script setup lang="ts">
import { ref, watch, onBeforeUnmount, type Component } from 'vue'
import {
  PackageOpen,
  Truck,
  ClipboardCheck,
  TriangleAlert,
  Flag,
  HandHelping,
  Warehouse,
  Undo2,
  CircleOff,
  X,
  ChevronRight,
  ImageIcon,
} from 'lucide-vue-next'
import { useEquipment } from '@/composables/useEquipment'
import {
  HOME_LOCATION,
  KIND_LABEL,
  formatWhen,
  pluralize,
  type CustodyAction,
} from '@/lib/equipment'
import type { EquipmentEventKind } from '@/types'

/**
 * The custody log, one entry per recorded action (newest first): who,
 * when, what happened, the note, and the evidence photo. Photos live in
 * a private bucket; signed links are fetched as entries appear.
 */
const props = defineProps<{
  actions: CustodyAction[]
  /** Item history: link each entry to its check-out. */
  showCheckout?: boolean
  /** Check-out log: list the tags each action covered. */
  showItems?: boolean
}>()

const { assetById, photoUrls, ensurePhotoUrls } = useEquipment()

const ICONS: Record<EquipmentEventKind, Component> = {
  checked_out: PackageOpen,
  delivered: Truck,
  confirmed_present: ClipboardCheck,
  reported_missing: TriangleAlert,
  event_closed: Flag,
  picked_up: HandHelping,
  returned: Warehouse,
  canceled: Undo2,
  written_off: CircleOff,
}

watch(
  () => props.actions.map((a) => a.photoPath),
  (paths) => void ensurePhotoUrls(paths),
  { immediate: true },
)

function detail(a: CustodyAction): string {
  switch (a.kind) {
    case 'checked_out':
      return `headed to ${a.destination}`
    case 'delivered':
      return a.handedToName ? `handed to ${a.handedToName}` : 'left on the unit'
    case 'confirmed_present':
      return a.missingAssetIds.length
        ? `${a.assetIds.length} here, ${a.missingAssetIds.length} not found`
        : `${pluralize(a.assetIds.length, 'item')} here`
    case 'reported_missing':
      return `${pluralize(a.assetIds.length, 'item')} not found`
    case 'event_closed':
      return 'photo of where it was left'
    case 'picked_up':
      return `headed back to ${HOME_LOCATION}`
    case 'returned':
      return a.handedToName ? `handed to ${a.handedToName}` : `left at ${HOME_LOCATION}`
    case 'canceled':
      return 'back on the shelf'
    case 'written_off':
      return `${pluralize(a.assetIds.length, 'item')} no longer tracked as out`
  }
}

function tagOf(id: string): string {
  return assetById.value[id]?.tag ?? '—'
}

/* ── Lightbox ── */
const zoom = ref<string | null>(null)
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') zoom.value = null
}
watch(zoom, (z) => {
  if (z) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <ol class="eqt">
    <li
      v-for="a in actions"
      :key="a.actionId"
      class="eqt__item"
      :class="`eqt__item--${a.kind}`"
    >
      <span class="eqt__icon" aria-hidden="true">
        <component :is="ICONS[a.kind]" :size="15" :stroke-width="2" />
      </span>
      <div class="eqt__body">
        <div class="eqt__top">
          <span class="eqt__kind">{{ KIND_LABEL[a.kind] }}</span>
          <time class="eqt__when" :datetime="a.at">{{ formatWhen(a.at) }}</time>
        </div>
        <div class="eqt__who">
          <strong>{{ a.actorName || 'Unknown' }}</strong> · {{ detail(a) }}
        </div>
        <p v-if="a.note" class="eqt__note">{{ a.note }}</p>
        <div v-if="showItems && (a.assetIds.length || a.missingAssetIds.length)" class="eqt__items">
          <span v-for="id in a.assetIds" :key="id" class="eq-tag">{{ tagOf(id) }}</span>
          <span v-for="id in a.missingAssetIds" :key="`m-${id}`" class="eq-tag eqt__tag--missing">
            {{ tagOf(id) }} not found
          </span>
        </div>
        <button
          v-if="a.photoPath"
          type="button"
          class="eqt__photo"
          :aria-label="`Open photo: ${KIND_LABEL[a.kind]}`"
          @click="zoom = a.photoPath"
        >
          <img
            v-if="photoUrls[a.photoPath]"
            :src="photoUrls[a.photoPath]"
            alt="Where the items were left"
            loading="lazy"
          />
          <span v-else class="eqt__photo-wait"><ImageIcon :size="18" :stroke-width="1.75" /></span>
        </button>
        <RouterLink
          v-if="showCheckout"
          :to="`/equipment/checkout/${a.checkoutId}`"
          class="eqt__co"
        >
          {{ a.checkoutPurpose ?? 'Check-out' }}<template v-if="a.checkoutDestination">
            · {{ a.checkoutDestination }}</template>
          <ChevronRight :size="13" :stroke-width="2.2" />
        </RouterLink>
      </div>
    </li>
  </ol>

  <Teleport to="body">
    <div v-if="zoom" class="eqt-lightbox" role="dialog" aria-label="Photo" @click="zoom = null">
      <button type="button" class="eqt-lightbox__close" aria-label="Close photo">
        <X :size="20" :stroke-width="2" />
      </button>
      <img v-if="photoUrls[zoom]" :src="photoUrls[zoom]" alt="Where the items were left" />
    </div>
  </Teleport>
</template>

<style scoped>
.eqt {
  list-style: none;
  margin: 0;
  padding: 0;
}
.eqt__item {
  position: relative;
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 12px;
  padding-bottom: 20px;
}
/* the rail */
.eqt__item::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 34px;
  bottom: 2px;
  width: 2px;
  border-radius: 2px;
  background: var(--color-line);
}
.eqt__item:last-child {
  padding-bottom: 0;
}
.eqt__item:last-child::before {
  display: none;
}
.eqt__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: var(--color-brand-600);
  background: var(--color-surface);
  border: 1.5px solid var(--color-brand-200);
}
.eqt__item--checked_out .eqt__icon,
.eqt__item--picked_up .eqt__icon {
  color: var(--color-accent-on-dark);
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
}
.eqt__item--returned .eqt__icon {
  color: oklch(0.42 0.12 150);
  background: oklch(0.955 0.04 150);
  border-color: oklch(0.85 0.07 150);
}
.eqt__item--reported_missing .eqt__icon {
  color: oklch(0.5 0.19 25);
  background: var(--color-danger-50);
  border-color: oklch(0.86 0.07 25);
}
.eqt__item--written_off .eqt__icon {
  color: white;
  background: oklch(0.45 0.12 25);
  border-color: oklch(0.45 0.12 25);
}
.eqt__item--canceled .eqt__icon {
  color: var(--color-muted);
  border-color: var(--color-line);
}
.eqt__body {
  min-width: 0;
  padding-top: 5px;
}
.eqt__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.eqt__kind {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.eqt__when {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}
.eqt__who {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-ink-soft);
}
.eqt__who strong {
  font-weight: 600;
  color: var(--color-ink);
}
.eqt__note {
  margin-top: 7px;
  padding: 8px 11px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border-left: 2px solid var(--color-accent-500);
  border-radius: 0 8px 8px 0;
}
.eqt__items {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.eqt__tag--missing {
  color: oklch(0.48 0.18 25);
  background: var(--color-danger-50);
  border-color: oklch(0.88 0.06 25);
}
.eqt__photo {
  display: block;
  margin-top: 9px;
  padding: 0;
  width: 132px;
  height: 99px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface-sunk);
  cursor: zoom-in;
  box-shadow: var(--shadow-sm);
}
.eqt__photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 300ms var(--ease-out);
}
.eqt__photo:hover img {
  transform: scale(1.04);
}
.eqt__photo-wait {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--color-muted-soft);
}
.eqt__co {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  text-decoration: none;
}
.eqt__co:hover {
  text-decoration: underline;
}

.eqt-lightbox {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 12px 24px;
  background: oklch(0.12 0.03 250 / 0.92);
  cursor: zoom-out;
  animation: eqt-fade 180ms var(--ease-out);
}
.eqt-lightbox img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}
.eqt-lightbox__close {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid oklch(1 0 0 / 0.2);
  background: oklch(1 0 0 / 0.08);
  color: white;
  cursor: pointer;
}
@keyframes eqt-fade {
  from {
    opacity: 0;
  }
}
</style>
