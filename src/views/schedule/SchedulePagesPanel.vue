<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  todayCentralIso,
  addDaysIso,
  type OpenShiftItem,
  type PageLogRow,
  type SchedPerson,
} from '@/composables/useSchedule'

/**
 * Page-outs — supervisors and editors blast open shifts and
 * announcements to the crew over push + email + text. Compose →
 * preview the exact recipient list (remove or add people) → send.
 * Claims come back through the normal pickup flow, so the Requests
 * queue is the ordered claims list (with hours context) and approval
 * fills the seat.
 */

const sched = useSchedule()

onMounted(async () => {
  await sched.ensureLoaded()
  await refreshLog()
})

// ── compose ──────────────────────────────────────────────────────────

const message = ref('')
const chPush = ref(true)
const chEmail = ref(true)
const chSms = ref(true)

const GROUPS = [
  { key: 'everyone', label: 'Entire roster' },
  { key: 'supervisors', label: 'Supervisors' },
  { key: 'paramedics', label: 'Paramedics' },
  { key: 'aemts', label: 'AEMTs' },
  { key: 'emts', label: 'EMTs' },
  { key: 'ftos', label: 'FTOs' },
  { key: 'part_time', label: 'Part-time' },
]

const pickedGroups = ref<Set<string>>(new Set())
function toggleGroup(key: string) {
  const s = new Set(pickedGroups.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  pickedGroups.value = s
}

/** Optional: only people NOT working this date. */
const offDutyDate = ref('')

function inGroup(p: SchedPerson, key: string): boolean {
  const cred = p.credential ?? ''
  switch (key) {
    case 'everyone':
      return true
    case 'supervisors':
      return p.role === 'supervisor' || cred === 'Supervisor'
    case 'paramedics':
      return ['P1C', 'P1', 'P2', 'P3', 'P2-FTO', 'P3-FTO'].includes(cred)
    case 'aemts':
      return cred === 'AEMT'
    case 'emts':
      return cred === 'EMT' || cred === 'EMT-FTO'
    case 'ftos':
      return cred.endsWith('-FTO')
    case 'part_time':
      return p.employmentType === 'part_time'
    default:
      return false
  }
}

const groupPool = computed(() => {
  if (pickedGroups.value.size === 0) return []
  return sched.people.value.filter((p) => [...pickedGroups.value].some((g) => inGroup(p, g)))
})

// ── open shifts to attach ────────────────────────────────────────────

const shiftDays = ref(7)
const openItems = ref<OpenShiftItem[]>([])
const openLoaded = ref(false)
const openBusy = ref(false)
const pickedShifts = ref<Set<number>>(new Set())

async function findShifts() {
  openBusy.value = true
  const start = todayCentralIso()
  openItems.value = await sched.findOpenShifts(start, addDaysIso(start, shiftDays.value - 1))
  pickedShifts.value = new Set()
  openLoaded.value = true
  openBusy.value = false
}

function toggleShift(i: number) {
  const s = new Set(pickedShifts.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  pickedShifts.value = s
}

// ── preview + send ───────────────────────────────────────────────────

const step = ref<'compose' | 'preview'>('compose')
const removed = ref<Set<string>>(new Set())
const added = ref<Set<string>>(new Set())
const addPick = ref('')
const err = ref<string | null>(null)
const busy = ref(false)
const sentResult = ref<string | null>(null)
const offDutyExcluded = ref(0)
const baseRecipients = ref<SchedPerson[]>([])

async function toPreview() {
  err.value = null
  sentResult.value = null
  if (!message.value.trim() && pickedShifts.value.size === 0) {
    err.value = 'Write a message or attach at least one open shift.'
    return
  }
  if (pickedGroups.value.size === 0) {
    err.value = 'Pick at least one audience group.'
    return
  }
  if (!chPush.value && !chEmail.value && !chSms.value) {
    err.value = 'Pick at least one channel.'
    return
  }
  busy.value = true
  let pool = groupPool.value
  offDutyExcluded.value = 0
  if (offDutyDate.value) {
    const working = await sched.assignedUserIdsOn(offDutyDate.value)
    const before = pool.length
    pool = pool.filter((p) => !working.has(p.id))
    offDutyExcluded.value = before - pool.length
  }
  removed.value = new Set()
  added.value = new Set()
  baseRecipients.value = pool
  busy.value = false
  step.value = 'preview'
}

const previewList = computed(() => {
  const base = baseRecipients.value.filter((p) => !removed.value.has(p.id))
  const extra = sched.people.value.filter(
    (p) => added.value.has(p.id) && !base.some((b) => b.id === p.id),
  )
  return [...base, ...extra].sort((a, b) => a.fullName.localeCompare(b.fullName))
})

const addable = computed(() =>
  sched.people.value.filter((p) => !previewList.value.some((r) => r.id === p.id)),
)

function removePerson(id: string) {
  if (added.value.has(id)) {
    const s = new Set(added.value)
    s.delete(id)
    added.value = s
  } else {
    removed.value = new Set([...removed.value, id])
  }
}

function addPerson() {
  if (!addPick.value) return
  added.value = new Set([...added.value, addPick.value])
  addPick.value = ''
}

const finalMessage = computed(() => {
  const base = message.value.trim()
  const shifts = [...pickedShifts.value]
    .sort((a, b) => a - b)
    .map((i) => openItems.value[i])
    .filter(Boolean)
  if (shifts.length === 0) return base
  const lines = shifts.map((s) => `• ${s.text}`).join('\n')
  return base ? `${base}\n\nOpen shifts:\n${lines}` : `Open shifts:\n${lines}`
})

async function send() {
  err.value = null
  if (previewList.value.length === 0) {
    err.value = 'Nobody left on the recipient list.'
    return
  }
  busy.value = true
  const shifts = [...pickedShifts.value].map((i) => openItems.value[i]).filter(Boolean)
  const { id, error } = await sched.createPageOut({
    message: finalMessage.value,
    channels: { push: chPush.value, email: chEmail.value, sms: chSms.value },
    audience: {
      groups: [...pickedGroups.value],
      offDutyDate: offDutyDate.value || null,
      removed: [...removed.value],
      added: [...added.value],
    },
    entryIds: shifts.map((s) => s.entryId).filter((x): x is string => !!x),
    recipients: previewList.value.map((p) => p.id),
  })
  if (error || !id) {
    err.value = error ?? 'Could not save the page-out.'
    busy.value = false
    return
  }
  const res = await sched.sendPageOut(id)
  busy.value = false
  if (res.error) {
    err.value = `Saved, but sending failed: ${res.error}`
    await refreshLog()
    return
  }
  const d = res.delivery ?? {}
  const bits = [`${d.push ?? 0} push`, `${d.email ?? 0} email`, `${d.sms ?? 0} text`]
  const issues = (d.errors ?? []).length
  sentResult.value = `Sent — ${bits.join(' · ')}${issues ? ` · ${issues} issue${issues === 1 ? '' : 's'} (details in the log)` : ''}.`
  message.value = ''
  pickedShifts.value = new Set()
  pickedGroups.value = new Set()
  offDutyDate.value = ''
  openLoaded.value = false
  openItems.value = []
  step.value = 'compose'
  await refreshLog()
}

// ── log ──────────────────────────────────────────────────────────────

const log = ref<PageLogRow[]>([])
const logLoaded = ref(false)

async function refreshLog() {
  log.value = await sched.fetchPageLog()
  logLoaded.value = true
}

function senderName(id: string | null): string {
  if (!id) return 'Unknown'
  return sched.personById.value.get(id)?.fullName ?? 'Former member'
}

function fmtSent(at: string): string {
  return new Date(at).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function deliveryLine(p: PageLogRow): string {
  if (!p.delivery) return 'delivery pending'
  const d = p.delivery
  const bits = [`${d.push ?? 0} push`, `${d.email ?? 0} email`, `${d.sms ?? 0} text`]
  if (d.skipped_sms) bits.push(`${d.skipped_sms} opted in but no usable phone`)
  return bits.join(' · ')
}
</script>

<template>
  <div class="pg">
    <div class="pg__cols">
      <!-- ── composer ── -->
      <section class="pg__card">
        <h2 class="pg__h">Send a page-out</h2>
        <p class="pg__muted">
          Goes to each person over the channels they have enabled for open-shift messages.
          Crews claim the shifts the normal way — the requests land on the Requests tab in the
          order they come in, with each claimant's hours.
        </p>

        <p v-if="err" class="pg__error">{{ err }}</p>
        <p v-if="sentResult" class="pg__sent">{{ sentResult }}</p>

        <template v-if="step === 'compose'">
          <label class="pg__label" for="pg-msg">Message</label>
          <textarea
            id="pg-msg"
            v-model="message"
            class="pg__textarea"
            rows="3"
            placeholder="Open medic seat this weekend — see the shifts below and put in for what you can take."
          ></textarea>

          <div class="pg__row">
            <span class="pg__label">Channels</span>
            <label class="pg__check"><input v-model="chPush" type="checkbox" /> Push</label>
            <label class="pg__check"><input v-model="chEmail" type="checkbox" /> Email</label>
            <label class="pg__check"><input v-model="chSms" type="checkbox" /> Text</label>
          </div>

          <span class="pg__label">Audience</span>
          <div class="pg__groups">
            <button
              v-for="g in GROUPS"
              :key="g.key"
              class="pg__chip"
              :class="{ 'pg__chip--on': pickedGroups.has(g.key) }"
              type="button"
              @click="toggleGroup(g.key)"
            >
              {{ g.label }}
            </button>
          </div>
          <div class="pg__row">
            <label class="pg__label" for="pg-offduty">Only people off duty on</label>
            <input id="pg-offduty" v-model="offDutyDate" type="date" class="pg__input" />
            <button v-if="offDutyDate" class="pg__mini" type="button" @click="offDutyDate = ''">Clear</button>
          </div>

          <div class="pg__row pg__row--shifts">
            <span class="pg__label">Attach open shifts</span>
            <select v-model.number="shiftDays" class="pg__input" aria-label="Days ahead">
              <option :value="7">next 7 days</option>
              <option :value="14">next 14 days</option>
            </select>
            <button class="pg__mini" type="button" :disabled="openBusy" @click="findShifts">
              {{ openBusy ? 'Looking…' : openLoaded ? 'Refresh' : 'Find open shifts' }}
            </button>
          </div>
          <div v-if="openLoaded" class="pg__shifts">
            <p v-if="openItems.length === 0" class="pg__muted">No open coverage in that window.</p>
            <label v-for="(s, i) in openItems" :key="i" class="pg__shift">
              <input type="checkbox" :checked="pickedShifts.has(i)" @change="toggleShift(i)" />
              <span>{{ s.text }}</span>
            </label>
          </div>

          <div class="pg__foot">
            <span class="pg__muted" v-if="pickedGroups.size > 0">{{ groupPool.length }} in the selected groups</span>
            <button class="pg__btn pg__btn--primary" :disabled="busy" @click="toPreview">
              {{ busy ? 'Working…' : 'Preview recipients' }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="pg__label">Message that will go out</p>
          <pre class="pg__previewmsg">{{ finalMessage }}</pre>

          <p class="pg__label">
            Recipients ({{ previewList.length }})
            <span v-if="offDutyExcluded > 0" class="pg__muted"> · {{ offDutyExcluded }} excluded as on duty {{ offDutyDate }}</span>
          </p>
          <div class="pg__people">
            <span v-for="p in previewList" :key="p.id" class="pg__person">
              {{ p.fullName }}
              <button class="pg__x" type="button" :aria-label="`Remove ${p.fullName}`" @click="removePerson(p.id)">×</button>
            </span>
          </div>
          <div class="pg__row">
            <select v-model="addPick" class="pg__input" aria-label="Add a recipient">
              <option value="">Add a person…</option>
              <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.fullName }}</option>
            </select>
            <button class="pg__mini" type="button" :disabled="!addPick" @click="addPerson">Add</button>
          </div>

          <div class="pg__foot">
            <button class="pg__btn" :disabled="busy" @click="step = 'compose'">Back</button>
            <button class="pg__btn pg__btn--primary" :disabled="busy || previewList.length === 0" @click="send">
              {{ busy ? 'Sending…' : `Send to ${previewList.length} ${previewList.length === 1 ? 'person' : 'people'}` }}
            </button>
          </div>
        </template>
      </section>

      <!-- ── log ── -->
      <section class="pg__card">
        <h2 class="pg__h">Recent page-outs</h2>
        <p v-if="logLoaded && log.length === 0" class="pg__muted">Nothing sent yet.</p>
        <div v-for="p in log" :key="p.id" class="pg__logrow">
          <div class="pg__loghead">
            <span class="pg__logwhen">{{ fmtSent(p.sentAt) }}</span>
            <span class="pg__logwho">{{ senderName(p.sentBy) }}</span>
            <span class="pg__logcount">{{ p.recipients.length }} recipient{{ p.recipients.length === 1 ? '' : 's' }}</span>
          </div>
          <p class="pg__logmsg">{{ p.message }}</p>
          <p class="pg__logmeta">
            {{ deliveryLine(p) }}
            <template v-if="p.entryIds.length > 0">
              · shifts attached: {{ p.entryIds.length }} ({{ p.entriesOpen }} still open)
            </template>
          </p>
          <p v-if="p.delivery?.errors?.length" class="pg__logerr">
            {{ p.delivery.errors.join(' · ') }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pg__cols {
  display: grid;
  grid-template-columns: minmax(380px, 560px) minmax(320px, 1fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 900px) {
  .pg__cols {
    grid-template-columns: 1fr;
  }
}

.pg__card {
  background:
    linear-gradient(180deg, oklch(1 0 0 / 0.85), oklch(0.985 0.004 84 / 0.85)),
    var(--color-surface);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-brand-700);
  border-radius: 14px;
  box-shadow: 0 10px 30px oklch(0.2 0.04 260 / 0.1), 0 2px 8px oklch(0.2 0.04 260 / 0.07);
  padding: 1rem 1.1rem 1.1rem;
}

.pg__h {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--color-ink);
  margin: 0 0 0.35rem;
}

.pg__muted {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0 0 0.6rem;
}

.pg__error {
  font-size: 0.8rem;
  color: oklch(0.5 0.19 27);
  background: oklch(0.98 0.013 27);
  border: 1px solid oklch(0.88 0.06 27);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
}

.pg__sent {
  font-size: 0.82rem;
  font-weight: 600;
  color: oklch(0.45 0.12 150);
  background: oklch(0.97 0.02 150);
  border: 1px solid oklch(0.87 0.06 150);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
}

.pg__label {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0.5rem 0 0.3rem;
}

.pg__textarea {
  width: 100%;
  font: inherit;
  font-size: 0.88rem;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 0.5rem 0.65rem;
  background: var(--color-surface);
  resize: vertical;
}

.pg__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin: 0.35rem 0;
}

.pg__row .pg__label {
  margin: 0;
}

.pg__check {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
}

.pg__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.pg__chip {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-soft, var(--color-surface)));
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 0.22rem 0.7rem;
  cursor: pointer;
  box-shadow: 0 1px 2px oklch(0.2 0.04 260 / 0.08);
}

.pg__chip:hover {
  border-color: var(--color-brand-300);
}

.pg__chip--on {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  border-color: var(--color-brand-800);
  color: white;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18);
}

.pg__input {
  font: inherit;
  font-size: 0.82rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.26rem 0.5rem;
  background: var(--color-surface);
}

.pg__mini {
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-soft, var(--color-surface)));
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.24rem 0.6rem;
  cursor: pointer;
}

.pg__mini:hover {
  border-color: var(--color-brand-300);
}

.pg__shifts {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 0.35rem 0.6rem;
  max-height: 220px;
  overflow-y: auto;
  margin: 0.2rem 0 0.4rem;
}

.pg__shift {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  font-size: 0.82rem;
  color: var(--color-ink-soft);
  padding: 0.18rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-variant-numeric: tabular-nums;
}

.pg__shift:last-child {
  border-bottom: 0;
}

.pg__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.8rem;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 0.7rem;
}

.pg__foot .pg__muted {
  margin: 0 auto 0 0;
}

.pg__btn {
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-soft, var(--color-surface)));
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  box-shadow: 0 1px 2px oklch(0.2 0.04 260 / 0.08);
}

.pg__btn:hover {
  border-color: var(--color-brand-300);
}

.pg__btn--primary {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  border-color: var(--color-brand-800);
  color: white;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18), 0 1px 2px oklch(0.2 0.04 260 / 0.2);
}

.pg__btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.pg__previewmsg {
  font: inherit;
  font-size: 0.85rem;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  white-space: pre-wrap;
  margin: 0 0 0.4rem;
}

.pg__people {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
}

.pg__person {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 0.14rem 0.3rem 0.14rem 0.6rem;
}

.pg__x {
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  border: 0;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0 0.25rem;
}

.pg__x:hover {
  color: oklch(0.5 0.19 27);
}

/* log */
.pg__logrow {
  border-top: 1px solid var(--color-line-soft);
  padding: 0.55rem 0;
}

.pg__logrow:first-of-type {
  border-top: 0;
}

.pg__loghead {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.pg__logwhen {
  font-size: 0.75rem;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}

.pg__logwho {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-ink);
}

.pg__logcount {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin-left: auto;
}

.pg__logmsg {
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  margin: 0.2rem 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pg__logmeta {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.pg__logerr {
  font-size: 0.74rem;
  color: oklch(0.5 0.19 27);
  margin: 0.15rem 0 0;
  overflow-wrap: anywhere;
}
</style>
