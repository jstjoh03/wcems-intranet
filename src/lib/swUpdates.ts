import type { Router } from 'vue-router'

/**
 * Keeps installed PWAs on the current build without anyone having to
 * troubleshoot a refresh. The browser only checks for a new service
 * worker on navigation (and every ~24h), and an installed PWA that
 * lives in the app switcher for days never navigates — so crews sit on
 * stale bundles, and when a new SW finally does take control the
 * already-open page keeps running old JS whose lazy chunks were purged
 * from the precache. Both failure modes end here:
 *
 *  - Update CHECKS run every 20 minutes, every time the app comes back
 *    to the foreground, and on every route change (throttled) — a new
 *    deploy is noticed within a minute of the next real use.
 *  - When a new SW takes control (our sw.ts skips waiting), the page
 *    reloads immediately if it's in the background, otherwise on the
 *    user's next navigation or backgrounding — never mid-form.
 *  - A failed lazy-chunk import (the classic stale-shell white screen)
 *    triggers one automatic reload onto the fresh build.
 */

const CHECK_EVERY_MS = 20 * 60 * 1000
const MIN_CHECK_GAP_MS = 60 * 1000

export function installSwUpdateManager(router: Router): void {
  // Stale lazy chunks: an old shell requesting hashed files a deploy
  // deleted. One reload swaps in the current build instead of a white
  // screen and a phone call.
  let healed = false
  window.addEventListener('vite:preloadError', (e) => {
    if (healed) return
    healed = true
    e.preventDefault()
    window.location.reload()
  })

  if (!('serviceWorker' in navigator)) return

  let reloadPending = false
  let reloaded = false
  function hardReload() {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }

  // Only an UPDATE takes this path — on first install (no previous
  // controller) clients.claim() also fires controllerchange, and
  // reloading a brand-new visit would be pointless.
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    if (document.visibilityState === 'hidden') hardReload()
    else reloadPending = true
  })

  let lastCheck = 0
  async function checkForUpdate() {
    const now = Date.now()
    if (now - lastCheck < MIN_CHECK_GAP_MS) return
    lastCheck = now
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    } catch {
      /* offline or fetch failed — the next check catches up */
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Backgrounded with a new build already in control — reload now
      // so the next foreground is instant and current.
      if (reloadPending) hardReload()
      return
    }
    // The moment an installed PWA resumes is the moment to look.
    void checkForUpdate()
  })

  router.afterEach(() => {
    // The URL has already changed; a full load here lands on the same
    // destination with the new build. Feels like ordinary navigation.
    if (reloadPending) {
      hardReload()
      return
    }
    void checkForUpdate()
  })

  window.setInterval(() => {
    void checkForUpdate()
  }, CHECK_EVERY_MS)
}
