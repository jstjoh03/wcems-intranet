<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useScheduleAccess } from '@/composables/useScheduleAccess'
import type { VerifyBlock, SignoffPending } from '@/composables/useSchedule'

/**
 * App-open pop-up for the time-verification prompts, modeled on the
 * profile-completion modal: EVERYONE with something waiting sees it
 * once per session when the intranet opens (Justin, 2026-09-29 — it
 * started as a push-fallback, but push can be dismissed and payroll
 * still needs the approval). Only prompts from the chain's go-live
 * period surface. The cards on My schedule stay the durable home.
 * No SMS anywhere in this flow.
 */

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const access = useScheduleAccess()

const open = ref(false)
const blocks = ref<VerifyBlock[]>([])
const signoff = ref<SignoffPending | null>(null)

const KEY = 'wcems:verify-nudge-shown'

onMounted(() => {
  // let the page land first — this is a background check, not chrome
  window.setTimeout(() => void check(), 3000)
})

async function check() {
  try {
    if (sessionStorage.getItem(KEY)) return
  } catch {
    return // private mode — just don't nag
  }
  if (!auth.appUser || auth.isKiosk || auth.usingDevStub) return
  if (route.path.startsWith('/schedule')) return // the cards are right there
  if (!access.canSeeSchedule.value) return

  // dynamic import — the scheduling store is a big lazy chunk and this
  // check must not drag it into the portal's entry bundle
  const mod = await import('@/composables/useSchedule')
  const sched = mod.useSchedule()
  await sched.ensureLoaded()
  const res = await sched.fetchMyVerifyPending()
  const floor = mod.VERIFY_SURFACE_FLOOR_ISO
  const dueBlocks = res.blocks.filter((b) => b.dates[b.dates.length - 1] >= floor)
  const dueSignoff = res.signoff && res.signoff.period.end >= floor ? res.signoff : null
  if (dueBlocks.length === 0 && !dueSignoff) return
  blocks.value = dueBlocks
  signoff.value = dueSignoff
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    /* best effort */
  }
  open.value = true
}

function fmtD(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function blockLabel(b: VerifyBlock): string {
  const f = fmtD(b.dates[0])
  const l = fmtD(b.dates[b.dates.length - 1])
  return b.dates.length > 1 ? `${f} – ${l}` : f
}

function go() {
  open.value = false
  void router.push('/schedule?v=mine')
}
</script>

<template>
  <div v-if="open" class="vn__overlay" @click.self="open = false">
    <div class="vn__card" role="dialog" aria-label="Time verification needed">
      <h3 class="vn__title">Time verification needed</h3>
      <p class="vn__sub">Payroll runs off the schedule — a minute now saves a paycheck fix later.</p>
      <ul class="vn__list">
        <li v-for="b in blocks" :key="b.endMs">Verify your shift times — {{ blockLabel(b) }}</li>
        <li v-if="signoff">
          Approve your pay-period hours — {{ signoff.period.label }}
          <b v-if="signoff.overdue" class="vn__late">past due</b>
          <span v-else class="vn__due">due {{ signoff.dueText }}</span>
        </li>
      </ul>
      <div class="vn__btns">
        <button class="vn__btn vn__btn--go" @click="go">Open My schedule</button>
        <button class="vn__btn" @click="open = false">Not now</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vn__overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: oklch(0.25 0.03 260 / 0.42);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
}

.vn__card {
  width: min(440px, 100%);
  background:
    linear-gradient(180deg, oklch(1 0 0 / 0.92), oklch(0.985 0.004 84 / 0.92)),
    var(--color-surface);
  border: 1px solid var(--color-line);
  border-top: 3px solid var(--color-accent-600);
  border-radius: 14px;
  box-shadow:
    0 24px 60px oklch(0.2 0.04 260 / 0.28),
    0 4px 14px oklch(0.2 0.04 260 / 0.12);
  padding: 1.1rem 1.25rem 1.15rem;
}

.vn__title {
  font-family: var(--font-display);
  font-size: 1.3rem;
  color: var(--color-ink);
  margin: 0 0 0.25rem;
}

.vn__sub {
  font-size: 0.82rem;
  color: var(--color-muted);
  margin: 0 0 0.7rem;
}

.vn__list {
  margin: 0 0 0.9rem;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.35rem;
  font-size: 0.87rem;
  color: var(--color-ink-soft);
}

.vn__due {
  font-size: 0.74rem;
  color: oklch(0.5 0.13 60);
  font-weight: 700;
  margin-left: 4px;
}

.vn__late {
  font-size: 0.74rem;
  color: var(--color-danger-500);
  font-weight: 700;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.vn__btns {
  display: flex;
  gap: 0.8rem;
  align-items: center;
}

.vn__btn {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  border: 0;
  background: none;
  color: var(--color-ink-soft);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--color-line);
  text-underline-offset: 3px;
  padding: 2px;
}

.vn__btn:hover {
  color: var(--color-ink);
  text-decoration-color: var(--color-accent-600);
}

.vn__btn--go {
  color: white;
  background: linear-gradient(180deg, var(--color-brand-700), var(--color-brand-800));
  border-radius: 9px;
  padding: 7px 16px;
  text-decoration: none;
}

.vn__btn--go:hover {
  color: white;
  filter: brightness(1.1);
}
</style>
