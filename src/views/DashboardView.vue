<script setup lang="ts">
import Hero from '@/components/dashboard/Hero.vue'
import PushNotificationsBanner from '@/components/dashboard/PushNotificationsBanner.vue'
import RequiredTrainingBanner from '@/components/dashboard/RequiredTrainingBanner.vue'
import PoliciesBanner from '@/components/dashboard/PoliciesBanner.vue'
import FeaturedQuickLinks from '@/components/dashboard/FeaturedQuickLinks.vue'
import StationDirectory from '@/components/dashboard/StationDirectory.vue'
import NewsletterCard from '@/components/dashboard/NewsletterCard.vue'
import UpcomingTrainingCard from '@/components/dashboard/UpcomingTrainingCard.vue'
import AnnouncementsCard from '@/components/dashboard/AnnouncementsCard.vue'
import CallVolumeTile from '@/components/dashboard/CallVolumeTile.vue'
import PhotoGallery from '@/components/dashboard/PhotoGallery.vue'
import PeopleRow from '@/components/dashboard/PeopleRow.vue'
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
    <PushNotificationsBanner />

    <!-- Four most-used shortcuts (role-aware: crew sees Outlook /
         Shoutout / Supply / Protocols, supervisors swap in Responder360
         + Daily Summary). -->
    <FeaturedQuickLinks />

    <!--
      Quick Links lives in a floating dock (AppShell) so the dashboard
      can lead with editorial content. Main column: Announcements →
      People → Stations. Sidebar: Upcoming Classes, Call Volume.
      Newsletter sits full-width near the bottom with the photo gallery.
    -->
    <div class="dash__grid">
      <div class="dash__main">
        <div id="announcements" class="reveal" style="animation-delay: 80ms">
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
        <div id="training" class="reveal" style="animation-delay: 100ms">
          <UpcomingTrainingCard />
        </div>
        <div class="reveal" style="animation-delay: 160ms">
          <CallVolumeTile />
        </div>
      </aside>
    </div>

      <PhotoGallery />
      <div id="newsletter" class="reveal dash__newsletter" style="animation-delay: 80ms">
        <NewsletterCard />
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

/* Breathing room between Around-the-County and the newsletter — without
   it the photo gallery's bottom edge butts right up against the
   newsletter hero, which felt cramped. */
.dash__newsletter {
  margin-top: 48px;
}
</style>
