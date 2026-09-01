<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { useAuthStore } from '@/training/stores/auth'
import { invokeEdge } from '@/training/lib/supabase'
import {
  Search,
  Download,
  Users,
  UserCheck,
  SlidersHorizontal,
  Globe,
  AlertTriangle,
  CalendarDays,
  UserPlus,
  X,
  Check,
  Pencil,
} from 'lucide-vue-next'
import type { Attendee, CertLevel } from '@/training/types'

const route = useRoute()
const router = useRouter()
const sessions = useSessionsStore()
const auth = useAuthStore()

const selected = ref<string>((route.query.sessionId as string) || '')
const q = ref('')

interface WixBooking {
  name: string
  email: string
  phone: string
  partySize: number
  status: string
  createdDate: string
}
const wixRegs = ref<WixBooking[]>([])
const wixLoading = ref(false)
const wixError = ref<string | null>(null)
const wixApprox = ref(false)

onMounted(async () => {
  await sessions.loadRecentSessions()
  if (selected.value) await loadAll(selected.value)
})

watch(selected, async (v) => {
  router.replace({ query: v ? { sessionId: v } : {} })
  q.value = ''
  if (v) await loadAll(v)
})

const sessionRow = computed(() =>
  sessions.recentSessions.find((s) => s.sessionId === selected.value),
)
const isCardClass = computed(
  () => sessionRow.value?.sessionType === 'CardClass',
)

async function loadAll(sessionId: string) {
  wixRegs.value = []
  wixError.value = null
  wixApprox.value = false
  await sessions.loadRegistrations(sessionId)
  if (isCardClass.value) {
    wixLoading.value = true
    try {
      const r = await invokeEdge<{
        bookings: WixBooking[]
        approximate: boolean
      }>(
        'training-wix-bookings',
        { sessionId },
        { authToken: auth.accessToken },
      )
      wixRegs.value = r.bookings || []
      wixApprox.value = !!r.approximate
    } catch (e) {
      wixError.value =
        e instanceof Error ? e.message : 'Could not load Wix bookings.'
    } finally {
      wixLoading.value = false
    }
  }
}

function sessionLabel(s: {
  sessionType: string
  cardCourseName: string
  lectureTitle: string
  title: string
}) {
  return s.sessionType === 'CardClass'
    ? s.cardCourseName || s.title
    : s.lectureTitle || s.title
}
function shortDate(d: string) {
  if (!d) return ''
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
function fmtTs(ts: string) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}

const term = computed(() => q.value.trim().toLowerCase())
function match(name: string, email: string) {
  if (!term.value) return true
  return (
    name.toLowerCase().includes(term.value) ||
    email.toLowerCase().includes(term.value)
  )
}

const internalRegistered = computed(() =>
  sessions.registrationRows.filter(
    (r) => r.phase === 'registered' && match(r.studentName, r.studentEmail),
  ),
)
const checkedIn = computed(() =>
  sessions.registrationRows.filter(
    (r) => r.phase === 'checkedin' && match(r.studentName, r.studentEmail),
  ),
)
const wixFiltered = computed(() =>
  wixRegs.value.filter((r) => match(r.name, r.email)),
)

const registeredCount = computed(() =>
  isCardClass.value
    ? wixRegs.value.length
    : sessions.registrationRows.filter((r) => r.phase === 'registered').length,
)
const checkedInCount = computed(
  () => sessions.registrationRows.filter((r) => r.phase === 'checkedin').length,
)

function exportCsv() {
  const s = sessionRow.value
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    ['Name', 'Email', 'Source', 'Stage', 'Status', 'PSA Score', 'Recorded At']
      .map(esc)
      .join(','),
  ]
  if (isCardClass.value) {
    wixRegs.value.forEach((r) =>
      lines.push(
        [r.name, r.email, 'Wix', 'Registered', r.status, '', r.createdDate]
          .map(esc)
          .join(','),
      ),
    )
  } else {
    sessions.registrationRows
      .filter((r) => r.phase === 'registered')
      .forEach((r) =>
        lines.push(
          [
            r.studentName,
            r.studentEmail,
            'In-app',
            'Registered',
            r.status,
            '',
            r.createdAt,
          ]
            .map(esc)
            .join(','),
        ),
      )
  }
  sessions.registrationRows
    .filter((r) => r.phase === 'checkedin')
    .forEach((r) =>
      lines.push(
        [
          r.studentName,
          r.studentEmail,
          'Check-in',
          'Checked In',
          r.status,
          r.psaScore ?? '',
          r.createdAt,
        ]
          .map(esc)
          .join(','),
      ),
    )
  const name =
    (s ? sessionLabel(s).replace(/[^a-z0-9]+/gi, '_') : selected.value) +
    '_registrations.csv'
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const hasAny = computed(
  () =>
    sessions.registrationRows.length > 0 || wixRegs.value.length > 0,
)

/* ── Edit registered attendee ──────────────────────────────────────
 * Inline editor opens in place of the row when "Edit" is clicked. CE
 * hours override is lecture-only — falls back to the session's
 * hours_awarded when blank. */
interface EditDraft {
  studentName: string
  studentEmail: string
  attendanceMode: 'InPerson' | 'Virtual'
  certLevel: '' | CertLevel
  ceHoursOverride: string
}
const editingId = ref<string | null>(null)
const editDraft = ref<EditDraft>({
  studentName: '',
  studentEmail: '',
  attendanceMode: 'InPerson',
  certLevel: '',
  ceHoursOverride: '',
})
const editSaving = ref(false)
const editErr = ref<string | null>(null)

const isLecture = computed(
  () => sessionRow.value?.sessionType === 'Lecture',
)
const sessionHoursAwarded = computed(
  () => sessionRow.value?.hoursAwarded || '',
)

function startEdit(r: Attendee) {
  editingId.value = r.id
  editDraft.value = {
    studentName: r.studentName,
    studentEmail: r.studentEmail,
    attendanceMode: (r.attendanceMode as 'InPerson' | 'Virtual') || 'InPerson',
    certLevel: r.certLevel ?? '',
    ceHoursOverride: r.ceHoursOverride ?? '',
  }
  editErr.value = null
}
function cancelEdit() {
  editingId.value = null
  editErr.value = null
}
async function saveEdit() {
  if (!editingId.value) return
  editSaving.value = true
  editErr.value = null
  try {
    await sessions.updateAttendance(editingId.value, {
      studentName: editDraft.value.studentName,
      studentEmail: editDraft.value.studentEmail,
      attendanceMode: editDraft.value.attendanceMode,
      certLevel: editDraft.value.certLevel === '' ? null : editDraft.value.certLevel,
      ceHoursOverride: isLecture.value ? editDraft.value.ceHoursOverride : undefined,
    })
    editingId.value = null
    await sessions.loadRegistrations(selected.value)
  } catch (e) {
    editErr.value = e instanceof Error ? e.message : 'Save failed.'
  } finally {
    editSaving.value = false
  }
}

/* ── Add registrant (walk-in) ─────────────────────────────────────── */
const addOpen = ref(false)
const addBusy = ref(false)
const addErr = ref<string | null>(null)
const addFlash = ref<string | null>(null)
const addForm = ref({ name: '', email: '', mode: 'InPerson' as 'InPerson' | 'Virtual' })

const virtualAvailable = computed(
  () => !isCardClass.value && !!sessionRow.value?.virtualEnabled,
)

function openAdd() {
  addForm.value = { name: '', email: '', mode: 'InPerson' }
  addErr.value = null
  addOpen.value = true
}
function cancelAdd() {
  addOpen.value = false
  addErr.value = null
}

async function submitAdd() {
  if (!selected.value) return
  addBusy.value = true
  addErr.value = null
  try {
    await sessions.addRegistration({
      sessionId: selected.value,
      studentName: addForm.value.name,
      studentEmail: addForm.value.email,
      attendanceMode: virtualAvailable.value ? addForm.value.mode : 'InPerson',
    })
    addFlash.value = `Added ${addForm.value.name.trim()} — they can now check in without approval.`
    setTimeout(() => (addFlash.value = null), 5000)
    addOpen.value = false
    await sessions.loadRegistrations(selected.value)
  } catch (e) {
    addErr.value = e instanceof Error ? e.message : 'Add failed.'
  } finally {
    addBusy.value = false
  }
}
</script>

<template>
  <AppShell>
    <header class="head">
      <div>
        <div class="eyebrow">Roster intake</div>
        <h1 class="display title">Registrations</h1>
        <p v-if="!selected" class="lede">
          Everyone signed up or checked in for a session. Card-class
          sign-ups come straight from Wix Bookings.
        </p>
      </div>
      <div v-if="selected" class="head__tools">
        <button class="btn btn-secondary" @click="selected = ''">
          ← All sessions
        </button>
      </div>
    </header>

    <!-- ── Landing: clickable sessions table ─────────────────────────── -->
    <section v-if="!selected" class="card listcard">
      <div class="listcard__head">
        <span class="eyebrow">Active sessions</span>
        <span class="listcard__hint">Tap a row to view its registrations</span>
      </div>
      <div v-if="!sessions.recentSessions.length" class="listcard__empty">
        <CalendarDays :size="26" :stroke-width="1.5" />
        <p>No active sessions yet — create one to start collecting registrations.</p>
        <RouterLink to="/training/manage/create" class="btn btn-primary">Create Session</RouterLink>
      </div>
      <table v-else class="stbl">
        <thead>
          <tr>
            <th>Course</th>
            <th>Date</th>
            <th>Instructor</th>
            <th>Type</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sessions.recentSessions"
            :key="row.sessionId"
            class="strow"
            tabindex="0"
            @click="selected = row.sessionId"
            @keydown.enter.prevent="selected = row.sessionId"
            @keydown.space.prevent="selected = row.sessionId"
          >
            <td class="stbl__course">{{ sessionLabel(row) }}</td>
            <td class="num muted">{{ shortDate(row.classDate) }}</td>
            <td class="muted">{{ row.primaryInstructorName || '—' }}</td>
            <td><span class="chip">{{ row.sessionType }}</span></td>
            <td>
              <span
                class="dotpill"
                :class="row.checkInStatus === 'Open' ? 'on' : 'off'"
              >
                <span class="dotpill__d" />
                {{ row.checkInStatus === 'Open' ? 'Check-in open' : 'Idle' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div
      v-else-if="sessions.registrationsLoading || wixLoading"
      class="empty card"
    >
      Loading registrations…
    </div>

    <template v-else>
      <div class="bar">
        <div class="bar-stats">
          <div class="stat">
            <span class="stat-n">{{ registeredCount }}</span>
            <span class="stat-l">Registered</span>
          </div>
          <div class="stat">
            <span class="stat-n">{{ checkedInCount }}</span>
            <span class="stat-l">Checked in</span>
          </div>
        </div>
        <div class="bar-tools">
          <div class="srch">
            <Search :size="15" />
            <input v-model="q" type="text" placeholder="Search name or email" />
          </div>
          <button class="btn btn-primary" @click="openAdd">
            <UserPlus :size="15" /> Add registrant
          </button>
          <button class="btn btn-secondary" :disabled="!hasAny" @click="exportCsv">
            <Download :size="15" /> CSV
          </button>
          <RouterLink
            class="btn btn-secondary"
            :to="{ name: 'controls', query: { sessionId: selected } }"
          >
            <SlidersHorizontal :size="15" /> Controls
          </RouterLink>
        </div>
      </div>

      <!-- Inline Add Registrant panel -->
      <Transition name="addpanel">
        <section v-if="addOpen" class="addpanel card">
          <div class="addpanel__h">
            <UserPlus :size="15" />
            <span>Add a walk-in registrant</span>
            <button class="iconbtn" aria-label="Close" @click="cancelAdd">
              <X :size="15" />
            </button>
          </div>
          <p class="addpanel__hint">
            They'll be pre-registered. When they check in via QR they'll be
            confirmed automatically — no approval required.
          </p>
          <div class="addpanel__grid">
            <label class="afield">
              <span>Full name <i>*</i></span>
              <input v-model="addForm.name" type="text" autocomplete="off" />
            </label>
            <label class="afield">
              <span>Email <i>*</i></span>
              <input v-model="addForm.email" type="email" autocomplete="off" />
            </label>
            <label v-if="virtualAvailable" class="afield">
              <span>Attendance Mode</span>
              <select v-model="addForm.mode">
                <option value="InPerson">In Person</option>
                <option value="Virtual">Virtual (Teams)</option>
              </select>
            </label>
          </div>
          <p v-if="addErr" class="addpanel__err">{{ addErr }}</p>
          <div class="addpanel__actions">
            <button class="btn btn-secondary" :disabled="addBusy" @click="cancelAdd">
              Cancel
            </button>
            <button class="btn btn-primary" :disabled="addBusy" @click="submitAdd">
              <Check :size="14" />
              {{ addBusy ? 'Adding…' : 'Add registrant' }}
            </button>
          </div>
        </section>
      </Transition>

      <Transition name="flash">
        <div v-if="addFlash" class="flash">
          <Check :size="14" /> {{ addFlash }}
        </div>
      </Transition>

      <!-- Card class → Wix bookings -->
      <section v-if="isCardClass" class="grp">
        <div class="grp-h">
          <Globe :size="15" /> Registered — Wix
          <span class="cnt">{{ wixRegs.length }}</span>
          <span class="grp-sub">Booked on the Wix member portal</span>
        </div>
        <div v-if="wixError" class="grp-note err">
          <AlertTriangle :size="14" /> {{ wixError }}
        </div>
        <div v-else-if="wixApprox" class="grp-note">
          <AlertTriangle :size="14" /> Couldn't match the exact Wix session —
          showing same-date bookings for this course. Verify against Wix if
          unsure.
        </div>
        <div v-if="!wixFiltered.length" class="grp-empty">
          No Wix bookings found for this session.
        </div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Party</th>
              <th>Status</th>
              <th>Booked</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in wixFiltered" :key="r.email + i">
              <td>{{ r.name }}</td>
              <td class="muted">{{ r.email }}</td>
              <td>{{ r.partySize }}</td>
              <td><span class="chip">{{ r.status }}</span></td>
              <td class="muted num">{{ fmtTs(r.createdDate) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Card class: in-app walk-ins added manually -->
      <section v-if="isCardClass && internalRegistered.length" class="grp">
        <div class="grp-h">
          <UserPlus :size="15" /> Walk-ins added in-app
          <span class="cnt">{{ internalRegistered.length }}</span>
          <span class="grp-sub">Not in Wix — pre-registered here so check-in skips approval</span>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Added</th>
              <th class="act"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in internalRegistered" :key="r.id">
              <tr v-if="editingId !== r.id">
                <td>{{ r.studentName }}</td>
                <td class="muted">{{ r.studentEmail }}</td>
                <td class="muted num">{{ fmtTs(r.createdAt) }}</td>
                <td class="act">
                  <button class="iconbtn" aria-label="Edit" @click="startEdit(r)">
                    <Pencil :size="14" />
                  </button>
                </td>
              </tr>
              <tr v-else class="editrow">
                <td colspan="4">
                  <div class="edit-grid">
                    <label class="afield">
                      <span>Name</span>
                      <input v-model="editDraft.studentName" type="text" />
                    </label>
                    <label class="afield">
                      <span>Email</span>
                      <input v-model="editDraft.studentEmail" type="email" />
                    </label>
                  </div>
                  <p v-if="editErr" class="addpanel__err">{{ editErr }}</p>
                  <div class="edit-actions">
                    <button
                      class="btn btn-secondary"
                      :disabled="editSaving"
                      @click="cancelEdit"
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-primary"
                      :disabled="editSaving"
                      @click="saveEdit"
                    >
                      {{ editSaving ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <!-- Lecture → in-app registrations -->
      <section v-else class="grp">
        <div class="grp-h">
          <Users :size="15" /> Registered
          <span class="cnt">{{ internalRegistered.length }}</span>
          <span class="grp-sub">Signed up — not yet checked in</span>
        </div>
        <div v-if="!internalRegistered.length" class="grp-empty">
          No pending registrations.
        </div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Cert</th>
              <th>Mode</th>
              <th v-if="isLecture">CE hrs</th>
              <th>Registered</th>
              <th class="act"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in internalRegistered" :key="r.id">
              <tr v-if="editingId !== r.id">
                <td>{{ r.studentName }}</td>
                <td class="muted">{{ r.studentEmail }}</td>
                <td><span class="chip">{{ r.certLevel || '—' }}</span></td>
                <td><span class="chip">{{ r.attendanceMode || '—' }}</span></td>
                <td v-if="isLecture" class="num">
                  <span v-if="r.ceHoursOverride">{{ r.ceHoursOverride }}</span>
                  <span v-else class="muted">{{ sessionHoursAwarded || '—' }}</span>
                </td>
                <td class="muted num">{{ fmtTs(r.createdAt) }}</td>
                <td class="act">
                  <button class="iconbtn" aria-label="Edit" @click="startEdit(r)">
                    <Pencil :size="14" />
                  </button>
                </td>
              </tr>
              <tr v-else class="editrow">
                <td :colspan="isLecture ? 7 : 6">
                  <div class="edit-grid">
                    <label class="afield">
                      <span>Name</span>
                      <input v-model="editDraft.studentName" type="text" />
                    </label>
                    <label class="afield">
                      <span>Email</span>
                      <input v-model="editDraft.studentEmail" type="email" />
                    </label>
                    <label class="afield">
                      <span>Cert</span>
                      <select v-model="editDraft.certLevel">
                        <option value="">—</option>
                        <option value="Paramedic">Paramedic</option>
                        <option value="EMT">EMT / AEMT</option>
                      </select>
                    </label>
                    <label class="afield">
                      <span>Mode</span>
                      <select v-model="editDraft.attendanceMode">
                        <option value="InPerson">In Person</option>
                        <option value="Virtual">Virtual</option>
                      </select>
                    </label>
                    <label v-if="isLecture" class="afield">
                      <span>CE hrs override</span>
                      <input
                        v-model="editDraft.ceHoursOverride"
                        type="text"
                        inputmode="decimal"
                        :placeholder="sessionHoursAwarded || '1.0'"
                      />
                      <small class="hint">
                        Leave blank to use the session default ({{
                          sessionHoursAwarded || '—'
                        }}).
                      </small>
                    </label>
                  </div>
                  <p v-if="editErr" class="addpanel__err">{{ editErr }}</p>
                  <div class="edit-actions">
                    <button
                      class="btn btn-secondary"
                      :disabled="editSaving"
                      @click="cancelEdit"
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-primary"
                      :disabled="editSaving"
                      @click="saveEdit"
                    >
                      {{ editSaving ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <section class="grp">
        <div class="grp-h">
          <UserCheck :size="15" /> Checked in
          <span class="cnt">{{ checkedIn.length }}</span>
          <span class="grp-sub">On the attendance roster</span>
        </div>
        <div v-if="!checkedIn.length" class="grp-empty">No check-ins yet.</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th v-if="isLecture">Cert</th>
              <th>Mode</th>
              <th v-if="isLecture">CE hrs</th>
              <th>Checked in</th>
              <th class="act"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in checkedIn" :key="r.id">
              <tr v-if="editingId !== r.id">
                <td>{{ r.studentName }}</td>
                <td class="muted">{{ r.studentEmail }}</td>
                <td v-if="isLecture">
                  <span class="chip">{{ r.certLevel || '—' }}</span>
                </td>
                <td><span class="chip">{{ r.attendanceMode || '—' }}</span></td>
                <td v-if="isLecture" class="num">
                  <span v-if="r.ceHoursOverride">{{ r.ceHoursOverride }}</span>
                  <span v-else class="muted">{{ sessionHoursAwarded || '—' }}</span>
                </td>
                <td class="muted num">{{ fmtTs(r.createdAt) }}</td>
                <td class="act">
                  <button class="iconbtn" aria-label="Edit" @click="startEdit(r)">
                    <Pencil :size="14" />
                  </button>
                </td>
              </tr>
              <tr v-else class="editrow">
                <td :colspan="isLecture ? 7 : 5">
                  <div class="edit-grid">
                    <label class="afield">
                      <span>Name</span>
                      <input v-model="editDraft.studentName" type="text" />
                    </label>
                    <label class="afield">
                      <span>Email</span>
                      <input v-model="editDraft.studentEmail" type="email" />
                    </label>
                    <label v-if="isLecture" class="afield">
                      <span>Cert</span>
                      <select v-model="editDraft.certLevel">
                        <option value="">—</option>
                        <option value="Paramedic">Paramedic</option>
                        <option value="EMT">EMT / AEMT</option>
                      </select>
                    </label>
                    <label class="afield">
                      <span>Mode</span>
                      <select v-model="editDraft.attendanceMode">
                        <option value="InPerson">In Person</option>
                        <option value="Virtual">Virtual</option>
                      </select>
                    </label>
                    <label v-if="isLecture" class="afield">
                      <span>CE hrs override</span>
                      <input
                        v-model="editDraft.ceHoursOverride"
                        type="text"
                        inputmode="decimal"
                        :placeholder="sessionHoursAwarded || '1.0'"
                      />
                      <small class="hint">
                        Leave blank to use the session default ({{
                          sessionHoursAwarded || '—'
                        }}).
                      </small>
                    </label>
                  </div>
                  <p v-if="editErr" class="addpanel__err">{{ editErr }}</p>
                  <div class="edit-actions">
                    <button
                      class="btn btn-secondary"
                      :disabled="editSaving"
                      @click="cancelEdit"
                    >
                      Cancel
                    </button>
                    <button
                      class="btn btn-primary"
                      :disabled="editSaving"
                      @click="saveEdit"
                    >
                      {{ editSaving ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
}
.title {
  font-size: 32px;
  margin: 4px 0 6px;
}
.lede {
  color: var(--color-muted);
  font-size: 14px;
  margin: 0;
  max-width: 52ch;
}
.head__tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* ── Session list (landing) ──────────────────────────────────────── */
.listcard {
  padding: 8px 0 0;
  overflow: hidden;
  margin-bottom: 16px;
}
.listcard__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px 12px;
  border-bottom: 1px solid var(--color-line);
}
.listcard__head .eyebrow {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}
.listcard__hint {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--color-muted-soft);
}
.listcard__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 44px 22px;
  color: var(--color-muted);
  text-align: center;
}
.listcard__empty svg {
  color: var(--color-muted-soft);
}
.stbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.stbl th {
  text-align: left;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
  padding: 12px 22px 10px;
  background: var(--color-surface-soft);
}
.stbl td {
  padding: 13px 22px;
  border-top: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.strow {
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.strow:hover,
.strow:focus-visible {
  background: var(--color-brand-50);
  outline: none;
}
.strow:focus-visible td:first-child {
  box-shadow: inset 3px 0 0 var(--color-brand-500);
}
.stbl__course {
  font-weight: 500;
  color: var(--color-ink);
}
.dotpill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--color-surface-sunk);
  color: var(--color-muted);
}
.dotpill__d {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.dotpill.on {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
@media (max-width: 720px) {
  .stbl thead {
    display: none;
  }
  .stbl,
  .stbl tbody,
  .strow,
  .stbl td {
    display: block;
    width: 100%;
  }
  .strow {
    padding: 14px 22px;
    border-top: 1px solid var(--color-line-soft);
  }
  .stbl td {
    border-top: none;
    padding: 2px 0;
  }
  .stbl__course {
    font-size: 15px;
  }
  .stbl td.muted,
  .stbl td.num {
    font-size: 12.5px;
  }
}
.picker {
  padding: 18px 20px;
  margin-bottom: 16px;
}
.plabel {
  display: block;
  font-size: 12px;
  color: var(--color-ink-soft);
  font-weight: 500;
  margin-bottom: 7px;
}
select {
  width: 100%;
  padding: 11px 13px;
  border-radius: 9px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
  font-family: inherit;
}
select:focus {
  outline: none;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px var(--color-brand-100);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
.empty svg {
  color: var(--color-muted-soft);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.bar-stats {
  display: flex;
  gap: 28px;
}
.stat {
  display: flex;
  flex-direction: column;
}
.stat-n {
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1;
  color: var(--color-ink);
}
.stat-l {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin-top: 4px;
}
.bar-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.srch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-surface);
}
.srch svg {
  color: var(--color-muted);
  flex-shrink: 0;
}
.srch input {
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 0;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--color-ink);
  width: 190px;
}
.grp {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
}
.grp-h {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 14px;
}
.grp-h svg {
  color: var(--color-accent-600);
}
.cnt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  font-size: 12px;
  font-weight: 600;
}
.grp-sub {
  font-weight: 400;
  font-size: 12px;
  color: var(--color-muted);
  margin-left: auto;
}
.grp-note {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--color-warning-500);
  background: var(--color-warning-50);
  padding: 9px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.grp-note.err {
  color: var(--color-danger-500);
  background: var(--color-danger-50);
}
.grp-empty {
  padding: 16px 0;
  color: var(--color-muted);
  font-size: 13.5px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.tbl th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
  padding: 9px 8px;
  border-bottom: 1px solid var(--color-line);
}
.tbl td {
  padding: 11px 8px;
  border-bottom: 1px solid var(--color-line-soft);
}
.tbl tbody tr:last-child td {
  border-bottom: none;
}
.muted {
  color: var(--color-muted);
}

/* Add registrant panel */
.addpanel {
  padding: 18px 20px;
  margin-bottom: 14px;
}
.addpanel__h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 8px;
}
.addpanel__h svg {
  color: var(--color-brand-600);
}
.addpanel__h .iconbtn {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
}
.addpanel__h .iconbtn:hover {
  background: var(--color-line-soft);
}
.addpanel__hint {
  margin: 0 0 14px;
  font-size: 12.5px;
  color: var(--color-muted);
  line-height: 1.5;
}
.addpanel__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .addpanel__grid {
    grid-template-columns: 1fr;
  }
}
.afield {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--color-ink-soft);
  font-weight: 500;
}
.afield i {
  color: var(--color-danger-500);
  font-style: normal;
}
.afield input,
.afield select {
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
  font-family: inherit;
}
.afield input:focus,
.afield select:focus {
  outline: none;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px var(--color-brand-100);
}
.addpanel__err {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--color-danger-500);
}
.addpanel__actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.addpanel-enter-active,
.addpanel-leave-active {
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}
.addpanel-enter-from,
.addpanel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.flash {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: var(--color-success-50);
  color: var(--color-success-500);
  border-radius: 10px;
  font-size: 13px;
}
.flash svg {
  color: var(--color-success-500);
}
.flash-enter-active,
.flash-leave-active {
  transition: opacity 160ms var(--ease-out);
}
.flash-enter-from,
.flash-leave-to {
  opacity: 0;
}

/* Inline row edit */
.tbl th.act,
.tbl td.act {
  width: 36px;
  text-align: right;
  padding-right: 6px;
}
.iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  transition: border-color 120ms, color 120ms;
}
.iconbtn:hover {
  border-color: var(--color-brand-400);
  color: var(--color-brand-600);
}
.editrow td {
  background: var(--color-surface-sunk);
  border-radius: 8px;
}
.edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 6px 0 10px;
}
.edit-grid .afield input,
.edit-grid .afield select {
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
  font-family: inherit;
}
.edit-grid .hint {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-muted);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 640px) {
  .bar {
    flex-direction: column;
    align-items: stretch;
  }
  .bar-tools {
    flex-wrap: wrap;
  }
  .srch {
    flex: 1;
  }
  .srch input {
    width: 100%;
  }
  .grp-sub {
    display: none;
  }
  .tbl thead {
    display: none;
  }
  .tbl tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-line);
  }
  .tbl td {
    padding: 1px 0;
    border: none;
  }
}
</style>
