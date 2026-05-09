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

    <div class="dash__grid">
      <div class="dash__main">
        <div id="quick-links" class="reveal" style="animation-delay: 90ms">
          <QuickLinks />
        </div>
        <div id="stations" class="reveal" style="animation-delay: 120ms">
          <StationDirectory />
        </div>
      </div>

      <aside class="dash__aside">
        <div id="newsletter" class="reveal" style="animation-delay: 100ms">
          <NewsletterCard />
        </div>
        <div id="training" class="reveal" style="animation-delay: 140ms">
          <UpcomingTrainingCard />
        </div>
        <div id="announcements" class="reveal" style="animation-delay: 180ms">
          <AnnouncementsCard />
        </div>
        <div class="reveal" style="animation-delay: 220ms">
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
  gap: 48px;
  min-width: 0;
}
.dash__aside {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
