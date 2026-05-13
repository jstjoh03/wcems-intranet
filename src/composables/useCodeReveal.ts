import { ref, computed, onUnmounted } from 'vue'

const REVEAL_MS = 20_000
/* Debounce window for toggle(). The previous 250ms value caught
   simultaneous touch→mouse synthetic doubles but NOT iOS Safari's
   "ghost click" — a synthetic click event dispatched ~300ms after the
   real touchend when the target doesn't have `touch-action:
   manipulation`. That ghost click slid under the 250ms window and
   re-toggled the reveal, making the number appear then immediately
   disappear on mobile. 500ms is comfortably above the iOS ghost-click
   delay and still short enough that an intentional rapid toggle feels
   responsive. The reveal button's CSS also sets `touch-action:
   manipulation` so the ghost click ideally never fires; this debounce
   is the backstop. */
const TOGGLE_DEBOUNCE_MS = 500

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
  let lastToggleAt = 0

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
    const now = Date.now()
    if (now - lastToggleAt < TOGGLE_DEBOUNCE_MS) return
    lastToggleAt = now
    if (revealed.value) hide()
    else reveal()
  }

  onUnmounted(hide)

  const progressPct = computed(() => `${progress.value * 100}%`)

  return { revealed, progress, progressPct, reveal, hide, toggle }
}
