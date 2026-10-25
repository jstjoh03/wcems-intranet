<script setup lang="ts">
import { ref } from 'vue'
import ScoutMascot from '@/components/assistant/ScoutMascot.vue'

/**
 * Dev-only harness for the Scout mascot (route registered only when
 * import.meta.env.DEV). The mascot fixes itself to the page's bottom-right
 * exactly as in production; the page behind it is dummy portal content so
 * the multiply-matte cutout can be judged over real-looking surfaces.
 * Buttons drive moodOverride; fast decay runs the settle chain at ~12x.
 */

const mood = ref<'idle' | 'thinking' | 'found' | 'stumped' | null>(null)
const fast = ref(true)
const mascot = ref<InstanceType<typeof ScoutMascot> | null>(null)
const log = ref<string[]>([])

function set(m: typeof mood.value) {
  mood.value = m
  log.value.unshift(`${new Date().toLocaleTimeString()} → mood: ${m ?? 'auto'}`)
}
function wake() {
  mascot.value?.wake()
  log.value.unshift(`${new Date().toLocaleTimeString()} → wake()`)
}
</script>

<template>
  <div class="dev">
    <div class="dev__card">
      <h1 class="display">Scout mascot harness</h1>
      <div class="dev__controls">
        <button :class="{ on: mood === null }" @click="set(null)">auto</button>
        <button :class="{ on: mood === 'idle' }" @click="set('idle')">idle</button>
        <button :class="{ on: mood === 'thinking' }" @click="set('thinking')">thinking</button>
        <button :class="{ on: mood === 'found' }" @click="set('found')">found</button>
        <button :class="{ on: mood === 'stumped' }" @click="set('stumped')">stumped</button>
        <button @click="wake()">wake()</button>
        <label class="dev__fast"><input v-model="fast" type="checkbox" /> fast decay (~12x)</label>
      </div>
      <p class="dev__hint">
        Fast decay: idle → sit ~3.6s · sit → lie ~6s · rest → walks off ~19s. From settled or
        away, mood buttons should rise / return first. Scout stands bottom-right, over the page.
      </p>
      <ol class="dev__log">
        <li v-for="(l, i) in log" :key="i">{{ l }}</li>
      </ol>
    </div>

    <!-- dummy portal content to judge the cutout over -->
    <div class="dev__card">
      <h2>Station 201 — shift notes</h2>
      <p>
        Medic 271 checked out at 0700. Narcotics counts verified by both medics; the LifePak
        passed its daily. Fuel card is in the console, and the station printer finally has toner.
      </p>
      <p>
        Scout should read as a character standing on this page — soft shadow under his paws, no
        white rectangle, blends over text and cards alike.
      </p>
    </div>

    <ScoutMascot ref="mascot" :mood-override="mood" :fast-decay="fast" />
  </div>
</template>

<style scoped>
.dev {
  min-height: 100vh;
  background: var(--color-canvas);
  padding: 32px 16px 160px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}
.dev__card {
  width: 640px;
  max-width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  padding: 18px;
}
.dev__card h1 {
  font-size: 22px;
  margin-bottom: 10px;
}
.dev__card h2 {
  font-size: 15px;
  margin-bottom: 8px;
}
.dev__card p {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--color-ink-soft);
  margin-bottom: 8px;
}
.dev__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.dev__controls button {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.dev__controls button:hover {
  border-color: var(--color-accent-500);
}
.dev__controls button.on {
  border-color: var(--color-accent-500);
  background: var(--color-surface-soft);
}
.dev__fast {
  font-size: 12.5px;
  color: var(--color-ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dev__hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-muted);
}
.dev__log {
  margin: 10px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  color: var(--color-ink-soft);
  max-height: 140px;
  overflow-y: auto;
}
</style>
