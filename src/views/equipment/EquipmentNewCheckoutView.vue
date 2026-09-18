<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Search, Check, X, CalendarDays, Plus, Repeat } from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import { useEquipment } from '@/composables/useEquipment'
import type { EquipmentSuggestions, EventSuggestion } from '@/lib/equipmentBackend'
import {
  formatEventSpan,
  itemMatches,
  pluralize,
  statusChip,
  todayCentral,
} from '@/lib/equipment'

/**
 * /equipment/checkout/new — handlers only (route guard + RPC). Two
 * steps sized for a phone in a parking lot: pick the items, then say
 * what they're for and which truck they're going on (truck numbers from
 * the in-app list — not Medic unit designations). A multi-night event is
 * an extended assignment with a date span. Lands on the new check-out,
 * where "Mark delivered" is the next action.
 *
 * ?tag=00432 pre-selects an item (the item page's "Check out" button,
 * and later the Admin kiosk / QR stickers).
 */

const route = useRoute()
const router = useRouter()
const {
  ready,
  boardAssets,
  activeTypes,
  assetById,
  typeName,
  stateOf,
  assetByTag,
  activeTrucks,
  saveTruck,
  checkOut,
  loadSuggestions,
} = useEquipment()

const step = ref<1 | 2>(1)
const selected = ref<string[]>([])
const q = ref('')
const typeFilter = ref('all')
const showOut = ref(false)

const available = computed(() =>
  boardAssets.value.filter((a) => a.active && stateOf(a.id).status === 'available'),
)
const unavailable = computed(() =>
  boardAssets.value.filter((a) => stateOf(a.id).status !== 'available'),
)

function passes(a: { typeId: string | null; tag: string; name: string; notes: string }) {
  if (typeFilter.value !== 'all' && (a.typeId ?? 'none') !== typeFilter.value) return false
  return itemMatches(a, typeName(a.typeId), q.value)
}
const visible = computed(() => available.value.filter(passes))
const visibleOut = computed(() => unavailable.value.filter(passes))

const availableByType = computed(() => {
  const m: Record<string, number> = {}
  for (const a of available.value) m[a.typeId ?? 'none'] = (m[a.typeId ?? 'none'] ?? 0) + 1
  return m
})

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

/* Someone else checked an item out while this page was open. */
watch(available, (list) => {
  const ok = new Set(list.map((a) => a.id))
  selected.value = selected.value.filter((id) => ok.has(id))
})

/* ?tag= pre-select once the registry is in. */
watch(
  ready,
  (r) => {
    if (!r) return
    const tag = typeof route.query.tag === 'string' ? route.query.tag : ''
    const a = tag ? assetByTag(tag) : null
    if (a && stateOf(a.id).status === 'available' && !selected.value.includes(a.id))
      selected.value = [...selected.value, a.id]
  },
  { immediate: true },
)

/* ── Step 2 ── */
const purpose = ref('')
const destination = ref('')
const eventDate = ref(todayCentral())
const extended = ref(false)
const endDate = ref('')
const note = ref('')
const sugs = ref<EquipmentSuggestions | null>(null)

onMounted(async () => {
  sugs.value = await loadSuggestions()
})

const eventChips = computed(() => (sugs.value?.events ?? []).slice(0, 8))
const purposeChips = computed(() => {
  const fromEvents = new Set(eventChips.value.map((e) => e.label.toLowerCase()))
  return (sugs.value?.recentPurposes ?? [])
    .filter((p) => !fromEvents.has(p.toLowerCase()))
    .slice(0, 4)
})
/* Picking a scheduled event fills its dates; a run of nights turns on
   the extended assignment through the last one. */
function pickEvent(e: EventSuggestion) {
  purpose.value = e.label
  eventDate.value = e.date
  extended.value = !!e.endDate
  endDate.value = e.endDate ?? ''
}
function eventPicked(e: EventSuggestion) {
  return (
    purpose.value === e.label &&
    eventDate.value === e.date &&
    (extended.value ? endDate.value : '') === (e.endDate ?? '')
  )
}

watch(extended, (on) => {
  if (on && !endDate.value) endDate.value = eventDate.value
})

const spanError = computed(() =>
  extended.value && endDate.value && eventDate.value && endDate.value < eventDate.value
    ? 'The assignment can’t end before it starts.'
    : null,
)

/* Add a truck that isn't on the list yet (handlers can edit the list). */
const addingTruck = ref(false)
const newTruck = ref('')
const truckErr = ref<string | null>(null)
async function addTruck() {
  const res = await saveTruck(null, { label: newTruck.value, active: true })
  if (!res.ok) {
    truckErr.value = res.error
    return
  }
  destination.value = res.truck?.label ?? newTruck.value.trim()
  newTruck.value = ''
  truckErr.value = null
  addingTruck.value = false
}

const submitting = ref(false)
const error = ref<string | null>(null)
const canSubmit = computed(
  () =>
    selected.value.length > 0 &&
    purpose.value.trim().length > 0 &&
    destination.value.trim().length > 0 &&
    !spanError.value &&
    !submitting.value,
)

function goStep2() {
  if (!selected.value.length) return
  step.value = 2
  window.scrollTo({ top: 0 })
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  error.value = null
  const res = await checkOut({
    assetIds: selected.value,
    purpose: purpose.value,
    destination: destination.value,
    eventDate: eventDate.value || null,
    note: note.value,
    extended: extended.value,
    endDate: extended.value ? endDate.value || null : null,
  })
  submitting.value = false
  if (!res.ok) {
    error.value = res.error
    return
  }
  router.replace({ path: `/equipment/checkout/${res.id}`, query: { new: '1' } })
}
</script>

<template>
  <div class="eq-page eqn">
    <RouterLink to="/equipment" class="eq-back">
      <ArrowLeft :size="15" :stroke-width="2" /> Equipment
    </RouterLink>

    <header class="eqn__head">
      <div class="eq-eyebrow">Step {{ step }} of 2 · {{ step === 1 ? 'Items' : 'Destination' }}</div>
      <h1 class="eq-h1">{{ step === 1 ? 'What are you taking?' : 'Where is it going?' }}</h1>
      <p class="eq-sub">
        {{
          step === 1
            ? 'Select everything leaving Admin together. Items show In transit until you mark them delivered.'
            : 'Name the event and the truck. The crew on shift confirms the gear when they find it.'
        }}
      </p>
      <div class="eqn__progress" aria-hidden="true">
        <span class="eqn__progress-bar eqn__progress-bar--on"></span>
        <span class="eqn__progress-bar" :class="{ 'eqn__progress-bar--on': step === 2 }"></span>
      </div>
    </header>

    <div v-if="!ready" class="eq-empty">Loading equipment…</div>

    <!-- ── Step 1: items ── -->
    <template v-else-if="step === 1">
      <div class="eqn__search">
        <Search :size="17" :stroke-width="1.9" />
        <input
          v-model="q"
          type="search"
          placeholder="Search tag or name…"
          autocomplete="off"
          enterkeyhint="search"
        />
        <button v-if="q" type="button" class="eqn__clear" aria-label="Clear search" @click="q = ''">
          <X :size="15" :stroke-width="2" />
        </button>
      </div>

      <div class="eqn__filters">
        <button
          type="button"
          class="eq-sug"
          :class="{ 'eq-sug--on': typeFilter === 'all' }"
          @click="typeFilter = 'all'"
        >
          All <span class="eq-sug__meta">{{ available.length }}</span>
        </button>
        <button
          v-for="t in activeTypes.filter((t) => availableByType[t.id])"
          :key="t.id"
          type="button"
          class="eq-sug"
          :class="{ 'eq-sug--on': typeFilter === t.id }"
          @click="typeFilter = typeFilter === t.id ? 'all' : t.id"
        >
          {{ t.name }} <span class="eq-sug__meta">{{ availableByType[t.id] }}</span>
        </button>
      </div>

      <div v-if="visible.length" class="eq-list">
        <button
          v-for="a in visible"
          :key="a.id"
          type="button"
          class="eqn__row"
          :class="{ 'eqn__row--on': selected.includes(a.id) }"
          :aria-pressed="selected.includes(a.id)"
          @click="toggle(a.id)"
        >
          <span class="eqn__box" aria-hidden="true">
            <Check v-if="selected.includes(a.id)" :size="15" :stroke-width="3" />
          </span>
          <span class="eqn__text">
            <span class="eqn__line">
              <span class="eq-tag">{{ a.tag }}</span>
              <span class="eqn__name">{{ a.name }}</span>
            </span>
            <span class="eqn__type">
              {{ typeName(a.typeId) }}<template v-if="a.notes"> · {{ a.notes }}</template>
            </span>
          </span>
        </button>
      </div>
      <div v-else class="eq-list eq-empty">
        {{ available.length ? 'Nothing on the shelf matches.' : 'Nothing is on the shelf right now.' }}
      </div>

      <div v-if="visibleOut.length" class="eqn__out">
        <button type="button" class="eqn__out-toggle" @click="showOut = !showOut">
          {{ showOut ? 'Hide' : 'Show' }} {{ pluralize(visibleOut.length, 'item') }} already out
        </button>
        <div v-if="showOut" class="eq-list eqn__out-list">
          <RouterLink
            v-for="a in visibleOut"
            :key="a.id"
            :to="`/equipment/item/${encodeURIComponent(a.tag)}`"
            class="eqn__row eqn__row--out"
          >
            <span class="eqn__text">
              <span class="eqn__line">
                <span class="eq-tag">{{ a.tag }}</span>
                <span class="eqn__name">{{ a.name }}</span>
              </span>
              <span class="eqn__type">{{ typeName(a.typeId) }}</span>
            </span>
            <EquipmentStatusChip :status="stateOf(a.id).status" :label="statusChip(stateOf(a.id))" />
          </RouterLink>
        </div>
      </div>

      <div class="eqn__bar">
        <div class="eqn__bar-inner">
          <span class="eqn__bar-count">
            <b>{{ selected.length }}</b> selected
          </span>
          <button
            type="button"
            class="eq-btn eq-btn--primary eq-btn--lg"
            :disabled="!selected.length"
            @click="goStep2"
          >
            Continue <ArrowRight :size="17" :stroke-width="2" />
          </button>
        </div>
      </div>
    </template>

    <!-- ── Step 2: destination ── -->
    <template v-else>
      <div class="eqn__picked">
        <div class="eq-label">
          <span>Taking {{ pluralize(selected.length, 'item') }}</span>
          <button type="button" class="eqn__change" @click="step = 1">Change</button>
        </div>
        <div class="eqn__picked-tags">
          <span v-for="id in selected" :key="id" class="eqn__picked-tag">
            <span class="eq-tag">{{ assetById[id]?.tag }}</span>
            {{ assetById[id]?.name }}
          </span>
        </div>
      </div>

      <form class="eqn__form" @submit.prevent="submit">
        <div class="eq-field">
          <label class="eq-label" for="eqn-purpose">
            <span>What is it for?</span>
            <span class="eq-label__req">Required</span>
          </label>
          <input
            id="eqn-purpose"
            v-model="purpose"
            class="eq-input"
            type="text"
            maxlength="120"
            placeholder="e.g. Waller County Fair"
            autocomplete="off"
            autocapitalize="words"
          />
          <div v-if="eventChips.length || purposeChips.length" class="eq-sugs">
            <button
              v-for="e in eventChips"
              :key="e.label + e.date"
              type="button"
              class="eq-sug"
              :class="{ 'eq-sug--on': eventPicked(e) }"
              @click="pickEvent(e)"
            >
              {{ e.label }}
              <span class="eq-sug__meta">
                {{ formatEventSpan(e.date, e.endDate) }}<template v-if="e.count > 1"> · {{ e.count }} dates</template>
              </span>
            </button>
            <button
              v-for="p in purposeChips"
              :key="p"
              type="button"
              class="eq-sug"
              :class="{ 'eq-sug--on': purpose === p }"
              @click="purpose = p"
            >
              {{ p }}
            </button>
          </div>
          <p v-if="eventChips.length" class="eq-hint">
            Upcoming events from the schedule — tap one to fill in its dates too.
          </p>
        </div>

        <div class="eq-field">
          <div class="eq-label">
            <span>Which truck?</span>
            <span class="eq-label__req">Required</span>
          </div>
          <div class="eqn__trucks" role="radiogroup" aria-label="Truck">
            <button
              v-for="t in activeTrucks"
              :key="t.id"
              type="button"
              role="radio"
              class="eqn__truck"
              :class="{ 'eqn__truck--on': destination === t.label, 'eqn__truck--name': !/^\d+$/.test(t.label) }"
              :aria-checked="destination === t.label"
              @click="destination = t.label"
            >
              {{ t.label }}
            </button>
            <button
              v-if="!addingTruck"
              type="button"
              class="eqn__truck eqn__truck--add"
              @click="addingTruck = true"
            >
              <Plus :size="14" :stroke-width="2.4" /> Add
            </button>
          </div>
          <div v-if="addingTruck" class="eqn__addtruck">
            <input
              v-model="newTruck"
              class="eq-input eq-input--mono"
              type="text"
              maxlength="40"
              placeholder="Truck number"
              autocomplete="off"
              @keydown.enter.prevent="addTruck"
            />
            <button type="button" class="eq-btn eq-btn--secondary" :disabled="!newTruck.trim()" @click="addTruck">
              Add truck
            </button>
            <button type="button" class="eq-btn eq-btn--quiet" @click="addingTruck = false">Cancel</button>
          </div>
          <p v-if="truckErr" class="eq-error">{{ truckErr }}</p>
          <p v-if="destination && !activeTrucks.some((t) => t.label === destination)" class="eq-hint">
            Going on {{ destination }}.
          </p>
        </div>

        <div class="eq-field">
          <label class="eqn__ext" :class="{ 'eqn__ext--on': extended }">
            <input v-model="extended" type="checkbox" class="sr-only" />
            <span class="eqn__ext-icon"><Repeat :size="17" :stroke-width="2" /></span>
            <span class="eqn__ext-text">
              <strong>Extended assignment</strong>
              <span>Multiple nights. Every crew checks the gear at the start and end of their shift.</span>
            </span>
            <span class="eqn__switch" aria-hidden="true"><span></span></span>
          </label>
        </div>

        <div class="eqn__dates" :class="{ 'eqn__dates--span': extended }">
          <div class="eq-field">
            <label class="eq-label" for="eqn-date">
              <span>{{ extended ? 'From' : 'Event date' }}</span>
              <span v-if="!extended" class="eq-label__aside">Optional</span>
            </label>
            <div class="eqn__date">
              <CalendarDays :size="17" :stroke-width="1.9" />
              <input id="eqn-date" v-model="eventDate" type="date" class="eqn__date-input" />
            </div>
          </div>
          <div v-if="extended" class="eq-field">
            <label class="eq-label" for="eqn-end"><span>Through</span></label>
            <div class="eqn__date">
              <CalendarDays :size="17" :stroke-width="1.9" />
              <input
                id="eqn-end"
                v-model="endDate"
                type="date"
                class="eqn__date-input"
                :min="eventDate || undefined"
              />
            </div>
          </div>
        </div>
        <p v-if="spanError" class="eq-error">{{ spanError }}</p>
        <p v-else-if="extended && eventDate" class="eq-hint eqn__span-hint">
          {{ formatEventSpan(eventDate, endDate || null) }} — crews see a start- and end-of-shift check
          on this check-out every shift.
        </p>

        <div class="eq-field">
          <label class="eq-label" for="eqn-note"><span>Note</span><span class="eq-label__aside">Optional</span></label>
          <textarea
            id="eqn-note"
            v-model="note"
            class="eq-textarea"
            rows="2"
            maxlength="500"
            placeholder="Anything the crew should know — which case, chargers, where it goes on the truck"
          ></textarea>
        </div>

        <p v-if="error" class="eq-error eqn__error">{{ error }}</p>

        <div class="eqn__bar">
          <div class="eqn__bar-inner">
            <button type="button" class="eq-btn eq-btn--quiet" @click="step = 1">
              <ArrowLeft :size="16" :stroke-width="2" /> Back
            </button>
            <button type="submit" class="eq-btn eq-btn--primary eq-btn--lg eqn__submit" :disabled="!canSubmit">
              {{ submitting ? 'Checking out…' : `Check out ${pluralize(selected.length, 'item')}` }}
            </button>
          </div>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.eqn {
  max-width: 720px;
}
.eqn__head {
  margin: 10px 0 20px;
}
.eqn__progress {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 16px;
  max-width: 220px;
}
.eqn__progress-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--color-line);
}
.eqn__progress-bar--on {
  background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent-400));
}

.eqn__search {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 14px;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 12px;
}
.eqn__search:focus-within {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqn__search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 16px;
  color: var(--color-ink);
}
.eqn__clear {
  display: inline-flex;
  padding: 6px;
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
}
.eqn__filters {
  display: flex;
  gap: 6px;
  margin: 10px 0 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.eqn__filters::-webkit-scrollbar {
  display: none;
}
.eqn__filters .eq-sug {
  flex-shrink: 0;
}

.eqn__row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 62px;
  padding: 10px 14px;
  text-align: left;
  font-family: var(--font-sans);
  color: inherit;
  text-decoration: none;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.eqn__row:last-child {
  border-bottom: none;
}
.eqn__row:hover {
  background: var(--color-surface-soft);
}
.eqn__row--on {
  background: var(--color-brand-50);
}
.eqn__row--on:hover {
  background: var(--color-brand-50);
}
.eqn__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid var(--color-line);
  background: var(--color-surface);
  color: white;
  transition:
    background 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.eqn__row--on .eqn__box {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
}
.eqn__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.eqn__line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqn__name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqn__type {
  font-size: 12.5px;
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqn__row--out {
  cursor: pointer;
  opacity: 0.85;
}

.eqn__out {
  margin-top: 16px;
}
.eqn__out-toggle {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  padding: 6px 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.eqn__out-list {
  margin-top: 8px;
}

/* Sticky action bar (sits above the quick-links pill, like Skills Day) */
.eqn__bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: oklch(1 0 0 / 0.94);
  border-top: 1px solid var(--color-line);
  box-shadow: 0 -8px 24px oklch(0.2 0.03 260 / 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.eqn__bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 720px;
  margin: 0 auto;
}
.eqn__bar-count {
  font-size: 14px;
  color: var(--color-ink-soft);
}
.eqn__bar-count b {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 26px;
  color: var(--color-ink);
  margin-right: 3px;
  font-variant-numeric: tabular-nums;
}
.eqn__submit {
  flex: 1;
  max-width: 360px;
}

/* Step 2 */
.eqn__picked {
  padding: 14px 16px;
  margin-bottom: 22px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}
.eqn__change {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-brand-600);
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
}
.eqn__picked-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 10px;
}
.eqn__picked-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.eqn__form {
  display: flex;
  flex-direction: column;
}
.eqn__form .eq-field + .eq-field,
.eqn__form .eq-field + .eqn__dates,
.eqn__dates + .eq-field {
  margin-top: 22px;
}

/* Truck picker */
.eqn__trucks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
}
.eqn__truck {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 48px;
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
  cursor: pointer;
  transition:
    border-color 130ms var(--ease-out),
    background 130ms var(--ease-out),
    color 130ms var(--ease-out),
    box-shadow 130ms var(--ease-out);
}
.eqn__truck:hover {
  border-color: var(--color-accent-600);
}
.eqn__truck--name {
  grid-column: span 2;
  font-family: var(--font-sans);
  font-size: 14px;
  letter-spacing: 0;
}
.eqn__truck--on {
  color: white;
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.35);
}
.eqn__truck--add {
  font-family: var(--font-sans);
  font-size: 13px;
  letter-spacing: 0;
  color: var(--color-brand-600);
  border-style: dashed;
}
.eqn__addtruck {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.eqn__addtruck .eq-input {
  flex: 1 1 160px;
}

/* Extended switch */
.eqn__ext {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 14px;
  cursor: pointer;
  transition:
    border-color 150ms var(--ease-out),
    background 150ms var(--ease-out);
}
.eqn__ext--on {
  border-color: var(--color-brand-600);
  background:
    radial-gradient(ellipse 70% 90% at 100% 0%, oklch(0.734 0.114 86.8 / 0.1), transparent 70%),
    var(--color-surface);
}
.eqn__ext:focus-within {
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqn__ext-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: var(--color-brand-600);
  background: var(--color-brand-50);
}
.eqn__ext--on .eqn__ext-icon {
  color: var(--color-accent-on-dark);
  background: var(--color-brand-800);
}
.eqn__ext-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--color-muted);
}
.eqn__ext-text strong {
  font-size: 14.5px;
  color: var(--color-ink);
}
.eqn__switch {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: var(--color-line);
  transition: background 150ms var(--ease-out);
}
.eqn__switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: white;
  box-shadow: var(--shadow-sm);
  transition: transform 150ms var(--ease-out);
}
.eqn__ext--on .eqn__switch {
  background: var(--color-brand-600);
}
.eqn__ext--on .eqn__switch span {
  transform: translateX(18px);
}

.eqn__dates {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
}
.eqn__dates--span {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.eqn__dates .eq-field + .eq-field {
  margin-top: 0;
}
.eqn__span-hint {
  margin-top: 8px;
}
.eqn__form > p + .eq-field {
  margin-top: 22px;
}
/* Side-by-side From/Through on a phone: drop the leading icon so the
   date itself fits (the native picker keeps its own). */
@media (max-width: 479px) {
  .eqn__dates--span .eqn__date > svg {
    display: none;
  }
  .eqn__dates--span .eqn__date {
    padding: 0 10px;
  }
}
.eqn__date {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 13px;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
}
.eqn__date:focus-within {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqn__date-input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 16px;
  color: var(--color-ink);
}
.eqn__error {
  margin-top: 18px;
}
</style>
