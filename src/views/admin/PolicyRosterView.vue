<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  FileText,
  Check,
  AlertTriangle,
  UserCheck,
  X,
} from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { usePolicies } from '@/composables/usePolicies'
import { supabase } from '@/lib/supabase'
import type {
  EmploymentType,
  PolicyAcknowledgement,
  Role,
  ShiftLetter,
} from '@/types'

interface Employee {
  id: string
  fullName: string
  role: Role
  shift: ShiftLetter | null
  station: string | null
  employmentType: EmploymentType
}

interface RosterRow {
  user: Employee
  ack: PolicyAcknowledgement | null
  status: 'signed' | 'stale' | 'not_signed'
  requirement: 'auto_in' | 'force_include' | 'force_exclude'
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const {
  ready,
  policyById,
  acksFor,
  isAcknowledged,
  isStale,
  adminMarkAcknowledged,
  matchesAudienceFilterForUser,
  isRequiredForUser,
  getOverride,
  setOverride,
} = usePolicies()

const policyId = computed(() => String(route.params.id))
const policy = computed(() => policyById(policyId.value))

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
    .eq('account_type', 'person')
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

const audience = computed<Employee[]>(() => {
  const p = policy.value
  if (!p) return []
  return roster.value.filter((e) =>
    isRequiredForUser(p, {
      id: e.id,
      role: e.role,
      shift: e.shift,
      employmentType: e.employmentType,
    }),
  )
})

const rows = computed<RosterRow[]>(() => {
  const p = policy.value
  if (!p) return []
  return audience.value.map((u) => {
    const ack = (acksFor(p.id).find((a) => a.userId === u.id)) ?? null
    const acknowledged = isAcknowledged(p.id, u.id)
    const stale = isStale(p.id, u.id)
    const status: RosterRow['status'] = acknowledged
      ? 'signed'
      : stale
        ? 'stale'
        : 'not_signed'
    const override = getOverride(p.id, u.id)
    const matchesFilter = matchesAudienceFilterForUser(p, {
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
    return { user: u, ack, status, requirement }
  })
})

const outsideAudience = computed<Employee[]>(() => {
  const p = policy.value
  if (!p) return []
  const audienceIds = new Set(audience.value.map((e) => e.id))
  return roster.value.filter((e) => !audienceIds.has(e.id))
})

const showOutside = ref(false)

async function onToggleRequirement(row: RosterRow) {
  const p = policy.value
  if (!p) return
  const matchesFilter = matchesAudienceFilterForUser(p, {
    role: row.user.role,
    shift: row.user.shift,
    employmentType: row.user.employmentType,
  })
  let next: boolean | null = null
  if (row.requirement === 'auto_in') next = false
  else if (row.requirement === 'force_exclude') next = true
  else next = matchesFilter ? null : null
  await setOverride(p.id, row.user.id, next)
}

async function addToAudience(employee: Employee) {
  if (!policy.value) return
  await setOverride(policy.value.id, employee.id, true)
}

const summary = computed(() => {
  const signed = rows.value.filter((r) => r.status === 'signed').length
  const stale = rows.value.filter((r) => r.status === 'stale').length
  const total = rows.value.length
  const pct = total === 0 ? 0 : Math.round((signed / total) * 100)
  return { signed, stale, total, pct }
})

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
    .sort((a, b) => {
      if (a.user.employmentType !== b.user.employmentType) {
        return a.user.employmentType === 'full_time' ? -1 : 1
      }
      return a.user.fullName.localeCompare(b.user.fullName)
    })
})

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
  if (!policy.value || markingId.value === row.user.id) return
  markingId.value = row.user.id
  markError.value = null
  try {
    const result = await adminMarkAcknowledged(
      policy.value.id,
      row.user.id,
      markNote.value || undefined,
    )
    if (!result.ok) markError.value = result.error
  } finally {
    markingId.value = null
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function back() {
  router.push('/admin/policies')
}
</script>

<template>
  <div class="prv">
    <button type="button" class="prv__back" @click="back">
      <ArrowLeft :size="14" :stroke-width="2" />
      Back to Policies
    </button>

    <div v-if="!auth.isAdmin" class="prv__gate">Admin only.</div>

    <template v-else-if="!ready || rosterLoading">
      <div class="prv__empty">Loading…</div>
    </template>

    <template v-else-if="!policy">
      <div class="prv__empty">Policy not found.</div>
    </template>

    <template v-else>
      <header class="prv__header">
        <div class="prv__header-row">
          <div class="flex items-center gap-2">
            <FileText
              :size="22"
              :stroke-width="1.85"
              style="color: var(--color-brand-600)"
            />
            <h1 class="display prv__title">{{ policy.title }}</h1>
          </div>
        </div>
        <div class="prv__meta-row">
          <span>v{{ policy.version }}</span>
          <template v-if="policy.effectiveDate">
            · Effective {{ formatDate(policy.effectiveDate) }}
          </template>
          <template v-if="policy.documentFilename">
            · {{ policy.documentFilename }}
          </template>
        </div>
      </header>

      <AppCard class="prv-summary">
        <div class="prv-summary__row">
          <div class="prv-summary__cell">
            <Eyebrow>Acknowledged</Eyebrow>
            <div class="prv-summary__big">{{ summary.pct }}%</div>
            <div class="prv-summary__sub">
              {{ summary.signed }} of {{ summary.total }} assigned
            </div>
          </div>
          <div class="prv-summary__cell">
            <Eyebrow>Stale</Eyebrow>
            <div class="prv-summary__big">{{ summary.stale }}</div>
            <div class="prv-summary__sub">need re-acknowledgement</div>
          </div>
          <div class="prv-summary__cell">
            <Eyebrow>Outstanding</Eyebrow>
            <div class="prv-summary__big">
              {{ summary.total - summary.signed }}
            </div>
            <div class="prv-summary__sub">still haven't signed</div>
          </div>
        </div>
      </AppCard>

      <div class="prv-filters">
        <div class="prv-filters__group">
          <button
            v-for="opt in (['outstanding', 'signed', 'all'] as FilterKey[])"
            :key="opt"
            type="button"
            class="prv-filters__chip"
            :class="{ 'prv-filters__chip--on': filter === opt }"
            @click="filter = opt"
          >
            {{
              opt === 'outstanding' ? 'Outstanding' : opt === 'signed' ? 'Signed' : 'All'
            }}
          </button>
        </div>
        <div class="prv-filters__group">
          <span class="prv-filters__label">Shift:</span>
          <button
            v-for="s in (['all', 'A', 'B', 'C'] as Array<'all' | ShiftLetter>)"
            :key="s"
            type="button"
            class="prv-filters__chip prv-filters__chip--small"
            :class="{ 'prv-filters__chip--on': shiftFilter === s }"
            @click="shiftFilter = s"
          >
            {{ s === 'all' ? 'All' : s }}
          </button>
        </div>
      </div>

      <div class="prv-note">
        <label class="prv-note__label">
          <span>Note (optional, attaches to mark-acknowledged actions):</span>
          <input
            v-model="markNote"
            type="text"
            placeholder="e.g. Signed paper copy on file, Teams session 6/2"
            class="prv-note__input"
          />
        </label>
      </div>

      <div v-if="markError" class="prv-error">{{ markError }}</div>
      <div v-if="rosterError" class="prv-error">{{ rosterError }}</div>

      <div v-if="!visibleRows.length" class="prv__empty">
        No employees match this filter.
      </div>
      <table v-else class="prv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="prv-table__small">Shift</th>
            <th class="prv-table__small">Role</th>
            <th class="prv-table__small">FT/PT</th>
            <th class="prv-table__req">Required?</th>
            <th>Status</th>
            <th class="prv-table__actions"></th>
          </tr>
        </thead>

        <tbody v-if="ftRows.length">
          <tr class="prv-table__group">
            <td colspan="7">
              <span class="prv-table__group-label">Full-Time</span>
              <span class="prv-table__group-count">{{ ftRows.length }}</span>
            </td>
          </tr>
          <tr
            v-for="r in ftRows"
            :key="r.user.id"
            :class="`prv-row--${r.status}`"
          >
            <td>{{ r.user.fullName }}</td>
            <td class="prv-table__small">{{ r.user.shift ?? '—' }}</td>
            <td class="prv-table__small">{{ r.user.role }}</td>
            <td class="prv-table__small">FT</td>
            <td class="prv-table__req">
              <button
                type="button"
                class="prv-req"
                :class="`prv-req--${r.requirement}`"
                @click="onToggleRequirement(r)"
              >
                <Check
                  v-if="r.requirement === 'auto_in' || r.requirement === 'force_include'"
                  :size="13"
                  :stroke-width="2.5"
                />
                <X v-else :size="13" :stroke-width="2.5" />
                <span class="prv-req__label">
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
              <span
                v-if="r.status === 'signed'"
                class="prv-chip prv-chip--signed"
              >
                <Check :size="11" :stroke-width="2.5" />
                {{ r.ack?.signedMethod === 'admin_marked' ? 'Admin-marked' : 'Signed' }}
                <span class="prv-chip__date">·
                  {{ formatDate(r.ack?.acknowledgedAt ?? null) }}</span
                >
              </span>
              <span
                v-else-if="r.status === 'stale'"
                class="prv-chip prv-chip--stale"
              >
                <AlertTriangle :size="11" :stroke-width="2" />
                Stale (v{{ r.ack?.policyVersionAtSigning }})
              </span>
              <span v-else class="prv-chip prv-chip--not_signed">
                Not signed
              </span>
            </td>
            <td class="prv-table__actions">
              <button
                v-if="r.status !== 'signed' && r.requirement !== 'force_exclude'"
                type="button"
                class="prv-mark"
                :disabled="markingId === r.user.id"
                @click="onMark(r)"
              >
                <UserCheck :size="12" :stroke-width="2" />
                {{ markingId === r.user.id ? 'Marking…' : 'Mark acknowledged' }}
              </button>
            </td>
          </tr>
        </tbody>

        <tbody v-if="ptRows.length">
          <tr class="prv-table__group prv-table__group--pt">
            <td colspan="7">
              <span class="prv-table__group-label">Part-Time</span>
              <span class="prv-table__group-count">{{ ptRows.length }}</span>
            </td>
          </tr>
          <tr
            v-for="r in ptRows"
            :key="r.user.id"
            :class="`prv-row--${r.status}`"
          >
            <td>{{ r.user.fullName }}</td>
            <td class="prv-table__small">{{ r.user.shift ?? '—' }}</td>
            <td class="prv-table__small">{{ r.user.role }}</td>
            <td class="prv-table__small">PT</td>
            <td class="prv-table__req">
              <button
                type="button"
                class="prv-req"
                :class="`prv-req--${r.requirement}`"
                @click="onToggleRequirement(r)"
              >
                <Check
                  v-if="r.requirement === 'auto_in' || r.requirement === 'force_include'"
                  :size="13"
                  :stroke-width="2.5"
                />
                <X v-else :size="13" :stroke-width="2.5" />
                <span class="prv-req__label">
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
              <span
                v-if="r.status === 'signed'"
                class="prv-chip prv-chip--signed"
              >
                <Check :size="11" :stroke-width="2.5" />
                {{ r.ack?.signedMethod === 'admin_marked' ? 'Admin-marked' : 'Signed' }}
                <span class="prv-chip__date">·
                  {{ formatDate(r.ack?.acknowledgedAt ?? null) }}</span
                >
              </span>
              <span
                v-else-if="r.status === 'stale'"
                class="prv-chip prv-chip--stale"
              >
                <AlertTriangle :size="11" :stroke-width="2" />
                Stale (v{{ r.ack?.policyVersionAtSigning }})
              </span>
              <span v-else class="prv-chip prv-chip--not_signed">
                Not signed
              </span>
            </td>
            <td class="prv-table__actions">
              <button
                v-if="r.status !== 'signed' && r.requirement !== 'force_exclude'"
                type="button"
                class="prv-mark"
                :disabled="markingId === r.user.id"
                @click="onMark(r)"
              >
                <UserCheck :size="12" :stroke-width="2" />
                {{ markingId === r.user.id ? 'Marking…' : 'Mark acknowledged' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="outsideAudience.length" class="prv-outside">
        <button
          type="button"
          class="prv-outside__toggle"
          @click="showOutside = !showOutside"
        >
          {{ showOutside ? 'Hide' : 'Show' }} other employees
          ({{ outsideAudience.length }})
          <span class="prv-outside__hint">
            — outside the audience filter; click + to require for a specific person
          </span>
        </button>
        <ul v-if="showOutside" class="prv-outside__list">
          <li
            v-for="emp in outsideAudience"
            :key="emp.id"
            class="prv-outside__item"
          >
            <span class="prv-outside__name">{{ emp.fullName }}</span>
            <span class="prv-outside__meta">
              {{ emp.role }} · {{ emp.shift ?? '—' }} ·
              {{ emp.employmentType === 'full_time' ? 'FT' : 'PT' }}
            </span>
            <button
              type="button"
              class="prv-outside__add"
              @click="addToAudience(emp)"
            >
              + Require for this person
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prv {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .prv {
    padding: 40px 40px 80px;
  }
}
.prv__back {
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
.prv__back:hover {
  color: var(--color-ink-soft);
}
.prv__gate,
.prv__empty {
  margin-top: 24px;
  padding: 28px;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.prv__header {
  margin-bottom: 14px;
}
.prv__header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.prv__title {
  font-size: 24px;
  letter-spacing: -0.01em;
}
.prv__meta-row {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
  letter-spacing: 0.04em;
}

.prv-summary {
  padding: 16px !important;
}
.prv-summary__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.prv-summary__cell {
  padding: 0 8px;
  border-right: 1px solid var(--color-line);
}
.prv-summary__cell:last-of-type {
  border-right: none;
}
.prv-summary__big {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--color-brand-600);
  margin-top: 4px;
  line-height: 1;
}
.prv-summary__sub {
  font-size: 11.5px;
  color: var(--color-muted);
  margin-top: 4px;
}

.prv-filters {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (min-width: 640px) {
  .prv-filters {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
}
.prv-filters__group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.prv-filters__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.prv-filters__chip {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  cursor: pointer;
}
.prv-filters__chip--small {
  padding: 3px 9px;
  font-size: 11.5px;
}
.prv-filters__chip--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}

.prv-note {
  margin-top: 14px;
}
.prv-note__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prv-note__label > span:first-child {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.prv-note__input {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
}

.prv-error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 8px 12px;
}

.prv-table {
  margin-top: 18px;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.prv-table th,
.prv-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.prv-table th {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.prv-table__small {
  width: 80px;
  text-transform: capitalize;
}
.prv-table__actions {
  width: 1%;
  text-align: right;
}
.prv-table__group td {
  background: var(--color-surface-soft);
  border-bottom: 1px solid var(--color-line);
  padding: 8px 12px;
}
.prv-table__group-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: oklch(0.4 0.13 250);
}
.prv-table__group--pt .prv-table__group-label {
  color: oklch(0.45 0.13 75);
}
.prv-table__group-count {
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

.prv-row--signed {
  color: var(--color-muted);
}
.prv-chip {
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
.prv-chip--signed {
  color: var(--color-success-500);
  border-color: #c6e4d2;
  background: #f0f8f3;
}
.prv-chip--stale {
  color: oklch(0.5 0.13 60);
  border-color: oklch(0.85 0.07 60);
  background: oklch(0.97 0.06 60);
}
.prv-chip__date {
  font-family: var(--font-mono);
  font-weight: 500;
  margin-left: 2px;
}

.prv-mark {
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
.prv-mark:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.prv-mark:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.prv-table__req {
  width: 130px;
}
.prv-req {
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
}
.prv-req--auto_in {
  color: var(--color-success-500);
  background: #f0f8f3;
  border-color: #c6e4d2;
}
.prv-req--force_include {
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border-color: var(--color-brand-100);
}
.prv-req--force_exclude {
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border-color: oklch(0.85 0.07 20);
}

.prv-outside {
  margin-top: 18px;
  border-top: 1px dashed var(--color-line);
  padding-top: 14px;
}
.prv-outside__toggle {
  background: transparent;
  border: none;
  color: var(--color-brand-600);
  font-weight: 600;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
}
.prv-outside__toggle:hover {
  text-decoration: underline;
}
.prv-outside__hint {
  color: var(--color-muted);
  font-weight: 400;
  margin-left: 6px;
}
.prv-outside__list {
  list-style: none;
  margin: 10px 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prv-outside__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
  font-size: 13px;
}
.prv-outside__name {
  flex: 1;
  font-weight: 600;
}
.prv-outside__meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}
.prv-outside__add {
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
.prv-outside__add:hover {
  border-color: var(--color-brand-600);
  background: var(--color-brand-50);
}

/* Mobile card layout — same approach as the required-training roster. */
@media (max-width: 767px) {
  .prv-table { display: block; }
  .prv-table thead { display: none; }
  .prv-table tbody, .prv-table tr { display: block; }
  .prv-table td { display: block; padding: 0; border: none; }
  .prv-table__group { margin: 14px 0 6px; background: transparent !important; }
  .prv-table__group td { padding: 0; background: transparent; border: none; }
  .prv-table tbody tr:not(.prv-table__group) {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    grid-template-rows: auto auto;
    gap: 8px 10px;
    align-items: center;
    margin-bottom: 8px;
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    background: var(--color-surface);
  }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(1) {
    grid-column: 1 / 4; grid-row: 1;
    font-size: 14.5px; font-weight: 600; color: var(--color-ink);
  }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(6) {
    grid-column: 4; grid-row: 1; justify-self: end; text-align: right;
  }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(2),
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(3) {
    grid-row: 2;
    font-family: var(--font-mono); font-size: 11px;
    color: var(--color-muted); text-transform: capitalize; width: auto;
  }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(2) { grid-column: 1; }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(3) { grid-column: 2; }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(4) { display: none; }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(5) {
    grid-column: 3; grid-row: 2; justify-self: end; width: auto;
  }
  .prv-table tbody tr:not(.prv-table__group) td:nth-child(7) {
    grid-column: 4; grid-row: 2; justify-self: end; width: auto; text-align: right;
  }
  .prv-req { padding: 4px 8px; font-size: 11px; }
  .prv-req__label { white-space: nowrap; }
  .prv-chip__date { display: block; margin: 2px 0 0 0; font-size: 10.5px; }
  .prv-mark { padding: 5px 9px; font-size: 11.5px; white-space: nowrap; }
}
</style>
