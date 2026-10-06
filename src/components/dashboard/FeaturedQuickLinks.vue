<script setup lang="ts">
import { computed, ref } from 'vue'
import { Settings2 } from 'lucide-vue-next'
import IconRender from '@/components/primitives/IconRender.vue'
import { useAuthStore } from '@/stores/auth'
import { useQuickLinks } from '@/composables/useQuickLinks'
import { useScheduleAccess } from '@/composables/useScheduleAccess'
import FeaturedLinksEditModal from './FeaturedLinksEditModal.vue'

/**
 * Most-used shortcuts under the hero. Visual treatment is deliberate:
 * navy layered-gradient "glass command button" — reads as operational
 * control, not content card.
 *
 * Two tiles are FIXED anchors: Scheduling leads (the Aladtec
 * replacement — the operational center, shown to everyone the module
 * admits) and Hospitals closes (referenced constantly during
 * transports). Neither belongs in the catalog. Between them sit the
 * user's chosen tiles (app_users.featured_quick_link_ids, up to 4);
 * when the user has picked fewer than 4, the remaining slots fill
 * from role-based defaults so the strip is never bare. The "Edit"
 * pencil opens FeaturedLinksEditModal to change the middle tiles.
 */
interface FeaturedTile {
  id: string
  label: string
  iconName: string
  url: string
  internal: boolean
}

const FEATURED_LABELS_CREW = [
  'Outlook',
  'Protocols',
  'Employee Shoutout',
  'Supply Portal',
]
const FEATURED_LABELS_SUPERVISOR = [
  'Outlook',
  'Responder360',
  'Daily Summary',
  'Protocols',
]

const INTERNAL_HOSPITALS: FeaturedTile = {
  id: 'hospitals',
  label: 'Hospitals',
  iconName: 'Hospital',
  url: '/hospitals',
  internal: true,
}

/* Aladtec is gone (2026-09-28) — the scheduling module leads the
   default strip for anyone who hasn't customized, once the module
   admits them (soft-launch gate). */
/* Tile label is the short noun ("Schedule") — "Scheduling" breaks
   mid-word in the ~52px columns a six-tile row leaves on a 375px
   phone. Masthead/drawer/search keep the full module name. */
const INTERNAL_SCHEDULE: FeaturedTile = {
  id: 'schedule',
  label: 'Schedule',
  iconName: 'Calendar',
  url: '/schedule',
  internal: true,
}

const auth = useAuthStore()
const { links } = useQuickLinks()
const { canSeeSchedule } = useScheduleAccess()

const editOpen = ref(false)

function tileFromLink(l: { id: string; label: string; iconName: string; url: string }): FeaturedTile {
  return {
    id: l.id,
    label: l.label,
    iconName: l.iconName,
    url: l.url,
    internal: false,
  }
}

const featured = computed<FeaturedTile[]>(() => {
  const userIds = auth.appUser?.featuredQuickLinkIds ?? []
  const tiles: FeaturedTile[] = []

  /* 1) The user's chosen tiles, in their saved order, resolved
     against the live catalog. Missing IDs (e.g. admin deleted that
     link) silently drop. */
  for (const id of userIds) {
    const match = links.value.find((l) => l.id === id)
    if (match) tiles.push(tileFromLink(match))
    if (tiles.length >= 4) break
  }

  /* 2) Top up empty slots from the role-based default list, skipping
     anything already chosen above to avoid duplicates. */
  if (tiles.length < 4) {
    const defaultLabels = auth.isSupervisor
      ? FEATURED_LABELS_SUPERVISOR
      : FEATURED_LABELS_CREW
    for (const label of defaultLabels) {
      if (tiles.length >= 4) break
      const match = links.value.find((l) => l.label === label)
      if (!match) continue
      if (tiles.some((t) => t.id === match.id)) continue
      tiles.push(tileFromLink(match))
    }
  }

  /* 3) Scheduling ALWAYS leads for anyone the module admits —
     customized or not. Crews kept reporting "no scheduling quick
     link" because the lead tile used to show only for users who had
     never customized the strip (and the picker can't add it). Fixed
     anchor now, exactly like Hospitals at the tail. */
  const lead = canSeeSchedule.value ? [INTERNAL_SCHEDULE] : []

  return [...lead, ...tiles.slice(0, 4), INTERNAL_HOSPITALS]
})
</script>

<template>
  <section class="fql reveal" style="animation-delay: 90ms; margin-bottom: 32px">
    <ul class="fql__grid" :style="{ '--fql-cols': featured.length }">
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

    <button
      v-if="auth.appUser && !auth.isKiosk"
      type="button"
      class="fql__edit"
      aria-label="Customize featured shortcuts"
      @click="editOpen = true"
    >
      <Settings2 :size="12" :stroke-width="1.85" />
      <span>Customize</span>
    </button>

    <FeaturedLinksEditModal :open="editOpen" @close="editOpen = false" />
  </section>
</template>

<style scoped>
/* ── Layout: tight horizontal cluster ──────────────────────────────────
   On phones the four tiles stretch to fill the row (space is precious).
   On tablet+ they snap to a fixed width and cluster on the left so they
   read as command buttons, not stretched bars. */
.fql {
  position: relative;
}
.fql__grid {
  display: grid;
  /* Column count follows the tile count (5, or 6 once the fixed
     Scheduling lead is admitted) — bound inline as --fql-cols.
     minmax(0, 1fr) lets tracks compress below a long label's
     min-content so six tiles never push past the phone edge. */
  grid-template-columns: repeat(var(--fql-cols, 5), minmax(0, 1fr));
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Customize affordance — small, low-emphasis pill below the strip
   (right-aligned on tablet+, full-width on phones). Only shows for
   signed-in users since it persists per-user. */
.fql__edit {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 4px 12px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--color-muted);
  cursor: pointer;
  transition:
    color 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.fql__edit:hover {
  color: var(--color-ink);
  border-color: var(--color-muted-soft);
}
@media (min-width: 640px) {
  .fql__edit {
    position: absolute;
    right: 0;
    top: -2px;
    margin-top: 0;
  }
}
@media (min-width: 640px) {
  .fql__grid {
    /* minmax(0, 124px) instead of a hard 124px: with six tiles the
       row would otherwise overflow narrow tablets — tracks shrink
       evenly when the container runs out of room. */
    grid-template-columns: repeat(var(--fql-cols, 5), minmax(0, 124px));
    gap: 12px;
    justify-content: center;
  }
}
@media (max-width: 480px) {
  .fql__grid {
    /* All tiles in one row even on phones — labels wrap if they need to */
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
    /* 10px keeps every one-word label (Scheduling, Protocols,
       Hospitals) on a single line in the ~53px columns a six-tile
       row leaves on a 375px phone. */
    font-size: 10px;
    /* Last-resort break so a lone long word (Responder360) wraps
       instead of clipping or shoving the last tile off-screen. (This
       block sits after the base .fql__name rule, so it actually
       overrides overflow-wrap: normal.) */
    overflow-wrap: anywhere;
  }
}
@media (max-width: 374px) {
  /* Six tiles on the smallest phones (SE-class) — shrink the shapes
     so the row still fits without horizontal scroll. */
  .fql__shape {
    width: 44px;
    height: 44px;
    border-radius: 12px;
  }
  .fql__name {
    font-size: 9.5px;
  }
}
</style>
