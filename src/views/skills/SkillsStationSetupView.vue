<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ClipboardList, RotateCcw, Check } from 'lucide-vue-next'
import { useSkillsDay } from '@/composables/useSkillsDay'

/**
 * Station setup checklist: the equipment pull list for each station,
 * checkable while staging. Lists live on each check-off (Setup tab →
 * station editor → "Station setup equipment"); checks persist on this
 * device only, so stage from one phone or laptop.
 */

const router = useRouter()
const { ready, checkoffs, isEvaluator } = useSkillsDay()

const COMMON = [
  'Printed QR badges (Skills Day → day chip → QR badges)',
  'Printed blank packet PDFs as paper backup',
  'Station signs + painter’s tape',
  'Rotation timer or bell',
  'Live board on the training-room TV (Skills Day → Board)',
  'Study table: chairs, power strip, phone chargers, spare earbuds',
  'Gloves all sizes · sanitizer · trash bags',
]

const stations = computed(() =>
  checkoffs.value.filter((c) => (c.equipment ?? []).length > 0),
)

const STORE = 'wcems-station-setup-checks'
const checks = ref<Record<string, boolean>>({})

onMounted(() => {
  try {
    checks.value = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}
  } catch {
    checks.value = {}
  }
})

function keyFor(scope: string, idx: number): string {
  return `${scope}:${idx}`
}

function toggle(scope: string, idx: number) {
  const k = keyFor(scope, idx)
  checks.value = { ...checks.value, [k]: !checks.value[k] }
  try {
    localStorage.setItem(STORE, JSON.stringify(checks.value))
  } catch {
    /* storage unavailable — checks just won't persist */
  }
}

function isDone(scope: string, idx: number): boolean {
  return !!checks.value[keyFor(scope, idx)]
}

function doneCount(scope: string, len: number): number {
  let n = 0
  for (let i = 0; i < len; i++) if (isDone(scope, i)) n++
  return n
}

function resetAll() {
  checks.value = {}
  try {
    localStorage.removeItem(STORE)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="stp">
    <header class="stp__header">
      <div class="stp__head-left">
        <ClipboardList :size="22" :stroke-width="1.85" style="color: var(--color-brand-600)" />
        <div>
          <h1 class="display stp__title">Station setup</h1>
          <div class="stp__meta">Equipment pull lists · checks are saved on this device only</div>
        </div>
      </div>
      <div class="stp__actions">
        <button type="button" class="stp__btn" @click="router.push('/skills')">
          <ArrowLeft :size="14" :stroke-width="2" /> Skills Day
        </button>
        <button type="button" class="stp__btn" @click="resetAll">
          <RotateCcw :size="14" :stroke-width="2" /> Reset checks
        </button>
      </div>
    </header>

    <div v-if="!ready" class="stp__empty">Loading…</div>
    <div v-else-if="!isEvaluator" class="stp__empty">Evaluator access needed.</div>

    <template v-else>
      <div v-if="!stations.length" class="stp__empty">
        No station equipment lists yet — add them in Skills Day → Setup → station editor.
      </div>

      <div class="stp__grid">
        <section v-for="c in stations" :key="c.id" class="stp__card">
          <div class="stp__card-head">
            <div>
              <h2 class="stp__card-title">{{ c.title }}</h2>
              <div v-if="c.subtitle" class="stp__card-sub">{{ c.subtitle }}</div>
            </div>
            <span
              class="stp__count"
              :class="{ 'stp__count--done': doneCount(c.id, c.equipment!.length) === c.equipment!.length }"
            >
              {{ doneCount(c.id, c.equipment!.length) }}/{{ c.equipment!.length }}
            </span>
          </div>
          <ul class="stp__list">
            <li
              v-for="(item, i) in c.equipment"
              :key="i"
              class="stp__item"
              :class="{ 'stp__item--done': isDone(c.id, i) }"
              role="checkbox"
              :aria-checked="isDone(c.id, i)"
              tabindex="0"
              @click="toggle(c.id, i)"
              @keydown.space.prevent="toggle(c.id, i)"
              @keydown.enter.prevent="toggle(c.id, i)"
            >
              <span class="stp__box"><Check :size="11" :stroke-width="3" /></span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </section>

        <section class="stp__card">
          <div class="stp__card-head">
            <div>
              <h2 class="stp__card-title">Common / command</h2>
              <div class="stp__card-sub">Both days</div>
            </div>
            <span
              class="stp__count"
              :class="{ 'stp__count--done': doneCount('common', COMMON.length) === COMMON.length }"
            >
              {{ doneCount('common', COMMON.length) }}/{{ COMMON.length }}
            </span>
          </div>
          <ul class="stp__list">
            <li
              v-for="(item, i) in COMMON"
              :key="i"
              class="stp__item"
              :class="{ 'stp__item--done': isDone('common', i) }"
              role="checkbox"
              :aria-checked="isDone('common', i)"
              tabindex="0"
              @click="toggle('common', i)"
              @keydown.space.prevent="toggle('common', i)"
              @keydown.enter.prevent="toggle('common', i)"
            >
              <span class="stp__box"><Check :size="11" :stroke-width="3" /></span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stp {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}
.stp__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.stp__head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.stp__title {
  margin: 0;
  font-size: 26px;
  color: var(--color-brand-700);
}
.stp__meta {
  font-size: 13px;
  color: var(--color-muted);
}
.stp__actions {
  display: flex;
  gap: 8px;
}
.stp__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border-radius: 10px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink-soft);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.stp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  align-items: start;
}
.stp__card {
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: var(--color-surface);
  padding: 14px 16px;
  break-inside: avoid;
}
.stp__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.stp__card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-ink);
}
.stp__card-sub {
  font-size: 11.5px;
  color: var(--color-accent-700);
  font-weight: 600;
  letter-spacing: 0.03em;
}
.stp__count {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-muted);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 9px;
  white-space: nowrap;
}
.stp__count--done {
  color: oklch(0.42 0.1 155);
  border-color: oklch(0.8 0.09 155);
  background: oklch(0.95 0.045 155);
}
.stp__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.stp__item {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 6px 2px;
  font-size: 13.5px;
  color: var(--color-ink-soft);
  cursor: pointer;
  border-radius: 8px;
}
.stp__item:hover {
  background: var(--color-surface-soft);
}
.stp__item--done {
  color: var(--color-muted);
}
.stp__box {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border: 1.5px solid var(--color-muted-soft);
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: transparent;
}
.stp__item--done .stp__box {
  background: oklch(0.52 0.1 155);
  border-color: oklch(0.52 0.1 155);
  color: #fff;
}
.stp__empty {
  padding: 56px 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
}
@media print {
  .stp__actions {
    display: none;
  }
  .stp__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
