// 2025 AHA Evaluation question set — ported verbatim from the legacy
// eval.html so the student-facing wizard and the resulting answer keys
// stay byte-compatible with the eval-PDF mapper.

import type { CourseTemplate } from '@/training/types'

export interface EvalQuestion {
  id: string
  type:
    | 'info'
    | 'header'
    | 'likert5'
    | 'yesno'
    | 'rating6'
    | 'textarea'
  number: string
  text?: string
  required?: boolean
  isObjective?: boolean
  instructorName?: string
  instructorIndex?: number
}

export const COMMON_QUESTIONS: EvalQuestion[] = [
  {
    id: 'Q1_CourseObjectives',
    type: 'likert5',
    number: '1',
    text: 'Overall, I was satisfied with this offering.',
    required: true,
  },
  {
    id: 'Q2_KnowledgeGained',
    type: 'likert5',
    number: '2',
    text: 'The offering was scientifically rigorous, and the clinical content was evidence based.',
    required: true,
  },
  {
    id: 'Q3_FreeOfBias',
    type: 'likert5',
    number: '3',
    text: 'The content appropriately represented the data on the subject and was not biased toward specific products or services.',
    required: true,
  },
]

export const OBJECTIVES: Record<CourseTemplate, string[]> = {
  BLS: [
    'Describe the importance of high-quality CPR and its impact on survival',
    'Apply the BLS concepts of the Chain of Survival',
    'Recognize the signs of someone needing CPR',
    'Perform high-quality CPR for an adult, a child, and an infant',
    'Perform chest compressions using correct hand placement at the correct rate and depth with chest recoil',
    'Demonstrate effective breaths or ventilation',
    'Describe the importance of early use of an automated external defibrillator (AED)',
    'Demonstrate how to use an AED',
    'Perform as an effective team member during multirescuer CPR',
    'Describe how to relieve a foreign-body airway obstruction for an adult, a child, and an infant',
  ],
  ACLS: [
    'Apply the BLS, Primary, and Secondary Assessments sequence for a systematic evaluation of adult patients',
    'Recognize and perform early management of bradycardias and tachycardias that may result in cardiac arrest or complicate resuscitation outcome',
    'Model effective communication as a member or leader of a high-performance team',
    'Recognize the impact of team dynamics on overall team performance',
    'Recognize and perform early management of respiratory arrest',
    'Recognize cardiac arrest and perform prompt, high-quality BLS and optimized management of cardiac arrest until termination of resuscitation or transfer of care, including post–cardiac arrest care',
    "Evaluate resuscitative efforts during a cardiac arrest through continuous assessment of CPR quality, monitoring the patient's response, and delivering real-time feedback to the team",
  ],
  PALS: [
    'Perform high-quality CPR per American Heart Association basic life support recommendations',
    'Perform your role as a high-performance team member',
    "Differentiate between patients who require immediate intervention and those who don't",
    'Differentiate between respiratory distress and failure',
    'Perform early interventions for respiratory distress and failure',
    'Differentiate between compensated and hypotensive shock',
    'Perform early interventions for the treatment of shock',
    'Differentiate between unstable and stable patients with dysrhythmias',
    'Demonstrate treatment of dysrhythmias',
    'Implement postarrest management',
  ],
}

export const PRACTICE_IMPACT: EvalQuestion = {
  id: 'Q5_PracticeImpact',
  type: 'yesno',
  number: '5',
  text: 'My research or practice will be impacted or changed as a result of something I learned in this offering.',
  required: true,
}

export const ACTION_PLAN: Record<CourseTemplate, EvalQuestion> = {
  BLS: {
    id: 'Q7_ActionPlan',
    type: 'textarea',
    number: '7',
    text: 'What action related to basic life support will you now take that you would not have done before participating in this activity?',
    required: true,
  },
  ACLS: {
    id: 'Q7_ActionPlan',
    type: 'textarea',
    number: '7',
    text: 'What action related to advanced cardiovascular life support will you now take that you would not have done before participating in this activity?',
    required: true,
  },
  PALS: {
    id: 'Q7_ActionPlan',
    type: 'textarea',
    number: '7',
    text: 'What action related to pediatric advanced life support will you now take that you would not have done before participating in this activity?',
    required: true,
  },
}

export const OVERALL_RATINGS: EvalQuestion[] = [
  {
    id: 'Q8_OverallQuality',
    type: 'rating6',
    number: '8a',
    text: 'Quality and usefulness of course information',
    required: true,
  },
  {
    id: 'Q8_CourseEffectiveness',
    type: 'rating6',
    number: '8b',
    text: 'Effectiveness of content delivery',
    required: true,
  },
  {
    id: 'Q8_MaterialAppropriateness',
    type: 'rating6',
    number: '8c',
    text: 'Appropriateness of course assessment activities',
    required: true,
  },
]

export const LIKERT5_LABELS: Record<string, string> = {
  '5': 'Strongly Agree',
  '4': 'Agree',
  '3': 'Neutral',
  '2': 'Disagree',
  '1': 'Strongly Disagree',
}

export const RATING6_OPTIONS = [
  'Excellent',
  'Above Average',
  'Average',
  'Below Average',
  'Poor',
  'N/A',
]

export function courseTypeFromName(name: string): CourseTemplate {
  const up = (name || '').toUpperCase()
  if (up.includes('ACLS')) return 'ACLS'
  if (up.includes('PALS')) return 'PALS'
  return 'BLS'
}

export function normalizeName(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export interface InstructorRef {
  name: string
}

export function buildInstructorList(s: {
  primaryInstructorName?: string
  secondaryInstructorName?: string
  tertiaryInstructorName?: string
  quaternaryInstructorName?: string
}): InstructorRef[] {
  const seen = new Set<string>()
  return [
    s.primaryInstructorName,
    s.secondaryInstructorName,
    s.tertiaryInstructorName,
    s.quaternaryInstructorName,
  ]
    .map(normalizeName)
    .filter(Boolean)
    .filter((name) => {
      const key = name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((name) => ({ name }))
}

/** Build the question list for a given course type + instructor set.
 *  Identical ordering to the legacy buildQuestions(). */
export function buildQuestions(
  courseType: CourseTemplate,
  instructors: InstructorRef[],
): EvalQuestion[] {
  const questions: EvalQuestion[] = []

  questions.push({ id: 'studentInfo', type: 'info', number: 'Student Information' })
  questions.push(...COMMON_QUESTIONS)
  questions.push({
    id: 'q4Header',
    type: 'header',
    number: '4',
    text: 'Learning objectives: After participating in this activity, I will be better able to',
  })

  const objectives = OBJECTIVES[courseType] || OBJECTIVES.BLS
  objectives.forEach((obj, i) => {
    questions.push({
      id: `Q4_Objective${i + 1}`,
      type: 'likert5',
      number: `4.${i + 1}`,
      text: obj,
      required: true,
      isObjective: true,
    })
  })

  questions.push(PRACTICE_IMPACT)

  instructors.forEach((inst, i) => {
    questions.push({
      id: `Q6_Instructor${i + 1}_Rating`,
      type: 'rating6',
      number: `6.${i + 1}`,
      text: `Please rate this instructor: ${inst.name}`,
      required: true,
      instructorName: inst.name,
      instructorIndex: i + 1,
    })
  })

  questions.push(ACTION_PLAN[courseType] || ACTION_PLAN.BLS)
  questions.push(...OVERALL_RATINGS)

  return questions
}

/** Build the flat submission payload — same shape as the legacy
 *  buildSubmissionPayload() so the eval-PDF mapper keeps working. */
export function buildSubmissionPayload(
  sessionId: string,
  title: string,
  courseType: CourseTemplate,
  answers: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {
    SessionID: sessionId,
    StudentName: normalizeName(answers.StudentName),
    StudentEmail: String(answers.StudentEmail || '').trim().toLowerCase(),
    Title: title,
    CourseType: courseType,
    Q1_Satisfaction: answers.Q1_CourseObjectives || '',
    Q2_ScientificRigor: answers.Q2_KnowledgeGained || '',
    Q3_Unbiased: answers.Q3_FreeOfBias || '',
    Q5_PracticeImpacted: answers.Q5_PracticeImpact || '',
    Q7_ActionText: answers.Q7_ActionPlan || '',
    Q8_QualityRating: answers.Q8_OverallQuality || '',
    Q8_EffectivenessRating: answers.Q8_CourseEffectiveness || '',
    Q8_AppropriatenessRating: answers.Q8_MaterialAppropriateness || '',
    ...answers,
  }

  for (let i = 1; i <= 10; i++) {
    payload[`Q4_Obj${i}`] = answers[`Q4_Objective${i}`] || ''
  }
  for (let i = 1; i <= 4; i++) {
    payload[`Q6_Inst${i}_Name`] = answers[`Q6_Instructor${i}_Name`] || ''
    payload[`Q6_Inst${i}_Rating`] = answers[`Q6_Instructor${i}_Rating`] || ''
  }

  return payload
}
