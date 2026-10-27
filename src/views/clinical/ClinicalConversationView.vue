<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Eye, FileDown, Lock, Plus, Trash2, X } from 'lucide-vue-next'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import SignaturePad from '@/components/primitives/SignaturePad.vue'
import { useAuthStore } from '@/stores/auth'
import { useClinicalAccess } from '@/composables/useClinicalAccess'
import { useEmployeeDirectory } from '@/composables/useEmployeeDirectory'
import {
  useClinicalConversations,
  type ClinicalConversation,
} from '@/composables/useClinicalConversations'
import { generateClinicalConversationPdf } from '@/lib/clinicalConversationPdf'

/**
 * Clinical conversation — staff page. The form exists only for NEW
 * records: once submitted a conversation is a locked record (Justin,
 * 2026-10-27 — "I should not be able to go into Heather's notes and
 * edit them"), rendered read-only for everyone with two live paths
 * left open server-side: collecting signatures and the employee's
 * response. The author alone may delete, and only while the employee
 * hasn't viewed, responded, or signed; fixing a mistake is delete +
 * re-document. RLS enforces all of this — the UI just tells the truth.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isEditor, clinicalNav } = useClinicalAccess()
const directory = useEmployeeDirectory()
const convs = useClinicalConversations()

const canLog = computed(() => isEditor.value || auth.isSupervisor || auth.isAdmin)

const recordId = ref(String(route.params.id ?? 'new'))
const existing = ref<ClinicalConversation | null>(null)
const locked = computed(() => !!existing.value)
const ready = ref(false)
const busy = ref(false)
const error = ref('')
const savedFlash = ref(false)
const deleteArm = ref(false)
const pdfBusy = ref(false)

/* ── form state (new records only) ── */
const employeeId = ref(String(route.query.user ?? ''))
const occurredLocal = ref(toLocalInput(new Date()))
const location = ref('')
const incidentNumber = ref('')
const callType = ref('')
const callDetails = ref('')
const discussion = ref('')
const requireSignatures = ref(false)
const present = ref<{ userId: string | null; displayName: string }[]>([])
const addStaffId = ref('')
const addExternal = ref('')

const people = computed(() =>
  directory.entries.value
    .filter((e) => e.id !== employeeId.value)
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
)
const employees = computed(() =>
  [...directory.entries.value].sort((a, b) => a.fullName.localeCompare(b.fullName)),
)
const employeeName = computed(
  () =>
    existing.value?.participants.find((p) => p.isEmployee)?.displayName ??
    directory.entries.value.find((e) => e.id === employeeId.value)?.fullName ??
    '',
)

/* The author may delete only while the employee hasn't seen, responded,
 * or signed — mirrored from the RLS delete policy so the button tells
 * the truth. */
const employeeSigned = computed(() =>
  (existing.value?.participants ?? []).some((p) => p.isEmployee && p.signatureData),
)
const canDelete = computed(
  () =>
    !!existing.value &&
    existing.value.createdBy === auth.appUser?.id &&
    !existing.value.viewedAt &&
    !existing.value.response &&
    !employeeSigned.value,
)

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localToIso(v: string): string {
  return new Date(v).toISOString()
}

function addStaff() {
  const p = directory.entries.value.find((e) => e.id === addStaffId.value)
  if (!p || present.value.some((x) => x.userId === p.id)) {
    addStaffId.value = ''
    return
  }
  present.value = [...present.value, { userId: p.id, displayName: p.fullName }]
  addStaffId.value = ''
}
function addExternalPerson() {
  const name = addExternal.value.trim()
  if (!name) return
  present.value = [...present.value, { userId: null, displayName: name }]
  addExternal.value = ''
}
function removePresent(i: number) {
  present.value = present.value.filter((_, idx) => idx !== i)
}

/* Documenter is present by definition — seed them on new records. */
function seedSelf() {
  const me = auth.appUser
  if (me && !present.value.some((p) => p.userId === me.id)) {
    present.value = [{ userId: me.id, displayName: me.fullName ?? 'Me' }, ...present.value]
  }
}

function hydrate(c: ClinicalConversation) {
  existing.value = c
  employeeId.value = c.userId
  occurredLocal.value = toLocalInput(new Date(c.occurredAt))
  location.value = c.location
  incidentNumber.value = c.incidentNumber
  callType.value = c.callType
  callDetails.value = c.callDetails
  discussion.value = c.discussion
  requireSignatures.value = c.requireSignatures
  present.value = c.participants
    .filter((p) => !p.isEmployee)
    .map((p) => ({ userId: p.userId, displayName: p.displayName }))
}

onMounted(async () => {
  if (recordId.value !== 'new') {
    const c = await convs.get(recordId.value)
    if (c) hydrate(c)
    else error.value = 'Conversation not found.'
  } else {
    seedSelf()
  }
  ready.value = true
})

watch(canLog, (ok) => {
  if (ready.value && !ok) void router.replace(clinicalNav.value.to)
})

const valid = computed(
  () => !!employeeId.value && !!occurredLocal.value && discussion.value.trim().length > 0,
)

async function save() {
  if (locked.value || !valid.value || busy.value) return
  busy.value = true
  error.value = ''
  const participants = [
    { userId: employeeId.value, displayName: employeeName.value, isEmployee: true },
    ...present.value.map((p) => ({ ...p, isEmployee: false })),
  ]
  const { id, error: e } = await convs.create({
    userId: employeeId.value,
    occurredAt: localToIso(occurredLocal.value),
    location: location.value,
    incidentNumber: incidentNumber.value,
    callType: callType.value,
    callDetails: callDetails.value,
    discussion: discussion.value,
    requireSignatures: requireSignatures.value,
    participants,
  })
  busy.value = false
  if (e || !id) {
    error.value = e ?? 'Save failed.'
    return
  }
  recordId.value = id
  await router.replace(`/clinical/conversation/${id}`)
  existing.value = await convs.get(id)
  savedFlash.value = true
  setTimeout(() => (savedFlash.value = false), 3200)
}

/* ── in-person signatures (on this device, after submit) ── */
const sigDraft = ref<Record<string, string>>({})
const sigBusy = ref('')

async function saveSignature(participantId: string) {
  const data = sigDraft.value[participantId]
  if (!data || sigBusy.value) return
  sigBusy.value = participantId
  const e = await convs.signParticipant(participantId, data)
  sigBusy.value = ''
  if (e) {
    error.value = e
    return
  }
  existing.value = await convs.get(recordId.value)
}

async function downloadPdf() {
  if (!existing.value || pdfBusy.value) return
  pdfBusy.value = true
  try {
    const doc = await generateClinicalConversationPdf(existing.value)
    doc.save(
      `Clinical Conversation - ${employeeName.value || 'record'} - ${occurredLocal.value.slice(0, 10)}.pdf`,
    )
  } finally {
    pdfBusy.value = false
  }
}

async function doDelete() {
  if (!canDelete.value) return
  if (!deleteArm.value) {
    deleteArm.value = true
    setTimeout(() => (deleteArm.value = false), 3200)
    return
  }
  const e = await convs.remove(recordId.value)
  if (e) {
    error.value = e
    return
  }
  void router.push(existing.value ? `/clinical/people/${existing.value.userId}` : '/clinical')
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
</script>

<template>
  <div class="cv">
    <ClinicalNav :crumbs="['Clinical conversation']" />

    <header class="cv__head">
      <div>
        <h1 class="display cv__title">Clinical conversation</h1>
        <p class="cv__sub">
          Documentation that a conversation took place — <b>not disciplinary</b>. The employee
          sees it immediately, is notified, and can add their own comments.
        </p>
      </div>
      <div class="cv__head-actions">
        <button
          v-if="existing"
          type="button"
          class="cv__btn"
          :disabled="pdfBusy"
          @click="downloadPdf"
        >
          <FileDown :size="13" :stroke-width="2" /> {{ pdfBusy ? 'Building…' : 'PDF' }}
        </button>
        <button
          v-if="canDelete"
          type="button"
          class="cv__btn cv__btn--danger"
          @click="doDelete"
        >
          <Trash2 :size="13" :stroke-width="2" /> {{ deleteArm ? 'Confirm delete' : 'Delete' }}
        </button>
      </div>
    </header>

    <div v-if="!ready" class="cv__empty">Loading…</div>
    <template v-else>
      <div v-if="savedFlash" class="cv__saved">
        <Check :size="14" :stroke-width="2.5" /> Submitted — the employee has been notified. The
        record is now locked.
      </div>
      <div v-if="error" class="cv__error">{{ error }}</div>

      <div v-if="locked && existing" class="cv__lockbar">
        <Lock :size="13" :stroke-width="2" />
        <span>
          Submitted record — read-only. Documented by <b>{{ existing.createdByName || '—' }}</b> ·
          {{ fmtDateTime(existing.createdAt) }}.
          <template v-if="canDelete"> Deletable until the employee opens it.</template>
          <template v-else-if="existing.createdBy === auth.appUser?.id">
            The employee has {{ existing.viewedAt ? 'opened' : existing.response ? 'responded to' : 'signed' }} it — it can no longer be deleted.
          </template>
        </span>
        <span v-if="existing.viewedAt" class="cv__viewed">
          <Eye :size="12" :stroke-width="2" /> Viewed by employee {{ fmtDateTime(existing.viewedAt) }}
        </span>
      </div>

      <div class="cv__grid">
        <!-- Who / when / where -->
        <section class="cv__card">
          <div class="cv__cardtitle">Conversation</div>
          <div class="cv__fields">
            <label class="cv__fld cv__fld--wide">
              <span>Employee</span>
              <select v-model="employeeId" :disabled="locked">
                <option value="" disabled>Select the employee…</option>
                <option v-for="p in employees" :key="p.id" :value="p.id">{{ p.fullName }}</option>
              </select>
            </label>
            <label class="cv__fld">
              <span>Date &amp; time it took place</span>
              <input v-model="occurredLocal" type="datetime-local" :disabled="locked" />
            </label>
            <label class="cv__fld">
              <span>Where it took place</span>
              <input v-model="location" type="text" placeholder="Station 201 office, phone call…" :disabled="locked" />
            </label>
            <label class="cv__fld">
              <span>Incident number</span>
              <input v-model="incidentNumber" type="text" placeholder="2026-012345" :disabled="locked" />
            </label>
            <label class="cv__fld">
              <span>Call type</span>
              <input v-model="callType" type="text" placeholder="Cardiac arrest, MVC, refusal…" :disabled="locked" />
            </label>
          </div>
        </section>

        <!-- Narrative -->
        <section class="cv__card">
          <div class="cv__cardtitle">Details of the call</div>
          <textarea
            v-model="callDetails"
            class="cv__area"
            rows="4"
            placeholder="Brief summary of the call this conversation is about."
            :disabled="locked"
          />
          <div class="cv__cardtitle" style="margin-top: 14px">What the discussion entailed</div>
          <textarea
            v-model="discussion"
            class="cv__area"
            rows="6"
            placeholder="What was discussed, teaching points, resources shared, follow-up agreed on."
            :disabled="locked"
          />
        </section>

        <!-- Present + signatures -->
        <section class="cv__card">
          <div class="cv__cardtitle">Who was present</div>
          <div class="cv__chips">
            <span class="cv__chip cv__chip--emp">{{ employeeName || 'Employee' }} <i>employee</i></span>
            <span v-for="(p, i) in present" :key="`${p.userId ?? p.displayName}-${i}`" class="cv__chip">
              {{ p.displayName }}
              <button v-if="!locked" type="button" class="cv__chip-x" aria-label="Remove" @click="removePresent(i)">
                <X :size="11" :stroke-width="2.5" />
              </button>
            </span>
          </div>
          <div v-if="!locked" class="cv__addrow">
            <select v-model="addStaffId" @change="addStaff">
              <option value="" disabled>Add staff present…</option>
              <option v-for="p in people" :key="p.id" :value="p.id">{{ p.fullName }}</option>
            </select>
            <div class="cv__addext">
              <input
                v-model="addExternal"
                type="text"
                placeholder="Someone not on the roster…"
                @keydown.enter.prevent="addExternalPerson"
              />
              <button type="button" class="cv__mini" @click="addExternalPerson">
                <Plus :size="12" :stroke-width="2.5" /> Add
              </button>
            </div>
          </div>

          <label class="cv__sigtoggle">
            <input v-model="requireSignatures" type="checkbox" :disabled="locked" />
            <span><b>Require signatures</b> — everyone present and the employee get a signature box.</span>
          </label>

          <template v-if="requireSignatures">
            <div v-if="!existing" class="cv__quiet">
              Submit the conversation first — the signature boxes appear here right after, so it
              can be passed around the room.
            </div>
            <div v-else class="cv__sigs">
              <div v-for="p in existing.participants" :key="p.id" class="cv__sig">
                <div class="cv__sig-name">
                  {{ p.displayName }}
                  <span v-if="p.isEmployee" class="cv__sig-tag">employee</span>
                </div>
                <template v-if="p.signatureData">
                  <img :src="p.signatureData" class="cv__sig-img" alt="Signature" />
                  <div class="cv__sig-when">Signed {{ p.signedAt ? fmtDateTime(p.signedAt) : '' }}</div>
                </template>
                <template v-else>
                  <SignaturePad :height="110" @change="(d) => (sigDraft[p.id] = d)" />
                  <button
                    type="button"
                    class="cv__mini cv__mini--primary"
                    :disabled="!sigDraft[p.id] || sigBusy === p.id"
                    @click="saveSignature(p.id)"
                  >
                    {{ sigBusy === p.id ? 'Saving…' : 'Save signature' }}
                  </button>
                  <div v-if="p.isEmployee" class="cv__sig-hint">
                    Can also sign from their own My Progress page.
                  </div>
                </template>
              </div>
            </div>
          </template>
        </section>

        <!-- Employee response -->
        <section v-if="existing?.response" class="cv__card cv__card--resp">
          <div class="cv__cardtitle">Employee comments</div>
          <p class="cv__resp">{{ existing.response }}</p>
          <div class="cv__sig-when">
            Added {{ existing.responseAt ? fmtDateTime(existing.responseAt) : '' }}
          </div>
        </section>

        <div class="cv__savebar">
          <button
            v-if="!locked"
            type="button"
            class="cv__btn cv__btn--primary"
            :disabled="!valid || busy"
            @click="save"
          >
            {{ busy ? 'Submitting…' : 'Submit conversation' }}
          </button>
          <button
            v-if="existing"
            type="button"
            class="cv__btn"
            @click="router.push(`/clinical/people/${existing.userId}`)"
          >
            Open clinical file
          </button>
          <span v-if="!locked && !valid" class="cv__quiet">Employee + discussion are required.</span>
          <span v-if="!locked" class="cv__quiet">
            Submitting locks the record — a mistake means delete and re-document (possible until
            the employee opens it).
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cv {
  max-width: 860px;
  margin: 0 auto;
  padding: 18px 16px 80px;
}
.cv__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0 16px;
}
.cv__title {
  font-size: 30px;
  line-height: 1.05;
}
.cv__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-ink-soft);
  max-width: 54ch;
}
.cv__head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.cv__empty {
  padding: 48px 0;
  text-align: center;
  color: var(--color-muted);
}
.cv__saved {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 12px;
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid oklch(0.5 0.14 150 / 0.4);
  background: oklch(0.5 0.14 150 / 0.08);
  color: var(--color-success-700, oklch(0.42 0.13 150));
  font-size: 13px;
  font-weight: 600;
}
.cv__error {
  margin-bottom: 12px;
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid oklch(0.5 0.19 27 / 0.4);
  background: oklch(0.5 0.19 27 / 0.07);
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  font-size: 13px;
}
.cv__lockbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  padding: 9px 13px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  font-size: 12.5px;
}
.cv__viewed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  font-weight: 600;
  color: var(--color-success-600, oklch(0.5 0.14 150));
}
.cv__grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cv__card {
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  padding: 16px;
  box-shadow: 0 1px 3px oklch(0.18 0.015 260 / 0.05);
}
.cv__card--resp {
  border-left: 3px solid var(--color-accent-500);
}
.cv__cardtitle {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 10px;
}
.cv__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.cv__fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.cv__fld--wide {
  grid-column: 1 / -1;
}
.cv__fld input,
.cv__fld select,
.cv__area,
.cv__addrow select,
.cv__addext input {
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-canvas);
  padding: 9px 11px;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
}
.cv__fld input:disabled,
.cv__fld select:disabled,
.cv__area:disabled {
  opacity: 1;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border-style: dashed;
  cursor: default;
}
.cv__fld input:focus,
.cv__fld select:focus,
.cv__area:focus,
.cv__addext input:focus {
  outline: 2px solid var(--color-accent-500);
  outline-offset: -1px;
}
.cv__area {
  width: 100%;
  resize: vertical;
  line-height: 1.55;
}
.cv__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 10px;
}
.cv__chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  font-size: 12.5px;
  font-weight: 600;
}
.cv__chip--emp {
  border-color: oklch(0.734 0.114 86.8 / 0.55);
  background: oklch(0.734 0.114 86.8 / 0.1);
}
.cv__chip--emp i {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700, oklch(0.5 0.1 86.8));
}
.cv__chip-x {
  display: inline-flex;
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
}
.cv__chip-x:hover {
  color: var(--color-danger-600, oklch(0.5 0.19 27));
}
.cv__addrow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.cv__addext {
  display: flex;
  gap: 8px;
}
.cv__addext input {
  flex: 1;
}
.cv__sigtoggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-line);
  font-size: 13px;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.cv__sigtoggle input {
  margin-top: 2px;
  accent-color: var(--color-brand-600);
}
.cv__sigs {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.cv__sig {
  border: 1px solid var(--color-line);
  border-radius: 11px;
  padding: 10px;
  background: var(--color-canvas);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cv__sig-name {
  font-size: 12.5px;
  font-weight: 700;
}
.cv__sig-tag {
  margin-left: 6px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent-700, oklch(0.5 0.1 86.8));
}
.cv__sig-img {
  background: white;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  max-height: 90px;
  object-fit: contain;
}
.cv__sig-when,
.cv__sig-hint {
  font-size: 11px;
  color: var(--color-muted);
}
.cv__resp {
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.cv__savebar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 4px 2px 0;
}
.cv__btn {
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
.cv__btn:hover:not(:disabled) {
  border-color: var(--color-accent-500);
}
.cv__btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.cv__btn--primary {
  background: var(--color-brand-600);
  border-color: var(--color-brand-700);
  color: white;
}
.cv__btn--primary:hover:not(:disabled) {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
}
.cv__btn--danger:hover {
  border-color: oklch(0.5 0.19 27 / 0.6);
  color: var(--color-danger-600, oklch(0.5 0.19 27));
}
.cv__mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  padding: 6px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cv__mini--primary {
  background: var(--color-brand-600);
  border-color: var(--color-brand-700);
  color: white;
}
.cv__mini:disabled {
  opacity: 0.5;
  cursor: default;
}
.cv__quiet {
  font-size: 12px;
  color: var(--color-muted);
}
@media (max-width: 640px) {
  .cv__fields,
  .cv__addrow {
    grid-template-columns: 1fr;
  }
  .cv__head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
