<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, FileDown } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import {
  useClinicalConversations,
  type ClinicalConversation,
} from '@/composables/useClinicalConversations'
import { generateClinicalConversationPdf } from '@/lib/clinicalConversationPdf'

/**
 * Employee view of a clinical conversation: read what was documented,
 * add one response (re-saveable), sign when signatures were requested,
 * download the PDF. Reached from the push notice or the My Progress
 * card. RLS only serves the employee their own records.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const convs = useClinicalConversations()

const conv = ref<ClinicalConversation | null>(null)
const ready = ref(false)
const error = ref('')
const draft = ref('')
const respBusy = ref(false)
const respSaved = ref(false)
const sigData = ref('')
const sigBusy = ref(false)
const pdfBusy = ref(false)

const myParticipant = computed(() =>
  conv.value?.participants.find((p) => p.isEmployee) ?? null,
)
const needsMySignature = computed(
  () => !!conv.value?.requireSignatures && !!myParticipant.value && !myParticipant.value.signatureData,
)
const staffPresent = computed(() =>
  (conv.value?.participants ?? []).filter((p) => !p.isEmployee).map((p) => p.displayName),
)

onMounted(async () => {
  const c = await convs.get(String(route.params.id ?? ''))
  if (!c || (auth.appUser && c.userId !== auth.appUser.id && !auth.isAdmin)) {
    error.value = 'Conversation not found.'
  } else {
    conv.value = c
    draft.value = c.response ?? ''
  }
  ready.value = true
})

async function saveResponse() {
  if (!conv.value || respBusy.value || !draft.value.trim()) return
  respBusy.value = true
  const e = await convs.respond(conv.value.id, draft.value.trim())
  respBusy.value = false
  if (e) {
    error.value = e
    return
  }
  conv.value = await convs.get(conv.value.id)
  respSaved.value = true
  setTimeout(() => (respSaved.value = false), 2600)
}

async function sign() {
  if (!conv.value || !sigData.value || sigBusy.value) return
  sigBusy.value = true
  const e = await convs.signMine(conv.value.id, sigData.value)
  sigBusy.value = false
  if (e) {
    error.value = e
    return
  }
  conv.value = await convs.get(conv.value.id)
}

async function downloadPdf() {
  if (!conv.value || pdfBusy.value) return
  pdfBusy.value = true
  try {
    const doc = await generateClinicalConversationPdf(conv.value)
    doc.save(`Clinical Conversation - ${conv.value.occurredAt.slice(0, 10)}.pdf`)
  } finally {
    pdfBusy.value = false
  }
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
</script>

<template>
  <div class="mcv">
    <button type="button" class="mcv__back" @click="router.push('/clinical-development')">
      <ArrowLeft :size="14" :stroke-width="2" /> My Progress
    </button>

    <div v-if="!ready" class="mcv__empty">Loading…</div>
    <div v-else-if="error && !conv" class="mcv__empty">{{ error }}</div>
    <template v-else-if="conv">
      <header class="mcv__head">
        <h1 class="display mcv__title">Clinical conversation</h1>
        <p class="mcv__sub">
          A record that this conversation took place — <b>not disciplinary</b>. Add your own
          comments below; they become part of the record.
        </p>
      </header>

      <div v-if="error" class="mcv__error">{{ error }}</div>

      <section class="mcv__card">
        <div class="mcv__meta">
          <div class="mcv__m"><span>When</span><b>{{ fmtDateTime(conv.occurredAt) }}</b></div>
          <div class="mcv__m"><span>Where</span><b>{{ conv.location || '—' }}</b></div>
          <div class="mcv__m"><span>Incident #</span><b>{{ conv.incidentNumber || '—' }}</b></div>
          <div class="mcv__m"><span>Call type</span><b>{{ conv.callType || '—' }}</b></div>
          <div class="mcv__m mcv__m--wide">
            <span>Present</span><b>{{ staffPresent.join(', ') || conv.createdByName }}</b>
          </div>
        </div>
      </section>

      <section v-if="conv.callDetails" class="mcv__card">
        <div class="mcv__cardtitle">Details of the call</div>
        <p class="mcv__text">{{ conv.callDetails }}</p>
      </section>

      <section class="mcv__card">
        <div class="mcv__cardtitle">What the discussion entailed</div>
        <p class="mcv__text">{{ conv.discussion }}</p>
      </section>

      <section class="mcv__card mcv__card--mine">
        <div class="mcv__cardtitle">Your comments</div>
        <p v-if="respSaved" class="mcv__ok"><Check :size="13" :stroke-width="2.5" /> Saved.</p>
        <textarea
          v-model="draft"
          class="mcv__area"
          rows="4"
          maxlength="4000"
          placeholder="Anything you'd like on the record — your perspective, questions, follow-up."
        />
        <div class="mcv__row">
          <button
            type="button"
            class="mcv__btn mcv__btn--primary"
            :disabled="respBusy || !draft.trim()"
            @click="saveResponse"
          >
            {{ respBusy ? 'Saving…' : conv.response ? 'Update comments' : 'Save comments' }}
          </button>
          <span v-if="conv.responseAt" class="mcv__quiet">Last saved {{ fmtDateTime(conv.responseAt) }}</span>
        </div>
      </section>

      <section v-if="conv.requireSignatures" class="mcv__card">
        <div class="mcv__cardtitle">Your signature</div>
        <template v-if="myParticipant?.signatureData">
          <img :src="myParticipant.signatureData" class="mcv__sig-img" alt="Your signature" />
          <p class="mcv__quiet">
            Signed {{ myParticipant.signedAt ? fmtDateTime(myParticipant.signedAt) : '' }}
          </p>
        </template>
        <template v-else-if="needsMySignature">
          <p class="mcv__quiet" style="margin-bottom: 8px">
            Signing acknowledges the conversation took place — it is not an agreement or
            admission.
          </p>
          <SignaturePad :height="130" @change="(d) => (sigData = d)" />
          <div class="mcv__row" style="margin-top: 10px">
            <button
              type="button"
              class="mcv__btn mcv__btn--primary"
              :disabled="!sigData || sigBusy"
              @click="sign"
            >
              {{ sigBusy ? 'Saving…' : 'Sign' }}
            </button>
          </div>
        </template>
      </section>

      <div class="mcv__row" style="padding: 2px 2px 0">
        <button type="button" class="mcv__btn" :disabled="pdfBusy" @click="downloadPdf">
          <FileDown :size="13" :stroke-width="2" /> {{ pdfBusy ? 'Building…' : 'Download PDF' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mcv {
  max-width: 720px;
  margin: 0 auto;
  padding: 18px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.mcv__back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 2px 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.mcv__back:hover {
  color: var(--color-ink);
}
.mcv__empty {
  padding: 48px 0;
  text-align: center;
  color: var(--color-muted);
}
.mcv__head {
  margin: 2px 0 2px;
}
.mcv__title {
  font-size: 28px;
  line-height: 1.05;
}
.mcv__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-ink-soft);
  max-width: 56ch;
}
.mcv__error {
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid oklch(0.5 0.19 27 / 0.4);
  background: oklch(0.5 0.19 27 / 0.07);
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  font-size: 13px;
}
.mcv__card {
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  padding: 15px 16px;
  box-shadow: 0 1px 3px oklch(0.18 0.015 260 / 0.05);
}
.mcv__card--mine {
  border-left: 3px solid var(--color-accent-500);
}
.mcv__cardtitle {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.mcv__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.mcv__m {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mcv__m span {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mcv__m b {
  font-size: 13.5px;
  font-weight: 600;
}
.mcv__m--wide {
  grid-column: 1 / -1;
}
.mcv__text {
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.mcv__area {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-canvas);
  padding: 9px 11px;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink);
}
.mcv__area:focus {
  outline: 2px solid var(--color-accent-500);
  outline-offset: -1px;
}
.mcv__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
}
.mcv__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  padding: 9px 15px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
}
.mcv__btn--primary {
  background: var(--color-brand-600);
  border-color: var(--color-brand-700);
  color: white;
}
.mcv__btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.mcv__ok {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-success-600, oklch(0.5 0.14 150));
  margin-bottom: 6px;
}
.mcv__sig-img {
  background: white;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  max-height: 110px;
  object-fit: contain;
}
.mcv__quiet {
  font-size: 12px;
  color: var(--color-muted);
}
@media (max-width: 520px) {
  .mcv__meta {
    grid-template-columns: 1fr;
  }
}
</style>
