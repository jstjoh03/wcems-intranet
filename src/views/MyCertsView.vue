<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { BadgeCheck, FileText, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import AppCard from '@/components/primitives/AppCard.vue'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import { useEmployeeCerts, type EmployeeCert } from '@/composables/useEmployeeCerts'
import { useAuthStore } from '@/stores/auth'

/**
 * My Certifications (/my-certs) — the self-service cert wallet
 * (Justin, 2026-11-17; Christina & Michael Mathes were the trigger).
 * Upload the card image or PDF, record issue + expiration dates, and
 * the portal reminds you (push + email) at 60/30/7 days and at expiry.
 * Admins and pipeline editors can read everyone's rows for
 * verification; everyone else sees only their own wallet.
 */

const auth = useAuthStore()
const wallet = useEmployeeCerts()
onMounted(() => void wallet.load())

/* ── Status ────────────────────────────────────────────────────────── */
function daysLeft(c: EmployeeCert): number | null {
  if (!c.expiresOn) return null
  const today = new Date()
  const d = new Date(`${c.expiresOn}T00:00:00`)
  return Math.floor((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
}
function statusFor(c: EmployeeCert): { label: string; cls: string } {
  const d = daysLeft(c)
  if (d === null) return { label: 'no expiration', cls: 'mc__chip--none' }
  if (d < 0) return { label: `expired ${Math.abs(d)}d ago`, cls: 'mc__chip--expired' }
  if (d === 0) return { label: 'expires today', cls: 'mc__chip--expired' }
  if (d <= 7) return { label: `expires in ${d}d`, cls: 'mc__chip--expired' }
  if (d <= 60) return { label: `expires in ${d}d`, cls: 'mc__chip--soon' }
  return { label: 'current', cls: 'mc__chip--ok' }
}
function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const sorted = computed(() =>
  [...wallet.certs.value].sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999')),
)

/* Thumbnails: signed URLs fetched lazily per cert. */
const thumbs = ref<Record<string, string>>({})
watch(
  () => wallet.certs.value.map((c) => c.id).join(','),
  async () => {
    for (const c of wallet.certs.value) {
      if (thumbs.value[c.id] || !c.contentType?.startsWith('image/')) continue
      const url = await wallet.fileUrl(c)
      if (url) thumbs.value = { ...thumbs.value, [c.id]: url }
    }
  },
  { immediate: true },
)

async function openFile(c: EmployeeCert) {
  const url = await wallet.fileUrl(c)
  if (url) window.open(url, '_blank', 'noopener')
}

/* ── Add / edit form ───────────────────────────────────────────────── */
const formOpen = ref(false)
const editId = ref<string | null>(null)
const fName = ref('')
const fNumber = ref('')
const fIssued = ref('')
const fExpires = ref('')
const fNote = ref('')
const fFile = ref<File | null>(null)
const busy = ref(false)
const err = ref<string | null>(null)

function startAdd() {
  editId.value = null
  fName.value = ''
  fNumber.value = ''
  fIssued.value = ''
  fExpires.value = ''
  fNote.value = ''
  fFile.value = null
  err.value = null
  formOpen.value = true
}
function startEdit(c: EmployeeCert) {
  editId.value = c.id
  fName.value = c.name
  fNumber.value = c.certNumber ?? ''
  fIssued.value = c.issuedOn ?? ''
  fExpires.value = c.expiresOn ?? ''
  fNote.value = c.note ?? ''
  fFile.value = null
  err.value = null
  formOpen.value = true
}
function onPickFile(e: Event) {
  fFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

const formValid = computed(() => {
  if (!fName.value.trim()) return false
  if (!editId.value && !fFile.value) return false /* new cert needs the card */
  return true
})

async function save() {
  if (!formValid.value || busy.value) return
  busy.value = true
  err.value = null
  const res = editId.value
    ? await wallet.update(
        editId.value,
        { name: fName.value, certNumber: fNumber.value, issuedOn: fIssued.value, expiresOn: fExpires.value, note: fNote.value },
        fFile.value,
      )
    : await wallet.add({
        name: fName.value,
        certNumber: fNumber.value,
        issuedOn: fIssued.value,
        expiresOn: fExpires.value,
        note: fNote.value,
        file: fFile.value!,
      })
  busy.value = false
  if (!res.ok) {
    err.value = res.error
    return
  }
  /* New file means a fresh signed URL next time it's needed. */
  if (editId.value) delete thumbs.value[editId.value]
  formOpen.value = false
}

/* ── Two-tap delete ───────────────────────────────────────────────── */
const armedId = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
async function onDelete(c: EmployeeCert) {
  if (armedId.value !== c.id) {
    armedId.value = c.id
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => (armedId.value = null), 4000)
    return
  }
  armedId.value = null
  busy.value = true
  const res = await wallet.remove(c.id)
  busy.value = false
  if (!res.ok) err.value = res.error
}
</script>

<template>
  <div class="mc">
    <header class="mc__header">
      <div class="flex items-center gap-2">
        <BadgeCheck :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mc__title">My Certifications</h1>
      </div>
      <p class="mc__sub">
        Your own cert wallet — upload the card, record the dates, and the portal reminds you
        (notification + email) at 60, 30 and 7 days out, and at expiration. Renew a card by
        editing it with the new expiration date and image.
      </p>
    </header>

    <div v-if="auth.isKiosk" class="mc__gate">
      Certifications are personal — sign in with your own account to manage yours.
    </div>

    <template v-else>
      <div class="mc__toolbar">
        <button v-if="!formOpen" type="button" class="mc__btn mc__btn--primary" @click="startAdd">
          <Plus :size="14" :stroke-width="2" /> Add a certification
        </button>
      </div>

      <!-- Add / edit -->
      <AppCard v-if="formOpen" class="mc__form-card">
        <div class="flex items-center justify-between mb-3">
          <Eyebrow>{{ editId ? 'Edit certification' : 'New certification' }}</Eyebrow>
          <button type="button" class="mc__icon" aria-label="Close" @click="formOpen = false">
            <X :size="15" />
          </button>
        </div>
        <form class="mc__form" @submit.prevent="save">
          <div class="mc__row">
            <label class="mc__field mc__field--wide">
              <span>Certification *</span>
              <input v-model="fName" type="text" maxlength="120" placeholder="e.g. BLS Provider, ACLS, TX EMS Certification" />
            </label>
            <label class="mc__field">
              <span>Card / license #</span>
              <input v-model="fNumber" type="text" maxlength="60" placeholder="optional" />
            </label>
          </div>
          <div class="mc__row">
            <label class="mc__field">
              <span>Issued</span>
              <input v-model="fIssued" type="date" />
            </label>
            <label class="mc__field">
              <span>Expires</span>
              <input v-model="fExpires" type="date" />
            </label>
            <label class="mc__field mc__field--wide">
              <span>Note</span>
              <input v-model="fNote" type="text" maxlength="200" placeholder="optional" />
            </label>
          </div>
          <label class="mc__filepick">
            <input type="file" accept="image/*,.pdf" class="mc__fileinput" @change="onPickFile" />
            <span class="mc__btn"><Paperclip :size="13" :stroke-width="2" /> {{ editId ? 'Replace card image…' : 'Choose card image…' }}</span>
            <span class="mc__filename" :class="{ 'mc__filename--set': fFile }">
              {{ fFile?.name ?? (editId ? 'keeping the current file' : 'no file selected — photo or PDF') }}
            </span>
          </label>
          <p v-if="fExpires === '' " class="mc__hint">No expiration date = no reminders for this card.</p>
          <div v-if="err" class="mc__error">{{ err }}</div>
          <div class="mc__formfoot">
            <button type="button" class="mc__btn" @click="formOpen = false">Cancel</button>
            <button type="submit" class="mc__btn mc__btn--primary" :disabled="!formValid || busy">
              {{ busy ? 'Saving…' : editId ? 'Save changes' : 'Add to my wallet' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- Wallet -->
      <div v-if="!wallet.ready.value" class="mc__empty">Loading…</div>
      <div v-else-if="!sorted.length && !formOpen" class="mc__empty">
        Nothing here yet — add your first card with the button above.
      </div>
      <div class="mc__grid">
        <AppCard v-for="c in sorted" :key="c.id" class="mc__cert">
          <button type="button" class="mc__thumbwrap" :title="'View ' + c.name" @click="openFile(c)">
            <img v-if="thumbs[c.id]" :src="thumbs[c.id]" :alt="c.name" class="mc__thumb" />
            <span v-else class="mc__thumb mc__thumb--doc"><FileText :size="26" :stroke-width="1.6" /></span>
          </button>
          <div class="mc__cert-main">
            <div class="mc__cert-head">
              <span class="mc__cert-name">{{ c.name }}</span>
              <span class="mc__chip" :class="statusFor(c).cls">{{ statusFor(c).label }}</span>
            </div>
            <div class="mc__cert-meta">
              <template v-if="c.certNumber">#{{ c.certNumber }} · </template>
              issued {{ fmt(c.issuedOn) }} · expires {{ fmt(c.expiresOn) }}
            </div>
            <div v-if="c.note" class="mc__cert-note">{{ c.note }}</div>
            <div class="mc__cert-actions">
              <button type="button" class="mc__mini" @click="openFile(c)">View card</button>
              <button type="button" class="mc__mini" @click="startEdit(c)">
                <Pencil :size="11" :stroke-width="2" /> Edit / renew
              </button>
              <button
                type="button"
                class="mc__mini mc__mini--danger"
                :class="{ 'mc__mini--armed': armedId === c.id }"
                @click="onDelete(c)"
              >
                <Trash2 :size="11" :stroke-width="2" />
                {{ armedId === c.id ? 'Really delete?' : 'Delete' }}
              </button>
            </div>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc { max-width: 860px; margin: 0 auto; padding: 28px 16px 80px; }
@media (min-width: 768px) { .mc { padding: 36px 32px 80px; } }
.mc__header { margin-bottom: 18px; }
.mc__title { font-size: 24px; color: var(--color-ink); }
.mc__sub { margin-top: 6px; font-size: 13px; line-height: 1.55; color: var(--color-muted); max-width: 620px; }
.mc__gate { padding: 40px 0; text-align: center; color: var(--color-muted); }
.mc__toolbar { margin-bottom: 14px; }
.mc__empty { font-size: 13px; color: var(--color-muted); padding: 18px 2px; }
.mc__error { font-size: 12.5px; color: oklch(0.5 0.16 28); }

.mc__btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-sans); font-size: 12.5px; font-weight: 600;
  color: var(--color-ink-soft); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: 9px; padding: 8px 13px; cursor: pointer;
}
.mc__btn:hover:not(:disabled) { border-color: var(--color-brand-600); }
.mc__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mc__btn--primary { color: white; background: var(--color-brand-600); border-color: var(--color-brand-600); }
.mc__btn--primary:hover:not(:disabled) { background: var(--color-brand-700); }
.mc__icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 7px; border: 1px solid transparent;
  background: none; color: var(--color-muted); cursor: pointer;
}
.mc__icon:hover { border-color: var(--color-line); color: var(--color-ink); }

.mc__form-card { margin-bottom: 18px; }
.mc__form { display: flex; flex-direction: column; gap: 12px; }
.mc__row { display: flex; flex-wrap: wrap; gap: 10px 14px; }
.mc__field { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; font-weight: 700; color: var(--color-muted); }
.mc__field--wide { flex: 1; min-width: 220px; }
.mc__field input {
  font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);
  background: var(--color-surface-soft); border: 1.5px solid var(--color-line);
  border-radius: 9px; padding: 8px 11px; min-width: 150px;
}
.mc__field input:focus { outline: none; border-color: var(--color-brand-600); }
.mc__filepick { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; flex-wrap: wrap; }
.mc__fileinput { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip: rect(0 0 0 0); }
.mc__filepick .mc__btn { pointer-events: none; }
.mc__filepick:focus-within .mc__btn { outline: 2px solid var(--color-brand-600); outline-offset: 1px; }
.mc__filename { font-size: 11.5px; color: var(--color-muted); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc__filename--set { color: var(--color-ink); font-weight: 600; }
.mc__hint { font-size: 11px; color: var(--color-muted-soft); margin: -4px 0 0; }
.mc__formfoot { display: flex; justify-content: flex-end; gap: 8px; }

.mc__grid { display: flex; flex-direction: column; gap: 12px; }
.mc__cert { display: flex; gap: 14px; align-items: flex-start; }
.mc__thumbwrap { flex-shrink: 0; background: none; border: none; padding: 0; cursor: pointer; }
.mc__thumb {
  width: 92px; height: 64px; object-fit: cover; display: block;
  border: 1px solid var(--color-line); border-radius: 9px; background: var(--color-surface-soft);
}
.mc__thumb--doc { display: flex; align-items: center; justify-content: center; color: var(--color-muted); }
.mc__cert-main { flex: 1; min-width: 0; }
.mc__cert-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mc__cert-name { font-size: 14px; font-weight: 700; color: var(--color-ink); }
.mc__chip {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em;
  border-radius: 999px; padding: 2.5px 9px; border: 1px solid transparent;
}
.mc__chip--ok { color: oklch(0.42 0.1 150); background: oklch(0.96 0.03 150); border-color: oklch(0.85 0.06 150); }
.mc__chip--soon { color: oklch(0.45 0.1 75); background: oklch(0.97 0.04 85); border-color: oklch(0.85 0.07 85); }
.mc__chip--expired { color: oklch(0.45 0.15 28); background: oklch(0.96 0.03 28); border-color: oklch(0.86 0.06 28); }
.mc__chip--none { color: var(--color-muted); background: var(--color-surface-soft); border-color: var(--color-line); }
.mc__cert-meta { margin-top: 3px; font-size: 12px; color: var(--color-muted); }
.mc__cert-note { margin-top: 3px; font-size: 12px; color: var(--color-ink-soft); }
.mc__cert-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.mc__mini {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
  color: var(--color-ink-soft); background: none;
  border: 1px solid var(--color-line); border-radius: 7px; padding: 4px 9px; cursor: pointer;
}
.mc__mini:hover { border-color: var(--color-brand-600); }
.mc__mini--danger { color: oklch(0.5 0.16 28); }
.mc__mini--armed { color: white; background: oklch(0.5 0.16 28); border-color: transparent; }

@media (max-width: 480px) {
  .mc__cert { flex-direction: column; }
  .mc__thumb { width: 100%; height: 120px; }
}
</style>
