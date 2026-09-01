// Generic CE-lecture evaluation question set. Short on purpose: just
// enough to satisfy TCEPF / DSHS CE-credit attestation without making
// students slog through a 30-question AHA card-class form.
//
// Uses the same `EvalQuestion` shape and `LIKERT5_LABELS` as the AHA
// card-class flow so EvalView can render either question set with one
// template.

import type { EvalQuestion, InstructorRef } from '@/training/lib/ahaEval'

const COMMON_LECTURE_QUESTIONS: EvalQuestion[] = [
  {
    id: 'Q1_OverallSatisfaction',
    type: 'likert5',
    number: '1',
    text: 'Overall, I was satisfied with this lecture.',
    required: true,
  },
  {
    id: 'Q2_KnowledgeGain',
    type: 'likert5',
    number: '2',
    text: 'The content increased my knowledge and/or clinical skills.',
    required: true,
  },
  {
    id: 'Q3_Unbiased',
    type: 'likert5',
    number: '3',
    text: 'The content was evidence-based, current, and free of commercial bias.',
    required: true,
  },
  {
    id: 'Q4_DshsRelevant',
    type: 'likert5',
    number: '4',
    text: 'The content was relevant to my practice as an EMS provider.',
    required: true,
  },
]

const PRACTICE_IMPACT_LECTURE: EvalQuestion = {
  id: 'Q5_PracticeImpact',
  type: 'yesno',
  number: '5',
  text: 'My practice will change as a result of something I learned in this lecture.',
  required: true,
}

const SUGGESTIONS: EvalQuestion = {
  id: 'Q7_Suggestions',
  type: 'textarea',
  number: '7',
  text: 'Suggestions for improving this lecture (optional)',
  required: false,
}

const VALUABLE: EvalQuestion = {
  id: 'Q8_MostValuable',
  type: 'textarea',
  number: '8',
  text: 'What did you find most valuable? (optional)',
  required: false,
}

export function buildLectureQuestions(
  instructors: InstructorRef[],
): EvalQuestion[] {
  const questions: EvalQuestion[] = []
  questions.push({ id: 'studentInfo', type: 'info', number: 'Student Information' })
  questions.push(...COMMON_LECTURE_QUESTIONS)
  questions.push(PRACTICE_IMPACT_LECTURE)

  // One Likert per instructor — same Q6_InstructorN keys as the card
  // class flow so the eval-PDF mapper sees a familiar shape.
  instructors.forEach((inst, i) => {
    questions.push({
      id: `Q6_Instructor${i + 1}_Rating`,
      type: 'likert5',
      number: `6.${i + 1}`,
      text: `${inst.name} presented the material clearly and effectively.`,
      required: true,
      instructorName: inst.name,
      instructorIndex: i + 1,
    })
  })

  questions.push(VALUABLE)
  questions.push(SUGGESTIONS)
  return questions
}

/** Flat submission payload for the lecture eval. Keys overlap with the
 *  AHA payload where it makes sense (Q1/Q2/Q3 satisfaction, Q5 impact,
 *  per-instructor names + ratings) so the downstream PDF mapper and any
 *  analytics queries can stay union-typed. */
export function buildLectureSubmissionPayload(
  sessionId: string,
  title: string,
  dshsContentArea: string,
  answers: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {
    SessionID: sessionId,
    StudentName: String(answers.StudentName || '').replace(/\s+/g, ' ').trim(),
    StudentEmail: String(answers.StudentEmail || '').trim().toLowerCase(),
    Title: title,
    CourseType: 'LECTURE',
    DshsContentArea: dshsContentArea,
    Q1_Satisfaction: answers.Q1_OverallSatisfaction || '',
    Q2_KnowledgeGain: answers.Q2_KnowledgeGain || '',
    Q3_Unbiased: answers.Q3_Unbiased || '',
    Q4_DshsRelevant: answers.Q4_DshsRelevant || '',
    Q5_PracticeImpacted: answers.Q5_PracticeImpact || '',
    Q7_Suggestions: answers.Q7_Suggestions || '',
    Q8_MostValuable: answers.Q8_MostValuable || '',
    ...answers,
  }
  for (let i = 1; i <= 4; i++) {
    payload[`Q6_Inst${i}_Name`] = answers[`Q6_Instructor${i}_Name`] || ''
    payload[`Q6_Inst${i}_Rating`] = answers[`Q6_Instructor${i}_Rating`] || ''
  }
  return payload
}
