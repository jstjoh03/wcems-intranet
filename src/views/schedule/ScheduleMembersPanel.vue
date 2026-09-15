<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  useSchedule,
  INTERNAL_CREDENTIALS,
  type MemberSettings,
  type SchedPerson,
} from '@/composables/useSchedule'

/**
 * Members — the scheduler-side roster. Click into a member to see their
 * information (internal credential, phone, email, text preference) and,
 * for editors, set the credential, position qualifications/exclusions,
 * and station/unit exclusions. Access levels live here too:
 * Global admin / Scheduler / Supervisor (from portal role) / Member /
 * No access.
 */

const sched = useSchedule()

const search = ref('')
const access = ref<Map<string, string>>(new Map())
const accessLoaded = ref(false)
const err = ref<string | null>(null)

onMounted(async () => {
  await sched.ensureLoaded()
  const rows = await sched.fetchAccessList()
  access.value = new Map(rows.map((r) => [r.userId, r.level]))
  accessLoaded.value = true
})

const LEVEL_LABELS: Record<string, string> = {
  global_admin: 'Global admin',
  scheduler: 'Scheduler',
  supervisor: 'Supervisor',
  member: 'Member',
  none: 'No access',
}

function defaultLevel(p: { role: string }): string {
  return p.role === 'admin' || p.role === 'supervisor' ? 'supervisor' : 'member'
}

function effectiveLevel(p: { id: string; role: string }): string {
  return access.value.get(p.id) ?? defaultLevel(p)
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = sched.people.value
  if (!q) return list
  return list.filter((p) => p.fullName.toLowerCase().includes(q))
})

async function changeAccess(userId: string, ev: Event) {
  err.value = null
  const val = (ev.target as HTMLSelectElement).value
  const lvl =
    val === 'global_admin' || val === 'scheduler' || val === 'none' ? val : null
  const e = await sched.setAccess(userId, lvl)
  if (e) {
    err.value = e
    return
  }
  if (lvl) access.value.set(userId, lvl)
  else access.value.delete(userId)
  access.value = new Map(access.value)
}

// ── member detail ────────────────────────────────────────────────────

const openId = ref<string | null>(null)
const detail = ref<MemberSettings | null>(null)
const detailBusy = ref(false)
const detailSaved = ref(false)

/** Positions a member can be qualified for; keys match seat qual rules. */
const POSITIONS: { key: string; label: string }[] = [
  { key: 'p2', label: 'Paramedic (in charge)' },
  { key: 'aemt_or_higher', label: 'AIC / Medic (AEMT or higher)' },
  { key: 'any_field', label: 'Attendant' },
  { key: 'supervisor', label: 'Supervisor' },
]

async function toggleMember(p: SchedPerson) {
  err.value = null
  detailSaved.value = false
  if (openId.value === p.id) {
    openId.value = null
    detail.value = null
    return
  }
  openId.value = p.id
  detail.value = null
  detail.value = await sched.fetchMemberSettings(p.id)
}

function qualState(key: string): string {
  return detail.value?.qualOverrides[key] ?? ''
}

function setQual(key: string, ev: Event) {
  if (!detail.value) return
  const val = (ev.target as HTMLSelectElement).value
  if (val === 'allow' || val === 'deny') detail.value.qualOverrides[key] = val
  else delete detail.value.qualOverrides[key]
}

function unitExcluded(unitId: string): boolean {
  return detail.value?.unitExclusions.includes(unitId) ?? false
}

function toggleUnitExclusion(unitId: string) {
  if (!detail.value) return
  const i = detail.value.unitExclusions.indexOf(unitId)
  if (i >= 0) detail.value.unitExclusions.splice(i, 1)
  else detail.value.unitExclusions.push(unitId)
}

async function saveDetail() {
  if (!detail.value) return
  detailBusy.value = true
  err.value = null
  const e = await sched.saveMemberSettings(detail.value)
  detailBusy.value = false
  if (e) {
    err.value = e
    return
  }
  detailSaved.value = true
}

async function changeCredential(userId: string, ev: Event) {
  err.value = null
  const val = (ev.target as HTMLSelectElement).value
  const e = await sched.setCredential(userId, val || null)
  if (e) err.value = e
}

/** One-line provenance under the credential select. */
function credSourceLine(p: SchedPerson): string {
  switch (p.credentialSource) {
    case 'manual':
      return `Manual override — auto would be ${p.credentialAuto ?? 'none'} (choose Auto to track the clinical pipeline)`
    case 'pipeline':
      return 'Auto — tracks the clinical pipeline'
    case 'role':
      return 'Auto — from portal role'
    case 'title':
      return 'Auto — from title (not in the clinical pipeline)'
    default:
      return 'No credential — set one, or enroll them in the clinical pipeline'
  }
}
</script>

<template>
  <div class="mem">
    <div class="mem__toolbar">
      <input
        v-model="search"
        type="search"
        class="mem__search"
        placeholder="Search members"
        aria-label="Search members"
      />
      <p class="mem__count">{{ filtered.length }} of {{ sched.people.value.length }}</p>
    </div>

    <p v-if="err" class="mem__error">{{ err }}</p>

    <div v-if="accessLoaded" class="mem__list">
      <template v-for="p in filtered" :key="p.id">
        <button class="mem__row" @click="toggleMember(p)">
          <div class="mem__who">
            <p class="mem__name">
              {{ p.fullName }}<span v-if="p.credential" class="mem__cred"> - {{ p.credential }}</span>
            </p>
            <p class="mem__hint">{{ p.title ?? '' }}</p>
          </div>
          <span
            class="mem__chip"
            :class="{ 'mem__chip--none': effectiveLevel(p) === 'none' }"
          >{{ LEVEL_LABELS[effectiveLevel(p)] }}</span>
          <svg class="mem__chev" :class="{ 'mem__chev--open': openId === p.id }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>

        <div v-if="openId === p.id" class="mem__detail">
          <div class="mem__detail-grid">
            <section class="mem__block">
              <h3 class="mem__block-h">Information</h3>
              <dl class="mem__dl">
                <div><dt>Credential</dt>
                  <dd>
                    <select
                      v-if="sched.canEdit.value"
                      class="mem__select"
                      :value="p.credentialSource === 'manual' ? (p.credential ?? '') : ''"
                      @change="changeCredential(p.id, $event)"
                    >
                      <option value="">Auto{{ p.credentialAuto ? ' (' + p.credentialAuto + ')' : '' }}</option>
                      <option v-for="c in INTERNAL_CREDENTIALS" :key="c" :value="c">{{ c }}</option>
                    </select>
                    <template v-else>{{ p.credential ?? '—' }}</template>
                    <p class="mem__cred-src">{{ credSourceLine(p) }}</p>
                  </dd>
                </div>
                <div><dt>Title</dt><dd>{{ p.title ?? '—' }}</dd></div>
                <div><dt>Phone</dt><dd>{{ p.phone ?? '—' }}</dd></div>
                <div><dt>Email</dt><dd class="mem__email">{{ p.email ?? '—' }}</dd></div>
                <div v-if="detail"><dt>Text messages</dt>
                  <dd>
                    <label class="mem__check">
                      <input v-model="detail.smsOptIn" type="checkbox" :disabled="!sched.canEdit.value && p.id !== sched.myUserId.value" />
                      Opted in to text notifications
                    </label>
                  </dd>
                </div>
              </dl>
            </section>

            <section class="mem__block">
              <h3 class="mem__block-h">Position qualifications</h3>
              <p class="mem__note-sm">Default comes from the clinical pipeline; set an override here.</p>
              <div v-if="detail" class="mem__quals">
                <div v-for="pos in POSITIONS" :key="pos.key" class="mem__qualrow">
                  <span>{{ pos.label }}</span>
                  <select
                    class="mem__select"
                    :value="qualState(pos.key)"
                    :disabled="!sched.canEdit.value"
                    @change="setQual(pos.key, $event)"
                  >
                    <option value="">Default</option>
                    <option value="allow">Qualified</option>
                    <option value="deny">Excluded</option>
                  </select>
                </div>
              </div>
              <p v-else class="mem__note-sm">Loading…</p>
            </section>

            <section class="mem__block">
              <h3 class="mem__block-h">Unit / station exclusions</h3>
              <p class="mem__note-sm">Checked units are ones this member never works.</p>
              <div v-if="detail" class="mem__units">
                <label v-for="u in sched.units.value" :key="u.id" class="mem__check">
                  <input
                    type="checkbox"
                    :checked="unitExcluded(u.id)"
                    :disabled="!sched.canEdit.value"
                    @change="toggleUnitExclusion(u.id)"
                  />
                  {{ u.code }}
                </label>
              </div>
            </section>
          </div>

          <div class="mem__detail-foot">
            <span v-if="detailSaved" class="mem__saved">Saved.</span>
            <select
              v-if="sched.isGlobalAdmin.value"
              class="mem__select"
              :value="access.get(p.id) ?? ''"
              aria-label="Access level"
              @change="changeAccess(p.id, $event)"
            >
              <option value="">Access: default ({{ LEVEL_LABELS[defaultLevel(p)] }})</option>
              <option value="scheduler">Access: Scheduler</option>
              <option value="global_admin">Access: Global admin</option>
              <option value="none">Access: No access</option>
            </select>
            <button
              v-if="sched.canEdit.value || p.id === sched.myUserId.value"
              class="mem__save"
              :disabled="detailBusy || !detail"
              @click="saveDetail"
            >
              {{ detailBusy ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <p class="mem__note">
      Per-member notification matrix (which message types go to push / email / text) is coming
      to this screen with the notifications build.
    </p>
  </div>
</template>

<style scoped>
.mem__toolbar {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.8rem;
}

.mem__search {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  width: min(280px, 100%);
}

.mem__count {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin: 0;
}

.mem__error {
  color: var(--color-danger-500);
  font-size: 0.85rem;
}

.mem__list {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  overflow: hidden;
}

.mem__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  width: 100%;
  padding: 0.55rem 0.9rem;
  border: 0;
  border-bottom: 1px solid var(--color-line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mem__row:hover {
  background: var(--color-surface-soft);
}

.mem__who {
  min-width: 0;
  flex: 1;
}

.mem__name {
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--color-ink);
  margin: 0;
}

.mem__cred {
  color: var(--color-muted);
  font-weight: 400;
  font-size: 0.85rem;
}

.mem__hint {
  font-size: 0.74rem;
  color: var(--color-muted);
  margin: 0.05rem 0 0;
}

.mem__chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 9px;
  background: var(--color-surface);
  white-space: nowrap;
}

.mem__chip--none {
  color: var(--color-danger-500);
  border-color: oklch(0.85 0.06 20);
}

.mem__chev {
  width: 15px;
  height: 15px;
  color: var(--color-muted);
  flex: none;
  transition: transform 140ms var(--ease-out);
}

.mem__chev--open {
  transform: rotate(180deg);
}

.mem__detail {
  border-bottom: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  padding: 0.8rem 0.9rem;
}

.mem__detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.9rem;
}

.mem__block-h {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.4rem;
}

.mem__dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mem__dl > div {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.mem__dl dt {
  font-size: 0.74rem;
  color: var(--color-muted);
  width: 92px;
  flex: none;
}

.mem__dl dd {
  font-size: 0.85rem;
  color: var(--color-ink);
  margin: 0;
  min-width: 0;
}

.mem__email {
  overflow-wrap: anywhere;
}

.mem__select {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
}

.mem__quals {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.mem__qualrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.84rem;
  color: var(--color-ink);
}

.mem__units {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
  gap: 0.25rem;
}

.mem__check {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: var(--color-ink-soft);
}

.mem__note-sm {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 0 0 0.4rem;
}

.mem__detail-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.8rem;
  flex-wrap: wrap;
}

.mem__saved {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-success-500);
}

.mem__save {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.32rem 0.9rem;
  border: 0;
  border-radius: 7px;
  background: var(--color-brand-700);
  color: white;
  cursor: pointer;
  margin-left: auto;
}

.mem__note {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin-top: 0.8rem;
}

.mem__cred-src {
  font-size: 0.72rem;
  color: var(--color-muted);
  margin: 0.25rem 0 0;
  max-width: 260px;
  line-height: 1.35;
}
</style>
