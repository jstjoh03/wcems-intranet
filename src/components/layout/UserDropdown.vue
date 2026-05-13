<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ChevronDown, LogOut, Eye, EyeOff, Copy, Check } from 'lucide-vue-next'
import { useCodeReveal } from '@/composables/useCodeReveal'
import type { ShiftLetter } from '@/types'

const auth = useAuthStore()
const router = useRouter()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const copied = ref(false)
let openedAt = 0

const fuel = useCodeReveal()

const initials = computed(() => auth.appUser?.initials ?? '?')
const firstName = computed(() => auth.appUser?.firstName ?? '')
const role = computed(() => auth.appUser?.role ?? 'crew')
const fullName = computed(() => auth.appUser?.fullName ?? '')
const fuelNumber = computed(() => auth.appUser?.fuelNumber ?? null)

/* Closed list of valid stations — keeps entry uniform across the crew. */
const STATION_OPTIONS = [
  'S201',
  'S202',
  'Medic 206',
  'Medic 211',
  'Medic 221',
  'Medic 231',
  'Medic 242',
  'Medic 271',
  'Medic 281',
  'EMS Admin',
  'FLOAT',
  'PRN',
] as const
const SHIFT_OPTIONS: ShiftLetter[] = ['A', 'B', 'C']

/* Local refs synced to the auth store. We `watch` rather than computed
   so binding to a <select> via v-model works (computed is read-only). */
const stationLocal = ref(auth.appUser?.station ?? '')
const shiftLocal = ref<ShiftLetter | ''>(auth.appUser?.shift ?? '')
watch(
  () => auth.appUser?.station,
  (v) => (stationLocal.value = v ?? ''),
)
watch(
  () => auth.appUser?.shift,
  (v) => (shiftLocal.value = v ?? ''),
)

const stationError = ref<string | null>(null)
const shiftError = ref<string | null>(null)

async function saveStation() {
  stationError.value = null
  try {
    await auth.updateOwnStation(stationLocal.value || null)
  } catch (err) {
    stationError.value = (err as Error).message
    /* Roll the dropdown back to the last-saved value. */
    stationLocal.value = auth.appUser?.station ?? ''
  }
}

async function saveShift() {
  shiftError.value = null
  try {
    await auth.updateOwnShift(shiftLocal.value || null)
  } catch (err) {
    shiftError.value = (err as Error).message
    shiftLocal.value = auth.appUser?.shift ?? ''
  }
}

function close() {
  open.value = false
  fuel.hide()
}

function toggle() {
  open.value = !open.value
  if (open.value) openedAt = Date.now()
  else fuel.hide()
}

/* Close-on-click-outside.
 *
 * Listens on `click` rather than `mousedown` — on iOS Safari the touch
 * → mouse synthetic-event ordering can fire mousedown after the click
 * that opens us, leading to "flashes and disappears". Using `click`
 * matches the trigger's @click ordering reliably. The 200ms grace
 * period is belt-and-suspenders against any edge-case re-fire on the
 * very same gesture. */
function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  if (Date.now() - openedAt < 200) return
  if (root.value && !root.value.contains(e.target as Node)) close()
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
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

/**
 * Sign out cleanly: close the dropdown, clear the Supabase session,
 * then push to /signin so the user actually leaves the authenticated
 * surface. Without the navigation, signing out just clears appUser
 * but leaves the current page rendered with broken auth-dependent
 * UI (admin actions disappearing, etc.) — the route guard only fires
 * on the NEXT navigation. Pushing to /signin makes the signed-out
 * state immediately visible.
 */
async function signOut() {
  close()
  await auth.signOut()
  void router.push({ name: 'signin' })
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
          </div>
        </header>

        <div class="user-dropdown__divider" />

        <!-- Shift / Station — both editable from a closed dropdown of
             valid values so entries stay uniform across the crew. -->
        <div class="user-dropdown__stats">
          <div class="user-dropdown__stat">
            <div class="user-dropdown__stat-label">Shift</div>
            <select
              v-model="shiftLocal"
              class="user-dropdown__stat-select"
              aria-label="Edit shift"
              @change="saveShift"
            >
              <option value="">—</option>
              <option v-for="s in SHIFT_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
            <div v-if="shiftError" class="user-dropdown__stat-error">{{ shiftError }}</div>
          </div>
          <div class="user-dropdown__stat">
            <div class="user-dropdown__stat-label">Station</div>
            <select
              v-model="stationLocal"
              class="user-dropdown__stat-select"
              aria-label="Edit station"
              @change="saveStation"
            >
              <option value="">— set</option>
              <option v-for="s in STATION_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
            <div v-if="stationError" class="user-dropdown__stat-error">{{ stationError }}</div>
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
              @click.stop.prevent="fuel.toggle"
            >
              <component :is="fuel.revealed.value ? EyeOff : Eye" :size="13" :stroke-width="1.85" />
              <span class="font-mono">{{ fuel.revealed.value ? fuelNumber : '••••••' }}</span>
            </button>
            <button
              v-if="fuel.revealed.value"
              type="button"
              class="user-dropdown__copy"
              :aria-label="copied ? 'Copied' : 'Copy fuel number'"
              @click.stop.prevent="copyFuel"
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
  /* Anchored to the viewport (not the trigger) so we don't get clipped
     by the topbar's stacking context. The topbar uses
     `overflow-x: clip; overflow-y: visible`, but per CSS spec a single
     `visible` axis next to `clip` computes to `auto` — which turns the
     topbar into a scroll container that clips anything extending below
     it. On mobile that meant the panel "opened behind the page."
     position: fixed escapes that entirely. */
  position: fixed;
  top: 56px; /* topbar height (~48px) + 8px gap */
  right: 12px; /* matches topbar horizontal padding */
  min-width: 240px;
  max-width: calc(100vw - 24px);
  /* Don't let an unusually-tall panel run off the bottom on short
     phones — let it scroll internally if needed. */
  max-height: calc(100vh - 72px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 12px;
  /* Above the topbar (40) but below modal overlays (80) and the
     command palette (90). */
  z-index: 70;
}
@media (min-width: 1280px) {
  .user-dropdown__panel {
    right: 26px; /* matches the larger topbar padding at this breakpoint */
  }
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

/* Native <select> styled to read like the typographic value above it.
   The chevron lives in the background-image so the select still looks
   tappable but doesn't pull in the OS dropdown chrome. Mobile gets the
   native picker on tap, which is the right UX there. */
.user-dropdown__stat-select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background: transparent;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%2399a' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M3 5l3 3 3-3'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0 center;
  background-size: 12px 12px;
  border: none;
  outline: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.005em;
  cursor: pointer;
  padding: 0 16px 0 0;
  margin: 0;
  width: 100%;
  min-width: 0;
  text-overflow: ellipsis;
}
.user-dropdown__stat-select:focus-visible {
  outline: none;
  text-decoration: underline;
  text-decoration-color: var(--color-accent-500);
  text-underline-offset: 3px;
}
.user-dropdown__stat-select option {
  /* Native option text ignores most CSS — keep it readable for the OS
     picker by relying on system defaults. */
  color: var(--color-ink);
  background: var(--color-surface);
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
  /* Kill iOS Safari's 300ms double-tap-zoom wait so a single tap dispatches
     a single click — no synthetic "ghost click" 300ms later re-toggling
     the reveal. Without this, the fuel number flashed on then immediately
     hid on mobile. Pair with the toggle debounce in useCodeReveal as a
     belt-and-suspenders defense. */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
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
  /* Same iOS ghost-click defense as the reveal button — see comment
     on .user-dropdown__fuel-btn above. */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
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
