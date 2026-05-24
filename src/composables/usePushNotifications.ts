import { ref, computed, onMounted } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Browser Web Push subscription state for the current user/device.
 *
 *  - `isSupported`  : browser exposes service worker + push manager APIs.
 *                     Desktop Safari before macOS 13, in-app webviews,
 *                     and any non-PWA iOS Safari all return false.
 *  - `permission`   : Notification.permission. 'granted' is the only
 *                     state where we can deliver.
 *  - `isSubscribed` : a PushSubscription exists for this browser AND a
 *                     matching row exists in push_subscriptions.
 *
 * `enable()` and `disable()` are the two user-facing actions. They
 * handle the permission prompt, register the SW subscription, and
 * sync to the DB. The composable assumes the auth store has an
 * appUser by the time it's called (the toggle is gated behind login).
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/* Module-singleton state so toggle in two places (banner + profile
   modal) stays in sync without prop-drilling. */
const isSupported = ref(false)
const permission = ref<NotificationPermission>('default')
const isSubscribed = ref(false)
const busy = ref(false)
const errorMessage = ref<string | null>(null)
let inited = false

async function syncSubscriptionState() {
  if (!isSupported.value) {
    isSubscribed.value = false
    return
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    isSubscribed.value = sub !== null
  } catch {
    isSubscribed.value = false
  }
}

async function init() {
  if (inited) return
  inited = true
  // The browser-API gates: PushManager doesn't exist on Safari < 16.4
  // and SW registration is blocked in private mode on some platforms.
  isSupported.value =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  if (!isSupported.value) return
  permission.value = Notification.permission
  await syncSubscriptionState()
}

export function usePushNotifications() {
  onMounted(() => {
    void init()
  })

  const canPrompt = computed(
    () => isSupported.value && permission.value !== 'denied',
  )

  async function enable(): Promise<{ ok: true } | { ok: false; error: string }> {
    errorMessage.value = null
    if (busy.value) return { ok: false, error: 'Already in progress' }
    if (!isSupported.value) {
      return { ok: false, error: 'Push notifications aren’t supported in this browser.' }
    }
    if (!VAPID_PUBLIC_KEY) {
      return {
        ok: false,
        error: 'VITE_VAPID_PUBLIC_KEY is not configured. Add it to your env and redeploy.',
      }
    }
    const auth = useAuthStore()
    const appUser = auth.appUser
    if (!appUser) return { ok: false, error: 'Sign in to enable notifications.' }

    busy.value = true
    try {
      // Permission prompt — user-gesture required, must be awaited
      // synchronously after the click on Safari/iOS.
      if (permission.value !== 'granted') {
        const result = await Notification.requestPermission()
        permission.value = result
        if (result !== 'granted') {
          return { ok: false, error: 'Notification permission was not granted.' }
        }
      }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        // Cast: lib.dom types disagree between Uint8Array<ArrayBufferLike>
        // and the BufferSource overload. The bytes are valid either way.
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        })
      }

      // PushSubscription serialises to { endpoint, keys: { p256dh, auth } }
      // via toJSON. Pull the fields we store.
      const json = sub.toJSON() as {
        endpoint: string
        keys?: { p256dh?: string; auth?: string }
      }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return { ok: false, error: 'Subscription payload missing required keys.' }
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            user_id: appUser.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            user_agent: navigator.userAgent.slice(0, 256),
          },
          { onConflict: 'endpoint' },
        )
      if (error) {
        // Roll back the browser subscription so state stays consistent.
        try {
          await sub.unsubscribe()
        } catch {
          /* swallow */
        }
        return { ok: false, error: `DB insert failed: ${error.message}` }
      }

      isSubscribed.value = true
      return { ok: true }
    } catch (err) {
      const message = (err as Error).message
      errorMessage.value = message
      return { ok: false, error: message }
    } finally {
      busy.value = false
    }
  }

  async function disable(): Promise<{ ok: true } | { ok: false; error: string }> {
    errorMessage.value = null
    if (busy.value) return { ok: false, error: 'Already in progress' }
    if (!isSupported.value) return { ok: true }
    busy.value = true
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      const endpoint = sub?.endpoint
      if (sub) {
        try {
          await sub.unsubscribe()
        } catch {
          /* If the browser refuses to unsubscribe (rare), still remove
             from the DB so we stop pushing to this dead endpoint. */
        }
      }
      if (endpoint) {
        const { error } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint)
        if (error) {
          return { ok: false, error: `DB delete failed: ${error.message}` }
        }
      }
      isSubscribed.value = false
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      busy.value = false
    }
  }

  return {
    isSupported,
    permission,
    isSubscribed,
    canPrompt,
    busy,
    errorMessage,
    enable,
    disable,
  }
}
