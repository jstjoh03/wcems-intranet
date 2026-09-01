import { watchEffect } from 'vue'
import { useClinical } from '@/composables/useClinical'
import { useClinicalDocs } from '@/composables/useClinicalDocs'
import { useExams, type ExamAssignment } from '@/composables/useExams'
import { generateExamCertPdf } from '@/lib/examCertPdf'

/**
 * Completion-certificate auto-filing. A clean exam pass files a
 * certificate PDF into the employee's Documents (Protocol exams,
 * employee-visible). Generation happens client-side in an EDITOR'S
 * session — so this runs wherever an editor is likely to be looking:
 * the Exams manager AND the employee file (Perry's cert sat ungenerated
 * because Justin had navigated off the Exams page when he submitted).
 * Deduped by document name; module-level in-flight guard means both
 * pages can mount it safely.
 */

const inFlight = new Set<string>()

export function useExamCertAutoFile() {
  const { canEdit, clinicalPeople } = useClinical()
  const clindocs = useClinicalDocs()
  const exams = useExams()

  function nameOf(userId: string): string {
    return clinicalPeople.value.find((p) => p.userId === userId)?.fullName ?? 'Staff'
  }

  function certNameFor(a: ExamAssignment): string {
    const safe = nameOf(a.userId).replace(/\s+/g, '_').replace(/[^\w-]/g, '')
    const d = exams.definitionById(a.examId)
    const date = (a.submittedAt ?? '').slice(0, 10)
    return `WCEMS_Exam_Certificate_${d?.slug ?? a.examId.slice(0, 8)}_${safe}_${date}.pdf`
  }

  function certFiled(a: ExamAssignment): boolean {
    const name = certNameFor(a)
    return clindocs
      .docsFor(a.userId)
      .some((d) => (d.folder === 'protocol_exams' || d.folder === 'certs') && d.name === name)
  }

  watchEffect(() => {
    if (!canEdit.value || !clindocs.ready.value || !exams.ready.value) return
    for (const a of exams.assignments.value) {
      if (a.status !== 'submitted' || !a.passed || (a.criticalMissed?.length ?? 0) > 0) continue
      const d = exams.definitionById(a.examId)
      if (!d || !a.submittedAt || a.scorePct === null) continue
      /* Roster identity must be loaded, or the cert would read "Staff". */
      if (!clinicalPeople.value.some((p) => p.userId === a.userId)) continue
      if (certFiled(a) || inFlight.has(a.id)) continue
      inFlight.add(a.id)
      void (async () => {
        try {
          const pdf = await generateExamCertPdf({
            candidateName: nameOf(a.userId),
            examTitle: d.title,
            scorePct: a.scorePct!,
            passingPct: d.passingPct,
            submittedAt: a.submittedAt!,
          })
          const blob = pdf.output('blob') as Blob
          const res = await clindocs.upload({
            userId: a.userId,
            folder: 'protocol_exams',
            file: new File([blob], certNameFor(a), { type: 'application/pdf' }),
            employeeVisible: true,
            note: 'Protocol examination certificate (auto-filed on pass)',
          })
          if (!res.ok) {
            console.error('[exams] cert auto-file failed:', res.error)
            inFlight.delete(a.id)
          }
        } catch (e) {
          console.error('[exams] cert generation failed:', e)
          inFlight.delete(a.id)
        }
      })()
    }
  })

  return { certFiled, certNameFor }
}
