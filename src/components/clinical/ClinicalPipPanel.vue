<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, FileText, Paperclip, Plus, ShieldAlert, Upload } from 'lucide-vue-next'
import { usePips, type Pip, type PipEntryKind } from '@/composables/usePips'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * The PIP surface. RLS already decided whether any of this data exists
 * for the viewer; this component renders whatever came back.
 *   mode 'manage' — the employee-file section (pip admins run the plan,
 *     the named supervisor can add progress entries).
 *   mode 'self'   — the member's own read-only view on /clinical-development.
 * Deliberately quiet: no activity-feed writes, no broad pickers beyond
 * what the panel itself needs.
 */

const props = defineProps<{
  personId: string
  personName?: string
  mode: 'manage' | 'self'
}>()

const auth = useAuthStore()
const pips = usePips()

const meId = computed(() => auth.appUser?.id ?? null)
const active = computed<Pip | null>(() => pips.activeFor(props.personId))
const past = computed(() => pips.listFor(props.personId).filter((p) => p.status !== 'active'))
const isAdmin = computed(() => pips.isAdmin.value)
const isSupervisorOnPip = computed(() => !!active.value && active.value.supervisorUserId === meId.value)
const canLog = computed(() => isAdmin.value || isSupervisorOnPip.value)

/* ── name resolution + pickers (app_users is viewer-readable) ──────── */
interface Person { id: string; name: string; role: string }
const people = ref<Person[]>([])
const nameById = computed(() => new Map(people.value.map((p) => [p.id, p.name])))
function nameOf(id: string | null): string {
  if (!id) return '—'
  return nameById.value.get(id) ?? '—'
}
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
const supervisorOptions = computed(() =>
  people.value.filter((p) => (p.role === 'supervisor' || p.role === 'admin') && p.id !== props.personId),
)

const err = ref<string | null>(null)
const busy = ref(false)

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function daysLeft(p: Pip): number {
  return Math.ceil((Date.parse(`${p.endsOn}T00:00:00`) - Date.now()) / 86_400_000)
}
const KIND_LABELS: Record<PipEntryKind, string> = { training: 'Training', meeting: 'Meeting', note: 'Note' }

/* ── create ────────────────────────────────────────────────────────── */
const creating = ref(false)
const cStart = ref('')
const cEnd = ref('')
const cSupervisor = ref('')
const cHold = ref(false)
const cSummary = ref('')
async function create() {
  if (!cStart.value || !cEnd.value || !cSummary.value.trim() || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.createPip({
    userId: props.personId,
    supervisorUserId: cSupervisor.value || null,
    startsOn: cStart.value,
    endsOn: cEnd.value,
    summary: cSummary.value.trim(),
    ftepHold: cHold.value,
  })
  busy.value = false
  if (!res.ok) { err.value = res.error; return }
  creating.value = false
  cStart.value = ''; cEnd.value = ''; cSupervisor.value = ''; cHold.value = false; cSummary.value = ''
}

/* ── edit plan ─────────────────────────────────────────────────────── */
const editing = ref(false)
const eEnd = ref('')
const eSupervisor = ref('')
const eSummary = ref('')
function startEdit() {
  if (!active.value) return
  eEnd.value = active.value.endsOn
  eSupervisor.value = active.value.supervisorUserId ?? ''
  eSummary.value = active.value.summary
  editing.value = true
}
async function saveEdit() {
  if (!active.value || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.updatePip(active.value.id, {
    endsOn: eEnd.value,
    supervisorUserId: eSupervisor.value || null,
    summary: eSummary.value.trim(),
  })
  busy.value = false
  if (!res.ok) { err.value = res.error; return }
  editing.value = false
}
async function toggleHold() {
  if (!active.value || busy.value) return
  busy.value = true
  err.value = null
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
  if (!res.ok) { err.value = res.error; return }
  closing.value = false
  closeNote.value = ''
}

/* ── targets ───────────────────────────────────────────────────────── */
const tDue = ref('')
const tTitle = ref('')
const tDetail = ref('')
async function addTarget() {
  if (!active.value || !tDue.value || !tTitle.value.trim() || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.addTarget(active.value.id, { dueOn: tDue.value, title: tTitle.value.trim(), detail: tDetail.value.trim() })
  busy.value = false
  if (!res.ok) { err.value = res.error; return }
  tDue.value = ''; tTitle.value = ''; tDetail.value = ''
}
async function markTarget(id: string, status: 'met' | 'missed' | 'pending') {
  if (busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.setTargetStatus(id, status, '')
  busy.value = false
  if (!res.ok) err.value = res.error
}
const armedDelete = ref<string | null>(null)
async function delTarget(id: string) {
  if (armedDelete.value !== `t-${id}`) { armedDelete.value = `t-${id}`; return }
  armedDelete.value = null
  const res = await pips.removeTarget(id)
  if (!res.ok) err.value = res.error
}

/* ── entries ───────────────────────────────────────────────────────── */
const nEntryOn = ref(new Date().toISOString().slice(0, 10))
const nKind = ref<PipEntryKind>('training')
const nBody = ref('')
async function addEntry() {
  if (!active.value || !nBody.value.trim() || busy.value) return
  busy.value = true
  err.value = null
  const res = await pips.addEntry(active.value.id, { entryOn: nEntryOn.value, kind: nKind.value, body: nBody.value.trim() })
  busy.value = false
  if (!res.ok) { err.value = res.error; return }
  nBody.value = ''
}
async function delEntry(id: string) {
  if (armedDelete.value !== `e-${id}`) { armedDelete.value = `e-${id}`; return }
  armedDelete.value = null
  const res = await pips.removeEntry(id)
  if (!res.ok) err.value = res.error
}

/* ── documents ─────────────────────────────────────────────────────── */
const fileInput = ref<HTMLInputElement | null>(null)
async function onFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]
  if (!f || !active.value) return
  busy.value = true
  err.value = null
  const res = await pips.uploadDocument(active.value.id, f)
  busy.value = false
  if (!res.ok) err.value = res.error
  if (fileInput.value) fileInput.value.value = ''
}
async function openDoc(path: string) {
  const url = await pips.documentUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}
function fmtSize(b: number | null): string {
  if (!b) return ''
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`
}

/* ── access list ───────────────────────────────────────────────────── */
const showAccess = ref(false)
const adminIds = ref<string[]>([])
const addAdminId = ref('')
async function loadAdmins() {
  adminIds.value = (await pips.listAdmins()).map((a) => a.userId)
}
async function openAccess() {
  showAccess.value = !showAccess.value
  if (showAccess.value) await loadAdmins()
}
async function addAdmin() {
  if (!addAdminId.value) return
  const res = await pips.addAdmin(addAdminId.value)
  if (!res.ok) { err.value = res.error; return }
  addAdminId.value = ''
  await loadAdmins()
}
async function removeAdmin(id: string) {
  if (armedDelete.value !== `a-${id}`) { armedDelete.value = `a-${id}`; return }
  armedDelete.value = null
  const res = await pips.removeAdmin(id)
  if (!res.ok) { err.value = res.error; return }
  await loadAdmins()
}
const adminAddOptions = computed(() => people.value.filter((p) => !adminIds.value.includes(p.id)))
</script>

<template>
  <section class="pip">
    <div class="pip__title">
      <ShieldAlert :size="15" :stroke-width="2" />
      <span>Performance improvement plan</span>
      <span class="pip__restricted">restricted — PIP access, the employee &amp; their supervisor</span>
      <button v-if="mode === 'manage' && isAdmin" type="button" class="pip__access" @click="openAccess">
        Who can see PIPs
      </button>
    </div>

    <p v-if="err" class="pip__err">{{ err }}</p>

    <!-- access editor -->
    <div v-if="showAccess && isAdmin" class="pip__accessbox">
      <div v-for="id in adminIds" :key="id" class="pip__accessrow">
        <span>{{ nameOf(id) }}</span>
        <button type="button" class="pip__mini pip__mini--danger" @click="removeAdmin(id)">
          {{ armedDelete === `a-${id}` ? 'Confirm remove' : 'Remove' }}
        </button>
      </div>
      <div class="pip__accessadd">
        <select v-model="addAdminId" class="pip__input">
          <option value="">Add a person…</option>
          <option v-for="p in adminAddOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button type="button" class="pip__mini" :disabled="!addAdminId" @click="addAdmin">Add</button>
      </div>
      <p class="pip__hint">People on this list can see and manage every PIP. The employee and the plan's supervisor see only their own.</p>
    </div>

    <!-- ══ active plan ══ -->
    <template v-if="active">
      <div class="pip__card">
        <div class="pip__cardhead">
          <div class="pip__window">
            <b>{{ fmt(active.startsOn) }} → {{ fmt(active.endsOn) }}</b>
            <span v-if="daysLeft(active) >= 0" class="pip__days">{{ daysLeft(active) }} days remaining</span>
            <span v-else class="pip__days pip__days--over">ended {{ -daysLeft(active) }} days ago — close it out</span>
          </div>
          <div class="pip__pills">
            <span class="pip__pill pip__pill--active"><i></i>Active</span>
            <span v-if="active.ftepHold" class="pip__pill pip__pill--hold"><AlertTriangle :size="11" :stroke-width="2.4" />FTEP on hold</span>
          </div>
        </div>

        <template v-if="!editing">
          <p class="pip__summary">{{ active.summary }}</p>
          <div class="pip__meta">
            Supervisor: <b>{{ nameOf(active.supervisorUserId) }}</b>
            <template v-if="mode === 'manage' && isAdmin">
              · <button type="button" class="pip__lnk" @click="startEdit">Edit plan</button>
              · <button type="button" class="pip__lnk" @click="toggleHold">{{ active.ftepHold ? 'Release FTEP hold' : 'Place FTEP hold' }}</button>
              · <button type="button" class="pip__lnk pip__lnk--danger" @click="closing = !closing">Close plan</button>
            </template>
          </div>
        </template>
        <div v-else class="pip__form">
          <label class="pip__fld"><span>Ends on</span><input v-model="eEnd" type="date" class="pip__input" /></label>
          <label class="pip__fld"><span>Supervisor</span>
            <select v-model="eSupervisor" class="pip__input">
              <option value="">— none —</option>
              <option v-for="p in supervisorOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="pip__fld pip__fld--wide"><span>Plan details</span><textarea v-model="eSummary" rows="4" class="pip__input"></textarea></label>
          <div class="pip__formrow">
            <button type="button" class="pip__btn" :disabled="busy" @click="saveEdit">Save</button>
            <button type="button" class="pip__mini" @click="editing = false">Cancel</button>
          </div>
        </div>

        <div v-if="closing && isAdmin" class="pip__closebox">
          <label class="pip__fld"><span>Outcome</span>
            <select v-model="closeStatus" class="pip__input">
              <option value="completed">Completed successfully</option>
              <option value="closed">Closed — other outcome</option>
            </select>
          </label>
          <label class="pip__fld pip__fld--wide"><span>Outcome note</span><input v-model="closeNote" type="text" class="pip__input" placeholder="e.g. All targets met; released from plan" /></label>
          <div class="pip__formrow">
            <button type="button" class="pip__btn pip__btn--danger" :disabled="busy" @click="doClose">
              Close plan{{ active.ftepHold ? ' & release FTEP hold' : '' }}
            </button>
            <button type="button" class="pip__mini" @click="closing = false">Cancel</button>
          </div>
        </div>
      </div>

      <!-- targets -->
      <div class="pip__sub">Target dates</div>
      <div v-for="t in pips.targetsFor(active.id)" :key="t.id" class="pip__row">
        <span class="pip__due" :class="{ 'pip__due--soon': t.status === 'pending' && daysLeft({ ...active, endsOn: t.dueOn }) <= 7 }">{{ fmt(t.dueOn) }}</span>
        <div class="pip__rowmain">
          <b>{{ t.title }}</b>
          <span v-if="t.detail" class="pip__detail">{{ t.detail }}</span>
          <span v-if="t.note" class="pip__detail">— {{ t.note }}</span>
        </div>
        <span class="pip__pill" :class="t.status === 'met' ? 'pip__pill--met' : t.status === 'missed' ? 'pip__pill--missed' : 'pip__pill--pending'"><i></i>{{ t.status }}</span>
        <template v-if="mode === 'manage' && isAdmin">
          <button v-if="t.status !== 'met'" type="button" class="pip__mini" @click="markTarget(t.id, 'met')">Met</button>
          <button v-if="t.status !== 'missed'" type="button" class="pip__mini" @click="markTarget(t.id, 'missed')">Missed</button>
          <button v-if="t.status !== 'pending'" type="button" class="pip__mini" @click="markTarget(t.id, 'pending')">Reopen</button>
          <button type="button" class="pip__mini pip__mini--danger" @click="delTarget(t.id)">{{ armedDelete === `t-${t.id}` ? 'Confirm' : 'Delete' }}</button>
        </template>
      </div>
      <p v-if="pips.targetsFor(active.id).length === 0" class="pip__quiet">No target dates yet.</p>
      <div v-if="mode === 'manage' && isAdmin" class="pip__addrow">
        <input v-model="tDue" type="date" class="pip__input" />
        <input v-model="tTitle" type="text" class="pip__input pip__grow" placeholder="Target — e.g. Complete megacode remediation" />
        <input v-model="tDetail" type="text" class="pip__input pip__grow" placeholder="Detail (optional)" />
        <button type="button" class="pip__mini" :disabled="!tDue || !tTitle.trim() || busy" @click="addTarget"><Plus :size="13" /> Add</button>
      </div>

      <!-- progress log -->
      <div class="pip__sub">Progress &amp; training log</div>
      <div v-for="e in pips.entriesFor(active.id)" :key="e.id" class="pip__row">
        <span class="pip__due">{{ fmt(e.entryOn) }}</span>
        <span class="pip__pill pip__pill--kind"><i></i>{{ KIND_LABELS[e.kind] }}</span>
        <div class="pip__rowmain">
          {{ e.body }}
          <span class="pip__detail">— {{ nameOf(e.createdBy) }}</span>
        </div>
        <button v-if="mode === 'manage' && isAdmin" type="button" class="pip__mini pip__mini--danger" @click="delEntry(e.id)">{{ armedDelete === `e-${e.id}` ? 'Confirm' : 'Delete' }}</button>
      </div>
      <p v-if="pips.entriesFor(active.id).length === 0" class="pip__quiet">Nothing logged yet.</p>
      <div v-if="mode === 'manage' && canLog" class="pip__addrow">
        <input v-model="nEntryOn" type="date" class="pip__input" />
        <select v-model="nKind" class="pip__input">
          <option value="training">Training</option>
          <option value="meeting">Meeting</option>
          <option value="note">Note</option>
        </select>
        <input v-model="nBody" type="text" class="pip__input pip__grow" placeholder="What happened — e.g. Rode third with FTO Webb, airway scenarios ×4" @keyup.enter="addEntry" />
        <button type="button" class="pip__mini" :disabled="!nBody.trim() || busy" @click="addEntry"><Plus :size="13" /> Log</button>
      </div>

      <!-- documents -->
      <div class="pip__sub">Documents</div>
      <div v-for="d in pips.documentsFor(active.id)" :key="d.id" class="pip__row">
        <FileText :size="14" :stroke-width="1.9" style="color: var(--color-brand-600)" />
        <button type="button" class="pip__lnk pip__rowmain" style="text-align: left" @click="openDoc(d.storagePath)">{{ d.name }}</button>
        <span class="pip__detail">{{ fmtSize(d.sizeBytes) }}</span>
        <button v-if="mode === 'manage' && isAdmin" type="button" class="pip__mini pip__mini--danger" @click="pips.removeDocument(d)">Delete</button>
      </div>
      <p v-if="pips.documentsFor(active.id).length === 0" class="pip__quiet">No documents yet — upload the signed PIP.</p>
      <label v-if="mode === 'manage' && isAdmin" class="pip__upload">
        <Upload :size="13" :stroke-width="2" /> Upload document
        <input ref="fileInput" type="file" accept=".pdf,.doc,.docx,image/*" hidden @change="onFile" />
      </label>
    </template>

    <!-- ══ no active plan ══ -->
    <template v-else-if="mode === 'manage' && isAdmin">
      <button v-if="!creating" type="button" class="pip__btn" @click="creating = true">
        <Plus :size="14" /> Start a performance improvement plan
      </button>
      <div v-else class="pip__card">
        <div class="pip__form">
          <label class="pip__fld"><span>Starts</span><input v-model="cStart" type="date" class="pip__input" /></label>
          <label class="pip__fld"><span>Ends</span><input v-model="cEnd" type="date" class="pip__input" /></label>
          <label class="pip__fld"><span>Supervisor</span>
            <select v-model="cSupervisor" class="pip__input">
              <option value="">— none —</option>
              <option v-for="p in supervisorOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="pip__check"><input v-model="cHold" type="checkbox" /> Place FTEP training on hold
            <span class="pip__hint">shows a generic "training hold" on FTEP boards — no reason attached</span></label>
          <label class="pip__fld pip__fld--wide"><span>Plan details — expectations, deficiencies, support provided</span>
            <textarea v-model="cSummary" rows="5" class="pip__input" placeholder="Paste or write the PIP details. The signed document can be uploaded after creating."></textarea></label>
          <div class="pip__formrow">
            <button type="button" class="pip__btn" :disabled="!cStart || !cEnd || !cSummary.trim() || busy" @click="create">Create plan</button>
            <button type="button" class="pip__mini" @click="creating = false">Cancel</button>
          </div>
        </div>
      </div>
    </template>

    <!-- past plans -->
    <details v-if="past.length" class="pip__past">
      <summary>Past plans ({{ past.length }})</summary>
      <div v-for="p in past" :key="p.id" class="pip__row">
        <span class="pip__due">{{ fmt(p.startsOn) }} → {{ fmt(p.endsOn) }}</span>
        <span class="pip__pill" :class="p.status === 'completed' ? 'pip__pill--met' : 'pip__pill--missed'"><i></i>{{ p.status }}</span>
        <div class="pip__rowmain">{{ p.outcomeNote || p.summary }}</div>
      </div>
    </details>

    <template v-if="mode === 'self' && active">
      <p class="pip__hint" style="margin-top: 8px">
        <Paperclip :size="11" /> Questions about this plan go to {{ nameOf(active.supervisorUserId) }} or the Clinical Development Officer.
      </p>
    </template>
  </section>
</template>

<style scoped>
.pip { margin-top: 18px; }
.pip__title {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  padding-bottom: 6px; border-bottom: 1px solid var(--color-line);
  margin-bottom: 10px;
}
.pip__restricted { font-size: 10.5px; font-weight: 500; letter-spacing: 0.02em; text-transform: none; color: var(--color-muted); }
.pip__access { margin-left: auto; font: inherit; font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em; text-transform: none; color: var(--color-brand-700); background: none; border: 1px solid var(--color-line); border-radius: 5px; padding: 2px 8px; cursor: pointer; }
.pip__err { font-size: 12px; color: var(--color-danger-600, oklch(0.5 0.19 27)); margin: 0 0 8px; }

.pip__accessbox { border: 1px solid var(--color-line); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; background: var(--color-surface); }
.pip__accessrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; padding: 3px 0; }
.pip__accessadd { display: flex; gap: 6px; margin-top: 6px; }

.pip__card { border: 1px solid var(--color-line); border-left: 3px solid var(--color-danger-600, oklch(0.5 0.19 27)); border-radius: 6px; background: var(--color-surface); padding: 10px 12px; }
.pip__cardhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.pip__window { font-size: 13.5px; }
.pip__days { margin-left: 8px; font-size: 11.5px; color: var(--color-muted); }
.pip__days--over { color: var(--color-danger-600, oklch(0.5 0.19 27)); font-weight: 600; }
.pip__pills { display: flex; gap: 6px; }
.pip__pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid var(--color-line); border-radius: 4px; padding: 2px 7px; color: var(--color-ink-soft); background: var(--color-canvas); }
.pip__pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-muted); }
.pip__pill--active i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pip__pill--hold { color: oklch(0.45 0.12 70); border-color: oklch(0.82 0.08 80); }
.pip__pill--met i { background: var(--color-success-500, oklch(0.6 0.13 150)); }
.pip__pill--missed i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pip__pill--pending i { background: oklch(0.72 0.12 80); }
.pip__pill--kind i { background: var(--color-brand-600); }

.pip__summary { font-size: 13.5px; line-height: 1.55; margin: 8px 0 6px; white-space: pre-wrap; }
.pip__meta { font-size: 12px; color: var(--color-ink-soft); }
.pip__lnk { font: inherit; font-size: inherit; color: var(--color-brand-700); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
.pip__lnk--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }

.pip__sub { font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-muted); margin: 14px 0 6px; }
.pip__row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); flex-wrap: wrap; }
.pip__due { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--color-ink); white-space: nowrap; }
.pip__due--soon { color: oklch(0.5 0.14 70); }
.pip__rowmain { flex: 1; min-width: 180px; }
.pip__detail { color: var(--color-muted); font-size: 12px; }
.pip__quiet { font-size: 12px; color: var(--color-muted); padding: 2px 0 4px; }

.pip__addrow { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; align-items: center; }
.pip__grow { flex: 1; min-width: 140px; }
.pip__input { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink); }
.pip__mini { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink-soft); cursor: pointer; white-space: nowrap; }
.pip__mini--danger { color: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pip__mini:disabled { opacity: 0.5; cursor: default; }
.pip__btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border: 0; border-radius: 6px; background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)); color: #fff; cursor: pointer; }
.pip__btn--danger { background: linear-gradient(180deg, oklch(0.55 0.17 27), oklch(0.44 0.17 27)); }
.pip__btn:disabled { opacity: 0.55; cursor: default; }

.pip__form { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.pip__fld { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-muted); }
.pip__fld--wide { flex: 1 1 100%; }
.pip__fld textarea { text-transform: none; letter-spacing: normal; font-weight: 400; }
.pip__formrow { flex: 1 1 100%; display: flex; gap: 8px; align-items: center; }
.pip__check { display: flex; align-items: center; gap: 7px; font-size: 13px; flex: 1 1 100%; }
.pip__hint { font-size: 11px; color: var(--color-muted); font-weight: 400; }
.pip__closebox { border-top: 1px dashed var(--color-line); margin-top: 10px; padding-top: 10px; display: flex; flex-wrap: wrap; gap: 10px; }
.pip__upload { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--color-brand-700); border: 1px dashed var(--color-line); border-radius: 6px; padding: 6px 12px; cursor: pointer; margin-top: 7px; }
.pip__past { margin-top: 14px; font-size: 12.5px; }
.pip__past summary { cursor: pointer; color: var(--color-muted); font-weight: 600; }
</style>
