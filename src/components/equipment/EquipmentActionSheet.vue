<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Check, X, UserRound, Camera } from 'lucide-vue-next'
import EquipmentSheet from './EquipmentSheet.vue'
import EquipmentPhotoField from './EquipmentPhotoField.vue'
import EquipmentPersonPicker from './EquipmentPersonPicker.vue'
import { useEquipment } from '@/composables/useEquipment'
import {
  ACTION_RULES,
  HOME_LOCATION,
  eligibleFor,
  pluralize,
  type PickedPerson,
} from '@/lib/equipment'
import type { EquipmentActionKind, EquipmentCheckout, EquipmentEventKind } from '@/types'

/**
 * One form for every custody step on a check-out. Items eligible for
 * the step are pre-selected; evidence follows the step's rule (photo,
 * or photo-unless-handed-to-someone). The on-shift confirmation flips
 * the list around: every item starts as "here" and a tap marks it not
 * found (anything already reported missing starts as not found).
 */
const props = defineProps<{
  open: boolean
  kind: EquipmentActionKind | null
  checkout: EquipmentCheckout
  itemKinds: Record<string, EquipmentEventKind>
}>()
const emit = defineEmits<{ close: []; done: [message: string] }>()

const { assetById, typeName, people, loadPeople, recordAction } = useEquipment()

const selected = ref<string[]>([])
const notFound = ref<string[]>([])
const mode = ref<'person' | 'photo'>('person')
const person = ref<PickedPerson | null>(null)
const photo = ref<Blob | null>(null)
const note = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

const rule = computed(() => (props.kind ? ACTION_RULES[props.kind] : null))
const isConfirm = computed(() => props.kind === 'confirmed_present')
const eligible = computed(() =>
  props.kind ? eligibleFor(props.kind, props.itemKinds, props.checkout.assetIds) : [],
)

watch(
  () => [props.open, props.kind] as const,
  ([open]) => {
    if (!open) return
    if (isConfirm.value) {
      notFound.value = eligible.value.filter((id) => props.itemKinds[id] === 'reported_missing')
      selected.value = eligible.value.filter((id) => !notFound.value.includes(id))
    } else {
      /* Don't pre-assert items the crew reported missing (or that were
         written off); they can still be ticked if they turned up. */
      notFound.value = []
      const present = eligible.value.filter(
        (id) => props.itemKinds[id] !== 'reported_missing' && props.itemKinds[id] !== 'written_off',
      )
      selected.value = present.length ? present : [...eligible.value]
    }
    mode.value = 'person'
    person.value = null
    photo.value = null
    note.value = ''
    error.value = null
    submitting.value = false
    if (rule.value?.evidence === 'photo-or-person') void loadPeople()
  },
  { immediate: true },
)

function isHere(id: string) {
  return selected.value.includes(id)
}

function toggle(id: string) {
  if (isConfirm.value) {
    if (notFound.value.includes(id)) {
      notFound.value = notFound.value.filter((x) => x !== id)
      selected.value = [...selected.value, id]
    } else {
      selected.value = selected.value.filter((x) => x !== id)
      notFound.value = [...notFound.value, id]
    }
    return
  }
  selected.value = isHere(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]
}

const allSelected = computed(() => selected.value.length === eligible.value.length)
function toggleAll() {
  selected.value = allSelected.value ? [] : [...eligible.value]
}

const itemCount = computed(() => selected.value.length + notFound.value.length)
const needsNote = computed(
  () => (isConfirm.value && notFound.value.length > 0) || props.kind === 'written_off',
)

const evidenceOk = computed(() => {
  if (!rule.value) return false
  if (rule.value.evidence === 'photo') return !!photo.value
  if (rule.value.evidence === 'photo-or-person')
    return mode.value === 'person' ? !!person.value : !!photo.value
  return true
})

const blocker = computed<string | null>(() => {
  if (itemCount.value === 0) return 'Select at least one item.'
  if (!evidenceOk.value) {
    if (rule.value?.evidence === 'photo-or-person' && mode.value === 'person')
      return 'Pick who you handed it to — or switch to a photo.'
    return 'Add a photo of where the items were left.'
  }
  if (needsNote.value && !note.value.trim())
    return props.kind === 'written_off'
      ? 'Add a note: what happened, and who was notified.'
      : 'Add a note about what’s missing.'
  return null
})

const title = computed(() => {
  const unit = props.checkout.destination
  switch (props.kind) {
    case 'delivered':
      return `Deliver to ${unit}`
    case 'canceled':
      return 'Cancel check-out'
    case 'confirmed_present':
      return 'Is everything here?'
    case 'event_closed':
      return 'Close out the event'
    case 'picked_up':
      return `Pick up from ${unit}`
    case 'returned':
      return `Drop off at ${HOME_LOCATION}`
    case 'written_off':
      return 'Write off as lost'
    default:
      return ''
  }
})

const intro = computed(() => {
  switch (props.kind) {
    case 'delivered':
      return 'Hand the gear to someone on the crew, or leave it and take a photo of where.'
    case 'canceled':
      return 'Puts these items back on the shelf — for gear that never actually left.'
    case 'confirmed_present':
      return 'Tap anything you can’t find. Your name goes on the record as confirming the rest.'
    case 'event_closed':
      return 'Take a photo of where the equipment is being left so the pickup finds it fast.'
    case 'picked_up':
      return 'Select what you’re taking off the unit. Anything left behind stays on the board.'
    case 'returned':
      return `Hand it to someone at ${HOME_LOCATION}, or leave it and take a photo of where.`
    case 'written_off':
      return `For gear that isn’t coming back. It stops holding this check-out open and shows as Lost; if it turns up, drop it off at ${HOME_LOCATION} from here.`
    default:
      return ''
  }
})

const photoHint = computed(() => {
  switch (props.kind) {
    case 'delivered':
      return 'Where you left it — the cabinet, the cab, the stretcher.'
    case 'event_closed':
      return 'Show where it’s sitting for pickup.'
    case 'returned':
      return `Where you left it at ${HOME_LOCATION}.`
    default:
      return ''
  }
})

const notePlaceholder = computed(() => {
  switch (props.kind) {
    case 'delivered':
      return 'e.g. Radios in the grey Pelican case, iPad in the cab'
    case 'canceled':
      return 'Why? (optional)'
    case 'confirmed_present':
      return needsNote.value ? 'What’s missing, and where did you look?' : 'Anything off? Damage, missing chargers… (optional)'
    case 'event_closed':
      return 'e.g. Left in the jump-seat cabinet (optional)'
    case 'written_off':
      return 'What happened, and who was notified?'
    default:
      return 'Optional'
  }
})

const submitLabel = computed(() => {
  const n = selected.value.length
  switch (props.kind) {
    case 'delivered':
      return `Mark ${pluralize(n, 'item')} delivered`
    case 'canceled':
      return `Put ${pluralize(n, 'item')} back on the shelf`
    case 'confirmed_present':
      if (!notFound.value.length) return `Confirm ${pluralize(n, 'item')} here`
      if (!n) return `Report ${pluralize(notFound.value.length, 'item')} not found`
      return `Confirm ${n} here · ${notFound.value.length} not found`
    case 'event_closed':
      return 'Close out the event'
    case 'picked_up':
      return `Pick up ${pluralize(n, 'item')}`
    case 'returned':
      return `Drop off ${pluralize(n, 'item')}`
    case 'written_off':
      return `Write off ${pluralize(n, 'item')}`
    default:
      return 'Save'
  }
})

function doneMessage(): string {
  const n = selected.value.length
  switch (props.kind) {
    case 'delivered':
      return `Delivered to ${props.checkout.destination} · ${pluralize(n, 'item')}`
    case 'canceled':
      return 'Back on the shelf'
    case 'confirmed_present':
      return notFound.value.length
        ? `Recorded · ${n} here, ${notFound.value.length} not found`
        : `Confirmed · ${pluralize(n, 'item')} here`
    case 'event_closed':
      return 'Event closed out — ready for pickup'
    case 'picked_up':
      return `Picked up · ${pluralize(n, 'item')} headed to ${HOME_LOCATION}`
    case 'returned':
      return `Back at ${HOME_LOCATION} · ${pluralize(n, 'item')}`
    case 'written_off':
      return `Written off as lost · ${pluralize(n, 'item')}`
    default:
      return 'Saved'
  }
}

async function submit() {
  if (!props.kind || blocker.value || submitting.value) return
  submitting.value = true
  error.value = null
  const handed = rule.value?.evidence === 'photo-or-person' && mode.value === 'person'
  const res = await recordAction({
    checkoutId: props.checkout.id,
    kind: props.kind,
    assetIds: selected.value,
    missingIds: isConfirm.value ? notFound.value : [],
    note: note.value,
    photo: handed ? null : photo.value,
    handedToId: handed ? (person.value?.id ?? null) : null,
    handedToName: handed ? (person.value?.name ?? null) : null,
  })
  submitting.value = false
  if (!res.ok) {
    error.value = res.error
    return
  }
  emit('done', doneMessage())
}
</script>

<template>
  <EquipmentSheet
    :open="open && !!kind"
    :title="title"
    :eyebrow="`${checkout.purpose} · ${checkout.destination}`"
    @close="emit('close')"
  >
    <p class="eqa__intro">{{ intro }}</p>

    <!-- Items -->
    <div class="eq-field">
      <div class="eq-label">
        <span>{{ isConfirm ? 'Tap anything that isn’t here' : 'Items' }}</span>
        <button
          v-if="!isConfirm && eligible.length > 1"
          type="button"
          class="eqa__all"
          @click="toggleAll"
        >
          {{ allSelected ? 'Clear all' : 'Select all' }}
        </button>
      </div>
      <div class="eq-list">
        <button
          v-for="id in eligible"
          :key="id"
          type="button"
          class="eqa__row"
          :class="{
            'eqa__row--on': isHere(id),
            'eqa__row--missing': notFound.includes(id),
          }"
          :aria-pressed="isHere(id)"
          @click="toggle(id)"
        >
          <span class="eqa__box" aria-hidden="true">
            <Check v-if="isHere(id)" :size="15" :stroke-width="3" />
            <X v-else-if="notFound.includes(id)" :size="15" :stroke-width="3" />
          </span>
          <span class="eqa__text">
            <span class="eqa__line">
              <span class="eq-tag">{{ assetById[id]?.tag }}</span>
              <span class="eqa__name">{{ assetById[id]?.name }}</span>
            </span>
            <span class="eqa__type">{{ typeName(assetById[id]?.typeId ?? null) }}</span>
          </span>
          <span v-if="notFound.includes(id)" class="eqa__nf">Not found</span>
          <span
            v-else-if="!isConfirm && itemKinds[id] === 'reported_missing'"
            class="eqa__nf eqa__nf--soft"
          >
            Reported missing
          </span>
          <span
            v-else-if="!isConfirm && itemKinds[id] === 'written_off'"
            class="eqa__nf eqa__nf--soft"
          >
            Written off
          </span>
        </button>
      </div>
    </div>

    <!-- Evidence -->
    <div v-if="rule?.evidence === 'photo-or-person'" class="eq-field">
      <div class="eq-label">
        <span>{{ kind === 'returned' ? `At ${HOME_LOCATION}` : 'On the unit' }}</span>
        <span class="eq-label__req">Required</span>
      </div>
      <div class="eq-seg" role="radiogroup">
        <button
          type="button"
          class="eq-seg__opt"
          :class="{ 'eq-seg__opt--on': mode === 'person' }"
          role="radio"
          :aria-checked="mode === 'person'"
          @click="mode = 'person'"
        >
          <UserRound :size="15" :stroke-width="2" /> Handed to someone
        </button>
        <button
          type="button"
          class="eq-seg__opt"
          :class="{ 'eq-seg__opt--on': mode === 'photo' }"
          role="radio"
          :aria-checked="mode === 'photo'"
          @click="mode = 'photo'"
        >
          <Camera :size="15" :stroke-width="2" /> Left it — photo
        </button>
      </div>
      <EquipmentPersonPicker
        v-if="mode === 'person'"
        v-model="person"
        :people="people"
        allow-free-text
        :placeholder="kind === 'returned' ? 'Who took it at Admin?' : 'Who took it?'"
      />
      <EquipmentPhotoField v-else v-model="photo" :hint="photoHint" />
    </div>

    <EquipmentPhotoField
      v-else-if="rule?.evidence === 'photo'"
      v-model="photo"
      class="eq-field"
      label="Where it’s being left"
      :hint="photoHint"
      required
    />

    <!-- Note -->
    <label class="eq-field">
      <span class="eq-label">
        <span>Note</span>
        <span v-if="needsNote" class="eq-label__req">Required</span>
      </span>
      <textarea
        v-model="note"
        class="eq-textarea"
        rows="2"
        maxlength="500"
        :placeholder="notePlaceholder"
      ></textarea>
    </label>

    <template #footer>
      <p v-if="error" class="eq-error eqa__error">{{ error }}</p>
      <button
        type="button"
        class="eq-btn eq-btn--primary eq-btn--lg eq-btn--block"
        :class="{ 'eqa__submit--danger': kind === 'canceled' || kind === 'written_off' }"
        :disabled="!!blocker || submitting"
        @click="submit"
      >
        {{ submitting ? 'Saving…' : submitLabel }}
      </button>
      <p v-if="blocker && !error" class="eqa__blocker">{{ blocker }}</p>
    </template>
  </EquipmentSheet>
</template>

<style scoped>
.eqa__intro {
  margin: 0 0 18px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.eqa__all {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-brand-600);
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
}
.eqa__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  text-align: left;
  font-family: var(--font-sans);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.eqa__row:last-child {
  border-bottom: none;
}
.eqa__row:hover {
  background: var(--color-surface-soft);
}
.eqa__box {
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
.eqa__row--on .eqa__box {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
}
.eqa__row--missing .eqa__box {
  background: oklch(0.55 0.19 25);
  border-color: oklch(0.55 0.19 25);
}
.eqa__row--missing {
  background: oklch(0.985 0.012 25);
}
.eqa__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.eqa__line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eqa__name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqa__row:not(.eqa__row--on):not(.eqa__row--missing) .eqa__name {
  color: var(--color-muted);
}
.eqa__row--missing .eqa__name {
  text-decoration: line-through;
  text-decoration-color: oklch(0.55 0.19 25 / 0.6);
}
.eqa__type {
  font-size: 12px;
  color: var(--color-muted);
}
.eqa__nf {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: oklch(0.5 0.19 25);
}
.eqa__nf--soft {
  font-size: 10px;
  opacity: 0.85;
}
.eqa__error {
  margin-bottom: 10px;
}
.eqa__blocker {
  margin-top: 8px;
  text-align: center;
  font-size: 12.5px;
  color: var(--color-muted);
}
.eqa__submit--danger:not(:disabled) {
  background: oklch(0.5 0.17 25);
}
.eqa__submit--danger:hover:not(:disabled) {
  background: oklch(0.45 0.17 25);
}
</style>
