import { ref, computed, onUnmounted } from 'vue'

const REVEAL_MS = 20_000

/**
 * Tap-to-reveal with auto-hide after 20s and a thin progress bar.
 *
 * Important: this is the bug-free port of the prototype's pattern.
 * The prototype's React effect re-ran every tick because the timer was a
 * watcher dependency. Here we use a single setTimeout for the hide and
 * `requestAnimationFrame` for the progress bar — no per-second reactivity
 * round-trip, no spurious effect re-runs.
 */
export function useCodeReveal() {
  const revealed = ref(false)
  const revealedAt = ref(0)
  const progress = ref(1) // 1 → 0 over 20s

  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let rafHandle: number | null = null

  const tickProgress = () => {
    const elapsed = Date.now() - revealedAt.value
    progress.value = Math.max(0, 1 - elapsed / REVEAL_MS)
    if (revealed.value) {
      rafHandle = requestAnimationFrame(tickProgress)
    }
  }

  const hide = () => {
    revealed.value = false
    progress.value = 1
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
  }

  const reveal = () => {
    revealed.value = true
    revealedAt.value = Date.now()
    progress.value = 1
    if (hideTimer !== null) clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, REVEAL_MS)
    rafHandle = requestAnimationFrame(tickProgress)
  }

  const toggle = () => {
    if (revealed.value) hide()
    else reveal()
  }

  onUnmounted(hide)

  const progressPct = computed(() => `${progress.value * 100}%`)

  return { revealed, progress, progressPct, reveal, hide, toggle }
}
