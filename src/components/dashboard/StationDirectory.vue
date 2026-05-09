<script setup lang="ts">
import { ref, computed } from 'vue'
import { Phone, MapPin, Edit2, Plus, Lock } from 'lucide-vue-next'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import RevealCode from '@/components/primitives/RevealCode.vue'
import CodeEditor from './CodeEditor.vue'
import stationsData from '@/data/stations.json'
import type { Station } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'

const auth = useAuthStore()

// Local mutable copy so inline edits land somewhere — Phase 2 swaps this for
// a Supabase query/mutation pair against the `stations` + `station_codes`
// tables, with the same component contract.
const stations = ref<Station[]>(JSON.parse(JSON.stringify(stationsData)))
const editingId = ref<string | null>(null)

const { record, latestFor } = useCodeEditHistory()

function startEdit(id: string) {
  editingId.value = id
}

function cancelEdit() {
  editingId.value = null
}

function saveCode(station: Station, newValue: string) {
  const oldValue = station.doorCode
  station.doorCode = newValue
  station.doorCodeUpdatedAt = new Date().toISOString()
  station.doorCodeUpdatedBy = auth.appUser?.fullName ?? 'Unknown'

  record({
    entityType: 'station',
    entityId: station.id,
    codeField: 'door',
    oldValue,
    newValue,
    changedBy: station.doorCodeUpdatedBy,
  })

  editingId.value = null
}

function lastChanged(station: Station) {
  const fromHistory = latestFor('station', station.id, 'door')
  if (fromHistory) {
    return { by: fromHistory.changedBy, at: fromHistory.changedAt }
  }
  return { by: station.doorCodeUpdatedBy, at: station.doorCodeUpdatedAt }
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

const sorted = computed(() =>
  [...stations.value].sort((a, b) => Number(a.id) - Number(b.id)),
)
</script>

<template>
  <section>
    <header class="station-dir__header">
      <Eyebrow>Station Directory</Eyebrow>
      <button v-if="auth.isAdmin" type="button" class="station-dir__add">
        <Plus :size="13" :stroke-width="1.85" /> Add station
      </button>
    </header>

    <div class="station-dir__list">
      <AppCard
        v-for="(s, i) in sorted"
        :key="s.id"
        class="station-row reveal"
        :style="{ animationDelay: `${i * 40}ms` }"
      >
        <div class="station-row__id-col">
          <Eyebrow>Medic</Eyebrow>
          <div class="station-row__id display">{{ s.id }}</div>
        </div>

        <div class="station-row__main">
          <div class="station-row__head">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="station-row__name display">{{ s.name }}</h3>
                <button
                  v-if="auth.isAdmin"
                  type="button"
                  class="station-row__edit"
                  aria-label="Edit station"
                >
                  <Edit2 :size="12" />
                </button>
              </div>
              <div class="station-row__addr">{{ s.address }}</div>
              <div class="station-row__city">{{ s.city }}</div>
            </div>

            <div class="station-row__contact">
              <a
                :href="`tel:${s.phone.replace(/[^\d+]/g, '')}`"
                class="station-row__phone"
              >
                <Phone :size="12" :stroke-width="1.85" /> {{ s.phone }}
              </a>
              <a
                :href="s.mapUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="station-row__map"
              >
                <MapPin :size="11" :stroke-width="1.85" /> Get directions
              </a>
            </div>
          </div>

          <div class="station-row__code-row">
            <span class="station-row__code-label">
              <Lock :size="10" :stroke-width="2" />
              Door code
            </span>

            <CodeEditor
              v-if="editingId === s.id"
              :initial-value="s.doorCode"
              @save="(v) => saveCode(s, v)"
              @cancel="cancelEdit"
            />

            <template v-else>
              <RevealCode :code="s.doorCode" :compact="true" placeholder="Tap to reveal" />
              <button
                type="button"
                class="station-row__update-btn"
                @click="startEdit(s.id)"
              >
                Update
              </button>
            </template>

            <span class="station-row__updated">
              Updated by <strong>{{ lastChanged(s).by }}</strong>
              · {{ timeAgo(lastChanged(s).at) }}
            </span>
          </div>
        </div>
      </AppCard>
    </div>
  </section>
</template>

<style scoped>
.station-dir__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.station-dir__add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: var(--color-brand-600);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.station-dir__add:hover {
  background: var(--color-brand-700);
}

.station-dir__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.station-row {
  display: flex;
  align-items: stretch;
  overflow: hidden;
}
.station-row__id-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  border-right: 1px solid var(--color-line);
  background: var(--color-surface-soft);
  min-width: 90px;
}
.station-row__id {
  font-size: 28px;
  color: var(--color-brand-600);
  margin-top: 2px;
}

.station-row__main {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.station-row__head {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.station-row__name {
  font-size: 18px;
  color: var(--color-ink);
}
.station-row__edit {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--color-muted);
}
.station-row__addr {
  font-size: 13.5px;
  color: var(--color-ink-soft);
  margin-top: 4px;
}
.station-row__city {
  font-size: 12.5px;
  color: var(--color-muted);
}

.station-row__contact {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.station-row__phone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.station-row__phone:hover {
  text-decoration: underline;
}
.station-row__map {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-accent-700);
  text-decoration: none;
}
.station-row__map:hover {
  text-decoration: underline;
}

.station-row__code-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line-soft);
  flex-wrap: wrap;
}
.station-row__code-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.station-row__update-btn {
  background: transparent;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 999px;
  transition: all 120ms var(--ease-out);
}
.station-row__update-btn:hover {
  border-color: var(--color-line);
  color: var(--color-brand-600);
}
.station-row__updated {
  font-size: 11px;
  color: var(--color-muted);
  margin-left: auto;
}
.station-row__updated strong {
  font-weight: 600;
  color: var(--color-ink-soft);
}

@media (max-width: 600px) {
  .station-row__head {
    flex-direction: column;
    gap: 10px;
  }
  .station-row__contact {
    flex-direction: row;
    align-items: center;
    align-self: flex-start;
    gap: 12px;
  }
  .station-row__updated {
    margin-left: 0;
    width: 100%;
  }
}
</style>
