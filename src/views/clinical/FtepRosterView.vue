<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepSectionTabs from '@/components/clinical/FtepSectionTabs.vue'
import { useClinical } from '@/composables/useClinical'

/**
 * FTEP → Roster: the informational credential roster supervisors and
 * FTOs get in place of Employee Files (which is clinical-only) — who
 * holds what cert and credential level. Editors are steered to
 * Employee Files instead (richer view of the same people).
 */

const router = useRouter()
const { ready, canViewBoard, canEdit, clinicalPeople, statusChip } = useClinical()

watch(
  [ready, canViewBoard, canEdit],
  ([r, ok, editor]) => {
    if (r && !ok) router.replace('/clinical-development')
    else if (r && editor) router.replace('/clinical/people')
  },
  { immediate: true },
)

const query = ref('')
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return clinicalPeople.value
    .filter((p) => !q || p.fullName.toLowerCase().includes(q))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
})
</script>

<template>
  <div class="fro">
    <ClinicalNav :crumbs="[{ label: 'FTEP', to: '/clinical/ftep' }, 'Roster']" />
    <FtepSectionTabs />

    <header class="fro__head">
      <h1 class="display fro__title">Credential roster</h1>
      <div class="fro__sub">Every clinical employee · cert &amp; credential level</div>
    </header>

    <div class="fro__card">
      <input v-model="query" type="search" class="fro__search" placeholder="Search by name…" />
      <div v-for="p in rows" :key="p.userId" class="fro__row">
        <span class="fro__name">{{ p.fullName }}</span>
        <span class="fro__cert">{{ p.record.certLevel ?? '—' }}</span>
        <span class="fro__level">{{ p.record.level ?? '—' }}</span>
        <span class="fro__chip" :class="`fro__chip--${statusChip(p).kind}`">{{ statusChip(p).text }}</span>
      </div>
      <div v-if="rows.length === 0" class="fro__empty">No one matches that search.</div>
    </div>
  </div>
</template>

<style scoped>
.fro { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .fro { padding: 24px 32px 80px; } }
.fro__head { margin-bottom: 16px; }
.fro__title { font-size: 26px; line-height: 1.1; color: var(--color-ink); }
.fro__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
.fro__card {
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; padding: 14px 16px;
}
.fro__search {
  width: 100%; max-width: 320px; margin-bottom: 8px;
  padding: 7px 11px; border: 1px solid var(--color-line); border-radius: 9px;
  font-size: 13px; background: var(--color-surface); color: var(--color-ink);
}
.fro__search:focus { outline: none; border-color: var(--color-accent-600); }
.fro__row {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 4px; border-bottom: 1px solid var(--color-line-soft); font-size: 12.5px;
}
.fro__row:last-of-type { border-bottom: none; }
.fro__name {
  flex: 0 0 190px; font-weight: 600; color: var(--color-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fro__cert { flex: 0 0 76px; color: var(--color-muted); }
.fro__level { flex: 0 0 60px; font-weight: 600; color: var(--color-ink-soft); }
.fro__chip {
  margin-left: auto; font-size: 10.5px; font-weight: 700;
  padding: 2px 9px; border-radius: 999px; white-space: nowrap;
}
.fro__chip--ok { background: var(--color-success-50); color: var(--color-success-500); }
.fro__chip--navy { background: oklch(0.93 0.02 250); color: var(--color-brand-700); }
.fro__chip--hold { background: var(--color-warning-50); color: oklch(0.5 0.12 75); }
.fro__empty { padding: 14px 4px; font-size: 12.5px; color: var(--color-muted); }
@media (max-width: 560px) {
  .fro__name { flex-basis: 130px; }
  .fro__cert { flex-basis: 60px; }
}
</style>
