<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAssistant } from '@/composables/useAssistant'

/**
 * Scout — the portal's mascot, standing on the page itself.
 *
 * A fixed element at the bottom edge beside the Ask Scout button. The
 * clips (public/scout/*) are white-background video; `mix-blend-mode:
 * multiply` melts the white into whatever the page shows behind him, so
 * only the dog (and his soft paw shadow) is visible — no framed box.
 * Decorative: pointer-events none, aria-hidden, skipped for
 * prefers-reduced-motion (static cutout poster instead).
 *
 * He reads the assistant's state himself (useAssistant is a singleton):
 * think loop while a question is in flight, found-it on an answer,
 * stumped on errors/unanswerables, greet when the panel opens after he
 * walked off. Left alone he sits (45s), lies down (75s more), and
 * eventually walks off-screen (4min more); reading time after an answer
 * settles him faster. Any interaction brings him back up — rise clips
 * first, never a teleport.
 */

type ClipName =
  | 'idle'
  | 'think'
  | 'found'
  | 'stumped'
  | 'greet'
  | 'sit'
  | 'sit-loop'
  | 'sit-rise'
  | 'lie'
  | 'rest'
  | 'lie-rise'
  | 'walk-out'

const CLIPS: Record<ClipName, { loop?: boolean; then?: ClipName }> = {
  idle: { loop: true },
  think: { loop: true },
  found: { then: 'idle' },
  stumped: { then: 'idle' },
  greet: { then: 'idle' },
  sit: { then: 'sit-loop' },
  'sit-loop': { loop: true },
  'sit-rise': { then: 'idle' },
  lie: { then: 'rest' },
  rest: { loop: true },
  'lie-rise': { then: 'idle' },
  'walk-out': {}, // ends on the empty frame — Scout is away
}

/* Which way he faces in each clip. A blend between different stances gets
   a small settle "pop" so the turn reads as him moving, not a dissolve. */
const STANCE: Record<ClipName, 'profile' | 'front'> = {
  idle: 'profile',
  think: 'front',
  found: 'front',
  stumped: 'profile',
  greet: 'profile',
  sit: 'profile',
  'sit-loop': 'profile',
  'sit-rise': 'profile',
  lie: 'profile',
  rest: 'profile',
  'lie-rise': 'profile',
  'walk-out': 'profile',
}

/* One-shots hand off while still moving (motion-to-motion blend) — a clip
   frozen on its final frame under a crossfade is what reads as a slideshow. */
const EARLY_SWAP_S = 0.4

/* Flip to true when public/scout/*.webm are the transparent exports: the
   webm path then composites real alpha and drops the multiply matte (the
   mp4 path keeps it for Safari, which can't play VP9 alpha). */
const WEBM_HAS_ALPHA = false

/* Idle-decay pacing (fastDecay scales these for the dev harness) */
const SIT_AFTER_MS = 45_000
const SIT_AFTER_READ_MS = 25_000 // settles sooner while an answer is being read
const LIE_AFTER_MS = 75_000
const LEAVE_AFTER_MS = 240_000 // resting → walks off the page

const props = withDefaults(
  defineProps<{
    /** Dev harness: drive the mood by hand instead of assistant state. */
    moodOverride?: 'idle' | 'thinking' | 'found' | 'stumped' | null
    /** Dev harness: run the decay chain at ~12x speed. */
    fastDecay?: boolean
  }>(),
  { moodOverride: null, fastDecay: false },
)

const { open, messages, sending } = useAssistant()

const mood = computed<'idle' | 'thinking' | 'found' | 'stumped'>(() => {
  if (props.moodOverride) return props.moodOverride
  if (sending.value) return 'thinking'
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m?.role !== 'assistant') continue
    if (!m.content) return 'idle'
    return m.error || m.offerRequest ? 'stumped' : 'found'
  }
  return 'idle'
})

const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const vA = ref<HTMLVideoElement | null>(null)
const vB = ref<HTMLVideoElement | null>(null)
const active = ref(0)
const popSlot = ref<number | null>(null)
/** White-ground clips need the multiply matte; transparent ones don't. */
const matte = ref(true)

let ext: 'webm' | 'mp4' = 'mp4'
let current: ClipName | 'away' | null = null
let pendingThen: ClipName | null = null
let settledFrom: 'answer' | null = null
let decayTimer: ReturnType<typeof setTimeout> | null = null
let token = 0 // invalidates in-flight transitions when a newer play() lands

function url(name: ClipName): string {
  return `/scout/${name}.${ext}`
}

function videos(): [HTMLVideoElement, HTMLVideoElement] | null {
  return vA.value && vB.value ? [vA.value, vB.value] : null
}

function clearDecay() {
  if (decayTimer) {
    clearTimeout(decayTimer)
    decayTimer = null
  }
}

function pace(ms: number): number {
  return props.fastDecay ? Math.round(ms * 0.08) : ms
}

/** Schedule the idle-decay step that follows the loop we just entered. */
function scheduleDecay(name: ClipName) {
  clearDecay()
  if (name === 'idle') {
    const delay = settledFrom === 'answer' ? SIT_AFTER_READ_MS : SIT_AFTER_MS
    decayTimer = setTimeout(() => play('sit'), pace(delay))
  } else if (name === 'sit-loop') {
    // Dogs really do stand up just to flop down — rise, then settle.
    decayTimer = setTimeout(() => play('sit-rise', 'lie'), pace(LIE_AFTER_MS))
  } else if (name === 'rest') {
    decayTimer = setTimeout(() => play('lie-rise', 'walk-out'), pace(LEAVE_AFTER_MS))
  }
}

/**
 * Crossfade to `name`. For one-shots, `andThen` (or the clip's default
 * `then`) plays when it ends.
 */
function play(name: ClipName, andThen: ClipName | null = null) {
  const pair = videos()
  if (!pair) return
  const myToken = ++token
  clearDecay()
  const next = pair[active.value === 0 ? 1 : 0]!
  const prev = pair[active.value]!
  const clip = CLIPS[name]
  const from = current
  pendingThen = andThen ?? clip.then ?? null

  next.onended = null
  next.ontimeupdate = null
  next.loop = !!clip.loop
  next.src = url(name)
  const started = next.play()
  if (started) started.catch(() => {})

  const onPlaying = () => {
    next.removeEventListener('playing', onPlaying)
    if (myToken !== token) return
    current = name
    const slot = active.value === 0 ? 1 : 0
    active.value = slot
    // a stance change gets the settle pop that sells the turn
    if (from && from !== 'away' && STANCE[from] !== STANCE[name]) {
      popSlot.value = slot
      setTimeout(() => {
        if (popSlot.value === slot) popSlot.value = null
      }, 420)
    }
    // let the crossfade finish before stopping the old clip
    setTimeout(() => {
      if (myToken === token) prev.pause()
    }, 380)
    if (clip.loop) {
      scheduleDecay(name)
      return
    }
    if (name === 'walk-out') {
      next.onended = () => {
        if (myToken === token) current = 'away' // empty final frame — invisible
      }
      return
    }
    // Hand off to the next clip while this one is still moving.
    let chained = false
    const chain = () => {
      if (myToken !== token || chained) return
      chained = true
      const follow = pendingThen
      pendingThen = null
      settledFrom = name === 'found' || name === 'stumped' ? 'answer' : null
      if (follow) play(follow)
    }
    next.ontimeupdate = () => {
      if (next.duration && next.duration - next.currentTime <= EARLY_SWAP_S) chain()
    }
    next.onended = chain // backstop (hidden-tab throttling can skip timeupdate)
  }
  next.addEventListener('playing', onPlaying)
}

/** Route to `target`, rising or returning first when he's settled/away. */
function wakeThen(target: ClipName) {
  if (current === 'away') {
    // Came back: straight to work for a question, hello otherwise.
    if (target === 'think') play('think')
    else if (target === 'idle') play('greet')
    else play('greet', target)
  } else if (current === 'sit' || current === 'sit-loop') {
    play('sit-rise', target === 'idle' ? null : target)
  } else if (current === 'lie' || current === 'rest') {
    play('lie-rise', target === 'idle' ? null : target)
  } else {
    play(target)
  }
}

/** Gentle attention cue (panel opened): stand back up if settled. */
function wake() {
  if (reducedMotion) return
  if (current === 'away') play('greet')
  else if (current === 'sit' || current === 'sit-loop') play('sit-rise')
  else if (current === 'lie' || current === 'rest') play('lie-rise')
  else if (current === 'idle') scheduleDecay('idle') // reset the decay clock
}

defineExpose({ wake })

watch(mood, (m) => {
  if (reducedMotion) return
  if (m === 'thinking') wakeThen('think')
  else if (m === 'found') wakeThen('found')
  else if (m === 'stumped') wakeThen('stumped')
  else wakeThen('idle')
})

watch(open, (isOpen) => {
  if (isOpen) wake()
})

/* Save battery while the tab is hidden. */
function onVisibility() {
  const pair = videos()
  if (!pair) return
  const vid = pair[active.value]!
  if (document.hidden) vid.pause()
  else if (!vid.ended) {
    const p = vid.play()
    if (p) p.catch(() => {})
  }
}

onMounted(() => {
  if (reducedMotion) return
  const probe = document.createElement('video')
  ext = probe.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'
  matte.value = !(WEBM_HAS_ALPHA && ext === 'webm')
  document.addEventListener('visibilitychange', onVisibility)
  // First appearance this session gets the hello; after that, quiet idle.
  let greeted = false
  try {
    greeted = sessionStorage.getItem('scout-greeted') === '1'
    if (!greeted) sessionStorage.setItem('scout-greeted', '1')
  } catch {
    /* storage unavailable — greet every time */
  }
  play(greeted ? 'idle' : 'greet')
})

onBeforeUnmount(() => {
  token++
  clearDecay()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="scout" :class="{ 'scout--matte': matte }" aria-hidden="true">
    <img v-if="reducedMotion" class="scout__vid scout__vid--on" src="/scout/poster.webp" alt="" />
    <template v-else>
      <video
        ref="vA"
        class="scout__vid"
        :class="{ 'scout__vid--on': active === 0, 'scout__vid--pop': popSlot === 0 }"
        muted
        playsinline
        preload="auto"
      />
      <video
        ref="vB"
        class="scout__vid"
        :class="{ 'scout__vid--on': active === 1, 'scout__vid--pop': popSlot === 1 }"
        muted
        playsinline
        preload="auto"
      />
    </template>
  </div>
</template>

<style scoped>
/* Standing on the page floor beside the Ask Scout button. No chrome: the
   multiply blend melts the clips' white ground into the page, leaving the
   dog and his contact shadow. Purely decorative, so clicks pass through. */
.scout {
  position: fixed;
  z-index: 31; /* just under the FAB (32), under the panel (75) */
  right: 66px;
  bottom: -4px;
  height: 96px;
  aspect-ratio: 1256 / 720;
  pointer-events: none;
}
/* Tablets: the trigger sits higher (above the dock) — Scout stays on the
   floor, tucked toward the corner under it. */
@media (min-width: 768px) and (max-width: 1023px) {
  .scout {
    right: 28px;
    height: 112px;
  }
}
@media (min-width: 1024px) {
  .scout {
    right: 158px; /* clears the labeled pill trigger */
    bottom: -6px;
    height: 124px;
  }
}
.scout__vid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 340ms ease;
  transform-origin: 50% 100%; /* settle pop grows up from the paws */
}
.scout--matte .scout__vid {
  mix-blend-mode: multiply;
}
.scout__vid--on {
  opacity: 1;
}
.scout__vid--pop {
  animation: scout-pop 400ms var(--ease-out, ease-out);
}
@keyframes scout-pop {
  from {
    transform: translateY(3.5%) scale(0.96);
  }
  to {
    transform: none;
  }
}
</style>
