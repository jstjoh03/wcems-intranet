<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, ArrowRight, FileText, Paperclip, Plus, ShieldAlert } from 'lucide-vue-next'
import { usePips, type Pip, type PipEntryKind, type PipSections } from '@/composables/usePips'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

/**
 * The compact PIP surface. Building and running a plan moved to the
 * dedicated page (/clinical/pip/:userId) — this panel is what embeds
 * elsewhere:
 *   mode 'manage' — a summary card on the employee file / supervisor's
 *     Clinical Development view, linking to the full plan page.
 *   mode 'self'   — the member's own read-only rendering of their plan
 *     on /clinical-development (they don't get the /clinical/* app).
 * RLS already decided whether any of this data exists for the viewer.
 */

const props = defineProps<{
  personId: string
  personName?: string
  mode: 'manage' | 'self'
}>()

const auth = useAuthStore()
const pips = usePips()

const active = computed<Pip | null>(() => pips.activeFor(props.personId))
const past = computed(() => pips.listFor(props.personId).filter((p) => p.status !== 'active'))
const isAdmin = computed(() => pips.isAdmin.value)
const nextTarget = computed(() => (active.value ? pips.nextTargetFor(active.value.id) : null))

/* ── name resolution (app_users is viewer-readable) ────────────────── */
interface Person { id: string; name: string }
const people = ref<Person[]>([])
const nameById = computed(() => new Map(people.value.map((p) => [p.id, p.name])))
function nameOf(id: string | null): string {
  return id ? (nameById.value.get(id) ?? '—') : '—'
}
onMounted(async () => {
  if (auth.usingDevStub) return
  const { data } = await supabase
    .from('app_users')
    .select('id, full_name')
    .eq('active', true)
    .eq('account_type', 'person')
    .order('full_name')
  people.value = (data ?? []).map((r) => ({ id: r.id as string, name: (r.full_name as string) ?? '—' }))
})

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function daysLeft(p: Pip): number {
  return Math.ceil((Date.parse(`${p.endsOn}T00:00:00`) - Date.now()) / 86_400_000)
}
const KIND_LABELS: Record<PipEntryKind, string> = { training: 'Training', meeting: 'Meeting', note: 'Note' }

/** "Category: description" lines → bullets with a bold lead. */
function bullets(text: string | null): Array<{ label: string; rest: string }> {
  return (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-•*\d.\s]+/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':')
      return i > 0 && i < 60 ? { label: l.slice(0, i).trim(), rest: l.slice(i + 1).trim() } : { label: '', rest: l }
    })
}
function sectionText(p: Pip, key: keyof PipSections): string | null {
  return p[key]
}
const SECTIONS: Array<{ key: keyof PipSections; title: string; numbered?: boolean; plain?: boolean }> = [
  { key: 'summary', title: 'Purpose', plain: true },
  { key: 'areasOfConcern', title: 'Areas of concern' },
  { key: 'goals', title: 'Improvement goals', numbered: true },
  { key: 'expectations', title: 'Expectations', numbered: true },
  { key: 'requirements', title: 'Requirements & cadence' },
  { key: 'successCriteria', title: 'What success looks like' },
  { key: 'consequences', title: 'Timeline & consequences', plain: true },
]

async function openDoc(path: string) {
  const url = await pips.documentUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <section class="pip">
    <div class="pip__title">
      <ShieldAlert :size="15" :stroke-width="2" />
      <span>Performance improvement plan</span>
      <span class="pip__restricted">restricted — PIP access, the employee &amp; their supervisor</span>
    </div>

    <!-- ══ manage: compact card linking to the full page ══ -->
    <template v-if="mode === 'manage'">
      <div v-if="active" class="pip__card">
        <div class="pip__cardhead">
          <div class="pip__window">
            <b>{{ fmt(active.startsOn) }} → {{ fmt(active.endsOn) }}</b>
            <span v-if="active.lengthDays" class="pip__lenchip">{{ active.lengthDays }}-day</span>
            <span v-if="daysLeft(active) >= 0" class="pip__days">{{ daysLeft(active) }} days remaining</span>
            <span v-else class="pip__days pip__days--over">ended {{ -daysLeft(active) }} days ago — close it out</span>
          </div>
          <div class="pip__pills">
            <span class="pip__pill pip__pill--active"><i></i>Active</span>
            <span v-if="active.ftepHold" class="pip__pill pip__pill--hold"><AlertTriangle :size="11" :stroke-width="2.4" />FTEP on hold</span>
          </div>
        </div>
        <div class="pip__meta">
          Supervisor: <b>{{ nameOf(active.supervisorUserId) }}</b>
          <template v-if="nextTarget"> · Next checkpoint: <b>{{ nextTarget.title }}</b> on {{ fmt(nextTarget.dueOn) }}</template>
          <template v-else> · No pending checkpoints</template>
        </div>
        <RouterLink class="pip__open" :to="`/clinical/pip/${personId}`">
          Open the full plan — sections, checkpoints, log &amp; documents <ArrowRight :size="13" />
        </RouterLink>
      </div>

      <RouterLink v-else-if="isAdmin" class="pip__btn" :to="`/clinical/pip/${personId}`">
        <Plus :size="14" /> Start a performance improvement plan
      </RouterLink>

      <details v-if="past.length" class="pip__past">
        <summary>Past plans ({{ past.length }})</summary>
        <div v-for="p in past" :key="p.id" class="pip__row">
          <span class="pip__due">{{ fmt(p.startsOn) }} → {{ fmt(p.endsOn) }}</span>
          <span class="pip__pill" :class="p.status === 'completed' ? 'pip__pill--met' : 'pip__pill--missed'"><i></i>{{ p.status }}</span>
          <div class="pip__rowmain">{{ p.outcomeNote || p.summary }}</div>
        </div>
      </details>
    </template>

    <!-- ══ self: the member's read-only view of their own plan ══ -->
    <template v-else>
      <template v-if="active">
        <div class="pip__card">
          <div class="pip__cardhead">
            <div class="pip__window">
              <b>{{ fmt(active.startsOn) }} → {{ fmt(active.endsOn) }}</b>
              <span v-if="active.lengthDays" class="pip__lenchip">{{ active.lengthDays }}-day</span>
              <span v-if="daysLeft(active) >= 0" class="pip__days">{{ daysLeft(active) }} days remaining</span>
            </div>
            <div class="pip__pills">
              <span class="pip__pill pip__pill--active"><i></i>Active</span>
              <span v-if="active.ftepHold" class="pip__pill pip__pill--hold"><AlertTriangle :size="11" :stroke-width="2.4" />FTEP on hold</span>
            </div>
          </div>
          <div class="pip__meta">Supervisor: <b>{{ nameOf(active.supervisorUserId) }}</b></div>
        </div>

        <template v-for="s in SECTIONS" :key="s.key">
          <template v-if="sectionText(active, s.key)">
            <div class="pip__sub">{{ s.title }}</div>
            <component :is="s.numbered ? 'ol' : 'ul'" class="pip__list" :class="{ 'pip__list--plain': s.plain }">
              <li v-for="(b, i) in bullets(sectionText(active, s.key))" :key="i">
                <b v-if="b.label">{{ b.label }}:</b> {{ b.rest }}
              </li>
            </component>
          </template>
        </template>

        <div class="pip__sub">Progress checkpoints</div>
        <div v-for="t in pips.targetsFor(active.id)" :key="t.id" class="pip__row">
          <span class="pip__due">{{ fmt(t.dueOn) }}</span>
          <div class="pip__rowmain">
            <b>{{ t.title }}</b>
            <span v-if="t.detail" class="pip__detail">{{ t.detail }}</span>
            <span v-if="t.note" class="pip__detail">— {{ t.note }}</span>
          </div>
          <span class="pip__pill" :class="t.status === 'met' ? 'pip__pill--met' : t.status === 'missed' ? 'pip__pill--missed' : 'pip__pill--pending'"><i></i>{{ t.status }}</span>
        </div>
        <p v-if="pips.targetsFor(active.id).length === 0" class="pip__quiet">No checkpoint dates yet.</p>

        <div class="pip__sub">Progress &amp; training log</div>
        <div v-for="e in pips.entriesFor(active.id)" :key="e.id" class="pip__row">
          <span class="pip__due">{{ fmt(e.entryOn) }}</span>
          <span class="pip__pill pip__pill--kind"><i></i>{{ KIND_LABELS[e.kind] }}</span>
          <div class="pip__rowmain">{{ e.body }} <span class="pip__detail">— {{ nameOf(e.createdBy) }}</span></div>
        </div>
        <p v-if="pips.entriesFor(active.id).length === 0" class="pip__quiet">Nothing logged yet.</p>

        <template v-if="pips.documentsFor(active.id).length">
          <div class="pip__sub">Documents</div>
          <div v-for="d in pips.documentsFor(active.id)" :key="d.id" class="pip__row">
            <FileText :size="14" :stroke-width="1.9" style="color: var(--color-brand-600)" />
            <button type="button" class="pip__lnk pip__rowmain" style="text-align: left" @click="openDoc(d.storagePath)">{{ d.name }}</button>
          </div>
        </template>

        <p class="pip__hint" style="margin-top: 10px">
          <Paperclip :size="11" /> Questions about this plan go to {{ nameOf(active.supervisorUserId) }} or the Clinical Development Officer.
        </p>
      </template>

      <details v-if="past.length" class="pip__past">
        <summary>Past plans ({{ past.length }})</summary>
        <div v-for="p in past" :key="p.id" class="pip__row">
          <span class="pip__due">{{ fmt(p.startsOn) }} → {{ fmt(p.endsOn) }}</span>
          <span class="pip__pill" :class="p.status === 'completed' ? 'pip__pill--met' : 'pip__pill--missed'"><i></i>{{ p.status }}</span>
          <div class="pip__rowmain">{{ p.outcomeNote || p.summary }}</div>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.pip { margin-top: 18px; }
.pip__title {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
  color: var(--color-danger-600, oklch(0.5 0.19 27));
  padding-bottom: 6px; border-bottom: 1px solid var(--color-line);
  margin-bottom: 10px;
}
.pip__restricted { font-size: 10.5px; font-weight: 500; letter-spacing: 0.02em; text-transform: none; color: var(--color-muted); }

.pip__card { border: 1px solid var(--color-line); border-left: 3px solid var(--color-danger-600, oklch(0.5 0.19 27)); border-radius: 6px; background: var(--color-surface); padding: 10px 12px; }
.pip__cardhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.pip__window { font-size: 13.5px; }
.pip__lenchip { margin-left: 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; color: var(--color-brand-700); border: 1px solid var(--color-line); border-radius: 4px; padding: 1px 5px; }
.pip__days { margin-left: 8px; font-size: 11.5px; color: var(--color-muted); }
.pip__days--over { color: var(--color-danger-600, oklch(0.5 0.19 27)); font-weight: 600; }
.pip__pills { display: flex; gap: 6px; }
.pip__pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid var(--color-line); border-radius: 4px; padding: 2px 7px; color: var(--color-ink-soft); background: var(--color-canvas); }
.pip__pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--color-muted); }
.pip__pill--active i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pip__pill--hold { color: oklch(0.45 0.12 70); border-color: oklch(0.82 0.08 80); }
.pip__pill--met i { background: var(--color-success-500, oklch(0.6 0.13 150)); }
.pip__pill--missed i { background: var(--color-danger-600, oklch(0.5 0.19 27)); }
.pip__pill--pending i { background: oklch(0.72 0.12 80); }
.pip__pill--kind i { background: var(--color-brand-600); }
.pip__meta { font-size: 12px; color: var(--color-ink-soft); margin-top: 6px; }
.pip__open { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--color-brand-700); margin-top: 9px; text-decoration: none; border: 1px solid var(--color-line); border-radius: 5px; padding: 5px 11px; }
.pip__open:hover { border-color: var(--color-brand-600); }

.pip__btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border: 0; border-radius: 6px; background: linear-gradient(180deg, var(--color-brand-600), var(--color-brand-800)); color: #fff; cursor: pointer; text-decoration: none; }

.pip__sub { font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-muted); margin: 14px 0 6px; }
.pip__list { margin: 2px 0 2px 20px; display: flex; flex-direction: column; gap: 5px; font-size: 13.5px; line-height: 1.5; }
.pip__list--plain { list-style: none; margin-left: 2px; }
.pip__row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--color-line-soft, var(--color-line)); flex-wrap: wrap; }
.pip__due { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--color-ink); white-space: nowrap; }
.pip__rowmain { flex: 1; min-width: 180px; }
.pip__detail { color: var(--color-muted); font-size: 12px; }
.pip__quiet { font-size: 12px; color: var(--color-muted); padding: 2px 0 4px; }
.pip__lnk { font: inherit; font-size: inherit; color: var(--color-brand-700); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
.pip__hint { font-size: 11px; color: var(--color-muted); font-weight: 400; }
.pip__past { margin-top: 14px; font-size: 12.5px; }
.pip__past summary { cursor: pointer; color: var(--color-muted); font-weight: 600; }
</style>
