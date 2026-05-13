<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { X, Download, Share } from 'lucide-vue-next'

/**
 * "Install the app" prompt for mobile visitors.
 *
 * Two flavors, picked automatically:
 *
 *  - **Android / Chromium**: the browser fires `beforeinstallprompt`
 *    when it considers the site installable (manifest + service worker
 *    + https). We catch the event, hold a reference, and show an
 *    in-app "Install" button. Tapping it calls `event.prompt()` which
 *    surfaces the native install sheet. Once the user chooses, the
 *    event is consumed — Chrome won't re-fire it.
 *
 *  - **iOS Safari**: no programmatic install API exists; Apple
 *    deliberately gates that behind the Share → Add to Home Screen
 *    flow. So we show instructions instead, with the Share icon
 *    visible inline so users know what to look for.
 *
 * Already-installed users (display-mode: standalone OR navigator.
 * standalone) never see this. Dismissed users (X in the corner)
 * never see it again either — localStorage flag.
 *
 * Show delay: 8 seconds after the component mounts. That's enough for
 * the user to read the page first before being prompted, without
 * waiting so long they've already left.
 */

/* TypeScript doesn't ship a global type for beforeinstallprompt because
   the API is non-standard (Chromium-specific). Declared locally. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'wcems:install-prompt-dismissed'
const SHOW_DELAY_MS = 8_000

const dismissed = ref(false)
const visible = ref(false)
const installEvent = ref<BeforeInstallPromptEvent | null>(null)
const isStandalone = ref(false)
const isIOS = ref(false)
const isMobile = ref(false)
let showTimer: ReturnType<typeof setTimeout> | null = null

function onBeforeInstallPrompt(e: Event) {
  /* Stash the event so we can re-fire it from our own button. Without
     preventDefault Chrome would have already shown its mini-info bar
     (or, on newer versions, nothing — Chrome killed the banner). */
  e.preventDefault()
  installEvent.value = e as BeforeInstallPromptEvent
}

function onAppInstalled() {
  /* User completed the install via the native sheet or via the browser
     menu's "Install app" item. Either way, dismiss the banner — they're
     in. The flag also covers the case where the install happens from
     a different surface than our button. */
  visible.value = false
  installEvent.value = null
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode — no-op */
  }
}

async function install() {
  if (!installEvent.value) return
  await installEvent.value.prompt()
  /* userChoice resolves whether the user accepted or dismissed. Either
     way we hide our banner — Chrome won't re-fire beforeinstallprompt
     for this session, and if they accepted we'll get the appinstalled
     event next. */
  await installEvent.value.userChoice
  installEvent.value = null
  visible.value = false
}

function dismiss() {
  dismissed.value = true
  visible.value = false
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode — banner stays gone for this session anyway */
  }
}

const shouldShow = computed(() => {
  if (isStandalone.value) return false
  if (dismissed.value) return false
  if (!isMobile.value) return false
  /* Android needs the captured event; iOS needs nothing — instructions
     are static. */
  return isIOS.value || installEvent.value !== null
})

onMounted(() => {
  /* Display-mode detection covers both Android PWA + iOS home-screen
     installs. navigator.standalone is the Safari-specific flag. */
  const standaloneMq = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  isStandalone.value = standaloneMq || iosStandalone

  const ua = navigator.userAgent
  isIOS.value = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
  /* On iPadOS 13+ the UA says "Macintosh" but the device has touch.
     Catch that case so iPad users still see the iOS instructions. */
  if (!isIOS.value && /Macintosh/.test(ua) && navigator.maxTouchPoints > 1) {
    isIOS.value = true
  }
  isMobile.value = /Mobi|Android/i.test(ua) || isIOS.value

  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    /* private mode — leave default false */
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)

  /* Reveal after a brief delay so the page renders first. If conditions
     aren't met when the timer fires, shouldShow keeps it hidden anyway. */
  showTimer = setTimeout(() => {
    visible.value = true
  }, SHOW_DELAY_MS)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.removeEventListener('appinstalled', onAppInstalled)
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
})
</script>

<template>
  <Transition name="install-banner">
    <div v-if="visible && shouldShow" class="install-banner" role="dialog" aria-live="polite">
      <img
        src="/wcems-patch.png"
        alt=""
        class="install-banner__icon"
        width="44"
        height="44"
      />
      <div class="install-banner__text">
        <div class="display install-banner__title">Install the WCEMS app</div>
        <p v-if="isIOS" class="install-banner__sub">
          Tap
          <Share :size="13" :stroke-width="2" class="install-banner__inline-icon" />
          in the Safari toolbar, then choose <strong>Add to Home Screen</strong>.
        </p>
        <p v-else class="install-banner__sub">
          Get an app-like experience — opens faster, works on your home screen.
        </p>
      </div>
      <div class="install-banner__actions">
        <button
          v-if="!isIOS && installEvent"
          type="button"
          class="install-banner__btn install-banner__btn--primary"
          @click="install"
        >
          <Download :size="14" :stroke-width="2" />
          Install
        </button>
        <button
          type="button"
          class="install-banner__close"
          aria-label="Dismiss install prompt"
          @click="dismiss"
        >
          <X :size="16" :stroke-width="2" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.install-banner {
  position: fixed;
  /* Sit above the quick-links dock (z-index 35) but below modal
     overlays (80) and the global search overlay (90). */
  z-index: 45;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: var(--shadow-lg);
}
@media (min-width: 640px) {
  .install-banner {
    left: auto;
    right: 16px;
    bottom: 16px;
    max-width: 420px;
  }
}

.install-banner__icon {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.install-banner__text {
  flex: 1;
  min-width: 0;
}
.install-banner__title {
  font-size: 15px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.2;
}
.install-banner__sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.45;
}
.install-banner__sub strong {
  color: var(--color-ink-soft);
  font-weight: 600;
}
.install-banner__inline-icon {
  display: inline-block;
  vertical-align: -2px;
  margin: 0 2px;
  color: var(--color-brand-600);
}

.install-banner__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.install-banner__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--color-ink-soft);
  transition: background 120ms var(--ease-out);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.install-banner__btn--primary {
  background: var(--color-brand-600);
  border-color: var(--color-brand-600);
  color: white;
}
.install-banner__btn--primary:hover {
  background: var(--color-brand-700);
}

.install-banner__close {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  color: var(--color-muted);
  transition: background 120ms var(--ease-out);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.install-banner__close:hover {
  background: var(--color-surface-soft);
  color: var(--color-ink);
}

/* Slide-up entrance + fade-out exit. Subtle so the banner reads as a
   "by the way" rather than an alarm. */
.install-banner-enter-active {
  transition: transform 280ms var(--ease-out), opacity 220ms var(--ease-out);
}
.install-banner-leave-active {
  transition: transform 180ms var(--ease-out), opacity 180ms var(--ease-out);
}
.install-banner-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.install-banner-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
