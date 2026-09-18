<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Search, Check, X, CalendarDays } from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import { useEquipment } from '@/composables/useEquipment'
import type { EquipmentSuggestions } from '@/lib/equipmentBackend'
import {
  formatEventDate,
  itemMatches,
  pluralize,
  statusChip,
  todayCentral,
} from '@/lib/equipment'

/**
 * /equipment/checkout/new — handlers only (route guard + RPC). Two
 * steps sized for a phone in a parking lot: pick the items, then say
 * what they're for and which unit they're going to. Lands on the new
 * check-out, where "Mark delivered" is the next action.
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
const unitChips = computed(() => (sugs.value?.units ?? []).slice(0, 12))

function pickEvent(e: { label: string; date: string }) {
  purpose.value = e.label
  eventDate.value = e.date
}

const submitting = ref(false)
const error = ref<string | null>(null)
const canSubmit = computed(
  () =>
    selected.value.length > 0 &&
    purpose.value.trim().length > 0 &&
    destination.value.trim().length > 0 &&
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
            : 'Name the event and the unit. The on-shift crew confirms it when they find it on the truck.'
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
            placeholder="e.g. Royal HS Football"
            autocomplete="off"
            autocapitalize="words"
          />
          <div v-if="eventChips.length || purposeChips.length" class="eq-sugs">
            <button
              v-for="e in eventChips"
              :key="e.label + e.date"
              type="button"
              class="eq-sug"
              :class="{ 'eq-sug--on': purpose === e.label && eventDate === e.date }"
              @click="pickEvent(e)"
            >
              {{ e.label }} <span class="eq-sug__meta">{{ formatEventDate(e.date) }}</span>
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
          <p v-if="eventChips.length" class="eq-hint">Upcoming events from the schedule — tap one to fill the date too.</p>
        </div>

        <div class="eq-field">
          <label class="eq-label" for="eqn-unit">
            <span>Which unit?</span>
            <span class="eq-label__req">Required</span>
          </label>
          <input
            id="eqn-unit"
            v-model="destination"
            class="eq-input"
            type="text"
            maxlength="40"
            placeholder="e.g. M272"
            autocomplete="off"
            autocapitalize="characters"
          />
          <div v-if="unitChips.length" class="eq-sugs">
            <button
              v-for="u in unitChips"
              :key="u"
              type="button"
              class="eq-sug"
              :class="{ 'eq-sug--on': destination.toLowerCase() === u.toLowerCase() }"
              @click="destination = u"
            >
              {{ u }}
            </button>
          </div>
        </div>

        <div class="eq-field">
          <label class="eq-label" for="eqn-date">
            <span>Event date</span>
            <span class="eq-label__aside">{{ eventDate ? formatEventDate(eventDate) : 'Optional' }}</span>
          </label>
          <div class="eqn__date">
            <CalendarDays :size="17" :stroke-width="1.9" />
            <input id="eqn-date" v-model="eventDate" type="date" class="eqn__date-input" />
          </div>
        </div>

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
.eqn__form .eq-field + .eq-field {
  margin-top: 22px;
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
