<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ShieldCheck, Check, CircleDashed, UserCheck, Download, FileText, X } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { supabase } from '@/lib/supabase'
import type { EmploymentType, Role, ShiftLetter, RequiredTrainingCompletion } from '@/types'
import {
  generateRequiredTrainingSignOffPdf,
  type SignOffEntry,
} from '@/lib/requiredTrainingSignOffPdf'

interface Employee {
  id: string
  fullName: string
  role: Role
  shift: ShiftLetter | null
  station: string | null
  employmentType: EmploymentType
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  trainingById,
  completionsFor,
  adminMarkComplete,
  matchesAudienceFilterForUser,
  isRequiredForUser,
  getOverride,
  setOverride,
} = useRequiredTraining()

const trainingId = computed(() => String(route.params.id))
const training = computed(() => trainingById(trainingId.value))

/* Load the active roster once. Admins-only route, so RLS allows it. */
const roster = ref<Employee[]>([])
const rosterLoading = ref(false)
const rosterError = ref<string | null>(null)

async function loadRoster() {
  rosterLoading.value = true
  rosterError.value = null
  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, role, shift, station, employment_type, active')
    .eq('active', true)
    .order('full_name')
  if (error) {
    rosterError.value = error.message
  } else {
    roster.value = (data ?? []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      role: r.role,
      shift: r.shift,
      station: r.station,
      employmentType: (r.employment_type ?? 'full_time') as EmploymentType,
    }))
  }
  rosterLoading.value = false
}

onMounted(() => {
  if (auth.isAdmin) void loadRoster()
})

/* Audience = role × shift × employment_type filter, then per-user
   overrides applied on top. The roster view shows EVERYONE in the
   effective audience (after overrides) PLUS anyone outside the
   audience who has a force-include override, so admins can see and
   manage those exceptions. The default-vs-override state per row is
   surfaced by the per-row toggle column. */
const audience = computed<Employee[]>(() => {
  const t = training.value
  if (!t) return []
  return roster.value.filter((e) =>
    isRequiredForUser(t, {
      id: e.id,
      role: e.role,
      shift: e.shift,
      employmentType: e.employmentType,
    }),
  )
})

interface RosterRow {
  user: Employee
  completion: RequiredTrainingCompletion | null
  status: 'signed' | 'in_progress' | 'not_started'
  /** "auto" = follows the audience filter (no override on file);
   *  "force_include" / "force_exclude" = an override row exists.
   *  Drives the 3-state Required? toggle. */
  requirement: 'auto_in' | 'force_include' | 'force_exclude'
}

const rows = computed<RosterRow[]>(() => {
  const t = training.value
  if (!t) return []
  const completions = completionsFor(trainingId.value)
  return audience.value.map((u) => {
    const c = completions.find((x) => x.userId === u.id) ?? null
    const status: RosterRow['status'] = c
      ? c.attestationSigned
        ? 'signed'
        : 'in_progress'
      : 'not_started'
    const override = getOverride(trainingId.value, u.id)
    const matchesFilter = matchesAudienceFilterForUser(t, {
      role: u.role,
      shift: u.shift,
      employmentType: u.employmentType,
    })
    let requirement: RosterRow['requirement'] = 'auto_in'
    if (override) {
      requirement = override.included ? 'force_include' : 'force_exclude'
    } else if (matchesFilter) {
      requirement = 'auto_in'
    }
    return { user: u, completion: c, status, requirement }
  })
})

/* Also surface people who DON'T currently match (so admin can toggle
   them ON via override). Shown in a separate "Outside audience"
   section when the admin enables the broader view. */
const outsideAudience = computed<Employee[]>(() => {
  const t = training.value
  if (!t) return []
  const audienceIds = new Set(audience.value.map((e) => e.id))
  return roster.value.filter((e) => !audienceIds.has(e.id))
})

const showOutside = ref(false)

async function onToggleRequirement(row: RosterRow) {
  /* Cycle: auto_in → force_exclude → force_include → auto_in */
  const t = training.value
  if (!t) return
  const matchesFilter = matchesAudienceFilterForUser(t, {
    role: row.user.role,
    shift: row.user.shift,
    employmentType: row.user.employmentType,
  })
  let next: boolean | null = null
  if (row.requirement === 'auto_in') {
    /* Currently auto-in (matches filter, no override) → set force-exclude. */
    next = false
  } else if (row.requirement === 'force_exclude') {
    /* Force-exclude → flip to force-include (admin explicitly wants
       them in). */
    next = true
  } else {
    /* Force-include → clear override; if they still match the filter
       they go back to auto_in, otherwise they fall out of audience. */
    next = matchesFilter ? null : null
  }
  await setOverride(trainingId.value, row.user.id, next)
}

/* "Include this person" button for the Outside-audience list. */
async function addToAudience(employee: Employee) {
  await setOverride(trainingId.value, employee.id, true)
}

const summary = computed(() => {
  const signed = rows.value.filter((r) => r.status === 'signed').length
  const started = rows.value.filter((r) => r.status === 'in_progress').length
  const total = rows.value.length
  const pct = total === 0 ? 0 : Math.round((signed / total) * 100)
  return { signed, started, total, pct }
})

/* Filter chips */
type FilterKey = 'all' | 'outstanding' | 'signed'
const filter = ref<FilterKey>('outstanding')
const shiftFilter = ref<'all' | ShiftLetter>('all')
const visibleRows = computed(() => {
  return rows.value
    .filter((r) => {
      if (filter.value === 'outstanding' && r.status === 'signed') return false
      if (filter.value === 'signed' && r.status !== 'signed') return false
      if (shiftFilter.value !== 'all' && r.user.shift !== shiftFilter.value) return false
      return true
    })
    /* FT first, then PT, alphabetical within each group. The template
       splits this into two grouped <tbody> sections, but pre-sorting
       here keeps any consumers that flatten back into a single list
       (e.g. exports) in the right order too. */
    .sort((a, b) => {
      if (a.user.employmentType !== b.user.employmentType) {
        return a.user.employmentType === 'full_time' ? -1 : 1
      }
      return a.user.fullName.localeCompare(b.user.fullName)
    })
})

/* Split the visible rows into FT / PT groups for the two-section
   table render. Both arrays are already in alphabetical order via
   visibleRows above. */
const ftRows = computed(() =>
  visibleRows.value.filter((r) => r.user.employmentType === 'full_time'),
)
const ptRows = computed(() =>
  visibleRows.value.filter((r) => r.user.employmentType === 'part_time'),
)

const markingId = ref<string | null>(null)
const markNote = ref('')
const markError = ref<string | null>(null)

async function onMark(row: RosterRow) {
  if (markingId.value === row.user.id) return
  markingId.value = row.user.id
  markError.value = null
  try {
    const result = await adminMarkComplete(trainingId.value, row.user.id, markNote.value || undefined)
    if (!result.ok) markError.value = result.error
  } finally {
    markingId.value = null
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function back() {
  router.push('/admin/required-training')
}

/* CSV export of the FULL roster (ignores active filter chips so you
   always get the complete sign-off sheet). Field order matches what
   payroll / Paycom / HR typically want when importing compliance. */
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadRosterCsv() {
  if (!training.value) return
  const t = training.value
  const generated = new Date()
  const generatedStr = generated.toLocaleString('en-US')
  const safeTitle = t.title.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
  const fileName = `WCEMS_Required-Training_${safeTitle}_${generated.toISOString().slice(0, 10)}.csv`

  /* Pre-header rows so an Excel-opening user immediately knows what
     they're looking at. Real header row is the 4th. */
  const lines: string[] = []
  lines.push(`Required Training Sign-Off Sheet`)
  lines.push(`Module,${csvEscape(t.title)}`)
  lines.push(`Generated,${csvEscape(generatedStr)}`)
  lines.push('')
  lines.push(
    [
      'Name',
      'Role',
      'Shift',
      'Station',
      'Status',
      'Completed Date',
      'Sign-off Method',
      'Marked By (Admin)',
      'Note',
    ].join(','),
  )

  /* Always export the entire audience — admin can filter in Excel. */
  for (const r of rows.value) {
    const c = r.completion
    const statusLabel =
      r.status === 'signed'
        ? c?.signedMethod === 'admin_marked'
          ? 'Admin-marked complete'
          : 'Signed'
        : r.status === 'in_progress'
          ? 'In progress'
          : 'Not started'
    const completedDate = c?.completedAt
      ? new Date(c.completedAt).toLocaleString('en-US')
      : ''
    const signedMethod = c
      ? c.signedMethod === 'self'
        ? 'Self-attested'
        : 'Admin-marked'
      : ''
    const markedByName = c?.markedBy
      ? roster.value.find((u) => u.id === c.markedBy)?.fullName ?? '(unknown admin)'
      : ''
    const note = c?.markedNote ?? ''
    lines.push(
      [
        csvEscape(r.user.fullName),
        csvEscape(r.user.role),
        csvEscape(r.user.shift ?? ''),
        csvEscape(r.user.station ?? ''),
        csvEscape(statusLabel),
        csvEscape(completedDate),
        csvEscape(signedMethod),
        csvEscape(markedByName),
        csvEscape(note),
      ].join(','),
    )
  }

  /* Prepend a UTF-8 BOM so Excel auto-detects encoding (otherwise
     accented names render as garbage on Windows). */
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* PDF export including each user's actual signature image inline.
   This is the audit / archival format — single file, looks official,
   matches what the old Wix dashboard produced. */
const pdfBusy = ref(false)
async function downloadRosterPdf() {
  if (!training.value || pdfBusy.value) return
  pdfBusy.value = true
  try {
    const t = training.value
    /* Pass the full audience (rows.value, not the chip-filtered
       visibleRows) — the PDF is the compliance record, so it must
       show everyone regardless of which chip the admin had toggled. */
    const entries: SignOffEntry[] = rows.value.map((r) => {
      const c = r.completion
      const markedByName = c?.markedBy
        ? roster.value.find((u) => u.id === c.markedBy)?.fullName ?? null
        : null
      return {
        fullName: r.user.fullName,
        employmentType: r.user.employmentType,
        status: r.status,
        signedMethod: c?.signedMethod ?? null,
        completedAt: c?.completedAt ?? null,
        signatureDataUrl: c?.signatureData ?? null,
        markedByName,
      }
    })

    const doc = await generateRequiredTrainingSignOffPdf({
      moduleTitle: t.title,
      entries,
    })
    const safeTitle = t.title.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    doc.save(`WCEMS_Sign-Off_${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`)
  } finally {
    pdfBusy.value = false
  }
}
</script>

<template>
  <div class="rtr">
    <button type="button" class="rtr__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Back to Required Training
    </button>

    <div v-if="!auth.isAdmin" class="rtr__gate">Admin only.</div>

    <template v-else-if="!ready || rosterLoading">
      <div class="rtr__empty">Loading…</div>
    </template>

    <template v-else-if="!training">
      <div class="rtr__empty">Training module not found.</div>
    </template>

    <template v-else>
      <header class="rtr__header">
        <div class="rtr__header-row">
          <div class="flex items-center gap-2">
            <ShieldCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
            <h1 class="display rtr__title">{{ training.title }}</h1>
          </div>
          <div class="rtr__export-group">
            <button
              type="button"
              class="rtr__export rtr__export--primary"
              :disabled="pdfBusy"
              @click="downloadRosterPdf"
            >
              <FileText :size="14" :stroke-width="2" />
              {{ pdfBusy ? 'Generating…' : 'Export sign-off sheet (PDF)' }}
            </button>
            <button type="button" class="rtr__export" @click="downloadRosterCsv">
              <Download :size="14" :stroke-width="2" />
              CSV
            </button>
          </div>
        </div>
        <p v-if="training.description" class="rtr__desc">{{ training.description }}</p>
      </header>

      <!-- Summary -->
      <AppCard class="rtr-summary">
        <div class="rtr-summary__row">
          <div class="rtr-summary__cell">
            <Eyebrow>Completion</Eyebrow>
            <div class="rtr-summary__big">{{ summary.pct }}%</div>
            <div class="rtr-summary__sub">{{ summary.signed }} of {{ summary.total }} assigned</div>
          </div>
          <div class="rtr-summary__cell">
            <Eyebrow>In progress</Eyebrow>
            <div class="rtr-summary__big">{{ summary.started }}</div>
            <div class="rtr-summary__sub">started, not yet signed</div>
          </div>
          <div class="rtr-summary__cell">
            <Eyebrow>Outstanding</Eyebrow>
            <div class="rtr-summary__big">{{ summary.total - summary.signed }}</div>
            <div class="rtr-summary__sub">still need to complete</div>
          </div>
        </div>
      </AppCard>

      <!-- Filters -->
      <div class="rtr-filters">
        <div class="rtr-filters__group">
          <button
            v-for="opt in (['outstanding','signed','all'] as FilterKey[])"
            :key="opt"
            type="button"
            class="rtr-filters__chip"
            :class="{ 'rtr-filters__chip--on': filter === opt }"
            @click="filter = opt"
          >
            {{ opt === 'outstanding' ? 'Outstanding' : opt === 'signed' ? 'Signed' : 'All' }}
          </button>
        </div>
        <div class="rtr-filters__group">
          <span class="rtr-filters__label">Shift:</span>
          <button
            v-for="s in (['all','A','B','C'] as Array<'all' | ShiftLetter>)"
            :key="s"
            type="button"
            class="rtr-filters__chip rtr-filters__chip--small"
            :class="{ 'rtr-filters__chip--on': shiftFilter === s }"
            @click="shiftFilter = s"
          >
            {{ s === 'all' ? 'All' : s }}
          </button>
        </div>
      </div>

      <!-- Mark-complete note (shared across rows in this session) -->
      <div class="rtr-note">
        <label class="rtr-note__label">
          <span>Note (optional, attaches to "Mark complete" actions):</span>
          <input
            v-model="markNote"
            type="text"
            placeholder="e.g. Attended A-shift Teams session 5/30"
            class="rtr-note__input"
          />
        </label>
      </div>

      <div v-if="markError" class="rtr-error">{{ markError }}</div>
      <div v-if="rosterError" class="rtr-error">{{ rosterError }}</div>

      <!-- Roster -->
      <div v-if="!visibleRows.length" class="rtr__empty">
        No employees match this filter.
      </div>
      <table v-else class="rtr-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="rtr-table__small">Shift</th>
            <th class="rtr-table__small">Role</th>
            <th class="rtr-table__small">FT/PT</th>
            <th class="rtr-table__req">Required?</th>
            <th>Status</th>
            <th class="rtr-table__actions"></th>
          </tr>
        </thead>

        <!-- Full-Time section -->
        <tbody v-if="ftRows.length">
          <tr class="rtr-table__group">
            <td colspan="7">
              <span class="rtr-table__group-label">Full-Time</span>
              <span class="rtr-table__group-count">{{ ftRows.length }}</span>
            </td>
          </tr>
          <tr v-for="r in ftRows" :key="r.user.id" :class="`rtr-row--${r.status}`">
            <td>{{ r.user.fullName }}</td>
            <td class="rtr-table__small">{{ r.user.shift ?? '—' }}</td>
            <td class="rtr-table__small">{{ r.user.role }}</td>
            <td class="rtr-table__small">FT</td>
            <td class="rtr-table__req">
              <button
                type="button"
                class="rtr-req"
                :class="`rtr-req--${r.requirement}`"
                :title="
                  r.requirement === 'force_include'
                    ? 'Force-included — click to remove from this training'
                    : r.requirement === 'force_exclude'
                      ? 'Excluded — click to put them back in'
                      : 'Matches the audience filter — click to exclude this person'
                "
                @click="onToggleRequirement(r)"
              >
                <Check
                  v-if="r.requirement === 'auto_in' || r.requirement === 'force_include'"
                  :size="13"
                  :stroke-width="2.5"
                />
                <X v-else :size="13" :stroke-width="2.5" />
                <span class="rtr-req__label">
                  {{
                    r.requirement === 'force_include'
                      ? 'Yes · override'
                      : r.requirement === 'force_exclude'
                        ? 'No · override'
                        : 'Yes'
                  }}
                </span>
              </button>
            </td>
            <td>
              <span v-if="r.status === 'signed'" class="rtr-chip rtr-chip--signed">
                <Check :size="11" :stroke-width="2.5" />
                {{ r.completion?.signedMethod === 'admin_marked' ? 'Admin-marked' : 'Signed' }}
                <span class="rtr-chip__date">· {{ formatDate(r.completion?.completedAt ?? null) }}</span>
              </span>
              <span v-else-if="r.status === 'in_progress'" class="rtr-chip rtr-chip--in_progress">
                <CircleDashed :size="11" :stroke-width="2" />
                In progress
              </span>
              <span v-else class="rtr-chip rtr-chip--not_started">
                Not started
              </span>
            </td>
            <td class="rtr-table__actions">
              <button
                v-if="r.status !== 'signed' && r.requirement !== 'force_exclude'"
                type="button"
                class="rtr-mark"
                :disabled="markingId === r.user.id"
                @click="onMark(r)"
              >
                <UserCheck :size="12" :stroke-width="2" />
                {{ markingId === r.user.id ? 'Marking…' : 'Mark complete' }}
              </button>
            </td>
          </tr>
        </tbody>

        <!-- Part-Time section -->
        <tbody v-if="ptRows.length">
          <tr class="rtr-table__group rtr-table__group--pt">
            <td colspan="7">
              <span class="rtr-table__group-label">Part-Time</span>
              <span class="rtr-table__group-count">{{ ptRows.length }}</span>
            </td>
          </tr>
          <tr v-for="r in ptRows" :key="r.user.id" :class="`rtr-row--${r.status}`">
            <td>{{ r.user.fullName }}</td>
            <td class="rtr-table__small">{{ r.user.shift ?? '—' }}</td>
            <td class="rtr-table__small">{{ r.user.role }}</td>
            <td class="rtr-table__small">PT</td>
            <td class="rtr-table__req">
              <button
                type="button"
                class="rtr-req"
                :class="`rtr-req--${r.requirement}`"
                :title="
                  r.requirement === 'force_include'
                    ? 'Force-included — click to remove from this training'
                    : r.requirement === 'force_exclude'
                      ? 'Excluded — click to put them back in'
                      : 'Matches the audience filter — click to exclude this person'
                "
                @click="onToggleRequirement(r)"
              >
                <Check
                  v-if="r.requirement === 'auto_in' || r.requirement === 'force_include'"
                  :size="13"
                  :stroke-width="2.5"
                />
                <X v-else :size="13" :stroke-width="2.5" />
                <span class="rtr-req__label">
                  {{
                    r.requirement === 'force_include'
                      ? 'Yes · override'
                      : r.requirement === 'force_exclude'
                        ? 'No · override'
                        : 'Yes'
                  }}
                </span>
              </button>
            </td>
            <td>
              <span v-if="r.status === 'signed'" class="rtr-chip rtr-chip--signed">
                <Check :size="11" :stroke-width="2.5" />
                {{ r.completion?.signedMethod === 'admin_marked' ? 'Admin-marked' : 'Signed' }}
                <span class="rtr-chip__date">· {{ formatDate(r.completion?.completedAt ?? null) }}</span>
              </span>
              <span v-else-if="r.status === 'in_progress'" class="rtr-chip rtr-chip--in_progress">
                <CircleDashed :size="11" :stroke-width="2" />
                In progress
              </span>
              <span v-else class="rtr-chip rtr-chip--not_started">
                Not started
              </span>
            </td>
            <td class="rtr-table__actions">
              <button
                v-if="r.status !== 'signed' && r.requirement !== 'force_exclude'"
                type="button"
                class="rtr-mark"
                :disabled="markingId === r.user.id"
                @click="onMark(r)"
              >
                <UserCheck :size="12" :stroke-width="2" />
                {{ markingId === r.user.id ? 'Marking…' : 'Mark complete' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Outside-audience section — opt-in expand so admin can add
           individuals who fall outside role/shift/employment filter. -->
      <div v-if="outsideAudience.length" class="rtr-outside">
        <button
          type="button"
          class="rtr-outside__toggle"
          @click="showOutside = !showOutside"
        >
          {{ showOutside ? 'Hide' : `Show` }} other employees ({{ outsideAudience.length }})
          <span class="rtr-outside__hint">— outside the audience filter; click + to require for a specific person</span>
        </button>
        <ul v-if="showOutside" class="rtr-outside__list">
          <li
            v-for="emp in outsideAudience"
            :key="emp.id"
            class="rtr-outside__item"
          >
            <span class="rtr-outside__name">{{ emp.fullName }}</span>
            <span class="rtr-outside__meta">
              {{ emp.role }} · {{ emp.shift ?? '—' }} ·
              {{ emp.employmentType === 'full_time' ? 'FT' : 'PT' }}
            </span>
            <button type="button" class="rtr-outside__add" @click="addToAudience(emp)">
              + Require for this person
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rtr {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .rtr {
    padding: 40px 40px 80px;
  }
}
.rtr__back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 0;
  margin-bottom: 8px;
}
.rtr__back:hover {
  color: var(--color-ink-soft);
}
.rtr__gate,
.rtr__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.rtr__header {
  margin-bottom: 14px;
}
.rtr__header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rtr__title {
  font-size: 24px;
  letter-spacing: -0.01em;
}
.rtr__desc {
  margin-top: 6px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
}
.rtr__export-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.rtr__export {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out), background 120ms var(--ease-out);
}
.rtr__export:hover:not(:disabled) {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
}
.rtr__export--primary {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.rtr__export--primary:hover:not(:disabled) {
  background: var(--color-brand-700);
  border-color: var(--color-brand-700);
  color: white;
}
.rtr__export:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rtr-summary {
  padding: 16px !important;
}
.rtr-summary__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.rtr-summary__cell {
  padding: 0 8px;
  border-right: 1px solid var(--color-line);
}
.rtr-summary__cell:last-of-type {
  border-right: none;
}
.rtr-summary__big {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--color-brand-600);
  margin-top: 4px;
  line-height: 1;
}
.rtr-summary__sub {
  font-size: 11.5px;
  color: var(--color-muted);
  margin-top: 4px;
}

.rtr-filters {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (min-width: 640px) {
  .rtr-filters {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
}
.rtr-filters__group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.rtr-filters__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.rtr-filters__chip {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  cursor: pointer;
}
.rtr-filters__chip--small {
  padding: 3px 9px;
  font-size: 11.5px;
}
.rtr-filters__chip--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.rtr-note {
  margin-top: 14px;
}
.rtr-note__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rtr-note__label > span:first-child {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.rtr-note__input {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
}

.rtr-error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
}

.rtr-table {
  margin-top: 18px;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.rtr-table th,
.rtr-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.rtr-table th {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.rtr-table__small {
  width: 80px;
  text-transform: capitalize;
}
.rtr-table__actions {
  width: 1%;
  text-align: right;
}

/* FT / PT group section headers inside the table */
.rtr-table__group td {
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-line);
  padding: 8px 12px;
}
.rtr-table__group-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: oklch(0.4 0.13 250);
}
.rtr-table__group--pt .rtr-table__group-label {
  color: oklch(0.45 0.13 75);
}
.rtr-table__group-count {
  margin-left: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-muted);
  padding: 1px 7px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 999px;
}

.rtr-row--signed {
  color: var(--color-muted);
}

.rtr-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.rtr-chip--signed {
  color: var(--color-success-500);
  border-color: #c6e4d2;
  background: #f0f8f3;
}
.rtr-chip--in_progress {
  color: var(--color-brand-700);
  border-color: var(--color-brand-100);
  background: var(--color-brand-50);
}
.rtr-chip--not_started {
  color: var(--color-muted);
}
.rtr-chip__date {
  font-family: var(--font-mono);
  font-weight: 500;
  margin-left: 2px;
}

.rtr-mark {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--color-brand-600);
  color: white;
  border: none;
  cursor: pointer;
}
.rtr-mark:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.rtr-mark:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rtr-table__req {
  width: 130px;
}
.rtr-req {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.rtr-req:hover {
  border-color: var(--color-muted-soft);
}
.rtr-req--auto_in {
  color: var(--color-success-500);
  background: #f0f8f3;
  border-color: #c6e4d2;
}
.rtr-req--force_include {
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border-color: var(--color-brand-100);
}
.rtr-req--force_exclude {
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border-color: oklch(0.85 0.07 20);
}

/* Outside-audience disclosure */
.rtr-outside {
  margin-top: 18px;
  border-top: 1px dashed var(--color-line);
  padding-top: 14px;
}
.rtr-outside__toggle {
  background: transparent;
  border: none;
  color: var(--color-brand-600);
  font-weight: 600;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
}
.rtr-outside__toggle:hover {
  text-decoration: underline;
}
.rtr-outside__hint {
  color: var(--color-muted);
  font-weight: 400;
  margin-left: 6px;
}
.rtr-outside__list {
  list-style: none;
  margin: 10px 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rtr-outside__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
  font-size: 13px;
}
.rtr-outside__name {
  flex: 1;
  font-weight: 600;
}
.rtr-outside__meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}
.rtr-outside__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background: transparent;
  color: var(--color-brand-600);
  border: 1px solid var(--color-line);
  cursor: pointer;
}
.rtr-outside__add:hover {
  border-color: var(--color-brand-600);
  background: var(--color-brand-50);
}
</style>
