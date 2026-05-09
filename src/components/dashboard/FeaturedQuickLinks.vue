<script setup lang="ts">
import { computed } from 'vue'
import IconRender from '@/components/primitives/IconRender.vue'
import linksData from '@/data/quicklinks.json'
import type { QuickLink } from '@/types'

/**
 * Hand-picked four most-used shortcuts, surfaced just under the on-call
 * card. Visual treatment is deliberate: navy layered-gradient "glass
 * command button" — reads as operational control, not content card.
 *
 * Selection is intentionally hard-coded for now. If we want it user-
 * editable later, swap to a `featured: boolean` field on each link in
 * quicklinks.json and pull the IDs from there.
 */
const FEATURED_IDS = ['outlook', 'shoutout', 'supply-portal', 'aladtec']

const links = linksData as QuickLink[]

const featured = computed(() =>
  FEATURED_IDS.map((id) => links.find((l) => l.id === id)).filter(
    (l): l is QuickLink => !!l,
  ),
)
</script>

<template>
  <section class="fql reveal" style="animation-delay: 90ms; margin-bottom: 32px">
    <ul class="fql__grid">
      <li v-for="l in featured" :key="l.id">
        <a
          :href="l.url"
          target="_blank"
          rel="noopener noreferrer"
          class="fql__tile"
          :aria-label="l.label"
        >
          <span class="fql__icon">
            <IconRender :name="l.iconName" :size="18" :stroke-width="1.85" />
          </span>
          <span class="fql__name">{{ l.label }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* ── Layout: tight horizontal grid ─────────────────────────────────── */
.fql__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (max-width: 480px) {
  .fql__grid {
    /* Keep all four in one row even on phones — they're tight enough */
    gap: 6px;
  }
}

/* ── Tile: navy glass command button ───────────────────────────────── */
.fql__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 12px 8px 11px;
  min-height: 72px;

  /* Layered navy gradient — slightly dimensional, not flat */
  background:
    linear-gradient(145deg, oklch(0.22 0.10 250) 0%, oklch(0.14 0.06 250) 100%);

  /* Subtle navy/gold-leaning border at low alpha */
  border: 1px solid oklch(0.45 0.10 250 / 0.32);
  border-radius: 14px;

  text-decoration: none;
  cursor: pointer;
  user-select: none;
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

/* Glassy specular highlight along the top edge of the tile */
.fql__tile::before {
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
.fql__tile:hover {
  border-color: oklch(0.734 0.114 86.8 / 0.45);
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 2px 2px oklch(0 0 0 / 0.4),
    0 14px 28px oklch(0 0 0 / 0.32),
    0 0 30px oklch(0.734 0.114 86.8 / 0.22);
}

/* Active: tight inward compression, snappier easing */
.fql__tile:active {
  transform: translateY(-1px) scale(0.99);
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
  border-color: var(--color-accent-500);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 0 0 2px oklch(0.734 0.114 86.8 / 0.4),
    0 6px 14px oklch(0 0 0 / 0.22),
    0 0 30px oklch(0.734 0.114 86.8 / 0.25);
}

/* ── Icon ─────────────────────────────────────────────────────────── */
.fql__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: oklch(0.96 0.005 250);
  /* Subtle drop-shadow so the icon catches a tiny rim-light */
  filter: drop-shadow(0 1px 1px oklch(0 0 0 / 0.5));
  transition: color 220ms var(--ease-out), transform 220ms var(--ease-out);
}
.fql__tile:hover .fql__icon {
  color: var(--color-accent-500);
}

/* ── Label ────────────────────────────────────────────────────────── */
.fql__name {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.005em;
  line-height: 1.2;
  color: oklch(0.88 0.015 250);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
  transition: color 220ms var(--ease-out);
}
.fql__tile:hover .fql__name {
  color: white;
}

@media (max-width: 480px) {
  .fql__tile {
    min-height: 64px;
    padding: 10px 6px;
  }
  .fql__icon {
    width: 20px;
    height: 20px;
  }
  .fql__name {
    font-size: 10.5px;
  }
}
</style>
