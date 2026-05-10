<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ChevronRight,
  Image as ImageIcon,
  Edit2,
  Trash2,
  FileText,
  ExternalLink,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import AppChip from '@/components/primitives/AppChip.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useNewsletter } from '@/composables/useNewsletter'
import NewsletterEditModal from './NewsletterEditModal.vue'

const auth = useAuthStore()
const { current, getPdfUrl, clear } = useNewsletter()

const editing = ref(false)
const fetchingPdf = ref(false)

const publishedDate = computed(() => {
  if (!current.value) return ''
  return new Date(current.value.publishedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
})

const hasPdf = computed(
  () => !!(current.value && (current.value.pdfPath || current.value.dataUrl)),
)

async function openPdf() {
  if (fetchingPdf.value) return
  fetchingPdf.value = true
  try {
    const url = await getPdfUrl()
    if (url) window.open(url, '_blank', 'noopener')
  } finally {
    fetchingPdf.value = false
  }
}

async function removePublished() {
  if (!current.value) return
  if (!confirm(`Remove "${current.value.title}"? It'll come off the dashboard immediately.`)) return
  await clear()
}
</script>

<template>
  <AppCard class="newsletter-card overflow-hidden">
    <div class="newsletter-card__hero">
      <FileText
        v-if="current"
        :size="38"
        :stroke-width="1.4"
        class="newsletter-card__icon"
      />
      <ImageIcon v-else :size="26" class="newsletter-card__icon" />
      <AppChip variant="accent" class="newsletter-card__chip">
        {{ current ? 'Published' : 'Featured' }}
      </AppChip>
      <div v-if="auth.isAdmin" class="newsletter-card__admin-actions">
        <button
          type="button"
          class="newsletter-card__action"
          :aria-label="current ? 'Edit newsletter' : 'Publish newsletter'"
          @click="editing = true"
        >
          <Edit2 :size="12" />
        </button>
        <button
          v-if="current"
          type="button"
          class="newsletter-card__action newsletter-card__action--danger"
          aria-label="Remove published newsletter"
          @click="removePublished"
        >
          <Trash2 :size="12" />
        </button>
      </div>
    </div>
    <div class="newsletter-card__body">
      <Eyebrow>Newsletter</Eyebrow>
      <template v-if="current">
        <h3 class="newsletter-card__title display">{{ current.title }}</h3>
        <p v-if="current.subtitle" class="newsletter-card__sub">
          {{ current.subtitle }}
        </p>
        <div class="newsletter-card__meta">
          <span class="newsletter-card__date">{{ publishedDate }}</span>
          <span v-if="current.fileName" class="newsletter-card__filename">
            <FileText :size="11" :stroke-width="2" />
            {{ current.fileName }}
          </span>
        </div>
        <button
          v-if="hasPdf"
          type="button"
          class="newsletter-card__open"
          :disabled="fetchingPdf"
          @click="openPdf"
        >
          {{ fetchingPdf ? 'Opening…' : 'Open PDF' }}
          <ExternalLink :size="13" />
        </button>
        <button v-else class="newsletter-card__more" disabled>
          No PDF attached <ChevronRight :size="13" />
        </button>
      </template>
      <template v-else>
        <h3 class="newsletter-card__title display">No newsletter yet</h3>
        <p class="newsletter-card__sub">
          When the team publishes the next monthly newsletter, it'll show up here.
        </p>
        <button
          v-if="auth.isAdmin"
          class="newsletter-card__publish-cta"
          type="button"
          @click="editing = true"
        >
          + Publish newsletter
        </button>
        <button v-else class="newsletter-card__more" disabled>
          Read more <ChevronRight :size="13" />
        </button>
      </template>
    </div>

    <NewsletterEditModal :open="editing" @close="editing = false" />
  </AppCard>
</template>

<style scoped>
.newsletter-card__hero {
  position: relative;
  height: 144px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    var(--color-brand-600) 0%,
    var(--color-brand-800) 100%
  );
}
.newsletter-card__hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at 75% 30%,
    oklch(0.55 0.12 250) 0%,
    transparent 60%
  );
  opacity: 0.6;
  pointer-events: none;
}
.newsletter-card__icon {
  position: relative;
  color: var(--color-accent-500);
  opacity: 0.7;
}
.newsletter-card__chip {
  position: absolute;
  top: 12px;
  left: 12px;
  background: var(--color-accent-500);
  color: var(--color-brand-900);
  border-color: transparent;
  font-weight: 600;
}
.newsletter-card__admin-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  gap: 6px;
}
.newsletter-card__action {
  background: oklch(0 0 0 / 0.35);
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: background 140ms var(--ease-out), color 140ms var(--ease-out);
}
.newsletter-card__action:hover {
  background: oklch(0 0 0 / 0.55);
}
.newsletter-card__action--danger:hover {
  background: var(--color-danger-500);
  color: white;
}

.newsletter-card__body {
  padding: 20px;
}
.newsletter-card__title {
  font-size: 22px;
  margin-top: 6px;
  color: var(--color-ink);
}
.newsletter-card__sub {
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
  line-height: 1.5;
}
.newsletter-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 12px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.newsletter-card__date {
  text-transform: uppercase;
}
.newsletter-card__filename {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
}
.newsletter-card__open {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: white;
  background: var(--color-brand-600);
  padding: 8px 14px;
  border-radius: 8px;
  text-decoration: none;
  transition: background 120ms var(--ease-out);
}
.newsletter-card__open:hover {
  background: var(--color-brand-700);
}
.newsletter-card__more {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-600);
  background: transparent;
  border: none;
  cursor: pointer;
}
.newsletter-card__more:disabled {
  color: var(--color-muted);
  cursor: not-allowed;
}
.newsletter-card__publish-cta {
  margin-top: 14px;
  align-self: flex-start;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-ink-soft);
  font-size: 12.5px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 7px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), color 120ms var(--ease-out);
}
.newsletter-card__publish-cta:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
</style>
