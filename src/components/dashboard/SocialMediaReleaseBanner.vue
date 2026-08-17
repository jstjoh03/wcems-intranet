<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Camera, ChevronRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useSocialMediaRelease } from '@/composables/useSocialMediaRelease'

/**
 * Dashboard nudge: field staff who haven't completed the social media
 * photo/video release. Office staff (station matches /admin/i) aren't
 * in the audience, so they never see it; the form stays reachable for
 * them from the nav drawer. Disappears the moment a release exists —
 * either answer counts as done.
 */

const auth = useAuthStore()
const { ready, myRelease } = useSocialMediaRelease()

const isOfficeStaff = computed(() =>
  /admin/i.test(auth.appUser?.station ?? ''),
)

const visible = computed(
  () =>
    auth.appUser !== null &&
    !auth.usingDevStub &&
    !auth.isKiosk &&
    !isOfficeStaff.value &&
    ready.value &&
    myRelease.value === null,
)
</script>

<template>
  <RouterLink v-if="visible" to="/social-media-release" class="smb">
    <div class="smb__icon">
      <Camera :size="20" :stroke-width="1.85" />
    </div>
    <div class="smb__copy">
      <strong class="smb__title">Social media release needed</strong>
      <span class="smb__sub">
        Tell us whether WCEMS may use your photo/video on official channels —
        takes about a minute to sign.
      </span>
    </div>
    <ChevronRight :size="18" :stroke-width="1.85" class="smb__chev" />
  </RouterLink>
</template>

<style scoped>
.smb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 18px;
  background: oklch(0.97 0.03 80);
  border: 1px solid oklch(0.86 0.06 80);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms var(--ease-out);
}
.smb:hover {
  border-color: oklch(0.65 0.11 80);
}
.smb__icon {
  color: oklch(0.5 0.11 80);
  flex-shrink: 0;
}
.smb__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.smb__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-ink);
}
.smb__sub {
  font-size: 12px;
  color: var(--color-ink-soft);
  line-height: 1.4;
}
.smb__chev {
  color: oklch(0.5 0.11 80);
  flex-shrink: 0;
}
</style>
