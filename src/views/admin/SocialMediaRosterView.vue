<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Camera, Check, Download, FileSignature, Search, X } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useSocialMediaRelease } from '@/composables/useSocialMediaRelease'
import { generateSocialMediaReleasePdf } from '@/lib/socialMediaReleasePdf'
import { supabase } from '@/lib/supabase'
import type { EmploymentType, SocialMediaRelease } from '@/types'

/**
 * Admin roster for the Social Media Release: who's authorized, who
 * declined, who hasn't signed. The audience is field staff (station
 * not matching /admin/i — same office-staff test the profile prompt
 * uses); office/admin staff appear in a collapsed group so their
 * releases are still recorded without polluting the outstanding count.
 *
 * "Record paper form" covers releases already signed on paper — the
 * row is admin_marked and its PDF says "paper form on file".
 */

interface Employee {
  id: string
  fullName: string
  title: string | null
  station: string | null
  employmentType: EmploymentType
}

const auth = useAuthStore()
const { ready, releaseFor, adminMark } = useSocialMediaRelease()

const roster = ref<Employee[]>([])
const rosterError = ref<string | null>(null)

async function loadRoster() {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, full_name, title, station, employment_type, active, account_type')
    .eq('active', true)
    .eq('account_type', 'person')
    .order('full_name')
  if (error) {
    rosterError.value = error.message
    return
  }
  roster.value = (data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    title: r.title,
    station: r.station,
    employmentType: (r.employment_type ?? 'full_time') as EmploymentType,
  }))
}

onMounted(() => {
  if (auth.isAdmin) void loadRoster()
})

function isOfficeStaff(e: Employee): boolean {
  return /admin/i.test(e.station ?? '')
}

interface Row {
  user: Employee
  release: SocialMediaRelease | null
  status: 'authorized' | 'declined' | 'outstanding'
}

function toRow(user: Employee): Row {
  const release = releaseFor(user.id)
  const status: Row['status'] = release
    ? release.authorized
      ? 'authorized'
      : 'declined'
    : 'outstanding'
  return { user, release, status }
}

const fieldRows = computed<Row[]>(() =>
  roster.value.filter((e) => !isOfficeStaff(e)).map(toRow),
)
const officeRows = computed<Row[]>(() =>
  roster.value.filter(isOfficeStaff).map(toRow),
)

const summary = computed(() => {
  const authorized = fieldRows.value.filter((r) => r.status === 'authorized').length
  const declined = fieldRows.value.filter((r) => r.status === 'declined').length
  const outstanding = fieldRows.value.filter((r) => r.status === 'outstanding').length
  return { authorized, declined, outstanding, total: fieldRows.value.length }
})

type FilterKey = 'all' | 'outstanding' | 'authorized' | 'declined'
const filter = ref<FilterKey>('all')
const search = ref('')
const showOffice = ref(false)

const visibleRows = computed(() =>
  fieldRows.value.filter((r) => {
    if (filter.value !== 'all' && r.status !== filter.value) return false
    if (
      search.value &&
      !r.user.fullName.toLowerCase().includes(search.value.toLowerCase())
    )
      return false
    return true
  }),
)

/* ── Record-paper-form dialog ─────────────────────────────────────── */
const markTarget = ref<Employee | null>(null)
const markAuthorized = ref<boolean | null>(null)
const markRestrictions = ref('')
const markNote = ref('')
const markError = ref<string | null>(null)
const markSaving = ref(false)

function openMark(user: Employee) {
  markTarget.value = user
  const existing = releaseFor(user.id)
  markAuthorized.value = existing?.authorized ?? null
  markRestrictions.value = existing?.restrictions ?? ''
  markNote.value = ''
  markError.value = null
}

async function saveMark() {
  if (!markTarget.value || markAuthorized.value === null) return
  markSaving.value = true
  markError.value = null
  const result = await adminMark({
    userId: markTarget.value.id,
    authorized: markAuthorized.value,
    restrictions: markRestrictions.value,
    note: markNote.value,
  })
  markSaving.value = false
  if (!result.ok) {
    markError.value = result.error
    return
  }
  markTarget.value = null
}

const markerNames = ref<Record<string, string>>({})
async function markerNameFor(id: string | null): Promise<string | null> {
  if (!id) return null
  if (markerNames.value[id]) return markerNames.value[id]
  const { data } = await supabase
    .from('app_users')
    .select('full_name')
    .eq('id', id)
    .maybeSingle()
  const name = data?.full_name ?? null
  if (name) markerNames.value = { ...markerNames.value, [id]: name }
  return name
}

async function downloadPdf(row: Row) {
  if (!row.release) return
  const markedByName = await markerNameFor(row.release.markedBy)
  const doc = await generateSocialMediaReleasePdf({
    employeeName: row.user.fullName,
    employeeTitle: row.user.title,
    release: row.release,
    markedByName,
  })
  const safeName = row.user.fullName.replace(/\s+/g, '_').replace(/[^\w-]/g, '')
  doc.save(`WCEMS_Social_Media_Release_${safeName}.pdf`)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusLabel(s: Row['status']): string {
  return s === 'authorized' ? 'Authorized' : s === 'declined' ? 'Declined' : 'Outstanding'
}
</script>

<template>
  <div class="smra">
    <header class="smra__header">
      <div class="smra__head-left">
        <Camera :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <div>
          <h1 class="display smra__title">Social Media Releases</h1>
          <div class="smra__meta">
            Photo &amp; video authorizations — field staff audience
          </div>
        </div>
      </div>
    </header>

    <div v-if="rosterError" class="smra__error">{{ rosterError }}</div>
    <div v-else-if="!ready || roster.length === 0" class="smra__empty">Loading…</div>

    <template v-else>
      <!-- Stat tiles double as filters -->
      <div class="smra__stats">
        <button
          type="button"
          class="smra__stat"
          :class="{ 'smra__stat--active': filter === 'all' }"
          @click="filter = 'all'"
        >
          <span class="smra__stat-num">{{ summary.total }}</span>
          <span class="smra__stat-label">Field staff</span>
        </button>
        <button
          type="button"
          class="smra__stat smra__stat--yes"
          :class="{ 'smra__stat--active': filter === 'authorized' }"
          @click="filter = 'authorized'"
        >
          <span class="smra__stat-num">{{ summary.authorized }}</span>
          <span class="smra__stat-label">Authorized</span>
        </button>
        <button
          type="button"
          class="smra__stat smra__stat--no"
          :class="{ 'smra__stat--active': filter === 'declined' }"
          @click="filter = 'declined'"
        >
          <span class="smra__stat-num">{{ summary.declined }}</span>
          <span class="smra__stat-label">Declined</span>
        </button>
        <button
          type="button"
          class="smra__stat smra__stat--out"
          :class="{ 'smra__stat--active': filter === 'outstanding' }"
          @click="filter = 'outstanding'"
        >
          <span class="smra__stat-num">{{ summary.outstanding }}</span>
          <span class="smra__stat-label">Outstanding</span>
        </button>
      </div>

      <div class="smra__searchbar">
        <Search :size="14" :stroke-width="2" />
        <input v-model="search" type="search" placeholder="Search by name…" />
      </div>

      <div class="smra__list">
        <div v-for="row in visibleRows" :key="row.user.id" class="smra__row">
          <div class="smra__row-id">
            <span class="smra__row-name">{{ row.user.fullName }}</span>
            <span class="smra__row-title">{{ row.user.title ?? '' }}</span>
          </div>
          <span class="smra__chip" :class="`smra__chip--${row.status}`">
            <Check v-if="row.status === 'authorized'" :size="11" :stroke-width="2.5" />
            <X v-else-if="row.status === 'declined'" :size="11" :stroke-width="2.5" />
            {{ statusLabel(row.status) }}
          </span>
          <span class="smra__row-date">
            <template v-if="row.release">
              {{ formatDate(row.release.signedAt) }}
              <span v-if="row.release.signedMethod === 'admin_marked'" class="smra__row-paper">paper</span>
            </template>
            <template v-else>—</template>
          </span>
          <div class="smra__row-actions">
            <button
              v-if="row.release"
              type="button"
              class="smra__icon-btn"
              title="Download PDF for personnel file"
              @click="downloadPdf(row)"
            >
              <Download :size="14" :stroke-width="2" />
            </button>
            <button
              v-if="!row.release"
              type="button"
              class="smra__icon-btn"
              title="Record a paper form on file"
              @click="openMark(row.user)"
            >
              <FileSignature :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>
        <div v-if="visibleRows.length === 0" class="smra__empty">
          No one matches this filter.
        </div>
      </div>

      <!-- Office / admin staff (not counted as outstanding) -->
      <button
        type="button"
        class="smra__office-toggle"
        @click="showOffice = !showOffice"
      >
        {{ showOffice ? 'Hide' : 'Show' }} office &amp; admin staff ({{ officeRows.length }})
      </button>
      <div v-if="showOffice" class="smra__list">
        <div v-for="row in officeRows" :key="row.user.id" class="smra__row">
          <div class="smra__row-id">
            <span class="smra__row-name">{{ row.user.fullName }}</span>
            <span class="smra__row-title">{{ row.user.title ?? '' }}</span>
          </div>
          <span class="smra__chip" :class="`smra__chip--${row.status}`">
            {{ row.release ? statusLabel(row.status) : 'Not signed' }}
          </span>
          <span class="smra__row-date">
            {{ row.release ? formatDate(row.release.signedAt) : '—' }}
          </span>
          <div class="smra__row-actions">
            <button
              v-if="row.release"
              type="button"
              class="smra__icon-btn"
              title="Download PDF for personnel file"
              @click="downloadPdf(row)"
            >
              <Download :size="14" :stroke-width="2" />
            </button>
            <button
              v-else
              type="button"
              class="smra__icon-btn"
              title="Record a paper form on file"
              @click="openMark(row.user)"
            >
              <FileSignature :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Record-paper-form dialog -->
    <div v-if="markTarget" class="smra__overlay" @click.self="markTarget = null">
      <div class="smra__dialog">
        <h2 class="display smra__dialog-title">Record paper form</h2>
        <p class="smra__dialog-sub">
          {{ markTarget.fullName }} — use this when a signed paper release is
          already in the personnel file.
        </p>
        <div class="smra__dialog-options">
          <label>
            <input v-model="markAuthorized" type="radio" :value="true" />
            YES — authorized
          </label>
          <label>
            <input v-model="markAuthorized" type="radio" :value="false" />
            NO — declined
          </label>
        </div>
        <textarea
          v-model="markRestrictions"
          rows="2"
          class="smra__dialog-input"
          placeholder="Restrictions noted on the paper form (optional)"
        ></textarea>
        <textarea
          v-model="markNote"
          rows="2"
          class="smra__dialog-input"
          placeholder="Note, e.g. 'paper form dated 3/2026 in personnel file' (optional)"
        ></textarea>
        <div v-if="markError" class="smra__error">{{ markError }}</div>
        <div class="smra__dialog-actions">
          <button type="button" class="smra__ghost-btn" @click="markTarget = null">
            Cancel
          </button>
          <button
            type="button"
            class="smra__submit"
            :disabled="markAuthorized === null || markSaving"
            @click="saveMark"
          >
            {{ markSaving ? 'Saving…' : 'Record' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.smra {
  max-width: 880px;
  margin: 0 auto;
}
.smra__header {
  margin-bottom: 20px;
}
.smra__head-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.smra__title {
  font-size: 26px;
  line-height: 1.15;
  color: var(--color-ink);
}
.smra__meta {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-muted);
}
.smra__empty {
  padding: 28px 0;
  text-align: center;
  font-size: 13.5px;
  color: var(--color-muted);
}
.smra__error {
  font-size: 13px;
  color: oklch(0.5 0.16 30);
  margin: 8px 0;
}

/* Stats */
.smra__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.smra__stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  border-radius: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: border-color 120ms var(--ease-out);
}
.smra__stat--active {
  border-color: var(--color-brand-600);
}
.smra__stat-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-ink);
}
.smra__stat--yes .smra__stat-num {
  color: oklch(0.5 0.14 150);
}
.smra__stat--no .smra__stat-num {
  color: oklch(0.5 0.14 30);
}
.smra__stat--out .smra__stat-num {
  color: oklch(0.6 0.13 60);
}
.smra__stat-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/* Search */
.smra__searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  border-radius: 10px;
  margin-bottom: 14px;
  color: var(--color-muted);
}
.smra__searchbar input {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
}

/* Rows */
.smra__list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-surface);
}
.smra__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-line);
}
.smra__row:last-child {
  border-bottom: none;
}
.smra__row-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.smra__row-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.smra__row-title {
  font-size: 11.5px;
  color: var(--color-muted);
}
.smra__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 999px;
  padding: 3px 9px;
  flex-shrink: 0;
}
.smra__chip--authorized {
  background: oklch(0.95 0.05 150);
  color: oklch(0.42 0.13 150);
}
.smra__chip--declined {
  background: oklch(0.95 0.03 30);
  color: oklch(0.45 0.14 30);
}
.smra__chip--outstanding {
  background: var(--color-surface-soft);
  color: var(--color-muted);
  border: 1px dashed var(--color-muted-soft);
}
.smra__row-date {
  width: 96px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-ink-soft);
  text-align: right;
}
.smra__row-paper {
  display: inline-block;
  margin-left: 4px;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.smra__row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.smra__icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.smra__icon-btn:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}

.smra__office-toggle {
  margin: 14px 0 10px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Dialog */
.smra__overlay {
  position: fixed;
  inset: 0;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 80;
}
.smra__dialog {
  width: 100%;
  max-width: 440px;
  background: var(--color-surface);
  border-radius: 14px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.smra__dialog-title {
  font-size: 20px;
  color: var(--color-ink);
}
.smra__dialog-sub {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.smra__dialog-options {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--color-ink);
}
.smra__dialog-options label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.smra__dialog-input {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 2px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 10px;
  resize: vertical;
}
.smra__dialog-input:focus {
  outline: none;
  border-color: var(--color-brand-600);
}
.smra__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.smra__submit {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: white;
  background: var(--color-brand-800);
  border: none;
  border-radius: 8px;
  padding: 9px 18px;
  cursor: pointer;
}
.smra__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.smra__ghost-btn {
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}

@media (max-width: 640px) {
  .smra__stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .smra__row-date {
    display: none;
  }
}
</style>
