<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { X, Trash2, Paperclip } from 'lucide-vue-next'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useClinicalEvents } from '@/composables/useClinicalEvents'
import { usePipeline } from '@/composables/usePipeline'
import { requirementStatus } from '@/constants/pipelineGates'
import type { PipelinePerson, PipelineRequirement } from '@/types'

/**
 * The file's one edit surface — click any compliance row and record,
 * correct, or waive it right here (the approved mockup's Record
 * drawer). Expiry prefills from the renewal rule (2-year cards land
 * on month-end), a card PDF can ride along into Documents, waivers
 * demand a reason, and every save writes the activity timeline.
 */

export type DrawerTarget =
  | { kind: 'requirement'; req: PipelineRequirement }
  | { kind: 'license' }
  | { kind: 'jurisprudence' }
  | { kind: 'bbp' }

const props = defineProps<{ person: PipelinePerson; target: DrawerTarget }>()
const emit = defineEmits<{ close: [] }>()

const { completionsFor, addCompletion, removeCompletion } = useClinical()
const pipeline = usePipeline()
const clindocs = useClinicalDocs()
const events = useClinicalEvents()

const todayIso = new Date().toISOString().slice(0, 10)

const title = computed(() => {
  switch (props.target.kind) {
    case 'requirement': return props.target.req.name
    case 'license': return 'TX certification'
    case 'jurisprudence': return 'TX EMS Jurisprudence'
    case 'bbp': return 'Bloodborne / Airborne Pathogens'
  }
})

const req = computed(() => (props.target.kind === 'requirement' ? props.target.req : null))
const isCard = computed(() => req.value?.cycle === 'certification')

const history = computed(() =>
  req.value
    ? completionsFor(props.person.userId)
        .filter((c) => c.requirementId === req.value!.id)
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    : [],
)
const latest = computed(() =>
  req.value
    ? requirementStatus(req.value, completionsFor(props.person.userId), props.person.record).latest
    : null,
)

/* ── Mode ───────────────────────────────────────────────────────────── */
type Mode = 'record' | 'correct' | 'waive'
const mode = ref<Mode>('record')
const modes = computed<{ key: Mode; label: string }[]>(() => {
  if (!req.value) return [{ key: 'record', label: 'Record' }]
  return [
    { key: 'record', label: 'Record completion' },
    ...(latest.value ? [{ key: 'correct', label: 'Correct the latest' } as const] : []),
    { key: 'waive', label: 'Waive' },
  ]
})

/* ── Fields ─────────────────────────────────────────────────────────── */
const completedAt = ref(todayIso)
const expiresAt = ref('')
const source = ref('manual')
const note = ref('')
const licenseNumber = ref('')
const attach = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 2-year card → the end of the month two years out (AHA convention). */
function cardExpiry(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00`)
  d.setFullYear(d.getFullYear() + 2)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const mm = String(end.getMonth() + 1).padStart(2, '0')
  return `${end.getFullYear()}-${mm}-${String(end.getDate()).padStart(2, '0')}`
}
function onCompletedChange() {
  if (isCard.value && mode.value !== 'correct') expiresAt.value = cardExpiry(completedAt.value)
}

onMounted(() => {
  const r = props.person.record
  if (props.target.kind === 'license') {
    licenseNumber.value = r.txLicenseNumber ?? ''
    completedAt.value = ''
    expiresAt.value = r.txLicenseExpiresAt ?? ''
  } else if (props.target.kind === 'jurisprudence') {
    completedAt.value = r.txJurisprudenceAt ?? todayIso
  } else if (props.target.kind === 'bbp') {
    completedAt.value = r.bloodbornePathogenAt ?? todayIso
  } else if (isCard.value) {
    expiresAt.value = cardExpiry(todayIso)
  }
})

function setMode(m: Mode) {
  mode.value = m
  if (m === 'correct' && latest.value) {
    completedAt.value = latest.value.completedAt
    expiresAt.value = latest.value.expiresAt ?? ''
    source.value = latest.value.source
    note.value = latest.value.note ?? ''
  } else if (m === 'record') {
    completedAt.value = todayIso
    expiresAt.value = isCard.value ? cardExpiry(todayIso) : ''
    source.value = 'manual'
    note.value = ''
  } else if (m === 'waive') {
    note.value = ''
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  attach.value = input.files?.[0] ?? null
  input.value = ''
}

/* ── Save ───────────────────────────────────────────────────────────── */
const busy = ref(false)
const error = ref<string | null>(null)

const canSave = computed(() => {
  if (props.target.kind === 'license') return !!(licenseNumber.value.trim() || expiresAt.value)
  if (props.target.kind !== 'requirement') return !!completedAt.value
  if (mode.value === 'waive') return note.value.trim().length > 0
  return !!completedAt.value
})

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function save() {
  if (busy.value || !canSave.value) return
  busy.value = true
  error.value = null
  try {
    const p = props.person
    if (props.target.kind === 'license') {
      await pipeline.saveRecord({
        userId: p.userId,
        txLicenseNumber: licenseNumber.value.trim() || null,
        txLicenseExpiresAt: expiresAt.value || null,
      })
      await events.log(p.userId, 'record_updated', `TX certification updated — ${licenseNumber.value.trim() || 'no number'} · expires ${fmt(expiresAt.value || null)}`)
    } else if (props.target.kind === 'jurisprudence') {
      await pipeline.saveRecord({ userId: p.userId, txJurisprudenceAt: completedAt.value || null })
      await events.log(p.userId, 'requirement_recorded', `TX Jurisprudence recorded — ${fmt(completedAt.value)}`)
    } else if (props.target.kind === 'bbp') {
      await pipeline.saveRecord({ userId: p.userId, bloodbornePathogenAt: completedAt.value || null })
      await events.log(p.userId, 'requirement_recorded', `Bloodborne/Airborne Pathogens recorded — ${fmt(completedAt.value)}`)
    } else {
      const r = props.target.req
      if (mode.value === 'waive') {
        await addCompletion({
          requirementId: r.id,
          userId: p.userId,
          completedAt: todayIso,
          expiresAt: null,
          source: 'waived',
          note: note.value.trim(),
        })
        await events.log(p.userId, 'requirement_waived', `${r.name} waived — ${note.value.trim()}`)
      } else {
        if (mode.value === 'correct' && latest.value) await removeCompletion(latest.value.id)
        await addCompletion({
          requirementId: r.id,
          userId: p.userId,
          completedAt: completedAt.value,
          expiresAt: expiresAt.value || null,
          source: source.value,
          note: note.value.trim() || null,
        })
        await events.log(
          p.userId,
          'requirement_recorded',
          `${r.name} ${mode.value === 'correct' ? 'corrected' : 'recorded'} — ${fmt(completedAt.value)}${expiresAt.value ? ` · expires ${fmt(expiresAt.value)}` : ''}`,
        )
      }
      if (attach.value) {
        const up = await clindocs.upload({
          userId: p.userId,
          folder: 'certs',
          file: attach.value,
          employeeVisible: true,
          note: r.name,
        })
        if (!up.ok) error.value = `Saved, but the card upload failed: ${up.error}`
      }
    }
    if (!error.value) emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const removeArm = ref<string | null>(null)
async function removeEntry(id: string) {
  if (removeArm.value !== id) {
    removeArm.value = id
    setTimeout(() => { if (removeArm.value === id) removeArm.value = null }, 4000)
    return
  }
  removeArm.value = null
  await removeCompletion(id)
  await events.log(props.person.userId, 'requirement_removed', `${req.value?.name ?? 'Requirement'} entry removed`)
}
</script>

<template>
  <div class="rd__scrim" @click.self="emit('close')">
    <aside class="rd">
      <div class="rd__hd">
        <div>
          <div class="rd__t display">{{ title }}</div>
          <div class="rd__s">{{ person.fullName }} · {{ person.record.certLevel ?? '—' }}</div>
        </div>
        <button type="button" class="rd__x" @click="emit('close')"><X :size="17" :stroke-width="2" /></button>
      </div>

      <div class="rd__bd">
        <div v-if="modes.length > 1" class="rd__seg">
          <button
            v-for="m in modes"
            :key="m.key"
            type="button"
            :class="{ 'rd__seg-on': mode === m.key }"
            @click="setMode(m.key)"
          >{{ m.label }}</button>
        </div>

        <!-- License -->
        <template v-if="target.kind === 'license'">
          <label class="rd__fld">License number
            <input v-model="licenseNumber" type="text" maxlength="40" placeholder="e.g. 123456" />
          </label>
          <label class="rd__fld">Expires
            <input v-model="expiresAt" type="date" />
          </label>
        </template>

        <!-- Date-only record fields -->
        <template v-else-if="target.kind === 'jurisprudence' || target.kind === 'bbp'">
          <label class="rd__fld">Completed
            <input v-model="completedAt" type="date" />
          </label>
          <p class="rd__note">
            {{ target.kind === 'jurisprudence'
              ? 'Required once per certification cycle — the window opens six months before license expiry.'
              : 'Annual requirement — due again 365 days after this date.' }}
          </p>
        </template>

        <!-- Requirement -->
        <template v-else>
          <template v-if="mode === 'waive'">
            <label class="rd__fld">Reason — files on the record (required)
              <input v-model="note" type="text" maxlength="240" placeholder="e.g. equivalent military cert on file" />
            </label>
            <p class="rd__note">
              A waiver satisfies this requirement for {{ person.fullName.split(' ')[0] }} only and
              shows as “waived” wherever the item appears. The catalog rule is unchanged.
            </p>
          </template>
          <template v-else>
            <label class="rd__fld">Completed
              <input v-model="completedAt" type="date" @change="onCompletedChange" />
            </label>
            <label v-if="isCard" class="rd__fld">Expires
              <input v-model="expiresAt" type="date" />
            </label>
            <p v-if="isCard" class="rd__note">Prefilled from the renewal rule — 2-year card, end of month.</p>
            <label class="rd__fld">Source
              <select v-model="source">
                <option value="manual">Manual entry (audit-logged)</option>
                <option value="card_class">Card class</option>
                <option value="upload">Card upload</option>
                <option value="paycom">Paycom</option>
                <option value="lexipol">Lexipol</option>
              </select>
            </label>
            <label class="rd__fld">Note
              <input v-model="note" type="text" maxlength="240" placeholder="optional" />
            </label>
            <div class="rd__attach">
              <button type="button" class="rd__lnk" @click="fileInput?.click()">
                <Paperclip :size="13" :stroke-width="2" />
                {{ attach ? attach.name : 'Attach the card (PDF or photo) — files to Documents' }}
              </button>
              <button v-if="attach" type="button" class="rd__lnk rd__lnk--mut" @click="attach = null">remove</button>
              <input ref="fileInput" type="file" accept=".pdf,image/*" style="display: none" @change="onPick" />
            </div>
          </template>

          <template v-if="history.length">
            <div class="rd__sect">History</div>
            <div v-for="c in history" :key="c.id" class="rd__hist">
              <span class="rd__hist-d">{{ fmt(c.completedAt) }}<template v-if="c.expiresAt"> → {{ fmt(c.expiresAt) }}</template></span>
              <span class="rd__hist-s">{{ c.source }}<template v-if="c.note"> · {{ c.note }}</template></span>
              <button type="button" class="rd__trash" :title="removeArm === c.id ? 'Click again to confirm' : 'Remove this entry'" @click="removeEntry(c.id)">
                <Trash2 :size="12" :stroke-width="2" />{{ removeArm === c.id ? ' confirm?' : '' }}
              </button>
            </div>
          </template>
        </template>

        <div v-if="error" class="rd__error">{{ error }}</div>
      </div>

      <div class="rd__ft">
        <button type="button" class="rd__go" :disabled="busy || !canSave" @click="save">
          {{ busy ? 'Saving…' : mode === 'waive' ? 'Waive for this employee' : 'Save to the file' }}
        </button>
        <button type="button" class="rd__lnk rd__lnk--mut" @click="emit('close')">Cancel</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.rd__scrim {
  position: fixed; inset: 0; z-index: 90;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex; justify-content: flex-end;
}
.rd {
  width: min(440px, 96vw); height: 100%;
  background: var(--color-surface);
  box-shadow: -12px 0 40px oklch(0.2 0.05 260 / 0.25);
  display: flex; flex-direction: column;
}
.rd__hd {
  display: flex; align-items: flex-start; gap: 10px;
  background: linear-gradient(180deg, var(--color-brand-800), var(--color-brand-950));
  color: #fff; padding: 14px 18px;
  border-bottom: 2px solid var(--color-accent-600, oklch(0.664 0.119 86.8));
}
.rd__t { font-size: 20px; }
.rd__s { font-size: 11.5px; color: oklch(0.8 0.035 250); margin-top: 2px; }
.rd__x { margin-left: auto; background: none; border: none; color: oklch(0.8 0.035 250); cursor: pointer; padding: 2px; }
.rd__x:hover { color: #fff; }
.rd__bd { padding: 14px 18px; overflow: auto; flex: 1; }
.rd__ft { padding: 12px 18px; border-top: 1px solid var(--color-line); display: flex; gap: 14px; align-items: center; }
.rd__go {
  background: var(--color-brand-800); color: #fff; border: 0; border-radius: 7px;
  padding: 9px 16px; font-family: var(--font-sans); font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.rd__go:hover:not(:disabled) { background: var(--color-brand-700); }
.rd__go:disabled { opacity: 0.5; cursor: default; }
.rd__seg {
  display: flex; border: 1px solid var(--color-line); border-radius: 9px;
  overflow: hidden; margin: 2px 0 12px;
}
.rd__seg button {
  flex: 1; border: 0; background: var(--color-surface);
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 700; padding: 8px 4px;
  color: var(--color-muted); cursor: pointer;
}
.rd__seg-on { background: var(--color-brand-800) !important; color: #fff !important; }
.rd__fld { display: grid; gap: 4px; font-size: 11px; font-weight: 700; color: var(--color-muted); margin: 8px 0; }
.rd__fld input, .rd__fld select {
  font-family: var(--font-sans); font-size: 12.5px; padding: 7px 9px;
  border: 1px solid var(--color-line); border-radius: 7px;
  background: var(--color-surface); color: var(--color-ink);
}
.rd__fld input:focus, .rd__fld select:focus { outline: none; border-color: var(--color-brand-600); }
.rd__note { font-size: 11px; color: var(--color-muted); line-height: 1.5; margin: 6px 0; }
.rd__attach { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0 4px; }
.rd__lnk {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
  font-family: var(--font-sans); color: var(--color-brand-600); font-size: 12px; font-weight: 650;
  text-decoration: underline dotted var(--color-line); text-underline-offset: 3px;
}
.rd__lnk--mut { color: var(--color-muted); }
.rd__sect {
  display: flex; align-items: center; gap: 10px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--color-muted); margin: 16px 0 6px;
}
.rd__sect::after { content: ''; flex: 1; height: 1px; background: var(--color-line); }
.rd__hist {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 6px 0; border-bottom: 1px solid var(--color-line-soft); font-size: 12px;
}
.rd__hist:last-of-type { border-bottom: 0; }
.rd__hist-d { font-variant-numeric: tabular-nums; font-weight: 650; color: var(--color-ink); }
.rd__hist-s { color: var(--color-muted); font-size: 11.5px; min-width: 0; }
.rd__trash {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  background: none; border: 0; padding: 0; cursor: pointer;
  font-family: var(--font-sans); font-size: 11px; font-weight: 650; color: var(--color-danger-500);
}
.rd__error {
  margin-top: 10px; padding: 8px 11px; border-radius: 8px;
  background: oklch(0.97 0.04 20); border: 1px solid oklch(0.85 0.07 20);
  color: var(--color-danger-500); font-size: 12px;
}
</style>
