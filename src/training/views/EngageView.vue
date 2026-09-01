<script setup lang="ts">
import { onMounted, onUnmounted, ref, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import PublicShell from '@/training/components/PublicShell.vue'
import { invokeEdge } from '@/training/lib/supabase'

interface StatusResp {
  sessionId: string
  sessionStatus: string
  lectureTitle: string
  classDate: string | null
  virtualEnabled: boolean
  teamsMeetingUrl: string
  activeCode: { id: string; expiresAt: string; createdAt: string } | null
  message?: string
}

const route = useRoute()
const state = ref<'loading' | 'error' | 'identify' | 'ready'>('loading')
const errMsg = ref('Unable to load this lecture.')
const status = ref<StatusResp | null>(null)
const form = reactive({ name: '', email: '' })
const code = ref('')
const submitting = ref(false)
const submitMsg = ref<{ t: string; k: 'ok' | 'err' | 'info' } | null>(null)
const responseCount = ref(0)
const seenCodeIds = ref<Set<string>>(new Set())
const nowMs = ref(Date.now())
let pollTimer: number | null = null
let tickTimer: number | null = null

const sessionId = computed(() => String(route.query.session || ''))
const sessionStorageKey = computed(() =>
  sessionId.value ? `engage:identity:${sessionId.value}` : '',
)

function persistIdentity() {
  const key = sessionStorageKey.value
  if (!key) return
  localStorage.setItem(
    key,
    JSON.stringify({ name: form.name, email: form.email.toLowerCase() }),
  )
}
function restoreIdentity() {
  const key = sessionStorageKey.value
  if (!key) return false
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const obj = JSON.parse(raw) as { name?: string; email?: string }
    if (obj.email && obj.name) {
      form.name = obj.name
      form.email = obj.email
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

const activeCountdownSec = computed(() => {
  if (!status.value?.activeCode) return 0
  const ms =
    new Date(status.value.activeCode.expiresAt).getTime() - nowMs.value
  return Math.max(0, Math.ceil(ms / 1000))
})
const isCodeActive = computed(
  () => !!status.value?.activeCode && activeCountdownSec.value > 0,
)
const lectureDate = computed(() => {
  const d = status.value?.classDate
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return d
  }
})

async function loadStatus() {
  try {
    const data = await invokeEdge<StatusResp>('training-public', {
      action: 'getEngagementStatus',
      sessionId: sessionId.value,
    })
    status.value = data
    // First load — pick the right initial state.
    if (state.value === 'loading') {
      if (restoreIdentity()) state.value = 'ready'
      else state.value = 'identify'
    }
    // Auto-clear the "submitted" flash once the code rolls over.
    const newId = data.activeCode?.id ?? ''
    if (newId && !seenCodeIds.value.has(newId)) {
      // A fresh code arrived — clear the typed-in code & submit message
      // so the attendee knows to enter the next one.
      code.value = ''
      submitMsg.value = null
    }
  } catch (e) {
    if (state.value === 'loading') {
      errMsg.value =
        e instanceof Error ? e.message : 'Unable to load this lecture.'
      state.value = 'error'
    }
  }
}

onMounted(async () => {
  if (!sessionId.value) {
    errMsg.value = 'No session ID provided. Check the link from the instructor.'
    state.value = 'error'
    return
  }
  await loadStatus()
  // Poll every 5s for status changes — instructor generating codes,
  // session being closed, etc.
  pollTimer = window.setInterval(() => void loadStatus(), 5000)
  tickTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  if (tickTimer) window.clearInterval(tickTimer)
})

function startIdentify() {
  if (!form.name.trim() || !form.email.trim()) {
    submitMsg.value = {
      t: 'Please enter your name and email so the instructor can credit you.',
      k: 'err',
    }
    return
  }
  if (!form.email.includes('@')) {
    submitMsg.value = { t: 'Please enter a valid email address.', k: 'err' }
    return
  }
  form.email = form.email.trim().toLowerCase()
  form.name = form.name.trim()
  persistIdentity()
  submitMsg.value = null
  state.value = 'ready'
}

async function submitCode() {
  if (!sessionId.value) return
  const trimmed = code.value.replace(/\s+/g, '').trim()
  if (!trimmed) {
    submitMsg.value = { t: 'Enter the code the instructor announced.', k: 'err' }
    return
  }
  submitting.value = true
  submitMsg.value = null
  try {
    const res = await invokeEdge<{
      success: boolean
      codeId: string
      expiresAt: string
    }>('training-public', {
      action: 'submitEngagementCode',
      sessionId: sessionId.value,
      code: trimmed,
      studentName: form.name,
      studentEmail: form.email,
    })
    if (res?.success) {
      seenCodeIds.value.add(res.codeId)
      responseCount.value++
      code.value = ''
      submitMsg.value = {
        t: 'Got it — your response is recorded.',
        k: 'ok',
      }
    }
  } catch (e) {
    submitMsg.value = {
      t: e instanceof Error ? e.message : 'Could not submit the code.',
      k: 'err',
    }
  } finally {
    submitting.value = false
  }
}

function switchIdentity() {
  const key = sessionStorageKey.value
  if (key) localStorage.removeItem(key)
  form.name = ''
  form.email = ''
  submitMsg.value = null
  state.value = 'identify'
}
</script>

<template>
  <PublicShell subtitle="Lecture Engagement">
    <div class="card body">
      <div v-if="state === 'loading'" class="center">
        <div class="spinner" />
        <p>Loading lecture…</p>
      </div>

      <div v-else-if="state === 'error'" class="center">
        <h3 class="bad">Can't Load</h3>
        <p class="muted">{{ errMsg }}</p>
      </div>

      <template v-else-if="state === 'identify'">
        <div class="s-title">{{ status?.lectureTitle || 'CE Lecture' }}</div>
        <div v-if="lectureDate" class="meta">{{ lectureDate }}</div>
        <div class="divider" />
        <h3>Confirm your identity</h3>
        <p class="muted">
          The instructor will announce short codes during the lecture. Enter
          your name and work email once — we'll save it on this device so you
          can quickly submit each code as it appears.
        </p>
        <label
          >Full Name <i>*</i>
          <input v-model="form.name" type="text" autocomplete="name" />
        </label>
        <label
          >Work Email <i>*</i>
          <input v-model="form.email" type="email" autocomplete="email" />
          <small>Must match the email you registered with.</small>
        </label>
        <button class="btn btn-primary full mt" @click="startIdentify">
          I'm ready
        </button>
        <div v-if="submitMsg" class="fmsg" :class="submitMsg.k">{{ submitMsg.t }}</div>
      </template>

      <template v-else-if="state === 'ready'">
        <div class="s-title">{{ status?.lectureTitle || 'CE Lecture' }}</div>
        <div v-if="lectureDate" class="meta">{{ lectureDate }}</div>
        <div class="who">
          <div>
            <small class="muted">Signed in as</small>
            <div class="who__name">{{ form.name }}</div>
            <div class="who__email">{{ form.email }}</div>
          </div>
          <button class="link-btn" @click="switchIdentity">Not you?</button>
        </div>

        <div class="divider" />

        <div v-if="isCodeActive" class="active">
          <p class="active__head">
            <span class="dot" />
            Active code — expires in <b>{{ activeCountdownSec }}s</b>
          </p>
          <label class="codelbl"
            >Enter the code the instructor announced
            <input
              v-model="code"
              class="codeinp"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="••••"
              :disabled="submitting"
              @keydown.enter="submitCode"
            />
          </label>
          <button
            class="btn btn-primary full"
            :disabled="submitting || !code.trim()"
            @click="submitCode"
          >
            {{ submitting ? 'Submitting…' : 'Submit code' }}
          </button>
        </div>
        <div v-else class="idle">
          <p class="idle__head">No active code right now.</p>
          <p class="muted">
            Keep this page open. When the instructor announces a code, an
            input box will appear here automatically — submit it before the
            timer runs out to confirm your engagement.
          </p>
        </div>

        <div v-if="submitMsg" class="fmsg" :class="submitMsg.k">
          {{ submitMsg.t }}
        </div>

        <div class="footnote">
          You've submitted <b>{{ responseCount }}</b> code{{
            responseCount === 1 ? '' : 's'
          }} during this lecture so far.
        </div>
      </template>
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
  margin-bottom: 6px;
}
.meta {
  font-size: 13px;
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
input {
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
.full {
  width: 100%;
}
.mt {
  margin-top: 16px;
}
.who {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--color-surface-sunk);
  border-radius: 9px;
}
.who__name {
  font-weight: 600;
}
.who__email {
  font-size: 12px;
  color: var(--color-muted);
}
.link-btn {
  background: none;
  border: none;
  color: var(--color-brand-700);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.active {
  padding: 18px 16px;
  background: var(--color-brand-50);
  border-radius: 12px;
}
.active__head {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--color-brand-700);
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--color-success-500);
  box-shadow: 0 0 0 4px var(--color-success-50);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.codelbl {
  color: var(--color-ink);
  font-size: 13px;
  margin-bottom: 14px;
}
.codeinp {
  text-align: center;
  letter-spacing: 0.5em;
  font-size: 26px;
  font-weight: 700;
  padding: 14px;
}
.idle {
  padding: 18px 16px;
  background: var(--color-surface-sunk);
  border-radius: 12px;
  border: 1px dashed var(--color-line);
}
.idle__head {
  margin: 0 0 8px;
  font-weight: 600;
  font-size: 14px;
}
.fmsg {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 14px;
}
.fmsg.ok {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.fmsg.err {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.fmsg.info {
  background: var(--color-brand-50);
  color: var(--color-brand-700);
}
.footnote {
  margin-top: 18px;
  font-size: 12.5px;
  color: var(--color-muted);
  text-align: center;
}
</style>
