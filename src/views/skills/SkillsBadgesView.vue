<script setup lang="ts">
import { ref, computed, watchEffect, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Printer } from 'lucide-vue-next'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { qrDataUrl } from '@/training/lib/qr'

/**
 * Printable QR badge sheet for a Skills Day: one card per trainee,
 * rendered at the TRUE insert size of the chosen badge holder — what
 * you see on screen is the physical card. Evaluators scan the card to
 * open /skills/scan/<trainee> with the station chooser pre-loaded.
 * Print on cardstock, cut on the card borders, slide into the holders.
 */

const route = useRoute()
const router = useRouter()
const { ready, days, isEvaluator, candidatesForDay } = useSkillsDay()

const dayId = computed(() => String(route.params.dayId ?? ''))
const day = computed(() => days.value.find((d) => d.id === dayId.value) ?? null)
const people = computed(() => (day.value ? candidatesForDay(day.value.id) : []))

/* Badge-holder insert sizes. Dimensions are the insert (slightly under
   the holder's nominal size so the cut card slides in). */
const SIZES = [
  {
    key: 'cr80v',
    label: 'Card vertical',
    sub: 'Badgy / CR80 portrait',
    vars: { '--bw': '2.1in', '--bh': '3.33in', '--bq': '1.6in', '--bname': '11pt' },
    compact: true,
  },
  {
    key: 'cr80',
    label: 'Card horizontal',
    sub: 'CR80 landscape',
    vars: { '--bw': '3.3in', '--bh': '2.05in', '--bq': '1.15in', '--bname': '11pt' },
    compact: true,
  },
  {
    key: 'h43',
    label: '4 × 3 in',
    sub: 'horizontal holder',
    vars: { '--bw': '3.9in', '--bh': '2.85in', '--bq': '1.5in', '--bname': '15pt' },
    compact: false,
  },
  {
    key: 'v34',
    label: '3 × 4 in',
    sub: 'vertical / lanyard',
    vars: { '--bw': '2.85in', '--bh': '3.9in', '--bq': '1.9in', '--bname': '14pt' },
    compact: false,
  },
] as const

const sizeKey = ref<string>('cr80v')
onMounted(() => {
  try {
    /* v2 key so the Badgy-card default takes over earlier saved picks */
    const saved = localStorage.getItem('wcems-badge-size-v2')
    if (saved && SIZES.some((s) => s.key === saved)) sizeKey.value = saved
  } catch {
    /* ignore */
  }
})
function pickSize(key: string) {
  sizeKey.value = key
  try {
    localStorage.setItem('wcems-badge-size-v2', key)
  } catch {
    /* ignore */
  }
}
const size = computed(() => SIZES.find((s) => s.key === sizeKey.value) ?? SIZES[0])

const qrs = ref<Record<string, string>>({})
watchEffect(() => {
  for (const p of people.value) {
    if (qrs.value[p.id]) continue
    void qrDataUrl(`${location.origin}/skills/scan/${p.id}`, 480).then((url) => {
      qrs.value = { ...qrs.value, [p.id]: url }
    })
  }
})

function printSheet() {
  window.print()
}

function fmtDate(onDate: string): string {
  const [y, m, d] = onDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="bdg">
    <div class="bdg__toolbar">
      <button type="button" class="bdg__btn" @click="router.push('/skills')">
        <ArrowLeft :size="15" :stroke-width="2" /> Skills Day
      </button>
      <div class="bdg__sizes">
        <button
          v-for="s in SIZES"
          :key="s.key"
          type="button"
          class="bdg__size"
          :class="{ 'bdg__size--on': sizeKey === s.key }"
          @click="pickSize(s.key)"
        >
          <span class="bdg__size-label">{{ s.label }}</span>
          <span class="bdg__size-sub">{{ s.sub }}</span>
        </button>
      </div>
      <button type="button" class="bdg__btn bdg__btn--primary" @click="printSheet">
        <Printer :size="15" :stroke-width="2" /> Print badges
      </button>
    </div>
    <p class="bdg__note">
      Cards below are shown at the real insert size and print exactly as shown — cut on the
      borders and slide into the holders.
    </p>

    <div v-if="!ready" class="bdg__empty">Loading…</div>
    <div v-else-if="!isEvaluator" class="bdg__empty">Evaluator access needed.</div>
    <div v-else-if="!day" class="bdg__empty">Skills Day not found.</div>
    <div v-else-if="!people.length" class="bdg__empty">No trainees assigned to this day yet.</div>

    <div v-else class="bdg__sheet" :class="{ 'bdg__sheet--compact': size.compact }" :style="size.vars">
      <div v-for="p in people" :key="p.id" class="bdg__card">
        <div class="bdg__card-head">
          <span class="bdg__org">Waller County EMS</span>
          <span class="bdg__day">{{ day.label }} · {{ fmtDate(day.onDate) }}</span>
        </div>
        <img v-if="qrs[p.id]" :src="qrs[p.id]" class="bdg__qr" alt="" />
        <div v-else class="bdg__qr bdg__qr--loading"></div>
        <div class="bdg__name">{{ p.fullName }}</div>
        <div class="bdg__hint">Evaluators: scan to open this trainee’s check-offs</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bdg {
  max-width: 900px;
  margin: 0 auto;
  padding: 18px 16px 48px;
}
.bdg__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.bdg__btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.bdg__btn--primary {
  border-color: var(--color-brand-600);
  background: var(--color-brand-600);
  color: #fff;
}
.bdg__sizes {
  display: flex;
  gap: 6px;
}
.bdg__size {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  cursor: pointer;
}
.bdg__size--on {
  border-color: var(--color-brand-600);
  background: var(--color-brand-50);
}
.bdg__size-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.bdg__size-sub {
  font-size: 10px;
  color: var(--color-muted);
}
.bdg__note {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--color-muted);
}

/* The sheet renders at physical size on screen AND in print — the
   size picker sets --bw/--bh (card), --bq (QR), --bname (name). */
.bdg__sheet {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--bw));
  gap: 14px;
  justify-content: start;
}
.bdg__card {
  width: var(--bw);
  height: var(--bh);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05in;
  padding: 0.1in;
  box-sizing: border-box;
  border: 1.5px solid var(--color-brand-600);
  border-radius: 10px;
  background: #fff;
  text-align: center;
  break-inside: avoid;
  overflow: hidden;
}
.bdg__card-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.bdg__org {
  font-size: 8pt;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-brand-700);
}
.bdg__day {
  font-size: 7.5pt;
  color: #5f6470;
}
.bdg__qr {
  width: var(--bq);
  height: var(--bq);
  border-radius: 4px;
}
.bdg__qr--loading {
  background: var(--color-surface-sunk);
}
.bdg__name {
  font-size: var(--bname);
  line-height: 1.15;
  font-weight: 700;
  color: #1a1d27;
}
.bdg__hint {
  font-size: 6.5pt;
  color: #767b86;
}
.bdg__sheet--compact .bdg__hint {
  display: none;
}
.bdg__sheet--compact .bdg__card-head {
  gap: 0;
}
.bdg__empty {
  padding: 56px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}

@media print {
  @page {
    size: letter;
    margin: 0.2in;
  }
  .bdg {
    max-width: none;
    padding: 0;
  }
  .bdg__toolbar,
  .bdg__note {
    display: none;
  }
  .bdg__sheet {
    gap: 0.12in 0.15in;
    justify-content: center;
  }
  .bdg__card {
    border-width: 1px;
    page-break-inside: avoid;
  }
}
</style>
