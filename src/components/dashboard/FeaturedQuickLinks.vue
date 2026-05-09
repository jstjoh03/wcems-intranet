<script setup lang="ts">
import { computed } from 'vue'
import IconRender from '@/components/primitives/IconRender.vue'
import linksData from '@/data/quicklinks.json'
import type { QuickLink } from '@/types'
import { useAuthStore } from '@/stores/auth'

/**
 * Hand-picked most-used shortcuts, surfaced just under the hero. Visual
 * treatment is deliberate: navy layered-gradient "glass command button"
 * — reads as operational control, not content card.
 *
 * Crew see the everyday stack (Outlook, Shoutout, Supply, Protocols).
 * Supervisors + admins swap Shoutout/Supply for Responder360 + Daily
 * Summary. Hospitals (an internal app page) closes the strip for
 * everyone since it's referenced constantly during transports.
 */
interface FeaturedTile {
  id: string
  label: string
  iconName: string
  url: string
  internal: boolean
}

const FEATURED_IDS_CREW = ['outlook', 'shoutout', 'supply-portal', 'protocols']
const FEATURED_IDS_SUPERVISOR = [
  'outlook',
  'responder360',
  'daily-summary',
  'protocols',
]

/**
 * Internal app pages surfaced in the strip without polluting
 * quicklinks.json (which is reserved for external utilities).
 */
const INTERNAL_HOSPITALS: FeaturedTile = {
  id: 'hospitals',
  label: 'Hospitals',
  iconName: 'Hospital',
  url: '/hospitals',
  internal: true,
}

const auth = useAuthStore()
const links = linksData as QuickLink[]

const featured = computed<FeaturedTile[]>(() => {
  const ids = auth.isSupervisor ? FEATURED_IDS_SUPERVISOR : FEATURED_IDS_CREW
  const externals = ids
    .map((id) => links.find((l) => l.id === id))
    .filter((l): l is QuickLink => !!l)
    .map<FeaturedTile>((l) => ({
      id: l.id,
      label: l.label,
      iconName: l.iconName,
      url: l.url,
      internal: false,
    }))
  return [...externals, INTERNAL_HOSPITALS]
})
</script>

<template>
  <section class="fql reveal" style="animation-delay: 90ms; margin-bottom: 32px">
    <ul class="fql__grid">
      <li v-for="l in featured" :key="l.id">
        <RouterLink
          v-if="l.internal"
          :to="l.url"
          class="fql__tile"
          :aria-label="l.label"
        >
          <span class="fql__shape">
            <IconRender
              :name="l.iconName"
              :size="22"
              :stroke-width="1.85"
              class="fql__icon"
            />
          </span>
          <span class="fql__name">{{ l.label }}</span>
        </RouterLink>
        <a
          v-else
          :href="l.url"
          target="_blank"
          rel="noopener noreferrer"
          class="fql__tile"
          :aria-label="l.label"
        >
          <span class="fql__shape">
            <IconRender
              :name="l.iconName"
              :size="22"
              :stroke-width="1.85"
              class="fql__icon"
            />
          </span>
          <span class="fql__name">{{ l.label }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* ── Layout: tight horizontal cluster ──────────────────────────────────
   On phones the four tiles stretch to fill the row (space is precious).
   On tablet+ they snap to a fixed width and cluster on the left so they
   read as command buttons, not stretched bars. */
.fql__grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (min-width: 640px) {
  .fql__grid {
    grid-template-columns: repeat(5, 124px);
    gap: 12px;
    justify-content: center;
  }
}
@media (max-width: 480px) {
  .fql__grid {
    /* Five tiles in one row even on phones — labels wrap if they need to */
    gap: 5px;
  }
}

/* ── Tile: anchor wrapper — shape on top, label below ──────────────── */
.fql__tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
}

/* ── Shape: navy glass squircle hugging the icon ───────────────────── */
.fql__shape {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;

  /* Layered navy gradient — slightly dimensional, not flat */
  background:
    linear-gradient(145deg, oklch(0.22 0.10 250) 0%, oklch(0.14 0.06 250) 100%);

  /* Subtle navy/gold-leaning border at low alpha */
  border: 1px solid oklch(0.45 0.10 250 / 0.32);
  /* iOS-style squircle — soft but unmistakably a square */
  border-radius: 16px;

  overflow: hidden;
  isolation: isolate;

  /* Stacked: top inner highlight + crisp contact + soft elevation +
     ambient navy glow at rest. */
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.06),
    0 1px 1px oklch(0 0 0 / 0.35),
    0 6px 14px oklch(0 0 0 / 0.22),
    0 0 22px oklch(0.35 0.14 250 / 0.18);

  transition:
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Glassy specular highlight along the top edge of the shape */
.fql__shape::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14%;
  right: 14%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(1 0 0 / 0.18) 50%,
    transparent 100%
  );
  pointer-events: none;
}

/* Hover: rise + scale, swap the ambient glow from navy to gold */
.fql__tile:hover .fql__shape {
  border-color: oklch(0.734 0.114 86.8 / 0.45);
  transform: translateY(-2px) scale(1.04);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 2px 2px oklch(0 0 0 / 0.4),
    0 14px 28px oklch(0 0 0 / 0.32),
    0 0 30px oklch(0.734 0.114 86.8 / 0.22);
}

/* Active: tight inward compression, snappier easing */
.fql__tile:active .fql__shape {
  transform: translateY(-1px) scale(1);
  transition-duration: 80ms;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.04),
    inset 0 2px 6px oklch(0 0 0 / 0.25),
    0 1px 2px oklch(0 0 0 / 0.3),
    0 0 18px oklch(0.734 0.114 86.8 / 0.18);
}

/* Keyboard focus ring — gold so it reads as the brand accent */
.fql__tile:focus-visible {
  outline: none;
}
.fql__tile:focus-visible .fql__shape {
  border-color: var(--color-accent-500);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 0 0 2px oklch(0.734 0.114 86.8 / 0.4),
    0 6px 14px oklch(0 0 0 / 0.22),
    0 0 30px oklch(0.734 0.114 86.8 / 0.25);
}

/* ── Icon ─────────────────────────────────────────────────────────── */
.fql__icon {
  color: oklch(0.96 0.005 250);
  /* Subtle drop-shadow so the icon catches a tiny rim-light */
  filter: drop-shadow(0 1px 1px oklch(0 0 0 / 0.5));
  transition: color 220ms var(--ease-out);
}
.fql__tile:hover .fql__icon {
  color: var(--color-accent-500);
}

/* ── Label sits under the shape, plain text on the page ───────────── */
.fql__name {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.005em;
  line-height: 1.2;
  color: var(--color-ink-soft);
  /* Allow up to 2 lines so two-word labels (Daily Summary, Employee
     Shoutout) wrap cleanly. Single long words like "Responder360" stay
     on one line — no mid-word breaking. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  overflow-wrap: normal;
  max-width: 100%;
  text-align: center;
  transition: color 220ms var(--ease-out);
}
.fql__tile:hover .fql__name {
  color: var(--color-ink);
}

@media (max-width: 480px) {
  .fql__shape {
    width: 50px;
    height: 50px;
    border-radius: 14px;
  }
  .fql__name {
    font-size: 10.5px;
  }
}
</style>
