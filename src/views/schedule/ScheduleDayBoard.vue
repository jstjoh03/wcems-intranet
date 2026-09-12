<script setup lang="ts">
import { computed } from 'vue'
import { useSchedule } from '@/composables/useSchedule'

/**
 * Day board — Aladtec-style column for one work date (0600 → 0600 next
 * day). Units group their seats under a single header; names carry the
 * credential suffix; the circled R marks a regular rotation assignment;
 * times sit right-aligned per row. Open seats show the seat title only.
 */

const props = defineProps<{ dateIso: string }>()
const sched = useSchedule()

const model = computed(() => sched.dayModel(props.dateIso))

const stations = computed(() => {
  const groups: { station: string; units: typeof model.value.units }[] = []
  for (const u of model.value.units) {
    const last = groups[groups.length - 1]
    if (last && last.station === u.unit.station) last.units.push(u)
    else groups.push({ station: u.unit.station, units: [u] })
  }
  return groups
})
</script>

<template>
  <div class="db">
    <div class="db__meta">
      <span class="db__platoon" :data-platoon="model.platoon">
        <span class="db__dot" />{{ model.platoon }} Shift on duty
      </span>
      <span v-if="model.openCount > 0" class="db__opencount">
        {{ model.openCount }} open {{ model.openCount === 1 ? 'seat' : 'seats' }}
      </span>
    </div>

    <p v-for="n in model.notes" :key="n.id" class="db__daynote">{{ n.note }}</p>

    <section v-for="grp in stations" :key="grp.station" class="db__station">
      <h3 class="db__station-name">{{ grp.station }}</h3>

      <div v-for="um in grp.units" :key="um.unit.id" class="db__unit">
        <div class="db__unit-head">
          <span class="db__unit-code">{{ um.unit.code }}</span>
          <span class="db__unit-label">{{ um.unit.label }}</span>
        </div>

        <p v-for="n in um.notes" :key="n.id" class="db__unitnote">{{ n.note }}</p>

        <template v-for="sm in um.seats" :key="sm.seat.id">
          <div
            v-for="(row, ri) in sm.rows"
            :key="sm.seat.id + '-' + ri"
            class="db__row"
            :class="{ 'db__row--open': row.open }"
          >
            <span class="db__seat">{{ sm.seat.label }}</span>
            <span v-if="row.open" class="db__name db__name--open">Open shift</span>
            <span v-else class="db__name">
              {{ row.name }}<span v-if="row.credential" class="db__cred">, {{ row.credential }}</span>
              <span v-if="row.isRotation" class="db__rot" title="Regular rotation">R</span>
            </span>
            <span class="db__time">{{ row.start }} – {{ row.end }}</span>
          </div>
        </template>

        <div v-for="ex in um.extras" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
          <span class="db__seat">{{
            ex.kind === 'student' ? 'Student' : ex.kind === 'event' ? 'Event' : 'Extra'
          }}</span>
          <span class="db__name">
            {{ ex.name }}<span v-if="ex.credential" class="db__cred">, {{ ex.credential }}</span>
          </span>
          <span class="db__time">{{ ex.start }} – {{ ex.end }}</span>
        </div>
      </div>
    </section>

    <section v-if="model.unattached.length > 0" class="db__station">
      <h3 class="db__station-name">Other assignments</h3>
      <div v-for="ex in model.unattached" :key="ex.entryId ?? ex.name" class="db__row db__row--extra">
        <span class="db__seat">{{
          ex.kind === 'student' ? 'Student' : ex.kind === 'event' ? 'Special event' : 'Extra'
        }}</span>
        <span class="db__name">{{ ex.name }}</span>
        <span class="db__time">{{ ex.start }} – {{ ex.end }}</span>
      </div>
    </section>

    <p v-if="sched.rotation.value.length === 0" class="db__empty">
      No rotation template yet — assign crews to seats under Setup and the calendar fills in
      from the effective date forward.
    </p>
  </div>
</template>

<style scoped>
.db {
  max-width: 720px;
}

.db__meta {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.9rem;
}

.db__platoon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 3px 10px;
  background: var(--color-surface);
}

.db__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.db__platoon[data-platoon='A'] .db__dot {
  background: oklch(0.55 0.2 27);
}

.db__platoon[data-platoon='B'] .db__dot {
  background: oklch(0.5 0.16 255);
}

.db__platoon[data-platoon='C'] .db__dot {
  background: oklch(0.55 0.15 150);
}

.db__opencount {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-danger-500);
}

.db__daynote,
.db__unitnote {
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  background: var(--color-warning-50);
  border: 1px solid oklch(0.88 0.05 60);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  margin: 0 0 0.6rem;
}

.db__station {
  margin-bottom: 1.4rem;
}

.db__station-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 0 0.5rem;
}

.db__unit {
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: var(--color-surface);
  padding: 0.6rem 0.8rem 0.5rem;
  margin-bottom: 0.6rem;
  box-shadow: var(--shadow-sm);
}

.db__unit-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-line-soft);
  margin-bottom: 0.25rem;
}

.db__unit-code {
  font-weight: 700;
  color: var(--color-brand-700);
  font-size: 0.95rem;
}

.db__unit-label {
  font-size: 0.8rem;
  color: var(--color-muted);
}

.db__row {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--color-line-soft);
}

.db__row:last-child {
  border-bottom: 0;
}

.db__seat {
  font-size: 0.78rem;
  color: var(--color-muted);
}

.db__name {
  font-size: 0.92rem;
  color: var(--color-ink);
  font-weight: 500;
}

.db__name--open {
  color: var(--color-danger-500);
  font-weight: 600;
}

.db__cred {
  color: var(--color-muted);
  font-weight: 400;
  font-size: 0.85rem;
}

.db__rot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-left: 6px;
  border: 1px solid var(--color-muted-soft);
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-muted);
  vertical-align: 1px;
}

.db__time {
  font-size: 0.85rem;
  color: var(--color-ink-soft);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.db__row--extra .db__seat {
  color: var(--color-accent-700);
  font-weight: 600;
}

.db__empty {
  color: var(--color-muted);
  font-size: 0.9rem;
  border: 1px dashed var(--color-line);
  border-radius: 10px;
  padding: 0.9rem 1rem;
}

@media (max-width: 560px) {
  .db__row {
    grid-template-columns: 1fr auto;
  }

  .db__seat {
    grid-column: 1 / -1;
    padding-top: 0.15rem;
  }
}
</style>
