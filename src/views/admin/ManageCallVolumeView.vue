<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { BarChart3, Plus, Trash2, Save, X, Edit2 } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useAuthStore } from '@/stores/auth'
import { useCallVolume } from '@/composables/useCallVolume'

const auth = useAuthStore()
const { ready, months, getMonth, latestMonth, saveMonth, deleteMonth } = useCallVolume()

interface UnitDraft {
  unitName: string
  runs: number
}
interface ZoneDraft {
  zoneName: string
  calls: number
}
interface FormDraft {
  month: string
  totalCalls: number
  avgResponseSeconds: number
  callsInDistrict: number
  callsOutOfDistrict: number
  totalPatients: number
  totalTransports: number
  unitHourUtilization: number
  airTransports: number
  units: UnitDraft[]
  zones: ZoneDraft[]
  /** True when adding a brand-new month (vs. editing an existing one). */
  isNew: boolean
}

/**
 * Admin enters avg response time as `mm:ss` to match the run report;
 * the schema stores seconds. Tiny helpers keep the conversion at the
 * UI boundary so the rest of the code stays in seconds.
 */
function secondsToMMSS(secs: number): string {
  if (!secs || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
function mmssToSeconds(mmss: string): number {
  const parts = mmss.split(':')
  if (parts.length !== 2) return 0
  const m = Number(parts[0])
  const s = Number(parts[1])
  if (Number.isNaN(m) || Number.isNaN(s)) return 0
  return Math.max(0, m * 60 + s)
}

const draft = ref<FormDraft | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)

const monthLabel = (m: string) =>
  new Date(m).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

const summaryByMonth = computed(() => {
  const map = new Map<string, ReturnType<typeof getMonth>>()
  for (const m of months.value) map.set(m, getMonth(m))
  return map
})

function firstOfThisMonth(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}-01`
}

function startCreate() {
  /* Seed unit + zone names from the latest month so admins don't
     retype them each cycle. Counts start at 0 — the admin enters
     fresh numbers off the run report. */
  const seedMonth = latestMonth()
  const seedSnap = seedMonth ? getMonth(seedMonth) : null
  draft.value = {
    month: firstOfThisMonth(),
    totalCalls: 0,
    avgResponseSeconds: 0,
    callsInDistrict: 0,
    callsOutOfDistrict: 0,
    totalPatients: 0,
    totalTransports: 0,
    unitHourUtilization: 0,
    airTransports: 0,
    units: seedSnap
      ? seedSnap.units.map((u) => ({ unitName: u.unitName, runs: 0 }))
      : [{ unitName: '', runs: 0 }],
    zones: seedSnap
      ? seedSnap.zones.map((z) => ({ zoneName: z.zoneName, calls: 0 }))
      : [{ zoneName: '', calls: 0 }],
    isNew: true,
  }
  error.value = null
}

function startEdit(month: string) {
  const snap = getMonth(month)
  draft.value = {
    month,
    totalCalls: snap.summary.totalCalls,
    avgResponseSeconds: snap.summary.avgResponseSeconds,
    callsInDistrict: snap.summary.callsInDistrict,
    callsOutOfDistrict: snap.summary.callsOutOfDistrict,
    totalPatients: snap.summary.totalPatients,
    totalTransports: snap.summary.totalTransports,
    unitHourUtilization: snap.summary.unitHourUtilization,
    airTransports: snap.summary.airTransports,
    units: snap.units.map((u) => ({ unitName: u.unitName, runs: u.runs })),
    zones: snap.zones.map((z) => ({ zoneName: z.zoneName, calls: z.calls })),
    isNew: false,
  }
  error.value = null
}

function cancel() {
  draft.value = null
  error.value = null
}

function addUnit() {
  if (!draft.value) return
  draft.value.units.push({ unitName: '', runs: 0 })
}
function removeUnit(i: number) {
  if (!draft.value) return
  draft.value.units.splice(i, 1)
}
function addZone() {
  if (!draft.value) return
  draft.value.zones.push({ zoneName: '', calls: 0 })
}
function removeZone(i: number) {
  if (!draft.value) return
  draft.value.zones.splice(i, 1)
}

async function onSave() {
  if (!draft.value || saving.value) return
  saving.value = true
  error.value = null
  const result = await saveMonth({
    month: draft.value.month,
    summary: {
      totalCalls: draft.value.totalCalls,
      totalPatients: draft.value.totalPatients,
      totalTransports: draft.value.totalTransports,
      avgResponseSeconds: draft.value.avgResponseSeconds,
      callsInDistrict: draft.value.callsInDistrict,
      callsOutOfDistrict: draft.value.callsOutOfDistrict,
      unitHourUtilization: draft.value.unitHourUtilization,
      airTransports: draft.value.airTransports,
    },
    units: draft.value.units,
    zones: draft.value.zones,
  })
  saving.value = false
  if (!result.ok) {
    error.value = result.error
    return
  }
  draft.value = null
}

async function onDelete(month: string) {
  if (!confirm(`Delete all call-volume data for ${monthLabel(month)}? This cannot be undone.`)) {
    return
  }
  const result = await deleteMonth(month)
  if (!result.ok) alert(result.error)
}

/* Live preview of computed unit percentage so admins can sanity-check
   their entered numbers against the headline total. */
const unitsTotal = computed(() =>
  draft.value ? draft.value.units.reduce((s, u) => s + (Number(u.runs) || 0), 0) : 0,
)
const zonesTotal = computed(() =>
  draft.value ? draft.value.zones.reduce((s, z) => s + (Number(z.calls) || 0), 0) : 0,
)

/* Keep numeric inputs from going negative — common typo. */
watch(
  draft,
  (d) => {
    if (!d) return
    for (const u of d.units) {
      if (u.runs < 0) u.runs = 0
    }
    for (const z of d.zones) {
      if (z.calls < 0) z.calls = 0
    }
    if (d.totalCalls < 0) d.totalCalls = 0
    if (d.totalPatients < 0) d.totalPatients = 0
    if (d.totalTransports < 0) d.totalTransports = 0
    if (d.avgResponseSeconds < 0) d.avgResponseSeconds = 0
    if (d.callsInDistrict < 0) d.callsInDistrict = 0
    if (d.callsOutOfDistrict < 0) d.callsOutOfDistrict = 0
    if (d.unitHourUtilization < 0) d.unitHourUtilization = 0
    if (d.airTransports < 0) d.airTransports = 0
  },
  { deep: true },
)

/* mm:ss bound input proxy for avg response time. */
const avgResponseText = computed({
  get: () => (draft.value ? secondsToMMSS(draft.value.avgResponseSeconds) : '0:00'),
  set: (v: string) => {
    if (draft.value) draft.value.avgResponseSeconds = mmssToSeconds(v)
  },
})
</script>

<template>
  <div class="mcv">
    <header class="mcv__header">
      <div class="flex items-center gap-2">
        <BarChart3 :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mcv__title">Manage Call Volume</h1>
      </div>
      <p class="mcv__sub">
        Monthly run totals, per-unit breakdowns, and zone calls. Visible to every signed-in crew on
        <code>/insights</code>.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mcv__gate">Admin only.</div>

    <template v-else>
      <div v-if="!draft" class="mcv__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> Add a month
        </button>
      </div>

      <!-- Edit / create form -->
      <AppCard v-if="draft" class="mcv-form">
        <Eyebrow class="mb-3">
          {{ draft.isNew ? 'New month' : 'Edit month' }}
        </Eyebrow>

        <form @submit.prevent="onSave">
          <section class="mcv-form__section">
            <div class="mcv-form__section-head display">Report month</div>
            <div class="mcv-form__field-row">
              <label class="mcv-form__field">
                <span class="mcv-form__label">Month (first of)</span>
                <input
                  v-model="draft.month"
                  type="date"
                  class="mcv-form__input"
                  :disabled="!draft.isNew"
                />
                <span v-if="!draft.isNew" class="mcv-form__hint">
                  The month key can't change — delete and re-add if you need a different month.
                </span>
              </label>
            </div>
          </section>

          <section class="mcv-form__section">
            <div class="mcv-form__section-head display">Department totals</div>
            <div class="mcv-form__field-row">
              <label class="mcv-form__field">
                <span class="mcv-form__label">Total # of incidents</span>
                <input
                  v-model.number="draft.totalCalls"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
              <label class="mcv-form__field">
                <span class="mcv-form__label">Avg response (mm:ss)</span>
                <input
                  v-model="avgResponseText"
                  type="text"
                  inputmode="numeric"
                  placeholder="10:31"
                  class="mcv-form__input"
                />
              </label>
            </div>
          </section>

          <section class="mcv-form__section">
            <div class="mcv-form__section-head display">EMS calls</div>
            <div class="mcv-form__field-row">
              <label class="mcv-form__field">
                <span class="mcv-form__label"># calls in district</span>
                <input
                  v-model.number="draft.callsInDistrict"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
              <label class="mcv-form__field">
                <span class="mcv-form__label"># calls out of district</span>
                <input
                  v-model.number="draft.callsOutOfDistrict"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
              <label class="mcv-form__field">
                <span class="mcv-form__label"># of patients</span>
                <input
                  v-model.number="draft.totalPatients"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
              <label class="mcv-form__field">
                <span class="mcv-form__label"># patients transported</span>
                <input
                  v-model.number="draft.totalTransports"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
            </div>
            <div class="mcv-form__field-row" style="margin-top: 10px;">
              <label class="mcv-form__field">
                <span class="mcv-form__label">Unit hour utilization (UHU)</span>
                <input
                  v-model.number="draft.unitHourUtilization"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="0.091"
                  class="mcv-form__input"
                />
                <span class="mcv-form__hint">Decimal, three places (e.g. 0.091).</span>
              </label>
              <label class="mcv-form__field">
                <span class="mcv-form__label">Air transports / LZ</span>
                <input
                  v-model.number="draft.airTransports"
                  type="number"
                  min="0"
                  class="mcv-form__input"
                />
              </label>
            </div>
          </section>

          <section class="mcv-form__section">
            <div class="mcv-form__section-head display">
              <span>Per-unit runs</span>
              <span class="mcv-form__total">Sum: {{ unitsTotal }}</span>
            </div>
            <table class="mcv-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th class="num">Runs</th>
                  <th class="num">%</th>
                  <th class="actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(u, i) in draft.units" :key="i">
                  <td>
                    <input
                      v-model="u.unitName"
                      type="text"
                      class="mcv-table__input"
                      placeholder="Medic 211"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="u.runs"
                      type="number"
                      min="0"
                      class="mcv-table__input num"
                    />
                  </td>
                  <td class="num mcv-table__pct">
                    {{ unitsTotal > 0 ? ((Number(u.runs) || 0) / unitsTotal * 100).toFixed(2) : '0.00' }}%
                  </td>
                  <td class="actions">
                    <button
                      type="button"
                      class="mcv-table__row-btn"
                      aria-label="Remove unit row"
                      @click="removeUnit(i)"
                    >
                      <Trash2 :size="13" :stroke-width="1.85" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button type="button" class="mcv-form__add-row" @click="addUnit">
              <Plus :size="13" :stroke-width="1.85" /> Add unit
            </button>
          </section>

          <section class="mcv-form__section">
            <div class="mcv-form__section-head display">
              <span>Per-zone calls</span>
              <span class="mcv-form__total">Sum: {{ zonesTotal }}</span>
            </div>
            <table class="mcv-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th class="num">Calls</th>
                  <th class="num">%</th>
                  <th class="actions"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(z, i) in draft.zones" :key="i">
                  <td>
                    <input
                      v-model="z.zoneName"
                      type="text"
                      class="mcv-table__input"
                      placeholder="Dist 1"
                    />
                  </td>
                  <td>
                    <input
                      v-model.number="z.calls"
                      type="number"
                      min="0"
                      class="mcv-table__input num"
                    />
                  </td>
                  <td class="num mcv-table__pct">
                    {{ zonesTotal > 0 ? ((Number(z.calls) || 0) / zonesTotal * 100).toFixed(2) : '0.00' }}%
                  </td>
                  <td class="actions">
                    <button
                      type="button"
                      class="mcv-table__row-btn"
                      aria-label="Remove zone row"
                      @click="removeZone(i)"
                    >
                      <Trash2 :size="13" :stroke-width="1.85" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <button type="button" class="mcv-form__add-row" @click="addZone">
              <Plus :size="13" :stroke-width="1.85" /> Add zone
            </button>
          </section>

          <div v-if="error" class="mcv-form__error">{{ error }}</div>

          <div class="mcv-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancel">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : 'Save month' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- Month list -->
      <div v-if="!ready" class="mcv__empty">Loading…</div>
      <div v-else-if="months.length === 0" class="mcv__empty">
        No months entered yet. Click "Add a month" to enter the first one.
      </div>
      <div v-else class="mcv-list">
        <AppCard v-for="m in [...months].reverse()" :key="m" class="mcv-row">
          <div class="mcv-row__main">
            <div class="display mcv-row__name">{{ monthLabel(m) }}</div>
            <div class="mcv-row__meta">
              <span>{{ summaryByMonth.get(m)?.summary.totalCalls ?? 0 }} calls</span>
              <span>· {{ summaryByMonth.get(m)?.units.length ?? 0 }} units</span>
              <span>· {{ summaryByMonth.get(m)?.zones.length ?? 0 }} zones</span>
            </div>
          </div>
          <div class="mcv-row__actions">
            <button type="button" class="mcv-row__btn" @click="startEdit(m)">
              <Edit2 :size="13" :stroke-width="1.85" /> Edit
            </button>
            <button type="button" class="mcv-row__btn mcv-row__btn--danger" @click="onDelete(m)">
              <Trash2 :size="13" :stroke-width="1.85" /> Delete
            </button>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mcv {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mcv {
    padding: 40px 40px 80px;
  }
}

.mcv__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .mcv__title {
    font-size: 36px;
  }
}
.mcv__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}
.mcv__sub code {
  font-size: 12px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 0 4px;
}

.mcv__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mcv__toolbar {
  margin-top: 18px;
  display: flex;
  gap: 8px;
}

.mcv__empty {
  margin-top: 24px;
  padding: 28px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mcv-list {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mcv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px !important;
}
.mcv-row__name {
  font-size: 16px;
  letter-spacing: -0.005em;
}
.mcv-row__meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mcv-row__actions {
  display: inline-flex;
  gap: 6px;
}
.mcv-row__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.mcv-row__btn:hover {
  border-color: var(--color-muted-soft);
}
.mcv-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}

.mcv-form {
  margin-top: 18px;
  padding: 18px !important;
}
.mcv-form__section {
  margin-top: 14px;
}
.mcv-form__section:first-of-type {
  margin-top: 4px;
}
.mcv-form__section-head {
  font-size: 14px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.mcv-form__total {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}

.mcv-form__field-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 640px) {
  .mcv-form__field-row {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 1024px) {
  .mcv-form__field-row {
    grid-template-columns: repeat(4, 1fr);
  }
}

.mcv-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcv-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mcv-form__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.mcv-form__input {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.mcv-form__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.mcv-form__input:disabled {
  opacity: 0.6;
}

.mcv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.mcv-table th,
.mcv-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.mcv-table th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mcv-table th.num,
.mcv-table td.num {
  text-align: right;
}
.mcv-table th.actions,
.mcv-table td.actions {
  width: 36px;
  text-align: right;
}
.mcv-table__input {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 8px;
  outline: none;
  transition:
    border-color 120ms var(--ease-out),
    background 120ms var(--ease-out);
}
.mcv-table__input:hover {
  border-color: var(--color-line);
}
.mcv-table__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.mcv-table__input.num {
  font-family: var(--font-mono);
  text-align: right;
}
.mcv-table__pct {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
}
.mcv-table__row-btn {
  background: transparent;
  border: none;
  color: var(--color-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
}
.mcv-table__row-btn:hover {
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
}

.mcv-form__add-row {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  color: var(--color-brand-600);
  border: 1px dashed var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.mcv-form__add-row:hover {
  border-color: var(--color-brand-600);
}

.mcv-form__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.mcv-form__actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.btn-primary {
  background: var(--color-brand-600);
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
