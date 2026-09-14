<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'

/**
 * Catch-all 404 — with a self-heal for the PWA's stale-cache trap: a
 * route that shipped after this browser last cached the app (e.g. a
 * crew member opening /schedule from a text) 404s on the OLD bundle
 * even though the page exists in the new one. On mount we ask the
 * service worker to update; when a fresh SW takes control we reload
 * once (per path, so a genuinely missing page never reload-loops) and
 * the real route resolves.
 */

const checking = ref(false)
let cleanup: (() => void) | null = null

onMounted(async () => {
  if (!('serviceWorker' in navigator)) return
  const guardKey = `nf-reload:${location.pathname}`
  try {
    if (sessionStorage.getItem(guardKey)) return
  } catch {
    return
  }

  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return

  const reloadOnce = () => {
    try {
      sessionStorage.setItem(guardKey, '1')
    } catch {
      /* still reload — worst case the SPA router 404s again without looping */
    }
    location.reload()
  }

  // A new SW may already be waiting/installing from an earlier check.
  const onControllerChange = () => reloadOnce()
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  cleanup = () =>
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)

  checking.value = true
  try {
    await reg.update()
  } catch {
    /* offline or SW fetch failed — nothing to heal */
  }
  // If no newer bundle exists, controllerchange never fires and the
  // 404 stands (a genuinely wrong URL). Stop showing the spinner soon.
  window.setTimeout(() => {
    checking.value = false
  }, 4000)
})

onBeforeUnmount(() => {
  cleanup?.()
})
</script>

<template>
  <div class="not-found">
    <div class="not-found__inner">
      <div class="not-found__code display">404</div>
      <h1 class="not-found__title display">Page not found</h1>
      <p class="not-found__sub">
        The page you were looking for doesn't exist on the WCEMS intranet.
      </p>
      <p v-if="checking" class="not-found__checking">Checking for a newer version of the portal…</p>
      <RouterLink to="/" class="btn btn-primary">Back to dashboard</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 60dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}
.not-found__inner {
  text-align: center;
  max-width: 480px;
}
.not-found__code {
  font-size: 96px;
  letter-spacing: -0.02em;
  color: var(--color-brand-600);
  line-height: 1;
}
.not-found__title {
  margin-top: 8px;
  font-size: 28px;
  color: var(--color-ink);
}
.not-found__sub {
  margin: 12px 0 24px;
  color: var(--color-ink-soft);
  font-size: 14px;
}
.not-found__checking {
  margin: -12px 0 20px;
  color: var(--color-muted);
  font-size: 13px;
}
</style>
