<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Check, RotateCcw, ChevronDown, AlertTriangle } from 'lucide-vue-next'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { SKILLS_ATTESTATION } from '@/lib/skillsDayPacketPdf'
import type { SkillItemResult } from '@/types'

/**
 * Station runner: one evaluator, one candidate, one check-off. Every
 * item gets Pass or Redo (guide rule: nothing leaves a station
 * unmarked), then both parties sign on this device and the record
 * submits. If the record already exists with outstanding redo items,
 * the view flips into second-attempt mode showing just those items.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  checkoffById,
  candidateById,
  evaluationFor,
  redoKeys,
  submitEvaluation,
  submitRecheck,
} = useSkillsDay()

const checkoffId = computed(() => String(route.params.checkoffId))
const candidateId = computed(() => String(route.params.candidateId))
const checkoff = computed(() => checkoffById(checkoffId.value))
const candidate = computed(() => candidateById(candidateId.value))
const existing = computed(() => evaluationFor(checkoffId.value, candidateId.value))

/* Mode: fresh | recheck (existing with redo items) | done (existing, passed) */
const mode = computed<'fresh' | 'recheck' | 'done'>(() => {
  if (!existing.value) return 'fresh'
  return redoKeys(existing.value).length > 0 ? 'recheck' : 'done'
})

const allItems = computed(() =>
  (checkoff.value?.sections ?? []).flatMap((s) => s.items),
)

/* The checkoff note may carry "Automatic remediation triggers: a · b"
   — split those out into their own warning callout so evaluators see
   the auto-fail conditions at a glance (in recheck mode too). */
const noteParts = computed(() => {
  const note = checkoff.value?.note ?? ''
  const [format, triggerText] = note.split(/Automatic remediation triggers:\s*/i)
  return {
    format: (format ?? '').trim(),
    triggers: triggerText
      ? triggerText
          .split('·')
          .map((t) => t.replace(/\.\s*$/, '').trim())
          .filter(Boolean)
      : [],
  }
})

/* ── Fresh evaluation state ─────────────────────────────────────── */
const marks = reactive<Record<string, SkillItemResult | undefined>>({})
const comments = reactive<Record<string, string>>({})
const commentOpen = reactive<Record<string, boolean>>({})

function setMark(key: string, result: SkillItemResult) {
  marks[key] = marks[key] === result ? undefined : result
  if (marks[key] === 'redo') commentOpen[key] = true
}

function sectionAllPass(items: { key: string }[]) {
  for (const it of items) {
    if (!marks[it.key]) marks[it.key] = 'pass'
  }
}

const markedCount = computed(
  () => allItems.value.filter((it) => marks[it.key]).length,
)
const redoCount = computed(
  () => allItems.value.filter((it) => marks[it.key] === 'redo').length,
)
const allMarked = computed(
  () => allItems.value.length > 0 && markedCount.value === allItems.value.length,
)

/* ── Recheck state ──────────────────────────────────────────────── */
const recheckCleared = reactive<Record<string, boolean>>({})
const recheckComments = reactive<Record<string, string>>({})
const outstandingKeys = computed(() =>
  existing.value ? redoKeys(existing.value) : [],
)
const clearedCount = computed(
  () => outstandingKeys.value.filter((k) => recheckCleared[k]).length,
)

function itemLabel(key: string): string {
  return allItems.value.find((it) => it.key === key)?.label ?? key
}

/* ── Signatures & submit ────────────────────────────────────────── */
const signing = ref(false)
const candidateSig = ref<string | null>(null)
const evaluatorSig = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

const canSign = computed(() =>
  mode.value === 'fresh' ? allMarked.value : clearedCount.value > 0,
)
const canSubmit = computed(
  () => !!candidateSig.value && !!evaluatorSig.value && !submitting.value,
)

async function onSubmit() {
  if (!canSubmit.value || !checkoff.value || !candidate.value) return
  submitting.value = true
  submitError.value = null
  let result: { ok: true } | { ok: false; error: string }
  if (mode.value === 'fresh') {
    const items: Record<string, { result: SkillItemResult; comment?: string; label?: string }> = {}
    for (const it of allItems.value) {
      items[it.key] = {
        result: marks[it.key] ?? 'redo',
        comment: comments[it.key]?.trim() || undefined,
        label: it.label,
      }
    }
    result = await submitEvaluation({
      checkoffId: checkoff.value.id,
      candidateId: candidate.value.id,
      items,
      candidateSignature: candidateSig.value!,
      evaluatorSignature: evaluatorSig.value!,
    })
  } else {
    result = await submitRecheck({
      evaluationId: existing.value!.id,
      clearedKeys: outstandingKeys.value.filter((k) => recheckCleared[k]),
      comments: Object.fromEntries(
        Object.entries(recheckComments).filter(([, v]) => v.trim()),
      ),
      candidateSignature: candidateSig.value!,
      evaluatorSignature: evaluatorSig.value!,
    })
  }
  submitting.value = false
  if (!result.ok) {
    submitError.value = result.error
    return
  }
  router.push('/skills')
}

function back() {
  router.push('/skills')
}
</script>

<template>
  <div class="sev">
    <button type="button" class="sev__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Skills Day
    </button>

    <div v-if="!ready" class="sev__empty">Loading…</div>
    <div v-else-if="!checkoff || !candidate" class="sev__empty">
      Check-off or candidate not found.
    </div>

    <template v-else>
      <header class="sev__header">
        <div class="sev__kicker">{{ checkoff.subtitle }}</div>
        <h1 class="display sev__title">{{ checkoff.title }}</h1>
        <div class="sev__who">
          <span class="sev__cand">{{ candidate.fullName }}</span>
          <span class="sev__eval">Evaluator: {{ auth.appUser?.fullName }}</span>
        </div>
        <p v-if="noteParts.format && mode === 'fresh'" class="sev__note">{{ noteParts.format }}</p>
        <div v-if="noteParts.triggers.length && mode !== 'done'" class="sev__triggers">
          <div class="sev__triggers-title">
            <AlertTriangle :size="13" :stroke-width="2.2" />
            Automatic remediation triggers
          </div>
          <ul class="sev__triggers-list">
            <li v-for="t in noteParts.triggers" :key="t">{{ t }}</li>
          </ul>
        </div>
      </header>

      <!-- Completed, nothing outstanding -->
      <div v-if="mode === 'done'" class="sev__done">
        <Check :size="20" :stroke-width="2" />
        <div>
          <strong>Already passed.</strong>
          This check-off is complete for {{ candidate.fullName }} — view results
          from the board.
        </div>
      </div>

      <!-- Second-attempt mode -->
      <template v-else-if="mode === 'recheck'">
        <div class="sev__recheck-banner">
          <RotateCcw :size="16" :stroke-width="2" />
          Second attempt — {{ outstandingKeys.length }}
          {{ outstandingKeys.length === 1 ? 'item' : 'items' }} to revisit. Mark
          each item passed as it's redemonstrated.
        </div>
        <div class="sev__list">
          <div v-for="key in outstandingKeys" :key="key" class="sev__item">
            <div class="sev__item-row">
              <span class="sev__item-label">{{ itemLabel(key) }}</span>
              <button
                type="button"
                class="sev__mark sev__mark--pass"
                :class="{ 'sev__mark--on': recheckCleared[key] }"
                @click="recheckCleared[key] = !recheckCleared[key]"
              >
                <Check :size="15" :stroke-width="2.5" />
                Pass
              </button>
            </div>
            <div v-if="existing?.items[key]?.comment" class="sev__prev-comment">
              First attempt: {{ existing.items[key].comment }}
            </div>
            <input
              v-if="recheckCleared[key]"
              v-model="recheckComments[key]"
              class="sev__comment"
              placeholder="Recheck note (optional)"
            />
          </div>
        </div>
      </template>

      <!-- Fresh evaluation -->
      <template v-else>
        <section
          v-for="section in checkoff.sections"
          :key="section.title"
          class="sev__section"
        >
          <div class="sev__section-head">
            <h2 class="sev__section-title">{{ section.title }}</h2>
            <button
              type="button"
              class="sev__allpass"
              @click="sectionAllPass(section.items)"
            >
              <Check :size="12" :stroke-width="2.5" />
              Rest pass
            </button>
          </div>
          <p v-if="section.note" class="sev__section-note">{{ section.note }}</p>
          <div class="sev__list">
            <div v-for="item in section.items" :key="item.key" class="sev__item">
              <div class="sev__item-row">
                <span class="sev__item-label">{{ item.label }}</span>
                <div class="sev__marks">
                  <button
                    type="button"
                    class="sev__mark sev__mark--pass"
                    :class="{ 'sev__mark--on': marks[item.key] === 'pass' }"
                    @click="setMark(item.key, 'pass')"
                  >
                    <Check :size="15" :stroke-width="2.5" />
                  </button>
                  <button
                    type="button"
                    class="sev__mark sev__mark--redo"
                    :class="{ 'sev__mark--on': marks[item.key] === 'redo' }"
                    @click="setMark(item.key, 'redo')"
                  >
                    <RotateCcw :size="14" :stroke-width="2.5" />
                  </button>
                  <button
                    type="button"
                    class="sev__comment-toggle"
                    :class="{ 'sev__comment-toggle--open': commentOpen[item.key] }"
                    aria-label="Add comment"
                    @click="commentOpen[item.key] = !commentOpen[item.key]"
                  >
                    <ChevronDown :size="14" :stroke-width="2" />
                  </button>
                </div>
              </div>
              <input
                v-if="commentOpen[item.key]"
                v-model="comments[item.key]"
                class="sev__comment"
                :placeholder="marks[item.key] === 'redo' ? 'What needs remediation?' : 'Comment (optional)'"
              />
            </div>
          </div>
        </section>
      </template>

      <!-- Sticky progress + sign flow -->
      <div v-if="mode !== 'done'" class="sev__footer">
        <div v-if="!signing" class="sev__footer-bar">
          <div class="sev__progress">
            <template v-if="mode === 'fresh'">
              {{ markedCount }} / {{ allItems.length }} marked
              <span v-if="redoCount" class="sev__redo-count">{{ redoCount }} redo</span>
            </template>
            <template v-else>
              {{ clearedCount }} / {{ outstandingKeys.length }} cleared
            </template>
          </div>
          <button
            type="button"
            class="sev__continue"
            :disabled="!canSign"
            @click="signing = true"
          >
            Sign & submit
          </button>
        </div>

        <div v-else class="sev__sign">
          <div class="sev__sign-summary">
            <template v-if="mode === 'fresh'">
              <strong>{{ redoCount === 0 ? 'Pass' : 'Remediation required' }}</strong>
              — {{ allItems.length - redoCount }} passed<span v-if="redoCount">,
              {{ redoCount }} to revisit at second attempts</span>.
            </template>
            <template v-else>
              Clearing {{ clearedCount }}
              {{ clearedCount === 1 ? 'item' : 'items' }}<span
                v-if="outstandingKeys.length - clearedCount"
              >
                — {{ outstandingKeys.length - clearedCount }} will stay outstanding</span>.
            </template>
          </div>
          <p class="sev__attestation">{{ SKILLS_ATTESTATION }}</p>
          <div class="sev__pads">
            <div class="sev__pad">
              <div class="sev__pad-label">Candidate — {{ candidate.fullName }}</div>
              <SignaturePad :height="110" @change="(v: string) => (candidateSig = v || null)" />
            </div>
            <div class="sev__pad">
              <div class="sev__pad-label">Evaluator — {{ auth.appUser?.fullName }}</div>
              <SignaturePad :height="110" @change="(v: string) => (evaluatorSig = v || null)" />
            </div>
          </div>
          <div v-if="submitError" class="sev__error">{{ submitError }}</div>
          <div class="sev__sign-actions">
            <button type="button" class="sev__ghost" @click="signing = false">
              Back to items
            </button>
            <button
              type="button"
              class="sev__submit"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ submitting ? 'Submitting…' : 'Submit check-off' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sev {
  max-width: 680px;
  margin: 0 auto;
  padding: 24px 16px 120px;
}
.sev__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  padding: 0;
  margin-bottom: 14px;
  cursor: pointer;
}
.sev__empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
}
.sev__header {
  margin-bottom: 18px;
}
.sev__kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-accent-strong, #a8842c);
}
.sev__title {
  font-size: 26px;
  line-height: 1.15;
  color: var(--color-ink);
  margin-top: 2px;
}
.sev__who {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 6px;
  align-items: baseline;
}
.sev__cand {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-brand-800);
}
.sev__eval {
  font-size: 12px;
  color: var(--color-muted);
}
.sev__note {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
}

.sev__triggers {
  margin-top: 10px;
  border: 1px solid oklch(0.82 0.09 45);
  background: oklch(0.97 0.03 45);
  border-radius: 10px;
  padding: 10px 12px;
}
.sev__triggers-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: oklch(0.42 0.13 45);
  margin-bottom: 6px;
}
.sev__triggers-list {
  margin: 0;
  padding-left: 18px;
  columns: 2;
  column-gap: 22px;
}
.sev__triggers-list li {
  font-size: 12px;
  line-height: 1.5;
  color: oklch(0.35 0.09 45);
  break-inside: avoid;
}
@media (max-width: 560px) {
  .sev__triggers-list {
    columns: 1;
  }
}

.sev__done {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 12px;
  background: oklch(0.96 0.04 150);
  border: 1px solid oklch(0.85 0.07 150);
  color: oklch(0.4 0.12 150);
  font-size: 13.5px;
  line-height: 1.5;
}
.sev__recheck-banner {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: 12px;
  background: oklch(0.97 0.04 60);
  border: 1px solid oklch(0.85 0.07 60);
  color: oklch(0.42 0.11 60);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

.sev__section {
  margin-bottom: 20px;
}
.sev__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.sev__section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.sev__section-note {
  font-size: 11.5px;
  color: var(--color-muted);
  font-style: italic;
  margin-bottom: 6px;
}
.sev__allpass {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 700;
  color: oklch(0.45 0.12 150);
  background: oklch(0.96 0.04 150);
  border: 1px solid oklch(0.85 0.07 150);
  border-radius: 7px;
  padding: 4px 9px;
  cursor: pointer;
}

.sev__list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
}
.sev__item {
  border-bottom: 1px solid var(--color-line);
  padding: 8px 12px;
}
.sev__item:last-child {
  border-bottom: none;
}
.sev__item-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sev__item-label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  line-height: 1.35;
  color: var(--color-ink);
}
.sev__marks {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  align-items: center;
}
.sev__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 44px;
  height: 38px;
  border-radius: 9px;
  border: 2px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 100ms var(--ease-out);
}
.sev__mark--pass.sev__mark--on {
  background: oklch(0.55 0.13 150);
  border-color: oklch(0.55 0.13 150);
  color: white;
}
.sev__mark--redo.sev__mark--on {
  background: oklch(0.6 0.13 60);
  border-color: oklch(0.6 0.13 60);
  color: white;
}
.sev__comment-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 38px;
  border: none;
  background: none;
  color: var(--color-muted-soft);
  cursor: pointer;
}
.sev__comment-toggle--open {
  color: var(--color-ink-soft);
  transform: rotate(180deg);
}
.sev__comment {
  width: 100%;
  margin-top: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
}
.sev__comment:focus {
  outline: none;
  border-color: var(--color-brand-600);
}
.sev__prev-comment {
  margin-top: 6px;
  font-size: 12px;
  font-style: italic;
  color: var(--color-muted);
}

/* Sticky footer */
.sev__footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-surface);
  border-top: 1px solid var(--color-line);
  box-shadow: 0 -6px 20px oklch(0.2 0.03 260 / 0.08);
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  z-index: 40;
}
.sev__footer-bar {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sev__progress {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink-soft);
  display: flex;
  align-items: center;
  gap: 8px;
}
.sev__redo-count {
  font-size: 11px;
  font-weight: 700;
  color: oklch(0.45 0.12 60);
  background: oklch(0.96 0.05 60);
  border-radius: 999px;
  padding: 2px 8px;
}
.sev__continue {
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 10px;
  padding: 11px 20px;
  cursor: pointer;
}
.sev__continue:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sev__sign {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 70vh;
  overflow-y: auto;
}
.sev__sign-summary {
  font-size: 13px;
  color: var(--color-ink-soft);
}
.sev__attestation {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
}
.sev__pads {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 560px) {
  .sev__pads {
    grid-template-columns: 1fr;
  }
}
.sev__pad-label {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.sev__error {
  font-size: 13px;
  color: oklch(0.5 0.16 30);
}
.sev__sign-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.sev__ghost {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 14px;
  cursor: pointer;
}
.sev__submit {
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 10px;
  padding: 11px 20px;
  cursor: pointer;
}
.sev__submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
