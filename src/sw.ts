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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl =
    (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Focus an existing tab if we have one open.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          // Navigate the focused client if it isn't already on the
          // target route. `navigate` exists on WindowClient only.
          if ('navigate' in client && client.url.indexOf(targetUrl) === -1) {
            try {
              await (client as WindowClient).navigate(targetUrl)
            } catch {
              /* Cross-origin navigates fail silently — acceptable. */
            }
          }
          return
        }
      }
      // No open tab — open a fresh one.
      await self.clients.openWindow(targetUrl)
    })(),
  )
})
