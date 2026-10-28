<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Printer } from 'lucide-vue-next'
import { useSkillsDay } from '@/composables/useSkillsDay'
import { qrDataUrl } from '@/training/lib/qr'

/**
 * Printable QR badge sheet for a Skills Day: one card per trainee.
 * Evaluators scan the card to open /skills/scan/<trainee> with the
 * station chooser pre-loaded. Print on cardstock, cut, hand out at the
 * morning brief.
 */

const route = useRoute()
const router = useRouter()
const { ready, days, isEvaluator, candidatesForDay } = useSkillsDay()

const dayId = computed(() => String(route.params.dayId ?? ''))
const day = computed(() => days.value.find((d) => d.id === dayId.value) ?? null)
const people = computed(() => (day.value ? candidatesForDay(day.value.id) : []))

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
      <button type="button" class="bdg__btn bdg__btn--primary" @click="printSheet">
        <Printer :size="15" :stroke-width="2" /> Print badges
      </button>
    </div>

    <div v-if="!ready" class="bdg__empty">Loading…</div>
    <div v-else-if="!isEvaluator" class="bdg__empty">Evaluator access needed.</div>
    <div v-else-if="!day" class="bdg__empty">Skills Day not found.</div>
    <div v-else-if="!people.length" class="bdg__empty">No trainees assigned to this day yet.</div>

    <div v-else class="bdg__sheet">
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
  max-width: 860px;
  margin: 0 auto;
  padding: 18px 16px 48px;
}
.bdg__toolbar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
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
.bdg__sheet {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.bdg__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 16px 16px;
  border: 1.5px solid var(--color-brand-600);
  border-radius: 14px;
  background: #fff;
  text-align: center;
  break-inside: avoid;
}
.bdg__card-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.bdg__org {
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-brand-700);
}
.bdg__day {
  font-size: 11px;
  color: var(--color-muted);
}
.bdg__qr {
  width: 168px;
  height: 168px;
  border-radius: 6px;
}
.bdg__qr--loading {
  background: var(--color-surface-sunk);
}
.bdg__name {
  font-size: 19px;
  font-weight: 700;
  color: var(--color-ink);
}
.bdg__hint {
  font-size: 10.5px;
  color: var(--color-muted);
}
.bdg__empty {
  padding: 56px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
@media (max-width: 560px) {
  .bdg__sheet {
    grid-template-columns: 1fr;
  }
}
/* Print: standard 4in × 3in badge-holder inserts — cards come out at
   exactly 3.9in × 2.85in so they slide into the holder after cutting
   on the card border. Two across, three down per letter page. */
@media print {
  @page {
    size: letter;
    margin: 0.2in;
  }
  .bdg {
    max-width: none;
    padding: 0;
  }
  .bdg__toolbar {
    display: none;
  }
  .bdg__sheet {
    grid-template-columns: repeat(2, 3.9in);
    justify-content: center;
    gap: 0.12in 0.15in;
  }
  .bdg__card {
    width: 3.9in;
    height: 2.85in;
    padding: 0.12in;
    gap: 0.05in;
    border-width: 1px;
    border-radius: 10px;
    page-break-inside: avoid;
    justify-content: center;
  }
  .bdg__qr {
    width: 1.55in;
    height: 1.55in;
  }
  .bdg__name {
    font-size: 15pt;
  }
  .bdg__org {
    font-size: 8pt;
  }
  .bdg__day {
    font-size: 8pt;
  }
  .bdg__hint {
    font-size: 6.5pt;
  }
}
</style>
