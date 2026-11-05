<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { Radio, Pin, Trash2 } from 'lucide-vue-next'
import CommandNav from '@/components/command/CommandNav.vue'
import { useAuthStore } from '@/stores/auth'
import { useSchedule, todayCentralIso, addDaysIso } from '@/composables/useSchedule'
import { useCommand, normalizeFleetRow, type CommandNote } from '@/composables/useCommand'
import { useRequiredTraining } from '@/composables/useRequiredTraining'

/**
 * Command dashboard — the shift supervisor's operational picture
 * (Justin, 2026-11-04). Command staff only (supervisors + admins):
 * who's on duty with credential-coverage flags, shift handoff notes,
 * Daily Summary status, latest fleet, crew follow-ups, trainees
 * riding, open seats, and (schedule editors only) the approval queue.
 */

const auth = useAuthStore()
const sched = useSchedule()
const cmd = useCommand()
const rt = useRequiredTraining()

onMounted(() => {
  void (async () => {
    await sched.ensureLoaded()
    /* loadCore never loads entries — without a range the board renders
       pure rotation (no trades, riders, or time off; launch-day bug). */
    const from = addDaysIso(todayCentralIso(), -1)
    const to = addDaysIso(todayCentralIso(), 7)
    const rs = sched.rangeStart.value
    const re = sched.rangeEnd.value
    if (!rs || !re || from < rs || to > re) {
      await sched.loadRange(rs && rs < from ? rs : from, re && re > to ? re : to)
    }
    if (sched.canEdit.value) void sched.loadRequests()
  })()
  void cmd.load()
})

const today = todayCentralIso()
const model = computed(() => sched.dayModel(today))

/* ── on duty now, with credential-coverage flags ─────────────────────
   AEMT-led or P1-as-highest trucks get the "respond along" flag — the
   supervisor should ride in on more of those units' calls. */
const RANK = ['EC', 'EMT', 'EMT-FTO', 'AEMT', 'AEMT-FTO', 'P1C', 'P1', 'P2', 'P2-FTO', 'P3', 'P3-FTO', 'P4', 'Supervisor', 'CDO', 'Assistant Chief', 'Chief']
const P2_RANK = RANK.indexOf('P2')

function nowHHMM(): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  return `${p.find((x) => x.type === 'hour')?.value}${p.find((x) => x.type === 'minute')?.value}`
}

/** Minutes past 0600 (the schedule day's origin), wrapping overnight. */
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

interface DutyRow {
  unit: string
  people: { name: string; credential: string | null }[]
  open: string | null
  flag: 'aemt' | 'p1' | null
}

interface DutySide {
  key: 'north' | 'south'
  label: string
  note: string | null
  sup: string | null
  rows: DutyRow[]
}

function sideOf(station: string | null | undefined): 'north' | 'south' | null {
  if (!station) return null
  if (station.includes('201')) return 'north'
  if (station.includes('202')) return 'south'
  return null
}

const onDuty = computed<DutySide[]>(() => {
  const probe = nowHHMM()
  const sides: Record<'north' | 'south', DutySide> = {
    north: { key: 'north', label: 'North — S201', note: 'M243 joins in January', sup: null, rows: [] },
    south: { key: 'south', label: 'South — S202', note: null, sup: null, rows: [] },
  }
  for (const um of model.value.units) {
    const side = sideOf(um.unit.station)
    if (!side) continue
    if (um.unit.code.startsWith('S')) {
      const row = um.seats[0]?.rows.find((r) => !r.open && r.userId && covers(r.start, r.end, probe))
      sides[side].sup = row?.name ?? null
      continue
    }
    const people: DutyRow['people'] = []
    let open: string | null = null
    for (const sm of um.seats) {
      for (const r of sm.rows) {
        if (!covers(r.start, r.end, probe)) continue
        if (r.open) open = `${sm.seat.label} open ${r.start}–${r.end}`
        else if (r.userId) people.push({ name: r.name, credential: r.credential })
      }
    }
    for (const ex of um.extras) {
      if (ex.open || !ex.userId) continue
      if (covers(ex.start, ex.end, probe)) {
        /* Riders show THEIR credential (a NEOP medic rider is a P1C),
           falling back to Student for program students. */
        const cred =
          sched.personById.value.get(ex.userId)?.credential ??
          (ex.kind === 'student' ? 'Student' : null)
        people.push({ name: ex.name, credential: cred })
      }
    }
    const ranks = people
      .map((p) => RANK.indexOf(p.credential ?? ''))
      .filter((i) => i >= 0)
    const top = ranks.length ? Math.max(...ranks) : -1
    let flag: DutyRow['flag'] = null
    if (people.length && top >= 0 && top < P2_RANK) {
      const topName = RANK[top]
      if (topName === 'AEMT' || topName === 'AEMT-FTO') flag = 'aemt'
      else if (topName === 'P1' || topName === 'P1C') flag = 'p1'
    }
    sides[side].rows.push({ unit: um.unit.code, people, open, flag })
  }
  return [sides.north, sides.south]
})

/* ── handoff notes ──────────────────────────────────────────────── */
const noteText = ref('')
const noteBusy = ref(false)
const noteErr = ref<string | null>(null)
async function postNote() {
  if (noteBusy.value || !noteText.value.trim()) return
  noteBusy.value = true
  noteErr.value = await cmd.addNote(noteText.value)
  noteBusy.value = false
  if (!noteErr.value) noteText.value = ''
}
function canManageNote(n: CommandNote): boolean {
  return auth.isAdmin || n.authorId === auth.appUser?.id
}
function fmtNote(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/* ── daily summary status (an 'all' summary covers both sides) ────── */
const northToday = computed(() => cmd.coverageFor(today, 'north'))
const southToday = computed(() => cmd.coverageFor(today, 'south'))
async function openPdf(path: string | null) {
  if (!path) return
  const url = await cmd.pdfUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}

/* ── fleet editor (admins only — vehicles managed in-app) ─────────── */
const manageFleet = ref(false)
const newVehicle = ref('')
const fleetErr = ref<string | null>(null)
const fleetBusy = ref(false)
async function onAddVehicle() {
  if (fleetBusy.value || !newVehicle.value.trim()) return
  fleetBusy.value = true
  fleetErr.value = await cmd.addFleetVehicle(newVehicle.value)
  fleetBusy.value = false
  if (!fleetErr.value) newVehicle.value = ''
}
async function onToggleVehicle(id: string, active: boolean) {
  if (fleetBusy.value) return
  fleetBusy.value = true
  fleetErr.value = await cmd.setFleetActive(id, active)
  fleetBusy.value = false
}

/* ── latest fleet status from the most recent submitted summaries ── */
const latestFleet = computed(() => {
  const seen = new Map<string, Partial<import('@/composables/useCommand').FleetStatusRow>>()
  for (const s of [...cmd.summaries.value].sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))) {
    if (s.status !== 'submitted') continue
    for (const [veh, f] of Object.entries(s.data.fleet ?? {})) {
      if (!seen.has(veh)) seen.set(veh, f)
    }
  }
  return cmd.fleet.value.map((v) => {
    const prev = seen.get(v.label)
    const row = prev
      ? normalizeFleetRow(prev)
      : normalizeFleetRow({ status: v.homeOos ? 'oos' : 'in_service', location: v.homeLocation, notes: v.homeNote })
    return { label: v.label, ...row }
  })
})
const fleetKnown = computed(() => latestFleet.value)
const fleetCounts = computed(() => {
  const rows = latestFleet.value
  const inService = rows.filter((r) => r.status === 'in_service').length
  const reserve = rows.filter((r) => r.status === 'in_service' && r.role === 'reserve').length
  const oos = rows.filter((r) => r.status === 'oos').length
  return { inService, reserve, oos }
})

/* ── follow up with your crew (Required Training, on-shift people) ── */
const followUps = computed(() => {
  const ids = new Set<string>()
  for (const s of onDuty.value) for (const r of s.rows) for (const p of r.people) {
    const match = sched.people.value.find((x) => x.fullName === p.name)
    if (match) ids.add(match.id)
  }
  const out: { module: string; rows: { name: string; need: 'video' | 'test' }[] }[] = []
  for (const t of rt.trainings.value.filter((x) => x.active && !x.audienceEventLabel)) {
    const comps = rt.completionsFor(t.id)
    const rows: { name: string; need: 'video' | 'test' }[] = []
    for (const uid of ids) {
      const p = sched.people.value.find((x) => x.id === uid)
      if (!p) continue
      const required = rt.isRequiredForUser(t, {
        id: p.id,
        role: (p.role ?? 'crew') as never,
        shift: (p.shift ?? null) as never,
        employmentType: (p.employmentType ?? 'full_time') as never,
      })
      if (!required) continue
      const c = comps.find((x) => x.userId === uid) ?? null
      const hasQuiz = rt.quizConfigFor(t) !== null
      if (!c?.attestationSigned) rows.push({ name: p.fullName, need: 'video' })
      else if (hasQuiz && c.quizScore == null) rows.push({ name: p.fullName, need: 'test' })
    }
    if (rows.length) out.push({ module: t.title, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) })
  }
  return out
})

/* ── trainees riding today ─────────────────────────────────────────── */
const trainees = computed(() => {
  const out: { unit: string; name: string; withWhom: string }[] = []
  for (const um of model.value.units) {
    if (um.unit.code.startsWith('S')) continue
    /* Pair with the FTO on the truck (any seat) — e.g. Lani rides with
       the EMT-FTO attendant, not the medic in charge. Fallback: seat 1. */
    const crew = um.seats.flatMap((sm) => sm.rows.filter((r) => !r.open && r.userId))
    const fto = crew.find((r) => (r.credential ?? '').includes('FTO'))
    const lead = fto ?? um.seats[0]?.rows.find((r) => !r.open && r.userId)
    for (const ex of um.extras) {
      if (ex.open || !ex.userId) continue
      out.push({ unit: um.unit.code, name: ex.name, withWhom: lead?.name ?? um.unit.code })
    }
  }
  return out
})

/* ── open seats, next 7 days ──────────────────────────────────────── */
const openWeek = computed(() => {
  const out: { iso: string; label: string; items: string[] }[] = []
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(today, i)
    const m = sched.dayModel(iso)
    const items: string[] = []
    for (const um of m.units) {
      for (const sm of um.seats) {
        for (const r of sm.rows) {
          if (r.open) items.push(`${um.unit.code} · ${sm.seat.label} · ${r.start}–${r.end}`)
        }
      }
      for (const ex of um.extras) {
        if (ex.open) items.push(`${um.unit.code} · ${ex.posLabel ?? 'Rider'} (extra) · ${ex.start}–${ex.end}`)
      }
    }
    if (items.length) {
      out.push({
        iso,
        label: new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        items,
      })
    }
  }
  return out
})

/* ── chief-only approvals (schedule editors) ──────────────────────── */
const approvals = computed(() => {
  if (!sched.canEdit.value) return null
  const pend = sched.requests.value.filter((r) => r.status === 'pending' || r.status === 'partner_accepted')
  return {
    trades: pend.filter((r) => r.type === 'trade').length,
    timeOff: pend.filter((r) => r.type === 'time_off').length,
    pickups: pend.filter((r) => r.type === 'pickup' || r.type === 'giveaway' || r.type === 'extra_hours').length,
  }
})

const openToday = computed(() => model.value.openCount)
const summariesFiled = computed(() => {
  const n = !!northToday.value
  const so = !!southToday.value
  return { done: (n ? 1 : 0) + (so ? 1 : 0), total: 2 }
})
const followUpCount = computed(() => followUps.value.reduce((t, f) => t + f.rows.length, 0))

const shiftLetter = computed(() => model.value.platoon)
const todayLabel = new Date(`${today}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
</script>

<template>
  <div class="cmd">
    <header class="cmd__head">
      <div class="flex items-center gap-2">
        <Radio :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display cmd__title">Command</h1>
      </div>
      <p class="cmd__sub">{{ todayLabel }} · <b>{{ shiftLetter }} Shift</b> on duty</p>
    </header>

    <div v-if="!auth.isSupervisor" class="cmd__gate">Command staff only.</div>

    <template v-else>
      <CommandNav />
      <p v-if="cmd.loadError.value" class="cmd__err">{{ cmd.loadError.value }}</p>

      <!-- Vitals band -->
      <div class="cmd__stats cmd__reveal">
        <div class="cmd__stat">
          <span class="cmd__stat-eyebrow">Open seats today</span>
          <span class="cmd__stat-num" :class="{ 'cmd__stat-num--bad': openToday > 0 }">{{ openToday }}</span>
          <span class="cmd__stat-sub">{{ openToday === 0 ? 'fully covered' : 'need coverage' }}</span>
        </div>
        <div class="cmd__stat">
          <span class="cmd__stat-eyebrow">Daily summaries</span>
          <span class="cmd__stat-num" :class="{ 'cmd__stat-num--bad': summariesFiled.done < summariesFiled.total }">{{ summariesFiled.done }}<small>/{{ summariesFiled.total }}</small></span>
          <span class="cmd__stat-sub">filed for today</span>
        </div>
        <div class="cmd__stat">
          <span class="cmd__stat-eyebrow">Fleet</span>
          <span class="cmd__stat-num">{{ fleetCounts.inService }}</span>
          <span class="cmd__stat-sub">in service · {{ fleetCounts.reserve }} reserve · {{ fleetCounts.oos }} OOS</span>
        </div>
        <div class="cmd__stat">
          <span class="cmd__stat-eyebrow">Crew follow-ups</span>
          <span class="cmd__stat-num" :class="{ 'cmd__stat-num--warn': followUpCount > 0 }">{{ followUpCount }}</span>
          <span class="cmd__stat-sub">open items on shift</span>
        </div>
      </div>

      <!-- On duty now -->
      <section class="cmd__sec cmd__reveal" style="animation-delay: 60ms">
        <div class="cmd__sec-h">
          <h2 class="display">On duty now</h2>
          <span class="cmd__hint">live from the schedule · flags mark units the supervisor should respond with more often</span>
        </div>
        <div class="cmd__cols">
          <div v-for="s in onDuty" :key="s.key" class="cmd__board">
            <div class="cmd__shead">
              <span class="cmd__shead-side">{{ s.label }}</span>
              <span v-if="s.note" class="cmd__shead-note">· {{ s.note }}</span>
              <span class="cmd__spacer"></span>
              <span class="cmd__shead-sup"><b>{{ s.sup ?? '—' }}</b> · Supervisor</span>
            </div>
            <div class="cmd__rows">
              <div v-for="r in s.rows" :key="r.unit" class="cmd__row">
                <span class="cmd__unit">{{ r.unit }}</span>
                <span class="cmd__who">
                  <template v-for="(p, i) in r.people" :key="i"><template v-if="i"><span class="cmd__sep">·</span></template><b>{{ p.name }}</b><span v-if="p.credential" class="cmd__pcred"> – {{ p.credential }}</span></template>
                  <span v-if="!r.people.length" class="cmd__muted">—</span>
                  <span v-if="r.flag === 'aemt'" class="cmd__flag cmd__flag--warn" title="Respond along with this unit more often"><span class="cmd__dot cmd__dot--warn"></span>AEMT-led</span>
                  <span v-else-if="r.flag === 'p1'" class="cmd__flag cmd__flag--bad" title="Respond along with this unit more often"><span class="cmd__dot cmd__dot--bad"></span>P1-led</span>
                  <span v-if="r.open" class="cmd__open">{{ r.open }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="cmd__cols">
        <!-- Handoff -->
        <section class="cmd__sec cmd__reveal" style="animation-delay: 120ms">
          <div class="cmd__sec-h"><h2 class="display">Shift handoff</h2><span class="cmd__hint">visible to all command staff</span></div>
          <div v-for="n in cmd.notes.value" :key="n.id" class="cmd__note" :class="{ 'cmd__note--pinned': n.pinned }">
            <span v-if="n.pinned" class="cmd__pintag">PINNED</span>
            {{ n.note }}
            <div class="cmd__note-meta">
              {{ n.authorName }} · {{ fmtNote(n.createdAt) }}
              <template v-if="canManageNote(n)">
                <button class="cmd__mini" :title="n.pinned ? 'Unpin' : 'Pin'" @click="cmd.togglePin(n)"><Pin :size="11" :stroke-width="2" /></button>
                <button class="cmd__mini" title="Delete" @click="cmd.deleteNote(n.id)"><Trash2 :size="11" :stroke-width="2" /></button>
              </template>
            </div>
          </div>
          <div class="cmd__notein">
            <input v-model="noteText" placeholder="Leave a note for the oncoming supervisor…" @keydown.enter="postNote" />
            <button class="cmd__btn cmd__btn--primary" :disabled="noteBusy || !noteText.trim()" @click="postNote">Post</button>
          </div>
          <p v-if="noteErr" class="cmd__err">{{ noteErr }}</p>
        </section>

        <!-- Daily summary + trainees -->
        <section class="cmd__sec cmd__reveal" style="animation-delay: 150ms">
          <div class="cmd__sec-h"><h2 class="display">Daily Summary</h2><span class="cmd__hint">one per side · county-wide covers both</span></div>
          <div class="cmd__sumrow">
            <b>North</b>
            <template v-if="northToday">
              <span class="cmd__dot cmd__dot--ok"></span>
              <span>Filed{{ northToday.side === 'all' ? ' (county-wide)' : '' }}</span>
              <span class="cmd__spacer"></span>
              <button v-if="northToday.pdfPath" class="cmd__link" @click="openPdf(northToday.pdfPath)">PDF</button>
            </template>
            <template v-else>
              <span class="cmd__dot cmd__dot--bad"></span>
              <span class="cmd__due">Not filed yet</span>
              <span class="cmd__spacer"></span>
              <RouterLink class="cmd__btn cmd__btn--gold" :to="`/command/daily-summary?side=north`">Start</RouterLink>
            </template>
          </div>
          <div class="cmd__sumrow">
            <b>South</b>
            <template v-if="southToday">
              <span class="cmd__dot cmd__dot--ok"></span>
              <span>Filed{{ southToday.side === 'all' ? ' (county-wide)' : '' }}</span>
              <span class="cmd__spacer"></span>
              <button v-if="southToday.pdfPath" class="cmd__link" @click="openPdf(southToday.pdfPath)">PDF</button>
            </template>
            <template v-else>
              <span class="cmd__dot cmd__dot--bad"></span>
              <span class="cmd__due">Not filed yet</span>
              <span class="cmd__spacer"></span>
              <RouterLink class="cmd__btn cmd__btn--gold" :to="`/command/daily-summary?side=south`">Start</RouterLink>
            </template>
          </div>

          <div class="cmd__sec-h" style="margin-top: 38px"><h2 class="display">Trainees riding today</h2></div>
          <div v-if="!trainees.length" class="cmd__muted" style="padding: 6px 2px">None scheduled today.</div>
          <div v-for="t in trainees" :key="t.unit + t.name" class="cmd__row">
            <span class="cmd__unit">{{ t.unit }}</span>
            <span class="cmd__who"><b>{{ t.name }}</b> with <b>{{ t.withWhom }}</b></span>
          </div>
        </section>
      </div>

      <div class="cmd__cols">
        <!-- Fleet -->
        <section class="cmd__sec cmd__reveal" style="animation-delay: 200ms">
          <div class="cmd__sec-h">
            <h2 class="display">Fleet</h2>
            <span class="cmd__hint">as of the last Daily Summary</span>
            <button v-if="auth.isAdmin" type="button" class="cmd__manage" @click="manageFleet = !manageFleet">
              {{ manageFleet ? 'Done' : 'Manage fleet' }}
            </button>
          </div>

          <div v-if="manageFleet && auth.isAdmin" class="cmd__fleetmgr">
            <div v-for="v in cmd.fleetAll.value" :key="v.id" class="cmd__fleetrow" :class="{ 'cmd__fleetrow--off': !v.active }">
              <span class="cmd__fleetname">{{ v.label }}</span>
              <span v-if="!v.active" class="cmd__count">archived</span>
              <span class="cmd__spacer"></span>
              <button type="button" class="cmd__link" :disabled="fleetBusy" @click="onToggleVehicle(v.id, !v.active)">
                {{ v.active ? 'Archive' : 'Restore' }}
              </button>
            </div>
            <div class="cmd__fleetadd">
              <input v-model="newVehicle" placeholder="New vehicle # or name (e.g. 8752)" @keydown.enter="onAddVehicle" />
              <button type="button" class="cmd__btn" :disabled="fleetBusy || !newVehicle.trim()" @click="onAddVehicle">Add</button>
            </div>
            <p v-if="fleetErr" class="cmd__err">{{ fleetErr }}</p>
            <p class="cmd__muted" style="font-size: 11px; margin: 4px 0 8px">
              Archived vehicles disappear from new Daily Summaries; history keeps them.
            </p>
          </div>

          <div v-if="!fleetKnown.length" class="cmd__muted" style="padding: 6px 2px">No summary filed yet — the board fills in as summaries come in.</div>
          <div class="cmd__tablebox" v-else>
            <table class="cmd__table">
              <thead><tr><th>Vehicle</th><th>Status</th><th>Location</th><th>Role</th><th>Notes</th></tr></thead>
              <tbody>
                <tr v-for="f in fleetKnown" :key="f.label" :class="{ 'cmd__oos': f.status === 'oos' }">
                  <td><b>{{ f.label }}</b></td>
                  <td><span class="cmd__dot" :class="f.status === 'oos' ? 'cmd__dot--bad' : 'cmd__dot--ok'"></span> {{ f.status === 'oos' ? 'OOS' : 'In service' }}</td>
                  <td>{{ f.location || '—' }}</td>
                  <td class="cmd__rolecell">{{ f.role === 'main' ? 'Main' : f.role === 'reserve' ? 'Reserve' : '—' }}</td>
                  <td>{{ f.notes || '' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="cmd__fleetcount">
              {{ fleetCounts.inService }} in service · {{ fleetCounts.reserve }} reserve ready · {{ fleetCounts.oos }} OOS
            </p>
          </div>
        </section>

        <!-- Follow up -->
        <section class="cmd__sec cmd__reveal" style="animation-delay: 230ms">
          <div class="cmd__sec-h"><h2 class="display">Follow up with your crew</h2><span class="cmd__hint">on-shift people with open items</span></div>
          <div v-if="!followUps.length" class="cmd__muted" style="padding: 6px 2px">Everyone on shift is caught up. 🎯</div>
          <div v-for="f in followUps" :key="f.module" class="cmd__fu">
            <div class="cmd__fu-h">{{ f.module }} <span class="cmd__count">({{ f.rows.length }})</span></div>
            <div v-for="r in f.rows" :key="r.name" class="cmd__fu-row">
              <span class="cmd__fu-name">{{ r.name }}</span>
              <span class="cmd__fu-need" :class="r.need === 'video' ? 'cmd__fu-need--bad' : 'cmd__fu-need--warn'">
                <span class="cmd__dot" :class="r.need === 'video' ? 'cmd__dot--bad' : 'cmd__dot--warn'"></span>
                {{ r.need === 'video' ? 'video & sign-off' : 'knowledge test' }}
              </span>
            </div>
          </div>
          <p style="margin: 10px 0 0"><RouterLink class="cmd__link" to="/training/required">Full completion rosters →</RouterLink></p>

          <div v-if="approvals" class="cmd__chief" style="margin-top: 26px">
            <span class="cmd__tagline" style="float: right">SCHEDULE EDITORS</span>
            <b>Awaiting approval</b>
            <div class="cmd__sumrow"><span>Shift trades</span><span class="cmd__spacer"></span><b>{{ approvals.trades }}</b></div>
            <div class="cmd__sumrow"><span>Time off</span><span class="cmd__spacer"></span><b>{{ approvals.timeOff }}</b></div>
            <div class="cmd__sumrow" style="border: 0"><span>Pickups & giveaways</span><span class="cmd__spacer"></span><b>{{ approvals.pickups }}</b></div>
            <RouterLink class="cmd__link" to="/schedule?v=requests">Open the request queue →</RouterLink>
          </div>

          <div v-if="openWeek.length" style="margin-top: 38px">
            <div class="cmd__sec-h">
              <h2 class="display" style="font-size: 17px">Open seats — next 7 days</h2>
              <RouterLink class="cmd__link" style="margin-left: auto" to="/schedule?v=pages">Page-out screen →</RouterLink>
            </div>
            <div v-for="o in openWeek" :key="o.iso" class="cmd__openday">
              <RouterLink class="cmd__openday-d" :to="`/schedule?v=day&d=${o.iso}`">{{ o.label }}</RouterLink>
              <div class="cmd__openday-items">
                <span v-for="(it, i) in o.items" :key="i" class="cmd__openitem">{{ it }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cmd { max-width: 1120px; margin: 0 auto; padding: 24px 16px 96px; }
@media (min-width: 768px) { .cmd { padding: 36px 40px 96px; } }

.cmd__reveal { opacity: 0; transform: translateY(6px); animation: cmd-reveal 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
@keyframes cmd-reveal { to { opacity: 1; transform: translateY(0); } }

.cmd__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 18px 0;
  margin: 10px 0 8px;
}
.cmd__stat { display: flex; flex-direction: column; gap: 3px; padding: 2px 22px; border-left: 1px solid var(--color-line); min-width: 0; }
.cmd__stat:first-child { border-left: 0; padding-left: 2px; }
.cmd__stat-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-muted); }
.cmd__stat-num { font-family: var(--font-display, inherit); font-size: 34px; line-height: 1.05; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.cmd__stat-num small { font-size: 20px; color: var(--color-muted); }
.cmd__stat-num--bad { color: var(--color-danger-500); }
.cmd__stat-num--warn { color: oklch(0.5 0.12 70); }
.cmd__stat-sub { font-size: 11.5px; color: var(--color-muted); }
.cmd__head { margin-bottom: 10px; }
.cmd__title { font-size: 26px; margin: 0; }
.cmd__sub { margin: 2px 0 14px; font-size: 13px; color: var(--color-muted); }
.cmd__gate { margin-top: 24px; padding: 28px; text-align: center; font-size: 13px; color: var(--color-muted); border: 1px dashed var(--color-line); border-radius: 12px; }
.cmd__err { color: var(--color-danger-500); font-size: 12.5px; }

.cmd__sec { margin-top: 42px; min-width: 0; }
.cmd__sec-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; border-bottom: 1.5px solid var(--color-ink); padding-bottom: 5px; margin-bottom: 14px; }
.cmd__sec-h h2 { margin: 0; font-size: 19px; font-weight: 400; }
.cmd__hint { font-size: 11.5px; color: var(--color-muted); }
.cmd__cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0 60px; }

.cmd__board { margin-top: 14px; min-width: 0; }
.cmd__shead { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; border-bottom: 1.5px solid var(--color-ink); padding-bottom: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; color: var(--color-muted); text-transform: uppercase; }
.cmd__shead-side { color: var(--color-ink); }
.cmd__shead-note { font-weight: 500; letter-spacing: 0.02em; text-transform: none; }
.cmd__shead-sup { font-weight: 500; letter-spacing: 0.02em; text-transform: none; font-size: 12px; color: var(--color-ink-soft, var(--color-ink)); }
.cmd__shead-sup b { font-weight: 700; color: var(--color-ink); }
.cmd__rows .cmd__row:nth-child(even) { background: var(--color-surface-soft); }
.cmd__row { display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: center; gap: 4px 10px; padding: 8px 8px 8px 4px; font-size: 13px; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); }
.cmd__sep { color: var(--color-muted); margin: 0 6px; }
.cmd__unit { font-weight: 800; }
.cmd__who { color: var(--color-ink-soft, var(--color-ink)); }
.cmd__who b { font-weight: 600; color: var(--color-ink); }
.cmd__pcred { font-size: 11px; color: var(--color-muted); white-space: nowrap; }
.cmd__open { font-size: 11.5px; font-weight: 700; color: var(--color-danger-500); margin-left: 8px; }
.cmd__openday { display: grid; grid-template-columns: 110px 1fr; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--color-line); font-size: 12.5px; align-items: start; }
.cmd__openday-d { font-weight: 700; color: var(--color-ink); text-decoration: none; }
.cmd__openday-d:hover { text-decoration: underline; }
.cmd__openday-items { display: flex; flex-direction: column; gap: 3px; }
.cmd__openitem { color: var(--color-danger-500); font-weight: 600; }
.cmd__muted { color: var(--color-muted); font-size: 12.5px; }

.cmd__flag { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; margin-left: 10px; white-space: nowrap; }
.cmd__flag--warn { color: oklch(0.5 0.12 70); }
.cmd__flag--bad { color: oklch(0.5 0.17 25); }
.cmd__dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: oklch(0.85 0.006 255); }
.cmd__dot--ok { background: oklch(0.55 0.13 150); }
.cmd__dot--warn { background: oklch(0.65 0.12 70); }
.cmd__dot--bad { background: oklch(0.55 0.17 25); }

.cmd__note { border-left: 3px solid var(--color-gold-500, #c9a227); background: var(--color-surface); border-radius: 0 9px 9px 0; padding: 8px 12px; margin: 8px 0; font-size: 13px; }
.cmd__note--pinned { border-left-color: var(--color-brand-700, var(--color-brand-600)); }
.cmd__pintag { display: block; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; color: var(--color-gold-600, #a8861d); }
.cmd__note-meta { font-size: 10.5px; color: var(--color-muted); margin-top: 3px; display: flex; align-items: center; gap: 7px; }
.cmd__mini { background: none; border: 0; color: var(--color-muted); cursor: pointer; padding: 1px; display: inline-flex; }
.cmd__mini:hover { color: var(--color-ink); }
.cmd__notein { display: flex; gap: 8px; margin-top: 10px; }
.cmd__notein input { flex: 1; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink); padding: 8px 10px; font: 13px inherit; font-family: inherit; }

.cmd__sumrow { display: flex; align-items: center; gap: 9px; padding: 8px 2px; border-bottom: 1px solid var(--color-line); font-size: 13px; }
.cmd__spacer { flex: 1; }
.cmd__due { color: var(--color-danger-500); font-weight: 600; }

.cmd__btn { font: 600 12px inherit; font-family: inherit; border-radius: 6px; padding: 6px 12px; cursor: pointer; border: 1px solid var(--color-line); background: var(--color-surface); color: var(--color-ink); text-decoration: none; }
.cmd__btn--primary { background: var(--color-brand-600); border-color: var(--color-brand-600); color: #fff; }
.cmd__btn--gold { background: var(--color-gold-100, #f3e9c9); border-color: var(--color-gold-500, #c9a227); color: var(--color-ink); }
.cmd__link { background: none; border: 0; padding: 0; color: var(--color-brand-700, var(--color-brand-600)); font: 600 12px inherit; font-family: inherit; cursor: pointer; text-decoration: underline; }

.cmd__manage { margin-left: auto; font: 600 11.5px inherit; font-family: inherit; border: 1px solid var(--color-line); border-radius: 6px; background: var(--color-surface); color: var(--color-ink-soft, var(--color-ink)); padding: 3px 9px; cursor: pointer; }
.cmd__manage:hover { border-color: var(--color-brand-600); }
.cmd__fleetmgr { border: 1px dashed var(--color-line); border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
.cmd__fleetrow { display: flex; align-items: center; gap: 9px; padding: 5px 0; border-bottom: 1px solid var(--color-line); font-size: 13px; }
.cmd__fleetrow--off .cmd__fleetname { color: var(--color-muted); text-decoration: line-through; }
.cmd__fleetname { font-weight: 600; }
.cmd__fleetadd { display: flex; gap: 8px; margin-top: 9px; }
.cmd__fleetadd input { flex: 1; border: 1px solid var(--color-line); border-radius: 5px; background: var(--color-surface); color: var(--color-ink); padding: 7px 10px; font: 13px inherit; font-family: inherit; }

.cmd__tablebox { overflow-x: auto; }
.cmd__table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.cmd__table th { text-align: left; font-size: 10px; letter-spacing: 0.1em; color: var(--color-muted); font-weight: 700; padding: 5px 8px; border-bottom: 1.5px solid var(--color-line); white-space: nowrap; }
.cmd__table td { padding: 6px 8px; border-bottom: 1px solid var(--color-line); }
.cmd__oos td { background: oklch(0.96 0.025 25 / 0.5); }

.cmd__fu { margin-bottom: 14px; }
.cmd__fu-h { font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--color-line); padding: 4px 0 5px; }
.cmd__fu-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 4px; font-size: 12.5px; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); }
.cmd__fu-row:nth-child(odd) { background: var(--color-surface-soft); }
.cmd__fu-name { color: var(--color-ink); font-weight: 500; }
.cmd__fu-need { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.cmd__fu-need--bad { color: oklch(0.5 0.17 25); }
.cmd__fu-need--warn { color: oklch(0.5 0.12 70); }
.cmd__count { font-size: 11px; font-weight: 600; color: var(--color-muted); }
.cmd__tagline { font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-muted); }
.cmd__rolecell { font-variant-numeric: tabular-nums; }
.cmd__fleetcount { margin: 7px 0 0; font-size: 11.5px; color: var(--color-muted); font-weight: 600; }
.cmd__chief { border: 1.5px solid var(--color-gold-500, #c9a227); border-radius: 11px; background: var(--color-surface); padding: 12px 14px; margin-top: 18px; font-size: 13px; }
</style>
