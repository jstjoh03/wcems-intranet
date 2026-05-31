<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { ArrowLeft, ShieldCheck, Check, Lock, PartyPopper, Download } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { generateRequiredTrainingCertificate } from '@/lib/requiredTrainingCertificate'
import type { RequiredTraining } from '@/types'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  trainingById,
  completionFor,
  isComplete,
  markStarted,
  submitAttestation,
} = useRequiredTraining()

const trainingId = computed(() => String(route.params.id))
const training = computed<RequiredTraining | null>(() => trainingById(trainingId.value))

/* ── Anti-skip video state ───────────────────────────────────────── */
const videoEl = ref<HTMLVideoElement | null>(null)
const youtubeIframe = ref<HTMLIFrameElement | null>(null)
const maxWatched = ref(0)
const videoDuration = ref(0)
const pct = computed(() => {
  if (!videoDuration.value) return 0
  return Math.min(100, Math.round((maxWatched.value / videoDuration.value) * 100))
})
const videoComplete = ref(false)
let startedFired = false

/* localStorage key for resume — namespaced by user + module. */
const progressKey = computed(() => {
  const uid = auth.appUser?.id ?? 'anon'
  return `wcems:rt:progress:${uid}:${trainingId.value}`
})

function saveProgress(secs: number) {
  try {
    localStorage.setItem(progressKey.value, String(secs))
  } catch {
    /* quota */
  }
}
function loadSavedProgress(): number {
  try {
    const v = localStorage.getItem(progressKey.value)
    return v ? parseFloat(v) : 0
  } catch {
    return 0
  }
}

/* ── Direct / Cloudflare Stream MP4 handlers ─────────────────────── */
function onLoadedMetadata() {
  if (!videoEl.value) return
  videoDuration.value = videoEl.value.duration || training.value?.durationSeconds || 0
  const saved = loadSavedProgress()
  if (saved > 4 && saved < videoDuration.value - 3) {
    videoEl.value.currentTime = saved
    maxWatched.value = saved
  }
}

function onTimeUpdate() {
  if (!videoEl.value) return
  const cur = videoEl.value.currentTime
  if (cur > maxWatched.value) {
    maxWatched.value = cur
    saveProgress(cur)
  }
}

function onSeeking() {
  if (!videoEl.value) return
  /* Already-completed users can scrub freely — they've earned a
     re-watch without the anti-skip leash. */
  if (alreadyComplete.value) return
  if (videoEl.value.currentTime > maxWatched.value + 2) {
    videoEl.value.currentTime = maxWatched.value
  }
}

function onEnded() {
  videoComplete.value = true
  /* Clear saved progress — they finished. */
  try {
    localStorage.removeItem(progressKey.value)
  } catch {
    /* swallow */
  }
}

function onPlay() {
  if (startedFired) return
  startedFired = true
  void markStarted(trainingId.value)
}

/* ── YouTube IFrame API ──────────────────────────────────────────── */
/* Best-effort anti-skip for YouTube: poll currentTime, snap back if
   they scrub forward beyond maxWatched. Less strict than the MP4 path
   because YT's player has its own scrubber, but it logs progress. */
let ytPlayer: { getCurrentTime: () => number; seekTo: (s: number) => void; getDuration: () => number; getPlayerState: () => number } | null = null
let ytPoll: number | null = null
function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    type YTGlobal = Window & { YT?: { Player: new (...args: unknown[]) => unknown }; onYouTubeIframeAPIReady?: () => void }
    const w = window as YTGlobal
    if (w.YT && w.YT.Player) {
      resolve()
      return
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    w.onYouTubeIframeAPIReady = () => resolve()
  })
}

async function initYouTube(videoIdOrUrl: string) {
  await loadYouTubeAPI()
  const videoId = extractYouTubeId(videoIdOrUrl)
  if (!videoId || !youtubeIframe.value) return
  const w = window as Window & { YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => unknown } }
  if (!w.YT) return
  ytPlayer = new w.YT.Player(youtubeIframe.value, {
    videoId,
    playerVars: {
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        if (ytPlayer) {
          videoDuration.value = ytPlayer.getDuration() || training.value?.durationSeconds || 0
        }
      },
      onStateChange: (e: { data: number }) => {
        // 1 = playing
        if (e.data === 1 && !startedFired) {
          startedFired = true
          void markStarted(trainingId.value)
        }
      },
    },
  }) as typeof ytPlayer
  ytPoll = window.setInterval(() => {
    if (!ytPlayer) return
    const cur = ytPlayer.getCurrentTime()
    const dur = ytPlayer.getDuration()
    if (dur && !videoDuration.value) videoDuration.value = dur
    /* Free scrubbing on re-watch — same rule as the MP4 path. */
    if (!alreadyComplete.value && cur > maxWatched.value + 2) {
      ytPlayer.seekTo(maxWatched.value)
    } else if (cur > maxWatched.value) {
      maxWatched.value = cur
      saveProgress(cur)
    }
    if (dur && cur >= dur - 1.5 && !videoComplete.value) {
      videoComplete.value = true
      try {
        localStorage.removeItem(progressKey.value)
      } catch {
        /* swallow */
      }
    }
  }, 1000)
}

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim()
  // Already an ID?
  if (/^[\w-]{10,}$/.test(trimmed) && !trimmed.includes('/')) return trimmed
  try {
    const u = new URL(trimmed)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1) || null
    const v = u.searchParams.get('v')
    if (v) return v
    // /embed/<id>
    const m = u.pathname.match(/\/embed\/([\w-]+)/)
    if (m) return m[1]
  } catch {
    /* ignore */
  }
  return null
}

/* ── Init on training load ───────────────────────────────────────── */
watch(
  training,
  async (t) => {
    if (!t) return
    if (isComplete(t.id)) {
      videoComplete.value = true
    }
    if (t.videoSource === 'youtube') {
      await initYouTube(t.videoRef)
    }
  },
  { immediate: false },
)

onMounted(() => {
  // Defer YT init slightly so the iframe ref is bound.
  setTimeout(async () => {
    if (training.value?.videoSource === 'youtube') {
      await initYouTube(training.value.videoRef)
    }
  }, 100)
})

onBeforeUnmount(() => {
  if (ytPoll) window.clearInterval(ytPoll)
})

/* ── Attestation + submit ────────────────────────────────────────── */
const signatureData = ref<string>('')
const submitting = ref(false)
const errorMsg = ref<string | null>(null)
const justSubmitted = ref(false)

const alreadyComplete = computed(() => isComplete(trainingId.value))

const defaultAttestation = [
  'I have watched this training video in its entirety.',
  'I understand the content as presented.',
  'I agree to apply this guidance in my work.',
]

const statementLines = computed(() => {
  const t = training.value
  if (!t || !t.attestationStatement.trim()) return defaultAttestation
  return t.attestationStatement
    .split('\n')
    .map((s) => s.replace(/^\s*[-•]\s*/, '').trim())
    .filter((s) => s.length > 0)
})

async function onSubmit() {
  errorMsg.value = null
  if (!videoComplete.value) {
    errorMsg.value = 'You must watch the full video before submitting.'
    return
  }
  if (!signatureData.value) {
    errorMsg.value = 'Please sign before submitting.'
    return
  }
  if (!training.value || !auth.appUser) {
    errorMsg.value = 'Sign in to submit.'
    return
  }
  submitting.value = true
  try {
    const result = await submitAttestation(trainingId.value, signatureData.value)
    if (!result.ok) {
      errorMsg.value = result.error
      return
    }
    /* Auto-download certificate. */
    const freshCompletion = completionFor(trainingId.value)
    const doc = await generateRequiredTrainingCertificate({
      employeeName: auth.appUser.fullName || auth.appUser.email,
      moduleTitle: training.value.title,
      verificationId: freshCompletion?.id.slice(0, 8) ?? undefined,
    })
    const safeName = (auth.appUser.fullName || 'employee').replace(/\s+/g, '_')
    const safeTitle = training.value.title.replace(/\s+/g, '_')
    doc.save(`WCEMS_Certificate_${safeName}_${safeTitle}.pdf`)
    justSubmitted.value = true
  } catch (err) {
    errorMsg.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

/* Re-download a certificate for an already-completed module. */
async function downloadCertificate() {
  if (!training.value || !auth.appUser) return
  const completion = completionFor(trainingId.value)
  const doc = await generateRequiredTrainingCertificate({
    employeeName: auth.appUser.fullName || auth.appUser.email,
    moduleTitle: training.value.title,
    completionDate: completion?.completedAt ? new Date(completion.completedAt) : undefined,
    verificationId: completion?.id.slice(0, 8) ?? undefined,
  })
  const safeName = (auth.appUser.fullName || 'employee').replace(/\s+/g, '_')
  const safeTitle = training.value.title.replace(/\s+/g, '_')
  doc.save(`WCEMS_Certificate_${safeName}_${safeTitle}.pdf`)
}

function back() {
  router.push('/training/required')
}

/* ── Embed URLs for non-YT sources ───────────────────────────────── */
const directSrc = computed(() => {
  if (!training.value) return ''
  const t = training.value
  if (t.videoSource === 'direct' || t.videoSource === 'sharepoint') return t.videoRef
  if (t.videoSource === 'cloudflare_stream') {
    // Accept either a full URL or a stream id.
    if (t.videoRef.startsWith('http')) return t.videoRef
    return `https://customer-${t.videoRef}.cloudflarestream.com/manifest/video.m3u8`
  }
  return ''
})

const isYoutube = computed(() => training.value?.videoSource === 'youtube')
</script>

<template>
  <div class="rtd">
    <button type="button" class="rtd__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Back to Required Training
    </button>

    <div v-if="!ready" class="rtd__empty">Loading…</div>
    <div v-else-if="!training" class="rtd__empty">
      Training module not found.
      <RouterLink to="/training/required" class="rtd__link">Back to list</RouterLink>
    </div>

    <template v-else>
      <header class="rtd__header">
        <div class="flex items-center gap-2">
          <ShieldCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
          <h1 class="display rtd__title">{{ training.title }}</h1>
        </div>
        <p v-if="training.description" class="rtd__desc">{{ training.description }}</p>
      </header>

      <!-- Already complete (revisit) -->
      <AppCard v-if="alreadyComplete && !justSubmitted" class="rtd__done-card">
        <div class="rtd__done-icon">
          <Check :size="22" :stroke-width="2.25" />
        </div>
        <div>
          <div class="rtd__done-head display">You've already completed this training.</div>
          <p class="rtd__done-sub">
            Completed {{ new Date(completionFor(trainingId)?.completedAt ?? '').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }}.
            You can re-download the certificate any time.
          </p>
          <button type="button" class="rtd__btn rtd__btn--secondary" @click="downloadCertificate">
            <Download :size="14" :stroke-width="2" />
            Download certificate
          </button>
        </div>
      </AppCard>

      <!-- Video — always visible (except when just-submitted, where the
           celebration card takes over). Already-complete users get free
           scrubbing for re-watch; first-time users get anti-skip. -->
      <AppCard v-if="!justSubmitted" class="rtd__video-card">
        <div class="rtd__video-label">
          <Eyebrow>{{ alreadyComplete ? 'Re-watch · training video' : 'Training video' }}</Eyebrow>
          <span class="rtd__lock" :class="{ 'rtd__lock--unlocked': videoComplete || alreadyComplete }">
            <template v-if="alreadyComplete">
              <Check :size="12" :stroke-width="2.5" /> Completed
            </template>
            <template v-else-if="videoComplete">
              <Check :size="12" :stroke-width="2.5" /> Video complete
            </template>
            <template v-else>
              <Lock :size="12" :stroke-width="2" /> Attestation unlocks at the end
            </template>
          </span>
        </div>

        <div class="rtd__video-wrap">
          <video
            v-if="!isYoutube"
            ref="videoEl"
            controls
            controlslist="nodownload noremoteplayback"
            disablepictureinpicture
            playsinline
            :src="directSrc"
            class="rtd__video"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
            @seeking="onSeeking"
            @ended="onEnded"
            @play="onPlay"
          />
          <div v-else class="rtd__yt-wrap">
            <div ref="youtubeIframe" class="rtd__yt-iframe" />
          </div>
        </div>

        <div class="rtd__progress">
          <template v-if="alreadyComplete">
            <p class="rtd__progress-note rtd__progress-note--done">
              <Check :size="12" :stroke-width="2.5" />
              You've already completed and signed this training. Scrub freely.
            </p>
          </template>
          <template v-else>
            <div class="rtd__progress-row">
              <span class="rtd__progress-label">Watch progress</span>
              <span class="rtd__progress-pct">{{ pct }}%</span>
            </div>
            <div class="rtd__progress-track">
              <div
                class="rtd__progress-fill"
                :class="{ 'rtd__progress-fill--done': videoComplete }"
                :style="{ width: pct + '%' }"
              />
            </div>
            <p class="rtd__progress-note">
              <template v-if="isYoutube">
                YouTube player &middot; If you scrub ahead, the player will snap back to your last watched point.
              </template>
              <template v-else>
                Skipping ahead is disabled. The attestation form unlocks when you finish.
              </template>
            </p>
          </template>
        </div>
      </AppCard>

      <!-- Attestation -->
      <AppCard v-if="videoComplete && !alreadyComplete && !justSubmitted" class="rtd__att-card">
        <Eyebrow class="mb-3">Attestation of Completion</Eyebrow>

        <div class="rtd__att-user">
          <span class="rtd__att-user-label">Completing as</span>
          <span class="rtd__att-user-name">{{ auth.appUser?.fullName ?? auth.appUser?.email }}</span>
        </div>

        <div class="rtd__att-statement">
          <p class="rtd__att-statement-intro">By signing below, I attest that:</p>
          <ul class="rtd__att-statement-list">
            <li v-for="(line, i) in statementLines" :key="i">{{ line }}</li>
          </ul>
          <p class="rtd__att-statement-fine">
            This electronic signature carries the same weight as a physical signature and
            constitutes an official acknowledgment of training completion.
          </p>
        </div>

        <Eyebrow class="mb-2">Your signature</Eyebrow>
        <SignaturePad @change="(d) => (signatureData = d)" />

        <div v-if="errorMsg" class="rtd__error">{{ errorMsg }}</div>

        <div class="rtd__att-actions">
          <button
            type="button"
            class="rtd__btn rtd__btn--primary"
            :disabled="submitting || !signatureData"
            @click="onSubmit"
          >
            {{ submitting ? 'Submitting…' : 'Submit attestation' }}
          </button>
        </div>
      </AppCard>

      <!-- Just submitted -->
      <AppCard v-if="justSubmitted" class="rtd__done-card rtd__done-card--celebrate">
        <div class="rtd__done-icon rtd__done-icon--success">
          <PartyPopper :size="22" :stroke-width="2" />
        </div>
        <div>
          <div class="rtd__done-head display">Attestation submitted!</div>
          <p class="rtd__done-sub">
            Your completion has been recorded and your certificate has downloaded.
            Thank you for completing the training.
          </p>
          <button type="button" class="rtd__btn rtd__btn--secondary" @click="downloadCertificate">
            <Download :size="14" :stroke-width="2" />
            Re-download certificate
          </button>
        </div>
      </AppCard>
    </template>
  </div>
</template>

<style scoped>
.rtd {
  max-width: 880px;
  margin: 0 auto;
  padding: 20px 16px 80px;
}
@media (min-width: 768px) {
  .rtd {
    padding: 32px 40px 80px;
  }
}
.rtd__back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 0;
  margin-bottom: 8px;
}
.rtd__back:hover {
  color: var(--color-ink-soft);
}
.rtd__header {
  margin-bottom: 16px;
}
.rtd__title {
  font-size: 24px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .rtd__title {
    font-size: 30px;
  }
}
.rtd__desc {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink-soft);
}
.rtd__empty {
  margin-top: 32px;
  padding: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.rtd__link {
  display: block;
  margin-top: 10px;
  color: var(--color-brand-600);
}

/* Video card */
.rtd__video-card {
  padding: 0 !important;
  overflow: hidden;
}
.rtd__video-label {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-line);
}
.rtd__lock {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 999px;
  background: oklch(0.96 0.04 80);
  color: oklch(0.45 0.13 75);
  border: 1px solid oklch(0.88 0.07 80);
}
.rtd__lock--unlocked {
  background: #f0f8f3;
  color: var(--color-success-500);
  border-color: #c6e4d2;
}
.rtd__video-wrap {
  background: #000;
}
.rtd__video {
  width: 100%;
  max-height: 520px;
  display: block;
  background: #000;
}
.rtd__yt-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
/* YT.Player replaces our placeholder <div> with an <iframe> that lives
   outside Vue's scoped-style attribute, so a plain selector can't
   reach it. `:deep()` lets the rule cross into the injected iframe. */
.rtd__yt-wrap :deep(iframe) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.rtd__yt-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.rtd__progress {
  padding: 12px 16px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-line);
}
.rtd__progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.rtd__progress-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}
.rtd__progress-pct {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-brand-700);
}
.rtd__progress-track {
  height: 6px;
  background: oklch(0.94 0.01 250);
  border-radius: 3px;
  overflow: hidden;
}
.rtd__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-brand-600), var(--color-brand-700));
  border-radius: 3px;
  transition: width 0.5s ease;
}
.rtd__progress-fill--done {
  background: linear-gradient(90deg, var(--color-success-500), #22c55e);
}
.rtd__progress-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-muted);
}
.rtd__progress-note--done {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 12px;
  color: var(--color-success-500);
  font-weight: 600;
}

/* Attestation card */
.rtd__att-card {
  margin-top: 14px;
  padding: 18px !important;
}
.rtd__att-user {
  background: var(--color-brand-50);
  border: 1px solid var(--color-brand-100);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.rtd__att-user-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-brand-700);
}
.rtd__att-user-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-ink);
}
.rtd__att-statement {
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-left: 3px solid var(--color-brand-600);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 18px;
}
.rtd__att-statement-intro {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 8px;
}
.rtd__att-statement-list {
  margin: 0 0 10px 18px;
  padding: 0;
}
.rtd__att-statement-list li {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-ink);
}
.rtd__att-statement-fine {
  font-size: 11.5px;
  color: var(--color-muted);
  line-height: 1.55;
}
.rtd__error {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
}
.rtd__att-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

/* Done cards */
.rtd__done-card {
  margin-top: 14px;
  padding: 18px !important;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.rtd__done-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-brand-50);
  color: var(--color-brand-600);
}
.rtd__done-icon--success {
  background: #f0f8f3;
  color: var(--color-success-500);
}
.rtd__done-head {
  font-size: 18px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.rtd__done-sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}

/* Buttons */
.rtd__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 9px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out);
  margin-top: 12px;
}
.rtd__btn--primary {
  background: var(--color-brand-600);
  color: white;
}
.rtd__btn--primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.rtd__btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.rtd__btn--secondary {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.rtd__btn--secondary:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
