<script setup lang="ts">
import { computed } from 'vue'
import type { PipelinePerson } from '@/types'
import {
  TRANSITIONS,
  activeTransitionFor,
  gateItemsFor,
  petitionItemsFor,
  jurisprudenceDue,
} from '@/constants/pipelineGates'
import { usePipeline } from '@/composables/usePipeline'
import PipelineGateRow from './PipelineGateRow.vue'

/**
 * Read-only expanded person panel — the two-panel layout from the
 * approved pipeline board: credentialing gates (with the petition
 * signature chain) beside compliance & credentials, plus coverage/
 * blocker notes. ALL editing happens in PipelinePersonModal (opened
 * from the row's Edit button) — this panel is for reading fast.
 */

const props = defineProps<{
  person: PipelinePerson
}>()

const { gatesFor } = usePipeline()

const record = computed(() => props.person.record)
const transition = computed(() => activeTransitionFor(record.value))
const def = computed(() => (transition.value ? TRANSITIONS[transition.value] : null))
const gateRows = computed(() => gatesFor(record.value.id))
const items = computed(() => gateItemsFor(record.value, gateRows.value))
const petitions = computed(() => petitionItemsFor(record.value, gateRows.value))

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div class="pd">
    <div class="pd__panels">
      <!-- Credentialing gates -->
      <div class="pd__panel">
        <h4 class="pd__h">
          Credentialing gates
          <span v-if="def" class="pd__h-sub">{{ def.label }}</span>
        </h4>
        <template v-if="items.length">
          <PipelineGateRow v-for="item in items" :key="item.key" :item="item" :editable="false" />
          <div v-if="petitions.length" class="pd__pets">
            <div
              v-for="p in petitions"
              :key="p.key"
              class="pd__sig"
              :class="{ 'pd__sig--ok': p.status === 'complete' }"
            >
              <span class="pd__sig-role">{{ p.label }}</span>
              <span class="pd__sig-state">{{ p.status === 'complete' ? `✓ ${p.value || 'Signed'}` : '—' }}</span>
            </div>
          </div>
        </template>
        <p v-else class="pd__none">
          No active progression — {{ record.clearedPhase === 'FinalRelease' ? 'fully credentialed.' : 'not currently in a phase.' }}
        </p>
      </div>

      <!-- Compliance & credentials -->
      <div class="pd__panel">
        <h4 class="pd__h">Compliance &amp; credentials</h4>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.txLicenseExpiresAt }">{{ record.txLicenseExpiresAt ? '✓' : '·' }}</span><span class="pd__fk">TX license expires</span><span class="pd__fv">{{ fmt(record.txLicenseExpiresAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="jurisprudenceDue(record) ? 'pd__ic--warn' : 'pd__ic--ok'">{{ jurisprudenceDue(record) ? '!' : '✓' }}</span><span class="pd__fk">TX jurisprudence</span><span class="pd__fv">{{ jurisprudenceDue(record) ? 'due this cycle' : fmt(record.txJurisprudenceAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.bloodbornePathogenAt }">{{ record.bloodbornePathogenAt ? '✓' : '·' }}</span><span class="pd__fk">Bloodborne pathogens</span><span class="pd__fv">{{ fmt(record.bloodbornePathogenAt) }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': record.opIqAccess }">{{ record.opIqAccess ? '✓' : '·' }}</span><span class="pd__fk">Operative IQ access</span><span class="pd__fv">{{ record.opIqAccess ? (record.opIqGrantedAt ? fmt(record.opIqGrantedAt) : 'held') : '—' }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': record.narcSafeAccess }">{{ record.narcSafeAccess ? '✓' : '·' }}</span><span class="pd__fk">NarcSafe access</span><span class="pd__fv">{{ record.narcSafeAccess ? (record.narcSafeGrantedAt ? fmt(record.narcSafeGrantedAt) : 'held') : '—' }}</span></div>
        <div class="pd__fact"><span class="pd__ic" :class="{ 'pd__ic--ok': !!record.workingStartedAt }">{{ record.workingStartedAt ? '✓' : '·' }}</span><span class="pd__fk">Phase started</span><span class="pd__fv">{{ fmt(record.workingStartedAt) }}</span></div>
        <div v-if="record.txLicenseNumber" class="pd__fact"><span class="pd__ic pd__ic--ok">✓</span><span class="pd__fk">TX license #</span><span class="pd__fv">{{ record.txLicenseNumber }}</span></div>

        <div v-if="record.coverageNote" class="pd__note"><b>Coverage impact:</b> {{ record.coverageNote }}</div>
        <div v-if="record.blockerNote" class="pd__note pd__note--bad"><b>Blocker:</b> {{ record.blockerNote }}</div>
        <div v-if="record.pipActive && record.pipReason" class="pd__note pd__note--bad"><b>PIP:</b> {{ record.pipReason }}</div>
        <div v-if="record.notes" class="pd__note"><b>Notes:</b> {{ record.notes }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pd {
  padding: 16px 18px 18px;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-line-soft);
}
.pd__panels {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
@media (min-width: 900px) {
  .pd__panels {
    grid-template-columns: 1.2fr 1fr;
  }
}
.pd__panel {
  background: var(--color-surface);
  border: 1px solid var(--color-line-soft);
  border-radius: 12px;
  padding: 14px 16px;
}
.pd__h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.pd__h-sub {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--color-accent-700);
}
.pd__none {
  font-size: 12.5px;
  color: var(--color-muted-soft);
  padding: 6px 0;
}
.pd__pets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.pd__sig {
  border: 1.5px dashed var(--color-line);
  border-radius: 9px;
  padding: 8px 6px;
  text-align: center;
  background: var(--color-surface);
}
.pd__sig--ok {
  border-style: solid;
  border-color: var(--color-success-500);
  background: var(--color-success-50);
}
.pd__sig-role {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.pd__sig-state {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--color-ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd__sig--ok .pd__sig-state {
  color: var(--color-success-500);
  font-weight: 600;
}
.pd__fact {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 13px;
}
.pd__fact:last-of-type {
  border-bottom: none;
}
.pd__ic {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  border: 1.5px solid var(--color-line);
  color: var(--color-muted);
}
.pd__ic--ok {
  background: var(--color-success-50);
  border-color: var(--color-success-500);
  color: var(--color-success-500);
}
.pd__ic--warn {
  background: var(--color-warning-50);
  border-color: oklch(0.6 0.13 75);
  color: oklch(0.5 0.12 75);
}
.pd__fk {
  flex: 1;
  color: var(--color-ink);
}
.pd__fv {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}
.pd__note {
  margin-top: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--color-accent-600);
  background: var(--color-surface-soft);
  border-radius: 0 8px 8px 0;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.pd__note--bad {
  border-left-color: var(--color-danger-500);
}
</style>
