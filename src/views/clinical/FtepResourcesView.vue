<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import ClinicalNav from '@/components/clinical/ClinicalNav.vue'
import FtepSectionTabs from '@/components/clinical/FtepSectionTabs.vue'
import FtepResourcesCard from '@/components/clinical/FtepResourcesCard.vue'
import { useClinical } from '@/composables/useClinical'

/**
 * FTEP → Resources: the program library on its own tab — handbooks,
 * the Program Guide, workbooks, blank forms. Editors upload and
 * manage; audience scoping decides who sees what.
 */

const router = useRouter()
const { ready, canViewBoard, canEdit } = useClinical()

watch(
  [ready, canViewBoard],
  ([r, ok]) => {
    if (r && !ok) router.replace('/clinical-development')
  },
  { immediate: true },
)
</script>

<template>
  <div class="frs">
    <ClinicalNav :crumbs="[{ label: 'FTEP', to: '/clinical/ftep' }, 'Resources']" />
    <FtepSectionTabs />

    <header class="frs__head">
      <h1 class="display frs__title">Resources</h1>
      <div class="frs__sub">Program Guide, handbooks, workbooks and blank forms — scoped by audience</div>
    </header>

    <FtepResourcesCard :editable="canEdit" />
  </div>
</template>

<style scoped>
.frs { max-width: 980px; margin: 0 auto; padding: 24px 16px 80px; }
@media (min-width: 768px) { .frs { padding: 24px 32px 80px; } }
.frs__head { margin-bottom: 16px; }
.frs__title { font-size: 26px; line-height: 1.1; color: var(--color-ink); }
.frs__sub { margin-top: 4px; font-size: 12.5px; color: var(--color-muted); }
</style>
