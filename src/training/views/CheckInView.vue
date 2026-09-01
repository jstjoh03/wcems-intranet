<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import PublicShell from '@/training/components/PublicShell.vue'
import { invokeEdge } from '@/training/lib/supabase'
import type { PublicSession } from '@/training/types'

const route = useRoute()
const state = ref<'loading' | 'error' | 'form' | 'success' | 'pending'>('loading')
const errMsg = ref('Unable to load session.')
const session = ref<PublicSession | null>(null)
const form = reactive({
  name: '',
  email: '',
  mode: '',
  eCardEmail: '',
  mailingAddress: '',
  phone: '',
})
const formMsg = ref<string | null>(null)
const busy = ref(false)

const isCard = computed(() => session.value?.sessionType === 'CardClass')
const courseName = computed(() => {
  const s = session.value
  if (!s) return 'Training Session'
  return s.sessionType === 'CardClass'
    ? s.cardCourseName || s.title
    : s.lectureTitle || s.title
})

function fmtDate(d: string) {
  if (!d) return '—'
  try {
    const [y, m, day] = d.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', {
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
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const timeRange = computed(() => {
  const s = session.value
  if (!s) return ''
  return [fmtTime(s.startTime), fmtTime(s.endTime)].filter(Boolean).join(' – ')
})

onMounted(load)

async function load() {
  state.value = 'loading'
  const token =
    (route.query.t as string) || (route.query.token as string) || ''
  if (!token) {
    errMsg.value = 'No check-in token provided. Please scan the QR again.'
    state.value = 'error'
    return
  }
  try {
    const data = await invokeEdge<PublicSession & { tokenKind: string }>(
      'training-public',
      { action: 'getSessionByToken', token },
    )
    session.value = data
    if (data.checkInStatus !== 'Open') {
      errMsg.value =
        'Check-in is not currently open for this session. Please wait for the instructor.'
      state.value = 'error'
      return
    }
    // Card classes are always in person — pre-set so the success
    // panel's Attendance line reads correctly without re-asking.
    if (data.sessionType === 'CardClass') form.mode = 'InPerson'
    state.value = 'form'
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : 'Session not found.'
    state.value = 'error'
  }
}

async function submit() {
  formMsg.value = null
  if (!form.name || !form.email) {
    formMsg.value = 'Please fill in all required fields.'
    return
  }
  // Card classes are always in person — the mode picker is hidden and
  // we force InPerson. Lectures still require an explicit choice.
  const mode = isCard.value ? 'InPerson' : form.mode
  if (!isCard.value && !mode) {
    formMsg.value = 'Please choose how you’re attending.'
    return
  }
  if (isCard.value && (!form.eCardEmail || !form.mailingAddress || !form.phone)) {
    formMsg.value = 'Please fill in all AHA card information fields.'
    return
  }
  busy.value = true
  try {
    const r = await invokeEdge<{ success: boolean; pending?: boolean }>(
      'training-public',
      {
        action: 'submitCheckin',
        sessionId: session.value!.sessionId,
        studentName: form.name.trim(),
        studentEmail: form.email.trim().toLowerCase(),
        attendanceMode: mode,
        eCardEmail: form.eCardEmail.trim().toLowerCase(),
        mailingAddress: form.mailingAddress.trim(),
        phone: form.phone.trim(),
      },
    )
    state.value = r.pending ? 'pending' : 'success'
  } catch (e) {
    formMsg.value = e instanceof Error ? e.message : 'Check-in failed.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PublicShell subtitle="Course Check-In">
    <div class="card body">
      <div v-if="state === 'loading'" class="center">
        <div class="spinner" />
        <p>Loading session…</p>
      </div>

      <div v-else-if="state === 'error'" class="center">
        <h3 class="bad">Session Not Found</h3>
        <p class="muted">{{ errMsg }}</p>
      </div>

      <template v-else-if="state === 'form'">
        <span class="badge">Check-In Open</span>
        <div class="s-title">{{ courseName }}</div>
        <div class="meta">
          <div>{{ fmtDate(session!.classDate) }}</div>
          <div v-if="timeRange">{{ timeRange }}</div>
          <div v-if="session!.location">{{ session!.location }}</div>
          <div v-if="session!.primaryInstructorName">
            {{ session!.primaryInstructorName }}
          </div>
        </div>
        <div class="divider" />

        <label
          >Full Name <i>*</i>
          <input v-model="form.name" type="text" autocomplete="name" />
        </label>
        <label
          >Work Email <i>*</i>
          <input v-model="form.email" type="email" autocomplete="email" />
          <small>{{
            isCard
              ? 'Your work email for records.'
              : 'Your certificate will be sent to this email.'
          }}</small>
        </label>

        <template v-if="isCard">
          <div class="sec">AHA Card Information</div>
          <label
            >eCard Email <i>*</i>
            <input v-model="form.eCardEmail" type="email" />
            <small>Where should AHA send your digital card?</small>
          </label>
          <label
            >Mailing Address <i>*</i>
            <textarea v-model="form.mailingAddress" rows="2" />
            <small>Required for AHA course roster.</small>
          </label>
          <label
            >Phone Number <i>*</i>
            <input v-model="form.phone" type="tel" placeholder="(xxx) xxx-xxxx" />
          </label>
        </template>

        <!-- Card classes are always in person — only lectures need the picker. -->
        <label v-if="!isCard"
          >Attendance Mode <i>*</i>
          <select v-model="form.mode">
            <option value="">Select how you're attending…</option>
            <option value="InPerson">In Person</option>
            <option value="Virtual">Virtual</option>
          </select>
        </label>

        <div v-if="!isCard && form.mode === 'Virtual'" class="notice">
          <b>Virtual Attendance Verification</b><br />
          During the course you'll need to enter verification codes announced
          by the instructor to access the evaluation and receive your
          certificate.
        </div>

        <button class="btn btn-primary full mt" :disabled="busy" @click="submit">
          {{ busy ? 'Checking in…' : 'Check In' }}
        </button>
        <div v-if="formMsg" class="fmsg">{{ formMsg }}</div>
      </template>

      <div v-else-if="state === 'success'" class="center">
        <h3 class="good">Checked In!</h3>
        <p class="muted">
          {{
            form.mode === 'Virtual'
              ? "You're checked in! See next steps below."
              : "You're checked in for this session."
          }}
        </p>
        <div class="details">
          <div><span>Session</span><b>{{ courseName }}</b></div>
          <div><span>Name</span><b>{{ form.name }}</b></div>
          <div><span>Email</span><b>{{ form.email }}</b></div>
          <div v-if="!isCard">
            <span>Attendance</span
            ><b>{{ form.mode === 'InPerson' ? 'In Person' : 'Virtual' }}</b>
          </div>
        </div>
        <div v-if="form.mode === 'Virtual'" class="notice mt">
          <b>Next Steps for Virtual Attendees</b><br />
          Watch for the instructor to announce verification codes during the
          session. Enter each code to complete your attendance verification.
        </div>
      </div>

      <div v-else-if="state === 'pending'" class="center">
        <h3 class="warn">Awaiting instructor approval</h3>
        <p class="muted">
          We couldn't find your registration for this session, so your
          check-in was sent to the instructor for approval. Please find
          them in the room — they can approve walk-ins with one tap.
        </p>
        <div class="details">
          <div><span>Session</span><b>{{ courseName }}</b></div>
          <div><span>Name</span><b>{{ form.name }}</b></div>
          <div><span>Email</span><b>{{ form.email }}</b></div>
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
.warn {
  color: var(--color-warning-500);
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
.badge {
  display: inline-flex;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  background: var(--color-success-50);
  color: var(--color-success-500);
  margin-bottom: 14px;
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
.sec {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--color-muted);
  margin: 18px 0 12px;
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
select,
textarea {
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
textarea {
  resize: vertical;
}
small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-muted);
}
.notice {
  padding: 13px 15px;
  border-radius: 10px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  font-size: 13px;
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
  gap: 12px;
}
.details span {
  color: var(--color-muted);
}
.details b {
  text-align: right;
  word-break: break-word;
}
</style>
