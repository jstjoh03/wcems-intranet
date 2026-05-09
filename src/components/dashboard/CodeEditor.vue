<script setup lang="ts">
import { ref, watch } from 'vue'
import { Check, X } from 'lucide-vue-next'

const props = defineProps<{
  initialValue: string | null
  label?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  save: [newValue: string]
  cancel: []
}>()

const value = ref(props.initialValue ?? '')

watch(
  () => props.initialValue,
  (v) => (value.value = v ?? ''),
)

function save() {
  const trimmed = value.value.trim()
  if (!trimmed) return
  if (trimmed === (props.initialValue ?? '')) {
    emit('cancel')
    return
  }
  emit('save', trimmed)
}
</script>

<template>
  <form class="code-editor" @submit.prevent="save">
    <label v-if="label" class="code-editor__label">{{ label }}</label>
    <div class="code-editor__row">
      <input
        v-model="value"
        type="text"
        class="code-editor__input"
        :placeholder="placeholder ?? 'New code'"
        autofocus
        autocomplete="off"
        spellcheck="false"
      />
      <button
        type="submit"
        class="code-editor__btn code-editor__btn--save"
        aria-label="Save code"
      >
        <Check :size="14" :stroke-width="2.2" />
      </button>
      <button
        type="button"
        class="code-editor__btn code-editor__btn--cancel"
        aria-label="Cancel"
        @click="$emit('cancel')"
      >
        <X :size="14" :stroke-width="2.2" />
      </button>
    </div>
  </form>
</template>

<style scoped>
.code-editor {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 280px;
}
.code-editor__label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.code-editor__row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.code-editor__input {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  outline: none;
  min-width: 0;
}
.code-editor__input:focus {
  border-color: var(--color-brand-500);
  box-shadow: 0 0 0 2px var(--color-brand-100);
}
.code-editor__btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  cursor: pointer;
  transition: all 120ms var(--ease-out);
  flex-shrink: 0;
}
.code-editor__btn--save {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.code-editor__btn--save:hover {
  background: var(--color-brand-700);
}
.code-editor__btn--cancel {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.code-editor__btn--cancel:hover {
  color: var(--color-ink);
}
</style>
