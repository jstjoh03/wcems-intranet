<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSchedule } from '@/composables/useSchedule'

/**
 * Members — scheduler-side roster management. Access levels live here
 * (not on Setup): Global admin / Scheduler / Supervisor (derived from
 * portal role) / Member / No access. "No access" is for people on the
 * roster who should never see the schedule (medical director, board).
 * Qualifications and notification preferences land here next.
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

const LEVEL_HINTS: Record<string, string> = {
  global_admin: 'Full control: schedule, members, settings, approvals',
  scheduler: 'Edits the schedule, students, and events',
  supervisor: 'Views everything and can send page-outs',
  member: 'Views the schedule; manages own requests and settings',
  none: 'Cannot open the schedule at all',
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
      <div v-for="p in filtered" :key="p.id" class="mem__row">
        <div class="mem__who">
          <p class="mem__name">
            {{ p.fullName }}<span v-if="p.credential" class="mem__cred">, {{ p.credential }}</span>
          </p>
          <p class="mem__hint">{{ LEVEL_HINTS[effectiveLevel(p)] }}</p>
        </div>
        <div class="mem__level">
          <span
            class="mem__chip"
            :class="{ 'mem__chip--none': effectiveLevel(p) === 'none' }"
          >{{ LEVEL_LABELS[effectiveLevel(p)] }}</span>
          <select
            v-if="sched.isGlobalAdmin.value"
            class="mem__select"
            :value="access.get(p.id) ?? ''"
            aria-label="Access level"
            @change="changeAccess(p.id, $event)"
          >
            <option value="">Default ({{ LEVEL_LABELS[defaultLevel(p)] }})</option>
            <option value="scheduler">Scheduler</option>
            <option value="global_admin">Global admin</option>
            <option value="none">No access</option>
          </select>
        </div>
      </div>
    </div>

    <p class="mem__note">
      Qualifications (which seats each member can fill, tracked from the clinical pipeline)
      and per-member notification settings are coming to this screen next.
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
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid var(--color-line-soft);
}

.mem__row:last-child {
  border-bottom: 0;
}

.mem__who {
  min-width: 0;
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

.mem__level {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
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

.mem__select {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
}

.mem__note {
  font-size: 0.78rem;
  color: var(--color-muted);
  margin-top: 0.8rem;
}

@media (max-width: 560px) {
  .mem__row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
}
</style>
