<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  FileText,
  Check,
  AlertTriangle,
  Download,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import PdfViewer from '@/components/primitives/PdfViewer.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { usePolicies } from '@/composables/usePolicies'
import { generatePolicyAcknowledgementCertificate } from '@/lib/policyAcknowledgementCertificate'

/**
 * Crew policy reader + acknowledgement flow.
 *
 *  1. PDF renders inline (PdfViewer component, scroll-to-end tracked
 *     via IntersectionObserver).
 *  2. Three required attestation checkboxes unlock once the user has
 *     scrolled through the document.
 *  3. SignaturePad captures the signature.
 *  4. Submit inserts a policy_acknowledgements row; cert auto-
 *     downloads.
 *
 * Re-acknowledgement: if the policy's version has advanced past the
 * user's last ack, the flow re-renders fresh (status pill says
 * "Update — please re-acknowledge").
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  policyById,
  ackFor,
  isAcknowledged,
  isStale,
  submitAcknowledgement,
  documentPublicUrl,
} = usePolicies()

const policyId = computed(() => String(route.params.id))
const policy = computed(() => policyById(policyId.value))
const ack = computed(() => (policy.value ? ackFor(policy.value.id) : null))
const alreadyAcknowledged = computed(() =>
  policy.value ? isAcknowledged(policy.value.id) : false,
)
const stale = computed(() => (policy.value ? isStale(policy.value.id) : false))
const documentUrl = computed(() =>
  policy.value ? documentPublicUrl(policy.value) : null,
)

const reachedEnd = ref(false)
const ackRead = ref(false)
const ackUnderstand = ref(false)
const ackKnowWhere = ref(false)
const signatureData = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submittedJustNow = ref(false)

const allBoxesChecked = computed(
  () => ackRead.value && ackUnderstand.value && ackKnowWhere.value,
)

const canSubmit = computed(
  () =>
    reachedEnd.value &&
    allBoxesChecked.value &&
    !!signatureData.value &&
    !submitting.value &&
    !auth.isKiosk,
)

function onReachedEnd() {
  reachedEnd.value = true
}

function back() {
  router.push('/policies')
}

async function downloadCertificate() {
  if (!policy.value || !auth.appUser) return
  const verificationId = ack.value?.id?.slice(0, 8)
  const doc = await generatePolicyAcknowledgementCertificate({
    employeeName: auth.appUser.fullName,
    policyTitle: policy.value.title,
    policyVersion: ack.value?.policyVersionAtSigning ?? policy.value.version,
    completionDate: ack.value?.acknowledgedAt
      ? new Date(ack.value.acknowledgedAt)
      : new Date(),
    verificationId,
  })
  const safeTitle = policy.value.title.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
  doc.save(`WCEMS_Policy_Acknowledgement_${safeTitle}.pdf`)
}

async function onSubmit() {
  if (!canSubmit.value || !policy.value || !signatureData.value) return
  submitting.value = true
  submitError.value = null
  const result = await submitAcknowledgement(policy.value.id, signatureData.value)
  if (!result.ok) {
    submitError.value = result.error
    submitting.value = false
    return
  }
  submittedJustNow.value = true
  submitting.value = false
  /* Auto-download the cert; user can re-download from the
     already-acknowledged view too. */
  await downloadCertificate()
}

/* Re-watching is fine; reset the local form state if the policy id
   changes (e.g. user navigates between policies without remounting). */
watch(policyId, () => {
  reachedEnd.value = false
  ackRead.value = false
  ackUnderstand.value = false
  ackKnowWhere.value = false
  signatureData.value = null
  submitError.value = null
  submittedJustNow.value = false
})

onMounted(() => {
  /* If the user comes in already acknowledged (and not stale), they
     hit the "already done" view and can re-download the cert. */
})

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    clinical: 'Clinical',
    operational: 'Operational',
    hr: 'HR',
    general: 'General',
  }
  return map[category] ?? category
}
</script>

<template>
  <div class="pd">
    <button type="button" class="pd__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Back to Policies
    </button>

    <div v-if="!auth.appUser" class="pd__gate">Sign in to view this policy.</div>

    <div v-else-if="!ready" class="pd__empty">Loading…</div>

    <div v-else-if="!policy" class="pd__empty">Policy not found.</div>

    <template v-else>
      <header class="pd__header">
        <div class="pd__head-row">
          <div class="pd__head-left">
            <FileText :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
            <div>
              <h1 class="display pd__title">{{ policy.title }}</h1>
              <div class="pd__meta">
                {{ categoryLabel(policy.category) }}
                <template v-if="policy.effectiveDate">
                  · Effective {{ formatDate(policy.effectiveDate) }}
                </template>
                · v{{ policy.version }}
              </div>
            </div>
          </div>
        </div>
        <p v-if="policy.summary" class="pd__sub">{{ policy.summary }}</p>
      </header>

      <div
        v-if="stale && !submittedJustNow"
        class="pd__stale-banner"
      >
        <AlertTriangle :size="16" :stroke-width="1.85" />
        This policy was updated. Please re-acknowledge against the current
        version.
      </div>

      <!-- Already-acknowledged view -->
      <template v-if="alreadyAcknowledged && !submittedJustNow">
        <AppCard class="pd__ack-card">
          <div class="pd__ack-card-icon">
            <Check :size="22" :stroke-width="2" />
          </div>
          <div>
            <div class="pd__ack-card-title display">Acknowledged</div>
            <div class="pd__ack-card-meta">
              You acknowledged this policy on
              {{ formatDate(ack?.acknowledgedAt ?? null) }}
              (v{{ ack?.policyVersionAtSigning }}).
            </div>
          </div>
          <button
            type="button"
            class="pd__cert-btn"
            @click="downloadCertificate"
          >
            <Download :size="13" :stroke-width="2" />
            Re-download certificate
          </button>
        </AppCard>

        <!-- Re-read the doc whenever they want — same viewer, no gate. -->
        <section v-if="documentUrl" class="pd__pdf-section">
          <h2 class="pd__section-title">Document</h2>
          <PdfViewer :url="documentUrl" />
        </section>
      </template>

      <!-- Active acknowledgement flow -->
      <template v-else>
        <section v-if="documentUrl" class="pd__pdf-section">
          <h2 class="pd__section-title">Read the policy</h2>
          <PdfViewer :url="documentUrl" @reached-end="onReachedEnd" />
        </section>
        <div v-else class="pd__empty">
          No document uploaded yet. Check back once an admin attaches the PDF.
        </div>

        <section v-if="documentUrl" class="pd__ack-section">
          <h2 class="pd__section-title">Acknowledgement</h2>

          <div class="pd__attestation">
            <p class="pd__attestation-statement">
              "{{ policy.attestationStatement }}"
            </p>
          </div>

          <div class="pd__checkbox-list" :class="{ 'pd__checkbox-list--locked': !reachedEnd }">
            <label class="pd__checkbox-row">
              <input
                v-model="ackRead"
                type="checkbox"
                :disabled="!reachedEnd"
              />
              <span>I have read this policy in full.</span>
            </label>
            <label class="pd__checkbox-row">
              <input
                v-model="ackUnderstand"
                type="checkbox"
                :disabled="!reachedEnd"
              />
              <span>I understand its contents.</span>
            </label>
            <label class="pd__checkbox-row">
              <input
                v-model="ackKnowWhere"
                type="checkbox"
                :disabled="!reachedEnd"
              />
              <span>I know where to find this policy on the intranet.</span>
            </label>
            <div v-if="!reachedEnd" class="pd__lock-hint">
              Scroll through the document above before signing.
            </div>
          </div>

          <div class="pd__signature">
            <div class="pd__signature-label">Signature</div>
            <SignaturePad
              v-if="!auth.isKiosk"
              @change="(v: string) => (signatureData = v || null)"
            />
            <div v-else class="pd__kiosk-notice">
              Acknowledgements aren't allowed on station kiosks.
            </div>
          </div>

          <div v-if="submitError" class="pd__error">{{ submitError }}</div>

          <div class="pd__actions">
            <button
              type="button"
              class="pd__submit"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ submitting ? 'Submitting…' : 'Acknowledge and submit' }}
            </button>
          </div>
        </section>
      </template>

      <!-- Post-submit confirmation -->
      <div v-if="submittedJustNow" class="pd__post-submit">
        <Check :size="18" :stroke-width="2" />
        Acknowledged. The certificate has been downloaded.
      </div>
    </template>
  </div>
</template>

<style scoped>
.pd {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .pd {
    padding: 40px 40px 80px;
  }
}

.pd__back {
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
.pd__back:hover {
  color: var(--color-ink-soft);
}

.pd__gate,
.pd__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.pd__header {
  margin-bottom: 14px;
}
.pd__head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.pd__head-left {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
}
.pd__title {
  font-size: 22px;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.pd__meta {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  letter-spacing: 0.04em;
}
.pd__sub {
  margin-top: 8px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
}

.pd__stale-banner {
  margin: 14px 0;
  padding: 10px 14px;
  font-size: 12.5px;
  color: oklch(0.4 0.13 60);
  background: oklch(0.97 0.06 60);
  border: 1px solid oklch(0.85 0.07 60);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.pd__ack-card {
  margin-top: 14px;
  padding: 14px 16px !important;
  display: flex !important;
  gap: 14px;
  align-items: center;
  border-color: #c6e4d2 !important;
  background: #f0f8f3 !important;
}
.pd__ack-card-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 999px;
  background: white;
  color: var(--color-success-500);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pd__ack-card-title {
  font-size: 16px;
  color: var(--color-success-500);
}
.pd__ack-card-meta {
  font-size: 12px;
  color: var(--color-ink-soft);
  margin-top: 2px;
}
.pd__cert-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  background: white;
  color: var(--color-success-500);
  border: 1px solid #c6e4d2;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.pd__cert-btn:hover {
  background: #f0f8f3;
}

.pd__pdf-section,
.pd__ack-section {
  margin-top: 20px;
}
.pd__section-title {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-brand-700);
  margin-bottom: 10px;
}

.pd__attestation {
  padding: 12px 14px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.pd__attestation-statement {
  font-size: 13.5px;
  color: var(--color-ink);
  font-style: italic;
  line-height: 1.45;
  margin: 0;
}

.pd__checkbox-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  transition: opacity 120ms var(--ease-out);
}
.pd__checkbox-list--locked {
  opacity: 0.55;
}
.pd__checkbox-row {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13.5px;
  color: var(--color-ink);
  cursor: pointer;
}
.pd__checkbox-row input[type='checkbox'] {
  width: 17px;
  height: 17px;
  cursor: pointer;
}
.pd__lock-hint {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
}

.pd__signature {
  margin-top: 14px;
}
.pd__signature-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}

.pd__kiosk-notice {
  margin-top: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border: 1px dashed var(--color-line);
  border-radius: 6px;
  text-align: center;
}

.pd__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
}

.pd__actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
}
.pd__submit {
  background: var(--color-brand-600);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.pd__submit:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.pd__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pd__post-submit {
  margin-top: 20px;
  padding: 14px 16px;
  background: #f0f8f3;
  border: 1px solid #c6e4d2;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-success-500);
}
</style>
