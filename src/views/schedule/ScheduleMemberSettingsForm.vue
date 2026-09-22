<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  NOTIFY_TYPES,
  NOTIFY_CHANNELS,
  notifyOn,
  HIGHLIGHT_SWATCHES,
  DEFAULT_HIGHLIGHT,
  type Availability,
  type MemberSettings,
  type NotifyChannel,
} from '@/composables/useSchedule'
import { useScheduleAccess } from '@/composables/useScheduleAccess'
import { useAuthStore } from '@/stores/auth'
import { formatPhoneInput } from '@/utils/phone'

/**
 * My scheduling settings — SMS consent (checkbox + the number it applies
 * to, on one form, per our carrier registration), the notification
 * matrix, and upcoming unavailable days.
 *
 * One shared form, two homes: the "My settings" modal on My schedule
 * (the path our A2P registration documents) and the profile modal's
 * Scheduling section. Both read and write the same
 * sched_member_settings row, so there is exactly one consent record.
 * Loads its own data on mount — hosts don't pass anything in.
 */

const emit = defineEmits<{ (e: 'saved'): void }>()

const sched = useSchedule()
const auth = useAuthStore()
const access = useScheduleAccess()

const set = ref<MemberSettings | null>(null)
const unavail = ref<Availability[]>([])
const busy = ref(false)
const saved = ref(false)
const err = ref<string | null>(null)

/** Editors and supervisors also get the approvals row. Uses the
 *  lightweight access probe so the form works from the profile modal
 *  without booting the scheduling store. */
const notifyTypes = computed(() =>
  NOTIFY_TYPES.filter(
    (t) =>
      !t.editorOnly ||
      access.level.value === 'global_admin' ||
      access.level.value === 'scheduler' ||
      access.level.value === 'supervisor',
  ),
)

onMounted(async () => {
  const me = sched.myUserId.value
  if (!me) return
  const s = await sched.fetchMemberSettings(me)
  // Consent is tied to a number entered on this form — prefill from the
  // roster so most people just confirm what's already right.
  if (!s.smsPhone && auth.appUser?.phone) s.smsPhone = auth.appUser.phone
  set.value = s
  unavail.value = await sched.listMyUnavailable()
})

function nChecked(key: string, ch: NotifyChannel): boolean {
  return set.value ? notifyOn(set.value.notify, key, ch) : true
}

function nToggle(key: string, ch: NotifyChannel, ev: Event) {
  if (!set.value) return
  const on = (ev.target as HTMLInputElement).checked
  const n = { ...(set.value.notify as Record<string, Record<string, boolean>>) }
  n[key] = { ...(n[key] ?? {}), [ch]: on }
  set.value.notify = n
}

async function save() {
  if (!set.value) return
  busy.value = true
  err.value = null
  saved.value = false
  const e = await sched.saveMemberSettings(set.value)
  busy.value = false
  if (e) {
    err.value = e
    return
  }
  saved.value = true
  emit('saved')
}

async function removeUnavail(id: string) {
  err.value = null
  const e = await sched.clearUnavailable(id)
  if (e) {
    err.value = e
    return
  }
  unavail.value = await sched.listMyUnavailable()
}

function fmtUnavail(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="msf">
    <p v-if="err" class="msf__err">{{ err }}</p>

    <template v-if="set">
      <section class="msf__sec">
        <h4 class="msf__h">Contact on file</h4>
        <p class="msf__line">
          {{ auth.appUser?.phone ?? 'No phone on file' }} · {{ auth.appUser?.email ?? 'no email on file' }}
        </p>
        <p class="msf__hint">Wrong or missing? Ask the office to update your roster record.</p>
        <label class="msf__check">
          <input v-model="set.smsOptIn" type="checkbox" />
          Send me text messages about scheduling
        </label>
        <label class="msf__phone">
          <span class="msf__phonelabel">Mobile number for text messages</span>
          <input
            v-model="set.smsPhone"
            type="tel"
            class="msf__phoneinput"
            placeholder="(555) 555-5555"
            :disabled="!set.smsOptIn"
            autocomplete="tel"
            @input="set.smsPhone = formatPhoneInput(set.smsPhone ?? '')"
          />
        </label>
        <p class="msf__hint">
          Optional — never required. Texts go to the number above (prefilled from your
          roster record — you can change it). Frequency varies with schedule activity;
          message &amp; data rates may apply. Reply STOP to any message to opt out (or
          untick this box), HELP for help. See the
          <a href="/sms-terms.html" target="_blank" rel="noopener">SMS Terms</a> and
          <a href="/sms-privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
        </p>
      </section>

      <section class="msf__sec">
        <h4 class="msf__h">Notifications</h4>
        <table class="msf__ntable">
          <thead>
            <tr>
              <th></th>
              <th v-for="ch in NOTIFY_CHANNELS" :key="ch.key">{{ ch.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in notifyTypes" :key="t.key">
              <td class="msf__ntype">{{ t.label }}</td>
              <td v-for="ch in NOTIFY_CHANNELS" :key="ch.key">
                <input
                  type="checkbox"
                  :checked="nChecked(t.key, ch.key)"
                  :disabled="ch.key === 'sms' && !set.smsOptIn"
                  :aria-label="`${t.label} — ${ch.label}`"
                  @change="nToggle(t.key, ch.key, $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="msf__hint">
          Push and email alerts are live. Texts start as soon as our texting number
          clears carrier registration.
        </p>
      </section>

      <section class="msf__sec">
        <h4 class="msf__h">My shift highlight</h4>
        <p class="msf__hint">The color your own shifts glow on every calendar.</p>
        <div class="msf__swatches">
          <button
            v-for="sw in HIGHLIGHT_SWATCHES"
            :key="sw.label"
            type="button"
            class="msf__swatch"
            :class="{ 'msf__swatch--on': (set.highlightColor ?? null) === sw.value }"
            :style="{ background: sw.value ?? DEFAULT_HIGHLIGHT }"
            :title="sw.label"
            :aria-label="sw.label"
            @click="set.highlightColor = sw.value"
          />
        </div>
      </section>

      <section class="msf__sec">
        <h4 class="msf__h">Unavailable days</h4>
        <p v-if="unavail.length === 0" class="msf__hint">
          None marked. Protect a rotation day off from Requests → Time off → “Mark unavailable”.
        </p>
        <ul v-else class="msf__ulist">
          <li v-for="a in unavail" :key="a.id" class="msf__urow">
            <span class="msf__udate">{{ fmtUnavail(a.onDate) }}</span>
            <span v-if="a.reason" class="msf__ureason">{{ a.reason }}</span>
            <button class="msf__uremove" @click="removeUnavail(a.id)">Remove</button>
          </li>
        </ul>
      </section>

      <div class="msf__foot">
        <span v-if="saved" class="msf__saved">Saved.</span>
        <slot name="foot" />
        <button class="msf__save" :disabled="busy" @click="save">
          {{ busy ? 'Saving…' : 'Save settings' }}
        </button>
      </div>
    </template>
    <p v-else class="msf__hint">Loading…</p>
  </div>
</template>

<style scoped>
.msf__sec {
  border-top: 1px solid var(--color-line-soft);
  padding: 0.7rem 0 0.4rem;
}

.msf__h {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.4rem;
}

.msf__line {
  font-size: 0.86rem;
  color: var(--color-ink);
  margin: 0 0 0.15rem;
  overflow-wrap: anywhere;
}

.msf__hint {
  font-size: 0.75rem;
  color: var(--color-muted);
  margin: 0.15rem 0 0.4rem;
}

.msf__check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: var(--color-ink-soft);
  margin: 0.35rem 0 0.2rem;
}

/* the number consent applies to — same form as the checkbox (A2P) */
.msf__phone {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0.25rem 0 0.3rem;
}

.msf__phonelabel {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

.msf__phoneinput {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
  max-width: 220px;
}

.msf__phoneinput:disabled {
  opacity: 0.55;
}

.msf__err {
  font-size: 0.8rem;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  background: oklch(0.98 0.013 27);
  border: 1px solid oklch(0.88 0.06 27);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  margin: 0 0 0.6rem;
}

.msf__ntable {
  border-collapse: collapse;
  font-size: 0.82rem;
  width: 100%;
}

.msf__ntable th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 0.25rem 0.5rem;
  text-align: center;
}

.msf__ntable td {
  padding: 0.3rem 0.5rem;
  border-top: 1px solid var(--color-line-soft);
  text-align: center;
}

.msf__ntable td.msf__ntype {
  text-align: left;
  color: var(--color-ink-soft);
  padding-left: 0;
}

.msf__ntable input[type='checkbox']:disabled {
  opacity: 0.4;
}

.msf__ulist {
  list-style: none;
  margin: 0.2rem 0 0.3rem;
  padding: 0;
}

.msf__urow {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 0.84rem;
  flex-wrap: wrap;
}

.msf__urow:last-child {
  border-bottom: 0;
}

.msf__udate {
  font-weight: 600;
  color: var(--color-ink);
}

.msf__ureason {
  color: var(--color-muted);
  font-size: 0.78rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.msf__uremove {
  margin-left: auto;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  background: transparent;
  border: 1px solid oklch(0.88 0.06 27);
  border-radius: 7px;
  padding: 0.1rem 0.5rem;
  cursor: pointer;
}

.msf__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--color-line-soft);
  padding-top: 0.7rem;
  margin-top: 0.4rem;
}

.msf__saved {
  font-size: 0.8rem;
  color: var(--color-success-600, oklch(0.55 0.13 150));
  margin-right: auto;
}

.msf__save {
  font: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  padding: 0.4rem 1rem;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18), 0 1px 2px oklch(0.2 0.04 260 / 0.2);
  color: white;
  cursor: pointer;
}

.msf__save:disabled {
  opacity: 0.6;
  cursor: default;
}
.msf__swatches {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.msf__swatch {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid oklch(0 0 0 / 0.14);
  cursor: pointer;
  padding: 0;
}

.msf__swatch--on {
  box-shadow: 0 0 0 3px var(--color-brand-700);
}
</style>
