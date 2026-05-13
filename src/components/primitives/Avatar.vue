<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * Universal avatar primitive. Renders the user's profile photo when
 * present; falls back to initials on a colored tile when not (or when
 * the photo URL is broken).
 *
 * Used by:
 *  - Employee Directory cards
 *  - User dropdown trigger (top-right) + dropdown panel header
 *  - Nav drawer footer
 *  - User profile modal header
 *
 * Sizing: pass `size` as one of the named variants (xs/sm/md/lg/xl) for
 * predictable scales, or a raw px number for one-offs. Variant strings
 * preserve the existing visual rhythm (the trigger avatar was 26px, the
 * panel was 40px, the directory card is 44px, etc.).
 *
 * Color: variants control which gold tile we use:
 *  - `on-dark`: muted accent for the navy topbar so the avatar doesn't
 *    read as a bright button (matches the legacy `--color-accent-on-dark`)
 *  - `on-light` (default): canonical accent-500 for white surfaces
 *
 * Photo load failures (404, bad URL) silently fall back to initials by
 * watching @error on the img element.
 */

const props = withDefaults(
  defineProps<{
    photoUrl?: string | null
    initials: string
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
    tone?: 'on-light' | 'on-dark'
    alt?: string
  }>(),
  {
    photoUrl: null,
    size: 'md',
    tone: 'on-light',
    alt: '',
  },
)

const SIZE_PX: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = {
  xs: 22,
  sm: 26,
  md: 36,
  lg: 44,
  xl: 56,
}

const px = computed(() =>
  typeof props.size === 'number' ? props.size : SIZE_PX[props.size],
)

/* Font size scales roughly with the tile — bigger avatar gets bigger
   initials. Tuned by eye against the prior hand-coded sizes. */
const fontPx = computed(() => {
  const s = px.value
  if (s <= 22) return 10
  if (s <= 26) return 12
  if (s <= 36) return 13
  if (s <= 44) return 15
  return 22
})

const radiusPx = computed(() => {
  const s = px.value
  if (s <= 26) return 6
  if (s <= 36) return 8
  if (s <= 44) return 10
  return 12
})

/* Local error flag so a broken photo URL silently degrades to the
   initials state instead of showing a broken-image icon. Reset when
   the photoUrl prop changes (e.g. after the user uploads a new one). */
const broken = ref(false)
watch(
  () => props.photoUrl,
  () => {
    broken.value = false
  },
)

const showPhoto = computed(() => !!props.photoUrl && !broken.value)
</script>

<template>
  <span
    class="avatar display"
    :class="[`avatar--${tone}`, { 'avatar--photo': showPhoto }]"
    :style="{
      width: `${px}px`,
      height: `${px}px`,
      borderRadius: `${radiusPx}px`,
      fontSize: `${fontPx}px`,
    }"
  >
    <img
      v-if="showPhoto"
      :src="photoUrl as string"
      :alt="alt"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: -0.01em;
  overflow: hidden;
  position: relative;
}
.avatar--on-light {
  background: var(--color-accent-500);
  color: var(--color-brand-900);
}
.avatar--on-dark {
  background: var(--color-accent-on-dark);
  color: var(--color-brand-900);
}
.avatar--photo {
  background: var(--color-surface-soft);
  color: transparent; /* hide the initials text behind the image if it ever shows through */
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
