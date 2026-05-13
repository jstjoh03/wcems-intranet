<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { X, LogOut, Mail } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { STATION_OPTIONS } from '@/constants/stations'
import type { ShiftLetter } from '@/types'

/**
 * Self-serve profile modal — the comprehensive "manage my info" surface.
 *
 *  - Opens via the `wcems:open-profile` window event so any opener
 *    (nav drawer footer, user-dropdown "View profile" link, etc.) is
 *    decoupled from this component. Same pattern as the search overlay.
 *  - Read-only fields (name, email, role, title, DOB) display alongside
 *    editable ones so users get a single view of "who am I to the
 *    system" — and a copy-text hint explaining where to go for the
 *    things they can't change here.
 *  - Each editable section saves on `change` (selects, toggles) or on
 *    `blur` (phone text field), matching the dropdown's pattern. No
 *    explicit "Save" button — values persist as you go.
 */

const auth = useAuthStore()
const router = useRouter()

const open = ref(false)

/* STATION_OPTIONS imported from @/constants/stations so it stays in
   sync with the user dropdown's quick-edit selects. */
const SHIFT_OPTIONS: ShiftLetter[] = ['A', 'B', 'C']

/* Local state mirrors the auth store. Watchers keep these in sync when
   the store changes from elsewhere (admin edits, refresh after self-edit,
   another tab). Saving an editable field writes through to the store. */
const stationLocal = ref(auth.appUser?.station ?? '')
const shiftLocal = ref<ShiftLetter | ''>(auth.appUser?.shift ?? '')
const phoneLocal = ref(auth.appUser?.phone ?? '')
const showBirthdayLocal = ref(auth.appUser?.showBirthday ?? true)
const inDirectoryLocal = ref(auth.appUser?.inDirectory ?? true)

const phoneError = ref<string | null>(null)
const fieldError = ref<string | null>(null)

watch(
  () => auth.appUser?.station,
  (v) => (stationLocal.value = v ?? ''),
)
watch(
  () => auth.appUser?.shift,
  (v) => (shiftLocal.value = v ?? ''),
)
watch(
  () => auth.appUser?.phone,
  (v) => (phoneLocal.value = v ?? ''),
)
watch(
  () => auth.appUser?.showBirthday,
  (v) => (showBirthdayLocal.value = v ?? true),
)
watch(
  () => auth.appUser?.inDirectory,
  (v) => (inDirectoryLocal.value = v ?? true),
)

const initials = computed(() => auth.appUser?.initials ?? '?')
const fullName = computed(() => auth.appUser?.fullName ?? '')
const email = computed(() => auth.appUser?.email ?? '')
const role = computed(() => auth.appUser?.role ?? 'crew')
const title = computed(() => auth.appUser?.title ?? '')
const dob = computed(() => auth.appUser?.dateOfBirth ?? null)

const dobLabel = computed(() => {
  if (!dob.value) return null
  /* Date column stored YYYY-MM-DD — parse positionally to avoid the
     viewer's local TZ pushing it across midnight. */
  const m = dob.value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return dob.value
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
})

function close() {
  open.value = false
  fieldError.value = null
}

function onWindowOpen() {
  fieldError.value = null
  open.value = true
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

onMounted(() => {
  window.addEventListener('wcems:open-profile', onWindowOpen as EventListener)
  window.addEventListener('keydown', onEsc)
})
onBeforeUnmount(() => {
  window.removeEventListener('wcems:open-profile', onWindowOpen as EventListener)
  window.removeEventListener('keydown', onEsc)
})

watch(open, (next) => {
  document.body.style.overflow = next ? 'hidden' : ''
})

async function saveStation() {
  fieldError.value = null
  try {
    await auth.updateOwnStation(stationLocal.value || null)
  } catch (err) {
    fieldError.value = (err as Error).message
    stationLocal.value = auth.appUser?.station ?? ''
  }
}

async function saveShift() {
  fieldError.value = null
  try {
    await auth.updateOwnShift(shiftLocal.value || null)
  } catch (err) {
    fieldError.value = (err as Error).message
    shiftLocal.value = auth.appUser?.shift ?? ''
  }
}

async function savePhone() {
  phoneError.value = null
  fieldError.value = null
  const trimmed = phoneLocal.value.trim()
  if (trimmed.length > 30) {
    phoneError.value = 'Phone is too long (max 30 characters).'
    return
  }
  try {
    await auth.updateOwnPhone(trimmed || null)
  } catch (err) {
    phoneError.value = (err as Error).message
    phoneLocal.value = auth.appUser?.phone ?? ''
  }
}

async function saveShowBirthday() {
  fieldError.value = null
  try {
    await auth.updateOwnShowBirthday(showBirthdayLocal.value)
  } catch (err) {
    fieldError.value = (err as Error).message
    showBirthdayLocal.value = auth.appUser?.showBirthday ?? true
  }
}

async function saveInDirectory() {
  fieldError.value = null
  try {
    await auth.updateOwnInDirectory(inDirectoryLocal.value)
  } catch (err) {
    fieldError.value = (err as Error).message
    inDirectoryLocal.value = auth.appUser?.inDirectory ?? true
  }
}

async function signOut() {
  close()
  await auth.signOut()
  void router.push({ name: 'signin' })
}
</script>

<template>
  <div v-if="open" class="upm-overlay" @click.self="close">
    <div class="upm" role="dialog" aria-modal="true" aria-label="Your profile">
      <button type="button" class="upm__close" aria-label="Close profile" @click="close">
        <X :size="18" />
      </button>

      <header class="upm__head">
        <div class="upm__avatar display">{{ initials }}</div>
        <div class="upm__head-text">
          <h2 class="display upm__name">{{ fullName }}</h2>
          <p class="upm__title-line">
            <span v-if="title">{{ title }}</span>
            <span v-if="title"> · </span>
            <span class="upm__role">{{ role }}</span>
          </p>
          <p class="upm__email">
            <Mail :size="12" :stroke-width="1.85" />
            {{ email }}
          </p>
        </div>
      </header>

      <section class="upm__section">
        <Eyebrow>Work</Eyebrow>
        <div class="upm__grid">
          <label class="upm__field">
            <span class="upm__label">Station</span>
            <select v-model="stationLocal" class="upm__input" @change="saveStation">
              <option value="">— None —</option>
              <option v-for="s in STATION_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="upm__field">
            <span class="upm__label">Shift</span>
            <select v-model="shiftLocal" class="upm__input" @change="saveShift">
              <option value="">— None —</option>
              <option v-for="s in SHIFT_OPTIONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
        </div>
      </section>

      <section class="upm__section">
        <Eyebrow>Contact</Eyebrow>
        <label class="upm__field">
          <span class="upm__label">Phone</span>
          <input
            v-model="phoneLocal"
            type="tel"
            inputmode="tel"
            maxlength="30"
            placeholder="(979) 555-0123"
            class="upm__input"
            @blur="savePhone"
            @keydown.enter.prevent="savePhone"
          />
          <span v-if="phoneError" class="upm__hint upm__hint--error">{{ phoneError }}</span>
        </label>
        <div v-if="dobLabel" class="upm__readonly">
          <span class="upm__label">Birthday</span>
          <span class="upm__readonly-value">{{ dobLabel }}</span>
          <span class="upm__hint">Ask an admin to change this.</span>
        </div>
      </section>

      <section class="upm__section">
        <Eyebrow>Privacy</Eyebrow>
        <label class="upm__check">
          <input v-model="showBirthdayLocal" type="checkbox" @change="saveShowBirthday" />
          <span>
            <strong>Show my birthday on the dashboard</strong>
            <span class="upm__check-sub">Your name appears in the People section on your birthday.</span>
          </span>
        </label>
        <label class="upm__check">
          <input v-model="inDirectoryLocal" type="checkbox" @change="saveInDirectory" />
          <span>
            <strong>Include me in the Employee Directory</strong>
            <span class="upm__check-sub">Colleagues can find your name, station, shift, and contact info.</span>
          </span>
        </label>
      </section>

      <div v-if="fieldError" class="upm__error">{{ fieldError }}</div>

      <footer class="upm__foot">
        <p class="upm__foot-hint">
          Need to change your name, email, role, title, or fuel card? Talk to an admin.
        </p>
        <button type="button" class="upm__signout" @click="signOut">
          <LogOut :size="14" :stroke-width="2" />
          Sign out
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.upm-overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.18 0.015 260 / 0.55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.upm {
  position: relative;
  width: 100%;
  max-width: 540px;
  max-height: 92vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 22px 24px 18px;
}

.upm__close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: transparent;
  border: none;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  cursor: pointer;
  color: var(--color-muted);
  transition: background 120ms var(--ease-out);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.upm__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.upm__head {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-line-soft);
}
.upm__avatar {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  letter-spacing: -0.01em;
}
.upm__head-text {
  min-width: 0;
  flex: 1;
}
.upm__name {
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.15;
}
.upm__title-line {
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.upm__role {
  text-transform: capitalize;
}
.upm__email {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  word-break: break-all;
}

.upm__section {
  margin-top: 18px;
}
.upm__section + .upm__section {
  border-top: 1px solid var(--color-line-soft);
  padding-top: 18px;
}

.upm__grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 480px) {
  .upm__grid {
    grid-template-columns: 1fr;
  }
}
.upm__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.upm__section .upm__field:first-of-type {
  margin-top: 10px;
}
.upm__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.upm__input {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.upm__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.upm__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.upm__hint--error {
  color: var(--color-danger-500);
}

.upm__readonly {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.upm__readonly-value {
  font-size: 14px;
  color: var(--color-ink);
}

.upm__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
  cursor: pointer;
  font-size: 13.5px;
  color: var(--color-ink);
  line-height: 1.45;
}
.upm__check input {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand-600);
  flex-shrink: 0;
}
.upm__check strong {
  font-weight: 600;
}
.upm__check-sub {
  display: block;
  font-size: 12px;
  color: var(--color-muted);
  font-weight: 400;
  margin-top: 1px;
}

.upm__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.upm__foot {
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--color-line-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.upm__foot-hint {
  font-size: 11.5px;
  color: var(--color-muted);
  max-width: 320px;
  line-height: 1.4;
}
.upm__signout {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.upm__signout:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}
</style>
