<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { qrDataUrl } from '@/training/lib/qr'
import {
  RefreshCw,
  Copy,
  Check,
  Monitor,
  Search,
  ClipboardList,
  FileText,
  CheckSquare,
  Lock,
  CalendarDays,
  User,
  Upload,
  CreditCard,
  Ban,
  Award,
  Radio,
  Wifi,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-vue-next'
import { generateCeCertificate, makeCeCertNumber } from '@/training/lib/ceCertificate'
import { archiveFile } from '@/training/lib/archive'
import JSZip from 'jszip'

const route = useRoute()
const router = useRouter()
const sessions = useSessionsStore()

const selected = ref<string>((route.query.sessionId as string) || '')
const qrCheckin = ref('')
const qrEval = ref('')
const savingIds = ref<Set<string>>(new Set())
const savedIds = ref<Set<string>>(new Set())
const copied = ref<'checkin' | 'eval' | 'quiz' | 'engage' | null>(null)
const search = ref('')

onMounted(async () => {
  await sessions.loadRecentSessions()
  if (selected.value) await load(selected.value)
  window.addEventListener('visibilitychange', reHydrateIfVisible)
  window.addEventListener('online', reHydrateOnReconnect)
})
onUnmounted(() => {
  sessions.teardown()
  window.removeEventListener('visibilitychange', reHydrateIfVisible)
  window.removeEventListener('online', reHydrateOnReconnect)
})

/** When the page becomes visible again (tab-switch, laptop wake), re-run
 *  load() so the roster + realtime subscription are fresh. Long-lived
 *  WebSockets sometimes die silently on middleboxes / after sleep and
 *  the reactive state stops receiving new check-ins until the next
 *  full refresh. This closes that gap. */
function reHydrateIfVisible() {
  if (document.visibilityState !== 'visible') return
  if (!selected.value) return
  void load(selected.value)
}
function reHydrateOnReconnect() {
  if (!selected.value) return
  void load(selected.value)
}

const qrQuiz = ref('')
const qrEngage = ref('')
async function load(sessionId: string) {
  await sessions.loadSessionDetail(sessionId)
  const s = sessions.currentSession
  if (s) {
    const origin = window.location.origin
    qrCheckin.value = await qrDataUrl(`${origin}/checkin?t=${s.checkInToken}`)
    qrEval.value = await qrDataUrl(`${origin}/eval?t=${s.evalToken}`)
    if (s.sessionType === 'Lecture' && s.quizToken) {
      qrQuiz.value = await qrDataUrl(`${origin}/quiz?t=${s.quizToken}`)
      // Load the quiz builder data + any in-flight submissions.
      await sessions.loadQuizzes(s.id)
      await sessions.loadQuizSubmissions(s.sessionId)
      // Initialize the builder draft from the persisted shape.
      initQuizDrafts()
    }
    if (s.sessionType === 'Lecture') {
      qrEngage.value = await qrDataUrl(
        `${origin}/engage?session=${s.sessionId}`,
      )
      await sessions.loadEngagementCodes(s.sessionId)
      await sessions.loadEngagementResponses(s.sessionId)
    }
  }
}

watch(selected, (v) => {
  router.replace({ query: v ? { sessionId: v } : {} })
  search.value = ''
  if (v) void load(v)
})

const s = computed(() => sessions.currentSession)

function courseName() {
  const x = s.value
  if (!x) return ''
  return x.sessionType === 'CardClass'
    ? x.cardCourseName || x.title
    : x.lectureTitle || x.title
}
function fmtDate(d: string) {
  if (!d) return '—'
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
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

const evalEmails = computed(
  () => new Set(sessions.evals.map((e) => (e.studentEmail || '').toLowerCase())),
)
function normName(n: string): string {
  return (n || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
const evalNames = computed(
  () => new Set(sessions.evals.map((e) => normName(e.studentName))),
)
/** True when the attendee has an eval credit by any of:
 *   (1) email match against an eval submission,
 *   (2) name match (lowercased + alphanumeric only) — guards against
 *       attendees typing a different email on the eval form than at
 *       check-in,
 *   (3) the eval_credited manual override the instructor flipped from
 *       the roster row. */
function hasEval(a: { studentEmail: string; studentName: string; evalCredited?: boolean }) {
  if (a.evalCredited) return true
  if (evalEmails.value.has((a.studentEmail || '').toLowerCase())) return true
  const n = normName(a.studentName)
  return !!n && evalNames.value.has(n)
}

const checkedIn = computed(() =>
  sessions.attendance.filter(
    (a) => a.phase === 'checkedin' && a.status !== 'Pending',
  ),
)
const pendingApprovals = computed(() =>
  sessions.attendance.filter(
    (a) => a.phase === 'checkedin' && a.status === 'Pending',
  ),
)
const registeredCount = computed(
  () => sessions.attendance.filter((a) => a.phase === 'registered').length,
)
const evalCount = computed(
  () => checkedIn.value.filter((a) => hasEval(a)).length,
)
const roster = computed(() => {
  const t = search.value.trim().toLowerCase()
  if (!t) return checkedIn.value
  return checkedIn.value.filter(
    (a) =>
      a.studentName.toLowerCase().includes(t) ||
      a.studentEmail.toLowerCase().includes(t),
  )
})

const isCardClass = computed(
  () => s.value?.sessionType === 'CardClass' || !!s.value?.cardCourseName,
)

async function toggleCheckIn(e: Event) {
  const open = (e.target as HTMLInputElement).checked
  if (s.value) await sessions.setCheckInStatus(s.value.sessionId, open)
}
async function toggleEval(e: Event) {
  const open = (e.target as HTMLInputElement).checked
  if (s.value) await sessions.setEvalStatus(s.value.sessionId, open)
}
async function approve(id: string) {
  await sessions.approveAttendee(id)
}
async function reject(id: string) {
  if (!confirm('Reject this walk-in? The row will be deleted.')) return
  await sessions.rejectAttendee(id)
}

// ── Card-class extras: eCard tracker + exam upload ────────────────
async function toggleEcard(a: { id: string; ecardIssuedAt: string | null }) {
  await sessions.setEcardIssued(a.id, !a.ecardIssuedAt)
}

const uploadingExamId = ref<string | null>(null)
const examMsg = ref<string | null>(null)

async function handleExamUpload(
  e: Event,
  a: { id: string; studentEmail: string },
) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-upload of same filename
  if (!file || !s.value) return
  uploadingExamId.value = a.id
  examMsg.value = null
  try {
    await sessions.uploadExam(s.value.sessionId, a.studentEmail, file)
    examMsg.value = `Uploaded "${file.name}" for ${a.studentEmail}.`
    setTimeout(() => (examMsg.value = null), 4000)
  } catch (err) {
    examMsg.value =
      err instanceof Error ? err.message : 'Exam upload failed.'
  } finally {
    uploadingExamId.value = null
  }
}

function fmtIssued(ts: string | null) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

async function savePsa(id: string, raw: string) {
  const val = raw === '' ? null : Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
  savingIds.value = new Set(savingIds.value).add(id)
  try {
    await sessions.savePsaScore(id, val)
    savedIds.value = new Set(savedIds.value).add(id)
    setTimeout(() => {
      const n = new Set(savedIds.value)
      n.delete(id)
      savedIds.value = n
    }, 2000)
  } catch {
    /* surfaced via realtime refetch */
  } finally {
    const n = new Set(savingIds.value)
    n.delete(id)
    savingIds.value = n
  }
}

async function closeCourse() {
  if (!s.value) return
  if (
    !confirm(
      'Close this course? It will be archived and removed from the active list.',
    )
  )
    return
  await sessions.closeCourse(s.value.sessionId)
  await sessions.loadRecentSessions()
  selected.value = ''
  sessions.teardown()
}

async function cancelCourse() {
  if (!s.value) return
  const isCard = s.value.sessionType === 'CardClass'
  const msg = isCard
    ? 'Cancel this card class? The Wix Bookings event will be canceled and registered students will be notified by Wix. This cannot be undone from the app.'
    : 'Cancel this lecture? Check-in and evaluations will be closed. Registered students are NOT automatically emailed.'
  if (!confirm(msg)) return
  try {
    const r = await sessions.cancelSession(s.value.sessionId)
    if (r.wixWarning) {
      alert(
        'Session marked Canceled in the app, but Wix update did not complete:\n\n' +
          r.wixWarning +
          '\n\nYou may need to cancel the event manually in the Wix dashboard.',
      )
    }
    await sessions.loadRecentSessions()
    selected.value = ''
    sessions.teardown()
  } catch (e) {
    alert(
      'Cancel failed: ' + (e instanceof Error ? e.message : 'unknown error'),
    )
  }
}

function openDisplay(kind: 'checkin' | 'eval' | 'quiz' | 'engage') {
  if (!s.value) return
  // Engagement uses session id (single shared link); other kinds use token.
  const query: Record<string, string> = { kind, course: courseName() }
  if (kind === 'engage') {
    query.session = s.value.sessionId
  } else {
    query.token =
      kind === 'checkin'
        ? s.value.checkInToken
        : kind === 'eval'
          ? s.value.evalToken
          : s.value.quizToken
  }
  const r = router.resolve({ name: 'display', query })
  window.open(r.href, '_blank')
}

async function copyLink(kind: 'checkin' | 'eval' | 'quiz') {
  if (!s.value) return
  const origin = window.location.origin
  const url =
    kind === 'checkin'
      ? `${origin}/checkin?t=${s.value.checkInToken}`
      : kind === 'eval'
        ? `${origin}/eval?t=${s.value.evalToken}`
        : `${origin}/quiz?t=${s.value.quizToken}`
  try {
    await navigator.clipboard.writeText(url)
    copied.value = kind
    setTimeout(() => (copied.value = null), 1600)
  } catch {
    /* clipboard blocked */
  }
}

function openRoster() {
  if (s.value)
    router.push({ name: 'roster-export', query: { sessionId: s.value.sessionId } })
}
function openEvals() {
  if (s.value)
    router.push({ name: 'evals-export', query: { sessionId: s.value.sessionId } })
}

/* ── Lecture: Editable CE hours ─────────────────────────────────────
 * Scheduled time and actual instruction time often diverge; the
 * instructor edits this after the lecture wraps so the CE certificate
 * reflects the real contact hours. Save on blur or Enter. */
const hoursDraft = ref('')
const hoursSaving = ref(false)
const hoursFlash = ref<'saved' | 'error' | null>(null)
watch(
  () => s.value?.hoursAwarded,
  (v) => {
    hoursDraft.value = v ?? ''
  },
  { immediate: true },
)
const hoursDirty = computed(
  () => (s.value?.hoursAwarded ?? '') !== hoursDraft.value.trim(),
)

/* ─── Edit details modal ───────────────────────────────────────────
 * Lets the instructor change the card course (e.g. BLS Renewal → Full
 * BLS) and update all 4 instructor slots after the session is created.
 * The existing SessionType stays fixed — Card ↔ Lecture would break
 * downstream calendar links, so we require Cancel + Create for that. */
interface EditInstructorSlot {
  name: string
  number: string
  email: string
  cardExp: string
  /** '' = not picked, instructor id = filled from roster, 'other' = manual. */
  selection: string
}
function blankSlot(): EditInstructorSlot {
  return { name: '', number: '', email: '', cardExp: '', selection: '' }
}
const editOpen = ref(false)
const editBusy = ref(false)
const editErr = ref<string | null>(null)
const editSaved = ref(false)
const editForm = ref<{
  cardCourse: string
  primary: EditInstructorSlot
  assists: EditInstructorSlot[]
}>({
  cardCourse: '',
  primary: blankSlot(),
  assists: [],
})

/** Discipline code from the currently-selected course in the edit
 *  form — controls the roster picker options + card-exp auto-fill. */
const editDisciplineCode = computed(() => {
  const first = (editForm.value.cardCourse || '').trim().split(/\s+/)[0] ?? ''
  return first.toUpperCase()
})
const editCourseOptions = computed(() => sessions.courses.map((c) => c.name))

/** Assist-instructor names for display on the summary card. */
const assistList = computed<string[]>(() => {
  if (!s.value) return []
  const names = [
    s.value.secondaryInstructorName,
    s.value.tertiaryInstructorName,
    s.value.quaternaryInstructorName,
  ].filter((n): n is string => !!n && n.trim().length > 0)
  return names
})

function openEditDetails() {
  const cs = s.value
  if (!cs) return
  editErr.value = null
  editSaved.value = false
  // Load the course catalog on demand — Create Session pre-loads it,
  // but a user landing straight on Controls wouldn't have it yet.
  void sessions.loadCourses()
  editForm.value = {
    cardCourse: cs.cardCourseName ?? '',
    primary: {
      name: cs.primaryInstructorName ?? '',
      number: cs.primaryInstructorNumber ?? '',
      email: cs.primaryInstructorEmail ?? '',
      cardExp: cs.primaryInstructorCardExp ?? '',
      selection: cs.primaryInstructorName ? 'other' : '',
    },
    assists: [
      {
        name: cs.secondaryInstructorName ?? '',
        number: cs.secondaryInstructorNumber ?? '',
        email: cs.secondaryInstructorEmail ?? '',
        cardExp: cs.secondaryInstructorCardExp ?? '',
        selection: cs.secondaryInstructorName ? 'other' : '',
      },
      {
        name: cs.tertiaryInstructorName ?? '',
        number: cs.tertiaryInstructorNumber ?? '',
        email: cs.tertiaryInstructorEmail ?? '',
        cardExp: cs.tertiaryInstructorCardExp ?? '',
        selection: cs.tertiaryInstructorName ? 'other' : '',
      },
    ].filter((slot) => slot.name.trim().length > 0),
  }
  // Load roster if we haven't yet.
  void sessions.loadInstructorRoster()
  editOpen.value = true
}
function addAssist() {
  if (editForm.value.assists.length < 3) editForm.value.assists.push(blankSlot())
}
function removeAssist(idx: number) {
  editForm.value.assists.splice(idx, 1)
}
function applyPickerToSlot(slot: EditInstructorSlot, sel: string) {
  if (!sel || sel === 'other') {
    if (sel === '') {
      slot.name = ''
      slot.number = ''
      slot.email = ''
      slot.cardExp = ''
    }
    slot.selection = sel
    return
  }
  const inst = sessions.instructorRoster.find((i) => i.id === sel)
  if (!inst) return
  slot.selection = sel
  slot.name = inst.fullName
  slot.number = inst.instructorNumber ?? ''
  slot.email = inst.email ?? ''
  const code = editDisciplineCode.value
  slot.cardExp = code ? (inst.cardExpByCode?.[code] ?? '') : ''
}
async function saveEditDetails() {
  if (!s.value) return
  // Guard: user must pick a course. Keeping the field required prevents
  // an accidental "" write that would wipe the roster header.
  if (!editForm.value.cardCourse.trim()) {
    editErr.value = 'Pick a card course before saving.'
    return
  }
  editBusy.value = true
  editErr.value = null
  editSaved.value = false
  try {
    const [a1, a2, a3] = [
      editForm.value.assists[0] ?? blankSlot(),
      editForm.value.assists[1] ?? blankSlot(),
      editForm.value.assists[2] ?? blankSlot(),
    ]
    await sessions.updateSessionDetails(s.value.sessionId, {
      cardCourseName: editForm.value.cardCourse,
      primaryInstructorName: editForm.value.primary.name,
      primaryInstructorEmail: editForm.value.primary.email,
      primaryInstructorNumber: editForm.value.primary.number,
      primaryInstructorCardExp: editForm.value.primary.cardExp,
      secondaryInstructorName: a1.name,
      secondaryInstructorEmail: a1.email,
      secondaryInstructorNumber: a1.number,
      secondaryInstructorCardExp: a1.cardExp,
      tertiaryInstructorName: a2.name,
      tertiaryInstructorEmail: a2.email,
      tertiaryInstructorNumber: a2.number,
      tertiaryInstructorCardExp: a2.cardExp,
      quaternaryInstructorName: a3.name,
    })
    editSaved.value = true
    // Small delay so the user sees the "Saved" confirmation before
    // the modal closes.
    setTimeout(() => {
      editOpen.value = false
      editSaved.value = false
    }, 900)
  } catch (err) {
    console.error('[SessionControls] updateSessionDetails failed:', err)
    editErr.value =
      err instanceof Error
        ? err.message
        : 'Save failed — please try again.'
  } finally {
    editBusy.value = false
  }
}
async function saveHours() {
  if (!s.value || !hoursDirty.value) return
  hoursSaving.value = true
  hoursFlash.value = null
  try {
    await sessions.setHoursAwarded(s.value.sessionId, hoursDraft.value)
    hoursFlash.value = 'saved'
    setTimeout(() => (hoursFlash.value = null), 2000)
  } catch {
    hoursFlash.value = 'error'
  } finally {
    hoursSaving.value = false
  }
}

/* ── Lecture: Engagement codes (virtual attendees) ──────────────────
 * Instructor generates short numeric codes mid-lecture. Virtual
 * attendees keep /engage?session=<id> open and submit codes to attest
 * presence. Pass threshold (default 80%) gates virtual CE awards. */
const ENGAGEMENT_DEFAULT_PCT = 80
const engagementCollapsed = ref(false)
function engagementStorageKey() {
  return s.value ? `engageCollapsed:${s.value.sessionId}` : ''
}
watch(
  () => s.value?.sessionId,
  (sid) => {
    if (!sid) return
    const raw = localStorage.getItem(`engageCollapsed:${sid}`)
    engagementCollapsed.value = raw === '1'
  },
  { immediate: true },
)
function toggleEngagementCollapsed() {
  engagementCollapsed.value = !engagementCollapsed.value
  const key = engagementStorageKey()
  if (key) localStorage.setItem(key, engagementCollapsed.value ? '1' : '0')
}

const engageLifetime = ref(60)
const engageDigits = ref(4)
const engageThresholdDraft = ref<number>(ENGAGEMENT_DEFAULT_PCT)
const engageThresholdSaving = ref(false)
const engageThresholdFlash = ref<'saved' | 'error' | null>(null)
const engageGenerating = ref(false)
const engageError = ref<string | null>(null)

watch(
  () => s.value?.engagementThresholdPct,
  (v) => {
    engageThresholdDraft.value = v ?? ENGAGEMENT_DEFAULT_PCT
  },
  { immediate: true },
)
const engageThresholdDirty = computed(() => {
  const current = s.value?.engagementThresholdPct ?? ENGAGEMENT_DEFAULT_PCT
  return current !== engageThresholdDraft.value
})

async function saveEngagementThreshold() {
  if (!s.value || !engageThresholdDirty.value) return
  const raw = Number(engageThresholdDraft.value)
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    engageThresholdFlash.value = 'error'
    return
  }
  engageThresholdSaving.value = true
  engageThresholdFlash.value = null
  try {
    await sessions.setEngagementThreshold(
      s.value.sessionId,
      raw === ENGAGEMENT_DEFAULT_PCT ? null : raw,
    )
    engageThresholdFlash.value = 'saved'
    setTimeout(() => (engageThresholdFlash.value = null), 1800)
  } catch {
    engageThresholdFlash.value = 'error'
  } finally {
    engageThresholdSaving.value = false
  }
}

// Tick once a second so the countdown re-renders.
const nowMs = ref(Date.now())
let nowTimer: number | null = null
onMounted(() => {
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (nowTimer) window.clearInterval(nowTimer)
})

const activeEngagementCode = computed(() => {
  for (const c of sessions.engagementCodes) {
    if (new Date(c.expiresAt).getTime() > nowMs.value) return c
  }
  return null
})
const activeCountdownSec = computed(() => {
  if (!activeEngagementCode.value) return 0
  const ms = new Date(activeEngagementCode.value.expiresAt).getTime() - nowMs.value
  return Math.max(0, Math.ceil(ms / 1000))
})
const activeResponseCount = computed(() => {
  if (!activeEngagementCode.value) return 0
  return sessions.engagementResponses.filter(
    (r) => r.codeId === activeEngagementCode.value!.id,
  ).length
})

/** Per-virtual-attendee participation. responded = unique codes they
 *  answered; totalCodes = codes issued (we count CREATED codes, not
 *  only currently-unexpired ones, since participation accumulates). */
interface EngagementRow {
  email: string
  name: string
  responded: number
  total: number
  pct: number
}
const engagementByAttendee = computed<EngagementRow[]>(() => {
  const total = sessions.engagementCodes.length
  // Aggregate response counts per (email, codeId) — dedup just in case.
  const seenPairs = new Set<string>()
  const counts = new Map<string, { name: string; responded: number }>()
  for (const r of sessions.engagementResponses) {
    const email = r.attendeeEmail.toLowerCase()
    const pairKey = `${email}|${r.codeId}`
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)
    const entry = counts.get(email) ?? {
      name: r.attendeeName || '',
      responded: 0,
    }
    if (!entry.name && r.attendeeName) entry.name = r.attendeeName
    entry.responded++
    counts.set(email, entry)
  }
  // Seed with all currently-known Virtual attendees so the table
  // shows 0/N for someone who hasn't responded yet.
  for (const a of sessions.attendance) {
    if (a.attendanceMode !== 'Virtual') continue
    const email = a.studentEmail.toLowerCase()
    if (!counts.has(email)) {
      counts.set(email, { name: a.studentName, responded: 0 })
    }
  }
  const rows: EngagementRow[] = []
  for (const [email, info] of counts.entries()) {
    rows.push({
      email,
      name: info.name,
      responded: Math.min(info.responded, total || info.responded),
      total,
      pct: total > 0 ? Math.round((info.responded / total) * 100) : 0,
    })
  }
  rows.sort((a, b) => b.pct - a.pct || a.email.localeCompare(b.email))
  return rows
})

async function generateNewEngagementCode() {
  if (!s.value) return
  engageGenerating.value = true
  engageError.value = null
  try {
    await sessions.generateEngagementCode({
      sessionId: s.value.sessionId,
      lifetimeSec: engageLifetime.value,
      digits: engageDigits.value,
    })
  } catch (e) {
    engageError.value =
      e instanceof Error ? e.message : 'Failed to generate code.'
  } finally {
    engageGenerating.value = false
  }
}

function copyEngageLink() {
  if (!s.value) return
  const origin = window.location.origin
  const url = `${origin}/engage?session=${s.value.sessionId}`
  void navigator.clipboard.writeText(url).catch(() => {})
  copied.value = 'engage'
  setTimeout(() => (copied.value = null), 1600)
}
const engagePublicUrl = computed(() => {
  if (!s.value) return ''
  return `${window.location.origin}/engage?session=${s.value.sessionId}`
})

/* ── Per-attendee Quiz status + Eval credit override ────────────────
 * Quiz lookup is by lowercased email; a passing submission wins over a
 * failing one if both exist. Eval cell on the roster is clickable —
 * flip eval_credited to manually credit attendees whose eval-form email
 * didn't match their check-in email. */
type QuizStatus = 'passed' | 'failed' | 'notTaken' | 'noQuiz'
interface QuizSubInfo {
  passed: boolean
  scorePct: number
}
function mergeSubmission(
  prev: QuizSubInfo | undefined,
  next: QuizSubInfo,
): QuizSubInfo {
  // Sticky pass — if any submission passed, the attendee passed.
  if (!prev) return next
  if (next.passed && !prev.passed) return next
  return prev
}
const submissionsByEmail = computed(() => {
  const m = new Map<string, QuizSubInfo>()
  for (const sub of sessions.quizSubmissions) {
    const email = (sub.studentEmail || '').toLowerCase()
    m.set(
      email,
      mergeSubmission(m.get(email), { passed: sub.passed, scorePct: sub.scorePct }),
    )
  }
  return m
})
const submissionsByName = computed(() => {
  const m = new Map<string, QuizSubInfo>()
  for (const sub of sessions.quizSubmissions) {
    const n = normName(sub.studentName)
    if (!n) continue
    m.set(
      n,
      mergeSubmission(m.get(n), { passed: sub.passed, scorePct: sub.scorePct }),
    )
  }
  return m
})
const hasAnyQuizConfigured = computed(
  () => !!sessions.quizzes.Paramedic || !!sessions.quizzes.EMT,
)
/** Resolve the quiz status for an attendee using the same fallback
 *  chain as the eval column:
 *    (1) manual quiz_credited override → 'passed'
 *    (2) email match → submission.passed ? 'passed' : 'failed'
 *    (3) normalized-name match → submission.passed ? 'passed' : 'failed'
 *    (4) otherwise 'notTaken' (or 'noQuiz' if no quiz configured) */
function quizStatusFor(a: {
  studentEmail: string
  studentName: string
  quizCredited?: boolean
}): QuizStatus {
  if (!hasAnyQuizConfigured.value) return 'noQuiz'
  if (a.quizCredited) return 'passed'
  const sub =
    submissionsByEmail.value.get((a.studentEmail || '').toLowerCase()) ||
    submissionsByName.value.get(normName(a.studentName))
  if (!sub) return 'notTaken'
  return sub.passed ? 'passed' : 'failed'
}

const togglingQuizId = ref<string | null>(null)
async function toggleQuizCredit(a: Attendee) {
  togglingQuizId.value = a.id
  try {
    // If they passed via auto-match and don't already have an override,
    // there's nothing to flip toggle on. (Allow revoke of an explicit
    // override even when auto-match would still pass them.)
    const emailLc = (a.studentEmail || '').toLowerCase()
    const n = normName(a.studentName)
    const autoPassed =
      (submissionsByEmail.value.get(emailLc)?.passed ?? false) ||
      (!!n && (submissionsByName.value.get(n)?.passed ?? false))
    if (autoPassed && !a.quizCredited) return
    await sessions.setQuizCredited(a.id, !a.quizCredited)
    await sessions.refreshRoster(s.value!.sessionId)
  } finally {
    togglingQuizId.value = null
  }
}

const togglingEvalId = ref<string | null>(null)
async function toggleEvalCredit(a: Attendee) {
  togglingEvalId.value = a.id
  try {
    // If the attendee was matched automatically (email or name), we
    // don't need to write — the column already shows ✔. But if the
    // instructor clicks ✔ to UN-credit, set the flag false.
    const auto =
      evalEmails.value.has((a.studentEmail || '').toLowerCase()) ||
      (normName(a.studentName) &&
        evalNames.value.has(normName(a.studentName)))
    if (auto && !a.evalCredited) {
      // Already credited automatically — nothing to flip.
      return
    }
    await sessions.setEvalCredited(a.id, !a.evalCredited)
    await sessions.refreshRoster(s.value!.sessionId)
  } finally {
    togglingEvalId.value = null
  }
}

/* ── Lecture: Award CE Credits ─────────────────────────────────────── */
const awarding = ref(false)
// Per-row "Award" buttons share the bulk pipeline. Track which attendee
// is mid-award so we can disable the row's button + show "Awarding…".
const awardingId = ref<string | null>(null)
interface AwardSummary {
  issued: number
  skipped: number
  failures: number
  alreadyIssued: number
  noEval: number
  notCheckedIn: number
  noQuiz: number
  failedQuiz: number
  notEngaged: number
}
type AwardOutcome =
  | 'issued'
  | 'alreadyIssued'
  | 'noEval'
  | 'notCheckedIn'
  | 'noQuiz'
  | 'failedQuiz'
  | 'notEngaged'
  | 'failure'
const awardSummary = ref<AwardSummary | null>(null)
const lastAwardMsg = ref<{ t: string; k: 'ok' | 'err' | 'info' } | null>(null)

interface AwardContext {
  evalEmailsLc: Set<string>
  evalNamesNorm: Set<string>
  passedQuizEmailsLc: Set<string>
  tookQuizEmailsLc: Set<string>
  passedQuizNamesNorm: Set<string>
  tookQuizNamesNorm: Set<string>
  quizExists: boolean
  codesIssued: number
  engagementThreshold: number
  engagementCountByEmail: Map<string, number>
  ceHours: string
  dshs: string
  lectureTitle: string
  instructorName: string
  lectureDate: Date
  yearForNumber: number
  sessionId: string
}

async function buildAwardContext(session: CourseSession): Promise<AwardContext> {
  await sessions.loadQuizSubmissions(session.sessionId)
  await sessions.loadEngagementCodes(session.sessionId)
  await sessions.loadEngagementResponses(session.sessionId)
  const quizExists = !!sessions.quizzes.Paramedic || !!sessions.quizzes.EMT
  const codesIssued = sessions.engagementCodes.length
  const engagementCountByEmail = new Map<string, number>()
  if (codesIssued > 0) {
    const seenPairs = new Set<string>()
    for (const r of sessions.engagementResponses) {
      const email = r.attendeeEmail.toLowerCase()
      const pair = `${email}|${r.codeId}`
      if (seenPairs.has(pair)) continue
      seenPairs.add(pair)
      engagementCountByEmail.set(
        email,
        (engagementCountByEmail.get(email) ?? 0) + 1,
      )
    }
  }
  const [y, m, d] = (session.classDate || '').split('-').map(Number)
  const lectureDate = y && m && d ? new Date(y, m - 1, d) : new Date()
  return {
    evalEmailsLc: new Set(
      sessions.evals.map((e) => (e.studentEmail || '').toLowerCase()),
    ),
    evalNamesNorm: new Set(sessions.evals.map((e) => normName(e.studentName))),
    passedQuizEmailsLc: new Set(
      sessions.quizSubmissions
        .filter((sub) => sub.passed)
        .map((sub) => sub.studentEmail.toLowerCase()),
    ),
    tookQuizEmailsLc: new Set(
      sessions.quizSubmissions.map((sub) => sub.studentEmail.toLowerCase()),
    ),
    passedQuizNamesNorm: new Set(
      sessions.quizSubmissions
        .filter((sub) => sub.passed)
        .map((sub) => normName(sub.studentName))
        .filter(Boolean),
    ),
    tookQuizNamesNorm: new Set(
      sessions.quizSubmissions
        .map((sub) => normName(sub.studentName))
        .filter(Boolean),
    ),
    quizExists,
    codesIssued,
    engagementThreshold:
      session.engagementThresholdPct ?? ENGAGEMENT_DEFAULT_PCT,
    engagementCountByEmail,
    ceHours: session.hoursAwarded || '1.0',
    dshs: session.dshsContentArea || '',
    lectureTitle: session.lectureTitle || session.title || 'CE Lecture',
    instructorName: session.primaryInstructorName || 'WCEMS Instructor',
    lectureDate,
    yearForNumber: lectureDate.getFullYear(),
    sessionId: session.sessionId,
  }
}

/** Award a CE certificate to a single attendee. Returns the outcome
 *  used by both the bulk pipeline summary and the per-row toast. */
async function awardOne(a: Attendee, ctx: AwardContext): Promise<AwardOutcome> {
  const eligibleStatus = a.status === 'CheckedIn' || a.status === 'Approved'
  if (!eligibleStatus) return 'notCheckedIn'
  if (a.ceCertIssuedAt) return 'alreadyIssued'
  const emailLc = a.studentEmail.toLowerCase()
  const nameNorm = normName(a.studentName)
  const hasEvalCredit =
    a.evalCredited ||
    ctx.evalEmailsLc.has(emailLc) ||
    (!!nameNorm && ctx.evalNamesNorm.has(nameNorm))
  if (!hasEvalCredit) return 'noEval'
  if (ctx.quizExists) {
    // Same chain as the Quiz column: manual override > email match >
    // name match. Skip with a specific reason for "not taken" vs
    // "didn't pass" so the toast / summary is accurate.
    if (!a.quizCredited) {
      const tookByEmail = ctx.tookQuizEmailsLc.has(emailLc)
      const tookByName = !!nameNorm && ctx.tookQuizNamesNorm.has(nameNorm)
      if (!tookByEmail && !tookByName) return 'noQuiz'
      const passedByEmail = ctx.passedQuizEmailsLc.has(emailLc)
      const passedByName = !!nameNorm && ctx.passedQuizNamesNorm.has(nameNorm)
      if (!passedByEmail && !passedByName) return 'failedQuiz'
    }
  }
  if (ctx.codesIssued > 0 && a.attendanceMode === 'Virtual') {
    const responded = ctx.engagementCountByEmail.get(emailLc) ?? 0
    const pct = Math.round((responded / ctx.codesIssued) * 100)
    if (pct < ctx.engagementThreshold) return 'notEngaged'
  }
  try {
    const certNumber = makeCeCertNumber(ctx.yearForNumber, a.id)
    // Per-attendee override beats the session default (early-leavers,
    // virtual attendees who skip the hands-on portion, etc).
    const hoursForCert = (a.ceHoursOverride || '').trim() || ctx.ceHours
    const pdf = await generateCeCertificate({
      studentName: a.studentName,
      lectureTitle: ctx.lectureTitle,
      ceHours: hoursForCert,
      dshsContentArea: ctx.dshs,
      instructorName: ctx.instructorName,
      lectureDate: ctx.lectureDate,
      certNumber,
    })
    const blob = pdf.output('blob') as Blob
    const fileName = `${safeEmail(a.studentEmail)}_CE_Certificate.pdf`
    const archived = await archiveFile({
      sessionId: ctx.sessionId,
      recordType: 'CE',
      fileName,
      blob,
      studentEmail: a.studentEmail,
    })
    await sessions.setCeCertIssued(a.id, {
      certNumber,
      path: archived.path,
    })
    return 'issued'
  } catch (err) {
    console.error('[awardCe] failed for', a.studentEmail, err)
    return 'failure'
  }
}

function tallyAward(outcome: AwardOutcome, s: AwardSummary) {
  if (outcome === 'issued') s.issued++
  else if (outcome === 'failure') s.failures++
  else {
    s.skipped++
    if (outcome === 'alreadyIssued') s.alreadyIssued++
    else if (outcome === 'noEval') s.noEval++
    else if (outcome === 'notCheckedIn') s.notCheckedIn++
    else if (outcome === 'noQuiz') s.noQuiz++
    else if (outcome === 'failedQuiz') s.failedQuiz++
    else if (outcome === 'notEngaged') s.notEngaged++
  }
}

const SKIP_REASONS: Record<AwardOutcome, string> = {
  issued: 'CE certificate issued.',
  alreadyIssued: 'Already had a cert on file — nothing to do.',
  noEval: "No eval submitted (or it didn't match). Click the eval cell to credit them manually.",
  notCheckedIn: 'Not checked in or approved yet.',
  noQuiz: "Didn't take the quiz.",
  failedQuiz: "Didn't pass the quiz.",
  notEngaged: 'Below the engagement threshold for virtual attendees.',
  failure: 'Failed to generate / archive the certificate (see browser console).',
}

/** Per-row Award button — runs the same pipeline as the bulk action but
 *  for a single attendee. Returns immediately with a small toast so the
 *  instructor knows whether it issued or was skipped + why. */
async function awardAttendee(a: Attendee) {
  if (!s.value || s.value.sessionType !== 'Lecture') return
  awardingId.value = a.id
  lastAwardMsg.value = null
  try {
    const ctx = await buildAwardContext(s.value)
    const outcome = await awardOne(a, ctx)
    lastAwardMsg.value = {
      t: `${a.studentName}: ${SKIP_REASONS[outcome]}`,
      k:
        outcome === 'issued'
          ? 'ok'
          : outcome === 'failure'
            ? 'err'
            : 'info',
    }
    setTimeout(() => (lastAwardMsg.value = null), 6000)
    await load(s.value.sessionId)
  } finally {
    awardingId.value = null
  }
}

function safeEmail(email: string): string {
  return email.replace(/[^a-z0-9._+-]/gi, '_')
}

/* ── Lecture: bulk regenerate CE certs → ZIP ───────────────────────
 * Rebuilds every issued cert from the latest data (cert template,
 * hours override, eval/quiz overrides) and packs them into a single
 * zip download. Each rebuilt PDF also OVERWRITES the archived copy
 * so the 5-year record store stays in sync with what was sent out.
 * For attendees who don't yet have a cert, this is a no-op — use
 * the per-row Award button or the bulk Award CE Credits action to
 * issue new ones. */
const regening = ref(false)
const regenProgress = ref(0)
interface RegenSummary {
  rebuilt: number
  newly: number
  skipped: number
  failures: number
}
const regenSummary = ref<RegenSummary | null>(null)

async function regenerateAndDownloadCerts() {
  if (!s.value || s.value.sessionType !== 'Lecture') return
  const session = s.value
  if (
    !confirm(
      'Regenerate every CE certificate for this session, download as a ZIP, ' +
        'and overwrite the archived copies?\n\n' +
        'This rebuilds any cert that has already been issued. Attendees who ' +
        'don\'t have a cert yet are skipped — use Award CE Credits (bulk or ' +
        'per row) to issue them first.',
    )
  )
    return

  regening.value = true
  regenProgress.value = 0
  regenSummary.value = null
  const summary: RegenSummary = { rebuilt: 0, newly: 0, skipped: 0, failures: 0 }
  try {
    // Same context fetch the award flow uses — keeps overrides + eval/
    // quiz auto-match in sync.
    const ctx = await buildAwardContext(session)
    const candidates = sessions.attendance.filter((a) => !!a.ceCertIssuedAt)
    if (!candidates.length) {
      regenSummary.value = summary
      lastAwardMsg.value = {
        t: 'No certs to regenerate — nobody has been awarded a CE certificate yet.',
        k: 'info',
      }
      setTimeout(() => (lastAwardMsg.value = null), 6000)
      return
    }
    const zip = new JSZip()
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i]
      try {
        const certNumber =
          a.ceCertNumber || makeCeCertNumber(ctx.yearForNumber, a.id)
        const hoursForCert =
          (a.ceHoursOverride || '').trim() || ctx.ceHours
        const pdf = await generateCeCertificate({
          studentName: a.studentName,
          lectureTitle: ctx.lectureTitle,
          ceHours: hoursForCert,
          dshsContentArea: ctx.dshs,
          instructorName: ctx.instructorName,
          lectureDate: ctx.lectureDate,
          certNumber,
        })
        const blob = pdf.output('blob') as Blob
        const fileName = `${safeEmail(a.studentEmail)}_CE_Certificate.pdf`
        zip.file(fileName, blob)
        // Overwrite the archived copy so a download from /hub gets the
        // rebuilt version too. archiveFile timestamps the filename, so
        // we explicitly remove the old path first to avoid drift.
        try {
          if (a.ceCertPath) {
            await sessions.deleteArchive(
              {
                path: a.ceCertPath,
                recordType: 'CE',
                studentEmail: a.studentEmail,
              },
              session.sessionId,
            )
          }
        } catch {
          /* non-fatal — re-archive will still happen below */
        }
        const archived = await archiveFile({
          sessionId: session.sessionId,
          recordType: 'CE',
          fileName,
          blob,
          studentEmail: a.studentEmail,
        })
        await sessions.setCeCertIssued(a.id, {
          certNumber,
          path: archived.path,
        })
        summary.rebuilt++
      } catch (err) {
        console.error('[regenCe] failed for', a.studentEmail, err)
        summary.failures++
      }
      regenProgress.value = Math.round(((i + 1) / candidates.length) * 100)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    const datePart = (session.classDate || '').slice(0, 10)
    link.download = `CE_Certificates_${datePart || session.sessionId}.zip`
    link.click()
    URL.revokeObjectURL(url)
    regenSummary.value = summary
    await load(session.sessionId)
  } finally {
    regening.value = false
  }
}

async function awardCeCredits() {
  if (!s.value) return
  const session = s.value
  if (session.sessionType !== 'Lecture') return

  const hasQuiz =
    !!sessions.quizzes.Paramedic || !!sessions.quizzes.EMT
  if (
    !confirm(
      'Award CE certificates to all qualifying attendees?\n\n' +
        '"Qualifying" means: Checked-In or Approved AND has submitted an ' +
        'evaluation' +
        (hasQuiz ? ' AND passed the quiz' : '') +
        '. Each certificate is generated, archived, and the attendee ' +
        'row is flagged. Attendees who already have a cert on file ' +
        'are skipped.',
    )
  ) {
    return
  }

  awarding.value = true
  awardSummary.value = null
  const summary: AwardSummary = {
    issued: 0,
    skipped: 0,
    failures: 0,
    alreadyIssued: 0,
    noEval: 0,
    notCheckedIn: 0,
    noQuiz: 0,
    failedQuiz: 0,
    notEngaged: 0,
  }

  try {
    const ctx = await buildAwardContext(session)
    for (const a of sessions.attendance) {
      tallyAward(await awardOne(a, ctx), summary)
    }
    awardSummary.value = summary
    await load(session.sessionId) // refresh attendance to show the new flags
  } finally {
    awarding.value = false
  }
}

/* ── Quiz builder (lecture only) ───────────────────────────────────── */
import type { Attendee, CertLevel, CourseSession, QuizQuestion } from '@/training/types'

interface DraftQuestion {
  prompt: string
  options: string[]
  correctIndex: number
  rationale: string
}
interface QuizDraft {
  passingPct: number
  attemptsAllowed: number
  questions: DraftQuestion[]
}
function emptyDraft(): QuizDraft {
  return {
    passingPct: 80,
    attemptsAllowed: 3,
    questions: [],
  }
}
function emptyQuestion(): DraftQuestion {
  return { prompt: '', options: ['', ''], correctIndex: 0, rationale: '' }
}

const certTab = ref<CertLevel>('Paramedic')
const quizDrafts = ref<Record<CertLevel, QuizDraft>>({
  Paramedic: emptyDraft(),
  EMT: emptyDraft(),
})
const quizSaving = ref<Record<CertLevel, boolean>>({
  Paramedic: false,
  EMT: false,
})
const quizSaveFlash = ref<string | null>(null)

function initQuizDrafts() {
  for (const cert of ['Paramedic', 'EMT'] as const) {
    const persisted = sessions.quizzes[cert]
    if (persisted) {
      quizDrafts.value[cert] = {
        passingPct: persisted.passingPct,
        attemptsAllowed: persisted.attemptsAllowed,
        questions: persisted.questions.map((q: QuizQuestion) => ({
          prompt: q.prompt,
          options: [...q.options],
          correctIndex: q.correctIndex,
          rationale: q.rationale,
        })),
      }
    } else {
      quizDrafts.value[cert] = emptyDraft()
    }
  }
}

function addQuestion(cert: CertLevel) {
  quizDrafts.value[cert].questions.push(emptyQuestion())
}
function removeQuestion(cert: CertLevel, idx: number) {
  quizDrafts.value[cert].questions.splice(idx, 1)
}
function addOption(cert: CertLevel, qIdx: number) {
  const q = quizDrafts.value[cert].questions[qIdx]
  if (q.options.length < 6) q.options.push('')
}
function removeOption(cert: CertLevel, qIdx: number, oIdx: number) {
  const q = quizDrafts.value[cert].questions[qIdx]
  if (q.options.length <= 2) return
  q.options.splice(oIdx, 1)
  if (q.correctIndex >= q.options.length) {
    q.correctIndex = q.options.length - 1
  }
}
function moveQuestion(cert: CertLevel, idx: number, delta: number) {
  const qs = quizDrafts.value[cert].questions
  const j = idx + delta
  if (j < 0 || j >= qs.length) return
  ;[qs[idx], qs[j]] = [qs[j], qs[idx]]
}

function quizValidationError(cert: CertLevel): string | null {
  const d = quizDrafts.value[cert]
  if (!d.questions.length) return 'Add at least one question.'
  for (let i = 0; i < d.questions.length; i++) {
    const q = d.questions[i]
    if (!q.prompt.trim()) return `Question ${i + 1}: prompt is empty.`
    if (q.options.length < 2) return `Question ${i + 1}: needs at least 2 options.`
    const blanks = q.options.filter((o) => !o.trim()).length
    if (blanks) return `Question ${i + 1}: ${blanks} blank option(s).`
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      return `Question ${i + 1}: mark the correct answer.`
    }
  }
  if (d.passingPct < 0 || d.passingPct > 100) return 'Passing % must be 0–100.'
  if (d.attemptsAllowed < 0 || d.attemptsAllowed > 10) {
    return 'Attempts must be 0–10 (0 = unlimited).'
  }
  return null
}

async function saveQuizDraft(cert: CertLevel) {
  if (!s.value || s.value.sessionType !== 'Lecture') return
  const err = quizValidationError(cert)
  if (err) {
    alert(err)
    return
  }
  quizSaving.value[cert] = true
  try {
    await sessions.saveQuiz({
      courseSessionUuid: s.value.id,
      certLevel: cert,
      passingPct: quizDrafts.value[cert].passingPct,
      attemptsAllowed: quizDrafts.value[cert].attemptsAllowed,
      questions: quizDrafts.value[cert].questions.map((q) => ({
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
        rationale: q.rationale.trim(),
      })),
    })
    initQuizDrafts()
    quizSaveFlash.value = `${cert} quiz saved.`
    setTimeout(() => (quizSaveFlash.value = null), 4000)
  } catch (e) {
    alert(
      'Save failed: ' + (e instanceof Error ? e.message : 'unknown error'),
    )
  } finally {
    quizSaving.value[cert] = false
  }
}

async function deleteQuizForCert(cert: CertLevel) {
  if (!s.value) return
  const persisted = sessions.quizzes[cert]
  if (!persisted) {
    // Just a draft — drop locally.
    quizDrafts.value[cert] = emptyDraft()
    return
  }
  if (
    !confirm(
      `Delete the ${cert} quiz?\n\n` +
        `All questions for this cert level will be removed. Existing ` +
        `submissions stay archived but the quiz won't be takeable. ` +
        `This cannot be undone.`,
    )
  ) {
    return
  }
  try {
    await sessions.deleteQuiz(persisted.id, s.value.id)
    initQuizDrafts()
  } catch (e) {
    alert(
      'Delete failed: ' + (e instanceof Error ? e.message : 'unknown error'),
    )
  }
}

async function toggleQuizStatus() {
  if (!s.value) return
  const next = s.value.quizStatus === 'Open' ? 'Closed' : 'Open'
  await sessions.setQuizSessionStatus(s.value.sessionId, next)
}

const hasAnyQuiz = computed(
  () => !!sessions.quizzes.Paramedic || !!sessions.quizzes.EMT,
)

const quizPublicUrl = computed(() =>
  s.value?.quizToken
    ? `${window.location.origin}/quiz?t=${s.value.quizToken}`
    : '',
)

/** Collapse state for the Quizzes section. Defaults to collapsed when
 *  no quizzes are configured (typical case for non-quiz lectures);
 *  expanded once any cert quiz exists. Persisted per session in
 *  localStorage so manual collapse sticks across reloads. */
const quizCollapsed = ref(true)
function quizCollapseKey(sessionId: string) {
  return `wcems-quiz-collapsed:${sessionId}`
}
watch(
  () => s.value?.sessionId,
  (id) => {
    if (!id) return
    const stored = localStorage.getItem(quizCollapseKey(id))
    if (stored === 'true' || stored === 'false') {
      quizCollapsed.value = stored === 'true'
    } else {
      quizCollapsed.value = !hasAnyQuiz.value
    }
  },
)
watch(hasAnyQuiz, (v) => {
  // First time a quiz appears, auto-expand if the user hasn't already
  // made an explicit choice.
  const id = s.value?.sessionId
  if (!id) return
  if (v && localStorage.getItem(quizCollapseKey(id)) === null) {
    quizCollapsed.value = false
  }
})
function toggleQuizCollapsed() {
  quizCollapsed.value = !quizCollapsed.value
  const id = s.value?.sessionId
  if (id) localStorage.setItem(quizCollapseKey(id), String(quizCollapsed.value))
}

const quizSubsByCert = computed(() => {
  const out: Record<CertLevel, number> = { Paramedic: 0, EMT: 0 }
  for (const sub of sessions.quizSubmissions) {
    if (sub.quizId === sessions.quizzes.Paramedic?.id) out.Paramedic++
    else if (sub.quizId === sessions.quizzes.EMT?.id) out.EMT++
  }
  return out
})

/** Per-cert leaderboard for the instructor: every submission, sorted
 *  with passed-first then by score descending. Realtime — refreshed
 *  by the training_quiz_submissions channel in the store. */
const submissionsForCert = computed(() => {
  const quiz = sessions.quizzes[certTab.value]
  if (!quiz) return [] as Array<{
    id: string
    studentName: string
    studentEmail: string
    scorePct: number
    passed: boolean
    attemptsUsed: number
    submittedAt: string
  }>
  return sessions.quizSubmissions
    .filter((sub) => sub.quizId === quiz.id)
    .slice()
    .sort((a, b) => {
      if (a.passed !== b.passed) return a.passed ? -1 : 1
      if (a.scorePct !== b.scorePct) return b.scorePct - a.scorePct
      return a.studentName.localeCompare(b.studentName)
    })
})
const submissionsPassedCount = computed(
  () => submissionsForCert.value.filter((s) => s.passed).length,
)

function fmtSubmittedAt(ts: string) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime())
    ? ts
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}
</script>

<template>
  <AppShell>
    <header class="head">
      <div>
        <div class="eyebrow">Instructor dashboard</div>
        <h1 class="display title">Session Controls</h1>
      </div>
      <div class="head__tools">
        <button
          v-if="selected"
          class="btn btn-secondary"
          @click="selected = ''"
        >
          ← All sessions
        </button>
        <button v-if="s" class="btn btn-secondary" @click="load(selected)">
          <RefreshCw :size="15" /> Refresh
        </button>
      </div>
    </header>

    <!-- ── Landing: clickable session table ─────────────────────────── -->
    <section v-if="!selected" class="card listcard">
      <div class="listcard__head">
        <span class="eyebrow">Active sessions</span>
        <span class="listcard__hint">Tap a row to open its controls</span>
      </div>
      <div v-if="!sessions.recentSessions.length" class="listcard__empty">
        <CalendarDays :size="26" :stroke-width="1.5" />
        <p>No active sessions yet — create one to get started.</p>
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
            <td class="stbl__course">
              {{
                row.sessionType === 'CardClass'
                  ? row.cardCourseName || row.title
                  : row.lectureTitle || row.title
              }}
            </td>
            <td class="num muted">{{ shortDate(row.classDate) }}</td>
            <td class="muted">
              {{ row.primaryInstructorName || '—' }}
            </td>
            <td><span class="chip">{{ row.sessionType }}</span></td>
            <td>
              <span class="dotpill" :class="row.checkInStatus === 'Open' ? 'on' : 'off'">
                <span class="dotpill__d" />
                {{ row.checkInStatus === 'Open' ? 'Check-in open' : 'Idle' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-else-if="sessions.loading" class="state card">Loading session…</div>
    <div v-else-if="sessions.error" class="state card err">
      {{ sessions.error }}
    </div>

    <template v-else-if="s">
      <!-- Summary -->
      <div class="summary card">
        <div class="sm-main">
          <div class="eyebrow">{{ s.sessionType }}</div>
          <h2 class="display sm-title">{{ courseName() }}</h2>
          <div class="sm-meta">
            <span><CalendarDays :size="14" /> {{ fmtDate(s.classDate) }}</span>
            <span v-if="s.primaryInstructorName"
              ><User :size="14" /> {{ s.primaryInstructorName }}</span
            >
            <button
              v-if="s.sessionType === 'CardClass'"
              type="button"
              class="sm-editbtn"
              @click="openEditDetails"
            >
              <Pencil :size="12" /> Edit details
            </button>
          </div>
          <div v-if="assistList.length" class="sm-assist">
            Assisting: {{ assistList.join(', ') }}
          </div>
          <div v-if="s.sessionType === 'Lecture'" class="sm-hours">
            <label class="sm-hours__lbl">CE hours awarded</label>
            <input
              v-model="hoursDraft"
              class="sm-hours__inp"
              type="text"
              inputmode="decimal"
              placeholder="1.0"
              :disabled="hoursSaving"
              @blur="saveHours"
              @keydown.enter.prevent="saveHours"
            />
            <button
              type="button"
              class="sm-hours__btn"
              :disabled="!hoursDirty || hoursSaving"
              @click="saveHours"
            >
              {{ hoursSaving ? 'Saving…' : 'Save' }}
            </button>
            <span
              v-if="hoursFlash === 'saved'"
              class="sm-hours__flash sm-hours__flash--ok"
              >Saved</span
            >
            <span
              v-else-if="hoursFlash === 'error'"
              class="sm-hours__flash sm-hours__flash--err"
              >Save failed</span
            >
            <small class="sm-hours__hint">
              Used on the CE certificate. Edit after the lecture to reflect
              actual instruction time.
            </small>
          </div>
        </div>
        <div class="sm-pills">
          <span class="pill" :class="s.checkInStatus === 'Open' ? 'on' : 'off'">
            Check-in {{ s.checkInStatus === 'Open' ? 'open' : 'closed' }}
          </span>
          <span class="pill" :class="s.evalStatus === 'Open' ? 'on' : 'off'">
            Evals {{ s.evalStatus === 'Open' ? 'open' : 'closed' }}
          </span>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats">
        <div class="stat card">
          <span class="stat-n">{{ checkedIn.length }}</span>
          <span class="stat-l">Checked in</span>
        </div>
        <div class="stat card">
          <span class="stat-n">{{ registeredCount }}</span>
          <span class="stat-l">Registered</span>
        </div>
        <div class="stat card">
          <span class="stat-n">{{ evalCount }}</span>
          <span class="stat-l">Evals done</span>
        </div>
        <RouterLink
          class="stat card link"
          :to="{ name: 'registrations', query: { sessionId: selected } }"
        >
          <ClipboardList :size="20" :stroke-width="1.75" />
          <span class="stat-l">View registrations</span>
        </RouterLink>
      </div>

      <!-- Controls + QR -->
      <div class="cols">
        <div class="block">
          <div class="block-label">Live controls</div>
          <div class="toggle-row">
            <div>
              <div class="t-label">Check-In</div>
              <div class="t-desc">Allow attendees to check in via QR</div>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="s.checkInStatus === 'Open'"
                @change="toggleCheckIn"
              />
              <span class="slider" />
            </label>
          </div>
          <div class="toggle-row">
            <div>
              <div class="t-label">Evaluation</div>
              <div class="t-desc">Allow attendees to submit evaluations</div>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="s.evalStatus === 'Open'"
                @change="toggleEval"
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="block">
          <div class="block-label">QR codes</div>
          <div class="qr-row">
            <div class="qr-tile">
              <img :src="qrCheckin" alt="Check-in QR" />
              <div class="qr-name">Check-In</div>
              <div class="qr-actions">
                <button class="mini" @click="copyLink('checkin')">
                  <component
                    :is="copied === 'checkin' ? Check : Copy"
                    :size="13"
                  />
                  {{ copied === 'checkin' ? 'Copied' : 'Copy' }}
                </button>
                <button class="mini" @click="openDisplay('checkin')">
                  <Monitor :size="13" /> Display
                </button>
              </div>
            </div>
            <div class="qr-tile">
              <img :src="qrEval" alt="Eval QR" />
              <div class="qr-name">Evaluation</div>
              <div class="qr-actions">
                <button class="mini" @click="copyLink('eval')">
                  <component
                    :is="copied === 'eval' ? Check : Copy"
                    :size="13"
                  />
                  {{ copied === 'eval' ? 'Copied' : 'Copy' }}
                </button>
                <button class="mini" @click="openDisplay('eval')">
                  <Monitor :size="13" /> Display
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pending approvals (walk-ins when require-registration is on) -->
      <div v-if="pendingApprovals.length" class="block pending">
        <div class="block-label pending-h">
          <span>Pending approvals</span>
          <span class="pcount">{{ pendingApprovals.length }}</span>
          <span class="phint">
            Walk-ins waiting for your tap. Approve to add to the roster.
          </span>
        </div>
        <div v-for="a in pendingApprovals" :key="a.id" class="prow">
          <div class="prow__body">
            <div class="prow__name">{{ a.studentName }}</div>
            <div class="prow__email">{{ a.studentEmail }}</div>
            <div class="prow__meta">
              <span class="chip">{{ a.attendanceMode || '—' }}</span>
              <span class="chip warn">Walk-in</span>
            </div>
          </div>
          <div class="prow__actions">
            <button class="btn btn-primary sm" @click="approve(a.id)">
              Approve
            </button>
            <button class="btn-text" @click="reject(a.id)">Reject</button>
          </div>
        </div>
      </div>

      <!-- Roster -->
      <div class="block">
        <div class="block-label roster-h">
          <span>Attendance roster</span>
          <span class="live"><span class="dot" /> Live</span>
          <div class="srch">
            <Search :size="14" />
            <input v-model="search" type="text" placeholder="Search" />
          </div>
        </div>
        <div v-if="!roster.length" class="r-empty">
          {{ search ? 'No matches.' : 'No check-ins yet.' }}
        </div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Mode</th>
              <th>PSA</th>
              <th>Eval</th>
              <th v-if="!isCardClass && hasAnyQuizConfigured">Quiz</th>
              <th v-if="isCardClass">Exam</th>
              <th v-if="isCardClass">eCard</th>
              <th v-if="!isCardClass">CE</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in roster" :key="a.id">
              <td>{{ a.studentName }}</td>
              <td class="muted">{{ a.studentEmail }}</td>
              <td><span class="chip">{{ a.attendanceMode || '—' }}</span></td>
              <td>
                <input
                  class="psa"
                  :class="{
                    saving: savingIds.has(a.id),
                    saved: savedIds.has(a.id),
                  }"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0-100"
                  :value="a.psaScore ?? ''"
                  @blur="savePsa(a.id, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="ctr">
                <button
                  type="button"
                  class="evalbtn"
                  :class="hasEval(a) ? 'yes' : 'no'"
                  :disabled="togglingEvalId === a.id"
                  :title="
                    a.evalCredited
                      ? 'Manually credited — click to revoke'
                      : hasEval(a)
                        ? 'Eval on file — click to remove credit override (auto-match will still apply)'
                        : 'No eval matched — click to manually credit them'
                  "
                  @click="toggleEvalCredit(a)"
                >
                  {{ hasEval(a) ? '✔' : '✖' }}
                </button>
              </td>
              <td
                v-if="!isCardClass && hasAnyQuizConfigured"
                class="ctr"
              >
                <button
                  type="button"
                  class="quizpill"
                  :class="`quizpill--${quizStatusFor(a)}`"
                  :disabled="togglingQuizId === a.id"
                  :title="
                    a.quizCredited
                      ? 'Manually credited — click to revoke'
                      : quizStatusFor(a) === 'passed'
                        ? 'Quiz on file (passed) — click to remove credit override (auto-match will still apply)'
                        : quizStatusFor(a) === 'failed'
                          ? 'Did not pass — click to manually credit them'
                          : 'No quiz submission matched — click to manually credit them'
                  "
                  @click="toggleQuizCredit(a)"
                >
                  {{
                    quizStatusFor(a) === 'passed'
                      ? 'Passed'
                      : quizStatusFor(a) === 'failed'
                        ? 'Failed'
                        : '—'
                  }}
                </button>
              </td>
              <td v-if="isCardClass" class="ctr">
                <label class="upload-btn" :class="{ busy: uploadingExamId === a.id }">
                  <Upload :size="13" :stroke-width="2" />
                  <span>{{
                    uploadingExamId === a.id ? 'Uploading…' : 'Upload'
                  }}</span>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    hidden
                    @change="(e) => handleExamUpload(e, a)"
                  />
                </label>
              </td>
              <td v-if="isCardClass">
                <button
                  type="button"
                  class="ecard"
                  :class="{ 'ecard--on': a.ecardIssuedAt }"
                  :title="a.ecardIssuedAt ? 'Issued ' + fmtIssued(a.ecardIssuedAt) + ' — click to clear' : 'Click to mark issued'"
                  @click="toggleEcard(a)"
                >
                  <CreditCard :size="13" :stroke-width="2" />
                  <span v-if="a.ecardIssuedAt">{{
                    fmtIssued(a.ecardIssuedAt)
                  }}</span>
                  <span v-else>Pending</span>
                </button>
              </td>
              <td v-if="!isCardClass" class="ctr">
                <button
                  v-if="a.ceCertIssuedAt"
                  class="cebadge"
                  type="button"
                  :title="'Issued ' + fmtIssued(a.ceCertIssuedAt)"
                  disabled
                >
                  <Award :size="13" /> Issued
                </button>
                <button
                  v-else
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="awardingId === a.id || awarding"
                  @click="awardAttendee(a)"
                >
                  <Award :size="13" />
                  {{ awardingId === a.id ? 'Awarding…' : 'Award' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="examMsg" class="exam-msg">{{ examMsg }}</div>
        <div
          v-if="lastAwardMsg"
          class="award-toast"
          :class="`award-toast--${lastAwardMsg.k}`"
        >
          {{ lastAwardMsg.t }}
        </div>
      </div>

      <!-- Quiz builder (lecture only) -->
      <div v-if="s && s.sessionType === 'Lecture'" class="block">
        <button
          type="button"
          class="block-label block-label--toggle"
          :class="{ 'block-label--collapsed': quizCollapsed }"
          @click="toggleQuizCollapsed"
        >
          <ClipboardList :size="14" />
          Quizzes (optional)
          <span v-if="hasAnyQuiz" class="block-label__pill">
            {{ s.quizStatus === 'Open' ? 'Open' : 'Closed' }}
          </span>
          <span v-else class="block-label__pill block-label__pill--muted">
            Not configured
          </span>
          <span class="block-label__sp" />
          <span class="block-label__chev" aria-hidden="true">▾</span>
        </button>

        <div v-show="!quizCollapsed">
        <div class="quiz-head">
          <div class="quiz-head__copy">
            <p class="quiz-head__hint">
              Build a short multiple-choice quiz per cert level. Students
              pick their cert on the public page and take the matching
              quiz. Award CE Credits will require a passing score whenever
              any quiz exists for this session.
            </p>
          </div>
          <button
            class="btn"
            :class="s.quizStatus === 'Open' ? 'btn-danger' : 'btn-primary'"
            :disabled="!hasAnyQuiz"
            :title="hasAnyQuiz ? '' : 'Add at least one quiz before opening'"
            @click="toggleQuizStatus"
          >
            {{ s.quizStatus === 'Open' ? 'Close quiz' : 'Open quiz' }}
          </button>
        </div>

        <div class="quiz-qrtile">
          <div class="quiz-qrtile__qr">
            <img v-if="qrQuiz" :src="qrQuiz" alt="Quiz QR" />
          </div>
          <div class="quiz-qrtile__body">
            <div class="quiz-qrtile__label">Quiz QR</div>
            <code class="quiz-qrtile__url">{{ quizPublicUrl }}</code>
            <div class="quiz-qrtile__row">
              <button class="btn btn-sm" @click="copyLink('quiz')">
                <Copy :size="13" /> Copy link
              </button>
              <button class="btn btn-sm" @click="openDisplay('quiz')">
                <Monitor :size="13" /> Display
              </button>
              <a
                class="btn btn-sm"
                :href="`/quiz?t=${s.quizToken}`"
                target="_blank"
              >
                Open
              </a>
            </div>
          </div>
        </div>

        <div class="quiz-tabs">
          <button
            type="button"
            class="quiz-tab"
            :class="{ active: certTab === 'Paramedic' }"
            @click="certTab = 'Paramedic'"
          >
            Paramedic
            <span v-if="sessions.quizzes.Paramedic" class="quiz-tab__cnt">
              {{ sessions.quizzes.Paramedic.questions.length }} Q
            </span>
            <span v-if="quizSubsByCert.Paramedic" class="quiz-tab__subs">
              · {{ quizSubsByCert.Paramedic }} subs
            </span>
          </button>
          <button
            type="button"
            class="quiz-tab"
            :class="{ active: certTab === 'EMT' }"
            @click="certTab = 'EMT'"
          >
            EMT / AEMT
            <span v-if="sessions.quizzes.EMT" class="quiz-tab__cnt">
              {{ sessions.quizzes.EMT.questions.length }} Q
            </span>
            <span v-if="quizSubsByCert.EMT" class="quiz-tab__subs">
              · {{ quizSubsByCert.EMT }} subs
            </span>
          </button>
        </div>

        <div class="quiz-pane">
          <div class="quiz-pane__bar">
            <label class="quiz-passing">
              <span>Passing %</span>
              <input
                v-model.number="quizDrafts[certTab].passingPct"
                type="number"
                min="0"
                max="100"
              />
            </label>
            <label class="quiz-passing">
              <span>Attempts</span>
              <input
                v-model.number="quizDrafts[certTab].attemptsAllowed"
                type="number"
                min="0"
                max="10"
                :title="'How many times a student may submit. 0 = unlimited.'"
              />
              <small class="quiz-passing__hint">
                0 = unlimited
              </small>
            </label>
            <div class="quiz-pane__sp" />
            <button
              v-if="sessions.quizzes[certTab]"
              class="btn btn-sm danger"
              @click="deleteQuizForCert(certTab)"
            >
              Delete this quiz
            </button>
          </div>

          <div class="quiz-qs">
            <div
              v-for="(q, qIdx) in quizDrafts[certTab].questions"
              :key="qIdx"
              class="quiz-q card"
            >
              <div class="quiz-q__head">
                <span class="quiz-q__n">Q{{ qIdx + 1 }}</span>
                <button
                  type="button"
                  class="quiz-q__mv"
                  :disabled="qIdx === 0"
                  title="Move up"
                  @click="moveQuestion(certTab, qIdx, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="quiz-q__mv"
                  :disabled="qIdx === quizDrafts[certTab].questions.length - 1"
                  title="Move down"
                  @click="moveQuestion(certTab, qIdx, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="quiz-q__rm"
                  title="Remove question"
                  @click="removeQuestion(certTab, qIdx)"
                >
                  ×
                </button>
              </div>
              <textarea
                v-model="q.prompt"
                rows="2"
                placeholder="Question prompt"
              />
              <div class="quiz-opts">
                <div
                  v-for="(_opt, oIdx) in q.options"
                  :key="oIdx"
                  class="quiz-opt"
                  :class="{ 'quiz-opt--correct': q.correctIndex === oIdx }"
                >
                  <input
                    type="radio"
                    :name="`q-${certTab}-${qIdx}`"
                    :checked="q.correctIndex === oIdx"
                    @change="q.correctIndex = oIdx"
                  />
                  <input
                    v-model="q.options[oIdx]"
                    type="text"
                    :placeholder="`Option ${oIdx + 1}`"
                  />
                  <button
                    type="button"
                    class="quiz-opt__rm"
                    :disabled="q.options.length <= 2"
                    @click="removeOption(certTab, qIdx, oIdx)"
                  >
                    ×
                  </button>
                </div>
                <button
                  v-if="q.options.length < 6"
                  type="button"
                  class="quiz-opt__add"
                  @click="addOption(certTab, qIdx)"
                >
                  + Add option
                </button>
              </div>
              <label class="quiz-rationale">
                <span>Rationale <em>optional · shown after submit</em></span>
                <textarea
                  v-model="q.rationale"
                  rows="2"
                  placeholder="Explain why the correct answer is correct (e.g. 'High-quality CPR means compressions at 100-120/min with ≥2-inch depth and full chest recoil.')"
                />
              </label>
            </div>

            <button
              type="button"
              class="quiz-q__add"
              @click="addQuestion(certTab)"
            >
              + Add question
            </button>
          </div>

          <div class="quiz-pane__foot">
            <button
              class="btn btn-primary"
              :disabled="quizSaving[certTab]"
              @click="saveQuizDraft(certTab)"
            >
              {{
                quizSaving[certTab]
                  ? 'Saving…'
                  : sessions.quizzes[certTab]
                    ? `Save ${certTab} quiz`
                    : `Create ${certTab} quiz`
              }}
            </button>
            <span v-if="quizSaveFlash" class="quiz-save-flash">
              ✓ {{ quizSaveFlash }}
            </span>
          </div>

          <!-- Per-student submissions for this cert quiz (realtime) -->
          <div v-if="sessions.quizzes[certTab]" class="qsubs">
            <div class="qsubs__head">
              <span class="qsubs__title">{{ certTab }} submissions</span>
              <span class="qsubs__count">
                {{ submissionsPassedCount }}/{{ submissionsForCert.length }}
                passed
              </span>
            </div>
            <div v-if="!submissionsForCert.length" class="qsubs__empty">
              No submissions yet. They appear here in realtime as students
              submit.
            </div>
            <table v-else class="qsubs__tbl">
              <thead>
                <tr>
                  <th>Student</th>
                  <th class="num">Score</th>
                  <th class="num">Attempts</th>
                  <th>Status</th>
                  <th>Last submit</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sub in submissionsForCert" :key="sub.id">
                  <td>
                    <div class="qsubs__name">{{ sub.studentName }}</div>
                    <div class="qsubs__email">{{ sub.studentEmail }}</div>
                  </td>
                  <td class="num">{{ sub.scorePct }}%</td>
                  <td class="num">
                    {{ sub.attemptsUsed }} /
                    {{
                      sessions.quizzes[certTab]!.attemptsAllowed === 0
                        ? '∞'
                        : sessions.quizzes[certTab]!.attemptsAllowed
                    }}
                  </td>
                  <td>
                    <span
                      class="qsubs__badge"
                      :class="sub.passed ? 'qsubs__badge--ok' : 'qsubs__badge--no'"
                    >
                      {{ sub.passed ? 'Passed' : 'Did not pass' }}
                    </span>
                  </td>
                  <td class="muted">{{ fmtSubmittedAt(sub.submittedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>

      <!-- Engagement codes (lecture, virtual-attendee gating) -->
      <div v-if="s && s.sessionType === 'Lecture'" class="block">
        <button
          type="button"
          class="block-label block-label--toggle"
          :class="{ 'block-label--collapsed': engagementCollapsed }"
          @click="toggleEngagementCollapsed"
        >
          <Radio :size="14" />
          Engagement (virtual attendees)
          <span v-if="activeEngagementCode" class="block-label__pill on">
            Active code · {{ activeCountdownSec }}s
          </span>
          <span v-else-if="sessions.engagementCodes.length" class="block-label__pill">
            {{ sessions.engagementCodes.length }} issued
          </span>
          <span v-else class="block-label__pill block-label__pill--muted">
            Not used yet
          </span>
          <span class="block-label__sp" />
          <span class="block-label__chev" aria-hidden="true">▾</span>
        </button>

        <div v-show="!engagementCollapsed" class="engage">
          <p class="engage__hint">
            Generate a short code mid-lecture and read it aloud over Teams.
            Virtual attendees keep
            <code>/engage?session={{ s.sessionId }}</code> open and submit
            it. Award CE Credits will require Virtual attendees to have
            responded to at least the threshold % of issued codes.
          </p>

          <div class="engage__bar">
            <label class="engage__field">
              <span>Required participation %</span>
              <input
                v-model.number="engageThresholdDraft"
                type="number"
                min="0"
                max="100"
              />
            </label>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="!engageThresholdDirty || engageThresholdSaving"
              @click="saveEngagementThreshold"
            >
              {{ engageThresholdSaving ? 'Saving…' : 'Save threshold' }}
            </button>
            <span
              v-if="engageThresholdFlash === 'saved'"
              class="sm-hours__flash sm-hours__flash--ok"
              >Saved</span
            >
            <span
              v-else-if="engageThresholdFlash === 'error'"
              class="sm-hours__flash sm-hours__flash--err"
              >Out of range</span
            >
            <div class="engage__sp" />
            <label class="engage__field">
              <span>Code length</span>
              <input
                v-model.number="engageDigits"
                type="number"
                min="3"
                max="6"
              />
            </label>
            <label class="engage__field">
              <span>Lifetime (sec)</span>
              <input
                v-model.number="engageLifetime"
                type="number"
                min="15"
                max="600"
              />
            </label>
          </div>

          <div v-if="activeEngagementCode" class="engage__active">
            <div class="engage__code">{{ activeEngagementCode.code }}</div>
            <div class="engage__meta">
              <div class="engage__countdown">
                Expires in <b>{{ activeCountdownSec }}s</b>
              </div>
              <div class="engage__resp">
                <Wifi :size="14" />
                {{ activeResponseCount }}
                response{{ activeResponseCount === 1 ? '' : 's' }} received
              </div>
              <button
                class="btn btn-sm"
                :disabled="engageGenerating"
                @click="generateNewEngagementCode"
              >
                Replace with new code
              </button>
            </div>
          </div>
          <div v-else class="engage__active engage__active--idle">
            <p class="engage__idle">No active code. Click Generate when you want to verify presence.</p>
            <button
              class="btn btn-primary"
              :disabled="engageGenerating"
              @click="generateNewEngagementCode"
            >
              {{ engageGenerating ? 'Generating…' : 'Generate engagement code' }}
            </button>
          </div>
          <div v-if="engageError" class="engage__error">{{ engageError }}</div>

          <div class="engage__qrtile">
            <div class="engage__qrtile__qr">
              <img v-if="qrEngage" :src="qrEngage" alt="Engage QR" />
            </div>
            <div class="engage__qrtile__body">
              <div class="engage__qrtile__label">Virtual attendee link</div>
              <code class="engage__qrtile__url">{{ engagePublicUrl }}</code>
              <div class="engage__qrtile__row">
                <button class="btn btn-sm" @click="copyEngageLink">
                  <component
                    :is="copied === 'engage' ? Check : Copy"
                    :size="13"
                  />
                  {{ copied === 'engage' ? 'Copied' : 'Copy link' }}
                </button>
                <button class="btn btn-sm" @click="openDisplay('engage')">
                  <Monitor :size="13" /> Display
                </button>
                <a
                  class="btn btn-sm"
                  :href="`/engage?session=${s.sessionId}`"
                  target="_blank"
                >
                  Open
                </a>
              </div>
            </div>
          </div>

          <div v-if="engagementByAttendee.length" class="engage__table">
            <div class="engage__table__head">
              Virtual attendee participation
              <span class="muted">
                · {{ sessions.engagementCodes.length }} code{{
                  sessions.engagementCodes.length === 1 ? '' : 's'
                }}
                issued
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Responded</th>
                  <th>%</th>
                  <th>Meets threshold?</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in engagementByAttendee"
                  :key="row.email"
                  :class="
                    row.pct >= engageThresholdDraft ? 'engage__ok' : 'engage__no'
                  "
                >
                  <td>
                    <div>{{ row.name || row.email }}</div>
                    <div v-if="row.name" class="muted">{{ row.email }}</div>
                  </td>
                  <td>{{ row.responded }} / {{ row.total }}</td>
                  <td>{{ row.pct }}%</td>
                  <td>
                    <span
                      class="qsubs__badge"
                      :class="
                        row.pct >= engageThresholdDraft
                          ? 'qsubs__badge--ok'
                          : 'qsubs__badge--no'
                      "
                    >
                      {{ row.pct >= engageThresholdDraft ? 'Yes' : 'No' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Exports -->
      <div class="block">
        <div class="block-label">Exports &amp; lifecycle</div>
        <div class="exports">
          <button v-if="isCardClass" class="ex" @click="openRoster">
            <FileText :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">AHA Roster PDF</div>
              <div class="ex-d">Signed course roster</div>
            </div>
          </button>
          <button class="ex" @click="openEvals">
            <CheckSquare :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">Generate Evaluations</div>
              <div class="ex-d">Per-student eval PDFs (zip)</div>
            </div>
          </button>
          <button
            v-if="!isCardClass"
            class="ex"
            :disabled="awarding"
            @click="awardCeCredits"
          >
            <Award :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">
                {{ awarding ? 'Awarding CE Credits…' : 'Award CE Credits' }}
              </div>
              <div class="ex-d">
                Generate &amp; archive certificates for qualifying attendees
              </div>
            </div>
          </button>
          <button
            v-if="!isCardClass"
            class="ex"
            :disabled="regening"
            @click="regenerateAndDownloadCerts"
          >
            <FileText :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">
                {{
                  regening
                    ? `Rebuilding… ${regenProgress}%`
                    : 'Regenerate CE Certs (ZIP)'
                }}
              </div>
              <div class="ex-d">
                Rebuild every issued cert &amp; download as a zip for email
              </div>
            </div>
          </button>
          <button class="ex danger" @click="closeCourse">
            <Lock :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">Close Course</div>
              <div class="ex-d">Archive &amp; remove from active</div>
            </div>
          </button>
          <button class="ex danger" @click="cancelCourse">
            <Ban :size="18" :stroke-width="1.75" />
            <div>
              <div class="ex-t">Cancel Course</div>
              <div class="ex-d">
                {{
                  isCardClass
                    ? 'Cancel Wix event &amp; notify bookers'
                    : 'Class not happening — close check-in &amp; eval'
                }}
              </div>
            </div>
          </button>
        </div>

        <div v-if="awardSummary" class="ce-summary">
          <p class="ce-summary__head">
            <Award :size="14" :stroke-width="2" />
            CE certificates issued
          </p>
          <div class="ce-summary__grid">
            <div class="ce-stat ce-stat--ok">
              <span class="ce-stat__n">{{ awardSummary.issued }}</span>
              <span class="ce-stat__l">Issued</span>
            </div>
            <div class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.alreadyIssued }}</span>
              <span class="ce-stat__l">Already had cert</span>
            </div>
            <div class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.noEval }}</span>
              <span class="ce-stat__l">No eval submitted</span>
            </div>
            <div class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.notCheckedIn }}</span>
              <span class="ce-stat__l">Not checked in</span>
            </div>
            <div v-if="awardSummary.noQuiz" class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.noQuiz }}</span>
              <span class="ce-stat__l">Didn't take quiz</span>
            </div>
            <div v-if="awardSummary.failedQuiz" class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.failedQuiz }}</span>
              <span class="ce-stat__l">Didn't pass quiz</span>
            </div>
            <div v-if="awardSummary.notEngaged" class="ce-stat">
              <span class="ce-stat__n">{{ awardSummary.notEngaged }}</span>
              <span class="ce-stat__l">Below engagement threshold</span>
            </div>
            <div v-if="awardSummary.failures" class="ce-stat ce-stat--err">
              <span class="ce-stat__n">{{ awardSummary.failures }}</span>
              <span class="ce-stat__l">Failed (see console)</span>
            </div>
          </div>
        </div>

        <div v-if="regenSummary" class="ce-summary">
          <p class="ce-summary__head">
            <FileText :size="14" :stroke-width="2" />
            CE certificates regenerated
          </p>
          <div class="ce-summary__grid">
            <div class="ce-stat ce-stat--ok">
              <span class="ce-stat__n">{{ regenSummary.rebuilt }}</span>
              <span class="ce-stat__l">Rebuilt &amp; in ZIP</span>
            </div>
            <div v-if="regenSummary.failures" class="ce-stat ce-stat--err">
              <span class="ce-stat__n">{{ regenSummary.failures }}</span>
              <span class="ce-stat__l">Failed (see console)</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Edit session details modal ────────────────────────────── -->
    <div v-if="editOpen" class="modal" @click.self="editOpen = false">
      <div class="modalbox modalbox--wide">
        <div class="modalbox__head">
          <h3>Edit session details</h3>
          <button class="iconbtn" aria-label="Close" @click="editOpen = false">
            <X :size="17" />
          </button>
        </div>
        <p class="muted modalbox__hint">
          Change the course (Renewal ↔ Full) or add/edit assisting instructors.
          Roster will reflect the new course. Session type + date are not
          editable here — cancel and recreate if those need to change.
        </p>

        <label class="fld">
          <span>Card course</span>
          <select v-model="editForm.cardCourse">
            <option value="">— select —</option>
            <option v-for="name in editCourseOptions" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
          <small v-if="!editCourseOptions.length" class="fld__hint">
            Loading course catalog…
          </small>
        </label>

        <!-- Primary instructor -->
        <fieldset class="edit__group">
          <legend>Primary instructor</legend>
          <label class="fld">
            <span>From roster</span>
            <select
              :value="editForm.primary.selection"
              @change="
                applyPickerToSlot(
                  editForm.primary,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">— pick from roster —</option>
              <option
                v-for="i in sessions.instructorRoster"
                :key="i.id"
                :value="i.id"
              >
                {{ i.fullName }}
                <template v-if="i.instructorNumber">
                  · #{{ i.instructorNumber }}
                </template>
              </option>
              <option value="other">Other (manual entry)</option>
            </select>
          </label>
          <div class="fld-row">
            <label class="fld">
              <span>Name</span>
              <input v-model="editForm.primary.name" type="text" />
            </label>
            <label class="fld">
              <span>Instructor #</span>
              <input v-model="editForm.primary.number" type="text" />
            </label>
          </div>
          <div class="fld-row">
            <label class="fld">
              <span>Email</span>
              <input v-model="editForm.primary.email" type="email" />
            </label>
            <label class="fld">
              <span>Card exp.</span>
              <input v-model="editForm.primary.cardExp" type="date" />
            </label>
          </div>
        </fieldset>

        <!-- Assisting instructors -->
        <div v-for="(slot, idx) in editForm.assists" :key="idx" class="edit__group">
          <div class="edit__grouphead">
            <legend>Assisting instructor {{ idx + 1 }}</legend>
            <button
              type="button"
              class="iconbtn iconbtn--danger"
              @click="removeAssist(idx)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
          <label class="fld">
            <span>From roster</span>
            <select
              :value="slot.selection"
              @change="
                applyPickerToSlot(
                  slot,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">— pick from roster —</option>
              <option
                v-for="i in sessions.instructorRoster"
                :key="i.id"
                :value="i.id"
              >
                {{ i.fullName }}
                <template v-if="i.instructorNumber">
                  · #{{ i.instructorNumber }}
                </template>
              </option>
              <option value="other">Other (manual entry)</option>
            </select>
          </label>
          <div class="fld-row">
            <label class="fld">
              <span>Name</span>
              <input v-model="slot.name" type="text" />
            </label>
            <label class="fld">
              <span>Instructor #</span>
              <input v-model="slot.number" type="text" />
            </label>
          </div>
          <div class="fld-row">
            <label class="fld">
              <span>Email</span>
              <input v-model="slot.email" type="email" />
            </label>
            <label class="fld">
              <span>Card exp.</span>
              <input v-model="slot.cardExp" type="date" />
            </label>
          </div>
        </div>

        <button
          v-if="editForm.assists.length < 3"
          type="button"
          class="btn btn-secondary edit__add"
          @click="addAssist"
        >
          <Plus :size="14" /> Add assisting instructor
        </button>

        <div v-if="editErr" class="edit__err">{{ editErr }}</div>
        <div v-if="editSaved" class="edit__ok">Saved.</div>

        <div class="modalbox__actions">
          <button class="btn btn-secondary" @click="editOpen = false">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="editBusy"
            @click="saveEditDetails"
          >
            {{ editBusy ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>
    </div>
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
  margin: 4px 0 0;
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
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 44px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
.state.err {
  color: var(--color-danger-500);
}
.state svg {
  color: var(--color-muted-soft);
}

.summary {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
  margin-bottom: 14px;
}
.sm-title {
  font-size: 24px;
  margin: 3px 0 9px;
}
.sm-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: var(--color-muted);
}
.sm-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sm-hours {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sm-hours__lbl {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.sm-hours__inp {
  width: 80px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
}
.sm-hours__btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
}
.sm-hours__btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.sm-hours__btn:not(:disabled):hover {
  background: var(--color-surface-sunk);
}
.sm-hours__flash {
  font-size: 12.5px;
  font-weight: 600;
}
.sm-hours__flash--ok {
  color: var(--color-success-500);
}
.sm-hours__flash--err {
  color: var(--color-danger-500);
}
.sm-hours__hint {
  flex-basis: 100%;
  font-size: 11.5px;
  color: var(--color-muted);
}
.sm-pills {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  flex-shrink: 0;
}
.pill {
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 11px;
  border-radius: 999px;
  white-space: nowrap;
}
.pill.on {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.pill.off {
  background: var(--color-surface-sunk);
  color: var(--color-muted);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  letter-spacing: 0.06em;
  color: var(--color-muted);
}
.stat.link {
  text-decoration: none;
  justify-content: center;
  transition: border-color 140ms, box-shadow 140ms;
}
.stat.link svg {
  color: var(--color-brand-600);
}
.stat.link:hover {
  border-color: var(--color-brand-300);
  box-shadow: var(--shadow-sm);
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.block {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 16px;
}
.cols .block {
  margin-bottom: 0;
}
.block-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--color-muted);
  margin-bottom: 16px;
}
/* Same look but reusable as a button when the section collapses */
.block-label--toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  padding: 4px 0;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--color-muted);
  margin-bottom: 14px;
  text-align: left;
}
.block-label--toggle:hover {
  color: var(--color-ink);
}
.block-label--toggle:hover svg {
  color: var(--color-brand-600);
}
.block-label__sp {
  flex: 1;
}
.block-label__pill {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: oklch(0.94 0.06 152);
  color: oklch(0.36 0.09 152);
}
.block-label__pill--muted {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.block-label__chev {
  font-size: 14px;
  transition: transform 160ms var(--ease-out);
  color: var(--color-muted-soft);
}
.block-label--collapsed .block-label__chev {
  transform: rotate(-90deg);
}

/* ── Pending approvals strip ─────────────────────────────────────── */
.pending {
  border-color: var(--color-warning-500);
  background: var(--color-warning-50);
}
.pending-h {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--color-warning-500);
}
.pcount {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--color-warning-500);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}
.phint {
  font-weight: 400;
  font-size: 11.5px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-muted);
  margin-left: auto;
}
.prow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  margin-top: 8px;
}
.prow__body {
  min-width: 0;
}
.prow__name {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--color-ink);
}
.prow__email {
  font-size: 12.5px;
  color: var(--color-muted);
}
.prow__meta {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.chip.warn {
  background: var(--color-warning-50);
  color: var(--color-warning-500);
  border-color: transparent;
}
.prow__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.btn.sm {
  padding: 7px 12px;
  font-size: 12.5px;
}
.btn-text {
  background: transparent;
  border: none;
  color: var(--color-muted);
  font-size: 12.5px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
}
.btn-text:hover {
  color: var(--color-danger-500);
  background: var(--color-danger-50);
}
@media (max-width: 560px) {
  .prow {
    flex-direction: column;
    align-items: flex-start;
  }
  .prow__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 15px;
  background: var(--color-surface-soft);
  border-radius: 10px;
  margin-bottom: 10px;
}
.toggle-row:last-child {
  margin-bottom: 0;
}
.t-label {
  font-size: 14px;
  font-weight: 600;
}
.t-desc {
  font-size: 12px;
  color: var(--color-muted);
}
.switch {
  position: relative;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  inset: 0;
  background: var(--color-line);
  border-radius: 26px;
  cursor: pointer;
  transition: 0.25s;
}
.slider::before {
  content: '';
  position: absolute;
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  border-radius: 50%;
  transition: 0.25s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.switch input:checked + .slider {
  background: var(--color-success-500);
}
.switch input:checked + .slider::before {
  transform: translateX(20px);
}
.qr-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.qr-tile {
  text-align: center;
  padding: 14px;
  background: var(--color-surface-soft);
  border-radius: 11px;
}
.qr-tile img {
  width: 100%;
  max-width: 150px;
  aspect-ratio: 1;
  margin: 0 auto 8px;
  display: block;
}
.qr-name {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
  margin-bottom: 9px;
}
.qr-actions {
  display: flex;
  gap: 6px;
  justify-content: center;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.mini:hover {
  background: var(--color-surface-soft);
}
.roster-h {
  display: flex;
  align-items: center;
  gap: 12px;
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-success-500);
  text-transform: none;
  letter-spacing: 0;
  font-size: 11px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-success-500);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
.srch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
}
.srch svg {
  color: var(--color-muted);
}
.srch input {
  border: none;
  outline: none;
  background: transparent;
  padding: 8px 0;
  font-size: 13px;
  font-family: inherit;
  color: var(--color-ink);
  width: 130px;
  text-transform: none;
  letter-spacing: 0;
}
.r-empty {
  padding: 18px 0;
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
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-line-soft);
}
.tbl tbody tr:last-child td {
  border-bottom: none;
}
.muted {
  color: var(--color-muted);
}
.psa {
  width: 62px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: center;
  font-size: 13px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: inherit;
}
.psa.saving {
  border-color: var(--color-warning-500);
  background: var(--color-warning-50);
}
.psa.saved {
  border-color: var(--color-success-500);
  background: var(--color-success-50);
}
.ctr {
  text-align: center;
}
.yes {
  color: var(--color-success-500);
  font-weight: 700;
}
.no {
  color: var(--color-danger-500);
  font-weight: 700;
}
.evalbtn {
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-family: inherit;
  transition: background 120ms;
}
.evalbtn.yes {
  color: var(--color-success-500);
}
.evalbtn.no {
  color: var(--color-danger-500);
}
.evalbtn:hover:not(:disabled) {
  background: var(--color-surface-sunk);
}
.evalbtn:disabled {
  opacity: 0.4;
  cursor: progress;
}
.quizpill {
  display: inline-block;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: filter 120ms, border-color 120ms;
}
.quizpill:hover:not(:disabled) {
  filter: brightness(0.96);
  border-color: var(--color-line);
}
.quizpill:disabled {
  opacity: 0.5;
  cursor: progress;
}
.quizpill--passed {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.quizpill--failed {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.quizpill--notTaken {
  background: var(--color-surface-sunk);
  color: var(--color-muted);
}
.cebadge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 999px;
  border: none;
  background: var(--color-success-50);
  color: var(--color-success-500);
  font-family: inherit;
  cursor: default;
}
.cebadge svg {
  color: var(--color-success-500);
}
.award-toast {
  margin-top: 12px;
  padding: 10px 13px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid transparent;
}
.award-toast--ok {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.award-toast--info {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}
.award-toast--err {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.upload-btn:hover {
  border-color: var(--color-brand-300);
  color: var(--color-brand-700);
}
.upload-btn.busy {
  opacity: 0.7;
  cursor: wait;
}
.upload-btn svg {
  color: var(--color-muted);
}
.upload-btn:hover svg {
  color: var(--color-brand-600);
}
.ecard {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
  font-family: inherit;
  transition: all 120ms var(--ease-out);
}
.ecard:hover {
  border-color: var(--color-muted-soft);
}
.ecard svg {
  color: var(--color-muted);
}
.ecard--on {
  background: var(--color-success-50);
  color: var(--color-success-500);
  border-color: transparent;
}
.ecard--on svg {
  color: var(--color-success-500);
}
.exam-msg {
  margin-top: 12px;
  padding: 10px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.exports {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

/* ── Quiz builder ──────────────────────────────────────────────── */
.quiz-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}
.quiz-head__copy {
  flex: 1;
  min-width: 0;
}
.quiz-head__hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-muted);
  max-width: 60ch;
  line-height: 1.5;
}
.btn-danger {
  background: oklch(0.94 0.08 28);
  color: oklch(0.4 0.13 28);
  border: 1px solid oklch(0.78 0.13 28);
}
.btn-danger:hover {
  background: oklch(0.9 0.1 28);
}

.quiz-qrtile {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 12px;
  margin-bottom: 16px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}
.quiz-qrtile__qr {
  width: 88px;
  height: 88px;
  background: #fff;
  border-radius: 8px;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.quiz-qrtile__qr img {
  max-width: 100%;
  max-height: 100%;
}
.quiz-qrtile__body {
  flex: 1;
  min-width: 0;
}
.quiz-qrtile__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
}
.quiz-qrtile__url {
  display: block;
  font-size: 12.5px;
  color: var(--color-ink-soft);
  word-break: break-all;
  margin: 4px 0 8px;
  background: transparent;
}
.quiz-qrtile__row {
  display: flex;
  gap: 8px;
}

.quiz-tabs {
  display: flex;
  gap: 4px;
  background: var(--color-surface-soft);
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 12px;
  width: fit-content;
}
.quiz-tab {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 7px;
  cursor: pointer;
  color: var(--color-muted);
  transition: background 120ms, color 120ms;
}
.quiz-tab.active {
  background: var(--color-surface);
  color: var(--color-ink);
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
}
.quiz-tab__cnt {
  margin-left: 6px;
  font-size: 11px;
  color: var(--color-muted);
}
.quiz-tab__subs {
  font-size: 11px;
  color: var(--color-success-500);
  font-weight: 500;
}

.quiz-pane {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 14px;
}
.quiz-pane__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.quiz-pane__sp {
  flex: 1;
}
.quiz-passing {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.quiz-passing input {
  width: 64px;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  font-size: 13.5px;
  font-family: inherit;
}
.quiz-passing__hint {
  font-size: 11px;
  color: var(--color-muted-soft);
}
.quiz-rationale {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.quiz-rationale > span {
  font-size: 11.5px;
  color: var(--color-muted);
  font-weight: 500;
}
.quiz-rationale > span em {
  font-style: normal;
  color: var(--color-muted-soft);
  font-weight: 400;
}
.quiz-rationale textarea {
  width: 100%;
  font: inherit;
  font-size: 13px;
  padding: 8px 11px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-ink);
}
.quiz-rationale textarea:focus {
  outline: none;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px var(--color-brand-100);
}
.btn-sm {
  padding: 6px 11px;
  font-size: 12.5px;
}
.btn-sm.danger {
  color: oklch(0.4 0.13 28);
  border: 1px solid oklch(0.85 0.08 28);
}
.btn-sm.danger:hover {
  background: oklch(0.94 0.06 28);
}

.quiz-qs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quiz-q {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quiz-q__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quiz-q__n {
  font-weight: 600;
  font-size: 12.5px;
  color: var(--color-muted);
}
.quiz-q__mv {
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 12px;
  padding: 2px 7px;
  cursor: pointer;
  color: var(--color-muted);
}
.quiz-q__mv:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.quiz-q__rm {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 13px;
  padding: 2px 9px;
  cursor: pointer;
  color: oklch(0.55 0.13 28);
}
.quiz-q__rm:hover {
  background: oklch(0.94 0.06 28);
}
.quiz-q textarea {
  width: 100%;
  font: inherit;
  font-size: 14px;
  padding: 9px 12px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  resize: vertical;
  background: var(--color-surface);
}
.quiz-opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.quiz-opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quiz-opt input[type='radio'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-success-500);
}
.quiz-opt input[type='text'] {
  flex: 1;
  font: inherit;
  font-size: 13.5px;
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
}
.quiz-opt--correct input[type='text'] {
  border-color: var(--color-success-500);
  background: var(--color-success-50);
}
.quiz-opt__rm {
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 12.5px;
  padding: 4px 9px;
  cursor: pointer;
  color: var(--color-muted);
}
.quiz-opt__rm:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.quiz-opt__add {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--color-line);
  border-radius: 7px;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--color-muted);
  cursor: pointer;
  margin-top: 2px;
}
.quiz-opt__add:hover {
  border-color: var(--color-brand-300);
  color: var(--color-brand-700);
}
.quiz-q__add {
  background: transparent;
  border: 1.5px dashed var(--color-line);
  border-radius: 10px;
  padding: 12px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
}
.quiz-q__add:hover {
  border-color: var(--color-brand-400);
  color: var(--color-brand-700);
  background: var(--color-brand-50);
}
.quiz-pane__foot {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
}
.quiz-save-flash {
  color: var(--color-success-500);
  font-size: 12.5px;
  font-weight: 500;
}

/* Per-student submissions table inside the quiz pane */
.qsubs {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--color-line);
}
.qsubs__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.qsubs__title {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.qsubs__count {
  font-size: 12px;
  color: var(--color-success-500);
  font-weight: 600;
}
.qsubs__empty {
  padding: 14px;
  font-size: 12.5px;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  border-radius: 8px;
  text-align: center;
}
.qsubs__tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.qsubs__tbl th {
  text-align: left;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-line);
}
.qsubs__tbl th.num {
  text-align: right;
}
.qsubs__tbl td {
  padding: 9px 6px;
  border-bottom: 1px solid var(--color-line-soft);
  vertical-align: middle;
}
.qsubs__tbl td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.qsubs__tbl td.muted {
  color: var(--color-muted);
  font-size: 12px;
}
.qsubs__name {
  font-weight: 500;
  color: var(--color-ink);
}
.qsubs__email {
  font-size: 11.5px;
  color: var(--color-muted);
}
.qsubs__badge {
  display: inline-block;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  letter-spacing: 0.02em;
}
.qsubs__badge--ok {
  background: oklch(0.94 0.06 152);
  color: oklch(0.36 0.09 152);
}
.qsubs__badge--no {
  background: oklch(0.94 0.06 28);
  color: oklch(0.4 0.13 28);
}

/* ── Engagement block (virtual attendees) ───────────────────────── */
.engage {
  padding-top: 8px;
}
.engage__hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-muted);
}
.engage__hint code {
  background: var(--color-surface-sunk);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.engage__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--color-surface-sunk);
  border-radius: 10px;
}
.engage__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-muted);
  font-weight: 600;
}
.engage__field input {
  width: 84px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
}
.engage__sp {
  flex: 1;
}
.engage__active {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 18px 22px;
  border-radius: 12px;
  border: 1px solid var(--color-brand-200, var(--color-line));
  background: var(--color-brand-50);
  margin-bottom: 14px;
}
.engage__active--idle {
  flex-wrap: wrap;
  justify-content: space-between;
  background: var(--color-surface);
  border-style: dashed;
}
.engage__code {
  font-family: var(--font-display, inherit);
  font-size: 56px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--color-brand-700);
  flex-shrink: 0;
  line-height: 1;
}
.engage__meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.engage__countdown {
  font-size: 14px;
  color: var(--color-ink);
}
.engage__resp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.engage__idle {
  margin: 0;
  font-size: 13px;
  color: var(--color-muted);
}
.engage__error {
  margin-bottom: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  font-size: 13px;
}
.engage__qrtile {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  margin-bottom: 14px;
}
.engage__qrtile__qr img {
  display: block;
  width: 96px;
  height: 96px;
}
.engage__qrtile__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.engage__qrtile__label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.engage__qrtile__url {
  display: block;
  font-size: 12px;
  color: var(--color-ink);
  word-break: break-all;
  background: var(--color-surface-sunk);
  padding: 4px 8px;
  border-radius: 6px;
}
.engage__qrtile__row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.engage__table {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  overflow: hidden;
}
.engage__table__head {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
  background: var(--color-surface-sunk);
  border-bottom: 1px solid var(--color-line);
}
.engage__table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.engage__table th,
.engage__table td {
  padding: 9px 14px;
  text-align: left;
}
.engage__table thead {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.engage__table tbody tr + tr {
  border-top: 1px solid var(--color-line);
}
.engage__table .muted {
  color: var(--color-muted);
  font-size: 11.5px;
}
.ex {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  text-align: left;
  border: 1px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color 140ms, box-shadow 140ms;
}
.ex:hover {
  border-color: var(--color-brand-300);
  box-shadow: var(--shadow-sm);
}
.ex svg {
  color: var(--color-brand-600);
  flex-shrink: 0;
}
.ex-t {
  font-weight: 600;
  font-size: 14px;
}
.ex-d {
  font-size: 12px;
  color: var(--color-muted);
}
.ex.danger:hover {
  border-color: var(--color-danger-500);
}
.ex.danger svg {
  color: var(--color-danger-500);
}
.ex:disabled {
  opacity: 0.55;
  cursor: progress;
}

/* CE issuance summary */
.ce-summary {
  margin-top: 18px;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 10px;
}
.ce-summary__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.ce-summary__head svg {
  color: var(--color-brand-600);
}
.ce-summary__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.ce-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 8px;
  background: oklch(0.97 0.012 250);
}
.ce-stat__n {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-ink, var(--color-text, #1b2438));
  letter-spacing: -0.01em;
}
.ce-stat__l {
  font-size: 11px;
  color: var(--color-muted);
  letter-spacing: 0.02em;
}
.ce-stat--ok {
  background: oklch(0.94 0.06 152);
}
.ce-stat--ok .ce-stat__n {
  color: oklch(0.36 0.09 152);
}
.ce-stat--err {
  background: oklch(0.94 0.06 28);
}
.ce-stat--err .ce-stat__n {
  color: oklch(0.4 0.13 28);
}

@media (max-width: 860px) {
  .cols,
  .exports {
    grid-template-columns: 1fr;
  }
  .stats {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 560px) {
  .summary {
    flex-direction: column;
  }
  .sm-pills {
    flex-direction: row;
    align-items: flex-start;
  }
  .qr-row {
    grid-template-columns: 1fr;
  }
  .roster-h {
    flex-wrap: wrap;
  }
  .srch {
    margin-left: 0;
    width: 100%;
  }
  .srch input {
    width: 100%;
  }
  .tbl thead {
    display: none;
  }
  .tbl tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-line);
  }
  .tbl td {
    padding: 1px 0;
    border: none;
  }
}

/* ── Edit details button + assisting-instructor line on summary ─── */
.sm-editbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 120ms, color 120ms;
}
.sm-editbtn:hover {
  border-color: var(--color-brand-600);
  color: var(--color-brand-700);
}
.sm-assist {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-muted);
}

/* ── Edit modal ─────────────────────────────────────────────────── */
.modal {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.45);
  display: grid;
  place-items: center;
  z-index: 80;
  padding: 20px;
}
.modalbox {
  background: var(--color-surface);
  border-radius: 14px;
  padding: 22px;
  width: 100%;
  max-width: 560px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  box-shadow: 0 24px 56px -20px oklch(0 0 0 / 0.4);
}
.modalbox--wide { max-width: 680px; }
.modalbox__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.modalbox__head h3 { margin: 0; font-size: 17px; }
.modalbox__hint { margin: 0 0 14px; font-size: 12.5px; line-height: 1.5; }
.modalbox__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--color-line);
}
.iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
}
.iconbtn:hover { background: var(--color-brand-50); color: var(--color-brand-700); }
.iconbtn--danger:hover {
  background: oklch(0.96 0.045 28);
  color: oklch(0.5 0.17 28);
  border-color: oklch(0.85 0.05 28);
}

.edit__group {
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 14px 14px 4px;
  margin-bottom: 12px;
}
.edit__group legend {
  padding: 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
  font-weight: 600;
}
.edit__grouphead {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.edit__add { margin-bottom: 4px; }

.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--color-muted);
  font-weight: 500;
}
.fld input, .fld select {
  padding: 8px 11px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
  font-size: 13.5px;
  color: var(--color-ink);
  font-family: inherit;
}
.fld-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 520px) { .fld-row { grid-template-columns: 1fr; } }

.fld__hint {
  font-size: 11.5px;
  color: var(--color-muted);
  font-weight: 500;
  margin-top: -2px;
}
.edit__err {
  padding: 10px 14px;
  margin: 8px 0 0;
  border-radius: 8px;
  background: oklch(0.96 0.045 28);
  color: oklch(0.45 0.14 28);
  font-size: 13px;
  font-weight: 500;
}
.edit__ok {
  padding: 10px 14px;
  margin: 8px 0 0;
  border-radius: 8px;
  background: oklch(0.94 0.06 152);
  color: oklch(0.36 0.09 152);
  font-size: 13px;
  font-weight: 500;
}
</style>
