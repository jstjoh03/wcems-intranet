<script setup lang="ts">
import { ref, computed } from 'vue'
import { Phone, MapPin, Plus, Lock, Edit2, EyeOff } from 'lucide-vue-next'
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
              Tap to reveal
            </button>
            <button
              v-else
              type="button"
              class="station-card__code-revealed"
              :title="'Tap to hide'"
              @click="reveal(s.id).hide"
            >
              <span class="font-mono station-card__code-value">{{ s.doorCode }}</span>
              <EyeOff :size="13" :stroke-width="1.85" class="station-card__code-eye" />
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

/* Code zone — visual centerpiece of the card */
.station-card__code-zone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: oklch(0.97 0.04 86.8);
  border: 1px solid oklch(0.92 0.07 86.8);
  flex-wrap: wrap;
}
.station-card__code-zone-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
  flex-shrink: 0;
}
.station-card__code-app {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-brand-700);
}
.station-card__code-cta {
  flex: 1;
  min-width: 120px;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-accent-500);
  color: var(--color-brand-700);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.station-card__code-cta:hover {
  background: var(--color-accent-500);
  color: var(--color-brand-900);
}
.station-card__code-revealed {
  position: relative;
  flex: 1;
  min-width: 120px;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--color-brand-700);
  border: 1px solid var(--color-brand-700);
  color: white;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow: hidden;
  letter-spacing: 0.02em;
}
.station-card__code-value {
  flex: 1;
  text-align: left;
  letter-spacing: 0.04em;
}
.station-card__code-eye {
  opacity: 0.7;
  flex-shrink: 0;
}
.station-card__code-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--color-accent-500);
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
