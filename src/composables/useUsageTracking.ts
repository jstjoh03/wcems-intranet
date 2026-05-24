import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * Fire-and-forget engagement tracking.
 *
 * Calls the `log_route_view` RPC once per route change, which on the
 * server side:
 *   1. Updates app_users.last_seen_at = now() for the calling user.
 *   2. Inserts a row in usage_events with the route path.
 *
 * Cloudflare Analytics can't see SPA route changes (the router moves
 * client-side without an HTTP request), so this fills that blind spot
 * and powers the /admin/usage dashboard.
 *
 * Skipped entirely in dev-stub mode and for signed-out users. Errors
 * are swallowed — usage tracking should never break the app.
 *
 * Mount once at app root (App.vue setup). Subsequent useRoute() calls
 * elsewhere don't need to think about it.
 */
export function useUsageTracking() {
  const auth = useAuthStore()
  const route = useRoute()
  let lastLogged: string | null = null

  function log(path: string) {
    if (auth.usingDevStub || !auth.appUser) return
    if (!path || lastLogged === path) return
    lastLogged = path
    supabase.rpc('log_route_view', { route_path: path }).then(({ error }) => {
      if (error) {
        // Don't spam logs in prod, but surface unexpected failures in dev.
        if (import.meta.env.DEV) console.warn('[usage] log_route_view:', error.message)
      }
    })
  }

  /* Fire on initial mount AND whenever the route or signed-in user
     changes. immediate:true catches the first route the user landed
     on (e.g. someone arriving from a notification deep link). */
  watch(
    [() => route.path, () => auth.appUser?.id],
    ([path]) => log(path),
    { immediate: true },
  )
}
