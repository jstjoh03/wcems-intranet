<script setup lang="ts">
import { ref, computed } from 'vue'
import { UserRound, Search } from 'lucide-vue-next'
import type { EquipmentPerson } from '@/lib/equipmentBackend'
import type { PickedPerson } from '@/lib/equipment'

/**
 * Type-to-search roster picker. Allows a free-typed name for someone
 * who isn't on the portal roster (a contract crew, a front-desk clerk).
 * Emits { id, name } — id is null for a free-typed name.
 */
const props = defineProps<{
  modelValue: PickedPerson | null
  people: EquipmentPerson[]
  placeholder?: string
  allowFreeText?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: PickedPerson | null] }>()

const q = ref('')

const matches = computed(() => {
  const terms = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return props.people
    .filter((p) => {
      const words = p.fullName.toLowerCase().split(/\s+/)
      return terms.every((t) => words.some((w) => w.startsWith(t)))
    })
    .slice(0, 6)
})

function choose(p: EquipmentPerson) {
  emit('update:modelValue', { id: p.id, name: p.fullName })
  q.value = ''
}

function chooseFree() {
  const name = q.value.trim()
  if (!name) return
  emit('update:modelValue', { id: null, name })
  q.value = ''
}
</script>

<template>
  <div class="eqpp">
    <div v-if="modelValue" class="eqpp__chosen">
      <span class="eqpp__avatar"><UserRound :size="16" :stroke-width="2" /></span>
      <span class="eqpp__chosen-name">{{ modelValue.name }}</span>
      <span v-if="!modelValue.id" class="eqpp__tag">Not on roster</span>
      <button type="button" class="eqpp__change" @click="emit('update:modelValue', null)">
        Change
      </button>
    </div>

    <template v-else>
      <div class="eqpp__search">
        <Search :size="16" :stroke-width="2" />
        <input
          v-model="q"
          type="search"
          class="eqpp__input"
          :placeholder="placeholder ?? 'Search a name…'"
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="done"
          @keydown.enter.prevent="matches.length ? choose(matches[0]) : allowFreeText && chooseFree()"
        />
      </div>
      <div v-if="q.trim()" class="eqpp__list">
        <button
          v-for="p in matches"
          :key="p.id"
          type="button"
          class="eqpp__opt"
          @click="choose(p)"
        >
          <span class="eqpp__opt-name">{{ p.fullName }}</span>
          <span v-if="p.title" class="eqpp__opt-title">{{ p.title }}</span>
        </button>
        <button
          v-if="allowFreeText && q.trim().length >= 2"
          type="button"
          class="eqpp__opt eqpp__opt--free"
          @click="chooseFree"
        >
          Use “{{ q.trim() }}” — not on the roster
        </button>
        <div v-if="!matches.length && !allowFreeText" class="eqpp__none">No one by that name.</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.eqpp__search {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 13px;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
  transition:
    border-color 140ms var(--ease-out),
    box-shadow 140ms var(--ease-out);
}
.eqpp__search:focus-within {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqpp__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 16px;
  color: var(--color-ink);
}
.eqpp__list {
  margin-top: 6px;
  padding: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}
.eqpp__opt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  text-align: left;
  font-family: var(--font-sans);
  background: none;
  border: none;
  border-radius: 9px;
  cursor: pointer;
}
.eqpp__opt:hover {
  background: var(--color-surface-soft);
}
.eqpp__opt-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.eqpp__opt-title {
  font-size: 12px;
  color: var(--color-muted);
}
.eqpp__opt--free {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  border-top: 1px solid var(--color-line-soft);
  border-radius: 0 0 9px 9px;
}
.eqpp__none {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-muted);
}
.eqpp__chosen {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 6px 6px 6px 8px;
  background: var(--color-surface);
  border: 1.5px solid var(--color-brand-200);
  border-radius: 12px;
}
.eqpp__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 999px;
  color: var(--color-accent-on-dark);
  background: var(--color-brand-900);
}
.eqpp__chosen-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqpp__tag {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
  white-space: nowrap;
}
.eqpp__change {
  min-height: 40px;
  padding: 0 12px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: var(--color-brand-50);
  border: none;
  border-radius: 9px;
  cursor: pointer;
}
</style>
