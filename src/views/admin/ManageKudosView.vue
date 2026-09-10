<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Heart, Sparkles, Trash2 } from 'lucide-vue-next'
import SpotlightEditModal from '@/components/dashboard/SpotlightEditModal.vue'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'

/**
 * Kudos inbox (/admin/kudos, admins) — every submission from the
 * Jotform kudos form, delivered here by the jotform-kudos webhook.
 * "Turn into spotlight" opens the dashboard spotlight editor prefilled
 * with the recipient and the kudos text, so a great write-up becomes
 * the front-page spotlight in one step.
 */

const auth = useAuthStore()

interface KudosRow {
  id: string
  submittedAt: string
  fields: Record<string, string>
}

const rows = ref<KudosRow[]>([])
const loadError = ref<string | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  loadError.value = null
  if (auth.usingDevStub) {
    rows.value = [
      {
        id: 'dev-1',
        submittedAt: new Date().toISOString(),
        fields: {
          'Your first name': 'Thomas',
          'Your last name': 'Kim',
          "Recipient's first name": 'Justin',
          "Recipient's last name": 'White',
          Kudos:
            'Dev sample — I saw Justin FTO a new hire and he did a great job building them up from their baseline. Thoughtful feedback, full-picture thinking, and a genuinely great introduction to rural EMS.',
        },
      },
    ]
    loading.value = false
    return
  }
  const { data, error } = await supabase
    .from('kudos_submissions')
    .select('id, submitted_at, fields')
    .order('submitted_at', { ascending: false })
  loading.value = false
  if (error) {
    loadError.value = error.message
    return
  }
  rows.value = (data ?? []).map((r: { id: string; submitted_at: string; fields: Record<string, string> }) => ({
    id: r.id,
    submittedAt: r.submitted_at,
    fields: r.fields ?? {},
  }))
}
onMounted(load)

function fromName(r: KudosRow): string {
  return `${r.fields['Your first name'] ?? ''} ${r.fields['Your last name'] ?? ''}`.trim() || 'Unknown'
}
function forName(r: KudosRow): string {
  return `${r.fields["Recipient's first name"] ?? ''} ${r.fields["Recipient's last name"] ?? ''}`.trim() || 'Unknown'
}
function kudosText(r: KudosRow): string {
  return r.fields['Kudos'] ?? ''
}
function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const expanded = ref<Record<string, boolean>>({})
const SNIPPET = 220

/* ── Turn into spotlight ───────────────────────────────────────────── */
const editOpen = ref(false)
const prefill = ref<{ personNames: string[]; blurb: string; story: string } | null>(null)

function makeSpotlight(r: KudosRow) {
  const text = kudosText(r)
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text
  prefill.value = {
    personNames: [forName(r)],
    blurb: firstSentence.length > SNIPPET ? `${text.slice(0, SNIPPET).trimEnd()}…` : firstSentence,
    story: `${text}\n\n— Kudos submitted by ${fromName(r)}`,
  }
  editOpen.value = true
}

/* ── Armed delete (2-tap, same pattern as documents) ───────────────── */
const armedDelete = ref<string | null>(null)
const deleteBusy = ref(false)
async function removeRow(r: KudosRow) {
  if (armedDelete.value !== r.id) {
    armedDelete.value = r.id
    setTimeout(() => {
      if (armedDelete.value === r.id) armedDelete.value = null
    }, 4000)
    return
  }
  armedDelete.value = null
  deleteBusy.value = true
  try {
    const { error, count } = await supabase
      .from('kudos_submissions')
      .delete({ count: 'exact' })
      .eq('id', r.id)
    if (error) loadError.value = `Delete failed: ${error.message}`
    else if (!count) loadError.value = 'Delete failed: no row removed (permissions).'
    else {
      loadError.value = null
      rows.value = rows.value.filter((x) => x.id !== r.id)
    }
  } finally {
    deleteBusy.value = false
  }
}

const count = computed(() => rows.value.length)
</script>

<template>
  <div class="mk">
    <header class="mk__header">
      <div class="flex items-center gap-2">
        <Heart :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <h1 class="display mk__title">Kudos</h1>
        <span v-if="count" class="mk__count">{{ count }}</span>
      </div>
      <p class="mk__sub">
        Submissions from the kudos form arrive here automatically. A great write-up can become
        the dashboard spotlight in one step — the editor opens prefilled, ready to polish and publish.
      </p>
    </header>

    <div v-if="!auth.isAdmin" class="mk__gate">Admin only.</div>

    <template v-else>
      <div v-if="loading" class="mk__quiet">Loading…</div>
      <div v-if="loadError" class="mk__error">{{ loadError }}</div>
      <div v-if="!loading && !loadError && rows.length === 0" class="mk__quiet">
        No kudos yet — submissions appear here the moment the Jotform is filled out.
      </div>

      <div v-for="r in rows" :key="r.id" class="mk__card">
        <div class="mk__head">
          <span class="mk__for">{{ forName(r) }}</span>
          <span class="mk__from">from {{ fromName(r) }}</span>
          <span class="mk__date">{{ fmt(r.submittedAt) }}</span>
        </div>
        <p class="mk__text">
          <template v-if="expanded[r.id] || kudosText(r).length <= SNIPPET">{{ kudosText(r) }}</template>
          <template v-else>{{ kudosText(r).slice(0, SNIPPET).trimEnd() }}…</template>
        </p>
        <div class="mk__actions">
          <button
            v-if="kudosText(r).length > SNIPPET"
            type="button"
            class="mk__link"
            @click="expanded[r.id] = !expanded[r.id]"
          >{{ expanded[r.id] ? 'Show less' : 'Read the full kudos' }}</button>
          <span class="mk__spacer"></span>
          <button type="button" class="btn btn-primary mk__spot" @click="makeSpotlight(r)">
            <Sparkles :size="13" :stroke-width="2" /> Turn into spotlight
          </button>
          <button
            type="button"
            class="mk__del"
            :class="{ 'mk__del--armed': armedDelete === r.id }"
            :disabled="deleteBusy"
            @click="removeRow(r)"
          >
            <Trash2 :size="13" :stroke-width="2" />
            {{ armedDelete === r.id ? 'Tap again to delete' : 'Delete' }}
          </button>
        </div>
      </div>

      <SpotlightEditModal :open="editOpen" :prefill="prefill" @close="editOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.mk { max-width: 780px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .mk { padding: 24px 32px 80px; } }
.mk__header { margin-bottom: 18px; }
.mk__title { font-size: 26px; }
.mk__count {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
}
.mk__sub { margin-top: 6px; font-size: 13px; color: var(--color-muted); max-width: 62ch; line-height: 1.5; }
.mk__gate, .mk__quiet { font-size: 13px; color: var(--color-muted); padding: 18px 0; }
.mk__error { font-size: 13px; color: oklch(0.5 0.16 30); padding: 18px 0; }
.mk__card {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.mk__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.mk__for { font-weight: 700; font-size: 14.5px; color: var(--color-ink); }
.mk__from { font-size: 12.5px; color: var(--color-ink-soft); }
.mk__date {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-accent-strong, #a8842c);
  font-variant-numeric: tabular-nums;
}
.mk__text { margin: 8px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--color-ink-soft); white-space: pre-line; }
.mk__actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.mk__link {
  border: none;
  background: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-600);
  cursor: pointer;
  padding: 0;
}
.mk__link:hover { text-decoration: underline; }
.mk__spacer { flex: 1; }
.mk__spot { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
.mk__del {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--color-line);
  background: none;
  color: var(--color-muted);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.mk__del--armed { border-color: oklch(0.5 0.16 30); color: oklch(0.5 0.16 30); }
</style>
