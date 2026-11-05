<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import TimeSelect24 from '@/components/primitives/TimeSelect24.vue'
import { useRoute, useRouter } from 'vue-router'
import { ClipboardList, Plus, X } from 'lucide-vue-next'
import CommandNav from '@/components/command/CommandNav.vue'
import { useAuthStore } from '@/stores/auth'
import { useSchedule, todayCentralIso, addDaysIso } from '@/composables/useSchedule'
import {
  useCommand,
  emptySummaryData,
  normalizeFleetRow,
  type SummaryData,
  type SummarySide,
  type UnitSection,
} from '@/composables/useCommand'
import { generateDailySummaryPdf } from '@/lib/dailySummaryPdf'
import type { DailySummary } from '@/composables/useCommand'

/**
 * Supervisor Daily Summary — native replacement for the Jotform
 * (Justin, 2026-11-04). Crew tables pre-fill from the schedule but stay
 * editable (gold dot = from the schedule, red = hand-corrected). Side
 * picks the unit set — North (S201), South (S202), or County-wide when
 * one supervisor covers both. Supervisors support partial-shift rows.
 * NEOP/3rd renders via an add-button instead of standing blank boxes.
 * >10-minute en-routes capture incident # + reason rows. Submit files
 * the letterhead PDF to the archive and emails it to every supervisor.
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const sched = useSchedule()
const cmd = useCommand()

onMounted(() => {
  void (async () => {
    await sched.ensureLoaded()
    await ensureRange(shiftDate.value)
  })()
  void cmd.load()
})

/* loadCore never loads entries; make sure the chosen date is covered
   (union with whatever range is already loaded so nothing shrinks). */
async function ensureRange(iso: string): Promise<void> {
  const from = addDaysIso(iso, -1)
  const to = addDaysIso(iso, 1)
  const rs = sched.rangeStart.value
  const re = sched.rangeEnd.value
  if (rs && re && from >= rs && to <= re) return
  await sched.loadRange(rs && rs < from ? rs : from, re && re > to ? re : to)
}

/* ── header state ─────────────────────────────────────────────────── */
const shiftDate = ref(todayCentralIso())
const side = ref<SummarySide>(
  route.query.side === 'north' || route.query.side === 'south' || route.query.side === 'all'
    ? (route.query.side as SummarySide)
    : 'north',
)
const shiftLetter = ref<string>('')
const chartAudits = ref<number | null>(null)
const rowId = ref<string | null>(null)
const existingStatus = ref<'draft' | 'submitted' | null>(null)

const form = reactive<SummaryData>(emptySummaryData())
/** Schedule pre-fill snapshot — drives the gold/red source dots. */
type CrewCells = Record<'ic' | 'at' | 'third', string>
let pristine: Record<string, { am: CrewCells; pm: CrewCells }> = {}

function sideOf(station: string | null | undefined): 'north' | 'south' | null {
  if (!station) return null
  if (station.includes('201')) return 'north'
  if (station.includes('202')) return 'south'
  return null
}

/** Minutes past 0600 with overnight wrap. */
function shiftMin(hhmm: string): number {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2))
  return (m - 360 + 1440) % 1440
}
function covers(start: string, end: string, probe: string): boolean {
  const s = shiftMin(start.replace(':', ''))
  let e = shiftMin(end.replace(':', ''))
  if (e === 0) e = 1440
  const p = shiftMin(probe)
  return s <= p && p < e
}

/** Units for the selected side, in schedule order ('all' = both sides). */
const unitCodes = computed<string[]>(() => {
  const out: string[] = []
  for (const um of sched.dayModel(shiftDate.value).units) {
    if (um.unit.code.startsWith('S')) continue
    const s = sideOf(um.unit.station)
    if (!s) continue
    if (side.value === 'all' || s === side.value) out.push(um.unit.code)
  }
  return out
})

/** Build a unit's crew from the schedule — AM = occupant at 0800,
 *  PM = occupant at 2000; riders/students land in NEOP/3rd. */
function prefillUnit(code: string): UnitSection {
  const model = sched.dayModel(shiftDate.value)
  const um = model.units.find((u) => u.unit.code === code)
  const slot = (probe: string) => {
    const out = { ic: '', at: '', third: '' }
    if (!um) return out
    for (const sm of um.seats) {
      const row = sm.rows.find((r) => !r.open && r.userId && covers(r.start, r.end, probe))
      if (!row) continue
      if (sm.seat.sortOrder === 0) out.ic = row.name
      else if (!out.at) out.at = row.name
    }
    for (const ex of um.extras) {
      if (ex.open || !ex.userId) continue
      if (covers(ex.start, ex.end, probe)) out.third = ex.name
    }
    return out
  }
  const am = slot('0800')
  const pm = slot('2000')
  return {
    am: { ...am },
    pm: { ...pm },
    hasThird: !!(am.third || pm.third),
    calls: { post: null, transport: null, non: null },
  }
}

function defaultSupervisor(): string {
  if (side.value === 'all') return auth.appUser?.fullName ?? ''
  const model = sched.dayModel(shiftDate.value)
  const sUnit = model.units.find((u) => u.unit.code === (side.value === 'north' ? 'S201' : 'S202'))
  const row = sUnit?.seats[0]?.rows.find((r) => !r.open && r.userId && covers(r.start, r.end, '0800'))
  return row?.name ?? (auth.appUser?.fullName ?? '')
}

function freshForm() {
  const next = emptySummaryData()
  next.supervisors = [{ name: defaultSupervisor() }]
  pristine = {}
  for (const code of unitCodes.value) {
    const u = prefillUnit(code)
    next.units[code] = u
    pristine[code] = {
      am: { ic: u.am.ic, at: u.am.at, third: u.am.third },
      pm: { ic: u.pm.ic, at: u.pm.at, third: u.pm.third },
    }
  }
  next.fleet = cmd.fleetStartState()
  Object.assign(form, next)
  chartAudits.value = null
  rowId.value = null
  existingStatus.value = null
  shiftLetter.value = sched.platoonFor(shiftDate.value)
}

function hydrate(s: DailySummary) {
  Object.assign(form, { ...emptySummaryData(), ...s.data })
  /* Normalize stored rows (legacy combined "X - Reserve" locations,
     missing role), repair untouched-empty rows from drafts that predate
     the seeded homes, and backfill vehicles added after the draft. */
  const start = cmd.fleetStartState()
  for (const v of cmd.fleet.value) {
    const cur = form.fleet[v.label]
    const pristineEmpty =
      cur && cur.status === 'in_service' && !cur.location && !(cur as { role?: string }).role && !cur.notes
    if (!cur || pristineEmpty) form.fleet[v.label] = start[v.label]!
    else form.fleet[v.label] = normalizeFleetRow(cur)
  }
  /* Rebuild the pristine snapshot so untouched schedule cells keep the
     gold dot after a resume; anything differing reads as corrected. */
  pristine = {}
  for (const code of Object.keys(form.units)) {
    const u = prefillUnit(code)
    pristine[code] = {
      am: { ic: u.am.ic, at: u.am.at, third: u.am.third },
      pm: { ic: u.pm.ic, at: u.pm.at, third: u.pm.third },
    }
  }
  chartAudits.value = s.chartAudits
  rowId.value = s.id
  existingStatus.value = s.status
  shiftLetter.value = s.shiftLetter ?? sched.platoonFor(shiftDate.value)
}

/* Load the existing row for (date, side) or start fresh. Waits for the
   schedule + command data so the pre-fill has something to read. */
const initialized = ref(false)
watch(
  [() => cmd.ready.value, () => sched.loaded.value, () => sched.rangeStart.value, () => sched.rangeEnd.value, shiftDate, side],
  ([cReady, sReady], oldVals) => {
    if (!cReady || !sReady) return
    void ensureRange(shiftDate.value)
    /* oldVals is undefined on the immediate first run. */
    const switched = !oldVals || oldVals[4] !== shiftDate.value || oldVals[5] !== side.value
    const existing = cmd.summaryFor(shiftDate.value, side.value)
    if (existing) {
      if (switched || !initialized.value) hydrate(existing)
    } else if (switched || !initialized.value || !dirty) {
      /* Re-prefill when the entries range lands — but never over typed
         work (dirty) on the same date+side. */
      freshForm()
    }
    initialized.value = true
    if (switched) dirty = false
  },
  { immediate: true },
)

function isEdited(code: string, half: 'am' | 'pm', field: 'ic' | 'at' | 'third'): boolean {
  const p = pristine[code]?.[half]?.[field] ?? ''
  return (form.units[code]?.[half]?.[field] ?? '') !== p
}

/* ── supervisors (partial-shift rows) ─────────────────────────────── */
function addSupervisor() {
  form.supervisors.push({ name: '', from: '', until: '' })
}
function removeSupervisor(i: number) {
  form.supervisors.splice(i, 1)
  if (!form.supervisors.length) form.supervisors.push({ name: '' })
}

/* ── NEOP/3rd add-button ──────────────────────────────────────────── */
function addThird(code: string) {
  const u = form.units[code]
  if (u) u.hasThird = true
}
function removeThird(code: string) {
  const u = form.units[code]
  if (!u) return
  u.hasThird = false
  u.am.third = ''
  u.pm.third = ''
}

/* ── late-call rows ───────────────────────────────────────────────── */
function addLateRow() {
  form.esd.lateCalls.rows.push({ incident: '', reason: '' })
}
function removeLateRow(i: number) {
  form.esd.lateCalls.rows.splice(i, 1)
}
watch(
  () => form.esd.lateCalls.answer,
  (yes) => {
    if (yes && form.esd.lateCalls.rows.length === 0) addLateRow()
  },
)

const totalCalls = computed(() =>
  Object.values(form.units).reduce(
    (t, u) => t + (Number(u.calls.post) || 0) + (Number(u.calls.transport) || 0) + (Number(u.calls.non) || 0),
    0,
  ),
)

/* ── autosave (debounced, serialized like the FTEP runner) ────────── */
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let dirty = false
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<boolean> | null = null
let rerun = false

function persist(): Promise<boolean> {
  if (inFlight) {
    rerun = true
    return inFlight
  }
  inFlight = (async () => {
    let ok = false
    try {
      do {
        rerun = false
        saveState.value = 'saving'
        const res = await cmd.saveDraft({
          id: rowId.value ?? undefined,
          shiftDate: shiftDate.value,
          side: side.value,
          shiftLetter: shiftLetter.value || null,
          chartAudits: chartAudits.value,
          data: JSON.parse(JSON.stringify(form)) as SummaryData,
        })
        if (!res.ok) {
          saveState.value = 'error'
          return false
        }
        rowId.value = res.id
        if (!existingStatus.value) existingStatus.value = 'draft'
        saveState.value = 'saved'
        dirty = false
        ok = true
      } while (rerun)
    } finally {
      inFlight = null
    }
    return ok
  })()
  return inFlight
}

function queueSave() {
  if (!initialized.value) return
  dirty = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void persist(), 2000)
}
watch([form, chartAudits, shiftLetter], queueSave, { deep: true })
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (dirty && rowId.value) void persist()
})

/* ── submit ───────────────────────────────────────────────────────── */
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitDone = ref<string | null>(null)

async function onSubmit() {
  if (submitting.value) return
  if (!form.supervisors.some((s) => s.name.trim())) {
    submitError.value = 'Add the supervisor name first.'
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    const saved = await persist()
    if (!saved || !rowId.value) {
      submitError.value = 'Could not save the summary.'
      return
    }
    const row = cmd.summaryFor(shiftDate.value, side.value)
    if (!row) {
      submitError.value = 'Could not load the saved summary.'
      return
    }
    const doc = await generateDailySummaryPdf(row)
    const blob = doc.output('blob')
    const res = await cmd.submitSummary(rowId.value, blob)
    if (!res.ok) {
      submitError.value = res.error
      return
    }
    existingStatus.value = 'submitted'
    submitDone.value =
      res.emailed >= 0
        ? `Submitted — the PDF went to ${res.emailed} supervisor${res.emailed === 1 ? '' : 's'} and is in the archive.`
        : 'Submitted and archived — the email step reported an issue; the PDF is in the archive.'
    window.setTimeout(() => router.push('/command/summaries'), 2200)
  } finally {
    submitting.value = false
  }
}

/* Fleet locations are unit assignments (Main/Reserve per medic unit),
   not stations — plus the shop. Stored values outside the list still
   render (first option group). */
const locationOptions = computed<string[]>(() => {
  const out: string[] = []
  for (const um of sched.dayModel(shiftDate.value).units) {
    if (!um.unit.code.startsWith('S')) out.push(um.unit.code)
  }
  out.push('At Shop', 'Other')
  return out
})

/** Reserve-depth line under the fleet matrix. */
const fleetCounts = computed(() => {
  const rows = Object.values(form.fleet)
  const inService = rows.filter((r) => r.status === 'in_service').length
  const reserve = rows.filter((r) => r.status === 'in_service' && r.role === 'reserve').length
  const oos = rows.filter((r) => r.status === 'oos').length
  return { inService, reserve, oos }
})

const sideLabel = computed(() =>
  side.value === 'north' ? 'North — S201' : side.value === 'south' ? 'South — S202' : 'County-wide',
)

function fmtSave(): string {
  switch (saveState.value) {
    case 'saving': return 'Saving…'
    case 'saved': return 'Draft saved'
    case 'error': return 'Save failed — retrying on next change'
    default: return 'Autosaves as you work'
  }
}
</script>

<template>
  <div class="cds">
    <header class="cds__head">
      <div class="flex items-center gap-2">
        <ClipboardList :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display cds__title">Supervisor Daily Summary</h1>
      </div>
      <p class="cds__sub">One per side, per shift date — submit files the letterhead PDF and emails every supervisor.</p>
    </header>

    <div v-if="!auth.isSupervisor" class="cds__gate">Command staff only.</div>

    <template v-else>
      <CommandNav />
      <div v-if="!initialized" class="cds__gate">Loading…</div>

      <template v-else>
        <div class="cds__topline">
          <span v-if="existingStatus === 'submitted'" class="cds__filedtag">Already filed — editing resubmits and re-emails</span>
          <span class="cds__savestate">{{ fmtSave() }}</span>
        </div>

        <!-- Header card -->
        <div class="cds__card">
          <div class="cds__meta">
            <label class="cds__f">
              <span>Shift date</span>
              <input v-model="shiftDate" type="date" />
            </label>
            <div class="cds__f">
              <span>Side</span>
              <div class="cds__segs">
                <button type="button" class="cds__seg" :class="{ 'cds__seg--on': side === 'north' }" @click="side = 'north'">North</button>
                <button type="button" class="cds__seg" :class="{ 'cds__seg--on': side === 'south' }" @click="side = 'south'">South</button>
                <button type="button" class="cds__seg" :class="{ 'cds__seg--on': side === 'all' }" title="One supervisor covering the whole county" @click="side = 'all'">All</button>
              </div>
            </div>
            <div class="cds__f">
              <span>Shift</span>
              <div class="cds__segs">
                <button v-for="l in ['A', 'B', 'C']" :key="l" type="button" class="cds__seg" :class="{ 'cds__seg--on': shiftLetter === l }" @click="shiftLetter = l">{{ l }}</button>
              </div>
            </div>
            <label class="cds__f">
              <span>Chart audits</span>
              <input v-model.number="chartAudits" type="number" min="0" style="width: 84px" />
            </label>
            <div class="cds__f">
              <span>Total calls</span>
              <b class="cds__total">{{ totalCalls }}</b>
            </div>
          </div>

          <!-- Supervisors (partial-shift rows) -->
          <div class="cds__sups">
            <div v-for="(s, i) in form.supervisors" :key="i" class="cds__suprow">
              <label class="cds__f cds__f--grow">
                <span>{{ i === 0 ? 'Supervisor' : 'Also covered by' }}</span>
                <input v-model="s.name" list="cds-sups" placeholder="Name" />
              </label>
              <template v-if="form.supervisors.length > 1">
                <label class="cds__f"><span>From</span><TimeSelect24 v-model="s.from!" /></label>
                <label class="cds__f"><span>Until</span><TimeSelect24 v-model="s.until!" /></label>
              </template>
              <button v-if="form.supervisors.length > 1" type="button" class="cds__x" title="Remove" @click="removeSupervisor(i)"><X :size="13" :stroke-width="2" /></button>
            </div>
            <button type="button" class="cds__addlink" @click="addSupervisor">
              <Plus :size="12" :stroke-width="2" /> Add supervisor (partial shift)
            </button>
            <datalist id="cds-sups">
              <option v-for="p in sched.people.value.filter((x) => x.role === 'supervisor' || x.role === 'admin')" :key="p.id" :value="p.fullName" />
            </datalist>
          </div>
        </div>

        <p class="cds__prefnote">
          Crew names are <b>pre-filled from the schedule</b> — a gold dot means straight from the schedule;
          correct any name and the dot turns red so the record shows it was fixed by hand.
        </p>

        <!-- Units -->
        <section class="cds__sec">
          <div class="cds__sec-h"><h2 class="display">{{ sideLabel }} — crew &amp; calls</h2></div>
          <div class="cds__units">
            <div v-for="code in unitCodes" :key="code" class="cds__unit">
              <h3 class="display">{{ code }}</h3>
              <div class="cds__crew">
                <span></span><span class="cds__ch">AM</span><span class="cds__ch">PM</span>
                <span class="cds__rl">In charge</span>
                <span v-for="half in (['am', 'pm'] as const)" :key="'ic' + half" class="cds__cellwrap">
                  <input v-model="form.units[code]![half].ic" class="cds__cell" />
                  <span class="cds__src" :class="{ 'cds__src--edited': isEdited(code, half, 'ic') }"></span>
                </span>
                <span class="cds__rl">Attendant</span>
                <span v-for="half in (['am', 'pm'] as const)" :key="'at' + half" class="cds__cellwrap">
                  <input v-model="form.units[code]![half].at" class="cds__cell" />
                  <span class="cds__src" :class="{ 'cds__src--edited': isEdited(code, half, 'at') }"></span>
                </span>
                <template v-if="form.units[code]!.hasThird">
                  <span class="cds__rl">NEOP / 3rd
                    <button type="button" class="cds__x" title="Remove the 3rd-rider row" @click="removeThird(code)"><X :size="11" :stroke-width="2" /></button>
                  </span>
                  <span v-for="half in (['am', 'pm'] as const)" :key="'third' + half" class="cds__cellwrap">
                    <input v-model="form.units[code]![half].third" class="cds__cell" />
                    <span class="cds__src" :class="{ 'cds__src--edited': isEdited(code, half, 'third') }"></span>
                  </span>
                </template>
              </div>
              <button v-if="!form.units[code]!.hasThird" type="button" class="cds__addlink" @click="addThird(code)">
                <Plus :size="12" :stroke-width="2" /> Add 3rd rider
              </button>
              <div class="cds__calls">
                <label class="cds__f"><span>Post</span><input v-model.number="form.units[code]!.calls.post" type="number" min="0" /></label>
                <label class="cds__f"><span>Transport</span><input v-model.number="form.units[code]!.calls.transport" type="number" min="0" /></label>
                <label class="cds__f"><span>Non-transport</span><input v-model.number="form.units[code]!.calls.non" type="number" min="0" /></label>
              </div>
            </div>
          </div>
        </section>

        <!-- Fleet -->
        <section class="cds__sec">
          <div class="cds__sec-h"><h2 class="display">Fleet status</h2><span class="cds__hint">all vehicles — shared between sides</span></div>
          <div class="cds__tablebox">
            <table class="cds__table">
              <thead><tr><th>Vehicle</th><th>Status</th><th>Location</th><th>Main / Reserve</th><th>PSTrax updated</th><th>Notes</th></tr></thead>
              <tbody>
                <tr v-for="v in cmd.fleet.value" :key="v.id" :class="{ 'cds__oos': form.fleet[v.label]?.status === 'oos' }">
                  <td><b>{{ v.label }}</b></td>
                  <td>
                    <div class="cds__segs">
                      <button type="button" class="cds__seg cds__seg--sm" :class="{ 'cds__seg--on': form.fleet[v.label]?.status === 'in_service' }" @click="form.fleet[v.label]!.status = 'in_service'">In service</button>
                      <button type="button" class="cds__seg cds__seg--sm cds__seg--bad" :class="{ 'cds__seg--on': form.fleet[v.label]?.status === 'oos' }" @click="form.fleet[v.label]!.status = 'oos'">OOS</button>
                    </div>
                  </td>
                  <td>
                    <select v-model="form.fleet[v.label]!.location">
                      <option value="">—</option>
                      <option v-if="form.fleet[v.label]!.location && !locationOptions.includes(form.fleet[v.label]!.location)">{{ form.fleet[v.label]!.location }}</option>
                      <option v-for="loc in locationOptions" :key="loc">{{ loc }}</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="form.fleet[v.label]!.role">
                      <option value="">—</option>
                      <option value="main">Main</option>
                      <option value="reserve">Reserve</option>
                    </select>
                  </td>
                  <td style="text-align: center"><input v-model="form.fleet[v.label]!.pstrax" type="checkbox" /></td>
                  <td><input v-model="form.fleet[v.label]!.notes" class="cds__cell" placeholder="" /></td>
                </tr>
              </tbody>
            </table>
            <p class="cds__fleetcount">
              {{ fleetCounts.inService }} in service · {{ fleetCounts.reserve }} reserve ready · {{ fleetCounts.oos }} OOS
            </p>
          </div>
        </section>

        <!-- Downtime -->
        <section class="cds__sec">
          <div class="cds__sec-h"><h2 class="display">Unit downtime</h2></div>
          <div class="cds__qa">
            <div class="cds__q">Was a unit placed on downtime?</div>
            <div class="cds__radios">
              <label><input v-model="form.downtime.first.used" type="radio" :value="true" /> Yes</label>
              <label><input v-model="form.downtime.first.used" type="radio" :value="false" /> No</label>
            </div>
            <div v-if="form.downtime.first.used" class="cds__condline">
              <label class="cds__f"><span>Unit</span>
                <select v-model="form.downtime.first.unit"><option v-for="c in unitCodes" :key="c">{{ c }}</option></select>
              </label>
              <label class="cds__f"><span>From</span><TimeSelect24 v-model="form.downtime.first.from" /></label>
              <label class="cds__f"><span>Until</span><TimeSelect24 v-model="form.downtime.first.until" /></label>
              <label class="cds__f cds__f--grow"><span>Reason</span><input v-model="form.downtime.first.reason" /></label>
            </div>
            <template v-if="form.downtime.first.used">
              <div class="cds__q" style="margin-top: 10px">Was a second unit placed on downtime?</div>
              <div class="cds__radios">
                <label><input v-model="form.downtime.second.used" type="radio" :value="true" /> Yes</label>
                <label><input v-model="form.downtime.second.used" type="radio" :value="false" /> No</label>
              </div>
              <div v-if="form.downtime.second.used" class="cds__condline">
                <label class="cds__f"><span>Unit</span>
                  <select v-model="form.downtime.second.unit"><option v-for="c in unitCodes" :key="c">{{ c }}</option></select>
                </label>
                <label class="cds__f"><span>From</span><TimeSelect24 v-model="form.downtime.second.from" /></label>
                <label class="cds__f"><span>Until</span><TimeSelect24 v-model="form.downtime.second.until" /></label>
                <label class="cds__f cds__f--grow"><span>Reason</span><input v-model="form.downtime.second.reason" /></label>
              </div>
            </template>
          </div>
        </section>

        <!-- ESD -->
        <section class="cds__sec">
          <div class="cds__sec-h"><h2 class="display">ESD reporting</h2><span class="cds__hint">required by the ESD contract</span></div>
          <div class="cds__qa">
            <div class="cds__q">Did another agency post for us?</div>
            <div class="cds__radios">
              <label><input v-model="form.esd.postedForUs.answer" type="radio" :value="true" /> Yes</label>
              <label><input v-model="form.esd.postedForUs.answer" type="radio" :value="false" /> No</label>
            </div>
            <div v-if="form.esd.postedForUs.answer" class="cds__condline">
              <label class="cds__f"><span>Agency</span><input v-model="form.esd.postedForUs.agency" /></label>
              <label class="cds__f cds__f--grow"><span>Details</span><input v-model="form.esd.postedForUs.details" placeholder="window, where they posted" /></label>
            </div>
          </div>
          <div class="cds__qa">
            <div class="cds__q">Did we post for another agency?</div>
            <div class="cds__radios">
              <label><input v-model="form.esd.wePosted.answer" type="radio" :value="true" /> Yes</label>
              <label><input v-model="form.esd.wePosted.answer" type="radio" :value="false" /> No</label>
            </div>
            <div v-if="form.esd.wePosted.answer" class="cds__condline">
              <label class="cds__f"><span>Agency</span><input v-model="form.esd.wePosted.agency" /></label>
              <label class="cds__f cds__f--grow"><span>Details</span><input v-model="form.esd.wePosted.details" /></label>
            </div>
          </div>
          <div class="cds__qa">
            <div class="cds__q">Any calls with an en-route time greater than 10 minutes?</div>
            <div class="cds__radios">
              <label><input v-model="form.esd.lateCalls.answer" type="radio" :value="true" /> Yes</label>
              <label><input v-model="form.esd.lateCalls.answer" type="radio" :value="false" /> No</label>
            </div>
            <div v-if="form.esd.lateCalls.answer" class="cds__late">
              <div class="cds__laterow cds__laterow--head">
                <span>Incident #</span><span>Reason</span><span></span>
              </div>
              <div v-for="(r, i) in form.esd.lateCalls.rows" :key="i" class="cds__laterow">
                <input v-model="r.incident" placeholder="26-0587xx" />
                <input v-model="r.reason" placeholder="why the en-route ran long" />
                <button type="button" class="cds__x" title="Remove row" @click="removeLateRow(i)"><X :size="13" :stroke-width="2" /></button>
              </div>
              <button type="button" class="cds__addlink" @click="addLateRow"><Plus :size="12" :stroke-width="2" /> Add another call</button>
            </div>
          </div>
        </section>

        <!-- Notes -->
        <section class="cds__sec">
          <div class="cds__sec-h"><h2 class="display">Notes</h2></div>
          <div class="cds__notes">
            <label class="cds__f"><span>Equipment</span><textarea v-model="form.notes.equipment" rows="3"></textarea></label>
            <label class="cds__f"><span>Personnel</span><textarea v-model="form.notes.personnel" rows="3"></textarea></label>
            <label class="cds__f"><span>Supplies</span><textarea v-model="form.notes.supplies" rows="3"></textarea></label>
            <label class="cds__f"><span>Other</span><textarea v-model="form.notes.other" rows="3"></textarea></label>
          </div>
        </section>

        <div v-if="submitError" class="cds__err">{{ submitError }}</div>
        <div v-if="submitDone" class="cds__done">{{ submitDone }}</div>
        <div class="cds__foot">
          <button type="button" class="cds__btn" :disabled="submitting" @click="persist()">Save draft</button>
          <button type="button" class="cds__btn cds__btn--primary" :disabled="submitting" @click="onSubmit">
            {{ submitting ? 'Submitting…' : existingStatus === 'submitted' ? 'Resubmit & re-email' : 'Submit summary' }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.cds { max-width: 1080px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .cds { padding: 36px 40px 80px; } }
.cds__head { margin-bottom: 10px; }
.cds__title { font-size: 26px; margin: 0; }
.cds__sub { margin: 2px 0 14px; font-size: 13px; color: var(--color-muted); }
.cds__gate { margin-top: 24px; padding: 28px; text-align: center; font-size: 13px; color: var(--color-muted); border: 1px dashed var(--color-line); border-radius: 12px; }
.cds__topline { display: flex; justify-content: flex-end; gap: 12px; align-items: center; margin-bottom: 6px; }
.cds__savestate { font-size: 11.5px; color: var(--color-muted); }
.cds__filedtag { font-size: 11px; font-weight: 700; color: var(--color-gold-700, #8a6d14); }

.cds__card { background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 12px; padding: 14px 16px; }
.cds__meta { display: flex; gap: 10px 22px; flex-wrap: wrap; align-items: end; }
.cds__f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cds__f--grow { flex: 1; min-width: 180px; }
.cds__f > span { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; color: var(--color-muted); text-transform: uppercase; }
.cds__f input, .cds__f select, .cds__f textarea, .cds__cell {
  border: 1px solid var(--color-line); border-radius: 4px; background: var(--color-bg, var(--color-surface-soft));
  color: var(--color-ink); font: 13px inherit; font-family: inherit; padding: 7px 9px;
}
.cds__total { font-size: 22px; font-variant-numeric: tabular-nums; }
.cds__segs { display: flex; }
.cds__seg { border: 1px solid var(--color-line); background: var(--color-surface); color: var(--color-ink-soft, var(--color-ink)); font: 700 12px inherit; font-family: inherit; padding: 7px 12px; cursor: pointer; }
.cds__seg:first-child { border-radius: 5px 0 0 5px; }
.cds__seg:last-child { border-radius: 0 5px 5px 0; }
.cds__seg + .cds__seg { border-left: 0; }
.cds__seg--on { background: var(--color-brand-600); border-color: var(--color-brand-600); color: #fff; }
.cds__seg--sm { padding: 3px 7px; font-size: 10.5px; }
.cds__seg--bad.cds__seg--on { background: var(--color-danger-500); border-color: var(--color-danger-500); }

.cds__sups { margin-top: 12px; border-top: 1px solid var(--color-line); padding-top: 10px; }
.cds__suprow { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-bottom: 6px; }
.cds__addlink { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; color: var(--color-brand-700, var(--color-brand-600)); font: 600 12px inherit; font-family: inherit; cursor: pointer; padding: 4px 0; }
.cds__x { background: none; border: 0; color: var(--color-muted); cursor: pointer; padding: 2px; display: inline-flex; vertical-align: middle; }
.cds__x:hover { color: var(--color-danger-500); }

.cds__prefnote { font-size: 12px; color: var(--color-ink-soft, var(--color-ink)); background: var(--color-gold-100, #f3e9c9); border-radius: 6px; padding: 8px 12px; margin: 14px 0 0; }

.cds__sec { margin-top: 22px; }
.cds__sec-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; border-bottom: 1.5px solid var(--color-ink); padding-bottom: 4px; margin-bottom: 10px; }
.cds__sec-h h2 { margin: 0; font-size: 19px; font-weight: 400; }
.cds__hint { font-size: 11.5px; color: var(--color-muted); }

.cds__units { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 6px 44px; }
.cds__unit { padding: 8px 2px 14px; min-width: 0; }
.cds__unit h3 { margin: 0 0 8px; font-size: 16px; font-weight: 400; border-bottom: 1px solid var(--color-line); padding-bottom: 4px; display: flex; align-items: baseline; justify-content: space-between; }
.cds__crew { display: grid; grid-template-columns: 64px 1fr 1fr; gap: 2px 10px; align-items: center; }
.cds__ch { font-size: 9px; font-weight: 700; letter-spacing: 0.09em; color: var(--color-muted); }
.cds__rl { font-size: 10px; font-weight: 700; color: var(--color-muted); display: flex; align-items: center; gap: 4px; }
.cds__cellwrap { position: relative; display: block; }
.cds__cellwrap .cds__cell { width: 100%; box-sizing: border-box; padding-right: 18px; }
.cds__crew .cds__cell,
.cds__table .cds__cell {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-line);
  border-radius: 0;
  padding: 3px 18px 3px 2px;
}
.cds__crew .cds__cell:focus,
.cds__table .cds__cell:focus {
  outline: none;
  border-bottom-color: var(--color-brand-600);
}
.cds__src { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 7px; height: 7px; border-radius: 50%; background: var(--color-gold-500, #c9a227); }
.cds__src--edited { background: var(--color-danger-500); }
.cds__calls { display: flex; gap: 14px; margin-top: 8px; align-items: end; }
.cds__calls .cds__f { flex: 0 0 auto; }
.cds__calls input { width: 64px; box-sizing: border-box; text-align: center; padding: 4px 6px; }

.cds__tablebox { overflow-x: auto; }
.cds__table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.cds__table th { text-align: left; font-size: 10px; letter-spacing: 0.1em; color: var(--color-muted); font-weight: 700; padding: 5px 8px; border-bottom: 1.5px solid var(--color-line); white-space: nowrap; }
.cds__table td { padding: 6px 8px; border-bottom: 1px solid var(--color-line); }
.cds__table select { border: 1px solid var(--color-line); border-radius: 4px; background: var(--color-surface); color: var(--color-ink); font: 12.5px inherit; font-family: inherit; padding: 5px 7px; }
.cds__fleetcount { margin: 8px 0 0; font-size: 11.5px; color: var(--color-muted); font-weight: 600; }
.cds__table .cds__cell { width: 100%; box-sizing: border-box; min-width: 140px; }
.cds__oos td { background: oklch(0.96 0.025 25 / 0.45); }

.cds__qa { padding: 10px 2px 12px; border-bottom: 1px solid var(--color-line); }
.cds__q { font-weight: 600; font-size: 13.5px; margin-bottom: 6px; }
.cds__radios { display: flex; gap: 16px; font-size: 13px; }
.cds__radios label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
.cds__condline { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 9px; align-items: end; }

.cds__late { margin-top: 10px; }
.cds__laterow { display: grid; grid-template-columns: 150px 1fr 26px; gap: 8px; align-items: center; margin-bottom: 6px; }
.cds__laterow--head { font-size: 10px; font-weight: 700; letter-spacing: 0.09em; color: var(--color-muted); text-transform: uppercase; margin-bottom: 2px; }
.cds__laterow input { border: 1px solid var(--color-line); border-radius: 4px; background: var(--color-surface); color: var(--color-ink); font: 13px inherit; font-family: inherit; padding: 7px 9px; min-width: 0; }

.cds__notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.cds__notes textarea { resize: vertical; }

.cds__err { margin-top: 14px; color: var(--color-danger-500); font-size: 13px; }
.cds__done { margin-top: 14px; color: var(--color-success-600, var(--color-success-500)); font-weight: 600; font-size: 13px; }
.cds__foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
.cds__btn { font: 600 13px inherit; font-family: inherit; border-radius: 6px; padding: 9px 16px; cursor: pointer; border: 1px solid var(--color-line); background: var(--color-surface); color: var(--color-ink); }
.cds__btn--primary { background: var(--color-brand-600); border-color: var(--color-brand-600); color: #fff; }
.cds__btn:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 640px) {
  .cds__laterow { grid-template-columns: 110px 1fr 24px; }
}
</style>
