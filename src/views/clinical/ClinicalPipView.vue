<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ArrowLeft, FileText, Plus, ShieldAlert, Upload, X } from 'lucide-vue-next'
import ClinicalNav, { type Crumb } from '@/components/clinical/ClinicalNav.vue'
import { usePips, type Pip, type PipEntryKind, type PipSections } from '@/composables/usePips'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * The full-page PIP builder/record — mirrors the paper document
 * (Areas of Concern → Improvement Goals → Expectations → Progress
 * Checkpoints → consequences → signatures ride the Documents upload).
 * Replaces the cramped inline editor on the employee file; the file
 * keeps a compact summary card that links here. Same five-party RLS:
 * this page simply has nothing to show anyone outside it.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const pips = usePips()

const personId = computed(() => String(route.params.userId ?? ''))
const active = computed<Pip | null>(() => pips.activeFor(personId.value))
const past = computed(() => pips.listFor(personId.value).filter((p) => p.status !== 'active'))
const isAdmin = computed(() => pips.isAdmin.value)
const meId = computed(() => auth.appUser?.id ?? null)
const canLog = computed(() => isAdmin.value || (!!active.value && active.value.supervisorUserId === meId.value))

/* ── names + pickers ───────────────────────────────────────────────── */
interface Person { id: string; name: string; role: string }
const people = ref<Person[]>([])
const nameById = computed(() => new Map(people.value.map((p) => [p.id, p.name])))
const personName = computed(() => nameById.value.get(personId.value) ?? '…')
function nameOf(id: string | null): string {
  return id ? (nameById.value.get(id) ?? '—') : '—'
}
const supervisorOptions = computed(() =>
  people.value.filter((p) => (p.role === 'supervisor' || p.role === 'admin') && p.id !== personId.value),
)
onMounted(async () => {
  if (auth.usingDevStub) return
  const { data } = await supabase
    .from('app_users')
    .select('id, full_name, role')
    .eq('active', true)
    .eq('account_type', 'person')
    .order('full_name')
  people.value = (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.full_name as string) ?? '—',
    role: (r.role as string) ?? 'crew',
  }))
})

/* The masthead is hidden under /clinical/*, so this page carries the
   module chrome itself; non-admin viewers get the slim variant. */
const crumbs = computed<Crumb[]>(() =>
  isAdmin.value
    ? [
        { label: 'Employee Files', to: '/clinical/people' },
        { label: personName.value, to: `/clinical/people/${personId.value}` },
        'Performance plan',
      ]
    : ['Performance plan'],
)

const err = ref<string | null>(null)
const busy = ref(false)

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
function daysLeft(p: Pip): number {
  return Math.ceil((Date.parse(`${p.endsOn}T00:00:00`) - Date.now()) / 86_400_000)
}
const KIND_LABELS: Record<PipEntryKind, string> = { training: 'Training', meeting: 'Meeting', note: 'Note' }

/** "Category: description" lines → rendered bullets with a bold lead. */
function bullets(text: string | null): Array<{ label: string; rest: string }> {
  return (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.\s]+/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':')
      return i > 0 && i < 60 ? { label: l.slice(0, i).trim(), rest: l.slice(i + 1).trim() } : { label: '', rest: l }
    })
}

function sectionText(p: Pip, key: keyof PipSections): string | null {
  return p[key]
}

const SECTION_DEFS: Array<{ key: keyof PipSections; title: string; hint: string; numbered?: boolean }> = [
  { key: 'summary', title: 'Purpose', hint: 'Why this plan exists — the opening paragraph of the PIP.' },
  { key: 'areasOfConcern', title: 'Areas of concern', hint: 'One per line — "Category: description" bolds the category.' },
  { key: 'goals', title: 'Improvement goals', hint: 'One goal per line — numbered automatically.', numbered: true },
  { key: 'expectations', title: 'Expectations', hint: 'The performance standards that show progress — one per line.', numbered: true },
  { key: 'requirements', title: 'Requirements & cadence', hint: 'Weekly meetings, training, practice schedules — one per line.' },
  { key: 'successCriteria', title: 'What success looks like', hint: 'The bar for completing the plan.' },
  { key: 'consequences', title: 'Timeline & consequences', hint: 'The standing paragraph — prefilled, edit as needed.' },
]

function defaultConsequences(len: number | null): string {
  const lenTxt = len ? `${len}-day` : ''
  return (
    `Effective immediately, you are placed on a ${lenTxt} Performance Improvement Plan. During this time you are expected to make regular progress on the plan outlined above. Failure to meet or exceed these expectations, or any display of gross misconduct, will result in further review. Failure to maintain performance expectations after the completion of the PIP may result in additional disciplinary action.\n` +
    `The PIP does not alter the employment-at-will relationship.\n` +
    `We will meet weekly to discuss the progress of your Performance Improvement Plan.`
  )
}

function blankSections(): PipSections {
  return { summary: '', areasOfConcern: '', goals: '', expectations: '', requirements: '', successCriteria: '', consequences: defaultConsequences(90) }
}

/* ── create ────────────────────────────────────────────────────────── */
const creating = computed(() => !active.value && isAdmin.value)
const cStart = ref(new Date().toISOString().slice(0, 10))
const cLength = ref<number>(90) // 0 = custom
const cEnd = ref(addDays(cStart.value, 90))
const cSupervisor = ref('')
const cHold = ref(false)
const cSections = ref<PipSections>(blankSections())
interface TargetDraft { dueOn: string; title: string; detail: string }
const cTargets = ref<TargetDraft[]>([])
watch([cStart, cLength], () => {
  if (cLength.value) {
    cEnd.value = addDays(cStart.value, cLength.value)
    cSections.value.consequences = cSections.value.consequences.replace(/\d+-day/, `${cLength.value}-day`)
  }
})
function addReview(days: number) {
  cTargets.value.push({ dueOn: addDays(cStart.value, days), title: `${days}-day review`, detail: '' })
}
function addBlankTarget() {
  cTargets.value.push({ dueOn: '', title: '', detail: '' })
}
async function create() {
  if (busy.value || !cSections.value.summary.trim()) return
  busy.value = true
  err.value = null
  const res = await pips.createPip({
    userId: personId.value,
    supervisorUserId: cSupervisor.value || null,
    startsOn: cStart.value,
    endsOn: cEnd.value,
    lengthDays: cLength.value || null,
    ftepHold: cHold.value,
    sections: cSections.value,
    targets: cTargets.value,
  })
  busy.value = false
  if (!res.ok) {
    err.value = res.error
    return
  }
  cSections.value = blankSections()
  cTargets.value = []
}

/* ── edit ──────────────────────────────────────────────────────────── */
const editing = ref(false)
const eSections = ref<PipSections>(blankSections())
const eEnd = ref('')
const eSupervisor = ref('')
function startEdit() {
  const p = active.value
  if (!p) return
  eSections.value = {
    summary: p.summary,
    areasOfConcern: p.areasOfConcern ?? '',
    goals: p.goals ?? '',
    expectations: p.expectations ?? '',
    requirements: p.requirements ?? '',
    successCriteria: p.successCriteria ?? '',
    consequences: p.consequences ?? defaultConsequences(p.lengthDays),
  }
  eEnd.value = p.endsOn
  eSupervisor.value = p.supervisorUserId ?? ''
  editing.value = true
}
async function saveEdit() {
  if (!active.value || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.updatePip(active.value.id, {
    endsOn: eEnd.value,
    supervisorUserId: eSupervisor.value || null,
    sections: eSections.value,
  })
  busy.value = false
  if (!res.ok) {
    err.value = res.error
    return
  }
  editing.value = false
}
async function toggleHold() {
  if (!active.value || busy.value) return
  busy.value = true
  const res = await pips.updatePip(active.value.id, { ftepHold: !active.value.ftepHold })
  busy.value = false
  if (!res.ok) err.value = res.error
}

/* ── close ─────────────────────────────────────────────────────────── */
const closing = ref(false)
const closeStatus = ref<'completed' | 'closed'>('completed')
const closeNote = ref('')
async function doClose() {
  if (!active.value || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.closePip(active.value.id, closeStatus.value, closeNote.value.trim())
  busy.value = false
  if (!res.ok) {
    err.value = res.error
    return
  }
  closing.value = false
}

/* ── checkpoints ───────────────────────────────────────────────────── */
const tDue = ref('')
const tTitle = ref('')
const tDetail = ref('')
async function addTarget() {
  if (!active.value || !tDue.value || !tTitle.value.trim() || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.addTarget(active.value.id, { dueOn: tDue.value, title: tTitle.value.trim(), detail: tDetail.value.trim() })
  busy.value = false
  if (!res.ok) {
    err.value = res.error
    return
  }
  tDue.value = ''
  tTitle.value = ''
  tDetail.value = ''
}
const armed = ref<string | null>(null)
async function markTarget(id: string, status: 'met' | 'missed' | 'pending') {
  const res = await pips.setTargetStatus(id, status, '')
  if (!res.ok) err.value = res.error
}
async function delTarget(id: string) {
  if (armed.value !== `t-${id}`) {
    armed.value = `t-${id}`
    return
  }
  armed.value = null
  const res = await pips.removeTarget(id)
  if (!res.ok) err.value = res.error
}

/* ── log ───────────────────────────────────────────────────────────── */
const nEntryOn = ref(new Date().toISOString().slice(0, 10))
const nKind = ref<PipEntryKind>('meeting')
const nBody = ref('')
async function addEntry() {
  if (!active.value || !nBody.value.trim() || busy.value) return
  const res = await pips.addEntry(active.value.id, { entryOn: nEntryOn.value, kind: nKind.value, body: nBody.value.trim() })
  if (!res.ok) {
    err.value = res.error
    return
  }
  nBody.value = ''
}
async function delEntry(id: string) {
  if (armed.value !== `e-${id}`) {
    armed.value = `e-${id}`
    return
  }
  armed.value = null
  const res = await pips.removeEntry(id)
  if (!res.ok) err.value = res.error
}

/* ── documents ─────────────────────────────────────────────────────── */
async function onFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f || !active.value) return
  busy.value = true
  err.value = null
  const res = await pips.uploadDocument(active.value.id, f)
  busy.value = false
  if (!res.ok) err.value = res.error
  ;(ev.target as HTMLInputElement).value = ''
}
async function openDoc(path: string) {
  const url = await pips.documentUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}

/* ── access + reminder recipients ──────────────────────────────────── */
const showAccess = ref(false)
const admins = ref<Array<{ userId: string; notify: boolean }>>([])
const addAdminId = ref('')
async function openAccess() {
  showAccess.value = !showAccess.value
  if (showAccess.value) admins.value = await pips.listAdmins()
}
async function addAdmin() {
  if (!addAdminId.value) return
  const res = await pips.addAdmin(addAdminId.value)
  if (!res.ok) {
    err.value = res.error
    return
  }
  addAdminId.value = ''
  admins.value = await pips.listAdmins()
}
async function removeAdmin(id: string) {
  if (armed.value !== `a-${id}`) {
    armed.value = `a-${id}`
    return
  }
  armed.value = null
  const res = await pips.removeAdmin(id)
  if (!res.ok) {
    err.value = res.error
    return
  }
  admins.value = await pips.listAdmins()
}
async function toggleNotify(a: { userId: string; notify: boolean }) {
  const res = await pips.setAdminNotify(a.userId, !a.notify)
  if (!res.ok) {
    err.value = res.error
    return
  }
  admins.value = await pips.listAdmins()
}
const adminAddOptions = computed(() => people.value.filter((p) => !admins.value.some((a) => a.userId === p.id)))
</script>

<template>
  <div class="pv">
    <ClinicalNav :crumbs="crumbs" />

    <div class="pv__doc">
    <div class="pv__top">
      <button
        type="button"
        class="pv__back"
        @click="router.push(isAdmin ? `/clinical/people/${personId}` : '/clinical-development')"
      >
        <ArrowLeft :size="15" /> {{ isAdmin ? `${personName}'s file` : 'Clinical Development' }}
      </button>
      <button v-if="isAdmin" type="button" class="pv__access" @click="openAccess">Who can see PIPs</button>
    </div>

    <header class="pv__head">
      <ShieldAlert :size="20" :stroke-width="1.9" style="color: var(--color-danger-600, oklch(0.5 0.19 27))" />
      <div>
        <h1 class="display pv__title">Performance Improvement Plan — {{ personName }}</h1>
        <p class="pv__sub">Confidential · visible to PIP access, {{ personName }}, and their plan supervisor only.</p>
      </div>
    </header>

    <p v-if="err" class="pv__err">{{ err }}</p>

    <div v-if="showAccess && isAdmin" class="pv__accessbox">
      <div v-for="a in admins" :key="a.userId" class="pv__accessrow">
        <span>{{ nameOf(a.userId) }}</span>
        <label class="pv__notify"><input type="checkbox" :checked="a.notify" @change="toggleNotify(a)" /> gets reminders</label>
        <button type="button" class="pv__mini pv__mini--danger" @click="removeAdmin(a.userId)">
          {{ armed === `a-${a.userId}` ? 'Confirm remove' : 'Remove' }}
        </button>
      </div>
      <div class="pv__accessadd">
        <select v-model="addAdminId" class="pv__input">
          <option value="">Add a person…</option>
          <option v-for="p in adminAddOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button type="button" class="pv__mini" :disabled="!addAdminId" @click="addAdmin">Add</button>
      </div>
      <p class="pv__hint">People on this list see and manage every PIP; "gets reminders" copies them on the checkpoint reminders employees receive.</p>
    </div>

    <!-- ══ CREATE ══ -->
    <template v-if="creating">
      <section class="pv__card">
        <div class="pv__cardtitle">Plan window</div>
        <div class="pv__grid">
          <label class="pv__fld"><span>Starts</span><input v-model="cStart" type="date" class="pv__input" /></label>
          <label class="pv__fld"><span>Length</span>
            <select v-model.number="cLength" class="pv__input">
              <option :value="30">30 days</option>
              <option :value="60">60 days</option>
              <option :value="90">90 days</option>
              <option :value="0">Custom</option>
            </select>
          </label>
          <label class="pv__fld"><span>Ends</span><input v-model="cEnd" type="date" class="pv__input" :disabled="cLength !== 0" /></label>
          <label class="pv__fld"><span>Supervisor</span>
            <select v-model="cSupervisor" class="pv__input">
              <option value="">— none —</option>
              <option v-for="p in supervisorOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="pv__check"><input v-model="cHold" type="checkbox" /> Place FTEP training on hold
            <span class="pv__hint">FTEP boards show a generic "training hold" — no reason attached</span></label>
        </div>
      </section>

      <section v-for="s in SECTION_DEFS" :key="s.key" class="pv__card">
        <div class="pv__cardtitle">{{ s.title }}</div>
        <p class="pv__hint">{{ s.hint }}</p>
        <textarea v-model="cSections[s.key]" :rows="s.key === 'summary' || s.key === 'consequences' ? 4 : 5" class="pv__input pv__ta"></textarea>
      </section>

      <section class="pv__card">
        <div class="pv__cardtitle">Progress checkpoints</div>
        <p class="pv__hint">
          The dated deadlines inside the plan — reviews, skill verifications, quizzes. The employee gets a
          reminder 7 days and 1 day before each one, with copies to the PIP admins marked "gets reminders".
        </p>
        <div class="pv__quickrow">
          <button type="button" class="pv__mini" @click="addReview(30)"><Plus :size="12" /> 30-day review</button>
          <button type="button" class="pv__mini" @click="addReview(60)"><Plus :size="12" /> 60-day review</button>
          <button type="button" class="pv__mini" @click="addReview(90)"><Plus :size="12" /> 90-day review</button>
          <button type="button" class="pv__mini" @click="addBlankTarget"><Plus :size="12" /> Custom checkpoint</button>
        </div>
        <div v-for="(t, i) in cTargets" :key="i" class="pv__targetdraft">
          <input v-model="t.dueOn" type="date" class="pv__input" />
          <input v-model="t.title" type="text" class="pv__input pv__grow" placeholder="Checkpoint — e.g. 30-day review" />
          <input v-model="t.detail" type="text" class="pv__input pv__grow" placeholder="Progress expected / notes (optional)" />
          <button type="button" class="pv__mini pv__mini--danger" @click="cTargets.splice(i, 1)"><X :size="12" /></button>
        </div>
      </section>

      <div class="pv__createrow">
        <button type="button" class="pv__btn" :disabled="busy || !cSections.summary.trim()" @click="create">Create the plan</button>
        <span class="pv__hint">Purpose is required — everything else can be filled in afterward.</span>
      </div>
    </template>

    <!-- ══ ACTIVE PLAN ══ -->
    <template v-else-if="active">
      <section class="pv__card pv__card--status">
        <div class="pv__statusrow">
          <div>
            <b>{{ fmt(active.startsOn) }} → {{ fmt(active.endsOn) }}</b>
            <span v-if="active.lengthDays" class="pv__lenchip">{{ active.lengthDays }}-day plan</span>
            <span v-if="daysLeft(active) >= 0" class="pv__days">{{ daysLeft(active) }} days remaining</span>
            <span v-else class="pv__days pv__days--over">ended {{ -daysLeft(active) }} days ago — close it out</span>
          </div>
          <div class="pv__pills">
            <span class="pv__pill pv__pill--active"><i></i>Active</span>
            <span v-if="active.ftepHold" class="pv__pill pv__pill--hold"><AlertTriangle :size="11" :stroke-width="2.4" />FTEP on hold</span>
          </div>
        </div>
        <div class="pv__meta">
          Supervisor: <b>{{ nameOf(active.supervisorUserId) }}</b>
          <template v-if="isAdmin">
            · <button type="button" class="pv__lnk" @click="editing ? (editing = false) : startEdit()">{{ editing ? 'Cancel edit' : 'Edit plan' }}</button>
            · <button type="button" class="pv__lnk" @click="toggleHold">{{ active.ftepHold ? 'Release FTEP hold' : 'Place FTEP hold' }}</button>
            · <button type="button" class="pv__lnk pv__lnk--danger" @click="closing = !closing">Close plan</button>
          </template>
        </div>
        <div v-if="closing && isAdmin" class="pv__closebox">
          <select v-model="closeStatus" class="pv__input">
            <option value="completed">Completed successfully</option>
            <option value="closed">Closed — other outcome</option>
          </select>
          <input v-model="closeNote" type="text" class="pv__input pv__grow" placeholder="Outcome note — e.g. All expectations met; released from plan" />
          <button type="button" class="pv__btn pv__btn--danger" :disabled="busy" @click="doClose">
            Close{{ active.ftepHold ? ' & release hold' : '' }}
          </button>
        </div>
        <div v-if="editing" class="pv__grid" style="margin-top: 10px">
          <label class="pv__fld"><span>Ends</span><input v-model="eEnd" type="date" class="pv__input" /></label>
          <label class="pv__fld"><span>Supervisor</span>
            <select v-model="eSupervisor" class="pv__input">
              <option value="">— none —</option>
              <option v-for="p in supervisorOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
        </div>
      </section>

      <section v-for="s in SECTION_DEFS" :key="s.key" class="pv__card">
        <div class="pv__cardtitle">{{ s.title }}</div>
        <template v-if="editing">
          <p class="pv__hint">{{ s.hint }}</p>
          <textarea v-model="eSections[s.key]" :rows="5" class="pv__input pv__ta"></textarea>
        </template>
        <template v-else>
          <component :is="s.numbered ? 'ol' : 'ul'" v-if="sectionText(active, s.key)" class="pv__list" :class="{ 'pv__list--plain': s.key === 'summary' || s.key === 'consequences' }">
            <li v-for="(b, i) in bullets(sectionText(active, s.key))" :key="i">
              <b v-if="b.label">{{ b.label }}:</b> {{ b.rest }}
            </li>
          </component>
          <p v-else class="pv__quiet">Nothing written yet{{ isAdmin ? ' — Edit plan to fill this in' : '' }}.</p>
        </template>
      </section>
      <div v-if="editing" class="pv__createrow">
        <button type="button" class="pv__btn" :disabled="busy" @click="saveEdit">Save changes</button>
      </div>

      <!-- checkpoints -->
      <section class="pv__card">
        <div class="pv__cardtitle">Progress checkpoints</div>
        <div v-for="t in pips.targetsFor(active.id)" :key="t.id" class="pv__row">
          <span class="pv__due">{{ fmt(t.dueOn) }}</span>
          <div class="pv__rowmain">
            <b>{{ t.title }}</b>
            <span v-if="t.detail" class="pv__detail">{{ t.detail }}</span>
            <span v-if="t.note" class="pv__detail">— {{ t.note }}</span>
          </div>
          <span class="pv__pill" :class="t.status === 'met' ? 'pv__pill--met' : t.status === 'missed' ? 'pv__pill--missed' : 'pv__pill--pending'"><i></i>{{ t.status }}</span>
          <template v-if="isAdmin">
            <button v-if="t.status !== 'met'" type="button" class="pv__mini" @click="markTarget(t.id, 'met')">Met</button>
            <button v-if="t.status !== 'missed'" type="button" class="pv__mini" @click="markTarget(t.id, 'missed')">Missed</button>
            <button v-if="t.status !== 'pending'" type="button" class="pv__mini" @click="markTarget(t.id, 'pending')">Reopen</button>
            <button type="button" class="pv__mini pv__mini--danger" @click="delTarget(t.id)">{{ armed === `t-${t.id}` ? 'Confirm' : 'Delete' }}</button>
          </template>
        </div>
        <p v-if="pips.targetsFor(active.id).length === 0" class="pv__quiet">No checkpoints yet.</p>
        <div v-if="isAdmin" class="pv__targetdraft" style="margin-top: 8px">
          <input v-model="tDue" type="date" class="pv__input" />
          <input v-model="tTitle" type="text" class="pv__input pv__grow" placeholder="Checkpoint — e.g. 30-day review" />
          <input v-model="tDetail" type="text" class="pv__input pv__grow" placeholder="Progress expected (optional)" />
          <button type="button" class="pv__mini" :disabled="!tDue || !tTitle.trim() || busy" @click="addTarget"><Plus :size="13" /> Add</button>
        </div>
        <p class="pv__hint" style="margin-top: 6px">
          {{ personName.split(' ')[0] }} is reminded 7 days and 1 day before each pending checkpoint and the plan end date;
          PIP admins marked "gets reminders" receive copies.
        </p>
      </section>

      <!-- log -->
      <section class="pv__card">
        <div class="pv__cardtitle">Progress &amp; training log</div>
        <div v-for="e in pips.entriesFor(active.id)" :key="e.id" class="pv__row">
          <span class="pv__due">{{ fmt(e.entryOn) }}</span>
          <span class="pv__pill pv__pill--kind"><i></i>{{ KIND_LABELS[e.kind] }}</span>
          <div class="pv__rowmain">{{ e.body }} <span class="pv__detail">— {{ nameOf(e.createdBy) }}</span></div>
          <button v-if="isAdmin" type="button" class="pv__mini pv__mini--danger" @click="delEntry(e.id)">{{ armed === `e-${e.id}` ? 'Confirm' : 'Delete' }}</button>
        </div>
        <p v-if="pips.entriesFor(active.id).length === 0" class="pv__quiet">Nothing logged yet — weekly meetings and training land here.</p>
        <div v-if="canLog" class="pv__targetdraft" style="margin-top: 8px">
          <input v-model="nEntryOn" type="date" class="pv__input" />
          <select v-model="nKind" class="pv__input">
            <option value="meeting">Meeting</option>
            <option value="training">Training</option>
            <option value="note">Note</option>
          </select>
          <input v-model="nBody" type="text" class="pv__input pv__grow" placeholder="What happened — e.g. Weekly progress check: PCRs improving, assessments still prompted" @keyup.enter="addEntry" />
          <button type="button" class="pv__mini" :disabled="!nBody.trim() || busy" @click="addEntry"><Plus :size="13" /> Log</button>
        </div>
      </section>

      <!-- documents -->
      <section class="pv__card">
        <div class="pv__cardtitle">Documents</div>
        <div v-for="d in pips.documentsFor(active.id)" :key="d.id" class="pv__row">
          <FileText :size="14" :stroke-width="1.9" style="color: var(--color-brand-600)" />
          <button type="button" class="pv__lnk pv__rowmain" style="text-align: left" @click="openDoc(d.storagePath)">{{ d.name }}</button>
          <button v-if="isAdmin" type="button" class="pv__mini pv__mini--danger" @click="pips.removeDocument(d)">Delete</button>
        </div>
        <p v-if="pips.documentsFor(active.id).length === 0" class="pv__quiet">Upload the signed PIP once it's inked.</p>
        <label v-if="isAdmin" class="pv__upload"><Upload :size="13" :stroke-width="2" /> Upload document
          <input type="file" accept=".pdf,.doc,.docx,image/*" hidden @change="onFile" />
        </label>
      </section>
    </template>

    <p v-else-if="pips.ready.value" class="pv__quiet" style="padding: 20px 4px">
      No active performance improvement plan here.
    </p>

    <!-- past plans -->
    <details v-if="past.length" class="pv__past">
      <summary>Past plans ({{ past.length }})</summary>
      <div v-for="p in past" :key="p.id" class="pv__row">
        <span class="pv__due">{{ fmt(p.startsOn) }} → {{ fmt(p.endsOn) }}</span>
        <span class="pv__pill" :class="p.status === 'completed' ? 'pv__pill--met' : 'pv__pill--missed'"><i></i>{{ p.status }}</span>
        <div class="pv__rowmain">{{ p.outcomeNote || p.summary }}</div>
      </div>
    </details>
    </div>
  </div>
</template>

<style scoped>
.pv { padding-bottom: 48px; }
.pv__doc { max-width: 860px; }
.pv__top { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; }
.pv__back { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; color: var(--color-brand-700); background: none; border: 0; cursor: pointer; padding: 0; }
.pv__access { font: inherit; font-size: 11.5px; font-weight: 600; color: var(--color-brand-700); background: none; border: 1px solid var(--color-line); border-radius: 5px; padding: 3px 9px; cursor: pointer; }
.pv__head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; }
.pv__title { font-size: 23px; margin: 0 0 3px; }
.pv__sub { font-size: 12px; color: var(--color-muted); }
.pv__err { font-size: 12.5px; color: var(--color-danger-600, oklch(0.5 0.19 27)); margin: 6px 0; }
.pv__hint { font-size: 11.5px; color: var(--color-muted); margin: 2px 0 6px; }
.pv__quiet { font-size: 12.5px; color: var(--color-muted); }

.pv__card { background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 7px; padding: 12px 14px; margin-bottom: 12px; }
.pv__card--status { border-left: 3px solid var(--color-danger-600, oklch(0.5 0.19 27)); }
.pv__cardtitle { font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #8a6d2f; margin-bottom: 6px; }
.pv__statusrow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 14px; }
.pv__lenchip { margin-left: 8px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; color: var(--color-brand-700); border: 1px solid var(--color-line); border-radius: 4px; padding: 1px 6px; }
.pv__days { margin-left: 8px; font-size: 11.5px; color: var(--color-muted); }
.pv__days--over { color: var(--color-danger-600, oklch(0.5 0.19 27)); font-weight: 600; }
.pv__pills { display: flex; gap: 6px; }
.pv__pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid var(--color-line); border-radius: 4px; padding: 2px 7px; color: var(--color-ink-soft); background: var(--color-canvas); }
.pv__pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-muted); }
.pv__pill--active i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pv__pill--hold { color: oklch(0.45 0.12 70); border-color: oklch(0.82 0.08 80); }
.pv__pill--met i { background: var(--color-success-500, oklch(0.6 0.13 150)); }
.pv__pill--missed i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pv__pill--pending i { background: oklch(0.72 0.12 80); }
.pv__pill--kind i { background: var(--color-brand-600); }
.pv__meta { font-size: 12.5px; color: var(--color-ink-soft); margin-top: 6px; }
.pv__lnk { font: inherit; font-size: inherit; color: var(--color-brand-700); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
.pv__lnk--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pv__closebox { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border-top: 1px dashed var(--color-line); margin-top: 10px; padding-top: 10px; }

.pv__grid { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.pv__fld { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-muted); }
.pv__check { display: flex; align-items: center; gap: 7px; font-size: 13px; flex-basis: 100%; }
.pv__input { font: inherit; font-size: 13px; padding: 6px 9px; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-surface); color: var(--color-ink); }
.pv__ta { width: 100%; resize: vertical; line-height: 1.5; }
.pv__grow { flex: 1; min-width: 150px; }

.pv__list { margin: 2px 0 2px 20px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; line-height: 1.5; }
.pv__list--plain { list-style: none; margin-left: 2px; }
.pv__list b { color: var(--color-ink); }

.pv__quickrow { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.pv__targetdraft { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
.pv__row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 5px 0; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); flex-wrap: wrap; }
.pv__row:last-of-type { border-bottom: 0; }
.pv__due { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.pv__rowmain { flex: 1; min-width: 180px; }
.pv__detail { color: var(--color-muted); font-size: 12px; }

.pv__mini { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink-soft); cursor: pointer; white-space: nowrap; }
.pv__mini--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pv__mini:disabled { opacity: 0.5; cursor: default; }
.pv__btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 16px; border: 0; border-radius: 6px; background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)); color: #fff; cursor: pointer; }
.pv__btn--danger { background: linear-gradient(180deg, oklch(0.55 0.17 27), oklch(0.44 0.17 27)); }
.pv__btn:disabled { opacity: 0.55; cursor: default; }
.pv__createrow { display: flex; align-items: center; gap: 10px; margin: 4px 0 16px; }
.pv__upload { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-brand-700); border: 1px dashed var(--color-line); border-radius: 6px; padding: 6px 12px; cursor: pointer; margin-top: 7px; }
.pv__past { margin-top: 10px; font-size: 12.5px; }
.pv__past summary { cursor: pointer; color: var(--color-muted); font-weight: 600; }

.pv__accessbox { border: 1px solid var(--color-line); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; background: var(--color-surface); }
.pv__accessrow { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 3px 0; }
.pv__accessrow > span:first-child { flex: 1; }
.pv__notify { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--color-ink-soft); }
.pv__accessadd { display: flex; gap: 6px; margin-top: 6px; }
</style>
