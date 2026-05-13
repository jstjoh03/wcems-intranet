<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { X } from 'lucide-vue-next'

/**
 * Lightweight chip-style tag input.
 *
 *  - Type → press Enter or Comma to commit a tag
 *  - Backspace in empty input removes the last chip
 *  - Click ✕ on a chip to remove
 *  - Optional `suggestions` prop (existing tag values) drops them into a
 *    <datalist> so typing autocompletes from prior choices.
 *  - Stripped of empties and de-duped automatically.
 *
 * Stores values as a plain string[] via v-model. Caller decides how to
 * persist them — this primitive doesn't know about Supabase, etc.
 */

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    suggestions?: string[]
    placeholder?: string
    maxTags?: number
  }>(),
  {
    suggestions: () => [],
    placeholder: 'Type a tag, press Enter…',
    maxTags: 20,
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const datalistId = `taginput-${Math.random().toString(36).slice(2, 9)}`

const remaining = computed(() => Math.max(0, props.maxTags - props.modelValue.length))

function commit() {
  const raw = draft.value.trim().replace(/^,+|,+$/g, '').trim()
  if (!raw) {
    draft.value = ''
    return
  }
  /* Accept comma-separated paste in a single keystroke — split, clean,
     filter dupes against the existing list, then push the survivors. */
  const candidates = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const existing = new Set(props.modelValue.map((t) => t.toLowerCase()))
  const next = [...props.modelValue]
  for (const c of candidates) {
    if (next.length >= props.maxTags) break
    if (existing.has(c.toLowerCase())) continue
    next.push(c)
    existing.add(c.toLowerCase())
  }
  emit('update:modelValue', next)
  draft.value = ''
}

function remove(idx: number) {
  const next = props.modelValue.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
  void nextTick(() => inputEl.value?.focus())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commit()
    return
  }
  if (e.key === 'Backspace' && draft.value === '' && props.modelValue.length > 0) {
    e.preventDefault()
    remove(props.modelValue.length - 1)
    return
  }
}

function onBlur() {
  /* Auto-commit on blur so a half-typed tag isn't silently lost. */
  if (draft.value.trim()) commit()
}
</script>

<template>
  <div class="taginput" @click="inputEl?.focus()">
    <span v-for="(t, i) in modelValue" :key="`${t}-${i}`" class="taginput__chip">
      {{ t }}
      <button
        type="button"
        class="taginput__chip-remove"
        :aria-label="`Remove tag ${t}`"
        @click.stop="remove(i)"
      >
        <X :size="11" :stroke-width="2.25" />
      </button>
    </span>
    <input
      ref="inputEl"
      v-model="draft"
      type="text"
      class="taginput__field"
      :placeholder="modelValue.length === 0 ? placeholder : ''"
      :list="suggestions.length ? datalistId : undefined"
      :disabled="remaining === 0"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <datalist v-if="suggestions.length" :id="datalistId">
      <option v-for="s in suggestions" :key="s" :value="s" />
    </datalist>
  </div>
</template>

<style scoped>
.taginput {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 6px 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  cursor: text;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.taginput:focus-within {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}

.taginput__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-brand-600);
  color: white;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 4px 3px 10px;
  border-radius: 999px;
  line-height: 1.2;
}
.taginput__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: oklch(1 0 0 / 0.85);
  cursor: pointer;
  padding: 2px;
  border-radius: 999px;
  transition: background 120ms var(--ease-out);
}
.taginput__chip-remove:hover {
  background: oklch(0 0 0 / 0.2);
  color: white;
}

.taginput__field {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
  padding: 3px 2px;
}
.taginput__field::placeholder {
  color: var(--color-muted);
}
</style>
