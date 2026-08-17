<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useAnnouncements } from '@/composables/useAnnouncements'
import Hero from '@/components/dashboard/Hero.vue'
import PushNotificationsBanner from '@/components/dashboard/PushNotificationsBanner.vue'
import RequiredTrainingBanner from '@/components/dashboard/RequiredTrainingBanner.vue'
import PoliciesBanner from '@/components/dashboard/PoliciesBanner.vue'
import SocialMediaReleaseBanner from '@/components/dashboard/SocialMediaReleaseBanner.vue'
import FeaturedQuickLinks from '@/components/dashboard/FeaturedQuickLinks.vue'
import StationDirectory from '@/components/dashboard/StationDirectory.vue'
import UpcomingTrainingCard from '@/components/dashboard/UpcomingTrainingCard.vue'
import AnnouncementsCard from '@/components/dashboard/AnnouncementsCard.vue'
import CallVolumeTile from '@/components/dashboard/CallVolumeTile.vue'
import ComplianceCard from '@/components/dashboard/ComplianceCard.vue'
import MihReferralCard from '@/components/dashboard/MihReferralCard.vue'
import MobileQuickStrips from '@/components/dashboard/MobileQuickStrips.vue'
import TrainingLibraryCard from '@/components/dashboard/TrainingLibraryCard.vue'
import PeopleRow from '@/components/dashboard/PeopleRow.vue'

/* Announcements sits out entirely for crew when nothing is posted —
   admin adoption is still ramping up, so most days it'd just be an
   empty box. Admins always get it (compact) so + New stays in reach. */
const auth = useAuthStore()
const { announcements } = useAnnouncements()
const showAnnouncements = computed(
  () => auth.isAdmin || announcements.value.some((a) => a.active),
)
</script>

<template>
  <!-- Single root so the route <Transition> in App.vue can animate it.
       Hero renders full-bleed (navy band with its own gold seam);
       everything else lives inside the padded .dash container. -->
  <div>
    <Hero />

    <div class="dash">
    <RequiredTrainingBanner />
    <PoliciesBanner />
    <SocialMediaReleaseBanner />
    <PushNotificationsBanner />

    <!-- Phones get the MIH entry + compliance status as slim strips up
         top; the full rail cards below are desktop-only. -->
    <div class="lg:hidden mb-6">
      <MobileQuickStrips />
    </div>

    <!-- Four most-used shortcuts (role-aware: crew sees Outlook /
         Shoutout / Supply / Protocols, supervisors swap in Responder360
         + Daily Summary). -->
    <FeaturedQuickLinks />

    <!--
      Main column: Announcements → People → Stations. Rail: personal
      compliance status (mockup v2), Upcoming Classes, Call Volume.
      Latest Training Library recordings sit full-width at the bottom
      (replaced the unused photo gallery + newsletter slots).
    -->
    <div class="dash__grid">
      <div class="dash__main">
        <div v-if="showAnnouncements" id="announcements" class="reveal" style="animation-delay: 80ms">
          <AnnouncementsCard />
        </div>
        <div class="reveal" style="animation-delay: 110ms">
          <PeopleRow />
        </div>
        <div id="stations" class="reveal" style="animation-delay: 140ms">
          <StationDirectory />
        </div>
      </div>

      <aside class="dash__aside">
        <div class="reveal hidden lg:block" style="animation-delay: 90ms">
          <ComplianceCard />
        </div>
        <div class="reveal hidden lg:block" style="animation-delay: 95ms">
          <MihReferralCard />
        </div>
        <div id="training" class="reveal" style="animation-delay: 100ms">
          <UpcomingTrainingCard />
        </div>
        <div class="reveal" style="animation-delay: 160ms">
          <CallVolumeTile />
        </div>
      </aside>
    </div>

      <div id="library" class="reveal" style="animation-delay: 80ms">
        <TrainingLibraryCard />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px 16px;
}
@media (min-width: 768px) {
  .dash {
    padding: 40px 40px;
  }
}

.dash__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
}
@media (min-width: 1024px) {
  .dash__grid {
    grid-template-columns: 8fr 4fr;
  }
}

.dash__main {
  display: flex;
  flex-direction: column;
  gap: 36px;
  min-width: 0;
}
.dash__aside {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

</style>
