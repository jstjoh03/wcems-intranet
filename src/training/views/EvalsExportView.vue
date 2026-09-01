<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import JSZip from 'jszip'
import AppShell from '@/training/components/AppShell.vue'
import { useSessionsStore } from '@/training/stores/sessions'
import { generateSingleEvalPdf } from '@/training/lib/evalPdf'
import { generateLectureEvalPdf } from '@/training/lib/lectureEvalPdf'
import { courseTemplateFor } from '@/training/lib/pdfTemplates'
import { archiveFile } from '@/training/lib/archive'
import type { CourseTemplate, EvalRecord } from '@/training/types'
import { CheckSquare, FileCheck2 } from 'lucide-vue-next'

const route = useRoute()
const sessions = useSessionsStore()

const ready = ref(false)
const status = ref<{ t: string; k: 'error' | 'success' } | null>(null)
const busy = ref(false)
const progress = ref(0)

function norm(v: unknown) {
  return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const isLecture = computed(
  () => sessions.currentSession?.sessionType === 'Lecture',
)
const courseType = computed(() => {
  const s = sessions.currentSession
  if (!s) return 'BLS'
  // Lectures don't use the AHA fillable-PDF template — keep the
  // generic 'LECTURE' label so the UI + zip filename reflect it.
  if (s.sessionType === 'Lecture') return 'LECTURE'
  return courseTemplateFor(s.cardCourseName || s.title || '')
})

const lookup = computed(() => {
  const byEmail: Record<string, EvalRecord> = {}
  const byName: Record<string, EvalRecord> = {}
  sessions.evals.forEach((e) => {
    const em = norm(e.studentEmail)
    const nm = norm(e.studentName)
    if (em) byEmail[em] = e
    if (nm) byName[nm] = e
  })
  return { byEmail, byName }
})

function evalFor(a: {
  studentEmail: string
  eCardEmail: string
  studentName: string
}): EvalRecord | null {
  const em = norm(a.studentEmail || a.eCardEmail)
  if (em && lookup.value.byEmail[em]) return lookup.value.byEmail[em]
  const nm = norm(a.studentName)
  if (nm && lookup.value.byName[nm]) return lookup.value.byName[nm]
  return null
}

const checkedIn = computed(() =>
  sessions.attendance.filter((a) => a.phase === 'checkedin'),
)
const rows = computed(() =>
  checkedIn.value.map((a) => ({ a, ev: evalFor(a) })),
)
const completed = computed(() => rows.value.filter((r) => r.ev).length)

onMounted(async () => {
  const sessionId = (route.query.sessionId as string) || ''
  if (!sessionId) {
    status.value = { t: 'No session ID provided.', k: 'error' }
    return
  }
  await sessions.loadSessionDetail(sessionId)
  if (!sessions.currentSession) {
    status.value = { t: sessions.error || 'Session not found.', k: 'error' }
    return
  }
  ready.value = true
})

async function generateAll() {
  status.value = null
  const withEvals = rows.value.filter((r) => r.ev)
  if (!withEvals.length) {
    status.value = { t: 'No completed evaluations to generate.', k: 'error' }
    return
  }
  busy.value = true
  progress.value = 0
  try {
    const zip = new JSZip()
    const s = sessions.currentSession!
    const meta = {
      classDate: s.classDate,
      location: s.location,
      primaryInstructorName: s.primaryInstructorName,
    }
    const lectureMeta = {
      ...meta,
      lectureTitle: s.lectureTitle || s.title || 'CE Lecture',
      dshsContentArea: s.dshsContentArea || '',
      hoursAwarded: s.hoursAwarded || '',
    }
    let done = 0
    for (const { a, ev } of withEvals) {
      // Lectures use our custom CE-eval form generator; AHA card
      // classes stay on the fillable PDF template per discipline.
      const bytes = isLecture.value
        ? generateLectureEvalPdf(ev!.answers, lectureMeta)
        : await generateSingleEvalPdf(
            ev!.answers,
            courseType.value as CourseTemplate,
            meta,
          )
      const safe = (a.studentName || 'Student').replace(/[^a-zA-Z0-9]/g, '_')
      const fileName = `${safe}_Evaluation.pdf`
      zip.file(fileName, bytes)
      try {
        await archiveFile({
          sessionId: s.sessionId,
          recordType: 'Evaluation',
          fileName,
          blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        })
      } catch {
        /* non-fatal, same as legacy */
      }
      done++
      progress.value = Math.round((done / withEvals.length) * 100)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${courseType.value}_Evaluations_${s.sessionId}.zip`
    link.click()
    URL.revokeObjectURL(url)
    status.value = {
      t: `Successfully generated ${done} evaluation PDFs. Each archived individually.`,
      k: 'success',
    }
  } catch (e) {
    status.value = {
      t: 'Error generating PDFs: ' + (e instanceof Error ? e.message : 'unknown'),
      k: 'error',
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppShell>
    <header class="hero reveal">
      <div class="eyebrow">
        {{ isLecture ? 'Lecture export' : 'AHA export' }}
      </div>
      <h1 class="hero__title display">
        Course <em class="hero__accent">Evaluations</em>.
      </h1>
      <p class="hero__sub">
        {{
          isLecture
            ? 'Generates a completed CE-lecture evaluation PDF for every student who submitted one, bundled as a zip and archived individually to the 5-year record store.'
            : 'Generates a completed AHA evaluation PDF for every student who submitted one, bundled as a zip and archived individually to the 5-year record store.'
        }}
      </p>
    </header>

    <div v-if="!ready && !status" class="state">
      <CheckSquare :size="22" :stroke-width="1.5" class="state__icon" />
      <div class="state__title">Loading session…</div>
    </div>
    <div v-else-if="!ready && status" class="state">
      <CheckSquare :size="22" :stroke-width="1.5" class="state__icon" />
      <div class="state__title">Couldn't load session</div>
      <p class="state__sub">{{ status.t }}</p>
    </div>

    <template v-else>
      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">Course</span>
        </div>
        <div class="cgrid">
          <div class="ci">
            <span class="ci__l">{{ isLecture ? 'Lecture' : 'Course' }}</span>
            <span class="ci__v">{{
              isLecture
                ? (sessions.currentSession!.lectureTitle ||
                  sessions.currentSession!.title)
                : (sessions.currentSession!.cardCourseName ||
                  sessions.currentSession!.title)
            }}</span>
          </div>
          <div class="ci">
            <span class="ci__l">Lead instructor</span>
            <span class="ci__v">{{
              sessions.currentSession!.primaryInstructorName || '—'
            }}</span>
          </div>
          <div v-if="!isLecture" class="ci">
            <span class="ci__l">Course type</span>
            <span class="ci__v">{{ courseType }}</span>
          </div>
          <div v-else-if="sessions.currentSession!.dshsContentArea" class="ci">
            <span class="ci__l">DSHS content area</span>
            <span class="ci__v">{{ sessions.currentSession!.dshsContentArea }}</span>
          </div>
          <div class="ci">
            <span class="ci__l">Completed</span>
            <span class="ci__v ci__v--accent">
              {{ completed }} / {{ checkedIn.length }}
            </span>
          </div>
        </div>
      </section>

      <section class="card block">
        <div class="block__head">
          <span class="eyebrow">
            <FileCheck2 :size="13" :stroke-width="2" /> Students
          </span>
          <span class="count">{{ completed }} with evals</span>
        </div>
        <div v-if="!checkedIn.length" class="block__empty">
          No students checked in for this session.
        </div>
        <div v-for="{ a, ev } in rows" :key="a.id" class="srow">
          <div>
            <div class="srow__name">{{ a.studentName }}</div>
            <div class="srow__email">{{ a.studentEmail }}</div>
          </div>
          <span class="tag" :class="ev ? 'tag--ok' : 'tag--no'">
            {{ ev ? 'Eval completed' : 'No eval' }}
          </span>
        </div>
      </section>

      <div v-if="busy" class="card block prog-card">
        <div class="bar"><div class="fill" :style="{ width: progress + '%' }" /></div>
        <div class="prog-text">Generating… {{ progress }}%</div>
      </div>

      <div class="actionbar">
        <button
          class="btn btn-primary big"
          :disabled="busy || completed === 0"
          @click="generateAll"
        >
          <CheckSquare :size="16" :stroke-width="2" />
          {{ busy ? 'Generating…' : 'Generate All Evaluation PDFs' }}
        </button>
      </div>
      <div v-if="status" class="msg" :class="status.k">{{ status.t }}</div>
    </template>
  </AppShell>
</template>

<style scoped>
.hero {
  margin-bottom: 26px;
}
.hero__title {
  font-size: 38px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin-top: 8px;
  color: var(--color-ink);
}
@media (min-width: 768px) {
  .hero__title {
    font-size: 48px;
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
  max-width: 60ch;
}
.state {
  text-align: center;
  padding: 56px 20px;
  border: 1px dashed var(--color-line);
  border-radius: 12px;
}
.state__icon {
  color: var(--color-muted-soft);
  margin: 0 auto 10px;
}
.state__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-soft);
}
.state__sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-muted);
}
.block {
  padding: 20px;
  margin-bottom: 16px;
}
.block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-line-soft);
}
.block__head .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.block__head .eyebrow svg {
  color: var(--color-accent-600);
}
.count {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-brand-600);
}
.block__empty {
  font-size: 13.5px;
  color: var(--color-muted);
  padding: 8px 0;
}
.cgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.ci {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ci__l {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-muted);
}
.ci__v {
  font-size: 15px;
  color: var(--color-ink);
}
.ci__v--accent {
  font-family: var(--font-display);
  font-size: 22px;
  color: var(--color-brand-600);
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--color-line-soft);
}
.srow:last-child {
  border-bottom: none;
}
.srow__name {
  font-size: 14px;
  color: var(--color-ink);
}
.srow__email {
  font-size: 12.5px;
  color: var(--color-muted);
}
.tag {
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 11px;
  border-radius: 999px;
  white-space: nowrap;
}
.tag--ok {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
.tag--no {
  background: var(--color-surface-sunk);
  color: var(--color-muted);
}
.prog-card {
  padding: 18px 20px;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--color-line);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--color-brand-600);
  transition: width 250ms var(--ease-out);
}
.prog-text {
  margin-top: 10px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-muted);
}
.actionbar {
  position: sticky;
  bottom: 16px;
  margin-top: 4px;
}
.btn.big {
  width: 100%;
  padding: 15px;
  font-size: 15px;
  box-shadow: var(--shadow-lg);
}
.msg {
  margin-top: 14px;
  padding: 13px 15px;
  border-radius: 10px;
  font-size: 13.5px;
}
.msg.error {
  background: var(--color-danger-50);
  color: var(--color-danger-500);
}
.msg.success {
  background: var(--color-success-50);
  color: var(--color-success-500);
}
@media (max-width: 560px) {
  .cgrid {
    grid-template-columns: 1fr;
  }
}
</style>
