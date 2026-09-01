<script setup lang="ts">
import { onMounted, ref, reactive, computed } from 'vue'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { useAuthStore } from '@/training/stores/auth'
import type { ArchiveFile, CourseSession } from '@/training/types'
import {
  Search,
  FileText,
  CheckSquare,
  SlidersHorizontal,
  ClipboardList,
  Download,
  ChevronDown,
  Library,
  Archive,
  ScrollText,
  Award,
  Trash2,
} from 'lucide-vue-next'

const sessions = useSessionsStore()
const auth = useAuthStore()

const q = ref('')
const status = ref<'all' | 'Active' | 'Closed' | 'Canceled'>('all')
const type = ref<'all' | 'CardClass' | 'Lecture'>('all')
const from = ref('')
const to = ref('')

const expanded = ref<string | null>(null)
const archiveCache = reactive<
  Record<string, ArchiveFile[] | 'loading'>
>({})

onMounted(() => {
  void sessions.loadAllSessions()
})

function courseName(s: CourseSession) {
  return s.sessionType === 'CardClass'
    ? s.cardCourseName || s.title
    : s.lectureTitle || s.title
}
function dateParts(d: string) {
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return { y, m, day, dt: new Date(y, m - 1, day) }
}
function moAbbr(d: string) {
  if (!d) return ''
  return dateParts(d).dt.toLocaleDateString('en-US', { month: 'short' })
}
function dayNum(d: string) {
  return d ? dateParts(d).day : ''
}
function wd(d: string) {
  if (!d) return ''
  return dateParts(d).dt.toLocaleDateString('en-US', { weekday: 'short' })
}
function fmtTs(ts: string) {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}
/** 5-year regulatory retention horizon. createdAt + 5y, formatted for
 *  the per-file "Retain until" hint shown beside each archived PDF. */
function retainUntil(ts: string) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  d.setFullYear(d.getFullYear() + 5)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const filtered = computed(() => {
  const term = q.value.trim().toLowerCase()
  return sessions.allSessions.filter((s) => {
    if (status.value !== 'all' && s.status !== status.value) return false
    if (type.value !== 'all' && s.sessionType !== type.value) return false
    const cd = (s.classDate || '').slice(0, 10)
    if (from.value && cd && cd < from.value) return false
    if (to.value && cd && cd > to.value) return false
    if (term) {
      const hay = [
        courseName(s),
        s.primaryInstructorName,
        s.secondaryInstructorName,
        s.tertiaryInstructorName,
        s.location,
        s.sessionId,
      ]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(term)) return false
    }
    return true
  })
})

// Course-type buckets: BLS / ACLS / PALS up top, then Other Card Classes,
// then Lectures last. Hidden when empty so the Archive feels like a
// proper filing cabinet — not a list of unmatched items.
type Bucket = 'BLS' | 'ACLS' | 'PALS' | 'Other' | 'Lecture'
const BUCKET_ORDER: Bucket[] = ['BLS', 'ACLS', 'PALS', 'Other', 'Lecture']
const BUCKET_LABEL: Record<Bucket, string> = {
  BLS: 'BLS',
  ACLS: 'ACLS',
  PALS: 'PALS',
  Other: 'Other Card Classes',
  Lecture: 'Lectures',
}
function bucketFor(s: CourseSession): Bucket {
  if (s.sessionType === 'Lecture') return 'Lecture'
  const name = (s.cardCourseName || s.title || '').toUpperCase()
  if (name.includes('BLS')) return 'BLS'
  if (name.includes('ACLS')) return 'ACLS'
  if (name.includes('PALS')) return 'PALS'
  return 'Other'
}

const typeBuckets = computed(() => {
  const map = new Map<Bucket, CourseSession[]>()
  for (const s of filtered.value) {
    const b = bucketFor(s)
    if (!map.has(b)) map.set(b, [])
    map.get(b)!.push(s)
  }
  return BUCKET_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
    key: b,
    label: BUCKET_LABEL[b],
    rows: (map.get(b) ?? []).sort((a, b) =>
      (b.classDate || '').localeCompare(a.classDate || ''),
    ),
  }))
})

// Which top-level course-type buckets are collapsed. Default: all open.
const collapsed = ref<Record<Bucket, boolean>>({
  BLS: false,
  ACLS: false,
  PALS: false,
  Other: false,
  Lecture: false,
})
function toggleBucket(k: Bucket) {
  collapsed.value = { ...collapsed.value, [k]: !collapsed.value[k] }
}

async function toggle(s: CourseSession) {
  if (expanded.value === s.sessionId) {
    expanded.value = null
    return
  }
  expanded.value = s.sessionId
  if (!archiveCache[s.sessionId]) {
    archiveCache[s.sessionId] = 'loading'
    archiveCache[s.sessionId] = await sessions.listArchives(s.sessionId)
  }
}

function archivesOf(id: string): ArchiveFile[] {
  const v = archiveCache[id]
  return Array.isArray(v) ? v : []
}
function examGroups(id: string) {
  return studentGroups(id, 'Exam')
}
function ceGroups(id: string) {
  return studentGroups(id, 'CE')
}
function studentGroups(id: string, kind: 'Exam' | 'CE') {
  const map = new Map<string, ArchiveFile[]>()
  for (const f of archivesOf(id)) {
    if (f.recordType !== kind) continue
    const key = f.studentEmail || 'unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([studentEmail, files]) => ({ studentEmail, files }))
}
function isLoading(id: string) {
  return archiveCache[id] === 'loading'
}

/* Admin-only: permanently remove an archived file. 5-year retention is
 * the rule — this is the dedupe escape hatch only. */
const deleting = ref<Set<string>>(new Set())
const deletingSession = ref<Set<string>>(new Set())
const flash = ref<string | null>(null)

async function deleteSessionAction(s: CourseSession) {
  if (deletingSession.value.has(s.sessionId)) return
  const label = courseName(s)
  if (
    !confirm(
      `Permanently delete "${label}" on ${s.classDate || 'this date'}?\n\n` +
        `This will remove:\n` +
        `  • the session itself\n` +
        `  • every registration and check-in for it\n` +
        `  • every eval submission for it\n` +
        `  • every archived PDF (rosters, evals, exams, CE certs)\n` +
        `  • the intranet-calendar tile if it's a lecture\n\n` +
        `WCEMS is required to retain training records for 5 years. ` +
        `Only delete duplicates or sessions created by mistake. ` +
        `This cannot be undone.`,
    )
  ) {
    return
  }
  deletingSession.value.add(s.sessionId)
  try {
    const r = await sessions.deleteSession(s.sessionId)
    flash.value =
      `Deleted "${label}" — ${r.files} file${r.files === 1 ? '' : 's'}, ` +
      `${r.attendance} attendance, ${r.evals} eval${r.evals === 1 ? '' : 's'} removed.`
    setTimeout(() => (flash.value = null), 6000)
    delete archiveCache[s.sessionId]
    if (expanded.value === s.sessionId) expanded.value = null
  } catch (e) {
    alert(
      'Delete failed: ' + (e instanceof Error ? e.message : 'unknown error'),
    )
  } finally {
    deletingSession.value.delete(s.sessionId)
  }
}
async function deleteFile(file: ArchiveFile, sessionId: string) {
  if (deleting.value.has(file.path)) return
  const label =
    file.recordType === 'CE'
      ? `the CE certificate for ${file.studentEmail || 'this student'}`
      : `${file.fileName}`
  if (
    !confirm(
      `Permanently delete ${label}?\n\n` +
        `WCEMS is required to retain training records for 5 years. ` +
        `Only delete duplicates or files uploaded by mistake. ` +
        `This cannot be undone.`,
    )
  ) {
    return
  }
  deleting.value.add(file.path)
  try {
    await sessions.deleteArchive(file, sessionId)
    // Drop the file from the cached list without re-fetching the whole
    // archive — fast feedback and saves a round-trip.
    const list = archiveCache[sessionId]
    if (Array.isArray(list)) {
      archiveCache[sessionId] = list.filter((f) => f.path !== file.path)
    }
  } catch (e) {
    alert(
      'Delete failed: ' + (e instanceof Error ? e.message : 'unknown error'),
    )
  } finally {
    deleting.value.delete(file.path)
  }
}

const counts = computed(() => ({
  total: sessions.allSessions.length,
  active: sessions.allSessions.filter((s) => s.status === 'Active').length,
  closed: sessions.allSessions.filter((s) => s.status === 'Closed').length,
}))
</script>

<template>
  <AppShell>
    <header class="hero reveal">
      <div class="hero__text">
        <div class="eyebrow">Records</div>
        <h1 class="hero__title display">
          <em class="hero__accent">Archive</em>.
        </h1>
        <p class="hero__sub">
          Every AHA session — active and closed — with its generated
          rosters and evaluations. Search by course, instructor, or date.
        </p>
      </div>
      <div class="hero__stats">
        <div class="hstat">
          <span class="hstat__n display">{{ counts.total }}</span>
          <span class="hstat__l">Sessions</span>
        </div>
        <div class="hstat">
          <span class="hstat__n display">{{ counts.active }}</span>
          <span class="hstat__l">Active</span>
        </div>
        <div class="hstat">
          <span class="hstat__n display">{{ counts.closed }}</span>
          <span class="hstat__l">Closed</span>
        </div>
      </div>
    </header>

    <div class="filters card">
      <div class="srch">
        <Search :size="16" />
        <input
          v-model="q"
          type="text"
          placeholder="Search course, instructor, location, session ID…"
        />
      </div>
      <div class="filters__row">
        <div class="seg">
          <button
            v-for="opt in (['all', 'Active', 'Closed', 'Canceled'] as const)"
            :key="opt"
            class="seg__btn"
            :class="{ 'seg__btn--on': status === opt }"
            @click="status = opt"
          >
            {{ opt === 'all' ? 'All' : opt }}
          </button>
        </div>
        <select v-model="type" class="sel">
          <option value="all">All types</option>
          <option value="CardClass">Card Class</option>
          <option value="Lecture">Lecture</option>
        </select>
        <label class="date">
          <span>From</span><input v-model="from" type="date" />
        </label>
        <label class="date">
          <span>To</span><input v-model="to" type="date" />
        </label>
      </div>
    </div>

    <Transition name="hubflash">
      <div v-if="flash" class="hub-flash">
        <Archive :size="14" :stroke-width="2" /> {{ flash }}
      </div>
    </Transition>

    <div v-if="sessions.allLoading" class="empty">
      <Library :size="22" :stroke-width="1.5" class="empty__icon" />
      <div class="empty__title">Loading the archive…</div>
    </div>

    <div v-else-if="!filtered.length" class="empty">
      <Archive :size="22" :stroke-width="1.5" class="empty__icon" />
      <div class="empty__title">No sessions match</div>
      <p class="empty__sub">Adjust the search or filters above.</p>
    </div>

    <template v-else>
      <section
        v-for="bucket in typeBuckets"
        :key="bucket.key"
        class="bucket"
      >
        <button
          type="button"
          class="bucket__head"
          :class="{ 'bucket__head--closed': collapsed[bucket.key] }"
          @click="toggleBucket(bucket.key)"
        >
          <span class="bucket__label display">{{ bucket.label }}</span>
          <span class="bucket__count">{{ bucket.rows.length }}</span>
          <ChevronDown :size="16" :stroke-width="2" class="bucket__chev" />
        </button>

        <div v-show="!collapsed[bucket.key]" class="bucket__body">
        <div v-for="s in bucket.rows" :key="s.sessionId" class="row card">
          <div class="row__main">
            <div class="datepill">
              <div class="datepill__mo">{{ moAbbr(s.classDate) }}</div>
              <div class="datepill__day display">{{ dayNum(s.classDate) }}</div>
              <div class="datepill__wd">{{ wd(s.classDate) }}</div>
            </div>

            <div class="row__body">
              <div class="row__title display">{{ courseName(s) }}</div>
              <div class="row__meta">
                <span class="mchip">{{ s.sessionType }}</span>
                <span
                  class="mchip"
                  :class="
                    s.status === 'Canceled'
                      ? 'mchip--canceled'
                      : s.status === 'Closed'
                        ? 'mchip--closed'
                        : 'mchip--active'
                  "
                >
                  {{ s.status }}
                </span>
                <span v-if="s.primaryInstructorName" class="mchip ghost">
                  {{ s.primaryInstructorName }}
                </span>
                <span v-if="s.location" class="mchip ghost">{{ s.location }}</span>
                <span v-if="s.hoursAwarded" class="mchip ghost">
                  {{ s.hoursAwarded }} hrs
                </span>
                <span class="sid">{{ s.sessionId }}</span>
              </div>

              <div class="row__actions">
                <RouterLink
                  class="act"
                  :to="{ name: 'controls', query: { sessionId: s.sessionId } }"
                >
                  <SlidersHorizontal :size="13" /> Controls
                </RouterLink>
                <RouterLink
                  class="act"
                  :to="{ name: 'registrations', query: { sessionId: s.sessionId } }"
                >
                  <ClipboardList :size="13" /> Registrations
                </RouterLink>
                <RouterLink
                  v-if="s.sessionType === 'CardClass'"
                  class="act"
                  :to="{ name: 'roster-export', query: { sessionId: s.sessionId } }"
                >
                  <FileText :size="13" /> Roster PDF
                </RouterLink>
                <RouterLink
                  class="act"
                  :to="{ name: 'evals-export', query: { sessionId: s.sessionId } }"
                >
                  <CheckSquare :size="13" /> Evaluations
                </RouterLink>
                <button
                  v-if="auth.isAdmin"
                  class="act act--danger"
                  :disabled="deletingSession.has(s.sessionId)"
                  :title="'Permanently delete this session (admin only)'"
                  @click="deleteSessionAction(s)"
                >
                  <Trash2 :size="13" />
                  {{
                    deletingSession.has(s.sessionId)
                      ? 'Deleting…'
                      : 'Delete session'
                  }}
                </button>
              </div>
            </div>

            <button
              class="row__toggle"
              :class="{ 'row__toggle--open': expanded === s.sessionId }"
              @click="toggle(s)"
            >
              <Archive :size="14" :stroke-width="2" />
              <span>Files</span>
              <ChevronDown :size="14" :stroke-width="2" class="chev" />
            </button>
          </div>

          <Transition name="reveal-fade">
            <div v-if="expanded === s.sessionId" class="archive">
              <div v-if="isLoading(s.sessionId)" class="archive__loading">
                Loading archived PDFs…
              </div>
              <template v-else>
                <div
                  v-if="!archivesOf(s.sessionId).length"
                  class="archive__empty"
                >
                  No archived PDFs yet. Generate a roster or evaluations
                  and they'll be retained here.
                </div>
                <template v-else>
                  <template
                    v-for="rt in (['Roster', 'Evaluation', 'Exam', 'CE'] as const)"
                    :key="rt"
                  >
                    <div
                      v-if="archivesOf(s.sessionId).some((f) => f.recordType === rt)"
                      class="archive__group"
                    >
                      <div class="archive__group-h">
                        <component
                          :is="
                            rt === 'Roster'
                              ? FileText
                              : rt === 'Evaluation'
                                ? CheckSquare
                                : rt === 'CE'
                                  ? Award
                                  : ScrollText
                          "
                          :size="13"
                        />
                        {{
                          rt === 'Roster'
                            ? 'Rosters'
                            : rt === 'Evaluation'
                              ? 'Evaluations'
                              : rt === 'CE'
                                ? 'CE Certificates'
                                : 'Exam Answer Sheets'
                        }}
                      </div>

                      <!-- Roster / Evaluation: flat list. Exam + CE: grouped by student. -->
                      <template v-if="rt !== 'Exam' && rt !== 'CE'">
                        <div
                          v-for="f in archivesOf(s.sessionId).filter(
                            (x) => x.recordType === rt,
                          )"
                          :key="f.path"
                          class="arow"
                        >
                          <a
                            :href="f.signedUrl"
                            target="_blank"
                            rel="noopener"
                            class="afile"
                          >
                            <Download :size="13" :stroke-width="2" />
                            <span class="afile__name">{{ f.fileName }}</span>
                            <span class="afile__meta">
                              <span>{{ fmtTs(f.createdAt) }}</span>
                              <span class="afile__retain"
                                >Retain until {{ retainUntil(f.createdAt) }}</span
                              >
                            </span>
                          </a>
                          <button
                            v-if="auth.isAdmin"
                            class="adel"
                            :disabled="deleting.has(f.path)"
                            :title="'Permanently delete (admin only)'"
                            @click="deleteFile(f, s.sessionId)"
                          >
                            <Trash2 :size="13" :stroke-width="2" />
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <div
                          v-for="group in (rt === 'CE' ? ceGroups(s.sessionId) : examGroups(s.sessionId))"
                          :key="group.studentEmail"
                          class="examgroup"
                        >
                          <div class="examgroup__h">{{ group.studentEmail }}</div>
                          <div
                            v-for="f in group.files"
                            :key="f.path"
                            class="arow"
                          >
                            <a
                              :href="f.signedUrl"
                              target="_blank"
                              rel="noopener"
                              class="afile"
                            >
                              <Download :size="13" :stroke-width="2" />
                              <span class="afile__name">{{ f.fileName }}</span>
                              <span class="afile__meta">
                                <span>{{ fmtTs(f.createdAt) }}</span>
                                <span class="afile__retain"
                                  >Retain until {{ retainUntil(f.createdAt) }}</span
                                >
                              </span>
                            </a>
                            <button
                              v-if="auth.isAdmin"
                              class="adel"
                              :disabled="deleting.has(f.path)"
                              :title="'Permanently delete (admin only)'"
                              @click="deleteFile(f, s.sessionId)"
                            >
                              <Trash2 :size="13" :stroke-width="2" />
                            </button>
                          </div>
                        </div>
                      </template>
                    </div>
                  </template>
                </template>
              </template>
            </div>
          </Transition>
        </div>
        </div>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
/* ── Editorial hero ─────────────────────────────────────────────────── */
.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 28px;
}
.hero__text {
  min-width: 0;
}
.hero__title {
  font-size: 40px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin-top: 8px;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .hero__title {
    font-size: 52px;
  }
}
.hero__accent {
  color: var(--color-brand-600);
  font-style: italic;
}
.hero__sub {
  margin-top: 12px;
  font-size: 14px;
  color: var(--color-muted);
  max-width: 56ch;
}
.hero__stats {
  display: flex;
  gap: 26px;
  flex-shrink: 0;
}
.hstat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.hstat__n {
  font-size: 34px;
  line-height: 1;
  color: var(--color-brand-600);
}
.hstat__l {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
  margin-top: 5px;
}
@media (max-width: 720px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 18px;
  }
  .hero__stats {
    gap: 22px;
  }
  .hstat {
    align-items: flex-start;
  }
}

/* ── Filters ────────────────────────────────────────────────────────── */
.filters {
  padding: 16px;
  margin-bottom: 26px;
}
.srch {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: 9px;
  background: var(--color-surface-soft);
  margin-bottom: 12px;
}
.srch svg {
  color: var(--color-muted);
  flex-shrink: 0;
}
.srch input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  padding: 11px 0;
  font-size: 14px;
  font-family: inherit;
  color: var(--color-ink);
}
.filters__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.seg {
  display: inline-flex;
  padding: 3px;
  background: var(--color-surface-sunk);
  border-radius: 8px;
}
.seg__btn {
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 120ms var(--ease-out);
}
.seg__btn--on {
  background: var(--color-surface);
  color: var(--color-brand-700);
  box-shadow: var(--shadow-sm);
}
.sel {
  padding: 9px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  font-size: 13px;
  font-family: inherit;
  color: var(--color-ink);
}
.date {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--color-muted);
}
.date input {
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-surface);
  font-size: 13px;
  font-family: inherit;
  color: var(--color-ink);
}

/* ── Empty ──────────────────────────────────────────────────────────── */
.empty {
  text-align: center;
  padding: 56px 20px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.empty__icon {
  color: var(--color-muted-soft);
  margin: 0 auto 10px;
}
.empty__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.empty__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}

/* ── Course-type buckets ─────────────────────────────────────────── */
.bucket {
  margin-top: 24px;
}
.bucket:first-of-type {
  margin-top: 0;
}
.bucket__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-line);
  cursor: pointer;
  text-align: left;
  margin-bottom: 14px;
}
.bucket__label {
  font-size: 22px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
}
.bucket__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  font-size: 11.5px;
  font-weight: 600;
  font-family: var(--font-sans);
}
.bucket__chev {
  margin-left: auto;
  color: var(--color-muted);
  transition: transform 180ms var(--ease-out);
}
.bucket__head--closed .bucket__chev {
  transform: rotate(-90deg);
}
.bucket__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Per-student grouping inside the Exams section */
.examgroup {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--color-line-soft);
}
.examgroup:first-of-type {
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}
.examgroup__h {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-ink-soft);
  margin-bottom: 6px;
  letter-spacing: 0.02em;
}
.row {
  margin-bottom: 10px;
  overflow: hidden;
}
.row__main {
  display: flex;
  gap: 16px;
  padding: 16px;
  align-items: flex-start;
}
.datepill {
  flex-shrink: 0;
  width: 58px;
  text-align: center;
  padding: 9px 6px;
  border-radius: 9px;
  background: var(--color-surface-soft);
  border: 1px solid var(--color-line);
}
.datepill__mo {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-700);
}
.datepill__day {
  font-size: 23px;
  color: var(--color-brand-600);
  line-height: 1.1;
}
.datepill__wd {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.row__body {
  flex: 1;
  min-width: 0;
}
.row__title {
  font-size: 17px;
  letter-spacing: -0.005em;
  color: var(--color-ink);
  line-height: 1.25;
}
.row__meta {
  margin-top: 9px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mchip {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  background: var(--color-brand-50);
  color: var(--color-brand-700);
  border: 1px solid var(--color-line);
}
.mchip.ghost {
  background: var(--color-surface-soft);
  color: var(--color-ink-soft);
}
.mchip--active {
  background: var(--color-success-50);
  color: var(--color-success-500);
  border-color: transparent;
}
.mchip--closed {
  background: var(--color-surface-sunk);
  color: var(--color-muted);
  border-color: transparent;
}
.mchip--canceled {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
  border-color: transparent;
  text-decoration: line-through;
}
.sid {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.03em;
  color: var(--color-muted-soft);
  margin-left: 2px;
}
.row__actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-ink-soft);
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  text-decoration: none;
  transition: all 120ms var(--ease-out);
}
.act:hover {
  border-color: var(--color-brand-300);
  color: var(--color-brand-700);
}
.act svg {
  color: var(--color-muted);
}
.act--danger {
  color: oklch(0.45 0.1 28);
  cursor: pointer;
  font-family: inherit;
}
.act--danger svg {
  color: oklch(0.55 0.13 28);
}
.act--danger:hover {
  background: oklch(0.94 0.06 28);
  border-color: oklch(0.78 0.13 28);
  color: oklch(0.4 0.13 28);
}
.act--danger:disabled {
  opacity: 0.55;
  cursor: progress;
}

/* Flash banner shown after a successful session delete */
.hub-flash {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px 16px;
  background: oklch(0.97 0.05 152);
  color: oklch(0.36 0.09 152);
  border: 1px solid oklch(0.85 0.085 152);
  border-radius: 12px;
  font-size: 13px;
}
.hub-flash svg {
  color: oklch(0.36 0.09 152);
  flex-shrink: 0;
}
.hubflash-enter-active,
.hubflash-leave-active {
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}
.hubflash-enter-from,
.hubflash-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.row__toggle {
  flex-shrink: 0;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-brand-700);
  background: var(--color-brand-50);
  border: 1px solid var(--color-line);
  cursor: pointer;
  transition: background 120ms var(--ease-out);
}
.row__toggle:hover {
  background: var(--color-brand-100);
}
.chev {
  transition: transform 180ms var(--ease-out);
}
.row__toggle--open .chev {
  transform: rotate(180deg);
}
.archive {
  border-top: 1px solid var(--color-line);
  padding: 16px;
  background: var(--color-surface-soft);
}
.archive__loading,
.archive__empty {
  font-size: 13px;
  color: var(--color-muted);
}
.archive__group + .archive__group {
  margin-top: 14px;
}
.archive__group-h {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-muted);
  margin-bottom: 8px;
}
.archive__group-h svg {
  color: var(--color-accent-600);
}
.arow {
  display: flex;
  align-items: stretch;
  gap: 6px;
  margin-bottom: 6px;
}
.afile {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  text-decoration: none;
  transition: border-color 120ms var(--ease-out);
}
.afile:hover {
  border-color: var(--color-brand-300);
}
.adel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  color: var(--color-muted);
  cursor: pointer;
  transition: background 120ms var(--ease-out), color 120ms var(--ease-out),
    border-color 120ms var(--ease-out);
}
.adel:hover {
  background: oklch(0.94 0.06 28);
  border-color: oklch(0.78 0.13 28);
  color: oklch(0.4 0.13 28);
}
.adel:disabled {
  opacity: 0.5;
  cursor: progress;
}
.afile svg {
  color: var(--color-brand-600);
  flex-shrink: 0;
}
.afile__name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.afile__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-muted);
}
.afile__retain {
  color: var(--color-accent-700);
  letter-spacing: 0.02em;
}
.reveal-fade-enter-active,
.reveal-fade-leave-active {
  transition: opacity 160ms var(--ease-out);
}
.reveal-fade-enter-from,
.reveal-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .row__main {
    flex-wrap: wrap;
  }
  .row__toggle {
    margin-left: 74px;
  }
  .afile__meta {
    flex-direction: row;
    gap: 8px;
    align-items: center;
    font-size: 10px;
  }
}
</style>
