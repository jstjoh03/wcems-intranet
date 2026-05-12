<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { GraduationCap, RefreshCw, Trash2, EyeOff, Eye, Save } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

interface SessionRow {
  id: string
  service_id: string | null
  title: string
  local_start: string
  total_capacity: number
  remaining_capacity: number
  location: string
  instructor: string
}

interface ExcludedRow {
  service_id: string
  name: string
  excluded_at: string
}

interface SessionDraft extends SessionRow {
  /** Local-only flag — true while a save is in flight. */
  saving?: boolean
  /** Shown briefly after a successful save. */
  savedTick?: boolean
}

const auth = useAuthStore()
const sessions = ref<SessionDraft[]>([])
const excluded = ref<ExcludedRow[]>([])
const loading = ref(true)
const syncing = ref(false)
const lastSyncResult = ref<string | null>(null)
const error = ref<string | null>(null)

async function loadAll() {
  loading.value = true
  error.value = null
  const [sessionsRes, excludedRes] = await Promise.all([
    supabase
      .from('training_sessions')
      .select(
        'id, service_id, title, local_start, total_capacity, remaining_capacity, location, instructor',
      )
      .order('local_start', { ascending: true }),
    supabase
      .from('training_excluded_services')
      .select('service_id, name, excluded_at')
      .order('name'),
  ])
  if (sessionsRes.error) error.value = sessionsRes.error.message
  if (excludedRes.error) error.value = excludedRes.error.message
  sessions.value = (sessionsRes.data ?? []).map((r) => ({ ...(r as SessionRow) }))
  excluded.value = (excludedRes.data ?? []) as ExcludedRow[]
  loading.value = false
}

onMounted(loadAll)

async function saveInstructor(s: SessionDraft) {
  const trimmed = s.instructor.trim()
  if (s.saving) return
  s.saving = true
  const { error: updErr } = await supabase
    .from('training_sessions')
    .update({ instructor: trimmed })
    .eq('id', s.id)
  s.saving = false
  if (updErr) {
    alert(`Failed to save instructor: ${updErr.message}`)
    return
  }
  s.instructor = trimmed
  s.savedTick = true
  setTimeout(() => {
    s.savedTick = false
  }, 1400)
}

async function excludeService(s: SessionDraft) {
  if (!s.service_id) {
    alert("This session doesn't have a service_id — can't exclude.")
    return
  }
  const title = s.title || 'this service'
  if (
    !confirm(
      `Exclude "${title}" from future syncs?\n\nAll sessions of this service will be removed from the dashboard. Future Wix sync runs will skip it. You can re-include it later.`,
    )
  ) {
    return
  }
  const { error: insErr } = await supabase
    .from('training_excluded_services')
    .upsert(
      {
        service_id: s.service_id,
        name: title,
        excluded_by: auth.appUser?.id ?? null,
      },
      { onConflict: 'service_id' },
    )
  if (insErr) {
    alert(`Failed to exclude: ${insErr.message}`)
    return
  }
  /* Drop all sessions of that service from the table immediately so
     the admin sees the effect without waiting for the next cron tick. */
  const { error: delErr } = await supabase
    .from('training_sessions')
    .delete()
    .eq('service_id', s.service_id)
  if (delErr) {
    alert(`Excluded, but failed to clean up existing sessions: ${delErr.message}`)
  }
  await loadAll()
}

async function reincludeService(e: ExcludedRow) {
  if (!confirm(`Re-include "${e.name}"? It'll come back on the next sync.`)) return
  const { error: delErr } = await supabase
    .from('training_excluded_services')
    .delete()
    .eq('service_id', e.service_id)
  if (delErr) {
    alert(`Failed to re-include: ${delErr.message}`)
    return
  }
  excluded.value = excluded.value.filter((x) => x.service_id !== e.service_id)
}

async function syncNow() {
  if (syncing.value) return
  syncing.value = true
  lastSyncResult.value = null
  const { data, error: invErr } = await supabase.functions.invoke('sync-wix-training', {
    body: {},
  })
  syncing.value = false
  if (invErr) {
    lastSyncResult.value = `Error: ${invErr.message}`
    return
  }
  if (data?.ok) {
    lastSyncResult.value = `Synced ${data.syncedCount ?? 0} sessions.`
    await loadAll()
  } else {
    lastSyncResult.value = `Function returned: ${JSON.stringify(data)}`
  }
}

function formatDate(iso: string): string {
  const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!parts) return iso
  const [, y, mo, d, hh, mm] = parts
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm))
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!parts) return ''
  const [, , , , hh, mm] = parts
  let h = Number(hh)
  const m = Number(mm)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m === 0 ? `${h}:00 ${ampm}` : `${h}:${mm} ${ampm}`
}

/* Flat chronological list, soonest first, so nothing gets buried
   in a service group. */
const sortedSessions = computed(() =>
  [...sessions.value].sort((a, b) => a.local_start.localeCompare(b.local_start)),
)
</script>

<template>
  <div class="mt">
    <header class="mt__header">
      <div class="flex items-center gap-2">
        <GraduationCap :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mt__title">Manage Training</h1>
      </div>
      <p class="mt__sub">
        Wix bookings sync into the dashboard every 15 minutes. Exclude public courses, edit
        instructor names, or trigger a sync on demand.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mt__gate">Admin only.</div>

    <template v-else>
      <div class="mt__toolbar">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="syncing"
          @click="syncNow"
        >
          <RefreshCw :size="14" :stroke-width="2" :class="syncing ? 'spin' : ''" />
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
        <span v-if="lastSyncResult" class="mt__sync-result">{{ lastSyncResult }}</span>
      </div>

      <div v-if="error" class="mt__error">{{ error }}</div>

      <!-- Excluded services -->
      <section v-if="excluded.length > 0" class="mt__section">
        <Eyebrow class="mb-3">Excluded services</Eyebrow>
        <AppCard
          v-for="e in excluded"
          :key="e.service_id"
          class="mt__excluded-row"
        >
          <div class="mt__excluded-main">
            <EyeOff :size="14" :stroke-width="1.85" class="mt__excluded-icon" />
            <div>
              <div class="display mt__excluded-name">{{ e.name }}</div>
              <div class="mt__excluded-meta">
                ID {{ e.service_id }} · excluded {{ new Date(e.excluded_at).toLocaleDateString() }}
              </div>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost"
            @click="reincludeService(e)"
          >
            <Eye :size="13" :stroke-width="1.85" /> Re-include
          </button>
        </AppCard>
      </section>

      <!-- Upcoming sessions, sorted soonest-first -->
      <section class="mt__section">
        <Eyebrow class="mb-3">Upcoming sessions</Eyebrow>

        <div v-if="loading" class="mt__empty">Loading…</div>
        <div v-else-if="sortedSessions.length === 0" class="mt__empty">
          No sessions synced yet. Hit "Sync now" above.
        </div>

        <AppCard
          v-for="s in sortedSessions"
          :key="s.id"
          class="mt__session-card"
        >
          <div class="mt__session-grid">
            <div class="mt__session-date">
              <div class="mt__session-day">{{ formatDate(s.local_start) }}</div>
              <div class="mt__session-time">{{ formatTime(s.local_start) }}</div>
            </div>
            <div class="mt__session-body">
              <div class="display mt__session-title">{{ s.title || '(untitled)' }}</div>
              <div class="mt__session-meta">
                <span v-if="s.location">{{ s.location }}</span>
                <span v-if="s.location"> · </span>
                <span>{{ s.total_capacity - s.remaining_capacity }}/{{ s.total_capacity }} registered</span>
              </div>
            </div>
            <div class="mt__session-instructor">
              <label class="mt__instructor-label" :for="`instructor-${s.id}`">Instructor</label>
              <div class="mt__instructor-row">
                <input
                  :id="`instructor-${s.id}`"
                  v-model="s.instructor"
                  type="text"
                  maxlength="80"
                  placeholder="—"
                  class="mt__instructor-input"
                  @blur="saveInstructor(s)"
                  @keydown.enter.prevent="saveInstructor(s)"
                />
                <Save v-if="s.saving" :size="13" class="mt__instructor-spinner spin" />
                <span v-else-if="s.savedTick" class="mt__instructor-saved">Saved</span>
              </div>
            </div>
            <button
              v-if="s.service_id"
              type="button"
              class="mt__exclude-btn"
              :title="`Exclude all sessions of '${s.title}' from future syncs`"
              @click="excludeService(s)"
            >
              <Trash2 :size="13" :stroke-width="1.85" /> Exclude service
            </button>
          </div>
        </AppCard>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mt {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mt {
    padding: 40px 40px 80px;
  }
}

.mt__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .mt__title {
    font-size: 36px;
  }
}
.mt__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}

.mt__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mt__toolbar {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.mt__sync-result {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}

.mt__error {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.mt__section {
  margin-top: 28px;
}

.mt__empty {
  padding: 28px 16px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
}

/* Excluded services */
.mt__excluded-row {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px !important;
  margin-bottom: 8px;
}
.mt__excluded-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mt__excluded-icon {
  color: var(--color-muted);
  flex-shrink: 0;
}
.mt__excluded-name {
  font-size: 15px;
  color: var(--color-ink);
}
.mt__excluded-meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.03em;
  color: var(--color-muted);
  margin-top: 2px;
}

/* Flat chronological session list */
.mt__session-card {
  padding: 12px 14px !important;
  margin-bottom: 8px;
}
.mt__session-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  align-items: start;
}
@media (min-width: 768px) {
  .mt__session-grid {
    grid-template-columns: 140px 1fr 260px auto;
    gap: 16px;
    align-items: center;
  }
}
.mt__session-date {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mt__session-day {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-ink);
}
.mt__session-time {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
}
.mt__session-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mt__session-title {
  font-size: 15px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  line-height: 1.25;
}
.mt__session-meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--color-muted);
}
.mt__exclude-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.mt__exclude-btn:hover {
  color: var(--color-danger-500);
  border-color: var(--color-danger-500);
}
.mt__session-instructor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mt__instructor-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mt__instructor-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mt__instructor-input {
  flex: 1;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 6px 10px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.mt__instructor-input:focus {
  border-color: var(--color-brand-600);
}
.mt__instructor-spinner {
  color: var(--color-muted);
}
.mt__instructor-saved {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-success-500);
  font-weight: 600;
}

.spin {
  animation: mt-spin 800ms linear infinite;
}
@keyframes mt-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Buttons */
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
