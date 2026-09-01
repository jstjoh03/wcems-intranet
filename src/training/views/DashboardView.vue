<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { supabase, invokeEdge } from '@/training/lib/supabase'
import { useAuthStore } from '@/training/stores/auth'
import {
  PlusCircle,
  SlidersHorizontal,
  Compass,
  BookOpen,
  HeartPulse,
  BookMarked,
  CalendarDays,
  FolderDown,
  ExternalLink,
  Library,
  CreditCard,
  Check,
} from 'lucide-vue-next'

const sessions = useSessionsStore()
const auth = useAuthStore()
const router = useRouter()

onMounted(() => {
  void sessions.loadRecentSessions()
  void sessions.loadPendingEcards()
  void loadWixPending()
})

/* -- Wix-scheduled classes not yet managed here --------------------
   Heather schedules some card classes directly in Wix. The calendar
   sync already mirrors those into training_sessions (source='wix');
   any without a linked course_session can be imported -- that creates
   the managed session (tokens, check-in, roster, evals) linked to the
   existing Wix event, without touching Wix. */
interface WixPendingRow {
  eventId: string
  serviceId: string | null
  title: string
  classDate: string
  startTime: string
  timeLabel: string
  capacity: number
  location: string
}
const wixPending = ref<WixPendingRow[]>([])
const wixBusy = ref<string | null>(null)
const wixError = ref<string | null>(null)

function fmtTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

async function loadWixPending() {
  /* Ask Wix directly (from the start of TODAY, Central) — the synced
     training_sessions mirror drops a slot once its start passes, so a
     same-day class would vanish from the import list right when the
     instructor needs it (Justin hit this with a BLS Renewal). */
  if (!auth.accessToken) return
  try {
    const [wixRes, managedRes] = await Promise.all([
      invokeEdge<{ classes: Array<{ eventId: string; serviceId: string | null; title: string; localStart: string; totalCapacity: number; location: string }> }>(
        'training-wix-classes',
        {},
        { authToken: auth.accessToken },
      ),
      supabase.from('course_sessions').select('wix_event_id').not('wix_event_id', 'is', null),
    ])
    const managed = new Set(
      (managedRes.data ?? []).map((r: { wix_event_id: string }) => r.wix_event_id),
    )
    wixPending.value = (wixRes.classes ?? [])
      .filter((c) => !managed.has(c.eventId))
      .sort((a, b) => a.localStart.localeCompare(b.localStart))
      .map((c) => {
        const [d, t] = c.localStart.split('T')
        const hhmm = (t ?? '').slice(0, 5)
        return {
          eventId: c.eventId,
          serviceId: c.serviceId,
          title: c.title,
          classDate: d,
          startTime: hhmm,
          timeLabel: hhmm ? fmtTimeLabel(hhmm) : '',
          capacity: c.totalCapacity ?? 0,
          location: c.location ?? '',
        }
      })
  } catch (e) {
    wixError.value = (e as Error).message
  }
}

async function adoptWix(w: WixPendingRow) {
  if (wixBusy.value) return
  wixBusy.value = w.eventId
  wixError.value = null
  try {
    await invokeEdge(
      'training-create-session',
      {
        sessionType: 'CardClass',
        cardCourseName: w.title,
        title: w.title,
        classDate: w.classDate,
        startTime: w.startTime,
        endTime: '',
        location: w.location,
        maxSeats: w.capacity || null,
        appBaseUrl: window.location.origin,
        registrationType: 'Wix',
        adopt: { wixEventId: w.eventId, wixServiceId: w.serviceId, wixServiceName: w.title },
      },
      { authToken: auth.accessToken },
    )
    await Promise.all([sessions.loadRecentSessions(), loadWixPending()])
  } catch (e) {
    wixError.value = (e as Error).message
  } finally {
    wixBusy.value = null
  }
}

// ── Pending eCards ────────────────────────────────────────────────
async function markIssued(id: string) {
  await sessions.setEcardIssued(id, true)
  await sessions.loadPendingEcards()
}
function fmtClassDate(d: string | null) {
  if (!d) return ''
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Quick-link tiles (intranet "command button" style) ──────────────────
// Internal app actions sit alongside instructor resources lifted from
// the SharePoint webpart, so everything an instructor reaches for
// regularly lives one tap away.
interface Tile {
  id: string
  label: string
  desc: string
  icon: typeof PlusCircle
  to?: string
  href?: string
}
const tiles: Tile[] = [
  {
    id: 'create',
    label: 'Create Session',
    desc: 'Card Class or Lecture',
    icon: PlusCircle,
    to: '/create',
  },
  {
    id: 'controls',
    label: 'Controls',
    desc: 'Roster, PSA, exports',
    icon: SlidersHorizontal,
    to: '/controls',
  },
  {
    id: 'archive',
    label: 'Archive',
    desc: 'Past sessions & PDFs',
    icon: Library,
    to: '/hub',
  },
  {
    id: 'atlas',
    label: 'Atlas',
    desc: 'Certs, exp dates, instructor numbers',
    icon: Compass,
    href: 'https://atlas.heart.org/dashboard',
  },
  {
    id: 'ebooks',
    label: 'eBooks',
    desc: 'Digital course videos & references',
    icon: BookOpen,
    href: 'https://ebooks.heart.org/bookshelf',
  },
  {
    id: 'guidelines',
    label: 'EC Guidelines',
    desc: 'AHA CPR & resuscitation science',
    icon: HeartPulse,
    href: 'https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines',
  },
  {
    id: 'pam',
    label: 'PAM',
    desc: 'Program Administration Manual',
    icon: BookMarked,
    href:
      'https://atlas.heart.org/PAM?contentId=b42e503791024ed7844cccf7972956d9',
  },
]

// ── AHA Course materials (per-course) ──────────────────────────────────
interface CourseRow {
  course: 'BLS' | 'ACLS' | 'PALS'
  blurb: string
  materialsUrl: string
  downloadsUrl: string
}
const courseRows: CourseRow[] = [
  {
    course: 'BLS',
    blurb: 'Basic Life Support',
    materialsUrl: 'https://cpr.heart.org/en/course-materials/bls-basic-life-support',
    downloadsUrl:
      'https://wcvems.sharepoint.com/:f:/r/sites/Education/AHA%20Course%20Materials/BLS?csf=1&web=1&e=LVBPLE',
  },
  {
    course: 'ACLS',
    blurb: 'Advanced Cardiovascular Life Support',
    materialsUrl:
      'https://cpr.heart.org/en/course-materials/advanced-cardiovascular-life-support-acls',
    downloadsUrl:
      'https://wcvems.sharepoint.com/:f:/r/sites/Education/AHA%20Course%20Materials/ACLS?csf=1&web=1&e=QL7Ogi',
  },
  {
    course: 'PALS',
    blurb: 'Pediatric Advanced Life Support',
    materialsUrl:
      'https://cpr.heart.org/en/course-materials/pediatric-advanced-life-support-pals',
    downloadsUrl:
      'https://wcvems.sharepoint.com/:f:/r/sites/Education/AHA%20Course%20Materials/PALS?csf=1&web=1&e=6YgkP3',
  },
]

// ── Active sessions ────────────────────────────────────────────────────
const recent = computed(() => sessions.recentSessions.slice(0, 12))

function courseName(s: {
  sessionType: string
  cardCourseName: string
  lectureTitle: string
  title: string
}) {
  return s.sessionType === 'CardClass'
    ? s.cardCourseName || s.title
    : s.lectureTitle || s.title
}
function fmtDate(d: string) {
  if (!d) return '—'
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
function openControls(sessionId: string) {
  router.push({ name: 'controls', query: { sessionId } })
}
</script>

<template>
  <AppShell>

    <header class="hero reveal">
      <div class="eyebrow">Welcome back</div>
      <h1 class="hero__name display">
        {{ auth.appUser?.firstName || 'Instructor' }}<em>.</em>
      </h1>
      <p class="hero__sub">
        Create a session, run check-in &amp; evaluations, and export AHA
        records.
      </p>
    </header>

    <!-- Quick-link tiles (navy glass command buttons) ─────────────── -->
    <section class="tiles reveal" style="animation-delay: 90ms">
      <ul class="tiles__grid">
        <li v-for="t in tiles" :key="t.id">
          <RouterLink
            v-if="t.to"
            :to="t.to"
            class="qt"
            :aria-label="t.label"
          >
            <span class="qt__shape">
              <component
                :is="t.icon"
                :size="22"
                :stroke-width="1.85"
                class="qt__icon"
              />
            </span>
            <span class="qt__name">{{ t.label }}</span>
            <span class="qt__desc">{{ t.desc }}</span>
          </RouterLink>
          <a
            v-else
            :href="t.href"
            target="_blank"
            rel="noopener noreferrer"
            class="qt"
            :aria-label="t.label"
          >
            <span class="qt__shape">
              <component
                :is="t.icon"
                :size="22"
                :stroke-width="1.85"
                class="qt__icon"
              />
              <ExternalLink :size="9" class="qt__ext" />
            </span>
            <span class="qt__name">{{ t.label }}</span>
            <span class="qt__desc">{{ t.desc }}</span>
          </a>
        </li>
      </ul>
    </section>

    <!-- AHA Course materials ────────────────────────────────────────── -->
    <section class="mats reveal" style="animation-delay: 140ms">
      <div class="mats__head">
        <span class="eyebrow">AHA course materials</span>
      </div>
      <div class="mats__list">
        <div v-for="c in courseRows" :key="c.course" class="mats__row card">
          <div class="mats__badge">{{ c.course }}</div>
          <div class="mats__body">
            <div class="mats__title">{{ c.blurb }}</div>
            <div class="mats__hint">
              Official AHA course materials &amp; internal downloads.
            </div>
          </div>
          <div class="mats__actions">
            <a
              class="mlink"
              :href="c.materialsUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <HeartPulse :size="13" :stroke-width="2" color="#ffffff" />
              Materials
              <ExternalLink
                :size="11"
                :stroke-width="2"
                color="#ffffff"
                class="mlink__ext"
              />
            </a>
            <a
              class="mlink mlink--alt"
              :href="c.downloadsUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FolderDown :size="13" :stroke-width="2" />
              Downloads
              <ExternalLink :size="11" :stroke-width="2" class="mlink__ext" />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Pending eCards ──────────────────────────────────────────────── -->
    <section class="ecards reveal" style="animation-delay: 160ms">
      <div class="mats__head ecards__head">
        <span class="eyebrow">
          <CreditCard :size="13" :stroke-width="2" /> Pending eCards
        </span>
        <span class="ecards__count">{{ sessions.pendingEcards.length }}</span>
      </div>
      <div v-if="!sessions.pendingEcards.length" class="ecards__empty">
        <Check :size="16" :stroke-width="2" />
        <span>All caught up — every checked-in student has been marked issued.</span>
      </div>
      <div v-else class="ecards__list">
        <div
          v-for="p in sessions.pendingEcards"
          :key="p.id"
          class="ecards__row card"
        >
          <div class="ecards__body">
            <div class="ecards__name">{{ p.studentName }}</div>
            <div class="ecards__sub">
              {{ p.course }} · {{ fmtClassDate(p.classDate) }}
              <span v-if="p.primaryInstructorName">
                · {{ p.primaryInstructorName }}
              </span>
            </div>
            <div class="ecards__email">
              {{ p.eCardEmail || p.studentEmail }}
            </div>
          </div>
          <button class="ecards__btn" @click="markIssued(p.id)">
            <Check :size="13" :stroke-width="2" /> Mark issued
          </button>
        </div>
      </div>
    </section>

    <!-- Wix-scheduled classes awaiting import ------------------------ -->
    <section v-if="wixPending.length" class="wixp reveal" style="animation-delay: 200ms">
      <div class="active__head">
        <span class="eyebrow">Scheduled on Wix — not managed here yet</span>
      </div>
      <p class="wixp__hint">
        These classes were scheduled directly in Wix (sign-ups run there as usual).
        Import one to manage it here — check-in, roster, and evaluations — without
        changing anything on Wix.
      </p>
      <div v-if="wixError" class="wixp__err">{{ wixError }}</div>
      <div v-for="w in wixPending" :key="w.eventId" class="wixp__row">
        <span class="wixp__title">{{ w.title }}</span>
        <span class="wixp__meta">
          {{ fmtDate(w.classDate) }}<template v-if="w.timeLabel"> · {{ w.timeLabel }}</template>
          <template v-if="w.capacity"> · {{ w.capacity }} seats</template>
        </span>
        <button
          type="button"
          class="wixp__btn"
          :disabled="wixBusy === w.eventId"
          @click="adoptWix(w)"
        >
          {{ wixBusy === w.eventId ? 'Importing…' : 'Import & manage' }}
        </button>
      </div>
    </section>

    <!-- Active sessions ─────────────────────────────────────────────── -->
    <section class="active reveal" style="animation-delay: 220ms">
      <div class="mats__head">
        <span class="eyebrow">Active sessions</span>
      </div>
      <div v-if="!recent.length" class="empty">
        No active sessions yet — create one above.
      </div>
      <table v-else class="tbl">
        <thead>
          <tr>
            <th>Course</th>
            <th>Date</th>
            <th>Type</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in recent" :key="s.sessionId">
            <td class="tbl__course">{{ courseName(s) }}</td>
            <td class="num">{{ fmtDate(s.classDate) }}</td>
            <td><span class="chip">{{ s.sessionType }}</span></td>
            <td class="tbl__right">
              <button class="btn btn-secondary sm" @click="openControls(s.sessionId)">
                <CalendarDays :size="13" /> Manage
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </AppShell>
</template>

<style scoped>
/* ── Hero ──────────────────────────────────────────────────────────── */
.hero {
  margin-bottom: 28px;
}
.hero__name {
  font-size: 40px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin-top: 8px;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .hero__name {
    font-size: 52px;
  }
}
.hero__name em {
  color: var(--color-accent-600);
  font-style: normal;
}
.hero__sub {
  margin-top: 14px;
  color: var(--color-muted);
  font-size: 14px;
  max-width: 56ch;
}

/* ── Tiles (navy glass command buttons) ───────────────────────────── */
.tiles {
  margin-bottom: 36px;
}
.tiles__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(122px, 1fr));
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (min-width: 720px) {
  .tiles__grid {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
}
.qt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
  padding: 6px 4px 4px;
}
.qt__shape {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  background: linear-gradient(
    145deg,
    oklch(0.22 0.1 250) 0%,
    oklch(0.14 0.06 250) 100%
  );
  border: 1px solid oklch(0.45 0.1 250 / 0.32);
  border-radius: 17px;
  overflow: hidden;
  isolation: isolate;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.06),
    0 1px 1px oklch(0 0 0 / 0.35),
    0 6px 14px oklch(0 0 0 / 0.22),
    0 0 22px oklch(0.35 0.14 250 / 0.18);
  transition:
    transform 220ms var(--ease-out),
    box-shadow 220ms var(--ease-out),
    border-color 220ms var(--ease-out);
}
.qt__shape::before {
  content: '';
  position: absolute;
  top: 0;
  left: 14%;
  right: 14%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(1 0 0 / 0.18) 50%,
    transparent 100%
  );
  pointer-events: none;
}
.qt:hover .qt__shape {
  border-color: oklch(0.734 0.114 86.8 / 0.45);
  transform: translateY(-2px) scale(1.04);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 2px 2px oklch(0 0 0 / 0.4),
    0 14px 28px oklch(0 0 0 / 0.32),
    0 0 30px oklch(0.734 0.114 86.8 / 0.22);
}
.qt:active .qt__shape {
  transform: translateY(-1px) scale(1);
  transition-duration: 80ms;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.04),
    inset 0 2px 6px oklch(0 0 0 / 0.25),
    0 1px 2px oklch(0 0 0 / 0.3),
    0 0 18px oklch(0.734 0.114 86.8 / 0.18);
}
.qt:focus-visible {
  outline: none;
}
.qt:focus-visible .qt__shape {
  border-color: var(--color-accent-500);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.1),
    0 0 0 2px oklch(0.734 0.114 86.8 / 0.4),
    0 6px 14px oklch(0 0 0 / 0.22),
    0 0 30px oklch(0.734 0.114 86.8 / 0.25);
}
.qt__icon {
  color: oklch(0.96 0.005 250);
  filter: drop-shadow(0 1px 1px oklch(0 0 0 / 0.5));
  transition: color 220ms var(--ease-out);
}
.qt:hover .qt__icon {
  color: var(--color-accent-500);
}
.qt__ext {
  position: absolute;
  top: 6px;
  right: 6px;
  color: oklch(0.85 0.04 86.8 / 0.85);
}
.qt__name {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.005em;
  line-height: 1.2;
  color: var(--color-ink-soft);
  text-align: center;
  transition: color 220ms var(--ease-out);
}
.qt:hover .qt__name {
  color: var(--color-ink);
}
.qt__desc {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.005em;
  color: var(--color-muted);
  text-align: center;
  line-height: 1.25;
  max-width: 14ch;
}

/* ── Course materials ─────────────────────────────────────────────── */
.mats {
  margin-bottom: 36px;
}
.mats__head {
  margin-bottom: 12px;
}
.mats__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mats__row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
}
.mats__badge {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(
    145deg,
    var(--color-brand-700),
    var(--color-brand-900)
  );
  color: #ffffff;
  font-family: var(--font-display);
  font-size: 19px;
  letter-spacing: 0.005em;
  text-shadow: 0 1px 1px oklch(0 0 0 / 0.35);
  border-top: 1px solid oklch(1 0 0 / 0.12);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.08),
    0 4px 10px oklch(0 0 0 / 0.2);
}
.mats__body {
  flex: 1;
  min-width: 0;
}
.mats__title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--color-ink);
}
.mats__hint {
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 2px;
}
.mats__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.mlink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  color: #fff;
  background: var(--color-brand-600);
  border: 1px solid transparent;
  transition: background 120ms var(--ease-out);
}
.mlink:hover {
  background: var(--color-brand-700);
}
/* lucide icons inherit currentColor, but make it explicit for clarity
   so the primary (navy) button always shows white icons and the
   secondary (white) button shows dark ones. */
.mlink svg {
  color: #fff;
}
.mlink--alt {
  background: var(--color-surface);
  color: var(--color-ink);
  border-color: var(--color-line);
}
.mlink--alt:hover {
  background: var(--color-surface-soft);
  border-color: var(--color-muted-soft);
}
.mlink--alt svg {
  color: var(--color-ink-soft);
}
.mlink__ext {
  opacity: 0.75;
}

/* ── Pending eCards ───────────────────────────────────────────────── */
.ecards {
  margin-bottom: 36px;
}
.ecards__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.ecards__head .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ecards__head .eyebrow svg {
  color: var(--color-accent-600);
}
.ecards__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--color-warning-50);
  color: var(--color-warning-500);
}
.ecards__empty {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border: 1px dashed var(--color-line);
  border-radius: 11px;
  font-size: 13.5px;
  color: var(--color-muted);
}
.ecards__empty svg {
  color: var(--color-success-500);
  flex-shrink: 0;
}
.ecards__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ecards__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 18px;
}
.ecards__body {
  min-width: 0;
}
.ecards__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink);
}
.ecards__sub {
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--color-ink-soft);
}
.ecards__email {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-muted);
}
.ecards__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border-radius: 8px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-ink-soft);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
  flex-shrink: 0;
}
.ecards__btn:hover {
  background: var(--color-success-50);
  color: var(--color-success-500);
  border-color: transparent;
}

/* -- Wix awaiting-import strip ------------------------------------- */
.wixp {
  margin-top: 34px;
  background: var(--color-surface);
  border: 1px dashed var(--color-accent-600);
  border-radius: 14px;
  padding: 16px 18px 8px;
}
.wixp__hint {
  margin: 6px 0 8px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-muted);
  max-width: 640px;
}
.wixp__err {
  margin-bottom: 8px;
  font-size: 12.5px;
  color: oklch(0.5 0.16 30);
}
.wixp__row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 9px 0;
  border-top: 1px solid var(--color-line-soft);
}
.wixp__title {
  font-weight: 700;
  font-size: 13.5px;
  color: var(--color-ink);
}
.wixp__meta {
  font-size: 12px;
  color: var(--color-muted);
}
.wixp__btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 9px;
  border: none;
  background: var(--color-brand-800);
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.wixp__btn:disabled {
  opacity: 0.55;
}

/* ── Active sessions table ────────────────────────────────────────── */
.empty {
  padding: 28px;
  text-align: center;
  color: var(--color-muted);
  font-size: 14px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
  margin-top: 12px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  margin-top: 4px;
}
.tbl th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  padding: 9px 10px;
  border-bottom: 1px solid var(--color-line);
}
.tbl td {
  padding: 12px 10px;
  border-bottom: 1px solid var(--color-line-soft);
}
.tbl__course {
  font-weight: 500;
}
.tbl__right {
  text-align: right;
}
.btn.sm {
  padding: 6px 11px;
  font-size: 12.5px;
}

@media (max-width: 640px) {
  .mats__row {
    flex-wrap: wrap;
  }
  .mats__actions {
    width: 100%;
  }
  .mlink {
    flex: 1;
    justify-content: center;
  }
  .tbl thead {
    display: none;
  }
  .tbl tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-line);
  }
  .tbl td {
    padding: 1px 0;
    border: none;
  }
  .tbl__right {
    grid-row: span 3;
    align-self: center;
  }
  .qt__desc {
    display: none;
  }
}
</style>
