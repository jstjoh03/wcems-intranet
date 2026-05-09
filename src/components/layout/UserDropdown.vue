<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { ChevronDown, LogOut, Eye, EyeOff, Copy, Check, Pencil } from 'lucide-vue-next'
import { useCodeReveal } from '@/composables/useCodeReveal'

const auth = useAuthStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const copied = ref(false)

const fuel = useCodeReveal()

const editingStation = ref(false)
const stationDraft = ref('')
const stationInput = ref<HTMLInputElement | null>(null)
const stationError = ref<string | null>(null)
const savingStation = ref(false)

const initials = computed(() => auth.appUser?.initials ?? '?')
const firstName = computed(() => auth.appUser?.firstName ?? '')
const role = computed(() => auth.appUser?.role ?? 'crew')
const fullName = computed(() => auth.appUser?.fullName ?? '')
const fuelNumber = computed(() => auth.appUser?.fuelNumber ?? null)
const shift = computed(() => auth.appUser?.shift ?? null)
const station = computed(() => auth.appUser?.station ?? null)

function close() {
  open.value = false
  fuel.hide()
  cancelEditStation()
}

function toggle() {
  open.value = !open.value
  if (!open.value) {
    fuel.hide()
    cancelEditStation()
  }
}

async function startEditStation() {
  stationDraft.value = station.value ?? ''
  stationError.value = null
  editingStation.value = true
  await nextTick()
  stationInput.value?.focus()
  stationInput.value?.select()
}

function cancelEditStation() {
  editingStation.value = false
  stationDraft.value = ''
  stationError.value = null
}

async function saveStation() {
  if (savingStation.value) return
  const trimmed = stationDraft.value.trim()
  const current = station.value ?? ''
  if (trimmed === current) {
    cancelEditStation()
    return
  }
  savingStation.value = true
  stationError.value = null
  try {
    await auth.updateOwnStation(trimmed || null)
    editingStation.value = false
    stationDraft.value = ''
  } catch (err) {
    stationError.value = (err as Error).message
  } finally {
    savingStation.value = false
  }
}

function onClickOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close()
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside)
  document.removeEventListener('keydown', onEsc)
})

async function copyFuel() {
  if (!fuelNumber.value) return
  try {
    await navigator.clipboard.writeText(fuelNumber.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard blocked — silently no-op */
  }
}

function signOut() {
  auth.signOut()
  close()
}
</script>

<template>
  <div ref="root" class="user-dropdown">
    <button
      class="user-dropdown__trigger"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span class="user-dropdown__avatar display">{{ initials }}</span>
      <span class="user-dropdown__meta hidden sm:flex">
        <span class="user-dropdown__name">{{ firstName }}</span>
        <span class="user-dropdown__role">{{ role }}</span>
      </span>
      <ChevronDown :size="13" class="user-dropdown__chev" />
    </button>

    <Transition name="user-dropdown-fade">
      <div v-if="open" class="user-dropdown__panel" role="menu">
        <header class="user-dropdown__header">
          <div class="user-dropdown__avatar user-dropdown__avatar--lg display">{{ initials }}</div>
          <div class="min-w-0 flex-1">
            <div class="display text-[16px] truncate" style="color: var(--color-ink)">
              {{ fullName }}
            </div>
            <div
              class="font-mono text-[10.5px] uppercase tracking-wider"
              style="color: var(--color-muted)"
            >
              {{ role }}
            </div>
          </div>
        </header>

        <div class="user-dropdown__divider" />

        <!-- Shift / Station — non-secret stats. Render '—' when null so a
             missing value reads as "not set" instead of disappearing
             silently (prompts the user / admin to fill it in). -->
        <div class="user-dropdown__stats">
          <div class="user-dropdown__stat">
            <div class="user-dropdown__stat-label">Shift</div>
            <div class="user-dropdown__stat-value">
              <template v-if="shift">{{ shift }}</template>
              <span v-else class="user-dropdown__stat-empty">—</span>
            </div>
          </div>
          <div class="user-dropdown__stat">
            <div class="user-dropdown__stat-label">Station</div>
            <template v-if="!editingStation">
              <button
                type="button"
                class="user-dropdown__stat-edit-btn"
                :aria-label="station ? `Edit station (currently ${station})` : 'Set your station'"
                @click="startEditStation"
              >
                <span class="user-dropdown__stat-value">
                  <template v-if="station">{{ station }}</template>
                  <span v-else class="user-dropdown__stat-empty">— set</span>
                </span>
                <Pencil :size="11" :stroke-width="1.85" class="user-dropdown__stat-pencil" />
              </button>
            </template>
            <template v-else>
              <input
                ref="stationInput"
                v-model="stationDraft"
                type="text"
                class="user-dropdown__stat-input"
                maxlength="40"
                autocomplete="off"
                spellcheck="false"
                placeholder="e.g. S202"
                :disabled="savingStation"
                @keydown.enter.prevent="saveStation"
                @keydown.escape.prevent="cancelEditStation"
              />
              <div v-if="stationError" class="user-dropdown__stat-error">
                {{ stationError }}
              </div>
            </template>
          </div>
        </div>

        <div class="user-dropdown__divider" />

        <!-- Fuel # reveal -->
        <div v-if="fuelNumber" class="user-dropdown__fuel">
          <div class="user-dropdown__fuel-label">Fuel #</div>
          <div class="user-dropdown__fuel-value">
            <button
              type="button"
              class="user-dropdown__fuel-btn"
              :aria-pressed="fuel.revealed.value"
              :aria-label="fuel.revealed.value ? 'Hide fuel number' : 'Reveal fuel number'"
              @click="fuel.toggle"
            >
              <component :is="fuel.revealed.value ? EyeOff : Eye" :size="13" :stroke-width="1.85" />
              <span class="font-mono">{{ fuel.revealed.value ? fuelNumber : '••••••' }}</span>
            </button>
            <button
              v-if="fuel.revealed.value"
              type="button"
              class="user-dropdown__copy"
              :aria-label="copied ? 'Copied' : 'Copy fuel number'"
              @click="copyFuel"
            >
              <component :is="copied ? Check : Copy" :size="12" :stroke-width="1.85" />
            </button>
          </div>
          <div v-if="fuel.revealed.value" class="user-dropdown__fuel-progress">
            <span :style="{ width: fuel.progressPct.value }" />
          </div>
        </div>

        <div class="user-dropdown__divider" />

        <button class="user-dropdown__item" @click="signOut">
          <LogOut :size="14" :stroke-width="1.85" />
          Sign out
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user-dropdown {
  position: relative;
}

.user-dropdown__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 8px;
  background: var(--color-brand-800);
  border: 1px solid transparent;
  color: white;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.user-dropdown__trigger:hover {
  background: var(--color-brand-700);
}

.user-dropdown__avatar {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  /* Trigger avatar sits on the navy topbar — use the on-dark gold so it
     visually matches the page's antique gold instead of reading bright. */
  background: var(--color-accent-on-dark);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
  letter-spacing: -0.01em;
}
/* Large avatar lives inside the dropdown panel on a white surface, so it
   gets the canonical page gold (accent-500). */
.user-dropdown__avatar--lg {
  width: 40px;
  height: 40px;
  font-size: 15px;
  border-radius: 8px;
  background: var(--color-accent-500);
}

.user-dropdown__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.05;
  text-align: left;
}
.user-dropdown__name {
  font-size: 12px;
  font-weight: 500;
  color: white;
}
.user-dropdown__role {
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  /* Sits in the trigger on navy — use on-dark variant. */
  color: var(--color-accent-on-dark);
  margin-top: 2px;
}
.user-dropdown__chev {
  color: oklch(0.78 0.02 250);
  flex-shrink: 0;
}

.user-dropdown__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 240px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 12px;
  z-index: 60;
}

.user-dropdown__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 4px 8px;
}

.user-dropdown__divider {
  height: 1px;
  background: var(--color-line-soft);
  margin: 6px -12px;
}

.user-dropdown__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  padding: 4px 4px 2px;
}
.user-dropdown__stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.user-dropdown__stat-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.user-dropdown__stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-dropdown__stat-empty {
  color: var(--color-muted);
  font-weight: 400;
}

.user-dropdown__stat-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
}
.user-dropdown__stat-edit-btn:hover .user-dropdown__stat-pencil,
.user-dropdown__stat-edit-btn:focus-visible .user-dropdown__stat-pencil {
  opacity: 1;
  color: var(--color-accent-700);
}
.user-dropdown__stat-edit-btn:focus-visible {
  outline: none;
}
.user-dropdown__stat-edit-btn:focus-visible .user-dropdown__stat-value {
  text-decoration: underline;
  text-decoration-color: var(--color-accent-500);
  text-underline-offset: 3px;
}
.user-dropdown__stat-pencil {
  opacity: 0;
  color: var(--color-muted);
  transition: opacity 120ms var(--ease-out), color 120ms var(--ease-out);
  flex-shrink: 0;
}

.user-dropdown__stat-input {
  width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  margin-top: 1px;
}
.user-dropdown__stat-input:focus {
  border-color: var(--color-accent-500);
  box-shadow: 0 0 0 2px oklch(0.93 0.04 86.8);
}
.user-dropdown__stat-input:disabled {
  opacity: 0.6;
}
.user-dropdown__stat-error {
  font-size: 11px;
  color: var(--color-danger-500);
  margin-top: 3px;
  line-height: 1.3;
}

.user-dropdown__fuel {
  position: relative;
  padding: 6px 4px;
}
.user-dropdown__fuel-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.user-dropdown__fuel-value {
  display: flex;
  gap: 8px;
  align-items: center;
}
.user-dropdown__fuel-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--color-ink);
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.user-dropdown__fuel-btn:hover {
  border-color: var(--color-accent-500);
}
.user-dropdown__copy {
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-muted);
  transition: color 120ms var(--ease-out), border-color 120ms var(--ease-out);
}
.user-dropdown__copy:hover {
  color: var(--color-brand-600);
  border-color: var(--color-muted-soft);
}
.user-dropdown__fuel-progress {
  position: relative;
  height: 1.5px;
  background: var(--color-line-soft);
  border-radius: 999px;
  margin-top: 6px;
  overflow: hidden;
}
.user-dropdown__fuel-progress > span {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--color-accent-500);
  transition: width 0.05s linear;
}

.user-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 4px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
}
.user-dropdown__item:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.user-dropdown-fade-enter-active,
.user-dropdown-fade-leave-active {
  transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);
}
.user-dropdown-fade-enter-from,
.user-dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
