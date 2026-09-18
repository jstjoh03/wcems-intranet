<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Truck,
  CalendarDays,
  Share2,
  Pencil,
  TriangleAlert,
  CircleCheck,
  Undo2,
  Check,
  ChevronRight,
  Repeat,
  Printer,
  LogIn,
  LogOut,
  HandHelping,
} from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import EquipmentStepLadder from '@/components/equipment/EquipmentStepLadder.vue'
import EquipmentTimeline from '@/components/equipment/EquipmentTimeline.vue'
import EquipmentActionSheet from '@/components/equipment/EquipmentActionSheet.vue'
import EquipmentSheet from '@/components/equipment/EquipmentSheet.vue'
import { useEquipment } from '@/composables/useEquipment'
import {
  ACTION_LABEL,
  ACTION_RULES,
  HOME_LOCATION,
  KIND_LABEL,
  compareTags,
  eligibleFor,
  formatEventSpan,
  formatWhen,
  groupActions,
  placeName,
  pluralize,
  statusFromKind,
  summarizeCheckout,
  type CheckoutPhase,
} from '@/lib/equipment'
import type {
  EquipmentActionKind,
  EquipmentCheckout,
  EquipmentCustodyEvent,
  EquipmentEventKind,
} from '@/types'

/**
 * /equipment/checkout/:id — one batch's custody record and the place
 * every step gets recorded. This is the link a supervisor texts to the
 * event crew ("Send to crew") so they can confirm the gear is on the
 * truck and close out with a photo.
 */

const route = useRoute()
const router = useRouter()
const {
  version,
  canHandle,
  canRecord,
  assetById,
  typeName,
  activeTrucks,
  fetchCheckout,
  updateCheckoutDetails,
} = useEquipment()

const checkout = ref<EquipmentCheckout | null>(null)
const events = ref<EquipmentCustodyEvent[]>([])
const loading = ref(true)
const missingRecord = ref(false)
const loadErr = ref<string | null>(null)

async function load() {
  const id = String(route.params.id)
  try {
    const res = await fetchCheckout(id)
    if (String(route.params.id) !== id) return
    checkout.value = res.checkout
    events.value = res.events
    missingRecord.value = !res.checkout
    loadErr.value = null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    /* A mangled link (bad uuid) is just "not found" to a person. */
    if (/invalid input syntax for type uuid/i.test(msg)) missingRecord.value = true
    else loadErr.value = msg
  }
  loading.value = false
}

watch(
  () => route.params.id,
  () => {
    loading.value = true
    void load()
  },
  { immediate: true },
)
/* Realtime + post-action refreshes bump the shared version. */
watch(version, () => void load())

const summary = computed(() =>
  checkout.value ? summarizeCheckout(checkout.value, events.value) : null,
)

const items = computed(() =>
  (checkout.value?.assetIds ?? [])
    .map((id) => assetById.value[id])
    .filter((a) => !!a)
    .sort((a, b) => compareTags(a.tag, b.tag)),
)

const ITEM_LABEL: Record<EquipmentEventKind, string> = {
  checked_out: 'In transit',
  delivered: 'Delivered',
  confirmed_present: 'Confirmed',
  reported_missing: 'Not found',
  event_closed: 'Awaiting pickup',
  picked_up: 'Headed back',
  returned: 'Returned',
  canceled: 'Canceled',
  written_off: 'Lost',
  shift_start: 'Checked',
  shift_end: 'Checked',
}

function itemKind(id: string): EquipmentEventKind | undefined {
  return summary.value?.itemKinds[id]
}

/* ── Actions ───────────────────────────────────────────────────────── */
/* Single-night events: confirm on shift, then close out with a photo.
   Extended assignments: every crew does a start- and end-of-shift check,
   and the end-of-shift photo IS the hand-over — no separate close-out.
   Then a supervisor picks up and drops off at Admin. */
const actionOrder = computed<EquipmentActionKind[]>(() =>
  checkout.value?.extended
    ? ['delivered', 'shift_start', 'shift_end', 'picked_up', 'returned', 'written_off']
    : ['delivered', 'confirmed_present', 'event_closed', 'picked_up', 'returned', 'written_off'],
)
const PRIMARY_FOR: Record<CheckoutPhase, EquipmentActionKind[]> = {
  in_transit: ['delivered'],
  delivered: ['confirmed_present'],
  confirmed: ['event_closed'],
  assignment: [],
  closed: ['picked_up'],
  returning: ['returned'],
  missing: ['picked_up', 'confirmed_present', 'shift_start'],
  complete: [],
  canceled: [],
}

function allowed(kind: EquipmentActionKind): boolean {
  const rule = ACTION_RULES[kind]
  if (rule.handlerOnly ? !canHandle.value : !canRecord.value) return false
  if (!checkout.value || !summary.value) return false
  return eligibleFor(kind, summary.value.itemKinds, checkout.value.assetIds).length > 0
}

const availableActions = computed(() => actionOrder.value.filter(allowed))
const primaryAction = computed<EquipmentActionKind | null>(() => {
  const s = summary.value
  if (!s) return null
  /* On an extended assignment the next check alternates start → end. */
  const want = s.phase === 'assignment' ? [s.nextShiftCheck] : PRIMARY_FOR[s.phase]
  return want.find((k) => availableActions.value.includes(k)) ?? null
})

function actionLabel(kind: EquipmentActionKind): string {
  return ACTION_LABEL[kind]
}

const truckTitle = computed(() => {
  const d = checkout.value?.destination ?? ''
  return /^\d+$/.test(d) ? `Truck ${d}` : d
})
const span = computed(() =>
  checkout.value
    ? formatEventSpan(checkout.value.eventDate, checkout.value.extended ? checkout.value.endDate : null)
    : '',
)
const lastCheckText = computed(() => {
  const c = summary.value?.lastCheck
  if (!c) return 'No shift check yet'
  const what = c.kind === 'reported_missing' ? 'Check' : KIND_LABEL[c.kind]
  return `${what} · ${c.by} · ${formatWhen(c.at)}${c.missing ? ` · ${c.missing} not found` : ''}`
})
const secondaryActions = computed(() =>
  availableActions.value.filter((k) => k !== primaryAction.value),
)
const canCancel = computed(() => allowed('canceled'))
const showActionBar = computed(
  () => !!primaryAction.value || secondaryActions.value.length > 0 || canCancel.value,
)

const sheetKind = ref<EquipmentActionKind | null>(null)
function openAction(kind: EquipmentActionKind) {
  sheetKind.value = kind
}

/* ── Toast ─────────────────────────────────────────────────────────── */
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3800)
}
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
})

function onDone(message: string) {
  sheetKind.value = null
  showToast(message)
}

/* Arrived from the check-out flow. */
watch(
  () => [route.query.new, checkout.value] as const,
  ([isNew, co]) => {
    if (isNew && co) {
      showToast(`Checked out · ${pluralize(co.assetIds.length, 'item')} in transit to ${co.destination}`)
      router.replace({ path: route.path })
    }
  },
  { immediate: true },
)

/* ── Share with the event crew ─────────────────────────────────────── */
async function share() {
  if (!checkout.value) return
  const co = checkout.value
  const url = `${window.location.origin}/equipment/checkout/${co.id}`
  const text = co.extended
    ? `${co.purpose} on ${placeName(co.destination)} (${span.value}): extended assignment. Every crew checks the equipment at the start and end of their shift here:`
    : `${co.purpose} on ${placeName(co.destination)}: event equipment is on the truck. Confirm it's there, and snap a photo when the event wraps:`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'WCEMS event equipment', text, url })
    } catch {
      /* dismissed */
    }
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    showToast('Link copied — paste it to the crew')
  } catch {
    showToast(url)
  }
}

/* ── Printable card with a QR code, to leave with the gear ────────── */
const printing = ref(false)
async function printCard() {
  if (!checkout.value) return
  printing.value = true
  try {
    const { generateShiftCardPdf } = await import('@/lib/equipmentShiftCardPdf')
    const co = checkout.value
    const doc = await generateShiftCardPdf({
      checkout: co,
      items: items.value.filter((a) => {
        const k = summary.value?.itemKinds[a.id]
        return k !== 'returned' && k !== 'canceled' && k !== 'written_off'
      }),
      typeName,
      url: `${window.location.origin}/equipment/checkout/${co.id}`,
    })
    const safe = `${co.purpose}_${co.destination}`.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_Equipment_Card_${safe}.pdf`)
  } catch (e) {
    showToast(e instanceof Error ? `Couldn’t make the card: ${e.message}` : 'Couldn’t make the card')
  } finally {
    printing.value = false
  }
}

/* ── Edit details (handlers, while open) ───────────────────────────── */
const editing = ref(false)
const draft = ref({
  purpose: '',
  destination: '',
  eventDate: '',
  extended: false,
  endDate: '',
  note: '',
})
/* The truck list, plus the current destination if it isn't on it. */
const truckOptions = computed(() => {
  const labels = activeTrucks.value.map((t) => t.label)
  const cur = draft.value.destination
  return cur && !labels.includes(cur) ? [cur, ...labels] : labels
})
const editErr = ref<string | null>(null)
const savingEdit = ref(false)
function startEdit() {
  if (!checkout.value) return
  draft.value = {
    purpose: checkout.value.purpose,
    destination: checkout.value.destination,
    eventDate: checkout.value.eventDate ?? '',
    extended: checkout.value.extended,
    endDate: checkout.value.endDate ?? '',
    note: checkout.value.note,
  }
  editErr.value = null
  editing.value = true
}
async function saveEdit() {
  if (!checkout.value) return
  savingEdit.value = true
  const res = await updateCheckoutDetails(checkout.value.id, {
    purpose: draft.value.purpose,
    destination: draft.value.destination,
    eventDate: draft.value.eventDate || null,
    extended: draft.value.extended,
    endDate: draft.value.endDate || null,
    note: draft.value.note,
  })
  savingEdit.value = false
  if (!res.ok) {
    editErr.value = res.error
    return
  }
  editing.value = false
  showToast('Details updated')
}

/* ── Derived display ───────────────────────────────────────────────── */
const actions = computed(() => groupActions(events.value))

const missingReport = computed(() => {
  if (!summary.value?.missing) return null
  const ids = Object.entries(summary.value.itemKinds)
    .filter(([, k]) => k === 'reported_missing')
    .map(([id]) => id)
  const last = [...events.value].reverse().find((e) => e.kind === 'reported_missing')
  return { ids, last }
})

const isOpen = computed(() => !!checkout.value && !checkout.value.closedAt)
</script>

<template>
  <div class="eq-page eqc" :class="{ 'eqc--has-bar': showActionBar }">
    <RouterLink to="/equipment" class="eq-back">
      <ArrowLeft :size="15" :stroke-width="2" /> Equipment
    </RouterLink>

    <div v-if="loading && !checkout" class="eq-empty">Loading check-out…</div>
    <div v-else-if="loadErr && !checkout" class="eq-error eqc__err">{{ loadErr }}</div>
    <div v-else-if="missingRecord || !checkout" class="eq-empty">
      This check-out doesn’t exist, or the link is incomplete.
    </div>

    <template v-else-if="checkout && summary">
      <header class="eqc__head">
        <div class="eq-eyebrow">Check-out · {{ summary.phaseLabel }}</div>
        <h1 class="eq-h1 eqc__title">{{ checkout.purpose }}</h1>
        <div class="eqc__meta">
          <span><Truck :size="14" :stroke-width="2" /> {{ truckTitle }}</span>
          <span v-if="span">
            <CalendarDays :size="14" :stroke-width="2" /> {{ span }}
          </span>
          <span>{{ pluralize(checkout.assetIds.length, 'item') }}</span>
        </div>
        <div class="eqc__by">
          Checked out by <strong>{{ checkout.createdByName || 'Unknown' }}</strong> ·
          {{ formatWhen(checkout.createdAt) }}
        </div>
        <p v-if="checkout.note" class="eqc__note">{{ checkout.note }}</p>
        <div class="eqc__tools">
          <button v-if="isOpen" type="button" class="eq-btn eq-btn--secondary" @click="share">
            <Share2 :size="15" :stroke-width="2" /> Send to crew
          </button>
          <button
            v-if="isOpen"
            type="button"
            class="eq-btn eq-btn--secondary"
            :disabled="printing"
            @click="printCard"
          >
            <Printer :size="15" :stroke-width="2" /> {{ printing ? 'Making card…' : 'Print card' }}
          </button>
          <button v-if="isOpen && canHandle" type="button" class="eq-btn eq-btn--quiet" @click="startEdit">
            <Pencil :size="14" :stroke-width="2" /> Edit details
          </button>
        </div>
      </header>

      <!-- Extended assignment: what every arriving crew needs to know -->
      <section v-if="checkout.extended && isOpen" class="eqc__ext">
        <div class="eqc__ext-eyebrow">
          <Repeat :size="13" :stroke-width="2.4" /> Extended assignment<template v-if="span"> · {{ span }}</template>
        </div>
        <p class="eqc__ext-title">
          Every crew: check this equipment at the <em>start</em> and <em>end</em> of your shift.
        </p>
        <p class="eqc__ext-sub">
          The end-of-shift check includes a photo of where you leave it. A supervisor picks it up
          when the assignment wraps.
        </p>
        <div class="eqc__ext-rows">
          <div class="eqc__ext-row">
            <span class="eqc__ext-label">Last check</span>
            <span>{{ lastCheckText }}</span>
          </div>
          <div v-if="summary.phase === 'assignment'" class="eqc__ext-row">
            <span class="eqc__ext-label">Next up</span>
            <span class="eqc__ext-next">
              <LogIn v-if="summary.nextShiftCheck === 'shift_start'" :size="15" :stroke-width="2" />
              <LogOut v-else :size="15" :stroke-width="2" />
              {{ KIND_LABEL[summary.nextShiftCheck] }}
            </span>
          </div>
          <div v-else-if="summary.phase === 'closed'" class="eqc__ext-row">
            <span class="eqc__ext-label">Next up</span>
            <span class="eqc__ext-next">
              <HandHelping :size="15" :stroke-width="2" /> Supervisor pickup
            </span>
          </div>
        </div>
      </section>

      <div v-if="checkout.closedAt" class="eqc__closed" :class="{ 'eqc__closed--canceled': summary.phase === 'canceled' }">
        <CircleCheck :size="18" :stroke-width="2" />
        <span v-if="summary.phase === 'canceled'">Canceled — nothing left {{ HOME_LOCATION }}.</span>
        <span v-else-if="summary.lost">
          Closed · {{ pluralize(summary.lost, 'item') }} written off as lost · {{ formatWhen(checkout.closedAt) }}
        </span>
        <span v-else>All items back on the shelf · {{ formatWhen(checkout.closedAt) }}</span>
      </div>

      <div v-if="missingReport" class="eqc__missing">
        <TriangleAlert :size="18" :stroke-width="2" />
        <div>
          <div class="eqc__missing-title">
            {{ pluralize(missingReport.ids.length, 'item') }} reported not found
          </div>
          <div class="eqc__missing-items">
            <span v-for="id in missingReport.ids" :key="id">
              <span class="eq-tag">{{ assetById[id]?.tag }}</span> {{ assetById[id]?.name }}
            </span>
          </div>
          <div v-if="missingReport.last" class="eqc__missing-by">
            <template v-if="missingReport.last.note">“{{ missingReport.last.note }}” — </template>
            {{ missingReport.last.actorName }}, {{ formatWhen(missingReport.last.at) }}
          </div>
        </div>
      </div>

      <div class="eqc__cols">
        <div class="eqc__main">
          <section class="eqc__ladder">
            <EquipmentStepLadder :steps="summary.steps" />
            <div class="eqc__next">
              <span class="eqc__next-label">{{ checkout.closedAt ? 'Status' : 'Next' }}</span>
              {{ summary.nextHint }}
            </div>
          </section>

          <section class="eqc__section">
            <div class="eq-section-head">
              <h2 class="eq-section-title">Items</h2>
              <span class="eq-section-meta">{{ pluralize(items.length, 'item') }}</span>
            </div>
            <div class="eq-list">
              <RouterLink
                v-for="a in items"
                :key="a.id"
                :to="`/equipment/item/${encodeURIComponent(a.tag)}`"
                class="eqc__item"
              >
                <span class="eqc__item-line">
                  <span class="eq-tag">{{ a.tag }}</span>
                  <span class="eqc__item-name">{{ a.name }}</span>
                </span>
                <span class="eqc__item-meta">
                  <EquipmentStatusChip
                    v-if="itemKind(a.id)"
                    class="eqc__item-chip"
                    :status="statusFromKind(itemKind(a.id))"
                    :label="ITEM_LABEL[itemKind(a.id)!]"
                    :class="{ 'eqc__chip--muted': itemKind(a.id) === 'canceled' }"
                  />
                  <span class="eqc__item-type">{{ typeName(a.typeId) }}</span>
                </span>
                <ChevronRight :size="15" :stroke-width="2" class="eqc__item-go" />
              </RouterLink>
            </div>
          </section>

          <section class="eqc__section">
            <div class="eq-section-head">
              <h2 class="eq-section-title">Custody log</h2>
              <span class="eq-section-meta">{{ pluralize(actions.length, 'entry', 'entries') }}</span>
            </div>
            <EquipmentTimeline :actions="actions" show-items />
          </section>
        </div>

        <!-- Next step: fixed bar on phones, a side panel on desktop -->
        <!-- Also shown on a closed check-out when a written-off item can
             still come home. -->
        <aside v-if="showActionBar" class="eqc__actions">
          <div class="eqc__actions-inner">
            <div class="eqc__actions-label">Next step</div>
            <button
              v-if="primaryAction"
              type="button"
              class="eq-btn eq-btn--primary eq-btn--lg eqc__primary"
              @click="openAction(primaryAction)"
            >
              <LogIn v-if="primaryAction === 'shift_start'" :size="17" :stroke-width="2.2" />
              <LogOut v-else-if="primaryAction === 'shift_end'" :size="17" :stroke-width="2.2" />
              <Check v-else :size="17" :stroke-width="2.2" />
              {{ actionLabel(primaryAction) }}
            </button>
            <div v-if="secondaryActions.length || canCancel" class="eqc__secondary">
              <button
                v-for="k in secondaryActions"
                :key="k"
                type="button"
                class="eq-btn"
                :class="k === 'written_off' ? 'eq-btn--danger-quiet' : 'eq-btn--secondary'"
                @click="openAction(k)"
              >
                {{ actionLabel(k) }}
              </button>
              <button
                v-if="canCancel"
                type="button"
                class="eq-btn eq-btn--danger-quiet"
                @click="openAction('canceled')"
              >
                <Undo2 :size="14" :stroke-width="2" /> Cancel check-out
              </button>
            </div>
          </div>
        </aside>
        <aside v-else-if="isOpen && !canRecord" class="eqc__readonly">
          Sign in with your own account to record custody on this check-out.
        </aside>
      </div>

      <EquipmentActionSheet
        :open="!!sheetKind"
        :kind="sheetKind"
        :checkout="checkout"
        :item-kinds="summary.itemKinds"
        @close="sheetKind = null"
        @done="onDone"
      />

      <EquipmentSheet
        :open="editing"
        title="Edit details"
        :eyebrow="`Check-out · ${truckTitle}`"
        @close="editing = false"
      >
        <label class="eq-field">
          <span class="eq-label"><span>What it’s for</span></span>
          <input v-model="draft.purpose" class="eq-input" type="text" maxlength="120" />
        </label>
        <label class="eq-field">
          <span class="eq-label"><span>Truck</span></span>
          <select v-model="draft.destination" class="eq-select">
            <option v-for="t in truckOptions" :key="t" :value="t">{{ /^\d+$/.test(t) ? `Truck ${t}` : t }}</option>
          </select>
        </label>
        <label class="eqc__edit-ext">
          <input v-model="draft.extended" type="checkbox" />
          <span><strong>Extended assignment</strong> — every crew checks at the start and end of their shift</span>
        </label>
        <div class="eqc__edit-dates" :class="{ 'eqc__edit-dates--span': draft.extended }">
          <label class="eq-field">
            <span class="eq-label"><span>{{ draft.extended ? 'From' : 'Event date' }}</span></span>
            <input v-model="draft.eventDate" class="eq-input" type="date" />
          </label>
          <label v-if="draft.extended" class="eq-field">
            <span class="eq-label"><span>Through</span></span>
            <input v-model="draft.endDate" class="eq-input" type="date" :min="draft.eventDate || undefined" />
          </label>
        </div>
        <label class="eq-field">
          <span class="eq-label"><span>Note</span></span>
          <textarea v-model="draft.note" class="eq-textarea" rows="2" maxlength="500"></textarea>
        </label>
        <p class="eq-hint eqc__edit-hint">
          The custody log keeps what was recorded at the time; these details update everywhere else.
        </p>
        <template #footer>
          <p v-if="editErr" class="eq-error eqc__edit-err">{{ editErr }}</p>
          <button
            type="button"
            class="eq-btn eq-btn--primary eq-btn--lg eq-btn--block"
            :disabled="savingEdit"
            @click="saveEdit"
          >
            {{ savingEdit ? 'Saving…' : 'Save details' }}
          </button>
        </template>
      </EquipmentSheet>
    </template>

    <div v-if="toast" class="eq-toast" role="status">
      <CircleCheck :size="17" :stroke-width="2.2" /> {{ toast }}
    </div>
  </div>
</template>

<style scoped>
.eqc__err {
  margin-top: 16px;
}
.eqc__head {
  margin: 12px 0 20px;
}
.eqc__title {
  margin-top: 6px;
}
.eqc__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.eqc__meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.eqc__meta svg {
  color: var(--color-accent-700);
}
.eqc__by {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.eqc__by strong {
  font-weight: 600;
  color: var(--color-ink-soft);
}
.eqc__note {
  margin-top: 12px;
  max-width: 620px;
  padding: 9px 12px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border-left: 2px solid var(--color-accent-500);
  border-radius: 0 8px 8px 0;
}
.eqc__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

/* Extended assignment banner: navy lit surface, gold seam */
.eqc__ext {
  position: relative;
  overflow: hidden;
  margin-bottom: 18px;
  padding: 18px 18px 16px;
  color: white;
  background:
    radial-gradient(ellipse 80% 90% at 100% 0%, oklch(0.734 0.114 86.8 / 0.16), transparent 65%),
    radial-gradient(ellipse 70% 80% at 0% 100%, oklch(0.4 0.13 250 / 0.5), transparent 60%),
    linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}
.eqc__ext::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(200, 164, 77, 0.55) 18%,
    #e8cb72 50%,
    rgba(200, 164, 77, 0.55) 82%,
    transparent
  );
}
.eqc__ext-eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
}
.eqc__ext-title {
  margin-top: 8px;
  font-family: var(--font-display);
  font-size: 23px;
  line-height: 1.18;
}
.eqc__ext-title em {
  font-style: italic;
  color: var(--color-accent-on-dark);
}
.eqc__ext-sub {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.45;
  color: oklch(0.82 0.025 250);
}
.eqc__ext-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid oklch(1 0 0 / 0.12);
}
.eqc__ext-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
  line-height: 1.4;
  color: oklch(0.88 0.02 250);
}
.eqc__ext-label {
  flex-shrink: 0;
  width: 72px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: oklch(0.72 0.035 250);
}
.eqc__ext-next {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: white;
}
.eqc__ext-next svg {
  color: var(--color-accent-on-dark);
}
.eqc__edit-ext {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 18px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqc__edit-ext input {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex-shrink: 0;
  accent-color: var(--color-brand-600);
}
.eqc__edit-ext strong {
  color: var(--color-ink);
}
.eqc__edit-dates {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin-top: 18px;
}
.eqc__edit-dates--span {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.eqc__edit-dates .eq-field + .eq-field {
  margin-top: 0;
}
.eqc__closed {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 600;
  color: oklch(0.38 0.1 150);
  background: oklch(0.96 0.035 150);
  border: 1px solid oklch(0.88 0.06 150);
  border-radius: 12px;
}
.eqc__closed--canceled {
  color: var(--color-ink-soft);
  background: var(--color-surface-sunk);
  border-color: var(--color-line);
}
.eqc__missing {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
  padding: 14px 16px;
  color: oklch(0.45 0.17 25);
  background: var(--color-danger-50);
  border: 1px solid oklch(0.87 0.07 25);
  border-radius: 12px;
}
.eqc__missing > svg {
  flex-shrink: 0;
  margin-top: 1px;
}
.eqc__missing-title {
  font-size: 14.5px;
  font-weight: 700;
}
.eqc__missing-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-ink);
}
.eqc__missing-by {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--color-ink-soft);
}

.eqc__cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;
}
@media (min-width: 1024px) {
  .eqc__cols {
    grid-template-columns: minmax(0, 1fr) 300px;
    align-items: start;
    gap: 40px;
  }
}
.eqc__ladder {
  padding: 18px 6px 0;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}
.eqc__next {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  padding: 11px 12px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  text-align: center;
  color: var(--color-ink-soft);
  border-top: 1px solid var(--color-line-soft);
}
.eqc__next-label {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.eqc__section {
  margin-top: 28px;
}
/* room for the fixed two-row action bar on phones */
@media (max-width: 1023px) {
  .eqc--has-bar {
    padding-bottom: 200px;
  }
}
.eqc__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'line go'
    'meta go';
  align-items: center;
  gap: 7px 10px;
  min-height: 62px;
  padding: 11px 12px 11px 14px;
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid var(--color-line-soft);
  transition: background 120ms var(--ease-out);
}
.eqc__item:last-child {
  border-bottom: none;
}
.eqc__item:hover {
  background: var(--color-surface-soft);
}
.eqc__item-line {
  grid-area: line;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqc__item-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqc__item-meta {
  grid-area: meta;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqc__item-chip {
  flex-shrink: 0;
}
.eqc__item-type {
  font-size: 12.5px;
  color: var(--color-muted);
}
.eqc__item-go {
  grid-area: go;
  color: var(--color-muted-soft);
}
@media (min-width: 560px) {
  .eqc__item {
    grid-template-columns: minmax(0, 1fr) auto 16px;
    grid-template-areas:
      'line chip go'
      'type chip go';
    gap: 3px 12px;
  }
  .eqc__item-meta {
    display: contents;
  }
  .eqc__item-chip {
    grid-area: chip;
  }
  .eqc__item-type {
    grid-area: type;
  }
}
.eqc__chip--muted {
  opacity: 0.6;
}

/* Actions: fixed bar on phones */
.eqc__actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
  background: oklch(1 0 0 / 0.95);
  border-top: 1px solid var(--color-line);
  box-shadow: 0 -8px 24px oklch(0.2 0.03 260 / 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.eqc__actions-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 560px;
  margin: 0 auto;
}
.eqc__actions-label {
  display: none;
}
.eqc__primary {
  width: 100%;
}
.eqc__secondary {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.eqc__secondary::-webkit-scrollbar {
  display: none;
}
.eqc__secondary .eq-btn {
  flex-shrink: 0;
  min-height: 40px;
  font-size: 13px;
}
@media (min-width: 1024px) {
  .eqc__actions {
    position: sticky;
    top: 24px;
    padding: 18px;
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: 16px;
    box-shadow: var(--shadow-md);
    backdrop-filter: none;
  }
  .eqc__actions-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-accent-700);
  }
  .eqc__secondary {
    flex-direction: column;
    overflow: visible;
  }
  .eqc__secondary .eq-btn {
    width: 100%;
  }
}
.eqc__readonly {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--color-ink-soft);
  background: var(--color-surface-sunk);
  border-radius: 12px;
}
.eqc__edit-hint {
  margin-top: 14px;
}
.eqc__edit-err {
  margin-bottom: 10px;
}
</style>
