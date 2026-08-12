<script setup lang="ts">
import { ref } from 'vue'
import type { PipelinePerson } from '@/types'
import {
  badgeKeyFor,
  phaseLabel,
  pillFor,
  progressPct,
  warningChips,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'
import PipelinePersonDetail from './PipelinePersonDetail.vue'

/**
 * The pipeline table from the approved portal mockup — Name /
 * Credential / Phase / Progress / Lacking / Target / FTO — with each
 * row expanding into the board's two-panel gate + compliance detail.
 * Pending-cohort rows get the dashed "ghost" treatment.
 */

defineProps<{
  people: PipelinePerson[]
}>()

const { gatesFor } = usePipeline()

const openId = ref<string | null>(null)
function toggle(id: string) {
  openId.value = openId.value === id ? null : id
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function phaseText(p: PipelinePerson): string {
  const r = p.record
  if (r.pending) return `NEOP — starts ${fmtShort(r.workingStartedAt)}`
  if (r.inAemtUpgrade) return 'AEMT Upgrade'
  if (r.inP3Process) return 'P3 / FTO Process'
  if (r.workingPhase) return phaseLabel(r.workingPhase)
  if (r.clearedPhase) return `Cleared · ${phaseLabel(r.clearedPhase)}`
  return '—'
}

function meta(p: PipelinePerson): string {
  return [p.station, p.shift ? `${p.shift}-shift` : ''].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="pt__wrap">
    <table class="pt">
      <thead>
        <tr>
          <th>Name</th>
          <th>Credential</th>
          <th>Phase</th>
          <th>Progress</th>
          <th>Lacking to advance</th>
          <th>Target</th>
          <th>FTO</th>
          <th aria-hidden="true"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="p in people" :key="p.userId">
          <tr
            class="pt__row"
            :class="{ 'pt__row--ghost': p.record.pending, 'pt__row--open': openId === p.userId }"
            @click="toggle(p.userId)"
          >
            <td>
              <span class="pt__name">{{ p.fullName }}</span>
              <span v-if="meta(p)" class="pt__meta">{{ meta(p) }}</span>
            </td>
            <td>
              <span class="pt__badge" :class="`pt__badge--${badgeKeyFor(p.record.level)}`">
                {{ p.record.level || p.record.certLevel || '—' }}
              </span>
            </td>
            <td class="pt__phase">{{ phaseText(p) }}</td>
            <td>
              <span class="pt__prog"><i :style="{ width: `${progressPct(p.record, gatesFor(p.record.id))}%` }"></i></span>
            </td>
            <td>
              <span
                v-for="c in warningChips(p.record)"
                :key="c.text"
                class="pt__chip"
                :class="`pt__chip--${c.severity}`"
              >{{ c.text }}</span>
              <span
                class="pt__pill"
                :class="`pt__pill--${pillFor(p.record, gatesFor(p.record.id)).variant}`"
              >{{ pillFor(p.record, gatesFor(p.record.id)).text }}</span>
            </td>
            <td class="pt__mono">{{ fmtShort(p.record.workingTargetAt) }}</td>
            <td class="pt__fto">{{ p.record.ftoName || (p.record.isFto ? 'Is FTO' : '—') }}</td>
            <td><span class="pt__chev" :class="{ 'pt__chev--open': openId === p.userId }">▶</span></td>
          </tr>
          <tr v-if="openId === p.userId" class="pt__detail">
            <td colspan="8">
              <PipelinePersonDetail :person="p" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="people.length === 0" class="pt__empty">No one matches the current filters.</p>
  </div>
</template>

<style scoped>
.pt__wrap {
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow-x: auto;
}
.pt {
  width: 100%;
  border-collapse: collapse;
  min-width: 880px;
}
.pt th {
  text-align: left;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-line);
  white-space: nowrap;
}
.pt td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13px;
  color: var(--color-ink);
  vertical-align: middle;
}
.pt__row {
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.pt__row:hover {
  background: var(--color-surface-soft);
}
.pt__row--open {
  background: var(--color-surface-soft);
}
.pt__row--ghost td {
  background: var(--color-surface-soft);
  color: var(--color-muted);
}
.pt__row--ghost .pt__name {
  color: var(--color-ink-soft);
}
.pt__detail > td {
  padding: 0;
  background: var(--color-surface-soft);
}
.pt__name {
  font-weight: 600;
}
.pt__meta {
  display: block;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted-soft);
  margin-top: 2px;
}
.pt__badge {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
}
.pt__badge--P1C {
  background: oklch(0.94 0.03 300);
  color: oklch(0.42 0.12 300);
}
.pt__badge--P1 {
  background: oklch(0.94 0.03 240);
  color: oklch(0.4 0.1 240);
}
.pt__badge--P2 {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.pt__badge--FTO {
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
}
.pt__badge--other {
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
}
.pt__phase {
  white-space: nowrap;
}
.pt__prog {
  display: inline-block;
  width: 110px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-line-soft);
  overflow: hidden;
  vertical-align: middle;
}
.pt__prog i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-accent-600), var(--color-accent-400));
}
.pt__pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 999px;
  white-space: nowrap;
}
.pt__pill--open {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.pt__pill--ready {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.pt__pill--hold {
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
}
.pt__pill--credentialed {
  background: linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900));
  color: var(--color-accent-on-dark);
}
.pt__pill--none {
  color: var(--color-muted-soft);
  background: transparent;
}
.pt__chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 2.5px 8px;
  border-radius: 999px;
  margin-right: 6px;
  white-space: nowrap;
}
.pt__chip--warn {
  background: var(--color-warning-50);
  color: oklch(0.5 0.12 75);
}
.pt__chip--bad {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.pt__mono {
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}
.pt__fto {
  white-space: nowrap;
}
.pt__chev {
  display: inline-block;
  font-size: 9px;
  color: var(--color-muted-soft);
  transition: transform 140ms var(--ease-out);
}
.pt__chev--open {
  transform: rotate(90deg);
}
.pt__empty {
  padding: 26px;
  text-align: center;
  font-size: 13px;
  color: var(--color-muted-soft);
}
</style>
