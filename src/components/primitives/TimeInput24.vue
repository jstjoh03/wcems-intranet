<script setup lang="ts">
/**
 * Exact-minute 24-hour time field (HH:MM) — for clinical documentation
 * where the quarter-hour TimeSelect24 would lose precision (delivery
 * times, APGAR marks). Native `<input type="time">` renders AM/PM in
 * the OS locale; all times in this portal are 24-hour (Justin).
 *
 * Typing is digits-only with the colon auto-inserted; blur clamps to a
 * valid 00:00–23:59 or clears.
 */

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const digits = el.value.replace(/\D/g, '').slice(0, 4)
  const v = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
  el.value = v
  emit('update:modelValue', v)
}

function onBlur(e: Event) {
  const el = e.target as HTMLInputElement
  const m = /^(\d{1,2}):?(\d{2})$/.exec(el.value)
  if (!m) {
    if (el.value) {
      el.value = ''
      emit('update:modelValue', '')
    }
    return
  }
  const h = Math.min(23, Number(m[1]))
  const min = Math.min(59, Number(m[2]))
  const v = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  el.value = v
  emit('update:modelValue', v)
}
</script>

<template>
  <input
    :value="modelValue"
    type="text"
    inputmode="numeric"
    placeholder="HH:MM"
    maxlength="5"
    autocomplete="off"
    @input="onInput"
    @blur="onBlur"
  />
</template>
