import type { Router } from 'vue-router'

/**
 * Push-notification deep links, the iOS-proof way. WindowClient
 * .navigate() silently fails in iOS standalone PWAs, so tapping a push
 * used to just focus the app wherever it last sat — "takes me to the
 * home page" (Justin's FTEP message push, 2026-10-24). The service
 * worker now:
 *   warm app  → postMessage {type:'push-nav', url} to the focused
 *               client (acknowledged over a MessageChannel port)
 *   cold open → stashes the target in the wcems-push-nav cache before
 *               openWindow, because iOS has also been known to drop the
 *               deep path on openWindow.
 * This module is the page half: route on the message, and consume a
 * fresh pending entry on boot. Keep the cache/entry names in step with
 * src/sw.ts.
 */
const CACHE = 'wcems-push-nav'
const PENDING_URL = '/__pending-push-nav'
const MAX_AGE_MS = 2 * 60_000

function safePath(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') ? url : null
}

async function clearPending(): Promise<void> {
  try {
    await (await caches.open(CACHE)).delete(PENDING_URL)
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export function installPushNav(router: Router): void {
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: unknown } | null
    if (data?.type !== 'push-nav') return
    event.ports[0]?.postMessage('ok')
    const path = safePath(data.url)
    if (path) void router.push(path)
    void clearPending()
  })

  // Cold-start handoff: the SW cached the target right before this boot.
  void (async () => {
    try {
      const hit = await (await caches.open(CACHE)).match(PENDING_URL)
      if (!hit) return
      const { url, t } = (await hit.json()) as { url?: unknown; t?: number }
      await clearPending()
      const path = safePath(url)
      if (path && Date.now() - (t ?? 0) < MAX_AGE_MS) await router.replace(path)
    } catch {
      /* cache unavailable — normal boot */
    }
  })()
}
