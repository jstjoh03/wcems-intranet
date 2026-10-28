<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Plus,
  Users,
  X,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { useSkillsDay } from '@/composables/useSkillsDay'
import type { SkillsCheckoffSection, SkillsDayCandidate } from '@/types'

/**
 * Skills Day Setup (admin): create and schedule Skills Days (which
 * stations run on which date, who attends, per-trainee station
 * scoping), manage the station definitions themselves (create, edit
 * requirements, retire), and the extra-evaluator grant list.
 */

const auth = useAuthStore()
const {
  checkoffs,
  allCheckoffs,
  evaluations,
  candidates,
  days,
  dayStationIds,
  dayCandidates,
  evaluatorIds,
  nameFor,
  peopleNames,
  saveDayFull,
  deleteDay,
  saveCheckoff,
  deleteCheckoff,
  addEvaluator,
  removeEvaluator,
} = useSkillsDay()

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function titleFor(userId: string): string | null {
  return candidates.value.find((c) => c.id === userId)?.title ?? null
}

/* ── People picker (any active employee) ────────────────────────── */
const allPeople = ref<{ id: string; fullName: string }[]>([])
let peopleLoaded = false
async function loadPeople() {
  if (peopleLoaded) return
  peopleLoaded = true
  if (auth.usingDevStub) {
    allPeople.value = Object.entries(peopleNames.value)
      .map(([id, fullName]) => ({ id, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
    return
  }
  const { data } = await supabase
    .from('app_users')
    .select('id, full_name')
    .eq('active', true)
    .eq('account_type', 'person')
    .order('full_name')
  allPeople.value = (data ?? []).map((r) => ({ id: r.id, fullName: r.full_name }))
}

/* ── Skills Days ─────────────────────────────────────────────────── */
interface DayDraft {
  id?: string
  onDate: string
  label: string
  note: string
  active: boolean
  stationIds: string[]
  roster: SkillsDayCandidate[]
}
const dayDraft = ref<DayDraft | null>(null)
const daySaving = ref(false)
const dayError = ref<string | null>(null)
const dayDeleteArmed = ref(false)
const scopeOpenFor = ref<string | null>(null)
const traineeSearch = ref('')

function newDay() {
  dayError.value = null
  dayDeleteArmed.value = false
  scopeOpenFor.value = null
  traineeSearch.value = ''
  dayDraft.value = {
    onDate: '',
    label: '',
    note: '',
    active: true,
    stationIds: [],
    roster: [],
  }
  void loadPeople()
}

function editDay(dayId: string) {
  const d = days.value.find((x) => x.id === dayId)
  if (!d) return
  dayError.value = null
  dayDeleteArmed.value = false
  scopeOpenFor.value = null
  traineeSearch.value = ''
  dayDraft.value = {
    id: d.id,
    onDate: d.onDate,
    label: d.label,
    note: d.note,
    active: d.active,
    stationIds: [...(dayStationIds.value[d.id] ?? [])],
    roster: (dayCandidates.value[d.id] ?? []).map((c) => ({
      userId: c.userId,
      stationIds: c.stationIds ? [...c.stationIds] : null,
    })),
  }
  void loadPeople()
}

const traineeMatches = computed(() => {
  const q = traineeSearch.value.trim().toLowerCase()
  if (!q || !dayDraft.value) return []
  const taken = new Set(dayDraft.value.roster.map((r) => r.userId))
  return allPeople.value
    .filter((p) => p.fullName.toLowerCase().includes(q) && !taken.has(p.id))
    .slice(0, 6)
})

const cohortToAdd = computed(() => {
  if (!dayDraft.value) return []
  const taken = new Set(dayDraft.value.roster.map((r) => r.userId))
  return candidates.value.filter((c) => !taken.has(c.id))
})

function addTrainee(userId: string) {
  if (!dayDraft.value) return
  if (dayDraft.value.roster.some((r) => r.userId === userId)) return
  dayDraft.value.roster.push({ userId, stationIds: null })
  traineeSearch.value = ''
}

function addCohort() {
  for (const c of cohortToAdd.value) addTrainee(c.id)
}

function removeTrainee(userId: string) {
  if (!dayDraft.value) return
  dayDraft.value.roster = dayDraft.value.roster.filter((r) => r.userId !== userId)
  if (scopeOpenFor.value === userId) scopeOpenFor.value = null
}

/* Per-trainee station scoping: null = everything that day. */
function scopeSummary(r: SkillsDayCandidate): string {
  if (!dayDraft.value) return ''
  if (r.stationIds === null) return 'All stations'
  const n = r.stationIds.filter((id) => dayDraft.value!.stationIds.includes(id)).length
  return `${n} of ${dayDraft.value.stationIds.length} stations`
}

function toggleScopeStation(r: SkillsDayCandidate, checkoffId: string) {
  if (!dayDraft.value) return
  if (r.stationIds === null) {
    /* Switching from "all" to a limited set: start from everything
       scheduled, minus the one tapped. */
    r.stationIds = dayDraft.value.stationIds.filter((id) => id !== checkoffId)
    return
  }
  r.stationIds = r.stationIds.includes(checkoffId)
    ? r.stationIds.filter((id) => id !== checkoffId)
    : [...r.stationIds, checkoffId]
}

function scopeHas(r: SkillsDayCandidate, checkoffId: string): boolean {
  return r.stationIds === null || r.stationIds.includes(checkoffId)
}

function clearScope(r: SkillsDayCandidate) {
  r.stationIds = null
}

async function onSaveDay() {
  if (!dayDraft.value || daySaving.value) return
  dayError.value = null
  if (!dayDraft.value.onDate) {
    dayError.value = 'Pick a date for this Skills Day.'
    return
  }
  daySaving.value = true
  const res = await saveDayFull({
    id: dayDraft.value.id,
    onDate: dayDraft.value.onDate,
    label: dayDraft.value.label.trim(),
    note: dayDraft.value.note.trim(),
    active: dayDraft.value.active,
    stationIds: dayDraft.value.stationIds,
    candidates: dayDraft.value.roster,
  })
  daySaving.value = false
  if (!res.ok) {
    dayError.value = res.error ?? 'Save failed.'
    return
  }
  dayDraft.value = null
}

async function onDeleteDay() {
  if (!dayDraft.value?.id) return
  if (!dayDeleteArmed.value) {
    dayDeleteArmed.value = true
    return
  }
  const res = await deleteDay(dayDraft.value.id)
  if (!res.ok) {
    dayError.value = res.error ?? 'Delete failed.'
    dayDeleteArmed.value = false
    return
  }
  dayDraft.value = null
}

/* ── Stations ────────────────────────────────────────────────────── */
interface StationDraft {
  id?: string
  title: string
  subtitle: string
  note: string
  sort: number
  active: boolean
  sections: SkillsCheckoffSection[]
  equipmentText: string
}
const stationDraft = ref<StationDraft | null>(null)
const stationSaving = ref(false)
const stationError = ref<string | null>(null)
const stationDeleteArmed = ref(false)

function evalCountFor(checkoffId: string): number {
  return evaluations.value.filter((e) => e.checkoffId === checkoffId).length
}

function itemCount(sections: SkillsCheckoffSection[]): number {
  return sections.reduce((n, s) => n + s.items.length, 0)
}

function newStation() {
  stationError.value = null
  stationDeleteArmed.value = false
  stationDraft.value = {
    title: '',
    subtitle: '',
    note: '',
    sort: (allCheckoffs.value[allCheckoffs.value.length - 1]?.sort ?? 0) + 1,
    active: true,
    sections: [{ title: 'Check-off items', items: [] }],
    equipmentText: '',
  }
}

function editStation(checkoffId: string) {
  const c = allCheckoffs.value.find((x) => x.id === checkoffId)
  if (!c) return
  stationError.value = null
  stationDeleteArmed.value = false
  stationDraft.value = {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    note: c.note,
    sort: c.sort,
    active: c.active,
    sections: c.sections.map((s) => ({
      title: s.title,
      note: s.note,
      items: s.items.map((it) => ({ key: it.key, label: it.label })),
    })),
    equipmentText: (c.equipment ?? []).join('\n'),
  }
}

function addSection() {
  stationDraft.value?.sections.push({ title: '', items: [] })
}

function removeSection(idx: number) {
  stationDraft.value?.sections.splice(idx, 1)
}

function moveSection(idx: number, dir: -1 | 1) {
  const s = stationDraft.value?.sections
  if (!s) return
  const to = idx + dir
  if (to < 0 || to >= s.length) return
  const [row] = s.splice(idx, 1)
  s.splice(to, 0, row)
}

function addItem(sectionIdx: number) {
  stationDraft.value?.sections[sectionIdx]?.items.push({ key: '', label: '' })
}

function removeItem(sectionIdx: number, itemIdx: number) {
  stationDraft.value?.sections[sectionIdx]?.items.splice(itemIdx, 1)
}

function moveItem(sectionIdx: number, itemIdx: number, dir: -1 | 1) {
  const items = stationDraft.value?.sections[sectionIdx]?.items
  if (!items) return
  const to = itemIdx + dir
  if (to < 0 || to >= items.length) return
  const [row] = items.splice(itemIdx, 1)
  items.splice(to, 0, row)
}

/* New items get a stable key from their label; existing keys are
   never rewritten (recorded marks reference them). */
function finalizeSections(sections: SkillsCheckoffSection[]): SkillsCheckoffSection[] {
  const used = new Set<string>()
  for (const s of sections) for (const it of s.items) if (it.key) used.add(it.key)
  return sections
    .map((s) => ({
      title: s.title.trim() || 'Check-off items',
      ...(s.note?.trim() ? { note: s.note.trim() } : {}),
      items: s.items
        .filter((it) => it.label.trim())
        .map((it) => {
          if (it.key) return { key: it.key, label: it.label.trim() }
          const base =
            it.label
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 40) || 'item'
          let key = base
          let n = 2
          while (used.has(key)) key = `${base}_${n++}`
          used.add(key)
          return { key, label: it.label.trim() }
        }),
    }))
    .filter((s) => s.items.length > 0)
}

async function onSaveStation() {
  if (!stationDraft.value || stationSaving.value) return
  stationError.value = null
  if (!stationDraft.value.title.trim()) {
    stationError.value = 'Give the station a title.'
    return
  }
  const sections = finalizeSections(stationDraft.value.sections)
  if (!sections.length) {
    stationError.value = 'Add at least one check-off item.'
    return
  }
  stationSaving.value = true
  const equipment = stationDraft.value.equipmentText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const res = await saveCheckoff({
    id: stationDraft.value.id,
    title: stationDraft.value.title.trim(),
    subtitle: stationDraft.value.subtitle.trim(),
    note: stationDraft.value.note.trim(),
    sort: stationDraft.value.sort,
    active: stationDraft.value.active,
    sections,
    equipment: equipment.length ? equipment : null,
  })
  stationSaving.value = false
  if (!res.ok) {
    stationError.value = res.error ?? 'Save failed.'
    return
  }
  stationDraft.value = null
}

async function onDeleteStation() {
  if (!stationDraft.value?.id) return
  if (!stationDeleteArmed.value) {
    stationDeleteArmed.value = true
    return
  }
  const res = await deleteCheckoff(stationDraft.value.id)
  if (!res.ok) {
    stationError.value = res.error ?? 'Delete failed.'
    stationDeleteArmed.value = false
    return
  }
  stationDraft.value = null
}

/* ── Evaluator grants ────────────────────────────────────────────── */
const evaluatorSearch = ref('')
const evaluatorMatches = computed(() => {
  const q = evaluatorSearch.value.trim().toLowerCase()
  if (!q) return []
  return allPeople.value
    .filter(
      (p) => p.fullName.toLowerCase().includes(q) && !evaluatorIds.value.includes(p.id),
    )
    .slice(0, 6)
})
void loadPeople()
</script>

<template>
  <div class="sx">
    <!-- ══ Skills Days ══════════════════════════════════════════════ -->
    <section class="sx__section">
      <div class="sx__section-head">
        <h2 class="sx__section-title"><CalendarDays :size="14" :stroke-width="2" /> Skills Days</h2>
        <button v-if="!dayDraft" type="button" class="sx__add" @click="newDay">
          <Plus :size="13" :stroke-width="2.5" /> New Skills Day
        </button>
      </div>

      <!-- Day list -->
      <template v-if="!dayDraft">
        <p v-if="days.length === 0" class="sx__hint">
          No Skills Days scheduled yet. Create one, pick the stations that run that day,
          and assign the trainees attending — the board then shows exactly that day's
          stations.
        </p>
        <div v-else class="sx__list">
          <button
            v-for="d in days"
            :key="d.id"
            type="button"
            class="sx__row"
            :class="{ 'sx__row--off': !d.active }"
            @click="editDay(d.id)"
          >
            <div class="sx__row-main">
              <span class="sx__row-title">
                {{ fmtDate(d.onDate) }}<template v-if="d.label"> · {{ d.label }}</template>
              </span>
              <span class="sx__row-sub">
                {{ (dayStationIds[d.id] ?? []).length }} station{{
                  (dayStationIds[d.id] ?? []).length === 1 ? '' : 's'
                }}
                · {{ (dayCandidates[d.id] ?? []).length }} trainee{{
                  (dayCandidates[d.id] ?? []).length === 1 ? '' : 's'
                }}
              </span>
            </div>
            <span v-if="!d.active" class="sx__badge">Hidden</span>
            <span class="sx__row-edit">Edit</span>
          </button>
        </div>
      </template>

      <!-- Day editor -->
      <div v-else class="sx__editor">
        <div class="sx__grid2">
          <label class="sx__field">
            <span class="sx__label">Date</span>
            <input v-model="dayDraft.onDate" type="date" class="sx__input" />
          </label>
          <label class="sx__field">
            <span class="sx__label">Label</span>
            <input
              v-model="dayDraft.label"
              class="sx__input"
              placeholder="Session 1 — Morning rotation"
            />
          </label>
        </div>
        <label class="sx__field">
          <span class="sx__label">Note (optional)</span>
          <input v-model="dayDraft.note" class="sx__input" placeholder="Shown nowhere yet — internal" />
        </label>
        <label class="sx__check">
          <input v-model="dayDraft.active" type="checkbox" />
          Show this day on the board
        </label>

        <div class="sx__sub-head">Stations running this day</div>
        <p v-if="checkoffs.length === 0" class="sx__hint">No active stations defined yet.</p>
        <label v-for="c in checkoffs" :key="c.id" class="sx__check sx__check--row">
          <input v-model="dayDraft.stationIds" type="checkbox" :value="c.id" />
          <span>
            <strong>{{ c.title }}</strong>
            <em v-if="c.subtitle" class="sx__check-sub">{{ c.subtitle }}</em>
          </span>
        </label>

        <div class="sx__sub-head">Trainees attending</div>
        <p v-if="dayDraft.roster.length === 0" class="sx__hint">No one assigned yet.</p>
        <div v-for="r in dayDraft.roster" :key="r.userId" class="sx__trainee">
          <div class="sx__trainee-row">
            <span class="sx__trainee-name">
              {{ nameFor(r.userId) }}
              <em v-if="titleFor(r.userId)" class="sx__trainee-title">{{ titleFor(r.userId) }}</em>
            </span>
            <button
              type="button"
              class="sx__scope-btn"
              :class="{ 'sx__scope-btn--limited': r.stationIds !== null }"
              @click="scopeOpenFor = scopeOpenFor === r.userId ? null : r.userId"
            >
              {{ scopeSummary(r) }}
              <ChevronDown v-if="scopeOpenFor !== r.userId" :size="11" :stroke-width="2.5" />
              <ChevronUp v-else :size="11" :stroke-width="2.5" />
            </button>
            <button type="button" class="sx__x" title="Remove" @click="removeTrainee(r.userId)">
              <X :size="13" :stroke-width="2.5" />
            </button>
          </div>
          <div v-if="scopeOpenFor === r.userId" class="sx__scope">
            <p v-if="dayDraft.stationIds.length === 0" class="sx__hint">
              Pick the day's stations above first.
            </p>
            <template v-else>
              <button
                type="button"
                class="sx__scope-chip"
                :class="{ 'sx__scope-chip--on': r.stationIds === null }"
                @click="clearScope(r)"
              >
                All stations
              </button>
              <button
                v-for="c in checkoffs.filter((x) => dayDraft!.stationIds.includes(x.id))"
                :key="c.id"
                type="button"
                class="sx__scope-chip"
                :class="{ 'sx__scope-chip--on': scopeHas(r, c.id) }"
                @click="toggleScopeStation(r, c.id)"
              >
                {{ c.title }}
              </button>
            </template>
          </div>
        </div>

        <div class="sx__addrow">
          <input
            v-model="traineeSearch"
            class="sx__input"
            placeholder="Search a name to add…"
          />
          <button
            v-if="cohortToAdd.length"
            type="button"
            class="sx__cohort"
            @click="addCohort"
          >
            + Add pipeline cohort ({{ cohortToAdd.length }})
          </button>
        </div>
        <button
          v-for="p in traineeMatches"
          :key="p.id"
          type="button"
          class="sx__match"
          @click="addTrainee(p.id)"
        >
          + {{ p.fullName }}
        </button>

        <p v-if="dayError" class="sx__error">{{ dayError }}</p>
        <div class="sx__actions">
          <button type="button" class="sx__save" :disabled="daySaving" @click="onSaveDay">
            {{ daySaving ? 'Saving…' : 'Save Skills Day' }}
          </button>
          <button type="button" class="sx__cancel" @click="dayDraft = null">Cancel</button>
          <button
            v-if="dayDraft.id"
            type="button"
            class="sx__danger"
            @click="onDeleteDay"
          >
            {{ dayDeleteArmed ? 'Tap again to delete' : 'Delete day' }}
          </button>
        </div>
      </div>
    </section>

    <!-- ══ Stations ═════════════════════════════════════════════════ -->
    <section class="sx__section">
      <div class="sx__section-head">
        <h2 class="sx__section-title"><ClipboardList :size="14" :stroke-width="2" /> Stations</h2>
        <button v-if="!stationDraft" type="button" class="sx__add" @click="newStation">
          <Plus :size="13" :stroke-width="2.5" /> New station
        </button>
      </div>

      <!-- Station list -->
      <div v-if="!stationDraft" class="sx__list">
        <button
          v-for="c in allCheckoffs"
          :key="c.id"
          type="button"
          class="sx__row"
          :class="{ 'sx__row--off': !c.active }"
          @click="editStation(c.id)"
        >
          <div class="sx__row-main">
            <span class="sx__row-title">{{ c.title }}</span>
            <span class="sx__row-sub">
              <template v-if="c.subtitle">{{ c.subtitle }} · </template>
              {{ itemCount(c.sections) }} item{{ itemCount(c.sections) === 1 ? '' : 's' }}
            </span>
          </div>
          <span v-if="!c.active" class="sx__badge">Inactive</span>
          <span class="sx__row-edit">Edit</span>
        </button>
      </div>

      <!-- Station editor -->
      <div v-else class="sx__editor">
        <label class="sx__field">
          <span class="sx__label">Title</span>
          <input v-model="stationDraft.title" class="sx__input" placeholder="Airway" />
        </label>
        <div class="sx__grid2">
          <label class="sx__field">
            <span class="sx__label">Subtitle</span>
            <input
              v-model="stationDraft.subtitle"
              class="sx__input"
              placeholder="Morning Rotation · Station 1"
            />
          </label>
          <label class="sx__field sx__field--sort">
            <span class="sx__label">Order</span>
            <input v-model.number="stationDraft.sort" type="number" class="sx__input" />
          </label>
        </div>
        <label class="sx__field">
          <span class="sx__label">Station note</span>
          <textarea
            v-model="stationDraft.note"
            class="sx__input sx__textarea"
            rows="3"
            placeholder="Shown to the evaluator at the top of the check-off. Keep the phrase “Automatic remediation triggers:” to render the amber callout."
          ></textarea>
        </label>
        <label class="sx__field">
          <span class="sx__label">Station setup equipment (one item per line)</span>
          <textarea
            v-model="stationDraft.equipmentText"
            class="sx__input sx__textarea"
            rows="5"
            placeholder="Shown on the Station setup checklist — e.g. LP15 ×2 (one with modem), electrodes in bulk, therapy pads ×4"
          ></textarea>
        </label>
        <label class="sx__check">
          <input v-model="stationDraft.active" type="checkbox" />
          Active (appears on the board and in day scheduling)
        </label>

        <div class="sx__sub-head">Requirements</div>
        <div
          v-for="(s, si) in stationDraft.sections"
          :key="si"
          class="sx__sec"
        >
          <div class="sx__sec-head">
            <input v-model="s.title" class="sx__input sx__sec-title" placeholder="Section title" />
            <div class="sx__mini-actions">
              <button type="button" class="sx__mini" title="Move up" @click="moveSection(si, -1)">
                <ChevronUp :size="13" :stroke-width="2.5" />
              </button>
              <button type="button" class="sx__mini" title="Move down" @click="moveSection(si, 1)">
                <ChevronDown :size="13" :stroke-width="2.5" />
              </button>
              <button type="button" class="sx__mini sx__mini--x" title="Remove section" @click="removeSection(si)">
                <X :size="13" :stroke-width="2.5" />
              </button>
            </div>
          </div>
          <input
            v-model="s.note"
            class="sx__input sx__sec-note"
            placeholder="Section note (optional)"
          />
          <div v-for="(it, ii) in s.items" :key="ii" class="sx__item">
            <input v-model="it.label" class="sx__input" placeholder="Check-off item" />
            <div class="sx__mini-actions">
              <button type="button" class="sx__mini" title="Move up" @click="moveItem(si, ii, -1)">
                <ChevronUp :size="13" :stroke-width="2.5" />
              </button>
              <button type="button" class="sx__mini" title="Move down" @click="moveItem(si, ii, 1)">
                <ChevronDown :size="13" :stroke-width="2.5" />
              </button>
              <button type="button" class="sx__mini sx__mini--x" title="Remove item" @click="removeItem(si, ii)">
                <X :size="13" :stroke-width="2.5" />
              </button>
            </div>
          </div>
          <button type="button" class="sx__add-item" @click="addItem(si)">
            <Plus :size="12" :stroke-width="2.5" /> Add item
          </button>
        </div>
        <button type="button" class="sx__add-sec" @click="addSection">
          <Plus :size="13" :stroke-width="2.5" /> Add section
        </button>

        <p v-if="stationError" class="sx__error">{{ stationError }}</p>
        <div class="sx__actions">
          <button type="button" class="sx__save" :disabled="stationSaving" @click="onSaveStation">
            {{ stationSaving ? 'Saving…' : 'Save station' }}
          </button>
          <button type="button" class="sx__cancel" @click="stationDraft = null">Cancel</button>
          <button
            v-if="stationDraft.id && evalCountFor(stationDraft.id) === 0"
            type="button"
            class="sx__danger"
            @click="onDeleteStation"
          >
            {{ stationDeleteArmed ? 'Tap again to delete' : 'Delete station' }}
          </button>
          <span v-else-if="stationDraft.id" class="sx__guard">
            {{ evalCountFor(stationDraft.id) }} check-off{{
              evalCountFor(stationDraft.id) === 1 ? '' : 's'
            }}
            recorded — deactivate instead of deleting.
          </span>
        </div>
      </div>
    </section>

    <!-- ══ Evaluators ═══════════════════════════════════════════════ -->
    <section class="sx__section">
      <div class="sx__section-head">
        <h2 class="sx__section-title"><Users :size="14" :stroke-width="2" /> Extra evaluators</h2>
      </div>
      <p class="sx__hint">
        Admins, supervisors, and FTOs can already evaluate. Add anyone else helping
        (e.g., the trauma-station EMT).
      </p>
      <div v-for="id in evaluatorIds" :key="id" class="sx__grant-row">
        {{ nameFor(id) }}
        <button type="button" class="sx__x" @click="removeEvaluator(id)">
          <X :size="13" :stroke-width="2.5" />
        </button>
      </div>
      <input
        v-model="evaluatorSearch"
        class="sx__input sx__grant-search"
        placeholder="Search a name to add…"
      />
      <button
        v-for="p in evaluatorMatches"
        :key="p.id"
        type="button"
        class="sx__match"
        @click="addEvaluator(p.id); evaluatorSearch = ''"
      >
        + {{ p.fullName }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.sx {
  display: flex;
  flex-direction: column;
  gap: 26px;
}
.sx__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.sx__section-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.sx__section-title svg {
  color: var(--color-accent-strong, #a8842c);
}
.sx__add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 8px;
  padding: 8px 13px;
  cursor: pointer;
}
.sx__hint {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.sx__error {
  font-size: 12.5px;
  font-weight: 600;
  color: oklch(0.5 0.17 25);
  margin: 10px 0 0;
}
.sx__guard {
  font-size: 12px;
  color: var(--color-muted);
  align-self: center;
}

/* Lists */
.sx__list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
}
.sx__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid var(--color-line);
  background: none;
  cursor: pointer;
  font-family: var(--font-sans);
}
.sx__row:last-child {
  border-bottom: none;
}
.sx__row:hover {
  background: var(--color-surface-soft);
}
.sx__row--off .sx__row-title {
  color: var(--color-muted);
}
.sx__row-main {
  flex: 1;
  min-width: 0;
}
.sx__row-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
.sx__row-sub {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--color-muted);
}
.sx__row-edit {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-brand-700, var(--color-brand-800));
}
.sx__badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted);
  border: 1px dashed var(--color-muted-soft);
  border-radius: 999px;
  padding: 2px 8px;
}

/* Editor */
.sx__editor {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 14px;
}
.sx__grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.sx__field {
  display: block;
  margin-bottom: 10px;
  min-width: 0;
}
.sx__field--sort {
  max-width: 110px;
}
.sx__label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-strong, #a8842c);
  margin-bottom: 4px;
}
.sx__input {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 13.5px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 10px;
}
.sx__textarea {
  resize: vertical;
  line-height: 1.5;
}
.sx__check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  padding: 6px 0;
  cursor: pointer;
}
.sx__check input {
  margin-top: 2px;
  accent-color: var(--color-brand-800);
}
.sx__check--row {
  border-bottom: 1px solid var(--color-line);
  padding: 9px 0;
}
.sx__check--row:last-of-type {
  border-bottom: none;
}
.sx__check-sub {
  display: block;
  font-style: normal;
  font-size: 11.5px;
  color: var(--color-muted);
}
.sx__sub-head {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-accent-strong, #a8842c);
  margin: 16px 0 6px;
  padding-top: 12px;
  border-top: 1px solid var(--color-line);
}

/* Trainees */
.sx__trainee {
  border-bottom: 1px solid var(--color-line);
}
.sx__trainee:last-of-type {
  border-bottom: none;
}
.sx__trainee-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}
.sx__trainee-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.sx__trainee-title {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  margin-left: 6px;
}
.sx__scope-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 700;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.sx__scope-btn--limited {
  color: var(--color-brand-800);
  border-color: var(--color-brand-600);
}
.sx__scope {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 0 10px;
}
.sx__scope-chip {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 5px 11px;
  cursor: pointer;
}
.sx__scope-chip--on {
  color: white;
  background: var(--color-brand-800);
  border-color: var(--color-brand-800);
}
.sx__addrow {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.sx__addrow .sx__input {
  flex: 1;
  min-width: 180px;
}
.sx__cohort {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-brand-800);
  background: none;
  border: 1px solid var(--color-brand-600);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.sx__match {
  display: block;
  width: 100%;
  text-align: left;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-brand-800);
  background: none;
  border: none;
  padding: 7px 4px;
  cursor: pointer;
}
.sx__match:hover {
  background: var(--color-surface-soft);
}
.sx__x {
  border: none;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  padding: 4px;
}

/* Sections / items */
.sx__sec {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-surface-soft);
  padding: 10px;
  margin-bottom: 10px;
}
.sx__sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sx__sec-title {
  font-weight: 700;
}
.sx__sec-note {
  margin-top: 6px;
  font-size: 12px;
}
.sx__item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.sx__mini-actions {
  display: flex;
  gap: 2px;
}
.sx__mini {
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border-radius: 7px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.sx__mini--x {
  color: oklch(0.5 0.17 25);
}
.sx__add-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-brand-800);
  background: none;
  border: none;
  padding: 8px 2px 2px;
  cursor: pointer;
}
.sx__add-sec {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-brand-800);
  background: none;
  border: 1px dashed var(--color-brand-600);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

/* Actions */
.sx__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-line);
}
.sx__save {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 9px;
  padding: 10px 18px;
  cursor: pointer;
}
.sx__save:disabled {
  opacity: 0.55;
}
.sx__cancel {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  padding: 10px 14px;
  cursor: pointer;
}
.sx__danger {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  color: oklch(0.5 0.17 25);
  background: none;
  border: 1px solid oklch(0.8 0.08 25);
  border-radius: 9px;
  padding: 10px 14px;
  cursor: pointer;
  margin-left: auto;
}

/* Grants */
.sx__grant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  padding: 7px 0;
  border-bottom: 1px solid var(--color-line);
  max-width: 420px;
}
.sx__grant-search {
  max-width: 420px;
  margin-top: 10px;
}

@media (max-width: 520px) {
  .sx__grid2 {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .sx__field--sort {
    max-width: 140px;
  }
}
</style>
