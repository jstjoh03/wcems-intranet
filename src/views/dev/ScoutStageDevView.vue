<script setup lang="ts">
import { ref } from 'vue'
import ScoutStage from '@/components/assistant/ScoutStage.vue'

/**
 * Dev-only harness for the Scout mascot stage (route registered only when
 * import.meta.env.DEV). Buttons drive the same mood prop + wake() API the
 * assistant panel uses, so every transition can be exercised without auth.
 */

const mood = ref<'idle' | 'thinking' | 'found' | 'stumped'>('idle')
const stage = ref<InstanceType<typeof ScoutStage> | null>(null)
const log = ref<string[]>([])

function set(m: typeof mood.value) {
  mood.value = m
  log.value.unshift(`${new Date().toLocaleTimeString()} → mood: ${m}`)
}
function wake() {
  stage.value?.wake()
  log.value.unshift(`${new Date().toLocaleTimeString()} → wake()`)
}
</script>

<template>
  <div class="dev">
    <div class="dev__panel">
      <ScoutStage ref="stage" :mood="mood" />
      <div class="dev__controls">
        <button @click="set('idle')">idle</button>
        <button @click="set('thinking')">thinking</button>
        <button @click="set('found')">found</button>
        <button @click="set('stumped')">stumped</button>
        <button @click="wake()">wake()</button>
      </div>
      <p class="dev__hint">
        Decay: idle → sit after 45s, sit → lie after 75s more. Mood buttons from a settled
        posture should rise first.
      </p>
      <ol class="dev__log">
        <li v-for="(l, i) in log" :key="i">{{ l }}</li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.dev {
  min-height: 100vh;
  background: var(--color-canvas);
  display: flex;
  justify-content: center;
  padding: 40px 16px;
}
.dev__panel {
  width: 432px;
  max-width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 18px;
  overflow: hidden;
  background: var(--color-surface);
  align-self: flex-start;
}
.dev__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px;
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
.dev__hint {
  padding: 0 14px 10px;
  font-size: 12px;
  color: var(--color-muted);
}
.dev__log {
  margin: 0;
  padding: 0 14px 14px 30px;
  font-size: 11.5px;
  color: var(--color-ink-soft);
  max-height: 180px;
  overflow-y: auto;
}
</style>
