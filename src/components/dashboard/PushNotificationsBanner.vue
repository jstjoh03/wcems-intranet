<script setup lang="ts">
import { ref, computed } from 'vue'
import { Bell, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { usePushNotifications } from '@/composables/usePushNotifications'

/**
 * One-time prompt encouraging crew to enable push notifications for
 * new announcements. Dismissal is persisted in localStorage so it
 * doesn't re-nag on every visit. The toggle in the user profile
 * modal is the always-available control — this banner is just a
 * discovery aid.
 *
 * Hidden when: user not signed in, browser doesn't support push,
 * permission denied (we can't change their mind from here), already
 * subscribed on this device, or user dismissed.
 */

const auth = useAuthStore()
const { isSupported, permission, isSubscribed, busy, enable } = usePushNotifications()

const DISMISS_KEY = 'wcems-push-banner-dismissed-v1'
const dismissed = ref<boolean>(
  typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1',
)

const errorText = ref<string | null>(null)

const visible = computed(() => {
  if (!auth.appUser || auth.usingDevStub) return false
  if (!isSupported.value) return false
  if (permission.value === 'denied') return false
  if (isSubscribed.value) return false
  if (dismissed.value) return false
  return true
})

async function onEnable() {
  errorText.value = null
  const result = await enable()
  if (!result.ok) {
    errorText.value = result.error
  }
  // On success the banner hides naturally (isSubscribed flips true).
}

function onDismiss() {
  dismissed.value = true
  window.localStorage.setItem(DISMISS_KEY, '1')
}
</script>

<template>
  <div v-if="visible" class="push-banner" role="region" aria-label="Push notifications opt-in">
    <Bell :size="18" :stroke-width="1.85" class="push-banner__icon" />
    <div class="push-banner__copy">
      <strong class="push-banner__title">Stay in the loop</strong>
      <span class="push-banner__sub">
        Turn on push notifications to hear about new announcements the moment they post.
      </span>
      <span v-if="errorText" class="push-banner__error">{{ errorText }}</span>
    </div>
    <div class="push-banner__actions">
      <button type="button" class="push-banner__btn-primary" :disabled="busy" @click="onEnable">
        {{ busy ? 'Enabling…' : 'Turn on' }}
      </button>
      <button
        type="button"
        class="push-banner__btn-ghost"
        aria-label="Dismiss notification prompt"
        @click="onDismiss"
      >
        <X :size="14" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.push-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: var(--color-brand-50);
  border: 1px solid var(--color-brand-100);
  border-radius: 12px;
}
.push-banner__icon {
  color: var(--color-brand-600);
  margin-top: 2px;
  flex-shrink: 0;
}
.push-banner__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.push-banner__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.005em;
}
.push-banner__sub {
  font-size: 12px;
  color: var(--color-ink-soft);
  line-height: 1.4;
}
.push-banner__error {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-danger-500);
}
.push-banner__actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.push-banner__btn-primary {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  border: none;
  background: var(--color-brand-600);
  color: white;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.push-banner__btn-primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.push-banner__btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.push-banner__btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.push-banner__btn-ghost:hover {
  background: oklch(0 0 0 / 0.05);
  color: var(--color-ink);
}
</style>
