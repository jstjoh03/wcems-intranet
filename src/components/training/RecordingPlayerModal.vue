<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { X } from 'lucide-vue-next'
import {
  isInlineFileSource,
  isIframeSource,
  resolvePlayUrl,
} from '@/lib/videoSource'
import type { TrainingRecording } from '@/composables/useTrainingRecordings'
import { incrementRecordingView } from '@/composables/useTrainingRecordings'

const props = defineProps<{ recording: TrainingRecording | null }>()
const emit = defineEmits<{ close: [] }>()

const videoEl = ref<HTMLVideoElement | null>(null)
let viewCounted = false

const playUrl = computed(() => {
  if (!props.recording) return null
  return resolvePlayUrl(props.recording.videoSource, props.recording.videoRef)
})

const inlineFile = computed(
  () => !!props.recording && isInlineFileSource(props.recording.videoSource),
)
const iframeFile = computed(
  () => !!props.recording && isIframeSource(props.recording.videoSource),
)

/* Count a view only once playback actually starts past 5 seconds. That
   filters out accidental clicks where the modal opens and immediately
   closes — those shouldn't bump the counter. iframe sources don't fire
   timeupdate events we can see, so for those we count on modal-open
   instead (best we can do without per-host JS SDKs). */
function onTimeUpdate() {
  if (!videoEl.value || !props.recording || viewCounted) return
  if (videoEl.value.currentTime >= 5) {
    viewCounted = true
    void incrementRecordingView(props.recording.id)
  }
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onEsc)
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  document.body.style.overflow = ''
})

/* Reset the view-count guard whenever a new recording opens. The modal
   stays mounted across recordings since the parent v-if keys on
   `recording`, so we have to clear the flag ourselves. */
watch(
  () => props.recording?.id,
  (id) => {
    viewCounted = false
    if (id && iframeFile.value && props.recording) {
      void incrementRecordingView(props.recording.id)
      viewCounted = true
    }
  },
)

const metaLine = computed(() => {
  if (!props.recording) return ''
  const parts: string[] = []
  if (props.recording.instructor) parts.push(props.recording.instructor)
  if (props.recording.durationMinutes) parts.push(`${props.recording.durationMinutes} min`)
  if (props.recording.recordedAt) {
    const d = new Date(props.recording.recordedAt + 'T00:00:00')
    parts.push(
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    )
  }
  return parts.join(' · ')
})
</script>

<template>
  <div v-if="recording" class="rpm-overlay" @click.self="emit('close')">
    <div class="rpm" role="dialog" aria-modal="true" :aria-label="recording.title">
      <button
        type="button"
        class="rpm__close"
        aria-label="Close player"
        @click.stop.prevent="emit('close')"
      >
        <X :size="18" />
      </button>

      <div class="rpm__stage">
        <!-- Direct file (Wix CDN mp4, any direct URL) — full native control. -->
        <video
          v-if="inlineFile && playUrl"
          ref="videoEl"
          class="rpm__video"
          :src="playUrl"
          controls
          controlsList="nodownload"
          playsinline
          preload="metadata"
          @timeupdate="onTimeUpdate"
        />

        <!-- Embed via iframe (SharePoint, YouTube). Player chrome comes
             from the host, but the surrounding modal still feels intranet-native. -->
        <iframe
          v-else-if="iframeFile && playUrl"
          class="rpm__iframe"
          :src="playUrl"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
          :title="recording.title"
        />

        <div v-else class="rpm__error">
          This recording's URL couldn't be resolved. Ask an admin to check the link.
        </div>
      </div>

      <div class="rpm__meta">
        <div class="rpm__title display">{{ recording.title }}</div>
        <div v-if="metaLine" class="rpm__sub">{{ metaLine }}</div>
        <p v-if="recording.description" class="rpm__desc">{{ recording.description }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rpm-overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.08 0.015 260 / 0.78);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.rpm {
  position: relative;
  width: 100%;
  max-width: 1040px;
  background: var(--color-surface);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  max-height: 92vh;
}

.rpm__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: oklch(0 0 0 / 0.45);
  color: white;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.rpm__close:hover {
  background: oklch(0 0 0 / 0.65);
}

.rpm__stage {
  width: 100%;
  background: #000;
  aspect-ratio: 16 / 9;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rpm__video,
.rpm__iframe {
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
  background: #000;
}

.rpm__error {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: white;
}

.rpm__meta {
  padding: 16px 20px 18px;
  overflow-y: auto;
}
.rpm__title {
  font-size: 20px;
  color: var(--color-ink);
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.rpm__sub {
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}
.rpm__desc {
  margin-top: 10px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
  white-space: pre-line;
}

@media (max-width: 600px) {
  .rpm-overlay {
    padding: 0;
  }
  .rpm {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
  }
}
</style>
