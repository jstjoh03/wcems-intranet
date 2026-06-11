<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker?worker'

/**
 * Inline PDF viewer with scroll-to-end tracking.
 *
 *  - Renders every page as a canvas stacked vertically inside a
 *    fixed-height scrollable container.
 *  - Uses an IntersectionObserver on the LAST page's bottom edge to
 *    detect when the user has scrolled all the way through. Once
 *    triggered, emits `reached-end` and stays "reached" even if they
 *    scroll back up.
 *  - Responsive: each page renders at the container's width (with DPR
 *    scaling for crisp text on retina screens).
 *  - PDF.js worker is bundled via Vite's `?worker` import — no CDN
 *    URL, no CSP holes, works offline once the SW caches it.
 */

const props = defineProps<{
  /** Public URL to the PDF file. */
  url: string
}>()

const emit = defineEmits<{
  'reached-end': []
  loaded: [pageCount: number]
  error: [message: string]
}>()

/* PDF.js requires the worker URL be set once at module level. We pass
   Vite's worker constructor — pdfjs-dist accepts `workerPort` as a
   pre-instantiated Worker. This avoids the CDN fallback that pdfjs
   would otherwise reach for. */
const workerInstance = new PdfWorker()
;(pdfjsLib.GlobalWorkerOptions as { workerPort?: Worker }).workerPort = workerInstance

const containerEl = ref<HTMLElement | null>(null)
const pagesEl = ref<HTMLElement | null>(null)
const pageCount = ref(0)
const loading = ref(true)
const loadError = ref<string | null>(null)
const reachedEnd = ref(false)
const highestPageSeen = ref(0)

const progressPct = computed(() => {
  if (!pageCount.value) return 0
  return Math.round((highestPageSeen.value / pageCount.value) * 100)
})

let observer: IntersectionObserver | null = null
let lastPageEl: HTMLElement | null = null
let pageObserver: IntersectionObserver | null = null

async function renderPdf() {
  if (!pagesEl.value) return
  loading.value = true
  loadError.value = null
  reachedEnd.value = false
  highestPageSeen.value = 0
  pagesEl.value.innerHTML = ''

  try {
    const doc = await pdfjsLib.getDocument({ url: props.url }).promise
    pageCount.value = doc.numPages
    emit('loaded', doc.numPages)

    const containerWidth = pagesEl.value.clientWidth
    const dpr = window.devicePixelRatio || 1

    const pageElements: HTMLElement[] = []
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const scale = (containerWidth - 4) / viewport.width
      const scaled = page.getViewport({ scale })

      const wrap = document.createElement('div')
      wrap.className = 'pdfv__page-wrap'
      wrap.dataset.page = String(i)

      const canvas = document.createElement('canvas')
      canvas.className = 'pdfv__canvas'
      canvas.width = Math.floor(scaled.width * dpr)
      canvas.height = Math.floor(scaled.height * dpr)
      canvas.style.width = `${Math.floor(scaled.width)}px`
      canvas.style.height = `${Math.floor(scaled.height)}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.scale(dpr, dpr)
      await page.render({ canvasContext: ctx, viewport: scaled, canvas }).promise

      const label = document.createElement('div')
      label.className = 'pdfv__page-label'
      label.textContent = `Page ${i} of ${doc.numPages}`

      wrap.appendChild(canvas)
      wrap.appendChild(label)
      pagesEl.value.appendChild(wrap)
      pageElements.push(wrap)
    }

    /* Watch the last page's bottom edge — when it enters the viewport
       fully, the user has scrolled through everything. */
    lastPageEl = pageElements[pageElements.length - 1] ?? null
    if (lastPageEl && containerEl.value) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            reachedEnd.value = true
            highestPageSeen.value = pageCount.value
            emit('reached-end')
            observer?.disconnect()
            observer = null
          }
        },
        {
          root: containerEl.value,
          /* Trigger when at least 50% of the last page is visible —
             feels more like "they got to the end" than waiting for
             the absolute bottom edge. */
          threshold: 0.5,
        },
      )
      observer.observe(lastPageEl)
    }

    /* Independent observer for progress hint — fires on every page
       boundary so the % label tracks reading position. */
    if (containerEl.value) {
      pageObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const n = Number((entry.target as HTMLElement).dataset.page)
              if (n > highestPageSeen.value) highestPageSeen.value = n
            }
          }
        },
        { root: containerEl.value, threshold: 0.25 },
      )
      pageElements.forEach((el) => pageObserver?.observe(el))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    loadError.value = msg
    emit('error', msg)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void renderPdf()
})

watch(
  () => props.url,
  () => {
    observer?.disconnect()
    observer = null
    pageObserver?.disconnect()
    pageObserver = null
    void renderPdf()
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  pageObserver?.disconnect()
  workerInstance.terminate()
})

defineExpose({ reachedEnd, pageCount, highestPageSeen })
</script>

<template>
  <div class="pdfv">
    <div ref="containerEl" class="pdfv__viewport">
      <div ref="pagesEl" class="pdfv__pages" />
      <div v-if="loading" class="pdfv__overlay">Loading document…</div>
      <div v-if="loadError" class="pdfv__overlay pdfv__overlay--error">
        Couldn't load the PDF: {{ loadError }}
      </div>
    </div>

    <div class="pdfv__bar" :class="{ 'pdfv__bar--done': reachedEnd }">
      <span v-if="reachedEnd"
        ><span class="pdfv__check">✓</span> Read through to the end</span
      >
      <span v-else
        >Reading {{ highestPageSeen }} / {{ pageCount }} ({{ progressPct }}%) —
        scroll to the end to enable acknowledgement</span
      >
    </div>
  </div>
</template>

<style scoped>
.pdfv {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pdfv__viewport {
  position: relative;
  width: 100%;
  height: 70vh;
  min-height: 360px;
  max-height: 720px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 12px;
}

.pdfv__pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

:deep(.pdfv__page-wrap) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
:deep(.pdfv__canvas) {
  display: block;
  max-width: 100%;
  border-radius: 4px;
  box-shadow: 0 2px 14px oklch(0 0 0 / 0.08);
}
:deep(.pdfv__page-label) {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  letter-spacing: 0.04em;
}

.pdfv__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-soft);
  color: var(--color-muted);
  font-size: 13.5px;
}
.pdfv__overlay--error {
  color: var(--color-danger-500);
}

.pdfv__bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
  letter-spacing: 0.02em;
}
.pdfv__bar--done {
  color: var(--color-success-500);
  background: #f0f8f3;
  border-color: #c6e4d2;
}
.pdfv__check {
  font-weight: 700;
}
</style>