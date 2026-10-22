import type { PipelineTransition } from '@/types'

/**
 * Credentialing checklist — the in-office paperwork run while the
 * employee is in the building, surfaced the moment a protocol test is
 * assigned (Justin, 2026-10-21: "I need a checklist that surfaces when
 * we assign a protocol test so we get all the required paperwork
 * signed while the employee is in the office").
 *
 * auto items verify themselves from the record (gates, access flags,
 * eval requests); manual items the CDO checks off — stored as
 * pipeline_gate_progress rows under `chk_*` keys on the active
 * transition, which keeps them out of the gate requirement math while
 * giving them the same who/when audit trail.
 */

export interface ChecklistItemDef {
  key: string
  label: string
  kind: 'manual' | 'auto'
  /** What the auto state reads. */
  auto?: 'workbook' | 'p2_workbook' | 'protocol_exam' | 'mega_code' | 'op_iq' | 'rec_letters' | 'fto_eval'
  hint?: string
  /** Row affordance: opens the megacode runner. */
  action?: 'megacode'
}

export const CREDENTIALING_CHECKLISTS: Partial<Record<PipelineTransition, ChecklistItemDef[]>> = {
  P1C_P1: [
    {
      key: 'chk_lexipol',
      label: 'Lexipol transcript verified — 100% on the FTEP-required assignments',
      kind: 'manual',
    },
    { key: 'workbook', label: 'Phase workbook complete', kind: 'auto', auto: 'workbook' },
    {
      key: 'protocol_exam',
      label: 'Protocol test — assigned in the portal, release when seated',
      kind: 'auto',
      auto: 'protocol_exam',
    },
    {
      key: 'mega_code',
      label: 'Megacode — examiner runs it digitally, both sign',
      kind: 'auto',
      auto: 'mega_code',
      action: 'megacode',
    },
    {
      key: 'chk_cs_policy',
      label: 'Controlled substance policy — printed, read, acknowledgement signed',
      kind: 'manual',
    },
    { key: 'op_iq', label: 'Operative IQ access granted', kind: 'auto', auto: 'op_iq' },
    {
      key: 'fto_eval',
      label: 'Trainee Evaluation of FTO — sent automatically with the passed protocol test',
      kind: 'auto',
      auto: 'fto_eval',
    },
    {
      key: 'chk_file_copies',
      label: 'File copies in the employee file: signed docs · megacode eval · protocol test cert · Lexipol transcript',
      kind: 'manual',
    },
  ],
  P1_P2: [
    {
      key: 'chk_lexipol',
      label: 'Lexipol transcript verified — 100% on the FTEP-required assignments',
      kind: 'manual',
    },
    { key: 'p2_workbook', label: 'P2 workbook sign-offs complete', kind: 'auto', auto: 'p2_workbook' },
    {
      key: 'protocol_exam',
      label: 'Protocol test — assigned in the portal, release when seated',
      kind: 'auto',
      auto: 'protocol_exam',
    },
    {
      key: 'mega_code',
      label: 'Megacode — examiner runs it digitally, both sign',
      kind: 'auto',
      auto: 'mega_code',
      action: 'megacode',
    },
    {
      key: 'chk_cs_policy',
      label: 'Controlled substance policy — printed, read, acknowledgement signed',
      kind: 'manual',
    },
    {
      key: 'rec_letters',
      label: 'Letters of recommendation — 2 from FTOs or supervisors',
      kind: 'auto',
      auto: 'rec_letters',
      hint: 'in-charge credential requirement',
    },
    {
      key: 'fto_eval',
      label: 'Trainee Evaluation of FTO — sent automatically with the passed protocol test',
      kind: 'auto',
      auto: 'fto_eval',
    },
    {
      key: 'chk_file_copies',
      label: 'File copies in the employee file: signed docs · megacode eval · protocol test cert · letters · Lexipol transcript',
      kind: 'manual',
    },
  ],
}
