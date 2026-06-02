<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Sparkles, Camera, MapPin, Clock, Check, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

/**
 * First-run "complete your profile" nudge.
 *
 * Shows once a signed-in user's profile is missing a photo, station,
 * or shift — the three fields that most help teammates recognize each
 * other and surface the right station info. It's a *nudge*, not an
 * editor: "Complete my profile" opens the existing UserProfileModal
 * (single source of truth for all profile edits) via the shared
 * `wcems:open-profile` window event.
 *
 * Dismissal:
 *   - "Remind me later" → session-only (sessionStorage); reappears
 *     next sign-in.
 *   - "Don't show again" → persisted to app_users.profile_prompt_dismissed
 *     via the dismiss_profile_prompt RPC, so it stays gone across
 *     devices.
 *
 * A short settle delay after mount avoids a flash while the auth store
 * does its JWT-claims-then-DB-row two-pass hydration.
 */

const auth = useAuthStore()

const SNOOZE_KEY = 'wcems:profile-prompt-snoozed'
const snoozed = ref(
  typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SNOOZE_KEY) === '1',
)

/* Don't evaluate visibility until the auth store has settled — the
   first hydration pass fills appUser from JWT claims (station/shift/
   photo all null), which would briefly satisfy "incomplete" before the
   real DB row lands. */
const settled = ref(false)
onMounted(() => {
  setTimeout(() => {
    settled.value = true
  }, 1000)
})

const u = computed(() => auth.appUser)

const hasPhoto = computed(() => !!u.value?.photoUrl)
const hasStation = computed(() => !!u.value?.station)
const hasShift = computed(() => !!u.value?.shift)
const isIncomplete = computed(() => !hasPhoto.value || !hasStation.value || !hasShift.value)

const firstName = computed(() => u.value?.firstName?.trim() || 'there')

const visible = computed(
  () =>
    settled.value &&
    auth.ready &&
    !!u.value &&
    /* Never nudge kiosk accounts to fill out a "profile" — they're
       shared station mailboxes, not people. */
    !auth.isKiosk &&
    !u.value.profilePromptDismissed &&
    !snoozed.value &&
    isIncomplete.value,
)

const items = computed(() => [
  { key: 'photo', label: 'Add a profile photo', sub: 'So teammates recognize you', done: hasPhoto.value, icon: Camera },
  { key: 'station', label: 'Set your station', sub: 'Surfaces the right building info', done: hasStation.value, icon: MapPin },
  { key: 'shift', label: 'Set your shift', sub: 'A, B, or C', done: hasShift.value, icon: Clock },
])

function completeProfile() {
  // Snooze for this session so it doesn't sit behind the editor, then
  // hand off to the full profile modal.
  remindLater()
  window.dispatchEvent(new CustomEvent('wcems:open-profile'))
}

function remindLater() {
  snoozed.value = true
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SNOOZE_KEY, '1')
}

async function dontShowAgain() {
  snoozed.value = true // hide immediately; persistence is best-effort
  try {
    await auth.dismissProfilePrompt()
  } catch {
    /* If the RPC fails we still hid it this session — no error popup
       for a non-critical nudge. */
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="pcm" role="dialog" aria-modal="true" aria-labelledby="pcm-title">
      <div class="pcm__backdrop" @click="remindLater" />
        <div class="pcm__card">
          <button
            type="button"
            class="pcm__close"
            aria-label="Remind me later"
            @click="remindLater"
          >
            <X :size="18" :stroke-width="2" />
          </button>

          <div class="pcm__icon">
            <Sparkles :size="22" :stroke-width="1.85" />
          </div>

          <h2 id="pcm-title" class="pcm__title display">Welcome, {{ firstName }}!</h2>
          <p class="pcm__sub">
            Take a minute to finish your profile so teammates can recognize you and you get
            the right info for your station and shift.
          </p>

          <ul class="pcm__list">
            <li v-for="it in items" :key="it.key" class="pcm__item" :class="{ 'pcm__item--done': it.done }">
              <span class="pcm__item-icon">
                <Check v-if="it.done" :size="15" :stroke-width="2.5" />
                <component :is="it.icon" v-else :size="15" :stroke-width="1.85" />
              </span>
              <span class="pcm__item-text">
                <span class="pcm__item-label">{{ it.label }}</span>
                <span class="pcm__item-sub">{{ it.done ? 'Done' : it.sub }}</span>
              </span>
            </li>
          </ul>

          <div class="pcm__actions">
            <button type="button" class="pcm__btn pcm__btn--primary" @click="completeProfile">
              Complete my profile
            </button>
            <button type="button" class="pcm__btn pcm__btn--ghost" @click="remindLater">
              Remind me later
            </button>
          </div>

        <button type="button" class="pcm__dismiss" @click="dontShowAgain">
          Don't show this again
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pcm {
  position: fixed;
  inset: 0;
  z-index: 85;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.pcm__backdrop {
  position: absolute;
  inset: 0;
  background: oklch(0.2 0.03 260 / 0.55);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.pcm__card {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 18px;
  box-shadow: var(--shadow-lg, 0 20px 50px rgba(15, 26, 51, 0.25));
  padding: 28px 24px 20px;
  text-align: center;
}
.pcm__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-muted);
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.pcm__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

.pcm__icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-brand-50);
  color: var(--color-brand-600);
}
.pcm__title {
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.pcm__sub {
  margin-top: 8px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}

.pcm__list {
  list-style: none;
  margin: 18px 0 4px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.pcm__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface-soft);
}
.pcm__item-icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-brand-600);
}
.pcm__item--done .pcm__item-icon {
  background: var(--color-success-500);
  border-color: var(--color-success-500);
  color: white;
}
.pcm__item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.pcm__item-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.pcm__item--done .pcm__item-label {
  color: var(--color-muted);
  text-decoration: line-through;
}
.pcm__item-sub {
  font-size: 11.5px;
  color: var(--color-muted);
}

.pcm__actions {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pcm__btn {
  width: 100%;
  border-radius: 10px;
  padding: 11px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out);
}
.pcm__btn--primary {
  background: var(--color-brand-600);
  color: white;
}
.pcm__btn--primary:hover {
  background: var(--color-brand-700);
}
.pcm__btn--ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.pcm__btn--ghost:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}

.pcm__dismiss {
  margin-top: 14px;
  background: transparent;
  border: none;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.pcm__dismiss:hover {
  color: var(--color-ink-soft);
}

/* Self-completing entrance animations — run once on mount, no JS
   transition coordination (which got tangled by the card's bubbling
   transitionend). Hide is instant on dismiss, which is fine. */
.pcm {
  animation: pcm-backdrop-in 160ms var(--ease-out) both;
}
.pcm__card {
  animation: pcm-card-in 200ms var(--ease-out) both;
}
@keyframes pcm-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes pcm-card-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pcm,
  .pcm__card {
    animation: none;
  }
}
</style>
