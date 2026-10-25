<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

/**
 * Scout — the assistant's animated mascot.
 *
 * Plays short video clips (public/scout/*, cut from generated footage) on
 * two stacked <video> elements that crossfade. The panel only reports the
 * assistant's mood; this component owns the behavior chain:
 *
 *   greet → idle ─(45s)→ sit ─(75s)→ lie/rest        (idle decay)
 *   any mood change or wake() first plays the matching rise clip
 *   found / stumped play once, then settle back to idle
 *
 * Respects prefers-reduced-motion (static poster) and pauses off-screen.
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
}

/* Idle-decay pacing */
const SIT_AFTER_MS = 45_000
const LIE_AFTER_MS = 75_000

const props = defineProps<{
  mood: 'idle' | 'thinking' | 'found' | 'stumped'
}>()

const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const vA = ref<HTMLVideoElement | null>(null)
const vB = ref<HTMLVideoElement | null>(null)
const active = ref(0)

let ext: 'webm' | 'mp4' = 'mp4'
let current: ClipName | null = null
let pendingThen: ClipName | null = null
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

/** Schedule the idle-decay step that follows the loop we just entered. */
function scheduleDecay(name: ClipName) {
  clearDecay()
  if (name === 'idle') {
    decayTimer = setTimeout(() => play('sit'), SIT_AFTER_MS)
  } else if (name === 'sit-loop') {
    // Dogs really do stand up just to flop down — rise, then settle.
    decayTimer = setTimeout(() => play('sit-rise', 'lie'), LIE_AFTER_MS)
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
  pendingThen = andThen ?? clip.then ?? null

  next.onended = null
  next.loop = !!clip.loop
  next.src = url(name)
  const started = next.play()
  if (started) started.catch(() => {})

  const onPlaying = () => {
    next.removeEventListener('playing', onPlaying)
    if (myToken !== token) return
    current = name
    active.value = active.value === 0 ? 1 : 0
    // let the crossfade finish before stopping the old clip
    setTimeout(() => {
      if (myToken === token) prev.pause()
    }, 300)
    if (clip.loop) {
      scheduleDecay(name)
    } else {
      next.onended = () => {
        if (myToken !== token) return
        const follow = pendingThen
        pendingThen = null
        if (follow) play(follow)
      }
    }
  }
  next.addEventListener('playing', onPlaying)
}

/** If sitting or lying, rise first, then continue with `target`. */
function wakeThen(target: ClipName) {
  if (current === 'sit' || current === 'sit-loop') {
    play('sit-rise', target)
  } else if (current === 'lie' || current === 'rest') {
    play('lie-rise', target)
  } else {
    play(target)
  }
}

/** Gentle attention cue (composer focus): stand back up if settled. */
function wake() {
  if (reducedMotion) return
  if (current === 'sit' || current === 'sit-loop') play('sit-rise')
  else if (current === 'lie' || current === 'rest') play('lie-rise')
  else if (current === 'idle') scheduleDecay('idle') // reset the decay clock
}

defineExpose({ wake })

watch(
  () => props.mood,
  (mood) => {
    if (reducedMotion) return
    if (mood === 'thinking') wakeThen('think')
    else if (mood === 'found') wakeThen('found')
    else if (mood === 'stumped') wakeThen('stumped')
    else wakeThen('idle')
  },
)

/* Save battery while the tab is hidden. */
function onVisibility() {
  const pair = videos()
  if (!pair) return
  const vid = pair[active.value]!
  if (document.hidden) vid.pause()
  else {
    const p = vid.play()
    if (p) p.catch(() => {})
  }
}

onMounted(() => {
  if (reducedMotion) return
  const probe = document.createElement('video')
  ext = probe.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'
  document.addEventListener('visibilitychange', onVisibility)
  // First open this session gets the hello; after that, straight to idle.
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
  <div class="scout-stage" aria-hidden="true">
    <img v-if="reducedMotion" class="scout-stage__still" src="/scout/poster.webp" alt="" />
    <template v-else>
      <video
        ref="vA"
        class="scout-stage__vid"
        :class="{ 'scout-stage__vid--on': active === 0 }"
        muted
        playsinline
        preload="auto"
        poster="/scout/poster.webp"
      />
      <video
        ref="vB"
        class="scout-stage__vid"
        :class="{ 'scout-stage__vid--on': active === 1 }"
        muted
        playsinline
        preload="auto"
      />
    </template>
  </div>
</template>

<style scoped>
.scout-stage {
  position: relative;
  flex-shrink: 0;
  height: 132px;
  background: white;
  border-bottom: 1px solid var(--color-line);
  overflow: hidden;
}
@media (min-width: 768px) {
  .scout-stage {
    height: 148px;
  }
}
.scout-stage__vid,
.scout-stage__still {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.scout-stage__vid {
  opacity: 0;
  transition: opacity 240ms ease;
}
.scout-stage__vid--on {
  opacity: 1;
}
</style>
