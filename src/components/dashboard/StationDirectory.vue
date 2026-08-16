<script setup lang="ts">
import { ref, computed } from 'vue'
import { Phone, MapPin, Plus, Lock, Edit2, Eye, EyeOff, ChevronRight } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import Eyebrow from '@/components/primitives/Eyebrow.vue'
import AppCard from '@/components/primitives/AppCard.vue'
import CodeEditor from './CodeEditor.vue'
import { useCodeReveal } from '@/composables/useCodeReveal'
import type { Station } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useStationsStore } from '@/stores/stations'
import { useCodeEditHistory } from '@/composables/useCodeEditHistory'

/**
 * Station directory as slim collapsible rows: the door code IS the
 * thing crews come here for, so it sits right in the collapsed row —
 * "Medic 211 · [Reveal]". Expanding a row surfaces the secondary
 * details (address, phone, map, update-code, audit stamp).
 */

const auth = useAuthStore()
const stationsStore = useStationsStore()

const editingId = ref<string | null>(null)
const openId = ref<string | null>(null)
const { latestFor } = useCodeEditHistory()

function toggle(id: string) {
  openId.value = openId.value === id ? null : id
  if (editingId.value && editingId.value !== openId.value) editingId.value = null
}

// Each station gets its own reveal state, pre-created during setup;
// stations added at runtime get one lazily (see the note in git history
// about onUnmounted registration outside setup being a safe no-op).
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

async function saveCode(station: Station, newValue: string) {
  editingId.value = null
  /* The DB stamp + audit triggers handle door_code_updated_at/by and the
     code_edit_history row; the client only sends the new value. */
  try {
    await stationsStore.update(station.id, { doorCode: newValue })
  } catch (err) {
    console.error('[StationDirectory] save failed:', (err as Error).message)
  }
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

    <div class="sd__list">
      <AppCard
        v-for="s in sorted"
        :key="s.id"
        class="st-row"
        :class="{ 'st-row--open': openId === s.id }"
      >
        <div class="st-row__head">
          <button type="button" class="st-row__toggle" @click="toggle(s.id)">
            <ChevronRight
              :size="15"
              :stroke-width="2"
              class="st-row__chev"
              :class="{ 'st-row__chev--open': openId === s.id }"
            />
            <span class="st-row__name display">{{ s.name }}</span>
          </button>

          <!-- Door code lives IN the row — no digging. -->
          <span class="st-row__quick">
            <span v-if="s.doorCode === 'App Access'" class="st-row__app">
              <Lock :size="12" :stroke-width="2" /> App Access
            </span>
            <template v-else>
              <button
                v-if="!reveal(s.id).revealed.value"
                type="button"
                class="st-row__code-cta"
                @click="reveal(s.id).reveal"
              >
                <Eye :size="14" :stroke-width="2" /> Code
              </button>
              <button
                v-else
                type="button"
                class="st-row__code-revealed"
                title="Tap to hide"
                @click="reveal(s.id).hide"
              >
                <span class="font-mono st-row__code-value">{{ s.doorCode }}</span>
                <EyeOff :size="13" :stroke-width="2" class="st-row__code-eye" />
                <span class="st-row__code-progress" :style="{ width: reveal(s.id).progressPct.value }" />
              </button>
            </template>
          </span>
        </div>

        <div v-if="openId === s.id" class="st-row__detail">
          <div class="st-row__facts">
            <a :href="s.mapUrl" target="_blank" rel="noopener noreferrer" class="st-row__action">
              <MapPin :size="12" :stroke-width="1.85" />
              {{ s.address }}<template v-if="s.city"> · {{ s.city }}</template>
            </a>
            <a :href="`tel:${s.phone.replace(/[^\d+]/g, '')}`" class="st-row__action">
              <Phone :size="12" :stroke-width="1.85" /> {{ s.phone }}
            </a>
          </div>

          <CodeEditor
            v-if="editingId === s.id"
            :initial-value="s.doorCode"
            @save="(v) => saveCode(s, v)"
            @cancel="cancelEdit"
          />
          <div v-else class="st-row__meta">
            <button type="button" class="st-row__update" @click="startEdit(s.id)">
              <Edit2 :size="11" /> Update code
            </button>
            <span v-if="lastChanged(s)" class="st-row__updated">
              {{ lastChanged(s)?.by }} · {{ timeAgo(lastChanged(s)!.at) }}
            </span>
          </div>
        </div>
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

.sd__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.st-row {
  padding: 0;
  overflow: hidden;
}
.st-row--open {
  box-shadow: var(--shadow-md);
}

.st-row__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 8px;
}
.st-row__toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
}
.st-row__chev {
  flex-shrink: 0;
  color: var(--color-muted-soft);
  transition: transform 140ms var(--ease-out);
}
.st-row__chev--open {
  transform: rotate(90deg);
}
.st-row__name {
  font-size: 17px;
  letter-spacing: -0.01em;
  color: var(--color-brand-700);
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.st-row__quick {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
}
.st-row__app {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-700);
  padding: 6px 10px;
}
.st-row__code-cta,
.st-row__code-revealed {
  position: relative;
  height: 30px;
  min-width: 92px;
  padding: 0 12px;
  border-radius: 7px;
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
  gap: 7px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25),
    0 2px 6px rgba(0, 0, 0, 0.12);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
.st-row__code-cta:hover,
.st-row__code-revealed:hover {
  transform: translateY(-1px);
}
.st-row__code-cta svg {
  color: var(--color-accent-on-dark);
}
.st-row__code-revealed {
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  justify-content: space-between;
}
.st-row__code-value {
  flex: 1;
  text-align: center;
}
.st-row__code-eye {
  color: rgba(255, 255, 255, 0.78);
  flex-shrink: 0;
}
.st-row__code-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2.5px;
  background: var(--color-accent-on-dark);
  transition: width 0.05s linear;
  pointer-events: none;
}

.st-row__detail {
  padding: 10px 14px 12px 31px;
  border-top: 1px solid var(--color-line-soft);
  background: var(--color-surface-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.st-row__facts {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.st-row__action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-brand-600);
  text-decoration: none;
}
.st-row__action:hover {
  text-decoration: underline;
}
.st-row__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.st-row__update {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.st-row__update:hover {
  color: var(--color-brand-600);
  background: var(--color-surface);
}
.st-row__updated {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--color-muted);
}
</style>
