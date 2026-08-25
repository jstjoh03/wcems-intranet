<script setup lang="ts">
import { ref, computed } from 'vue'
import { BookOpen, Plus, Trash2 } from 'lucide-vue-next'
import {
  useFtepResources,
  AUDIENCE_LABELS,
  CATEGORY_LABELS,
  type FtepResource,
  type ResourceAudience,
  type ResourceCategory,
} from '@/composables/useFtepResources'

/**
 * The FTEP Resources library card — handbooks, program guides,
 * workbooks, blank forms. What each viewer sees is already scoped by
 * RLS; editors additionally get the uploader and delete controls.
 * Rendered on the FTEP page (evaluators + editors) and as "Program
 * resources" on My Progress (trainee-audience docs).
 */

const props = defineProps<{
  editable?: boolean
  title?: string
}>()

const lib = useFtepResources()

const sorted = computed(() =>
  [...lib.resources.value].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title)),
)

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function openDoc(r: FtepResource) {
  const res = await lib.open(r)
  if (res.ok) window.open(res.url, '_blank', 'noopener')
}

/* ── Editor controls ───────────────────────────────────────────────── */

const upTitle = ref('')
const upCategory = ref<ResourceCategory>('handbook')
const upAudience = ref<ResourceAudience>('evaluators')
const upBusy = ref(false)
const upError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function pickFile() {
  if (!upTitle.value.trim()) {
    upError.value = 'Give the document a title first.'
    return
  }
  upError.value = null
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || upBusy.value) return
  upBusy.value = true
  upError.value = null
  const res = await lib.upload({
    title: upTitle.value,
    category: upCategory.value,
    audience: upAudience.value,
    file,
  })
  upBusy.value = false
  if (!res.ok) {
    upError.value = res.error
    return
  }
  upTitle.value = ''
}

const deleteArm = ref<string | null>(null)
async function removeDoc(r: FtepResource) {
  if (deleteArm.value !== r.id) {
    deleteArm.value = r.id
    setTimeout(() => {
      if (deleteArm.value === r.id) deleteArm.value = null
    }, 4000)
    return
  }
  deleteArm.value = null
  await lib.remove(r)
}
</script>

<template>
  <div class="frc">
    <div class="frc__hd">
      <BookOpen :size="15" :stroke-width="2" class="frc__hd-ic" />
      {{ props.title ?? 'Resources' }}
      <span class="frc__hd-hint">handbooks · program guides · workbooks · blank forms</span>
    </div>

    <button
      v-for="r in sorted"
      :key="r.id"
      type="button"
      class="frc__row"
      @click="openDoc(r)"
    >
      <span class="frc__cat">{{ CATEGORY_LABELS[r.category] }}</span>
      <span class="frc__title">{{ r.title }}</span>
      <span class="frc__meta">
        <template v-if="editable">{{ AUDIENCE_LABELS[r.audience] }} · </template>{{ fmtSize(r.sizeBytes) }}
      </span>
      <span
        v-if="editable"
        class="frc__del"
        :class="{ 'frc__del--armed': deleteArm === r.id }"
        role="button"
        :title="deleteArm === r.id ? 'Click again to permanently delete' : 'Delete this resource'"
        @click.stop="removeDoc(r)"
      ><Trash2 :size="13" :stroke-width="2" />{{ deleteArm === r.id ? ' Confirm?' : '' }}</span>
    </button>

    <div v-if="sorted.length === 0" class="frc__empty">
      {{ editable ? 'Nothing uploaded yet — add the FTO Handbook and Program Guide below.' : 'No documents shared yet.' }}
    </div>

    <div v-if="editable" class="frc__up">
      <input v-model="upTitle" type="text" placeholder="Title — e.g. WCEMS FTO Handbook" maxlength="120" />
      <select v-model="upCategory">
        <option v-for="(label, k) in CATEGORY_LABELS" :key="k" :value="k">{{ label }}</option>
      </select>
      <select v-model="upAudience">
        <option v-for="(label, k) in AUDIENCE_LABELS" :key="k" :value="k">{{ label }}</option>
      </select>
      <button type="button" class="frc__upbtn" :disabled="upBusy" @click="pickFile">
        <Plus :size="13" :stroke-width="2.5" />
        {{ upBusy ? 'Uploading…' : 'Upload' }}
      </button>
      <input ref="fileInput" type="file" accept=".pdf,.docx,.doc,image/*" style="display: none" @change="onFile" />
      <span v-if="upError" class="frc__uperr">{{ upError }}</span>
    </div>
  </div>
</template>

<style scoped>
.frc {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  padding: 14px 18px;
}
.frc__hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.frc__hd-ic { color: var(--color-accent-700); }
.frc__hd-hint {
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-muted-soft);
}
.frc__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 4px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-line-soft);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.frc__row:last-of-type { border-bottom: none; }
.frc__row:hover { background: var(--color-surface-soft); }
.frc__cat {
  flex-shrink: 0;
  width: 96px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: center;
  padding: 3px 0;
  border-radius: 6px;
  background: oklch(0.93 0.02 250);
  color: var(--color-brand-700);
}
.frc__title {
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.frc__meta {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
}
.frc__del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 7px;
  color: var(--color-danger-500);
  font-size: 11px;
  font-weight: 600;
}
.frc__del:hover { background: var(--color-danger-50); }
.frc__del--armed { background: var(--color-danger-50); }
.frc__empty {
  font-size: 12.5px;
  color: var(--color-muted);
  padding: 6px 0;
}
.frc__up {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-line-soft);
}
.frc__up input[type='text'] {
  flex: 1;
  min-width: 200px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.frc__up select {
  padding: 7px 8px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-ink);
}
.frc__upbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  border: none;
  background: var(--color-brand-700);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.frc__upbtn:disabled { opacity: 0.6; }
.frc__uperr {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--color-danger-500);
}
</style>
