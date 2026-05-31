<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Eraser } from 'lucide-vue-next'

/**
 * Canvas signature pad. Emits 'change' with a data URL on every stroke
 * end so parents can keep their submit button enabled/disabled.
 *
 * Mirrors the Wix protocol-training canvas — devicePixelRatio-aware so
 * lines stay sharp on retina, supports both mouse and touch.
 */

const props = defineProps<{
  height?: number
}>()

const emit = defineEmits<{ change: [data: string] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isEmpty = ref(true)

let ctx: CanvasRenderingContext2D | null = null
let drawing = false
let lastX = 0
let lastY = 0
let touched = false

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx = canvas.getContext('2d')
  if (ctx) ctx.scale(dpr, dpr)
}

function pos(e: MouseEvent | TouchEvent): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const r = canvas.getBoundingClientRect()
  if ('touches' in e) {
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top }
  }
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function start(e: MouseEvent | TouchEvent) {
  drawing = true
  const p = pos(e)
  lastX = p.x
  lastY = p.y
}

function move(e: MouseEvent | TouchEvent) {
  if (!drawing || !ctx) return
  if ('touches' in e && e.cancelable) e.preventDefault()
  const p = pos(e)
  ctx.beginPath()
  ctx.moveTo(lastX, lastY)
  ctx.lineTo(p.x, p.y)
  ctx.strokeStyle = '#0F1A33'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.stroke()
  lastX = p.x
  lastY = p.y
  touched = true
}

function end() {
  if (!drawing) return
  drawing = false
  const canvas = canvasRef.value
  if (!canvas) return
  if (touched) {
    isEmpty.value = false
    emit('change', canvas.toDataURL('image/png'))
  }
}

function clear() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  isEmpty.value = true
  touched = false
  emit('change', '')
}

defineExpose({ clear, isEmpty })

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas)
})

/* When the height prop changes (rare), re-rasterize so DPR matches. */
watch(
  () => props.height,
  () => resizeCanvas(),
)
</script>

<template>
  <div class="sigpad">
    <div class="sigpad__wrap" :style="{ height: (props.height ?? 140) + 'px' }">
      <canvas
        ref="canvasRef"
        class="sigpad__canvas"
        @mousedown="start"
        @mousemove="move"
        @mouseup="end"
        @mouseleave="end"
        @touchstart.passive="start"
        @touchmove="move"
        @touchend="end"
      />
      <div v-if="isEmpty" class="sigpad__placeholder">Sign here</div>
    </div>
    <div class="sigpad__actions">
      <span class="sigpad__hint">Sign with your finger or mouse</span>
      <button type="button" class="sigpad__clear" @click="clear">
        <Eraser :size="12" :stroke-width="2" />
        Clear
      </button>
    </div>
  </div>
</template>

<style scoped>
.sigpad {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sigpad__wrap {
  position: relative;
  border: 2px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  overflow: hidden;
}
.sigpad__canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}
.sigpad__placeholder {
  pointer-events: none;
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--color-muted);
  font-style: italic;
}
.sigpad__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sigpad__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.sigpad__clear {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.sigpad__clear:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
