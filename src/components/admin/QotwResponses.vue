<script setup lang="ts">
import { Check, X } from 'lucide-vue-next'

/**
 * Who answered what on a Question of the Week — the admin/retraining
 * breakdown inside /admin/qotw. Poll ballots grouped per option (the
 * correct one flagged, so the names under a wrong option are the
 * retraining list), then the open-text answers.
 */

defineProps<{
  groups: { label: string; correct: boolean; names: string[] }[]
  answers: { name: string; body: string }[]
}>()
</script>

<template>
  <div class="qr">
    <div v-for="g in groups" :key="g.label" class="qr__group" :class="{ 'qr__group--correct': g.correct }">
      <div class="qr__group-head">
        <span v-if="g.correct" class="qr__mark qr__mark--right"><Check :size="11" :stroke-width="2.6" /></span>
        <span v-else-if="groups.some((x) => x.correct)" class="qr__mark qr__mark--wrong"><X :size="11" :stroke-width="2.6" /></span>
        <b>{{ g.label }}</b>
        <span class="qr__count">{{ g.names.length }}</span>
      </div>
      <div class="qr__names">{{ g.names.length ? g.names.join(', ') : '—' }}</div>
    </div>
    <div v-if="answers.length" class="qr__answers">
      <div class="qr__answers-head">Written answers</div>
      <div v-for="(a, i) in answers" :key="i" class="qr__answer">
        <b>{{ a.name }}:</b> {{ a.body }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qr__group {
  border: 1px solid var(--color-line);
  border-radius: 9px;
  padding: 8px 11px;
  background: var(--color-surface-soft);
}
.qr__group--correct {
  border-color: oklch(0.55 0.12 150);
  background: oklch(0.975 0.02 150);
}
.qr__group-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--color-ink);
}
.qr__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: #fff;
  flex-shrink: 0;
}
.qr__mark--right { background: oklch(0.55 0.12 150); }
.qr__mark--wrong { background: oklch(0.72 0.1 28); }
.qr__count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted);
}
.qr__names {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-ink-soft);
}
.qr__answers {
  border: 1px solid var(--color-line);
  border-radius: 9px;
  padding: 8px 11px;
}
.qr__answers-head {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 5px;
}
.qr__answer {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--color-ink-soft);
  padding: 3px 0;
}
.qr__answer b { color: var(--color-ink); }
</style>
