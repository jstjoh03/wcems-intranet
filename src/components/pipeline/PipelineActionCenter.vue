<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ClipboardList } from 'lucide-vue-next'
import type { PipelinePerson, RequirementCycle } from '@/types'
import {
  activeTransitionFor,
  jurisprudenceDue,
  openGapCount,
  requirementStatus,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'

/**
 * The CDO's to-do panel: everything that needs scheduling, reassigning,
 * or follow-up, computed live from the pipeline — LMS reassignments
 * (jurisprudence + per-cycle items), expiring licenses and card
 * classes, overdue phase targets, and people ready to advance. Each
 * item names the person and the action so the day starts here instead
 * of in six systems. Also hosts the requirement-catalog manager.
 */

const props = defineProps<{
  people: PipelinePerson[]
}>()

const emit = defineEmits<{
  (e: 'open', person: PipelinePerson): void
}>()

const {
  canEdit,
  gatesFor,
  requirements,
  completionsFor,
  addRequirement,
  setRequirementActive,
} = usePipeline()

const today = new Date()
const day = 86_400_000

function licDays(p: PipelinePerson): number | null {
  const exp = p.record.txLicenseExpiresAt
  if (!exp) return null
  return Math.ceil((new Date(`${exp}T00:00:00`).getTime() - today.getTime()) / day)
}

interface ActionItem {
  person: PipelinePerson
  detail: string
  severity: 'due' | 'warn' | 'info'
}

interface ActionGroup {
  key: string
  title: string
  hint: string
  items: ActionItem[]
}

const groups = computed<ActionGroup[]>(() => {
  const active = props.people.filter((p) => !p.record.pending)

  const juris: ActionItem[] = active
    .filter((p) => jurisprudenceDue(p.record))
    .map((p) => ({ person: p, detail: 'TX jurisprudence not on file for this cycle', severity: 'due' as const }))

  /* Requirement engine: annual + per-cycle items → the LMS bucket;
     card classes (certification) → the cards bucket. Items with NO
     completion on file stay quiet until data lands (Paycom import /
     first LMS entries) — flagging all ~75 people at once is noise. */
  const lmsItems: ActionItem[] = []
  const cardItems: ActionItem[] = []
  for (const req of requirements.value.filter((r) => r.active)) {
    const bucket = req.cycle === 'certification' ? cardItems : lmsItems
    for (const p of active) {
      const st = requirementStatus(req, completionsFor(p.userId), p.record, today)
      if (!st.latest) continue
      if (st.state === 'due') {
        bucket.push({ person: p, detail: `${req.name} — expired/due`, severity: 'due' })
      } else if (st.state === 'expiring') {
        bucket.push({ person: p, detail: `${req.name} — expires ${st.dueAt}`, severity: 'warn' })
      }
    }
  }

  const lic: ActionItem[] = active
    .map((p) => ({ p, d: licDays(p) }))
    .filter((x): x is { p: PipelinePerson; d: number } => x.d !== null && x.d <= 90)
    .sort((a, b) => a.d - b.d)
    .map(({ p, d }) => ({
      person: p,
      detail: d < 0 ? `TX license EXPIRED ${-d}d ago` : `TX license expires in ${d}d`,
      severity: d < 0 ? ('due' as const) : ('warn' as const),
    }))

  const overdue: ActionItem[] = active
    .filter((p) => {
      const t = p.record.workingTargetAt
      return p.record.workingPhase && t && new Date(`${t}T00:00:00`).getTime() < today.getTime()
    })
    .map((p) => ({
      person: p,
      detail: `Phase target ${p.record.workingTargetAt} passed — follow up`,
      severity: 'warn' as const,
    }))

  const ready: ActionItem[] = active
    .filter((p) => activeTransitionFor(p.record) && openGapCount(p.record, gatesFor(p.record.id)) === 0)
    .map((p) => ({ person: p, detail: 'All gates complete — schedule board / advancement', severity: 'info' as const }))

  return [
    { key: 'lms', title: 'Reassign in LMS', hint: 'jurisprudence & recurring trainings', items: [...juris, ...lmsItems] },
    { key: 'cards', title: 'Card classes', hint: 'expiring or lapsed', items: cardItems },
    { key: 'lic', title: 'Licenses', hint: '≤ 90 days or expired', items: lic },
    { key: 'follow', title: 'Follow-ups', hint: 'phase targets passed', items: overdue },
    { key: 'ready', title: 'Ready to advance', hint: 'schedule boards', items: ready },
  ].filter((g) => g.items.length > 0)
})

const totalCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

const collapsed = ref(false)
const expandedGroups = reactive<Record<string, boolean>>({})
const VISIBLE = 6

/* ── Requirement catalog manager ───────────────────────────────────── */

const showManage = ref(false)
const newReq = reactive({ name: '', cycle: 'annual' as RequirementCycle, busy: false })

async function submitRequirement() {
  if (!newReq.name.trim()) return
  newReq.busy = true
  try {
    await addRequirement(newReq.name.trim(), newReq.cycle)
    newReq.name = ''
  } finally {
    newReq.busy = false
  }
}
</script>

<template>
  <section class="ac">
    <div class="ac__head" role="button" tabindex="0" @click="collapsed = !collapsed" @keydown.enter="collapsed = !collapsed">
      <ClipboardList :size="17" :stroke-width="2" class="ac__icon" />
      <span class="ac__title">Action Center</span>
      <span class="ac__count" :class="{ 'ac__count--zero': totalCount === 0 }">{{ totalCount }}</span>
      <span class="ac__spacer"></span>
      <button
        v-if="canEdit && !collapsed"
        type="button"
        class="ac__manage"
        @click.stop="showManage = !showManage"
      >{{ showManage ? 'Done' : 'Manage tracked items' }}</button>
      <span class="ac__chev">{{ collapsed ? '▸' : '▾' }}</span>
    </div>

    <div v-if="!collapsed" class="ac__body">
      <!-- Requirement catalog manager -->
      <div v-if="showManage && canEdit" class="ac__catalog">
        <div v-for="req in requirements" :key="req.id" class="ac__cat-row" :class="{ 'ac__cat-row--off': !req.active }">
          <span class="ac__cat-name">{{ req.name }}</span>
          <span class="ac__cat-cycle">{{ { annual: 'annual', per_cert_cycle: 'per cycle', certification: 'card', one_time: 'one-time' }[req.cycle] }}</span>
          <button type="button" class="ac__cat-toggle" @click="setRequirementActive(req.id, !req.active)">
            {{ req.active ? 'Archive' : 'Restore' }}
          </button>
        </div>
        <div class="ac__cat-add">
          <input v-model="newReq.name" type="text" placeholder="New tracked item (e.g. Active Shooter)" @keydown.enter="submitRequirement" />
          <select v-model="newReq.cycle">
            <option value="annual">Annual</option>
            <option value="per_cert_cycle">Per licensure cycle</option>
            <option value="certification">Card (own expiry)</option>
            <option value="one_time">One-time</option>
          </select>
          <button type="button" class="btn" :disabled="newReq.busy || !newReq.name.trim()" @click="submitRequirement">Add</button>
        </div>
      </div>

      <p v-if="totalCount === 0" class="ac__empty">Nothing needs your attention — all caught up.</p>

      <div v-else class="ac__groups">
        <div v-for="g in groups" :key="g.key" class="ac__group">
          <h4 class="ac__g-title">{{ g.title }} <span class="ac__g-n">{{ g.items.length }}</span> <span class="ac__g-hint">{{ g.hint }}</span></h4>
          <ul class="ac__list">
            <li
              v-for="(item, idx) in expandedGroups[g.key] ? g.items : g.items.slice(0, VISIBLE)"
              :key="`${g.key}-${item.person.userId}-${idx}`"
            >
              <button type="button" class="ac__item" @click="emit('open', item.person)">
                <span class="ac__dot" :class="`ac__dot--${item.severity}`"></span>
                <span class="ac__who">{{ item.person.fullName }}</span>
                <span class="ac__what">{{ item.detail }}</span>
              </button>
            </li>
          </ul>
          <button
            v-if="g.items.length > VISIBLE"
            type="button"
            class="ac__more"
            @click="expandedGroups[g.key] = !expandedGroups[g.key]"
          >
            {{ expandedGroups[g.key] ? 'Show less' : `+ ${g.items.length - VISIBLE} more` }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ac {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.ac__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 13px 18px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}
.ac__icon {
  color: var(--color-accent-700);
}
.ac__title {
  font-family: var(--font-display);
  font-size: 17px;
  color: var(--color-brand-800);
}
.ac__count {
  font-size: 11px;
  font-weight: 700;
  min-width: 22px;
  text-align: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.ac__count--zero {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.ac__spacer {
  flex: 1;
}
.ac__manage {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
}
.ac__manage:hover {
  text-decoration: underline;
}
.ac__chev {
  font-size: 11px;
  color: var(--color-muted-soft);
}
.ac__body {
  padding: 0 18px 16px;
}
.ac__empty {
  font-size: 12.5px;
  color: var(--color-success-500);
  padding: 4px 0 2px;
}
.ac__groups {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 1000px) {
  .ac__groups {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }
}
.ac__g-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 4px;
}
.ac__g-n {
  color: var(--color-accent-700);
}
.ac__g-hint {
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-muted-soft);
  margin-left: 4px;
}
.ac__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ac__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}
.ac__item:hover {
  background: var(--color-surface-soft);
}
.ac__dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  align-self: center;
}
.ac__dot--due { background: var(--color-danger-500); }
.ac__dot--warn { background: oklch(0.68 0.14 75); }
.ac__dot--info { background: var(--color-success-500); }
.ac__who {
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
}
.ac__what {
  color: var(--color-muted);
  min-width: 0;
}
.ac__more {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
}
.ac__catalog {
  border: 1px solid var(--color-line-soft);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  background: var(--color-surface-soft);
}
.ac__cat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 12.5px;
  border-bottom: 1px solid var(--color-line-soft);
}
.ac__cat-row--off .ac__cat-name {
  color: var(--color-muted-soft);
  text-decoration: line-through;
}
.ac__cat-name {
  flex: 1;
  color: var(--color-ink);
}
.ac__cat-cycle {
  font-size: 10.5px;
  color: var(--color-muted-soft);
}
.ac__cat-toggle {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-brand-600);
  background: none;
  border: none;
  cursor: pointer;
}
.ac__cat-add {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.ac__cat-add input {
  flex: 1;
  font-size: 12.5px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.ac__cat-add select {
  font-size: 12.5px;
  padding: 6px 9px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink);
}
</style>
