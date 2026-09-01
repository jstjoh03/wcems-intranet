<script setup lang="ts">
import { onMounted, reactive, ref, computed, watch } from 'vue'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { useAuthStore } from '@/training/stores/auth'
import { qrDataUrl } from '@/training/lib/qr'
import {
  CreditCard,
  GraduationCap,
  CalendarClock,
  BookOpen,
  Users,
  Plus,
  X,
  Check,
  Copy,
  ExternalLink,
  ArrowRight,
} from 'lucide-vue-next'

const sessions = useSessionsStore()
const auth = useAuthStore()
const CARD_CLASS_SIGNUP_URL = 'https://www.wallercountyems.com/internaleducation'

const DSHS_AREAS = [
  'Preparatory',
  'Airway Management and Ventilation',
  'Patient Assessment',
  'Trauma',
  'Medical',
  'Special Considerations',
  'Pediatrics',
  'Clinically Related Operations',
]

interface Instructor {
  name: string
  number: string
  email: string
  cardExp: string
}
const blankInstructor = (): Instructor => ({
  name: '',
  number: '',
  email: '',
  cardExp: '',
})

const form = reactive({
  sessionType: 'CardClass' as 'CardClass' | 'Lecture',
  classDate: new Date().toISOString().slice(0, 10),
  startTime: '',
  endTime: '',
  location: '',
  cardCourse: '',
  maxSeatsCard: '',
  lectureTitle: '',
  dshsArea: '',
  maxSeatsLecture: '',
  verificationPoints: '',
  /** Lectures only — allow virtual (Teams) attendance alongside in-person. */
  virtualEnabled: false,
  teamsMeetingUrl: '',
  primary: blankInstructor(),
  assist1: blankInstructor(),
  assist2: blankInstructor(),
  /** Per-block picker state: '' (nothing picked yet), instructorId (auto-
   *  filled from roster), or 'other' (manual entry mode). Drives the
   *  select shown above each instructor block. */
  primarySelection: '' as string,
  assist1Selection: '' as string,
  assist2Selection: '' as string,
})
const assistCount = ref(0)

const msg = ref<{ text: string; kind: 'error' | 'success' } | null>(null)
const busy = ref(false)

interface Result {
  sessionId: string
  checkInToken: string
  evalToken: string
}
const result = ref<Result | null>(null)
const qr = reactive({ checkin: '', eval: '', reg: '' })
const copied = ref<string | null>(null)

onMounted(() => {
  void sessions.loadCourses()
  void sessions.loadInstructorRoster()
})

const isCard = computed(() => form.sessionType === 'CardClass')

// ── Instructor authorization gating ─────────────────────────────────────
/** Map a course name to the discipline code it belongs to. Course names
 *  in the catalog look like "ACLS Initial Certification" or "BLS Renewal";
 *  the discipline code is the first whitespace-delimited token, upper-
 *  cased. Falls back to the whole name. This lets Phase 2 disciplines
 *  (HANDTEVY, EVOC, PHTLS, …) light up automatically as soon as a
 *  matching training_disciplines row exists and the instructor is
 *  authorized — no per-course mapping table needed. */
function courseDisciplineCode(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] ?? ''
  return first.toUpperCase()
}

/** Only show card courses the signed-in instructor is authorized for. */
const availableCourses = computed(() =>
  sessions.courses.filter((c) =>
    auth.disciplines.includes(courseDisciplineCode(c.name)),
  ),
)
const canTeachLecture = computed(() => auth.canTeach('LECTURE'))
const canTeachAnyCard = computed(() => availableCourses.value.length > 0)

// If the instructor lost access to whatever they had picked, blank it.
watch(availableCourses, (list) => {
  if (form.cardCourse && !list.some((c) => c.name === form.cardCourse)) {
    form.cardCourse = ''
  }
})

// Default the session-type to whichever they're actually authorized for
// — avoids landing on a disabled segment.
watch(
  () => [canTeachAnyCard.value, canTeachLecture.value] as [boolean, boolean],
  ([card, lec]) => {
    if (form.sessionType === 'CardClass' && !card && lec) {
      form.sessionType = 'Lecture'
    } else if (form.sessionType === 'Lecture' && !lec && card) {
      form.sessionType = 'CardClass'
    }
  },
  { immediate: true },
)

// ── Instructor roster picker ────────────────────────────────────────────
/** The discipline code derived from the currently-selected card course.
 *  Drives card-exp auto-fill for instructors picked from the roster. */
const currentDisciplineCode = computed(() =>
  isCard.value && form.cardCourse ? courseDisciplineCode(form.cardCourse) : '',
)

type InstructorBlockKey = 'primary' | 'assist1' | 'assist2'

function applyInstructorSelection(blockKey: InstructorBlockKey, sel: string) {
  const block = form[blockKey]
  if (sel === '' || sel === 'other') {
    block.name = ''
    block.number = ''
    block.email = ''
    block.cardExp = ''
    return
  }
  const inst = sessions.instructorRoster.find((i) => i.id === sel)
  if (!inst) return
  block.name = inst.fullName
  block.number = inst.instructorNumber ?? ''
  block.email = inst.email ?? ''
  // Card-exp depends on the discipline the picked card course belongs to.
  // For lectures or until a card course is chosen, leave it blank.
  const code = currentDisciplineCode.value
  block.cardExp = code ? inst.cardExpByCode[code] ?? '' : ''
}

// React to the card course changing: refresh card-exp for any block that's
// currently bound to a roster instructor (selection !== 'other' and not '').
watch(
  () => form.cardCourse,
  () => {
    for (const key of ['primary', 'assist1', 'assist2'] as const) {
      const sel = form[`${key}Selection` as const]
      if (!sel || sel === 'other') continue
      const inst = sessions.instructorRoster.find((i) => i.id === sel)
      if (!inst) continue
      const code = currentDisciplineCode.value
      form[key].cardExp = code ? inst.cardExpByCode[code] ?? '' : ''
    }
  },
)

function calcHours(start: string, end: string) {
  if (!start || !end) return ''
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = eh * 60 + em - (sh * 60 + sm)
  if (Number.isNaN(diff) || diff <= 0) return ''
  return (diff / 60).toFixed(1)
}

function addAssist() {
  if (assistCount.value < 2) assistCount.value++
}
function removeAssist(n: number) {
  if (n === 1) {
    form.assist1 = { ...form.assist2 }
    form.assist1Selection = form.assist2Selection
    form.assist2 = blankInstructor()
    form.assist2Selection = ''
  } else {
    form.assist2 = blankInstructor()
    form.assist2Selection = ''
  }
  assistCount.value--
}

// ── Live preview helpers ───────────────────────────────────────────────
function prettyDate(d: string) {
  if (!d) return 'Date not set'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
function pretty12(t: string) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const previewTitle = computed(() => {
  if (isCard.value) return form.cardCourse || 'Untitled card class'
  return form.lectureTitle.trim() || 'Untitled lecture'
})
const previewTime = computed(() =>
  [pretty12(form.startTime), pretty12(form.endTime)].filter(Boolean).join(' – '),
)
const contactHours = computed(() => calcHours(form.startTime, form.endTime))
const previewHours = computed(() => contactHours.value)
const instructorNames = computed(() =>
  [form.primary, form.assist1, form.assist2]
    .slice(0, 1 + assistCount.value)
    .map((i) => i.name.trim())
    .filter(Boolean),
)

function validationError(): string | null {
  const need: [string, unknown][] = [
    ['Class Date', form.classDate],
    ['Start Time', form.startTime],
    ['End Time', form.endTime],
    ['Primary Instructor Name', form.primary.name],
    ['Primary Instructor Email', form.primary.email],
    ['Primary Instructor Number', form.primary.number],
  ]
  if (isCard.value) {
    need.push(['Card Course', form.cardCourse])
  } else {
    need.push(
      ['Lecture Title', form.lectureTitle],
      ['DSHS Content Area', form.dshsArea],
    )
    if (form.virtualEnabled) {
      need.push(['Teams Meeting URL', form.teamsMeetingUrl])
    }
  }
  const missing = need.filter(([, v]) => !v || !String(v).trim()).map(([n]) => n)
  return missing.length ? `Missing: ${missing.join(', ')}` : null
}

async function submit() {
  msg.value = null
  const ve = validationError()
  if (ve) {
    msg.value = { text: ve, kind: 'error' }
    return
  }
  busy.value = true
  try {
    // Hours are auto-derived from start/end (contact hours), the same
    // figure the AHA roster's "Total Hours" field expects.
    const hours = contactHours.value
    // type="number" inputs come back as a number (or '' when blank), so
    // coerce to string before any string ops.
    const rawSeats = String(
      isCard.value ? form.maxSeatsCard : form.maxSeatsLecture,
    ).trim()
    let maxSeats: number | null = null
    if (rawSeats !== '') {
      const n = parseInt(rawSeats, 10)
      if (isNaN(n) || n < 1) throw new Error('Max Seats must be a whole number > 0.')
      maxSeats = n
    }

    let verificationPointsRequired: number | null = null
    const vpRaw = String(form.verificationPoints ?? '').trim()
    if (!isCard.value && vpRaw !== '' && vpRaw !== '0') {
      const vp = parseInt(vpRaw, 10)
      if (isNaN(vp) || vp < 0 || vp > 10) {
        throw new Error('Verification Points must be between 0 and 10.')
      }
      verificationPointsRequired = vp
    }

    const a1 = assistCount.value >= 1 ? form.assist1 : blankInstructor()
    const a2 = assistCount.value >= 2 ? form.assist2 : blankInstructor()

    const payload = {
      sessionType: form.sessionType,
      title: isCard.value
        ? `${form.cardCourse} - ${form.classDate}`
        : `Lecture - ${form.lectureTitle.trim()} - ${form.classDate}`,
      classDate: form.classDate,
      startTime: form.startTime,
      endTime: form.endTime,
      location: form.location.trim(),
      cardCourseName: isCard.value ? form.cardCourse : '',
      lectureTitle: isCard.value ? '' : form.lectureTitle.trim(),
      dshsContentArea: isCard.value ? '' : form.dshsArea,
      hoursAwarded: hours,
      maxSeats,
      verificationPointsRequired,
      primaryInstructorName: form.primary.name.trim(),
      primaryInstructorEmail: form.primary.email.trim().toLowerCase(),
      primaryInstructorNumber: form.primary.number.trim(),
      primaryInstructorCardExp: form.primary.cardExp,
      secondaryInstructorName: a1.name.trim(),
      secondaryInstructorEmail: a1.email.trim().toLowerCase(),
      secondaryInstructorNumber: a1.number.trim(),
      secondaryInstructorCardExp: a1.cardExp,
      tertiaryInstructorName: a2.name.trim(),
      tertiaryInstructorEmail: a2.email.trim().toLowerCase(),
      tertiaryInstructorNumber: a2.number.trim(),
      tertiaryInstructorCardExp: a2.cardExp,
      registrationType: isCard.value ? 'Wix' : 'Internal',
      // Card classes: Wix signup page. Lectures: the edge function
      // builds the in-app registration URL from `appBaseUrl` once it
      // knows the sessionId.
      registrationUrl: isCard.value ? CARD_CLASS_SIGNUP_URL : '',
      appBaseUrl: window.location.origin,
      virtualEnabled: !isCard.value && form.virtualEnabled,
      teamsMeetingUrl: !isCard.value && form.virtualEnabled
        ? form.teamsMeetingUrl.trim()
        : '',
      status: 'Active',
    }

    const res = await sessions.createSession(payload)
    result.value = {
      sessionId: res.sessionId,
      checkInToken: res.checkInToken,
      evalToken: res.evalToken,
    }
    const origin = window.location.origin
    qr.checkin = await qrDataUrl(`${origin}/checkin?t=${res.checkInToken}`)
    qr.eval = await qrDataUrl(`${origin}/eval?t=${res.evalToken}`)
    // Card-class sign-up lives on Wix — no in-app registration QR for it.
    // Lectures register in-app, so they still get a registration QR.
    qr.reg = isCard.value
      ? ''
      : await qrDataUrl(`${origin}/register?sessionId=${res.sessionId}`)
  } catch (e) {
    msg.value = {
      text: e instanceof Error ? e.message : 'Create session failed.',
      kind: 'error',
    }
  } finally {
    busy.value = false
  }
}

const links = computed(() => {
  if (!result.value) return null
  const origin = window.location.origin
  return {
    checkin: `${origin}/checkin?t=${result.value.checkInToken}`,
    eval: `${origin}/eval?t=${result.value.evalToken}`,
    reg: isCard.value
      ? CARD_CLASS_SIGNUP_URL
      : `${origin}/register?sessionId=${result.value.sessionId}`,
    manage: `/controls?sessionId=${result.value.sessionId}`,
    regLabel: 'Lecture Registration',
  }
})

// Card classes register on Wix — only check-in + eval QR codes here.
// Lectures also get an in-app registration QR.
const qrTiles = computed(() => {
  if (!links.value) return []
  const t = [
    { k: 'checkin', img: qr.checkin, label: 'Check-In', url: links.value.checkin },
    { k: 'eval', img: qr.eval, label: 'Evaluation', url: links.value.eval },
  ]
  if (!isCard.value) {
    t.push({
      k: 'reg',
      img: qr.reg,
      label: links.value.regLabel,
      url: links.value.reg,
    })
  }
  return t
})

async function copy(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = key
    setTimeout(() => (copied.value = null), 1600)
  } catch {
    /* clipboard blocked — link is still visible to copy manually */
  }
}

function reset() {
  result.value = null
  msg.value = null
  Object.assign(form, {
    classDate: new Date().toISOString().slice(0, 10),
    startTime: '',
    endTime: '',
    location: '',
    cardCourse: '',
    maxSeatsCard: '',
    lectureTitle: '',
    dshsArea: '',
    maxSeatsLecture: '',
    verificationPoints: '',
    primary: blankInstructor(),
    assist1: blankInstructor(),
    assist2: blankInstructor(),
  })
  assistCount.value = 0
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <AppShell>
    <!-- ── Result state ─────────────────────────────────────────────── -->
    <div v-if="result" class="result">
      <div class="result-head">
        <div class="ok-badge"><Check :size="20" :stroke-width="2.5" /></div>
        <div>
          <div class="eyebrow">Session created</div>
          <h1 class="display rtitle">{{ previewTitle }}</h1>
          <div class="rmeta">
            {{ prettyDate(form.classDate)
            }}<span v-if="previewTime"> · {{ previewTime }}</span>
            <span class="mono"> · {{ result.sessionId }}</span>
          </div>
        </div>
      </div>

      <div class="qr-grid">
        <div v-for="t in qrTiles" :key="t.k" class="qr-tile">
          <img :src="t.img" :alt="t.label + ' QR'" />
          <div class="qr-name">{{ t.label }}</div>
          <button class="copybtn" @click="copy(t.k, t.url)">
            <component :is="copied === t.k ? Check : Copy" :size="13" />
            {{ copied === t.k ? 'Copied' : 'Copy link' }}
          </button>
        </div>
      </div>

      <div class="result-actions">
        <RouterLink class="btn btn-primary" :to="links!.manage">
          Manage Session <ArrowRight :size="16" />
        </RouterLink>
        <button class="btn btn-secondary" @click="reset">
          <Plus :size="15" /> Create another
        </button>
      </div>
    </div>

    <!-- ── Form state ───────────────────────────────────────────────── -->
    <template v-else>
      <header class="head">
        <div class="eyebrow">Instructor portal</div>
        <h1 class="display title">Create a session</h1>
        <p class="lede">
          Set it up once — QR codes for check-in, evaluation, and
          registration are generated automatically.
        </p>
      </header>

      <div class="layout">
        <form class="form" @submit.prevent="submit">
          <!-- Session type -->
          <section class="block">
            <div class="block-label">Session type</div>
            <div class="segment">
              <button
                type="button"
                class="seg"
                :class="{ active: isCard, 'seg--locked': !canTeachAnyCard }"
                :disabled="!canTeachAnyCard"
                :title="canTeachAnyCard ? '' : 'You are not authorized for any card disciplines yet.'"
                @click="form.sessionType = 'CardClass'"
              >
                <CreditCard :size="20" :stroke-width="1.75" />
                <div>
                  <div class="seg-t">Card Class</div>
                  <div class="seg-d">AHA cert · publishes a Wix booking</div>
                </div>
              </button>
              <button
                type="button"
                class="seg"
                :class="{ active: !isCard, 'seg--locked': !canTeachLecture }"
                :disabled="!canTeachLecture"
                :title="canTeachLecture ? '' : 'You are not authorized to deliver lectures yet.'"
                @click="form.sessionType = 'Lecture'"
              >
                <GraduationCap :size="20" :stroke-width="1.75" />
                <div>
                  <div class="seg-t">Lecture</div>
                  <div class="seg-d">CE lecture · internal registration</div>
                </div>
              </button>
            </div>
          </section>

          <!-- Course details -->
          <section class="block">
            <div class="block-label">
              <BookOpen :size="14" /> Course details
            </div>
            <div class="fields">
              <template v-if="isCard">
                <label class="f span2">
                  <span>Card Course <i>*</i></span>
                  <select v-model="form.cardCourse">
                    <option value="">Select a course…</option>
                    <option
                      v-for="c in availableCourses"
                      :key="c.id"
                      :value="c.name"
                    >
                      {{ c.name }}
                    </option>
                  </select>
                  <p v-if="!availableCourses.length" class="auth-hint">
                    You're not currently authorized for any card disciplines.
                    Ask a training admin to update your record.
                  </p>
                </label>
                <div class="f hours">
                  <span>Contact Hours</span>
                  <div class="hours__val">
                    <span class="hours__n">{{ contactHours || '—' }}</span>
                    <span class="hours__hint">auto from start/end</span>
                  </div>
                </div>
                <label class="f">
                  <span>Max Seats <em>optional</em></span>
                  <input v-model="form.maxSeatsCard" type="number" min="0" placeholder="No cap" />
                </label>
              </template>
              <template v-else>
                <label class="f span2">
                  <span>Lecture Title <i>*</i></span>
                  <input v-model="form.lectureTitle" type="text" placeholder="e.g. Cardiac Emergencies Update" />
                </label>
                <label class="f span2">
                  <span>DSHS Content Area <i>*</i></span>
                  <select v-model="form.dshsArea">
                    <option value="">Select…</option>
                    <option v-for="a in DSHS_AREAS" :key="a" :value="a">{{ a }}</option>
                  </select>
                </label>
                <div class="f hours">
                  <span>Contact Hours</span>
                  <div class="hours__val">
                    <span class="hours__n">{{ contactHours || '—' }}</span>
                    <span class="hours__hint">auto from start/end</span>
                  </div>
                </div>
                <label class="f">
                  <span>Max In-Person Seats <em>optional</em></span>
                  <input v-model="form.maxSeatsLecture" type="number" min="0" placeholder="No cap" />
                </label>

                <!-- Virtual attendance toggle (phase A). The engagement-code
                     verification UI lands in phase B; for now we just track
                     whether virtual seats exist + carry the Teams URL. -->
                <div class="f span2 virtual">
                  <label class="virtual-toggle">
                    <input v-model="form.virtualEnabled" type="checkbox" />
                    <div class="virtual-toggle__body">
                      <span class="virtual-toggle__t">Allow virtual attendance</span>
                      <span class="virtual-toggle__d">
                        Registrants can join via Microsoft Teams. The lecture's
                        registration link goes on the intranet calendar either way.
                      </span>
                    </div>
                  </label>
                </div>

                <label v-if="form.virtualEnabled" class="f span2">
                  <span>Teams Meeting URL <i>*</i></span>
                  <input
                    v-model="form.teamsMeetingUrl"
                    type="url"
                    placeholder="https://teams.microsoft.com/l/meetup-join/..."
                  />
                </label>
              </template>
            </div>
          </section>

          <!-- Schedule -->
          <section class="block">
            <div class="block-label">
              <CalendarClock :size="14" /> Schedule
            </div>
            <div class="fields">
              <label class="f span2">
                <span>Class Date <i>*</i></span>
                <input v-model="form.classDate" type="date" />
              </label>
              <label class="f">
                <span>Start Time <i>*</i></span>
                <input v-model="form.startTime" type="time" />
              </label>
              <label class="f">
                <span>End Time <i>*</i></span>
                <input v-model="form.endTime" type="time" />
              </label>
              <label class="f span2">
                <span>Location <em>optional</em></span>
                <input v-model="form.location" type="text" placeholder="Training Room" />
              </label>
            </div>
          </section>

          <!-- Instructors -->
          <section class="block">
            <div class="block-label"><Users :size="14" /> Instructors</div>

            <div class="inst">
              <div class="inst-head">
                <span class="badge">Lead</span>
                <span class="inst-hint">Required · prints on the AHA roster</span>
              </div>
              <div class="fields">
                <label class="f span2">
                  <span>Choose instructor <i>*</i></span>
                  <select
                    :value="form.primarySelection"
                    @change="form.primarySelection = ($event.target as HTMLSelectElement).value; applyInstructorSelection('primary', form.primarySelection)"
                  >
                    <option value="">Select instructor…</option>
                    <option
                      v-for="i in sessions.instructorRoster"
                      :key="i.id"
                      :value="i.id"
                    >
                      {{ i.fullName }}
                    </option>
                    <option value="other">Other (enter manually)</option>
                  </select>
                </label>
                <label class="f"
                  ><span>Name <i>*</i></span
                  ><input v-model="form.primary.name" type="text" :readonly="form.primarySelection !== '' && form.primarySelection !== 'other'"
                /></label>
                <label class="f"
                  ><span>Instructor # <i>*</i></span
                  ><input v-model="form.primary.number" type="text"
                /></label>
                <label class="f"
                  ><span>Email <i>*</i></span
                  ><input v-model="form.primary.email" type="email"
                /></label>
                <label class="f"
                  ><span>Card Expiration</span
                  ><input v-model="form.primary.cardExp" type="date"
                /></label>
              </div>
            </div>

            <div v-if="assistCount >= 1" class="inst alt">
              <div class="inst-head">
                <span class="badge alt">Assisting 1</span>
                <button type="button" class="rm" @click="removeAssist(1)">
                  <X :size="13" /> Remove
                </button>
              </div>
              <div class="fields">
                <label class="f span2">
                  <span>Choose instructor</span>
                  <select
                    :value="form.assist1Selection"
                    @change="form.assist1Selection = ($event.target as HTMLSelectElement).value; applyInstructorSelection('assist1', form.assist1Selection)"
                  >
                    <option value="">Select instructor…</option>
                    <option
                      v-for="i in sessions.instructorRoster"
                      :key="i.id"
                      :value="i.id"
                    >
                      {{ i.fullName }}
                    </option>
                    <option value="other">Other (enter manually)</option>
                  </select>
                </label>
                <label class="f"
                  ><span>Name</span
                  ><input v-model="form.assist1.name" type="text" :readonly="form.assist1Selection !== '' && form.assist1Selection !== 'other'"
                /></label>
                <label class="f"><span>Instructor #</span><input v-model="form.assist1.number" type="text" /></label>
                <label class="f"><span>Email</span><input v-model="form.assist1.email" type="email" /></label>
                <label class="f"><span>Card Expiration</span><input v-model="form.assist1.cardExp" type="date" /></label>
              </div>
            </div>

            <div v-if="assistCount >= 2" class="inst alt">
              <div class="inst-head">
                <span class="badge alt">Assisting 2</span>
                <button type="button" class="rm" @click="removeAssist(2)">
                  <X :size="13" /> Remove
                </button>
              </div>
              <div class="fields">
                <label class="f span2">
                  <span>Choose instructor</span>
                  <select
                    :value="form.assist2Selection"
                    @change="form.assist2Selection = ($event.target as HTMLSelectElement).value; applyInstructorSelection('assist2', form.assist2Selection)"
                  >
                    <option value="">Select instructor…</option>
                    <option
                      v-for="i in sessions.instructorRoster"
                      :key="i.id"
                      :value="i.id"
                    >
                      {{ i.fullName }}
                    </option>
                    <option value="other">Other (enter manually)</option>
                  </select>
                </label>
                <label class="f"
                  ><span>Name</span
                  ><input v-model="form.assist2.name" type="text" :readonly="form.assist2Selection !== '' && form.assist2Selection !== 'other'"
                /></label>
                <label class="f"><span>Instructor #</span><input v-model="form.assist2.number" type="text" /></label>
                <label class="f"><span>Email</span><input v-model="form.assist2.email" type="email" /></label>
                <label class="f"><span>Card Expiration</span><input v-model="form.assist2.cardExp" type="date" /></label>
              </div>
            </div>

            <button
              v-if="assistCount < 2"
              type="button"
              class="add-inst"
              @click="addAssist"
            >
              <Plus :size="15" /> Add assisting instructor
            </button>
          </section>

          <div v-if="msg" class="msg" :class="msg.kind">{{ msg.text }}</div>

          <div class="submit-bar">
            <button class="btn btn-primary big" :disabled="busy" @click="submit">
              {{ busy ? 'Creating…' : 'Create Session' }}
            </button>
          </div>
        </form>

        <!-- Live preview -->
        <aside class="preview">
          <div class="preview-card card">
            <div class="eyebrow">Preview</div>
            <div class="pv-title">{{ previewTitle }}</div>
            <span class="chip pv-chip">
              {{ isCard ? 'Card Class' : 'Lecture' }}
            </span>
            <dl class="pv-list">
              <div><dt>Date</dt><dd>{{ prettyDate(form.classDate) }}</dd></div>
              <div>
                <dt>Time</dt>
                <dd>{{ previewTime || '—' }}</dd>
              </div>
              <div><dt>Location</dt><dd>{{ form.location || '—' }}</dd></div>
              <div><dt>Hours</dt><dd>{{ previewHours || '—' }}</dd></div>
              <div v-if="!isCard && form.dshsArea">
                <dt>DSHS Area</dt><dd>{{ form.dshsArea }}</dd>
              </div>
              <div>
                <dt>Instructors</dt>
                <dd>
                  <template v-if="instructorNames.length">
                    {{ instructorNames.join(', ') }}
                  </template>
                  <template v-else>—</template>
                </dd>
              </div>
            </dl>
            <div class="pv-note">
              <ExternalLink :size="12" />
              {{
                isCard
                  ? 'Creating publishes a Wix Bookings event.'
                  : 'Students self-register via the generated link.'
              }}
            </div>
          </div>
        </aside>
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.head {
  margin-bottom: 24px;
}
.title {
  font-size: 34px;
  margin: 4px 0 6px;
}
.lede {
  color: var(--color-muted);
  font-size: 14px;
  margin: 0;
  max-width: 46ch;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* Blocks */
.block {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 20px;
}
.block-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--color-muted);
  margin-bottom: 16px;
}
.block-label svg {
  color: var(--color-accent-600);
}

/* Segmented session type */
.segment {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.seg {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1.5px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms, background 140ms, box-shadow 140ms;
}
.seg:hover {
  border-color: var(--color-muted-soft);
}
.seg svg {
  color: var(--color-muted);
  flex-shrink: 0;
  margin-top: 1px;
}
.seg.active {
  border-color: var(--color-brand-500);
  background: var(--color-brand-50);
  box-shadow: var(--shadow-sm);
}
.seg.active svg {
  color: var(--color-brand-600);
}
.seg-t {
  font-weight: 600;
  font-size: 14.5px;
  color: var(--color-ink);
}
.seg-d {
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 2px;
}
.seg--locked,
.seg--locked:hover {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: var(--color-line);
  background: var(--color-surface);
  box-shadow: none;
}
.auth-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-danger-500);
}

/* Virtual attendance toggle (lecture only) */
.virtual-toggle {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-surface);
  cursor: pointer;
  transition: border-color 140ms, background 140ms;
}
.virtual-toggle:hover {
  border-color: var(--color-muted-soft);
}
.virtual-toggle input[type="checkbox"] {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand-600);
}
.virtual-toggle__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.virtual-toggle__t {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-ink);
}
.virtual-toggle__d {
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.45;
}

/* Fields */
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.f {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.f.span2 {
  grid-column: 1 / -1;
}
.f > span {
  font-size: 12px;
  color: var(--color-ink-soft);
  font-weight: 500;
}
.f i {
  color: var(--color-danger-500);
  font-style: normal;
}
.f em {
  font-style: normal;
  color: var(--color-muted-soft);
  font-weight: 400;
}
input,
select {
  width: 100%;
  padding: 11px 13px;
  border-radius: 9px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 14px;
  color: var(--color-ink);
  font-family: inherit;
  transition: border-color 120ms, box-shadow 120ms;
}
input::placeholder {
  color: var(--color-muted-soft);
}
input:focus,
select:focus {
  outline: none;
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px var(--color-brand-100);
}

.hours__val {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed var(--color-line);
  background: var(--color-surface-soft);
  min-height: 41px;
}
.hours__n {
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 1;
  color: var(--color-brand-600);
}
.hours__hint {
  font-size: 11px;
  color: var(--color-muted);
}

/* Require-registration policy toggle */
.policy {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid var(--color-line);
  border-radius: 11px;
  background: var(--color-surface-soft);
  cursor: pointer;
  transition: border-color 120ms var(--ease-out),
    background 120ms var(--ease-out);
}
.policy:hover {
  border-color: var(--color-brand-300);
}
.policy input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--color-brand-600);
  cursor: pointer;
}
.policy__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.policy__t {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-ink);
}
.policy__d {
  font-size: 12px;
  color: var(--color-muted);
}

/* Instructor sub-cards */
.inst {
  border: 1px solid var(--color-line);
  border-radius: 11px;
  padding: 16px;
  margin-bottom: 12px;
  background: var(--color-surface-soft);
}
.inst.alt {
  background: var(--color-surface);
}
.inst-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-brand-600);
  color: #fff;
}
.badge.alt {
  background: var(--color-surface-sunk);
  color: var(--color-ink-soft);
}
.inst-hint {
  font-size: 11.5px;
  color: var(--color-muted);
}
.rm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.rm:hover {
  color: var(--color-danger-500);
  background: var(--color-danger-50);
}
.add-inst {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border: 1px dashed var(--color-brand-300);
  border-radius: 9px;
  cursor: pointer;
  transition: background 120ms;
}
.add-inst:hover {
  background: var(--color-brand-100);
}

/* Submit */
.submit-bar {
  position: sticky;
  bottom: 0;
  padding-top: 4px;
}
.btn.big {
  width: 100%;
  padding: 15px;
  font-size: 15px;
  box-shadow: var(--shadow-md);
}
.msg {
  padding: 12px 14px;
  border-radius: 9px;
  font-size: 13px;
}
.msg.error {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.msg.success {
  background: var(--color-success-50);
  color: var(--color-success-500);
}

/* Preview rail */
.preview {
  position: sticky;
  top: 84px;
}
.preview-card {
  padding: 20px;
}
.pv-title {
  font-family: var(--font-display);
  font-size: 21px;
  line-height: 1.15;
  margin: 6px 0 10px;
  color: var(--color-ink);
}
.pv-chip {
  margin-bottom: 16px;
}
.pv-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
}
.pv-list > div {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 0;
  border-top: 1px solid var(--color-line-soft);
}
.pv-list dt {
  font-size: 12px;
  color: var(--color-muted);
}
.pv-list dd {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  text-align: right;
  color: var(--color-ink);
}
.pv-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-line-soft);
  font-size: 11.5px;
  color: var(--color-muted);
  line-height: 1.45;
}
.pv-note svg {
  flex-shrink: 0;
  margin-top: 1px;
}

/* Result */
.result {
  max-width: 720px;
  margin: 0 auto;
}
.result-head {
  display: flex;
  gap: 16px;
  margin-bottom: 26px;
}
.ok-badge {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--color-success-50);
  color: var(--color-success-500);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.rtitle {
  font-size: 26px;
  margin: 3px 0 5px;
}
.rmeta {
  font-size: 13px;
  color: var(--color-muted);
}
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.qr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}
.qr-tile {
  text-align: center;
  padding: 18px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 13px;
}
.qr-tile img {
  width: 100%;
  max-width: 170px;
  aspect-ratio: 1;
  margin: 0 auto 12px;
  display: block;
}
.qr-name {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-muted);
  margin-bottom: 10px;
}
.copybtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.copybtn:hover {
  background: var(--color-surface-soft);
}
.result-actions {
  display: flex;
  gap: 12px;
}
.result-actions .btn {
  flex: 1;
  padding: 13px;
}

@media (max-width: 920px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .preview {
    position: static;
    order: -1;
  }
}
@media (max-width: 560px) {
  .segment,
  .fields {
    grid-template-columns: 1fr;
  }
  .qr-grid {
    grid-template-columns: 1fr;
  }
  .result-actions {
    flex-direction: column;
  }
}
</style>
