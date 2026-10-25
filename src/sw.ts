/// <reference lib="webworker" />
/**
 * Custom service worker (vite-plugin-pwa `injectManifest` strategy).
 *
 * Two jobs:
 *  1. Precache the Vite build output so the PWA works offline / fast
 *     on repeat visits. Mirrors what `generateSW` used to do — Workbox
 *     replaces `self.__WB_MANIFEST` at build time with the asset list.
 *  2. Handle Web Push: render a notification on `push`, focus the
 *     existing tab (or open a new one) on `notificationclick`.
 *
 * Don't add unrelated logic here — keep the SW small. Network caching
 * strategies belong as separate route handlers if needed later.
 */

import { precacheAndRoute } from 'workbox-precaching'

import { richTextToPlain } from './lib/richtext'

// Cast self for TS — service workers run with a ServiceWorkerGlobalScope.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => {
  // autoUpdate strategy: skip waiting so a new SW takes over on next
  // page load rather than sitting in waiting state.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface PushPayload {
  title: string
  body?: string
  url?: string
  tag?: string
  icon?: string
  badge?: string
}

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    payload = { title: event.data.text(), body: '' }
  }
  const title = payload.title || 'WCEMS Intranet'
  // Announcement bodies may carry rich-text markup ([label](url), **…**)
  // — show the plain form on the lock screen. The edge function slices
  // the teaser server-side, so richTextToPlain also tolerates a link cut
  // mid-URL. Other pushes (schedule pages etc.) pass through untouched.
  const isAnnouncement = payload.tag?.startsWith('announcement-') ?? false
  const options: NotificationOptions & { badge?: string } = {
    body: isAnnouncement ? richTextToPlain(payload.body ?? '') : (payload.body ?? ''),
    tag: payload.tag,
    icon: payload.icon ?? '/wcems-patch.png',
    badge: payload.badge ?? '/wcems-patch.png',
    data: { url: payload.url ?? '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

/* Deep-link strategy (keep in step with src/lib/pushNav.ts): iOS
 * standalone PWAs ignore WindowClient.navigate() and have been known to
 * drop the path on openWindow — a tapped push just focused the app
 * wherever it last sat (Justin's FTEP message push, 2026-10-24). So:
 * stash the target in a cache FIRST (the page consumes it on boot),
 * then ask a focused client's router to navigate via postMessage, and
 * only fall back to navigate() when no page answers. */
const NAV_CACHE = 'wcems-push-nav'
const NAV_PENDING = '/__pending-push-nav'

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl =
    (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(NAV_CACHE)
        await cache.put(
          NAV_PENDING,
          new Response(JSON.stringify({ url: targetUrl, t: Date.now() }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      } catch {
        /* cache unavailable — the warm/openWindow paths still try */
      }

      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Focus an existing tab if we have one open.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          // Hand the route to the page's router (works where
          // client.navigate() doesn't); a page too old to answer gets
          // the old navigate() attempt instead.
          const answered = await new Promise<boolean>((resolve) => {
            const channel = new MessageChannel()
            const timer = setTimeout(() => resolve(false), 450)
            channel.port1.onmessage = () => {
              clearTimeout(timer)
              resolve(true)
            }
            try {
              client.postMessage({ type: 'push-nav', url: targetUrl }, [channel.port2])
            } catch {
              clearTimeout(timer)
              resolve(false)
            }
          })
          if (!answered && 'navigate' in client && client.url.indexOf(targetUrl) === -1) {
            try {
              await (client as WindowClient).navigate(targetUrl)
            } catch {
              /* iOS: navigate unsupported — the cached target covers the next boot. */
            }
          }
          return
        }
      }
      // No open tab — open a fresh one (the cached target backstops iOS
      // dropping the path).
      await self.clients.openWindow(targetUrl)
    })(),
  )
})
