<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Plus,
  Upload,
  Search,
  ArrowUp,
  ArrowDown,
  Trash2,
  X,
  CircleCheck,
  UserRound,
} from 'lucide-vue-next'
import '@/components/equipment/equipment.css'
import EquipmentStatusChip from '@/components/equipment/EquipmentStatusChip.vue'
import EquipmentPersonPicker from '@/components/equipment/EquipmentPersonPicker.vue'
import { useEquipment } from '@/composables/useEquipment'
import {
  itemMatches,
  padTag,
  parseAssetImport,
  pluralize,
  statusChip,
  suggestedTagWidth,
  type PickedPerson,
} from '@/lib/equipment'
import type { EquipmentAsset } from '@/types'

/**
 * /equipment/manage — the registry, editable in-app by equipment
 * handlers (route guard + RLS): items (add, edit, retire, bulk paste
 * from Excel/PSTrax), item types (rename, reorder, retire), and — for
 * admins — who else may check equipment out.
 */

const route = useRoute()
const router = useRouter()
const {
  ready,
  assets,
  types,
  handlerIds,
  people,
  isAdmin,
  typeName,
  stateOf,
  saveAsset,
  importAssets,
  deleteAsset,
  saveType,
  moveType,
  deleteType,
  addHandler,
  removeHandler,
  loadPeople,
  personName,
} = useEquipment()

type Tab = 'items' | 'types' | 'access'
const tab = ref<Tab>(route.query.tab === 'types' || route.query.tab === 'access' ? route.query.tab : 'items')
watch(tab, (t) => {
  router.replace({ query: { ...route.query, tab: t === 'items' ? undefined : t, edit: undefined } })
  if (t === 'access') void loadPeople()
})
if (tab.value === 'access') void loadPeople()

const flash = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null
function say(msg: string) {
  flash.value = msg
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = null), 3500)
}

const sortedTypes = computed(() => [...types.value].sort((a, b) => a.sort - b.sort))
const typeUseCount = computed(() => {
  const m: Record<string, number> = {}
  for (const a of assets.value) if (a.typeId) m[a.typeId] = (m[a.typeId] ?? 0) + 1
  return m
})

/* ── Items ─────────────────────────────────────────────────────────── */
const q = ref('')
const showRetired = ref(false)
const itemList = computed(() =>
  assets.value.filter(
    (a) => (showRetired.value || a.active) && itemMatches(a, typeName(a.typeId), q.value),
  ),
)
const retiredCount = computed(() => assets.value.filter((a) => !a.active).length)

interface Draft {
  id: string | null
  tag: string
  name: string
  typeId: string | null
  notes: string
  active: boolean
}
const draft = ref<Draft | null>(null)
const draftErr = ref<string | null>(null)
const saving = ref(false)

function newItem() {
  importing.value = false
  draft.value = {
    id: null,
    tag: '',
    name: '',
    typeId: sortedTypes.value.find((t) => t.active)?.id ?? null,
    notes: '',
    active: true,
  }
  draftErr.value = null
}

function editItem(a: EquipmentAsset) {
  importing.value = false
  draft.value = {
    id: a.id,
    tag: a.tag,
    name: a.name,
    typeId: a.typeId,
    notes: a.notes,
    active: a.active,
  }
  draftErr.value = null
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ?edit=<asset id> from the item page. */
watch(
  [ready, () => route.query.edit],
  ([r, id]) => {
    if (!r || typeof id !== 'string') return
    const a = assets.value.find((x) => x.id === id)
    if (a) editItem(a)
  },
  { immediate: true },
)

/* Out = physically in someone's custody; a written-off (lost) item can
   be retired. */
const draftIsOut = computed(() => {
  if (!draft.value?.id) return false
  const st = stateOf(draft.value.id).status
  return st !== 'available' && st !== 'lost'
})
const draftHasHistory = computed(() =>
  draft.value?.id ? !!stateOf(draft.value.id).lastEvent : false,
)

async function saveDraft() {
  if (!draft.value) return
  saving.value = true
  const d = draft.value
  const res = await saveAsset(d.id, {
    tag: d.tag,
    name: d.name,
    typeId: d.typeId,
    notes: d.notes,
    active: d.active,
  })
  saving.value = false
  if (!res.ok) {
    draftErr.value = res.error
    return
  }
  say(d.id ? `Saved ${d.tag.trim()}` : `Added ${d.tag.trim()}`)
  if (d.id) {
    draft.value = null
    router.replace({ query: { ...route.query, edit: undefined } })
  } else {
    /* Keep the type for rapid entry of a batch of the same kind. */
    draft.value = { ...d, tag: '', name: '', notes: '' }
    draftErr.value = null
  }
}

async function removeDraft() {
  if (!draft.value?.id) return
  if (!window.confirm(`Delete ${draft.value.tag} from the registry? This can’t be undone.`)) return
  const res = await deleteAsset(draft.value.id)
  if (!res.ok) {
    draftErr.value = res.error
    return
  }
  say(`Deleted ${draft.value.tag}`)
  draft.value = null
}

function closeDraft() {
  draft.value = null
  router.replace({ query: { ...route.query, edit: undefined } })
}

/* ── Bulk import ── */
const importing = ref(false)
const pasted = ref('')
const padOn = ref(false)
const padWidth = ref(5)
const importErr = ref<string | null>(null)
const importBusy = ref(false)

function openImport() {
  draft.value = null
  importing.value = true
  importErr.value = null
}

const parsed = computed(() => parseAssetImport(pasted.value))
const detectedWidth = computed(() => suggestedTagWidth(parsed.value.rows.map((r) => r.tag)))
const hasNumericTags = computed(() => parsed.value.rows.some((r) => /^\d+$/.test(r.tag)))
watch(detectedWidth, (w) => {
  if (w) {
    padOn.value = true
    padWidth.value = w
  }
})

type RowStatus = 'ok' | 'exists' | 'dupe' | 'invalid'
const preview = computed(() => {
  const existing = new Set(assets.value.map((a) => a.tag.toLowerCase()))
  const seen = new Set<string>()
  return parsed.value.rows.map((r) => {
    const tag = padTag(r.tag, padOn.value ? padWidth.value : null)
    let status: RowStatus = 'ok'
    let reason = ''
    if (!tag || !r.name) {
      status = 'invalid'
      reason = !tag ? 'No tag' : 'No name'
    } else if (existing.has(tag.toLowerCase())) {
      status = 'exists'
      reason = 'Already in the registry'
    } else if (seen.has(tag.toLowerCase())) {
      status = 'dupe'
      reason = 'Listed twice'
    }
    seen.add(tag.toLowerCase())
    return { ...r, tag, status, reason }
  })
})
const importable = computed(() => preview.value.filter((r) => r.status === 'ok'))
const newTypeNames = computed(() => {
  const known = new Set(types.value.map((t) => t.name.trim().toLowerCase()))
  const out: string[] = []
  for (const r of importable.value) {
    const k = r.typeName.trim()
    if (k && !known.has(k.toLowerCase()) && !out.some((x) => x.toLowerCase() === k.toLowerCase()))
      out.push(k)
  }
  return out
})

async function runImport() {
  if (!importable.value.length) return
  importBusy.value = true
  importErr.value = null
  const res = await importAssets(
    importable.value.map((r) => ({ tag: r.tag, name: r.name, typeName: r.typeName })),
  )
  importBusy.value = false
  if (!res.ok) {
    importErr.value = res.error
    return
  }
  say(`Imported ${pluralize(res.added, 'item')}`)
  pasted.value = ''
  importing.value = false
}

/* ── Types ─────────────────────────────────────────────────────────── */
const typeNames = ref<Record<string, string>>({})
watch(
  types,
  (list) => {
    typeNames.value = Object.fromEntries(list.map((t) => [t.id, t.name]))
  },
  { immediate: true },
)
const newType = ref('')
const typeErr = ref<string | null>(null)

async function renameType(id: string) {
  const t = types.value.find((x) => x.id === id)
  const name = (typeNames.value[id] ?? '').trim()
  if (!t || name === t.name) return
  const res = await saveType(id, { name, active: t.active })
  if (!res.ok) {
    typeErr.value = res.error
    typeNames.value[id] = t.name
    return
  }
  typeErr.value = null
  say(`Renamed to ${name}`)
}

async function toggleType(id: string) {
  const t = types.value.find((x) => x.id === id)
  if (!t) return
  const res = await saveType(id, { name: t.name, active: !t.active })
  typeErr.value = res.ok ? null : res.error
}

async function addType() {
  const res = await saveType(null, { name: newType.value, active: true })
  if (!res.ok) {
    typeErr.value = res.error
    return
  }
  typeErr.value = null
  say(`Added ${newType.value.trim()}`)
  newType.value = ''
}

async function removeType(id: string) {
  const t = types.value.find((x) => x.id === id)
  if (!t || !window.confirm(`Delete the “${t.name}” type?`)) return
  const res = await deleteType(id)
  typeErr.value = res.ok ? null : res.error
}

async function move(id: string, dir: -1 | 1) {
  const res = await moveType(id, dir)
  typeErr.value = res.ok ? null : res.error
}

/* ── Access (admin) ────────────────────────────────────────────────── */
const grantPick = ref<PickedPerson | null>(null)
const accessErr = ref<string | null>(null)
const grantable = computed(() => people.value.filter((p) => !handlerIds.value.includes(p.id)))

watch(grantPick, async (p) => {
  if (!p?.id) return
  const res = await addHandler(p.id)
  grantPick.value = null
  if (!res.ok) {
    accessErr.value = res.error
    return
  }
  accessErr.value = null
  say(`${p.name} can now check equipment out`)
})

async function revoke(userId: string) {
  const res = await removeHandler(userId)
  accessErr.value = res.ok ? null : res.error
}
</script>

<template>
  <div class="eq-page eqm">
    <RouterLink to="/equipment" class="eq-back">
      <ArrowLeft :size="15" :stroke-width="2" /> Equipment
    </RouterLink>

    <header class="eqm__head">
      <div class="eq-eyebrow">Equipment registry</div>
      <h1 class="eq-h1">What we track</h1>
      <p class="eq-sub">
        The event gear kept at Admin. PSTrax stays the record for maintenance — add each item here
        with its PSTrax tag so its custody can be tracked.
      </p>
    </header>

    <nav class="eqm__tabs" aria-label="Registry sections">
      <button type="button" class="eqm__tab" :class="{ 'eqm__tab--on': tab === 'items' }" @click="tab = 'items'">
        Items <span>{{ assets.filter((a) => a.active).length }}</span>
      </button>
      <button type="button" class="eqm__tab" :class="{ 'eqm__tab--on': tab === 'types' }" @click="tab = 'types'">
        Types <span>{{ types.filter((t) => t.active).length }}</span>
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="eqm__tab"
        :class="{ 'eqm__tab--on': tab === 'access' }"
        @click="tab = 'access'"
      >
        Access <span>{{ handlerIds.length }}</span>
      </button>
    </nav>

    <div v-if="!ready" class="eq-empty">Loading registry…</div>

    <!-- ══ Items ══ -->
    <template v-else-if="tab === 'items'">
      <div v-if="!draft && !importing" class="eqm__toolbar">
        <div class="eqm__search">
          <Search :size="16" :stroke-width="1.9" />
          <input v-model="q" type="search" placeholder="Search the registry…" autocomplete="off" />
        </div>
        <div class="eqm__toolbar-btns">
          <button type="button" class="eq-btn eq-btn--primary" @click="newItem">
            <Plus :size="16" :stroke-width="2.2" /> Add item
          </button>
          <button type="button" class="eq-btn eq-btn--secondary" @click="openImport">
            <Upload :size="15" :stroke-width="2" /> Paste a list
          </button>
        </div>
      </div>

      <!-- Add / edit -->
      <section v-if="draft" class="eqm__panel eq-reveal">
        <div class="eqm__panel-head">
          <h2 class="eq-section-title">{{ draft.id ? `Edit ${draft.tag}` : 'Add an item' }}</h2>
          <button type="button" class="eqm__x" aria-label="Close" @click="closeDraft">
            <X :size="18" :stroke-width="2" />
          </button>
        </div>
        <form class="eqm__form" @submit.prevent="saveDraft">
          <div class="eqm__grid">
            <label class="eq-field">
              <span class="eq-label"><span>PSTrax tag</span><span class="eq-label__req">Required</span></span>
              <input
                v-model="draft.tag"
                class="eq-input eq-input--mono"
                type="text"
                maxlength="40"
                placeholder="00432"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
              />
            </label>
            <label class="eq-field">
              <span class="eq-label"><span>Type</span></span>
              <select v-model="draft.typeId" class="eq-select">
                <option :value="null">Uncategorized</option>
                <option
                  v-for="t in sortedTypes.filter((t) => t.active || t.id === draft?.typeId)"
                  :key="t.id"
                  :value="t.id"
                >
                  {{ t.name }}
                </option>
              </select>
            </label>
          </div>
          <label class="eq-field">
            <span class="eq-label"><span>Name or description</span><span class="eq-label__req">Required</span></span>
            <input
              v-model="draft.name"
              class="eq-input"
              type="text"
              maxlength="120"
              placeholder="e.g. APX 6000 portable #3"
              autocomplete="off"
            />
          </label>
          <label class="eq-field">
            <span class="eq-label"><span>Notes</span><span class="eq-label__aside">Optional</span></span>
            <input
              v-model="draft.notes"
              class="eq-input"
              type="text"
              maxlength="200"
              placeholder="e.g. Cracked corner — still works"
            />
          </label>
          <label v-if="draft.id" class="eqm__check" :class="{ 'eqm__check--off': draftIsOut }">
            <input v-model="draft.active" type="checkbox" :disabled="draftIsOut && draft.active" />
            <span>
              <strong>In service</strong>
              <template v-if="draftIsOut && draft.active"> — it’s checked out right now; retire it after it’s back.</template>
              <template v-else> — uncheck to retire it. Retired items drop off the board but keep their history.</template>
            </span>
          </label>

          <p v-if="draftErr" class="eq-error">{{ draftErr }}</p>

          <div class="eqm__form-actions">
            <button type="submit" class="eq-btn eq-btn--primary" :disabled="saving">
              {{ saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add to registry' }}
            </button>
            <button type="button" class="eq-btn eq-btn--quiet" @click="closeDraft">
              {{ draft.id ? 'Cancel' : 'Done' }}
            </button>
            <button
              v-if="draft.id && !draftHasHistory"
              type="button"
              class="eq-btn eq-btn--danger-quiet eqm__delete"
              @click="removeDraft"
            >
              <Trash2 :size="14" :stroke-width="2" /> Delete
            </button>
          </div>
          <p v-if="!draft.id" class="eq-hint">After saving, the form stays open with the same type for the next item.</p>
        </form>
      </section>

      <!-- Paste a list -->
      <section v-if="importing" class="eqm__panel eq-reveal">
        <div class="eqm__panel-head">
          <h2 class="eq-section-title">Paste a list</h2>
          <button type="button" class="eqm__x" aria-label="Close" @click="importing = false">
            <X :size="18" :stroke-width="2" />
          </button>
        </div>
        <p class="eq-hint eqm__import-hint">
          Copy rows from Excel, Sheets, or a PSTrax export and paste them here — one item per line:
          <strong>tag, name, type</strong>. A header row (Tag / Name / Type, or Asset # / Description /
          Category) is recognized automatically. New types are created for you.
        </p>
        <textarea
          v-model="pasted"
          class="eq-textarea eqm__paste"
          rows="6"
          spellcheck="false"
          placeholder="00432	APX 6000 portable #3	Radio&#10;00512	Event iPad 1	iPad"
        ></textarea>

        <template v-if="preview.length">
          <div v-if="hasNumericTags" class="eqm__pad">
            <label class="eqm__check">
              <input v-model="padOn" type="checkbox" />
              <span>
                <strong>Restore leading zeros</strong> — pad number-only tags to
                <input v-model.number="padWidth" type="number" min="1" max="12" class="eqm__pad-n" />
                digits
                <template v-if="detectedWidth"> (some tags look like Excel dropped their zeros)</template>
              </span>
            </label>
          </div>

          <div class="eqm__preview-head">
            <span>{{ pluralize(importable.length, 'item') }} ready</span>
            <span v-if="preview.length > importable.length" class="eqm__preview-skip">
              {{ preview.length - importable.length }} skipped
            </span>
            <span v-if="parsed.usedHeader" class="eqm__preview-note">Header row used</span>
          </div>
          <div class="eq-list eqm__preview">
            <div
              v-for="r in preview"
              :key="r.line"
              class="eqm__prow"
              :class="{ 'eqm__prow--skip': r.status !== 'ok' }"
            >
              <span class="eq-tag">{{ r.tag || '—' }}</span>
              <span class="eqm__prow-name">{{ r.name || '—' }}</span>
              <span class="eqm__prow-type">{{ r.typeName || 'Uncategorized' }}</span>
              <span v-if="r.reason" class="eqm__prow-why">{{ r.reason }}</span>
            </div>
          </div>
          <p v-if="newTypeNames.length" class="eq-hint">
            Will create {{ newTypeNames.length === 1 ? 'type' : 'types' }}: <strong>{{ newTypeNames.join(', ') }}</strong>
          </p>
        </template>

        <p v-if="importErr" class="eq-error eqm__import-err">{{ importErr }}</p>
        <div class="eqm__form-actions">
          <button
            type="button"
            class="eq-btn eq-btn--primary"
            :disabled="!importable.length || importBusy"
            @click="runImport"
          >
            {{ importBusy ? 'Importing…' : importable.length ? `Import ${pluralize(importable.length, 'item')}` : 'Import' }}
          </button>
          <button type="button" class="eq-btn eq-btn--quiet" @click="importing = false">Cancel</button>
        </div>
      </section>

      <!-- Registry list -->
      <div v-if="assets.length" class="eqm__list-head">
        <span class="eq-section-meta">{{ pluralize(itemList.length, 'item') }}</span>
        <label v-if="retiredCount" class="eqm__retired-toggle">
          <input v-model="showRetired" type="checkbox" /> Show retired ({{ retiredCount }})
        </label>
      </div>
      <div v-if="itemList.length" class="eq-list">
        <button
          v-for="a in itemList"
          :key="a.id"
          type="button"
          class="eqm__row"
          :class="{ 'eqm__row--retired': !a.active, 'eqm__row--editing': draft?.id === a.id }"
          @click="editItem(a)"
        >
          <span class="eq-tag">{{ a.tag }}</span>
          <span class="eqm__row-main">
            <span class="eqm__row-name">{{ a.name }}</span>
            <span class="eqm__row-sub">
              {{ typeName(a.typeId) }}<template v-if="!a.active"> · Retired</template><template v-if="a.notes"> · {{ a.notes }}</template>
            </span>
          </span>
          <EquipmentStatusChip :status="stateOf(a.id).status" :label="statusChip(stateOf(a.id))" />
        </button>
      </div>
      <div v-else-if="!assets.length && !draft && !importing" class="eqm__empty">
        <p>Nothing in the registry yet.</p>
        <p class="eq-hint">Add items one at a time, or paste the list straight from PSTrax or Excel.</p>
      </div>
      <div v-else-if="assets.length" class="eq-list eq-empty">Nothing matches that search.</div>
    </template>

    <!-- ══ Types ══ -->
    <template v-else-if="tab === 'types'">
      <p class="eq-hint eqm__types-hint">
        Rename, reorder, or retire the kinds of gear you track. Retired types stay on existing items
        but aren’t offered for new ones.
      </p>
      <div class="eq-list">
        <div v-for="(t, i) in sortedTypes" :key="t.id" class="eqm__type" :class="{ 'eqm__type--off': !t.active }">
          <div class="eqm__type-order">
            <button
              type="button"
              class="eqm__icon-btn"
              :disabled="i === 0"
              aria-label="Move up"
              @click="move(t.id, -1)"
            >
              <ArrowUp :size="15" :stroke-width="2" />
            </button>
            <button
              type="button"
              class="eqm__icon-btn"
              :disabled="i === sortedTypes.length - 1"
              aria-label="Move down"
              @click="move(t.id, 1)"
            >
              <ArrowDown :size="15" :stroke-width="2" />
            </button>
          </div>
          <input
            v-model="typeNames[t.id]"
            class="eq-input eqm__type-name"
            type="text"
            maxlength="40"
            :aria-label="`Rename ${t.name}`"
            @blur="renameType(t.id)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <span class="eqm__type-count">{{ pluralize(typeUseCount[t.id] ?? 0, 'item') }}</span>
          <label class="eqm__switch" :title="t.active ? 'In use — tap to retire' : 'Retired — tap to restore'">
            <input type="checkbox" :checked="t.active" @change="toggleType(t.id)" />
            <span class="eqm__switch-track"><span class="eqm__switch-knob"></span></span>
            <span class="sr-only">{{ t.active ? 'Active' : 'Retired' }}</span>
          </label>
          <button
            v-if="!typeUseCount[t.id]"
            type="button"
            class="eqm__icon-btn eqm__icon-btn--danger"
            :aria-label="`Delete ${t.name}`"
            @click="removeType(t.id)"
          >
            <Trash2 :size="15" :stroke-width="2" />
          </button>
          <span v-else class="eqm__icon-spacer" aria-hidden="true"></span>
        </div>
        <form class="eqm__type eqm__type--new" @submit.prevent="addType">
          <input
            v-model="newType"
            class="eq-input eqm__type-name"
            type="text"
            maxlength="40"
            placeholder="New type — e.g. Hotspot, Charger case"
          />
          <button type="submit" class="eq-btn eq-btn--secondary" :disabled="!newType.trim()">
            <Plus :size="15" :stroke-width="2.2" /> Add
          </button>
        </form>
      </div>
      <p v-if="typeErr" class="eq-error eqm__type-err">{{ typeErr }}</p>
    </template>

    <!-- ══ Access (admin) ══ -->
    <template v-else-if="tab === 'access' && isAdmin">
      <p class="eq-hint eqm__types-hint">
        Supervisors and admins can already check equipment out, deliver it, and bring it back. Add
        anyone else who hands out event gear — admin staff, supply. Everyone signed in can confirm
        equipment on a truck and close out an event with a photo.
      </p>
      <div class="eq-list">
        <div v-for="id in handlerIds" :key="id" class="eqm__handler">
          <span class="eqm__handler-avatar"><UserRound :size="15" :stroke-width="2" /></span>
          <span class="eqm__handler-name">{{ personName(id) }}</span>
          <button type="button" class="eq-btn eq-btn--danger-quiet" @click="revoke(id)">Remove</button>
        </div>
        <div v-if="!handlerIds.length" class="eq-empty">No one extra yet.</div>
      </div>
      <div class="eq-field eqm__grant">
        <span class="eq-label"><span>Add someone</span></span>
        <EquipmentPersonPicker v-model="grantPick" :people="grantable" placeholder="Search the roster…" />
      </div>
      <p v-if="accessErr" class="eq-error">{{ accessErr }}</p>
    </template>

    <div v-if="flash" class="eq-toast" role="status">
      <CircleCheck :size="17" :stroke-width="2.2" /> {{ flash }}
    </div>
  </div>
</template>

<style scoped>
.eqm {
  max-width: 860px;
}
.eqm__head {
  margin: 12px 0 18px;
}
.eqm__tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 18px;
  padding: 4px;
  background: var(--color-surface-sunk);
  border-radius: 12px;
  width: fit-content;
  max-width: 100%;
}
.eqm__tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 16px;
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  background: none;
  border: none;
  border-radius: 9px;
  cursor: pointer;
}
.eqm__tab span {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
}
.eqm__tab--on {
  background: var(--color-brand-800);
  color: white;
}
.eqm__tab--on span {
  color: var(--color-accent-on-dark);
}

.eqm__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.eqm__search {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 260px;
  min-height: 44px;
  padding: 0 13px;
  color: var(--color-muted);
  background: var(--color-surface);
  border: 1.5px solid var(--color-line);
  border-radius: 11px;
}
.eqm__search:focus-within {
  border-color: var(--color-accent-600);
  box-shadow: 0 0 0 3px oklch(0.734 0.114 86.8 / 0.2);
}
.eqm__search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: 16px;
  color: var(--color-ink);
}
.eqm__toolbar-btns {
  display: flex;
  gap: 8px;
}
@media (max-width: 520px) {
  .eqm__toolbar-btns {
    width: 100%;
  }
  .eqm__toolbar-btns .eq-btn {
    flex: 1;
  }
}

.eqm__panel {
  margin-bottom: 20px;
  padding: 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}
.eqm__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.eqm__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 999px;
  background: var(--color-surface-sunk);
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqm__form .eq-field + .eq-field,
.eqm__grid + .eq-field {
  margin-top: 16px;
}
.eqm__grid {
  display: grid;
  gap: 16px;
}
@media (min-width: 560px) {
  .eqm__grid {
    grid-template-columns: 1fr 1fr;
  }
}
.eqm__grid .eq-field + .eq-field {
  margin-top: 0;
}
.eqm__check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 16px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqm__check input[type='checkbox'] {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  flex-shrink: 0;
  accent-color: var(--color-brand-600);
}
.eqm__check strong {
  color: var(--color-ink);
}
.eqm__check--off {
  cursor: not-allowed;
}
.eqm__form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}
.eqm__form .eq-error {
  margin-top: 14px;
}
.eqm__delete {
  margin-left: auto;
}

/* Import */
.eqm__import-hint {
  margin-bottom: 10px;
}
.eqm__paste {
  font-family: var(--font-mono);
  font-size: 14px;
  min-height: 130px;
}
.eqm__pad {
  margin-top: 4px;
}
.eqm__pad-n {
  width: 54px;
  margin: 0 4px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 15px;
  border: 1.5px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-surface);
}
.eqm__preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
}
.eqm__preview-skip {
  color: oklch(0.5 0.15 50);
}
.eqm__preview-note {
  font-weight: 500;
  color: var(--color-muted);
}
.eqm__preview {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 10px;
}
.eqm__prow {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  padding: 9px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--color-line-soft);
}
.eqm__prow:last-child {
  border-bottom: none;
}
.eqm__prow-name {
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqm__prow-type {
  color: var(--color-muted);
  white-space: nowrap;
}
.eqm__prow-why {
  grid-column: 2 / -1;
  font-size: 12px;
  font-weight: 600;
  color: oklch(0.5 0.15 50);
}
.eqm__prow--skip {
  background: var(--color-surface-soft);
}
.eqm__prow--skip .eqm__prow-name {
  color: var(--color-muted);
  text-decoration: line-through;
}
.eqm__import-err {
  margin-top: 12px;
}

/* Registry list */
.eqm__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 4px 2px 8px;
}
.eqm__retired-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqm__retired-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand-600);
}
.eqm__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  text-align: left;
  font-family: var(--font-sans);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.eqm__row:last-child {
  border-bottom: none;
}
.eqm__row:hover {
  background: var(--color-surface-soft);
}
.eqm__row--editing {
  background: var(--color-brand-50);
}
.eqm__row--retired {
  opacity: 0.6;
}
.eqm__row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.eqm__row-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqm__row-sub {
  font-size: 12.5px;
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eqm__empty {
  padding: 30px 4px;
  font-size: 15px;
  color: var(--color-ink-soft);
  border-top: 1px solid var(--color-line);
}

/* Types */
.eqm__types-hint {
  margin-bottom: 14px;
  max-width: 620px;
}
.eqm__type {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-line-soft);
}
.eqm__type:last-child {
  border-bottom: none;
}
.eqm__type--off .eqm__type-name {
  color: var(--color-muted);
  text-decoration: line-through;
}
.eqm__type--new {
  background: var(--color-surface-soft);
}
.eqm__type-order {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.eqm__type-name {
  flex: 1;
  min-width: 0;
  min-height: 44px;
}
.eqm__type-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
}
@media (max-width: 480px) {
  .eqm__type-count {
    display: none;
  }
}
.eqm__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 9px;
  background: none;
  color: var(--color-ink-soft);
  cursor: pointer;
}
.eqm__type-order .eqm__icon-btn {
  width: 30px;
  height: 22px;
}
.eqm__icon-btn:hover:not(:disabled) {
  background: var(--color-surface-sunk);
}
.eqm__icon-btn:disabled {
  opacity: 0.25;
  cursor: default;
}
.eqm__icon-btn--danger {
  color: oklch(0.5 0.17 25);
}
.eqm__icon-spacer {
  width: 36px;
  flex-shrink: 0;
}
.eqm__switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  cursor: pointer;
}
.eqm__switch input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.eqm__switch-track {
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-line);
  transition: background 150ms var(--ease-out);
}
.eqm__switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: white;
  box-shadow: var(--shadow-sm);
  transition: transform 150ms var(--ease-out);
}
.eqm__switch input:checked + .eqm__switch-track {
  background: var(--color-brand-600);
}
.eqm__switch input:checked + .eqm__switch-track .eqm__switch-knob {
  transform: translateX(18px);
}
.eqm__switch input:focus-visible + .eqm__switch-track {
  outline: 2px solid var(--color-brand-500);
  outline-offset: 2px;
}
.eqm__type-err {
  margin-top: 12px;
}

/* Access */
.eqm__handler {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid var(--color-line-soft);
}
.eqm__handler:last-child {
  border-bottom: none;
}
.eqm__handler-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: var(--color-accent-on-dark);
  background: var(--color-brand-900);
}
.eqm__handler-name {
  flex: 1;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.eqm__grant {
  margin-top: 18px;
  max-width: 460px;
}
</style>
