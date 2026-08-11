<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useQuickLinks } from '@/composables/useQuickLinks'

/**
 * Desktop editorial footer (approved portal mockup v2): brand column,
 * portal section links, external systems (top of the admin-curated
 * quick_links catalog), and contact — over a navy base with the gold
 * seam on top.
 */
const year = new Date().getFullYear()
const { links } = useQuickLinks()

const SYSTEM_PRIORITY = ['ESO', 'Aladtec', 'Lexipol', 'Paycom', 'Operative IQ', 'Supply Portal']
const systems = computed(() =>
  SYSTEM_PRIORITY
    .map((label) => links.value.find((l) => l.label === label))
    .filter((l): l is NonNullable<typeof l> => !!l)
    .slice(0, 5),
)
</script>

<template>
  <footer class="pf">
    <div class="pf__goldseam" aria-hidden="true"></div>
    <div class="pf__inner">
      <div class="pf__cols">
        <div>
          <div class="pf__brandline display">Waller County EMS</div>
          <p class="pf__blurb">
            Serving Waller County, Texas with professional emergency medical
            care since 1996.
          </p>
        </div>
        <div>
          <h6 class="pf__h">Portal</h6>
          <ul class="pf__list">
            <li><RouterLink to="/directory">Directory</RouterLink></li>
            <li><RouterLink to="/training">Training</RouterLink></li>
            <li><RouterLink to="/policies">Policies</RouterLink></li>
            <li><RouterLink to="/hospitals">Hospitals</RouterLink></li>
            <li><RouterLink to="/gallery">Around the County</RouterLink></li>
          </ul>
        </div>
        <div>
          <h6 class="pf__h">Systems</h6>
          <ul class="pf__list">
            <li v-for="s in systems" :key="s.id">
              <a :href="s.url" target="_blank" rel="noopener">{{ s.label }} <span class="pf__ext">↗</span></a>
            </li>
          </ul>
        </div>
        <div>
          <h6 class="pf__h">Contact</h6>
          <ul class="pf__list pf__list--plain">
            <li>Station 201 — Hempstead, TX</li>
            <li>Admin: 979-826-6035</li>
            <li>
              <a href="mailto:education@wallercountyems.com">education@wallercountyems.com</a>
            </li>
            <li>
              <a href="mailto:justin.stjohn@wallercountyems.com?subject=WCEMS%20Portal%20-%20Issue%20report">Report an issue</a>
            </li>
          </ul>
        </div>
      </div>
      <div class="pf__fine">
        <span>© {{ year }} Waller County EMS · Internal use only</span>
        <img src="/wcems-patch.png" alt="" class="pf__patch" width="30" height="30" />
      </div>
    </div>
  </footer>
</template>

<style scoped>
.pf {
  margin-top: 64px;
  background: var(--color-brand-950);
}
.pf__goldseam {
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(200, 164, 77, 0.55) 18%,
    #e8cb72 50%,
    rgba(200, 164, 77, 0.55) 82%,
    transparent
  );
}
.pf__inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 44px 40px 26px;
}
.pf__cols {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1.2fr;
  gap: 40px;
}
.pf__brandline {
  font-size: 21px;
  color: white;
}
.pf__blurb {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.6;
  max-width: 300px;
  color: oklch(0.68 0.03 250);
}
.pf__h {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-accent-on-dark);
  margin-bottom: 12px;
}
.pf__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.pf__list a {
  color: oklch(0.78 0.025 250);
  text-decoration: none;
  transition: color 120ms var(--ease-out);
}
.pf__list a:hover {
  color: white;
}
.pf__list--plain li {
  color: oklch(0.68 0.03 250);
}
.pf__ext {
  font-size: 10px;
  opacity: 0.6;
}
.pf__fine {
  margin-top: 36px;
  padding-top: 18px;
  border-top: 1px solid var(--color-brand-800);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: oklch(0.58 0.03 250);
}
.pf__patch {
  width: 30px;
  height: 30px;
  object-fit: contain;
  opacity: 0.85;
}
</style>
