<script setup lang="ts">
import { useRouter } from 'vue-router'
import { X, ClipboardCheck, Syringe } from 'lucide-vue-next'

/**
 * "Skills" points at two different boards — the NEOP Skills Day
 * check-offs and the 2026 protocol-update verifications — so every
 * Skills entry point asks which one first (Justin, 2026-10-23)
 * instead of silently defaulting to NEOP.
 */

const emit = defineEmits<{ close: [] }>()
const router = useRouter()

function go(to: string) {
  emit('close')
  void router.push(to)
}
</script>

<template>
  <div class="skc__scrim" @click.self="emit('close')">
    <div class="skc" role="dialog" aria-modal="true" aria-label="Which skills board?">
      <div class="skc__hd">
        <b class="display">Which skills board?</b>
        <button type="button" class="skc__x" aria-label="Close" @click="emit('close')">
          <X :size="16" :stroke-width="2" />
        </button>
      </div>
      <button type="button" class="skc__opt" @click="go('/skills')">
        <span class="skc__icon"><ClipboardCheck :size="19" :stroke-width="1.9" /></span>
        <span class="skc__txt">
          <b>NEOP Skills Day</b>
          <small>New-employee academy — station check-offs, live board, recheck queue</small>
        </span>
      </button>
      <button type="button" class="skc__opt" @click="go('/skills/protocol-updates')">
        <span class="skc__icon skc__icon--gold"><Syringe :size="19" :stroke-width="1.9" /></span>
        <span class="skc__txt">
          <b>2026 Protocol Updates</b>
          <small>Skills verification campaign — every credentialed employee, by level</small>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.skc__scrim {
  position: fixed; inset: 0; z-index: 95;
  background: oklch(0.2 0.03 260 / 0.45);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.skc {
  width: min(430px, 100%);
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 14px; padding: 16px;
  box-shadow: 0 24px 70px oklch(0.15 0.04 260 / 0.35);
}
.skc__hd { display: flex; align-items: center; margin: 2px 2px 12px; }
.skc__hd b { font-size: 20px; color: var(--color-ink); }
.skc__x { margin-left: auto; background: none; border: 0; color: var(--color-muted); cursor: pointer; padding: 4px; }
.skc__x:hover { color: var(--color-ink); }
.skc__opt {
  display: flex; align-items: center; gap: 13px; width: 100%; text-align: left;
  background: var(--color-surface); border: 1px solid var(--color-line);
  border-radius: 11px; padding: 13px 14px; cursor: pointer; margin-top: 8px;
  font-family: var(--font-sans);
  transition: border-color 120ms var(--ease-out), box-shadow 120ms var(--ease-out), transform 120ms var(--ease-out);
}
.skc__opt:hover {
  border-color: var(--color-accent-strong, #a8842c);
  box-shadow: 0 6px 20px oklch(0.2 0.03 260 / 0.1);
  transform: translateY(-1px);
}
.skc__icon {
  width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(145deg, oklch(0.22 0.1 250), oklch(0.14 0.06 250));
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.14), 0 4px 10px oklch(0.18 0.05 255 / 0.3);
}
.skc__icon--gold {
  background: linear-gradient(145deg, oklch(0.78 0.11 86.8), oklch(0.6 0.12 86.8));
  color: var(--color-brand-950);
}
.skc__txt { display: grid; gap: 1px; min-width: 0; }
.skc__txt b { font-size: 14px; color: var(--color-ink); }
.skc__txt small { font-size: 11.5px; color: var(--color-muted); line-height: 1.4; }
</style>
