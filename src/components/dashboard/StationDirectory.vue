<script setup lang="ts">
import { ref, computed } from 'vue'
import { Phone, MapPin, Plus, Lock, Edit2, Eye, EyeOff } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import CodeEditor from './CodeEditor.vue'
import { useCodeReveal } from '@/composables/useCodeReveal'
import type { Station } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useStationsStore } from '@/stores/stations'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'

const auth = useAuthStore()
const stationsStore = useStationsStore()

const editingId = ref<string | null>(null)
const { record, latestFor } = useCodeEditHistory()

// Each station gets its own reveal state, pre-created during setup. The
// admin's "Manage Stations" view can add new stations at runtime — for
// those we lazily create reveals on demand outside the setup phase, which
// would normally be a problem for `onUnmounted` registration. We sidestep
// this by registering reveals for the seed list now, and for any added
// station via `ensureReveal` (which is safe to call from event handlers
// since `onUnmounted` registered by useCodeReveal is a no-op once setup
// has completed; the reveal still works, it just won't auto-tear-down).
const reveals = new Map<string, ReturnType<typeof useCodeReveal>>()
for (const s of stationsStore.allStations) {
  reveals.set(s.id, useCodeReveal())
}
function reveal(id: string) {
  let r = reveals.get(id)
  if (!r) {
    r = useCodeReveal()
    reveals.set(id, r)
  }
  return r
}

function startEdit(id: string) {
  editingId.value = id
}
function cancelEdit() {
  editingId.value = null
}

function saveCode(station: Station, newValue: string) {
  const oldValue = station.doorCode
  const updatedBy = auth.appUser?.fullName ?? 'Unknown'
  stationsStore.update(station.id, {
    doorCode: newValue,
    doorCodeUpdatedAt: new Date().toISOString(),
    doorCodeUpdatedBy: updatedBy,
  })
  record({
    entityType: 'station',
    entityId: station.id,
    codeField: 'door',
    oldValue,
    newValue,
    changedBy: updatedBy,
  })
  editingId.value = null
}

function lastChanged(station: Station) {
  const fromHistory = latestFor('station', station.id, 'door')
  if (fromHistory) return { by: fromHistory.changedBy, at: fromHistory.changedAt }
  if (station.doorCodeUpdatedBy && station.doorCodeUpdatedAt) {
    return { by: station.doorCodeUpdatedBy, at: station.doorCodeUpdatedAt }
  }
  return null
}

function timeAgo(iso: string) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const sorted = computed(() => stationsStore.activeStations)
</script>

<template>
  <section>
    <header class="sd__header">
      <Eyebrow>Station Directory</Eyebrow>
      <RouterLink
        v-if="auth.isAdmin"
        to="/admin/stations"
        class="sd__add"
      >
        <Plus :size="13" :stroke-width="1.85" /> Manage
      </RouterLink>
    </header>

    <div class="sd__grid">
      <AppCard
        v-for="(s, i) in sorted"
        :key="s.id"
        class="station-card reveal"
        :style="{ animationDelay: `${i * 30}ms` }"
      >
        <header class="station-card__head">
          <div class="station-card__id">
            <span class="station-card__id-label">Medic</span>
            <span class="station-card__id-num display">{{ s.id }}</span>
          </div>
          <div class="station-card__addr-block">
            <h3 class="station-card__name display">{{ s.name }}</h3>
            <div class="station-card__addr">{{ s.address }}</div>
            <div class="station-card__city">{{ s.city }}</div>
          </div>
        </header>

        <!-- Door code: dominant, full-width band -->
        <div class="station-card__code-zone">
          <div class="station-card__code-zone-label">
            <Lock :size="11" :stroke-width="2" />
            Door code
          </div>

          <CodeEditor
            v-if="editingId === s.id"
            :initial-value="s.doorCode"
            @save="(v) => saveCode(s, v)"
            @cancel="cancelEdit"
          />

          <template v-else-if="s.doorCode === 'App Access'">
            <div class="station-card__code-app">
              <Lock :size="13" :stroke-width="2" />
              App Access only
            </div>
            <button
              type="button"
              class="station-card__update-btn"
              @click="startEdit(s.id)"
            >
              <Edit2 :size="11" /> Update
            </button>
          </template>

          <template v-else>
            <button
              v-if="!reveal(s.id).revealed.value"
              type="button"
              class="station-card__code-cta"
              @click="reveal(s.id).reveal"
            >
              <Eye :size="18" :stroke-width="2" /> Reveal code
            </button>
            <button
              v-else
              type="button"
              class="station-card__code-revealed"
              :title="'Tap to hide'"
              @click="reveal(s.id).hide"
            >
              <Lock :size="18" :stroke-width="2" class="station-card__code-lock" />
              <span class="font-mono station-card__code-value">{{ s.doorCode }}</span>
              <span class="station-card__code-iconbox">
                <EyeOff :size="16" :stroke-width="2" class="station-card__code-eye" />
              </span>
              <span class="station-card__code-progress" :style="{ width: reveal(s.id).progressPct.value }" />
            </button>
            <button
              v-if="!reveal(s.id).revealed.value"
              type="button"
              class="station-card__update-btn"
              @click="startEdit(s.id)"
            >
              <Edit2 :size="11" /> Update
            </button>
          </template>
        </div>

        <!-- Phone + map row at bottom -->
        <footer class="station-card__foot">
          <a
            :href="`tel:${s.phone.replace(/[^\d+]/g, '')}`"
            class="station-card__action"
          >
            <Phone :size="12" :stroke-width="1.85" /> {{ s.phone }}
          </a>
          <a
            :href="s.mapUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="station-card__action"
          >
            <MapPin :size="12" :stroke-width="1.85" /> Map
          </a>
          <span v-if="lastChanged(s)" class="station-card__updated">
            {{ lastChanged(s)?.by }} · {{ timeAgo(lastChanged(s)!.at) }}
          </span>
        </footer>
      </AppCard>
    </div>
  </section>
</template>

<style scoped>
.sd__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sd__add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  background: var(--color-brand-600);
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.sd__add:hover {
  background: var(--color-brand-700);
}

.sd__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 768px) {
  .sd__grid {
    grid-template-columns: 1fr 1fr;
  }
}

.station-card {
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.station-card__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.station-card__id {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 60px;
  padding: 6px 4px;
  border-radius: 8px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
}
.station-card__id-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.station-card__id-num {
  font-size: 22px;
  letter-spacing: -0.02em;
  color: var(--color-brand-600);
  margin-top: 1px;
  line-height: 1;
}

.station-card__addr-block {
  flex: 1;
  min-width: 0;
}
.station-card__name {
  font-size: 17px;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  line-height: 1.15;
}
.station-card__addr {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--color-ink-soft);
  line-height: 1.3;
}
.station-card__city {
  font-size: 11.5px;
  color: var(--color-muted);
}

/* Code zone — elevated treatment, no fill panel.
   A thin gold gradient rule across the top, white surface, and a
   navy-on-white code chip do the visual work. */
.station-card__code-zone {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.station-card__code-zone::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(0.734 0.114 86.8 / 0.5) 18%,
    oklch(0.734 0.114 86.8 / 0.5) 82%,
    transparent 100%
  );
}
.station-card__code-zone-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  flex-shrink: 0;
}
.station-card__code-app {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-brand-700);
  letter-spacing: -0.005em;
}
.station-card__code-cta {
  position: relative;
  flex: 1;
  min-width: 110px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklch, var(--color-accent-on-dark) 48%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-brand-800) 88%, white 10%),
    color-mix(in oklch, var(--color-brand-800) 96%, black 4%)
  );
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 3px 8px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;
}
.station-card__code-cta:hover {
  transform: translateY(-1px);
  border-color: color-mix(in oklch, var(--color-accent-on-dark) 70%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    0 5px 12px rgba(0, 0, 0, 0.18),
    0 0 14px color-mix(in oklch, var(--color-accent-on-dark) 22%, transparent);
}
.station-card__code-cta:active {
  transform: translateY(0) scale(0.98);
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.32),
    0 2px 6px rgba(0, 0, 0, 0.16);
}
.station-card__code-cta svg {
  width: 14px;
  height: 14px;
  color: var(--color-accent-on-dark);
  flex-shrink: 0;
}

.station-card__code-revealed {
  position: relative;
  flex: 1;
  min-width: 130px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid color-mix(in oklch, var(--color-accent-on-dark) 48%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-brand-800) 88%, white 10%),
    color-mix(in oklch, var(--color-brand-800) 96%, black 4%)
  );
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 3px 8px rgba(0, 0, 0, 0.14);
  transition: transform 180ms ease;
}
.station-card__code-revealed:hover {
  transform: translateY(-1px);
}
.station-card__code-revealed svg.station-card__code-lock {
  width: 14px;
  height: 14px;
}
.station-card__code-lock {
  flex-shrink: 0;
  color: var(--color-accent-on-dark);
}
.station-card__code-iconbox {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
}
.station-card__code-iconbox svg {
  width: 13px;
  height: 13px;
}
.station-card__code-value {
  flex: 1;
  text-align: center;
}
.station-card__code-eye {
  color: rgba(255, 255, 255, 0.78);
}
.station-card__code-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2.5px;
  background: var(--color-accent-on-dark);
  transition: width 0.05s linear;
  pointer-events: none;
}

.station-card__update-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.station-card__update-btn:hover {
  border-color: var(--color-line);
  color: var(--color-brand-600);
  background: var(--color-surface);
}

.station-card__foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-top: 4px;
  flex-wrap: wrap;
}
.station-card__action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.station-card__action:hover {
  text-decoration: underline;
}
.station-card__updated {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--color-muted);
}
</style>
