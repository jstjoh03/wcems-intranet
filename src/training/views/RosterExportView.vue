<script setup lang="ts">
import { onMounted, reactive, ref, computed, useTemplateRef } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { generateRosterPdf, type RosterFields } from '@/training/lib/rosterPdf'
import { archiveFile } from '@/training/lib/archive'
import { FileText, PenLine, Users, Eraser, Plus, X } from 'lucide-vue-next'

const route = useRoute()
const sessions = useSessionsStore()
const canvasRef = useTemplateRef<HTMLCanvasElement>('sig')

const ready = ref(false)
const status = ref<{ t: string; k: 'error' | 'success' } | null>(null)
const busy = ref(false)

// Number of assisting-instructor blocks currently visible (0–2).
// We start with however many had data at session-creation time, and
// the instructor can add/remove on the fly without crowding the page.
const assistCount = ref(0)
function addAssist() {
  if (assistCount.value < 2) assistCount.value++
}
function removeAssist(n: 1 | 2) {
  if (n === 1) {
    // Shift assist2's fields down into assist1, then drop assist2.
    f.assist1Name = f.assist2Name
    f.assist1Number = f.assist2Number
    f.assist1Exp = f.assist2Exp
  }
  f.assist2Name = ''
  f.assist2Number = ''
  f.assist2Exp = ''
  if (assistCount.value > 0) assistCount.value--
}

const f = reactive<RosterFields>({
  courseName: '',
  courseDate: '',
  startTime: '',
  endTime: '',
  instructorName: '',
  instructorNumber: '',
  location: '',
  hours: '',
  manikinRatio: '6:1',
  instructorCardExp: '',
  assist1Name: '',
  assist1Number: '',
  assist1Exp: '',
  assist2Name: '',
  assist2Number: '',
  assist2Exp: '',
})

function fmtDate(d: string) {
  if (!d) return ''
  const [y, m, day] = d.split('T')[0].split('-')
  return `${m}/${day}/${y}`
}
/** Format an "HH:MM" 24-hour string as zero-padded 24h "HH:MM" — same
 *  format the AHA roster PDF's Course Start/End fields expect. 12-hour
 *  with AM/PM overflows that field and truncates ("10:0…"). */
function fmtTime(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':')
  return `${String(parseInt(h, 10) || 0).padStart(2, '0')}:${m}`
}

/** Actual contact hours = end − start, as a 1-decimal number string
 *  (e.g. "4.0"). The AHA roster wants real clock hours, not the CE
 *  credit value. Times come from the session as 24h "HH:MM". */
function calcHours(start: string, end: string) {
  if (!start || !end) return ''
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = eh * 60 + em - (sh * 60 + sm)
  if (Number.isNaN(diff) || diff <= 0) return ''
  return (diff / 60).toFixed(1)
}

const attendance = computed(() =>
  sessions.attendance.filter((a) => a.phase === 'checkedin'),
)

onMounted(async () => {
  const sessionId = (route.query.sessionId as string) || ''
  if (!sessionId) {
    status.value = { t: 'No session ID provided.', k: 'error' }
    return
  }
  await sessions.loadSessionDetail(sessionId)
  const s = sessions.currentSession
  if (!s) {
    status.value = { t: sessions.error || 'Session not found.', k: 'error' }
    return
  }
  f.courseName = s.cardCourseName || s.title
  f.courseDate = fmtDate(s.classDate)
  f.startTime = fmtTime(s.startTime)
  f.endTime = fmtTime(s.endTime)
  f.instructorName = s.primaryInstructorName
  f.instructorNumber = s.primaryInstructorNumber
  f.instructorCardExp = s.primaryInstructorCardExp
  f.location = s.location
  // Actual contact hours from start/end; fall back to the CE value only
  // if the session has no times recorded.
  f.hours = calcHours(s.startTime, s.endTime) || s.hoursAwarded
  f.assist1Name = s.secondaryInstructorName
  f.assist1Number = s.secondaryInstructorNumber
  f.assist1Exp = s.secondaryInstructorCardExp
  f.assist2Name = s.tertiaryInstructorName
  f.assist2Number = s.tertiaryInstructorNumber
  f.assist2Exp = s.tertiaryInstructorCardExp
  // Show however many assisting-instructor blocks had any data at
  // creation. Empty slots stay hidden until "Add" is pressed.
  const has = (name: string, num: string, exp: string) =>
    !!(name.trim() || num.trim() || exp.trim())
  if (has(f.assist2Name, f.assist2Number, f.assist2Exp)) assistCount.value = 2
  else if (has(f.assist1Name, f.assist1Number, f.assist1Exp))
    assistCount.value = 1
  else assistCount.value = 0
  ready.value = true
  setupSignature()
})

// ── Signature pad ──────────────────────────────────────────────────────
let drawing = false
let lastX = 0
let lastY = 0
function ctx() {
  return canvasRef.value?.getContext('2d') ?? null
}
function setupSignature() {
  const c = canvasRef.value
  const g = ctx()
  if (!c || !g) return
  g.strokeStyle = '#0b3a6a'
  g.lineWidth = 2
  g.lineCap = 'round'
  g.lineJoin = 'round'
}
function pos(e: MouseEvent | TouchEvent) {
  const c = canvasRef.value!
  const r = c.getBoundingClientRect()
  const p = 'touches' in e ? e.touches[0] : e
  return {
    x: (p.clientX - r.left) * (c.width / r.width),
    y: (p.clientY - r.top) * (c.height / r.height),
  }
}
function down(e: MouseEvent | TouchEvent) {
  e.preventDefault()
  drawing = true
  const pt = pos(e)
  lastX = pt.x
  lastY = pt.y
}
function move(e: MouseEvent | TouchEvent) {
  if (!drawing) return
  e.preventDefault()
  const g = ctx()
  if (!g) return
  const pt = pos(e)
  g.beginPath()
  g.moveTo(lastX, lastY)
  g.lineTo(pt.x, pt.y)
  g.stroke()
  lastX = pt.x
  lastY = pt.y
}
function up() {
  drawing = false
}
function clearSig() {
  const c = canvasRef.value
  const g = ctx()
  if (c && g) g.clearRect(0, 0, c.width, c.height)
}
function sigEmpty() {
  const c = canvasRef.value
  const g = ctx()
  if (!c || !g) return true
  const d = g.getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false
  return true
}

async function generate() {
  status.value = null
  if (sigEmpty()) {
    status.value = { t: 'Please sign the form before generating the PDF.', k: 'error' }
    return
  }
  busy.value = true
  try {
    const sig = canvasRef.value!.toDataURL('image/png')
    const { bytes, fileName } = await generateRosterPdf(
      f,
      attendance.value,
      sessions.currentSession!.sessionId,
      sig,
    )
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })

    // Open the freshly-generated blob in a new tab so it previews
    // INLINE in the browser's PDF viewer. We open the local blob URL
    // (not the Storage signed URL) because some browsers force a
    // download dialog on cross-origin PDF URLs depending on
    // content-disposition. The blob URL is same-origin and always
    // renders inline. The bucket copy is the 5-year retained record.
    const previewUrl = URL.createObjectURL(blob)
    const tab = window.open(previewUrl, '_blank')
    // Free the object URL after the tab has had time to load it. Chrome
    // needs the URL alive while the new tab navigates to it.
    setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000)

    try {
      await archiveFile({
        sessionId: sessions.currentSession!.sessionId,
        recordType: 'Roster',
        fileName,
        blob,
      })
      status.value = {
        t: tab
          ? `Roster opened in a new tab and archived to the 5-year store as ${fileName}.`
          : `Roster archived as ${fileName}. (Your browser blocked the preview tab — allow pop-ups for this site to see it next time.)`,
        k: 'success',
      }
    } catch (e) {
      status.value = {
        t:
          'Roster opened in a new tab, but archive upload failed: ' +
          (e instanceof Error ? e.message : 'unknown error'),
        k: 'error',
      }
    }
  } catch (e) {
    status.value = {
      t: 'Error generating PDF: ' + (e instanceof Error ? e.message : 'unknown'),
      k: 'error',
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppShell>
    <header class="hero reveal">
      <div class="eyebrow">AHA export</div>
      <h1 class="hero__title display">
        Course <em class="hero__accent">Roster</em>.
      </h1>
      <p class="hero__sub">
        Review the auto-filled course details, sign, and generate the
        official AHA roster PDF. It's archived to the 5-year record store
        automatically.
      </p>
    </header>

    <div v-if="!ready && !status" class="state">
      <FileText :size="22" :stroke-width="1.5" class="state__icon" />
      <div class="state__title">Loading session…</div>
    </div>
    <div v-else-if="!ready && status" class="state">
      <FileText :size="22" :stroke-width="1.5" class="state__icon" />
      <div class="state__title">Couldn't load session</div>
      <p class="state__sub">{{ status.t }}</p>
    </div>

    <template v-else>
      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">Course information</span>
          <span class="block__hint">Auto-filled — edit if needed</span>
        </div>
        <div class="grid">
          <label class="f f--wide"
            ><span>Course Name</span><input v-model="f.courseName"
          /></label>
          <label class="f"
            ><span>Course Date</span><input v-model="f.courseDate"
          /></label>
          <label class="f"
            ><span>Hours</span><input v-model="f.hours"
          /></label>
          <label class="f"
            ><span>Start Time</span><input v-model="f.startTime"
          /></label>
          <label class="f"
            ><span>End Time</span><input v-model="f.endTime"
          /></label>
          <label class="f"
            ><span>Location</span><input v-model="f.location"
          /></label>
          <label class="f"
            ><span>Student-Manikin Ratio</span
            ><input v-model="f.manikinRatio"
          /></label>
        </div>
      </section>

      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">Instructors</span>
        </div>
        <div class="inst">
          <span class="badge">Lead</span>
          <div class="grid">
            <label class="f"
              ><span>Name</span><input v-model="f.instructorName"
            /></label>
            <label class="f"
              ><span>Instructor #</span><input v-model="f.instructorNumber"
            /></label>
            <label class="f"
              ><span>Card Expiration</span
              ><input v-model="f.instructorCardExp" type="date"
            /></label>
          </div>
        </div>
        <div v-if="assistCount >= 1" class="inst inst--alt">
          <div class="inst__head">
            <span class="badge badge--alt">Assisting 1</span>
            <button type="button" class="inst-remove" @click="removeAssist(1)">
              <X :size="12" :stroke-width="2" /> Remove
            </button>
          </div>
          <div class="grid">
            <label class="f"
              ><span>Name</span><input v-model="f.assist1Name"
            /></label>
            <label class="f"
              ><span>Instructor #</span><input v-model="f.assist1Number"
            /></label>
            <label class="f"
              ><span>Card Expiration</span
              ><input v-model="f.assist1Exp" type="date"
            /></label>
          </div>
        </div>
        <div v-if="assistCount >= 2" class="inst inst--alt">
          <div class="inst__head">
            <span class="badge badge--alt">Assisting 2</span>
            <button type="button" class="inst-remove" @click="removeAssist(2)">
              <X :size="12" :stroke-width="2" /> Remove
            </button>
          </div>
          <div class="grid">
            <label class="f"
              ><span>Name</span><input v-model="f.assist2Name"
            /></label>
            <label class="f"
              ><span>Instructor #</span><input v-model="f.assist2Number"
            /></label>
            <label class="f"
              ><span>Card Expiration</span
              ><input v-model="f.assist2Exp" type="date"
            /></label>
          </div>
        </div>

        <button
          v-if="assistCount < 2"
          type="button"
          class="inst-add"
          @click="addAssist"
        >
          <Plus :size="14" :stroke-width="2" />
          Add{{ assistCount === 0 ? ' an' : ' another' }} assisting instructor
        </button>
      </section>

      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">
            <Users :size="13" :stroke-width="2" /> Attendees
          </span>
          <span class="count">{{ attendance.length }}</span>
        </div>
        <div v-if="!attendance.length" class="block__empty">
          No attendees checked in for this session.
        </div>
        <ol v-else class="alist">
          <li v-for="a in attendance" :key="a.id">
            <span class="alist__name">{{ a.studentName }}</span>
            <span class="alist__email">{{
              a.eCardEmail || a.studentEmail
            }}</span>
          </li>
        </ol>
      </section>

      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">
            <PenLine :size="13" :stroke-width="2" /> Lead instructor signature
          </span>
          <button class="link-btn" @click="clearSig">
            <Eraser :size="13" /> Clear
          </button>
        </div>
        <canvas
          ref="sig"
          class="sig"
          width="640"
          height="190"
          @mousedown="down"
          @mousemove="move"
          @mouseup="up"
          @mouseleave="up"
          @touchstart="down"
          @touchmove="move"
          @touchend="up"
        />
        <p class="sig__hint">Sign above with your mouse or finger.</p>
      </section>

      <div class="actionbar">
        <button class="btn btn-primary big" :disabled="busy" @click="generate">
          <FileText :size="16" :stroke-width="2" />
          {{ busy ? 'Generating…' : 'Generate AHA Roster PDF' }}
        </button>
      </div>
      <div v-if="status" class="msg" :class="status.k">{{ status.t }}</div>
    </template>
  </AppShell>
</template>

<style scoped>
.hero {
  margin-bottom: 26px;
}
.hero__title {
  font-size: 38px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin-top: 8px;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .hero__title {
    font-size: 48px;
  }
}
.hero__accent {
  color: var(--color-brand-600);
  font-style: italic;
}
.hero__sub {
  margin-top: 12px;
  font-size: 14px;
  color: var(--color-muted);
  max-width: 60ch;
}
.state {
  text-align: center;
  padding: 56px 20px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.state__icon {
  color: var(--color-muted-soft);
  margin: 0 auto 10px;
}
.state__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.state__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.block {
  padding: 20px;
  margin-bottom: 16px;
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line-soft);
}
.block__head .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.block__head .eyebrow svg {
  color: var(--color-accent-600);
}
.block__hint {
  font-size: 11.5px;
  color: var(--color-muted-soft);
}
.count {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-brand-600);
}
.block__empty {
  font-size: 13.5px;
  color: var(--color-muted);
  padding: 8px 0;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}
.f {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.f--wide {
  grid-column: 1 / -1;
}
.f > span {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.f input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
  font-family: inherit;
  transition: border-color 120ms var(--ease-out),
    box-shadow 120ms var(--ease-out);
}
.f input:focus {
  outline: none;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px var(--color-brand-100);
}
.inst {
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-surface-soft);
  margin-bottom: 12px;
}
.inst:last-child {
  margin-bottom: 0;
}
.inst--alt {
  background: var(--color-surface);
}
.badge {
  display: inline-flex;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-brand-600);
  color: #fff;
  margin-bottom: 12px;
}
.badge--alt {
  background: var(--color-surface-sunk);
  color: var(--color-ink-soft);
}
.inst__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.inst__head .badge {
  margin-bottom: 0;
}
.inst-remove {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--color-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.inst-remove:hover {
  color: var(--color-danger-500);
  background: var(--color-danger-50);
}
.inst-add {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border: 1px dashed var(--color-brand-300);
  border-radius: 9px;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.inst-add:hover {
  background: var(--color-brand-100);
}
.alist {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
}
.alist li {
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-line-soft);
}
.alist__name {
  font-size: 13.5px;
  color: var(--color-ink);
}
.alist__email {
  font-size: 12px;
  color: var(--color-muted);
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.link-btn:hover {
  color: var(--color-danger-500);
  background: var(--color-danger-50);
}
.sig {
  width: 100%;
  height: 190px;
  border: 1.5px dashed var(--color-muted-soft);
  border-radius: 11px;
  background: var(--color-surface);
  touch-action: none;
  display: block;
}
.sig__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-muted);
}
.actionbar {
  position: sticky;
  bottom: 16px;
  margin-top: 4px;
}
.btn.big {
  width: 100%;
  padding: 15px;
  font-size: 15px;
  box-shadow: var(--shadow-lg);
}
.msg {
  margin-top: 14px;
  padding: 13px 15px;
  border-radius: 10px;
  font-size: 13.5px;
}
.msg.error {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.msg.success {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .alist {
    grid-template-columns: 1fr;
  }
}
</style>
