<script setup lang="ts">
import { ref, computed } from 'vue'
import { Camera, Check, Download, X } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useSocialMediaRelease } from '@/composables/useSocialMediaRelease'
import {
  generateSocialMediaReleasePdf,
  RELEASE_STATEMENT,
} from '@/lib/socialMediaReleasePdf'

/**
 * Social Media Photo & Video Release — the electronic replacement for
 * the paper new-hire form. Identity comes from the signed-in account,
 * the YES/NO election + optional restrictions are captured with a
 * drawn signature, and a personnel-file PDF downloads on submit.
 *
 * The release is a standing authorization: once signed, the view shows
 * the current answer with an "Update my response" path (revising or
 * revoking updates the single row in place).
 */

const auth = useAuthStore()
const { ready, myRelease, submitRelease } = useSocialMediaRelease()

const editing = ref(false)
const authorized = ref<boolean | null>(null)
const restrictions = ref('')
const signatureData = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submittedJustNow = ref(false)

const showForm = computed(() => !myRelease.value || editing.value)

const canSubmit = computed(
  () =>
    authorized.value !== null &&
    !!signatureData.value &&
    !submitting.value &&
    !auth.isKiosk,
)

function startEdit() {
  editing.value = true
  submittedJustNow.value = false
  authorized.value = myRelease.value?.authorized ?? null
  restrictions.value = myRelease.value?.restrictions ?? ''
  signatureData.value = null
}

function cancelEdit() {
  editing.value = false
  submitError.value = null
}

async function downloadPdf() {
  if (!myRelease.value || !auth.appUser) return
  const doc = await generateSocialMediaReleasePdf({
    employeeName: auth.appUser.fullName,
    employeeTitle: auth.appUser.title,
    release: myRelease.value,
  })
  doc.save('WCEMS_Social_Media_Release.pdf')
}

async function onSubmit() {
  if (!canSubmit.value || authorized.value === null || !signatureData.value) return
  submitting.value = true
  submitError.value = null
  const result = await submitRelease({
    authorized: authorized.value,
    restrictions: restrictions.value,
    signatureData: signatureData.value,
  })
  if (!result.ok) {
    submitError.value = result.error
    submitting.value = false
    return
  }
  submitting.value = false
  editing.value = false
  submittedJustNow.value = true
  await downloadPdf()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="smr">
    <header class="smr__header">
      <div class="smr__head-left">
        <Camera :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <div>
          <h1 class="display smr__title">Social Media Release</h1>
          <div class="smr__meta">Photo &amp; video authorization · retained in your personnel file</div>
        </div>
      </div>
    </header>

    <div v-if="!auth.appUser" class="smr__empty">Sign in to complete this form.</div>
    <div v-else-if="!ready" class="smr__empty">Loading…</div>

    <template v-else>
      <!-- Signed state -->
      <template v-if="!showForm && myRelease">
        <AppCard class="smr__status-card">
          <div
            class="smr__status-icon"
            :class="myRelease.authorized ? 'smr__status-icon--yes' : 'smr__status-icon--no'"
          >
            <Check v-if="myRelease.authorized" :size="22" :stroke-width="2" />
            <X v-else :size="22" :stroke-width="2" />
          </div>
          <div class="smr__status-copy">
            <div class="display smr__status-title">
              {{ myRelease.authorized ? 'Authorized' : 'Declined' }}
            </div>
            <div class="smr__status-meta">
              {{
                myRelease.authorized
                  ? 'You have authorized WCEMS to use your photo/video on official channels.'
                  : 'You have declined photo/video use on official channels.'
              }}
              Signed {{ formatDate(myRelease.signedAt) }}.
            </div>
            <div v-if="myRelease.restrictions" class="smr__status-restrictions">
              Restrictions: {{ myRelease.restrictions }}
            </div>
          </div>
          <div class="smr__status-actions">
            <button type="button" class="smr__ghost-btn" @click="downloadPdf">
              <Download :size="13" :stroke-width="2" />
              Download PDF
            </button>
            <button type="button" class="smr__ghost-btn" @click="startEdit">
              Update my response
            </button>
          </div>
        </AppCard>
        <div v-if="submittedJustNow" class="smr__post-submit">
          <Check :size="18" :stroke-width="2" />
          Submitted. A copy of your signed release has been downloaded.
        </div>
      </template>

      <!-- Sign / revise flow -->
      <template v-else>
        <AppCard class="smr__form-card">
          <section class="smr__section">
            <h2 class="smr__section-title">Employee information</h2>
            <div class="smr__identity">
              <div class="smr__identity-item">
                <span class="smr__identity-label">Full name</span>
                <span class="smr__identity-value">{{ auth.appUser.fullName }}</span>
              </div>
              <div class="smr__identity-item">
                <span class="smr__identity-label">Job title / position</span>
                <span class="smr__identity-value">{{ auth.appUser.title ?? '—' }}</span>
              </div>
              <div class="smr__identity-item">
                <span class="smr__identity-label">Date of form</span>
                <span class="smr__identity-value">{{ formatDate(new Date().toISOString()) }}</span>
              </div>
            </div>
          </section>

          <section class="smr__section">
            <h2 class="smr__section-title">Authorization</h2>
            <p class="smr__statement">{{ RELEASE_STATEMENT }}</p>

            <div class="smr__election">
              <label
                class="smr__option"
                :class="{ 'smr__option--yes': authorized === true }"
              >
                <input v-model="authorized" type="radio" :value="true" />
                <span class="smr__option-copy">
                  <strong>YES</strong> — I authorize Waller County EMS to use my
                  photo/video on official social media channels.
                </span>
              </label>
              <label
                class="smr__option"
                :class="{ 'smr__option--no': authorized === false }"
              >
                <input v-model="authorized" type="radio" :value="false" />
                <span class="smr__option-copy">
                  <strong>NO</strong> — I do not authorize Waller County EMS to use
                  my photo/video on official social media channels.
                </span>
              </label>
            </div>
          </section>

          <section class="smr__section">
            <h2 class="smr__section-title">Additional notes / restrictions <span class="smr__optional">(optional)</span></h2>
            <textarea
              v-model="restrictions"
              class="smr__restrictions"
              rows="3"
              placeholder="e.g., okay for photos but not video, no close-ups, …"
            ></textarea>
          </section>

          <section class="smr__section">
            <h2 class="smr__section-title">Signature</h2>
            <SignaturePad
              v-if="!auth.isKiosk"
              @change="(v: string) => (signatureData = v || null)"
            />
            <div v-else class="smr__kiosk-notice">
              Releases can't be signed on station kiosks — use your own device.
            </div>
          </section>

          <div v-if="submitError" class="smr__error">{{ submitError }}</div>

          <div class="smr__actions">
            <button
              v-if="editing"
              type="button"
              class="smr__ghost-btn"
              @click="cancelEdit"
            >
              Cancel
            </button>
            <button
              type="button"
              class="smr__submit"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ submitting ? 'Submitting…' : 'Sign and submit' }}
            </button>
          </div>
        </AppCard>
      </template>
    </template>
  </div>
</template>

<style scoped>
.smr {
  max-width: 720px;
  margin: 0 auto;
}
.smr__header {
  margin-bottom: 20px;
}
.smr__head-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.smr__title {
  font-size: 26px;
  line-height: 1.15;
  color: var(--color-ink);
}
.smr__meta {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.smr__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
}

/* ── Signed status card ─────────────────────────────────────────── */
.smr__status-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  flex-wrap: wrap;
}
.smr__status-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.smr__status-icon--yes {
  background: oklch(0.95 0.05 150);
  color: oklch(0.5 0.14 150);
}
.smr__status-icon--no {
  background: oklch(0.95 0.03 30);
  color: oklch(0.5 0.14 30);
}
.smr__status-copy {
  flex: 1;
  min-width: 220px;
}
.smr__status-title {
  font-size: 20px;
  color: var(--color-ink);
}
.smr__status-meta {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.smr__status-restrictions {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
}
.smr__status-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Form ───────────────────────────────────────────────────────── */
.smr__form-card {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.smr__section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-line);
  margin-bottom: 12px;
}
.smr__optional {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
.smr__identity {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.smr__identity-item {
  display: flex;
  gap: 12px;
  font-size: 13px;
}
.smr__identity-label {
  width: 150px;
  flex-shrink: 0;
  color: var(--color-muted);
}
.smr__identity-value {
  font-weight: 600;
  color: var(--color-ink);
}
.smr__statement {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--color-ink-soft);
  margin-bottom: 14px;
}
.smr__election {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.smr__option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 2px solid var(--color-line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.smr__option input {
  margin-top: 3px;
  accent-color: var(--color-brand-600);
}
.smr__option-copy {
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.smr__option-copy strong {
  color: var(--color-ink);
}
.smr__option--yes {
  border-color: oklch(0.6 0.13 150);
  background: oklch(0.98 0.02 150);
}
.smr__option--no {
  border-color: oklch(0.6 0.13 30);
  background: oklch(0.98 0.015 30);
}
.smr__restrictions {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  border-radius: 10px;
  padding: 10px 12px;
  resize: vertical;
}
.smr__restrictions:focus {
  outline: none;
  border-color: var(--color-brand-600);
}
.smr__kiosk-notice {
  font-size: 13px;
  color: var(--color-muted);
  font-style: italic;
}
.smr__error {
  font-size: 13px;
  color: oklch(0.5 0.16 30);
}
.smr__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.smr__submit {
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 10px;
  padding: 11px 22px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.smr__submit:hover:not(:disabled) {
  background: var(--color-brand-900);
}
.smr__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.smr__ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.smr__ghost-btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
.smr__post-submit {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 600;
  color: oklch(0.45 0.13 150);
}
</style>
