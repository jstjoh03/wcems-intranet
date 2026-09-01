<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import PublicShell from '@/training/components/PublicShell.vue'
import { invokeEdge } from '@/training/lib/supabase'
import type { PublicSession } from '@/training/types'

const route = useRoute()
const state = ref<
  'loading' | 'error' | 'closed' | 'card' | 'lecture' | 'success'
>('loading')
const errMsg = ref('Unable to load session details.')
const session = ref<PublicSession | null>(null)
const form = reactive({ name: '', email: '', mode: '', certLevel: '' })
const formMsg = ref<{ t: string; k: string } | null>(null)
const busy = ref(false)

function fmtDate(d: string) {
  if (!d) return '—'
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return d
  }
}
function fmtTime(t: string) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return t
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`
}
const courseName = computed(() => {
  const s = session.value
  if (!s) return 'Training Session'
  return s.sessionType === 'CardClass'
    ? s.cardCourseName || s.title
    : s.lectureTitle || s.title
})
const timeRange = computed(() => {
  const s = session.value
  if (!s) return ''
  return [fmtTime(s.startTime), fmtTime(s.endTime)].filter(Boolean).join(' – ')
})

const seatInfo = computed(() => {
  const s = session.value
  if (!s || !s.maxSeats) return null
  return { remaining: s.maxSeats - (s.registeredCount || 0), max: s.maxSeats }
})

onMounted(load)

async function load() {
  state.value = 'loading'
  const sessionId =
    (route.query.sessionId as string) ||
    (route.query.SessionId as string) ||
    ''
  if (!sessionId) {
    errMsg.value = 'No session ID provided. Please check the link.'
    state.value = 'error'
    return
  }
  try {
    const data = await invokeEdge<PublicSession>('training-public', {
      action: 'getSessionById',
      sessionId,
    })
    session.value = data
    const st = (data.status || '').toLowerCase()
    if (st !== 'active' && st !== 'scheduled') {
      state.value = 'closed'
      return
    }
    state.value = data.sessionType === 'CardClass' ? 'card' : 'lecture'
  } catch (e) {
    errMsg.value =
      e instanceof Error ? e.message : 'Session not found.'
    state.value = 'error'
  }
}

async function submit() {
  formMsg.value = null
  if (!form.name || !form.email || !form.mode || !form.certLevel) {
    formMsg.value = { t: 'Please fill in all required fields.', k: 'error' }
    return
  }
  if (form.mode === 'InPerson' && seatInfo.value && seatInfo.value.remaining <= 0) {
    formMsg.value = {
      t: 'In-person registration is full. Please select Virtual.',
      k: 'error',
    }
    return
  }
  busy.value = true
  try {
    await invokeEdge('training-public', {
      action: 'register',
      sessionId: session.value!.sessionId,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      attendanceMode: form.mode,
      certLevel: form.certLevel,
    })
    state.value = 'success'
  } catch (e) {
    formMsg.value = {
      t: e instanceof Error ? e.message : 'Registration failed.',
      k: 'error',
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PublicShell subtitle="Course Registration">
    <div class="card body">
      <div v-if="state === 'loading'" class="center">
        <div class="spinner" />
        <p>Loading session details…</p>
      </div>

      <div v-else-if="state === 'error'" class="center">
        <h3 class="bad">Session Not Found</h3>
        <p class="muted">{{ errMsg }}</p>
      </div>

      <div v-else-if="state === 'closed'" class="center">
        <h3 class="bad">Registration Closed</h3>
        <p class="muted">Registration for this session is no longer available.</p>
      </div>

      <template v-else-if="state === 'card'">
        <div class="s-title">{{ courseName }}</div>
        <div class="meta">
          <div>{{ fmtDate(session!.classDate) }}</div>
          <div v-if="timeRange">{{ timeRange }}</div>
          <div v-if="session!.location">{{ session!.location }}</div>
        </div>
        <div class="divider" />
        <h3>External Registration</h3>
        <p class="muted">
          This card class uses our member portal for registration.
        </p>
        <a
          class="btn btn-primary full"
          :href="session!.registrationUrl"
          target="_blank"
          >Continue to Sign Up</a
        >
      </template>

      <template v-else-if="state === 'lecture'">
        <div class="s-title">{{ courseName }}</div>
        <div class="meta">
          <div>{{ fmtDate(session!.classDate) }}</div>
          <div v-if="timeRange">{{ timeRange }}</div>
          <div v-if="session!.location">{{ session!.location }}</div>
          <div v-if="session!.hoursAwarded">{{ session!.hoursAwarded }} Contact Hours</div>
          <div v-if="session!.dshsContentArea">{{ session!.dshsContentArea }}</div>
        </div>
        <div class="divider" />

        <label
          >Full Name <i>*</i>
          <input v-model="form.name" type="text" autocomplete="name" />
        </label>
        <label
          >Work Email <i>*</i>
          <input v-model="form.email" type="email" autocomplete="email" />
          <small>Your certificate of completion will be sent here.</small>
        </label>
        <label
          >Certification Level <i>*</i>
          <select v-model="form.certLevel">
            <option value="">Select your cert level…</option>
            <option value="Paramedic">Paramedic</option>
            <option value="EMT">EMT / AEMT</option>
          </select>
          <small>Used to match you to the right quiz, if one is offered.</small>
        </label>
        <label
          >Attendance Mode <i>*</i>
          <select v-model="form.mode">
            <option value="">Select how you'll attend…</option>
            <option value="InPerson">In Person</option>
            <option v-if="session!.virtualEnabled" value="Virtual">
              Virtual (Microsoft Teams)
            </option>
          </select>
          <small v-if="!session!.virtualEnabled">
            This lecture is in-person only.
          </small>
        </label>

        <div
          v-if="form.mode === 'Virtual'"
          class="seat ok"
        >
          Virtual attendance — no seat limit
        </div>
        <div
          v-else-if="form.mode === 'InPerson' && seatInfo"
          class="seat"
          :class="{ bad: seatInfo.remaining <= 0 }"
        >
          {{
            seatInfo.remaining <= 0
              ? 'In-person seats full — please select Virtual'
              : seatInfo.remaining + ' of ' + seatInfo.max + ' in-person seats remaining'
          }}
        </div>
        <div v-else-if="form.mode === 'InPerson'" class="seat">
          In-person seats available
        </div>

        <button class="btn btn-primary full mt" :disabled="busy" @click="submit">
          {{ busy ? 'Registering…' : 'Register for Session' }}
        </button>
        <div v-if="formMsg" class="fmsg" :class="formMsg.k">{{ formMsg.t }}</div>
      </template>

      <div v-else-if="state === 'success'" class="center">
        <h3 class="good">Registration Complete!</h3>
        <p class="muted">You're registered for this training session.</p>
        <div class="details">
          <div><span>Session</span><b>{{ courseName }}</b></div>
          <div><span>Date</span><b>{{ fmtDate(session!.classDate) }}</b></div>
          <div><span>Name</span><b>{{ form.name }}</b></div>
          <div><span>Email</span><b>{{ form.email }}</b></div>
          <div>
            <span>Attendance</span
            ><b>{{ form.mode === 'InPerson' ? 'In Person' : 'Virtual' }}</b>
          </div>
        </div>
        <div
          v-if="form.mode === 'Virtual' && session!.teamsMeetingUrl"
          class="teams"
        >
          <p class="teams__heading">Microsoft Teams link</p>
          <a class="teams__url" :href="session!.teamsMeetingUrl" target="_blank">
            {{ session!.teamsMeetingUrl }}
          </a>
          <p class="teams__hint">
            Save this link — you'll also receive a reminder from the
            calendar invite the instructor sends.
          </p>
        </div>
        <div v-else-if="form.mode === 'InPerson' && session!.location" class="teams">
          <p class="teams__heading">Location</p>
          <p class="teams__url">{{ session!.location }}</p>
        </div>
      </div>
    </div>
  </PublicShell>
</template>

<style scoped>
.body {
  padding: 24px;
}
.center {
  text-align: center;
  padding: 22px 0;
}
.muted {
  color: var(--color-muted);
  font-size: 14px;
}
.bad {
  color: var(--color-danger-500);
}
.good {
  color: var(--color-success-500);
}
.spinner {
  width: 34px;
  height: 34px;
  border: 3px solid var(--color-line);
  border-top-color: var(--color-brand-600);
  border-radius: 50%;
  margin: 0 auto 14px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.s-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 10px;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--color-ink-soft);
}
.divider {
  height: 1px;
  background: var(--color-line);
  margin: 18px 0;
}
h3 {
  margin: 0 0 6px;
  font-size: 16px;
}
label {
  display: block;
  font-size: 13px;
  color: var(--color-muted);
  margin-bottom: 14px;
}
label i {
  color: var(--color-danger-500);
  font-style: normal;
}
input,
select {
  width: 100%;
  margin-top: 6px;
  padding: 13px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 16px;
  color: var(--color-ink);
  font-family: inherit;
}
small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
}
.seat {
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  margin-bottom: 4px;
}
.seat.ok {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.seat.bad {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.full {
  width: 100%;
}
.mt {
  margin-top: 16px;
}
.fmsg {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 14px;
}
.fmsg.error {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.details {
  text-align: left;
  margin-top: 18px;
  background: var(--color-success-50);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 13px;
}
.details div {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.details span {
  color: var(--color-muted);
}
.teams {
  margin-top: 18px;
  text-align: left;
  background: var(--color-brand-50);
  border-radius: 10px;
  padding: 14px 16px;
}
.teams__heading {
  margin: 0 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-brand-700);
}
.teams__url {
  display: block;
  font-size: 13px;
  word-break: break-all;
  color: var(--color-brand-700);
  text-decoration: none;
}
.teams__url:hover {
  text-decoration: underline;
}
.teams__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-muted);
}
</style>
