<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import ScheduleSpinner from './ScheduleSpinner.vue'
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

const ready = ref(false)
onMounted(async () => {
  await sched.ensureLoaded()
  await refreshLog()
  ready.value = true
})

// ── compose ──────────────────────────────────────────────────────────

const message = ref('')
const msgType = ref<'scheduling' | 'announcement'>('scheduling')

/** Scheduling page-out text is hard-capped so the SMS always fits the
 *  shifts, link, and STOP footer un-truncated (matches the function's
 *  120-char lead cap). Announcements may run longer — email/push carry
 *  the full text; texts show the first 120. */
const SMS_LEAD_MAX = 120
const msgMax = computed(() => (msgType.value === 'scheduling' ? SMS_LEAD_MAX : 600))
const urgent = ref(false)
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

/** Optional: only people NOT working this date. */
const offDutyDate = ref('')

function inGroup(p: SchedPerson, key: string): boolean {
  const cred = p.credential ?? ''
  switch (key) {
    case 'everyone':
      return true
    case 'supervisors':
      // leadership blast: field sups + command staff (Chief/Asst/CDO)
      return (
        p.role === 'supervisor' ||
        p.role === 'admin' ||
        ['Supervisor', 'Chief', 'Assistant Chief', 'CDO'].includes(cred)
      )
    case 'paramedics':
      return ['P1C', 'P1', 'P2', 'P3', 'P4', 'P2-FTO', 'P3-FTO'].includes(cred)
    case 'aemts':
      return cred === 'AEMT' || cred === 'AEMT-FTO'
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

/* Aladtec-style recipient roster (Justin, 2026-09-24): the audience IS
   the roster — filter by position/employment, tick people, select-all
   on what's shown. Groups became the filter, not chips. */
const rosterFilter = ref('everyone')
const rosterQ = ref('')
const pickedIds = ref<Set<string>>(new Set())

const rosterShown = computed(() => {
  const q = rosterQ.value.trim().toLowerCase()
  return sched.people.value.filter(
    (p) => inGroup(p, rosterFilter.value) && (!q || p.fullName.toLowerCase().includes(q)),
  )
})

const allShownPicked = computed(
  () => rosterShown.value.length > 0 && rosterShown.value.every((p) => pickedIds.value.has(p.id)),
)

function togglePicked(id: string) {
  const s = new Set(pickedIds.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  pickedIds.value = s
}

function toggleAllShown() {
  const s = new Set(pickedIds.value)
  if (allShownPicked.value) for (const p of rosterShown.value) s.delete(p.id)
  else for (const p of rosterShown.value) s.add(p.id)
  pickedIds.value = s
}

function employmentShort(p: SchedPerson): string {
  return p.employmentType === 'part_time' ? 'Part-time' : p.employmentType === 'full_time' ? 'Full-time' : '—'
}

const groupPool = computed(() =>
  sched.people.value.filter((p) => pickedIds.value.has(p.id)),
)

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

// ── review + send (modal) ────────────────────────────────────────────

interface RecipRow {
  p: SchedPerson
  on: boolean
  source: 'group' | 'always' | 'added'
}

const previewOpen = ref(false)
const recip = ref<RecipRow[]>([])
const addPick = ref('')
const err = ref<string | null>(null)
const busy = ref(false)
const sentResult = ref<string | null>(null)
const offDutyExcluded = ref(0)

const selectedShifts = computed(() =>
  msgType.value === 'scheduling'
    ? [...pickedShifts.value].sort((a, b) => a - b).map((i) => openItems.value[i]).filter(Boolean)
    : [],
)

/** Mirrors sched-notify's no-text default so the preview shows exactly
 *  what recipients get when the message box is left empty. */
const previewLead = computed(() => {
  const m = message.value.trim()
  if (m) return m
  if (msgType.value === 'announcement') return ''
  const n = selectedShifts.value.length
  if (n === 1) return 'Open shift available — can you take it?'
  if (n > 1) return `${n} open shifts available — grab what you can.`
  return ''
})

/** Setup → Page-outs → "Always include" (the Chief wants every message
 *  even when a group filter wouldn't catch her). Preseeds the list —
 *  still untickable for a specific send. */
const alwaysIncludeIds = computed(() => {
  const v = (sched.settings.value['pageout'] ?? {}) as { always_include?: unknown }
  const ids = Array.isArray(v.always_include) ? (v.always_include as unknown[]) : []
  return ids.filter((x): x is string => typeof x === 'string')
})

/* Rendered previews mirror sched-notify's composition exactly — what
   crews will actually receive, shown BEFORE send (Justin, 2026-09-24). */
const urgentNote = computed(() => {
  const v = (sched.settings.value['pageout'] ?? {}) as { urgent_note?: string }
  return (v.urgent_note ?? '').trim() || 'Immediate opening — call S201 or S202 to pick up.'
})

const smsPreview = computed(() => {
  const lead = previewLead.value
  const smsLead = lead.length > 120 ? `${lead.slice(0, 119)}…` : lead
  let sms = `${urgent.value ? 'URGENT — ' : ''}WCEMS: ${smsLead}`
  for (const s of selectedShifts.value.slice(0, 2)) sms += `\n${s.text}`
  if (selectedShifts.value.length > 2) sms += `\n+${selectedShifts.value.length - 2} more on the portal`
  if (urgent.value) sms += `\n${urgentNote.value}`
  sms += '\nemployee.wallercountyems.com/schedule'
  sms += '\nReply STOP to opt out, HELP for help.'
  return sms
})

async function toPreview() {
  err.value = null
  sentResult.value = null
  if (!message.value.trim() && selectedShifts.value.length === 0) {
    err.value =
      msgType.value === 'announcement'
        ? 'Write the announcement first.'
        : 'Write a message or attach at least one open shift.'
    return
  }
  // Belt-and-suspenders for text typed before a type switch — the
  // textarea maxlength already blocks new typing past the cap.
  if (msgType.value === 'scheduling' && message.value.trim().length > SMS_LEAD_MAX) {
    err.value = `Scheduling page-out text is capped at ${SMS_LEAD_MAX} characters so the text message keeps the shifts, link, and opt-out line intact — currently ${message.value.trim().length}.`
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
  const rows: RecipRow[] = pool.map((p) => ({ p, on: true, source: 'group' as const }))
  for (const id of alwaysIncludeIds.value) {
    if (rows.some((r) => r.p.id === id)) continue
    const p = sched.personById.value.get(id)
    if (p) rows.push({ p, on: true, source: 'always' })
  }
  recip.value = rows
  busy.value = false
  previewOpen.value = true
}

const selectedCount = computed(() => recip.value.filter((r) => r.on).length)

function setAllRecip(on: boolean) {
  recip.value = recip.value.map((r) => ({ ...r, on }))
}

const addable = computed(() =>
  sched.people.value.filter((p) => !recip.value.some((r) => r.p.id === p.id)),
)

function addPerson() {
  if (!addPick.value) return
  const p = sched.personById.value.get(addPick.value)
  if (p) recip.value = [...recip.value, { p, on: true, source: 'added' }]
  addPick.value = ''
}

async function send() {
  err.value = null
  const finals = recip.value.filter((r) => r.on)
  if (finals.length === 0) {
    err.value = 'Nobody selected — tick at least one recipient.'
    return
  }
  busy.value = true
  const { id, error } = await sched.createPageOut({
    message: message.value.trim(),
    messageType: msgType.value,
    urgent: urgent.value,
    shifts: selectedShifts.value,
    channels: { push: chPush.value, email: chEmail.value, sms: chSms.value },
    audience: {
      groups: [rosterFilter.value],
      offDutyDate: offDutyDate.value || null,
      removed: recip.value.filter((r) => !r.on).map((r) => r.p.id),
      added: recip.value.filter((r) => r.on && r.source !== 'group').map((r) => r.p.id),
    },
    recipients: finals.map((r) => r.p.id),
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
  urgent.value = false
  msgType.value = 'scheduling'
  pickedShifts.value = new Set()
  pickedIds.value = new Set()
  offDutyDate.value = ''
  openLoaded.value = false
  openItems.value = []
  recip.value = []
  previewOpen.value = false
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
    <ScheduleSpinner v-if="!ready" label="Loading page-outs…" />
    <div v-else class="pg__cols">
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

        <template v-if="true">
          <div class="pg__row">
            <span class="pg__label">Type</span>
            <div class="pg__seg">
              <button
                class="pg__segbtn"
                :class="{ 'pg__segbtn--on': msgType === 'scheduling' }"
                type="button"
                @click="msgType = 'scheduling'"
              >
                Scheduling page-out
              </button>
              <button
                class="pg__segbtn"
                :class="{ 'pg__segbtn--on': msgType === 'announcement' }"
                type="button"
                @click="msgType = 'announcement'"
              >
                Announcement
              </button>
            </div>
            <label class="pg__check pg__check--urgent">
              <input v-model="urgent" type="checkbox" />
              Urgent — last-minute callout
            </label>
          </div>

          <label class="pg__label" for="pg-msg">Message</label>
          <textarea
            id="pg-msg"
            v-model="message"
            class="pg__textarea"
            rows="3"
            :maxlength="msgMax"
            placeholder="Open medic seat this weekend — see the shifts below and put in for what you can take."
          ></textarea>
          <p class="pg__charcount" :class="{ 'pg__charcount--max': message.length >= msgMax }">
            {{ message.length }} / {{ msgMax }}
            <template v-if="msgType === 'scheduling'">
              — capped so the text message keeps shifts, link, and opt-out intact
            </template>
            <template v-else-if="message.length > 120">
              — texts show the first 120 characters; email and push carry the full announcement
            </template>
          </p>

          <div class="pg__row">
            <span class="pg__label">Channels</span>
            <label class="pg__check"><input v-model="chPush" type="checkbox" /> Push</label>
            <label class="pg__check"><input v-model="chEmail" type="checkbox" /> Email</label>
            <label class="pg__check"><input v-model="chSms" type="checkbox" /> Text</label>
          </div>

          <div v-if="msgType === 'scheduling'" class="pg__row pg__row--shifts">
            <span class="pg__label">Attach open shifts</span>
            <select v-model.number="shiftDays" class="pg__input" aria-label="Days ahead">
              <option :value="7">next 7 days</option>
              <option :value="14">next 14 days</option>
            </select>
            <button class="pg__mini" type="button" :disabled="openBusy" @click="findShifts">
              {{ openBusy ? 'Looking…' : openLoaded ? 'Refresh' : 'Find open shifts' }}
            </button>
          </div>
          <div v-if="msgType === 'scheduling' && openLoaded" class="pg__shifts">
            <p v-if="openItems.length === 0" class="pg__muted">No open coverage in that window.</p>
            <label v-for="(s, i) in openItems" :key="i" class="pg__shift">
              <input type="checkbox" :checked="pickedShifts.has(i)" @change="toggleShift(i)" />
              <span>{{ s.text }}</span>
            </label>
          </div>

          <!-- Aladtec-style recipients: the roster itself, filtered and
               ticked person by person (Justin, 2026-09-24) -->
          <span class="pg__label">Recipients</span>
          <div class="pg__rosterbar">
            <select v-model="rosterFilter" class="pg__input" aria-label="Filter roster">
              <option v-for="g in GROUPS" :key="g.key" :value="g.key">{{ g.label }}</option>
            </select>
            <input v-model="rosterQ" type="search" class="pg__input pg__rosterq" placeholder="Search…" aria-label="Search roster" />
            <span class="pg__selcount">{{ pickedIds.size }} selected</span>
          </div>
          <div class="pg__row">
            <label class="pg__label pg__label--inline" for="pg-offduty">Only people off duty on</label>
            <input id="pg-offduty" v-model="offDutyDate" type="date" class="pg__input" />
            <button v-if="offDutyDate" class="pg__mini" type="button" @click="offDutyDate = ''">Clear</button>
          </div>
          <div class="pg__roster">
            <table class="pg__rtable">
              <thead>
                <tr>
                  <th class="pg__rcheck"><input type="checkbox" :checked="allShownPicked" title="Select everyone shown" aria-label="Select everyone shown" @change="toggleAllShown" /></th>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Phone</th>
                  <th>Employment</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in rosterShown" :key="p.id" class="pg__rrow" @click="togglePicked(p.id)">
                  <td class="pg__rcheck"><input type="checkbox" :checked="pickedIds.has(p.id)" :aria-label="`Include ${p.fullName}`" @click.stop @change="togglePicked(p.id)" /></td>
                  <td class="pg__rname">{{ p.fullName }}</td>
                  <td class="pg__rmut">{{ p.credential ?? '—' }}</td>
                  <td class="pg__rmut pg__rnum">{{ p.phone ?? '—' }}</td>
                  <td class="pg__rmut">{{ employmentShort(p) }}</td>
                </tr>
                <tr v-if="rosterShown.length === 0">
                  <td colspan="5" class="pg__recempty">Nobody matches that filter.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pg__foot">
            <span class="pg__muted" v-if="pickedIds.size > 0">Preview shows the exact email and text before anything sends.</span>
            <span class="pg__muted" v-else>Tick who this goes to — you can still add or remove people on the preview.</span>
            <button class="pg__btn pg__btn--primary" :disabled="busy" @click="toPreview">
              {{ busy ? 'Working…' : `Preview & send${pickedIds.size ? ` (${pickedIds.size} selected)` : ''}` }}
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
            <span v-if="p.urgent" class="pg__urgentchip">URGENT</span>
            <span v-if="p.messageType === 'announcement'" class="pg__typechip">Announcement</span>
            <span class="pg__logcount">{{ p.recipients.length }} recipient{{ p.recipients.length === 1 ? '' : 's' }}</span>
          </div>
          <p v-if="p.message" class="pg__logmsg">{{ p.message }}</p>
          <p v-for="(sh, i) in p.shifts" :key="i" class="pg__logshift">{{ sh.text }}</p>
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

    <!-- review & send modal: the exact message up top, recipient table
         with per-person checkboxes below -->
    <div v-if="previewOpen" class="pg__overlay" @click.self="previewOpen = false">
      <div class="pg__modal" role="dialog" aria-label="Preview and send">
        <h3 class="pg__mtitle">Preview &amp; send</h3>

        <!-- the EXACT messages, rendered — nothing sends blind
             (Justin, 2026-09-24) -->
        <div class="pg__prevrow">
          <div v-if="chEmail || chPush" class="pg__prevcol">
            <p class="pg__prevlabel">{{ chEmail ? 'Email' : 'Push' }} <span v-if="urgent" class="pg__urgentchip">URGENT</span></p>
            <div class="pg__mailcard">
              <p class="pg__mailbrand">WALLER COUNTY EMS<span>SCHEDULING</span></p>
              <p class="pg__mailline">Hi &lt;first name&gt;,</p>
              <p v-if="previewLead" class="pg__mailline">{{ previewLead }}</p>
              <template v-if="selectedShifts.length">
                <p class="pg__mailline"><b>Open shift{{ selectedShifts.length === 1 ? '' : 's' }} — tap one to request it:</b></p>
                <p v-for="(sh, i) in selectedShifts" :key="i" class="pg__maillink">{{ sh.text }}</p>
              </template>
              <p v-if="urgent" class="pg__mailurgent">{{ urgentNote }}</p>
              <span class="pg__mailbtn">Open the schedule</span>
            </div>
          </div>
          <div v-if="chSms" class="pg__prevcol">
            <p class="pg__prevlabel">Text message</p>
            <pre class="pg__smscard">{{ smsPreview }}</pre>
          </div>
        </div>
        <p v-if="!message.trim() && msgType === 'scheduling' && selectedShifts.length > 0" class="pg__msgnote">
          No custom text — the lead line is the automatic one recipients get.
        </p>

        <div class="pg__recbar">
          <span class="pg__label">
            Recipients — {{ selectedCount }} of {{ recip.length }} selected
            <span v-if="offDutyExcluded > 0"> · {{ offDutyExcluded }} on duty {{ offDutyDate }} excluded</span>
          </span>
          <span class="pg__recbtns">
            <button class="pg__mini" type="button" @click="setAllRecip(true)">Select all</button>
            <button class="pg__mini" type="button" @click="setAllRecip(false)">Deselect all</button>
          </span>
        </div>

        <div class="pg__recwrap">
          <table class="pg__rectable">
            <tbody>
              <tr v-for="r in recip" :key="r.p.id" :class="{ 'pg__rec--off': !r.on }">
                <td class="pg__reccheck">
                  <input v-model="r.on" type="checkbox" :aria-label="`Include ${r.p.fullName}`" />
                </td>
                <td class="pg__recname">
                  {{ r.p.fullName }}<span v-if="r.p.credential" class="pg__reccred"> — {{ r.p.credential }}</span>
                </td>
                <td class="pg__recsrc">
                  <span v-if="r.source === 'always'" class="pg__srcchip">Always included</span>
                  <span v-else-if="r.source === 'added'" class="pg__srcchip pg__srcchip--add">Added</span>
                </td>
              </tr>
              <tr v-if="recip.length === 0">
                <td colspan="3" class="pg__recempty">Nobody yet — add people below.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pg__row pg__row--add">
          <select v-model="addPick" class="pg__input" aria-label="Add a recipient">
            <option value="">Add a person…</option>
            <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.fullName }}</option>
          </select>
          <button class="pg__mini" type="button" :disabled="!addPick" @click="addPerson">Add</button>
        </div>

        <p v-if="err" class="pg__error">{{ err }}</p>

        <div class="pg__foot">
          <button class="pg__btn" :disabled="busy" @click="previewOpen = false">Back</button>
          <button class="pg__btn pg__btn--primary" :disabled="busy || selectedCount === 0" @click="send">
            {{ busy ? 'Sending…' : `Send to ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── recipient roster (Aladtec-style, 2026-09-24) ── */
.pg__rosterbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 4px 0 6px;
}

.pg__rosterq {
  flex: 0 1 170px;
}

.pg__selcount {
  margin-left: auto;
  font-size: 0.78rem;
  font-weight: 650;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}

.pg__label--inline {
  margin: 0;
}

.pg__roster {
  border: 1px solid var(--color-line-soft);
  border-radius: 8px;
  max-height: 300px;
  overflow: auto;
  margin: 6px 0 4px;
}

.pg__rtable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.pg__rtable th {
  text-align: left;
  font-size: 0.6rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  font-weight: 700;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-line);
  position: sticky;
  top: 0;
  background: var(--color-surface);
}

.pg__rtable td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-line-soft);
}

.pg__rrow {
  cursor: pointer;
}

.pg__rrow:hover td {
  background: var(--color-surface-soft);
}

.pg__rcheck {
  width: 28px;
}

.pg__rname {
  font-weight: 600;
  color: var(--color-ink);
}

.pg__rmut {
  color: var(--color-muted);
}

.pg__rnum {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── rendered previews in the send modal ── */
.pg__prevrow {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.pg__prevcol {
  flex: 1 1 240px;
  min-width: 0;
}

.pg__prevlabel {
  font-size: 0.62rem;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-muted);
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pg__mailcard {
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-brand-800);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 0.78rem;
  background: var(--color-surface);
}

.pg__mailbrand {
  font-weight: 700;
  color: var(--color-brand-800);
  letter-spacing: 0.04em;
  font-size: 0.74rem;
  margin: 0 0 6px;
}

.pg__mailbrand span {
  display: block;
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  color: var(--color-accent-700);
}

.pg__mailline {
  margin: 0 0 5px;
  color: var(--color-ink-soft);
}

.pg__maillink {
  margin: 0 0 3px 12px;
  color: var(--color-brand-800);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.pg__mailurgent {
  color: var(--color-danger-500);
  font-weight: 700;
  margin: 4px 0 6px;
}

.pg__mailbtn {
  display: inline-block;
  background: var(--color-brand-800);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 6px;
  padding: 4px 10px;
  margin-top: 2px;
}

.pg__smscard {
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface-soft);
  padding: 10px 12px;
  font: 0.74rem/1.5 ui-monospace, Consolas, monospace;
  color: var(--color-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}
.pg__cols {
  display: grid;
  grid-template-columns: minmax(380px, 560px) minmax(320px, 1fr);
  gap: 1rem;
  align-items: start;
}

/* grid items may not exceed the viewport — the roster table scrolls
   inside its own box instead of blowing the card out (phones) */
.pg__cols > * {
  min-width: 0;
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

.pg__charcount {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 0.2rem 0 0.5rem;
}

.pg__charcount--max {
  color: oklch(0.5 0.13 60);
  font-weight: 600;
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

.pg__seg {
  display: inline-flex;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-surface);
  padding: 2px;
  gap: 2px;
}

.pg__segbtn {
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-muted);
  border: 0;
  background: transparent;
  border-radius: 7px;
  padding: 0.24rem 0.65rem;
  cursor: pointer;
}

.pg__segbtn--on {
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  color: white;
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18);
}

.pg__check--urgent {
  color: oklch(0.5 0.17 27);
  font-weight: 600;
}

.pg__urgentchip {
  display: inline-block;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: white;
  background: linear-gradient(180deg, oklch(0.55 0.19 27), oklch(0.45 0.18 27));
  border-radius: 5px;
  padding: 2px 6px;
  vertical-align: middle;
  margin-left: 0.4rem;
}

.pg__typechip {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: oklch(0.45 0.1 86);
  background: oklch(0.96 0.03 86);
  border: 1px solid oklch(0.88 0.06 86);
  border-radius: 5px;
  padding: 1px 6px;
}

.pg__previewshifts {
  margin: 0.2rem 0 0.4rem;
}

.pg__previewshift,
.pg__logshift {
  font-size: 0.82rem;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
  margin: 0.1rem 0;
  padding-left: 0.9rem;
  position: relative;
}

.pg__previewshift::before,
.pg__logshift::before {
  content: '•';
  position: absolute;
  left: 0.15rem;
  color: var(--color-brand-700);
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

/* ── review & send modal ── */

/* preview & send = side drawer, matching the editor drawers (2026-09-24) */
.pg__overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: oklch(0.25 0.03 260 / 0.4);
  backdrop-filter: blur(1.5px);
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  padding: 0;
}

.pg__modal {
  width: min(560px, 94vw);
  height: 100%;
  overflow-y: auto;
  background: var(--color-surface);
  border: 0;
  border-left: 1px solid var(--color-line);
  box-shadow: -18px 0 44px oklch(0.2 0.04 260 / 0.24);
  padding: 1.1rem 1.2rem;
}

@media (max-width: 700px) {
  .pg__overlay {
    align-items: flex-end;
    justify-content: stretch;
  }

  .pg__modal {
    width: 100%;
    height: auto;
    max-height: 88dvh;
    border-left: 0;
    border-top: 1px solid var(--color-line);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -14px 40px oklch(0.2 0.04 260 / 0.24);
  }
}

.pg__mtitle {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--color-ink);
  margin: 0 0 0.6rem;
}

.pg__msgbox {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.7rem;
}

.pg__msghead {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.3rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pg__msgtext {
  font-size: 0.88rem;
  color: var(--color-ink);
  margin: 0 0 0.25rem;
  white-space: pre-wrap;
}

.pg__msgshift {
  font-size: 0.82rem;
  color: var(--color-brand-700);
  font-weight: 600;
  margin: 0.1rem 0 0;
}

.pg__msgnote {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 0.35rem 0 0;
  font-style: italic;
}

.pg__recbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.pg__recbtns {
  display: inline-flex;
  gap: 0.35rem;
}

.pg__recwrap {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  max-height: 44vh;
  overflow-y: auto;
  background: var(--color-surface);
}

.pg__rectable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.pg__rectable td {
  padding: 0.32rem 0.5rem;
  border-bottom: 1px solid var(--color-line-soft);
}

.pg__rectable tr:last-child td {
  border-bottom: 0;
}

.pg__reccheck {
  width: 30px;
  text-align: center;
}

.pg__recname {
  color: var(--color-ink);
}

.pg__reccred {
  color: var(--color-muted);
  font-size: 0.78rem;
}

.pg__recsrc {
  text-align: right;
  white-space: nowrap;
}

.pg__rec--off .pg__recname {
  color: var(--color-muted);
  text-decoration: line-through;
  text-decoration-color: oklch(0.7 0.02 260);
}

.pg__srcchip {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-accent-700, oklch(0.5 0.1 86));
  background: oklch(0.97 0.05 86);
  border: 1px solid oklch(0.85 0.09 86);
  border-radius: 999px;
  padding: 1px 7px;
}

.pg__srcchip--add {
  color: var(--color-brand-700);
  background: oklch(0.96 0.015 260);
  border-color: oklch(0.85 0.03 260);
}

.pg__recempty {
  color: var(--color-muted);
  font-size: 0.82rem;
  text-align: center;
  padding: 0.7rem;
}

.pg__row--add {
  margin-top: 0.5rem;
}
</style>
