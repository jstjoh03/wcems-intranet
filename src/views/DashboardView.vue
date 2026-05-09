<script setup lang="ts">
import Hero from '@/components/dashboard/Hero.vue'
import OperationalStrip from '@/components/dashboard/OperationalStrip.vue'
import QuickLinks from '@/components/dashboard/QuickLinks.vue'
import StationDirectory from '@/components/dashboard/StationDirectory.vue'
import NewsletterCard from '@/components/dashboard/NewsletterCard.vue'
import UpcomingTrainingCard from '@/components/dashboard/UpcomingTrainingCard.vue'
import AnnouncementsCard from '@/components/dashboard/AnnouncementsCard.vue'
import CallVolumeTile from '@/components/dashboard/CallVolumeTile.vue'
import PhotoGallery from '@/components/dashboard/PhotoGallery.vue'
import PeopleRow from '@/components/dashboard/PeopleRow.vue'
</script>

<template>
  <div class="dash">
    <Hero />
    <OperationalStrip />

    <!--
      Layout intent: Announcements + Newsletter sit at the top of the main
      column so editorial content is the first thing crews see after the
      operational strip. Quick Links is compact tile-grid below — the new
      tile sizing makes it short enough to fit alongside the right-rail
      training/call-volume cards without forcing a long scroll.
    -->
    <div class="dash__grid">
      <div class="dash__main">
        <div id="announcements" class="reveal" style="animation-delay: 80ms">
          <AnnouncementsCard />
        </div>
        <div id="newsletter" class="reveal" style="animation-delay: 110ms">
          <NewsletterCard />
        </div>
        <div id="quick-links" class="reveal" style="animation-delay: 140ms">
          <QuickLinks />
        </div>
        <div id="stations" class="reveal" style="animation-delay: 170ms">
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
    <PeopleRow />
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
