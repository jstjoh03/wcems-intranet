<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { Camera, RefreshCw, X } from 'lucide-vue-next'
import { compressImage } from '@/lib/imageCompress'

/**
 * Evidence photo picker. The camera/library opens through a <label for>
 * — no scripted input.click(), which on iOS Safari can double-fire and
 * reset the input so `change` never lands (the uniforms-app bug). The
 * photo is downscaled as soon as it's picked, so the upload on submit
 * is small and fast.
 */
const props = defineProps<{
  modelValue: Blob | null
  label?: string
  hint?: string
  required?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Blob | null] }>()

const inputId = `eq-photo-${Math.random().toString(36).slice(2, 9)}`
const preview = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

function setPreview(blob: Blob | null) {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = blob ? URL.createObjectURL(blob) : null
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return
  if (file.size === 0) {
    error.value =
      'That photo came through empty. If it’s stored in iCloud, let it finish downloading and try again.'
    return
  }
  error.value = null
  busy.value = true
  try {
    const blob = await compressImage(file)
    if (blob.size > 10 * 1024 * 1024) {
      error.value = 'That photo is over 10 MB. Take a new one instead.'
      return
    }
    setPreview(blob)
    emit('update:modelValue', blob)
  } finally {
    busy.value = false
  }
}

function clear() {
  setPreview(null)
  emit('update:modelValue', null)
}

/* Parent reset (sheet reopened) clears the preview too. */
watch(
  () => props.modelValue,
  (v) => {
    if (!v) setPreview(null)
  },
)

onBeforeUnmount(() => setPreview(null))
</script>

<template>
  <div class="eqp">
    <div v-if="label" class="eq-label">
      <span>{{ label }}</span>
      <span v-if="required" class="eq-label__req">Required</span>
    </div>

    <label
      v-if="!preview"
      :for="inputId"
      class="eqp__drop"
      :class="{ 'eqp__drop--busy': busy }"
    >
      <span class="eqp__icon"><Camera :size="22" :stroke-width="1.75" /></span>
      <span class="eqp__drop-title">{{ busy ? 'Preparing photo…' : 'Take or choose a photo' }}</span>
      <span v-if="hint" class="eqp__drop-hint">{{ hint }}</span>
    </label>

    <div v-else class="eqp__preview">
      <img :src="preview" alt="Photo to attach" />
      <div class="eqp__preview-bar">
        <label :for="inputId" class="eqp__mini">
          <RefreshCw :size="14" :stroke-width="2" /> Retake
        </label>
        <button type="button" class="eqp__mini" @click="clear">
          <X :size="14" :stroke-width="2" /> Remove
        </button>
      </div>
    </div>

    <input
      :id="inputId"
      type="file"
      accept="image/*"
      class="sr-only"
      :disabled="busy"
      @change="onPick"
    />
    <p v-if="error" class="eq-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.eqp {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eqp__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 132px;
  padding: 18px;
  text-align: center;
  background:
    radial-gradient(ellipse 80% 70% at 50% 0%, oklch(0.734 0.114 86.8 / 0.08), transparent 70%),
    var(--color-surface);
  border: 1.5px dashed var(--color-accent-600);
  border-radius: 14px;
  cursor: pointer;
  transition:
    background 150ms var(--ease-out),
    border-color 150ms var(--ease-out);
}
.eqp__drop:hover {
  background:
    radial-gradient(ellipse 80% 70% at 50% 0%, oklch(0.734 0.114 86.8 / 0.14), transparent 70%),
    var(--color-surface);
}
.eqp__drop--busy {
  cursor: progress;
  opacity: 0.75;
}
.eqp__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  color: var(--color-accent-on-dark);
  background: linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  box-shadow: 0 6px 14px -6px oklch(0.22 0.1 250 / 0.6);
}
.eqp__drop-title {
  margin-top: 4px;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.eqp__drop-hint {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--color-muted);
  max-width: 300px;
}
.eqp__preview {
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  background: var(--color-brand-950);
  box-shadow: var(--shadow-md);
}
.eqp__preview img {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: contain;
}
.eqp__preview-bar {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 6px;
}
.eqp__mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 12px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: white;
  background: oklch(0.16 0.07 250 / 0.72);
  border: 1px solid oklch(1 0 0 / 0.18);
  border-radius: 999px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  cursor: pointer;
}
</style>
