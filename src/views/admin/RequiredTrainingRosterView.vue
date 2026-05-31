<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ShieldCheck, Check, CircleDashed, UserCheck, Download } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useRequiredTraining } from '@/composables/useRequiredTraining'
import { supabase } from '@/lib/supabase'
import type { Role, ShiftLetter, RequiredTrainingCompletion } from '@/types'

interface Employee {
  id: string
  fullName: string
  role: Role
  shift: ShiftLetter | null
  station: string | null
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { ready, trainingById, completionsFor, adminMarkComplete } = useRequiredTraining()

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
    .select('id, full_name, role, shift, station, active')
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
    }))
  }
  rosterLoading.value = false
}

onMounted(() => {
  if (auth.isAdmin) void loadRoster()
})

/* Filter the roster to people who are in this module's audience. */
const audience = computed<Employee[]>(() => {
  const t = training.value
  if (!t) return []
  return roster.value.filter((e) => {
    const roleOk = t.audienceRoles.length === 0 || t.audienceRoles.includes(e.role)
    const shiftOk =
      t.audienceShifts.length === 0 ||
      (e.shift !== null && t.audienceShifts.includes(e.shift))
    return roleOk && shiftOk
  })
})

interface RosterRow {
  user: Employee
  completion: RequiredTrainingCompletion | null
  status: 'signed' | 'in_progress' | 'not_started'
}

const rows = computed<RosterRow[]>(() => {
  const completions = completionsFor(trainingId.value)
  return audience.value.map((u) => {
    const c = completions.find((x) => x.userId === u.id) ?? null
    const status: RosterRow['status'] = c
      ? c.attestationSigned
        ? 'signed'
        : 'in_progress'
      : 'not_started'
    return { user: u, completion: c, status }
  })
})

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
  return rows.value.filter((r) => {
    if (filter.value === 'outstanding' && r.status === 'signed') return false
    if (filter.value === 'signed' && r.status !== 'signed') return false
    if (shiftFilter.value !== 'all' && r.user.shift !== shiftFilter.value) return false
    return true
  })
})

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
          <button type="button" class="rtr__export" @click="downloadRosterCsv">
            <Download :size="14" :stroke-width="2" />
            Export sign-off sheet (CSV)
          </button>
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
            <th>Status</th>
            <th class="rtr-table__actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visibleRows" :key="r.user.id" :class="`rtr-row--${r.status}`">
            <td>{{ r.user.fullName }}</td>
            <td class="rtr-table__small">{{ r.user.shift ?? '—' }}</td>
            <td class="rtr-table__small">{{ r.user.role }}</td>
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
                v-if="r.status !== 'signed'"
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
  transition: border-color 120ms var(--ease-out);
}
.rtr__export:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-600);
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
</style>
