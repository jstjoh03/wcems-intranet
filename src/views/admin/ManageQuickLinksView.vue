<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { LayoutGrid, Plus, Save, X, Edit2, Trash2 } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import IconRender from '@/components/primitives/IconRender.vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'
import type { Role } from '@/types'

interface QuickLinkRow {
  id: string
  label: string
  sub: string
  url: string
  icon_name: string
  category: string
  visible_to: string[]
  sort_order: number
  active: boolean
}

interface Draft {
  id: string | null
  label: string
  sub: string
  url: string
  icon_name: string
  category: string
  visible_to: Role[]
  sort_order: number
  active: boolean
}

const ROLES: Role[] = ['crew', 'supervisor', 'admin']

const auth = useAuthStore()
const { categories: existingCategories, refresh } = useQuickLinks()

const rows = ref<QuickLinkRow[]>([])
const loading = ref(true)
const draft = ref<Draft | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')

async function load() {
  loading.value = true
  error.value = null
  const { data, error: fetchErr } = await supabase
    .from('quick_links')
    .select(
      'id, label, sub, url, icon_name, category, visible_to, sort_order, active',
    )
    .order('category')
    .order('sort_order')
  if (fetchErr) {
    error.value = fetchErr.message
    loading.value = false
    return
  }
  rows.value = (data ?? []) as QuickLinkRow[]
  loading.value = false
}

onMounted(load)

function blankDraft(): Draft {
  return {
    id: null,
    label: '',
    sub: '',
    url: 'https://',
    icon_name: 'Link2',
    category: '',
    visible_to: [],
    sort_order: 0,
    active: true,
  }
}

function startCreate() {
  draft.value = blankDraft()
  error.value = null
}

function startEdit(r: QuickLinkRow) {
  draft.value = {
    id: r.id,
    label: r.label,
    sub: r.sub ?? '',
    url: r.url,
    icon_name: r.icon_name,
    category: r.category ?? '',
    visible_to: (r.visible_to ?? []) as Role[],
    sort_order: r.sort_order ?? 0,
    active: r.active,
  }
  error.value = null
}

function cancelEdit() {
  draft.value = null
  error.value = null
}

function toggleRole(role: Role) {
  if (!draft.value) return
  const i = draft.value.visible_to.indexOf(role)
  if (i >= 0) draft.value.visible_to.splice(i, 1)
  else draft.value.visible_to.push(role)
}

async function save() {
  if (!draft.value || saving.value) return
  const d = draft.value
  if (!d.label.trim()) {
    error.value = 'Label is required.'
    return
  }
  if (!d.url.trim()) {
    error.value = 'URL is required.'
    return
  }
  saving.value = true
  error.value = null
  const payload = {
    label: d.label.trim(),
    sub: d.sub.trim(),
    url: d.url.trim(),
    icon_name: d.icon_name.trim() || 'Link2',
    category: d.category.trim(),
    visible_to: d.visible_to,
    sort_order: Number(d.sort_order) || 0,
    active: d.active,
  }
  if (d.id) {
    const { error: updErr } = await supabase
      .from('quick_links')
      .update(payload)
      .eq('id', d.id)
    if (updErr) {
      saving.value = false
      error.value = updErr.message
      return
    }
  } else {
    const { error: insErr } = await supabase
      .from('quick_links')
      .insert({
        ...payload,
        created_by: auth.appUser?.id ?? null,
      })
    if (insErr) {
      saving.value = false
      error.value = insErr.message
      return
    }
  }
  saving.value = false
  draft.value = null
  await load()
  await refresh()
}

async function removeLink(r: QuickLinkRow) {
  if (!confirm(`Delete "${r.label}"? This cannot be undone.`)) return
  const { error: delErr } = await supabase.from('quick_links').delete().eq('id', r.id)
  if (delErr) {
    alert(delErr.message)
    return
  }
  await load()
  await refresh()
}

async function toggleActive(r: QuickLinkRow) {
  const { error: updErr } = await supabase
    .from('quick_links')
    .update({ active: !r.active })
    .eq('id', r.id)
  if (updErr) {
    alert(updErr.message)
    return
  }
  await load()
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter(
    (r) =>
      r.label.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.url.toLowerCase().includes(q),
  )
})

/* Group rows by category for a more scannable list. */
const byCategory = computed(() => {
  const map = new Map<string, QuickLinkRow[]>()
  for (const r of filteredRows.value) {
    const key = r.category || 'Uncategorized'
    const arr = map.get(key) ?? []
    arr.push(r)
    map.set(key, arr)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
})
</script>

<template>
  <div class="mql">
    <header class="mql__header">
      <div class="flex items-center gap-2">
        <LayoutGrid :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mql__title">Manage Quick Links</h1>
      </div>
      <p class="mql__sub">
        Catalog the shortcuts that appear in the Quick Links dock. Crews pin their favorites
        inline; admins curate what's available.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mql__gate">Admin only.</div>

    <template v-else>
      <div class="mql__toolbar">
        <button type="button" class="btn btn-primary" @click="startCreate">
          <Plus :size="14" :stroke-width="2" /> Add link
        </button>
        <input
          v-model="search"
          type="search"
          placeholder="Search by label, category, or URL…"
          aria-label="Search quick links"
          class="mql__search"
        />
      </div>

      <!-- Edit / create form -->
      <AppCard v-if="draft" class="mql-form">
        <Eyebrow class="mb-3">{{ draft.id ? 'Edit link' : 'New link' }}</Eyebrow>
        <form class="mql-form__grid" @submit.prevent="save">
          <label class="mql-form__field mql-form__field--wide">
            <span class="mql-form__label">Label</span>
            <input
              v-model="draft.label"
              type="text"
              maxlength="80"
              required
              placeholder="e.g. Texas EMS Online"
              class="mql-form__input"
            />
          </label>

          <label class="mql-form__field mql-form__field--wide">
            <span class="mql-form__label">Subtitle (optional)</span>
            <input
              v-model="draft.sub"
              type="text"
              maxlength="60"
              placeholder="Short clarifier — shown beneath the label"
              class="mql-form__input"
            />
          </label>

          <label class="mql-form__field mql-form__field--wide">
            <span class="mql-form__label">URL</span>
            <input
              v-model="draft.url"
              type="url"
              required
              placeholder="https://..."
              class="mql-form__input"
            />
          </label>

          <label class="mql-form__field">
            <span class="mql-form__label">Category</span>
            <input
              v-model="draft.category"
              type="text"
              maxlength="40"
              placeholder="Field & Ops"
              list="quicklink-categories"
              class="mql-form__input"
            />
            <datalist id="quicklink-categories">
              <option v-for="c in existingCategories" :key="c" :value="c" />
            </datalist>
            <span class="mql-form__hint">Type to add a new category or pick an existing one.</span>
          </label>

          <label class="mql-form__field">
            <span class="mql-form__label">Icon</span>
            <div class="mql-form__icon-row">
              <span class="mql-form__icon-preview">
                <IconRender :name="draft.icon_name" :size="18" :stroke-width="1.85" />
              </span>
              <input
                v-model="draft.icon_name"
                type="text"
                maxlength="40"
                placeholder="e.g. MapPin, Bell, Phone"
                class="mql-form__input mql-form__input--flex"
              />
            </div>
            <span class="mql-form__hint">
              Lucide icon name —
              <a
                href="https://lucide.dev/icons"
                target="_blank"
                rel="noopener noreferrer"
              >browse the catalog</a>. Falls back to "Link2" if not found.
            </span>
          </label>

          <label class="mql-form__field">
            <span class="mql-form__label">Sort order</span>
            <input
              v-model.number="draft.sort_order"
              type="number"
              min="0"
              class="mql-form__input"
            />
            <span class="mql-form__hint">Lower = first within its category.</span>
          </label>

          <div class="mql-form__field">
            <span class="mql-form__label">Visible to</span>
            <div class="mql-form__role-row">
              <label
                v-for="r in ROLES"
                :key="r"
                class="mql-form__role"
                :class="{ 'mql-form__role--on': draft.visible_to.includes(r) }"
              >
                <input
                  type="checkbox"
                  :checked="draft.visible_to.includes(r)"
                  @change="toggleRole(r)"
                />
                <span>{{ r }}</span>
              </label>
            </div>
            <span class="mql-form__hint">
              Leave all unchecked to show this link to everyone. Otherwise, only the
              checked roles will see it.
            </span>
          </div>

          <label class="mql-form__field mql-form__check">
            <input v-model="draft.active" type="checkbox" />
            <span>Active (visible in the dock)</span>
          </label>

          <div v-if="error" class="mql-form__error">{{ error }}</div>

          <div class="mql-form__actions">
            <button type="button" class="btn btn-ghost" @click="cancelEdit">
              <X :size="14" :stroke-width="2" /> Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Save :size="14" :stroke-width="2" />
              {{ saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add link' }}
            </button>
          </div>
        </form>
      </AppCard>

      <!-- List -->
      <div v-if="loading" class="mql__empty">Loading…</div>
      <div v-else-if="byCategory.length === 0" class="mql__empty">
        {{ search ? 'No links match that search.' : 'No links yet. Click "Add link" above.' }}
      </div>

      <section v-for="[cat, items] in byCategory" :key="cat" class="mql-cat">
        <div class="mql-cat__head display">{{ cat }}</div>
        <AppCard
          v-for="r in items"
          :key="r.id"
          class="mql-row"
          :class="{ 'mql-row--inactive': !r.active }"
        >
          <span class="mql-row__icon">
            <IconRender :name="r.icon_name" :size="16" :stroke-width="1.85" />
          </span>
          <div class="mql-row__text">
            <div class="display mql-row__name">{{ r.label }}</div>
            <div class="mql-row__meta">
              <span v-if="r.sub">{{ r.sub }} · </span>
              <a :href="r.url" target="_blank" rel="noopener noreferrer">{{ r.url }}</a>
              <template v-if="r.visible_to.length > 0">
                · {{ r.visible_to.join(' / ') }}
              </template>
              <span v-if="!r.active" class="mql-row__inactive-chip">Inactive</span>
            </div>
          </div>
          <div class="mql-row__actions">
            <button
              type="button"
              class="mql-row__btn"
              :title="r.active ? 'Deactivate' : 'Activate'"
              @click="toggleActive(r)"
            >
              {{ r.active ? 'Deactivate' : 'Activate' }}
            </button>
            <button
              type="button"
              class="mql-row__btn"
              @click="startEdit(r)"
            >
              <Edit2 :size="13" :stroke-width="1.85" /> Edit
            </button>
            <button
              type="button"
              class="mql-row__btn mql-row__btn--danger"
              @click="removeLink(r)"
            >
              <Trash2 :size="13" :stroke-width="1.85" />
            </button>
          </div>
        </AppCard>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mql {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
@media (min-width: 768px) {
  .mql {
    padding: 40px 40px 80px;
  }
}

.mql__title {
  font-size: 28px;
  letter-spacing: -0.01em;
}
@media (min-width: 768px) {
  .mql__title {
    font-size: 36px;
  }
}
.mql__sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-muted);
}

.mql__gate {
  margin-top: 32px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  padding: 32px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

.mql__toolbar {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mql__search {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 7px 12px;
  outline: none;
}
.mql__search:focus {
  border-color: var(--color-brand-600);
}

.mql__empty {
  margin-top: 24px;
  padding: 28px 18px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted);
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}

/* ── Form ─────────────────────────────────────────────────────────── */
.mql-form {
  margin-top: 18px;
  padding: 18px !important;
}
.mql-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 768px) {
  .mql-form__grid {
    grid-template-columns: 1fr 1fr;
  }
}
.mql-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mql-form__field--wide {
  grid-column: 1 / -1;
}
.mql-form__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.mql-form__hint {
  font-size: 11px;
  color: var(--color-muted);
}
.mql-form__hint a {
  color: var(--color-brand-600);
}
.mql-form__input {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 9px 12px;
  outline: none;
  transition: border-color 120ms var(--ease-out);
}
.mql-form__input:focus {
  border-color: var(--color-brand-600);
  background: var(--color-surface);
}
.mql-form__input--flex {
  flex: 1;
}
.mql-form__icon-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mql-form__icon-preview {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-600);
}

.mql-form__role-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mql-form__role {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 12px;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
  text-transform: capitalize;
}
.mql-form__role:hover {
  border-color: var(--color-muted-soft);
}
.mql-form__role input {
  display: none;
}
.mql-form__role--on {
  background: var(--color-brand-600);
  color: white;
  border-color: var(--color-brand-600);
}
.mql-form__check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-soft);
}
.mql-form__check input {
  width: 16px;
  height: 16px;
}

.mql-form__error {
  grid-column: 1 / -1;
  font-size: 12.5px;
  color: var(--color-danger-500);
  background: oklch(0.97 0.04 20);
  border: 1px solid oklch(0.85 0.07 20);
  border-radius: 8px;
  padding: 9px 12px;
}

.mql-form__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

/* ── List rows ────────────────────────────────────────────────────── */
.mql-cat {
  margin-top: 22px;
}
.mql-cat__head {
  font-size: 14px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--color-line);
}
.mql-row {
  display: flex !important;
  align-items: center;
  gap: 12px;
  padding: 12px 14px !important;
  margin-bottom: 6px;
}
.mql-row--inactive {
  opacity: 0.6;
}
.mql-row__icon {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-600);
}
.mql-row__text {
  flex: 1;
  min-width: 0;
}
.mql-row__name {
  font-size: 15px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.mql-row__meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
  letter-spacing: 0.02em;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.mql-row__meta a {
  color: var(--color-brand-600);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
.mql-row__inactive-chip {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: oklch(0.97 0.04 20);
  color: var(--color-danger-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.mql-row__actions {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}
.mql-row__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-surface);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 120ms var(--ease-out);
}
.mql-row__btn:hover {
  border-color: var(--color-muted-soft);
}
.mql-row__btn--danger:hover {
  border-color: var(--color-danger-500);
  color: var(--color-danger-500);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.btn-primary {
  background: var(--color-brand-600);
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-brand-700);
}
.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  color: var(--color-ink-soft);
  border-color: var(--color-line);
}
.btn-ghost:hover {
  border-color: var(--color-muted-soft);
  color: var(--color-ink);
}
</style>
