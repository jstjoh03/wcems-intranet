import type {
  GateStatus,
  PipelineGateProgress,
  PipelinePhase,
  PipelineRecord,
  PipelineRequirement,
  PipelineRequirementCompletion,
  PipelineTransition,
} from '@/types'

/**
 * FTEP gate policy as data. Gate SETS DIFFER PER TRANSITION — this is
 * department policy (P2→P3 is deliberately the short set: no DORs, no
 * ICRs, no oral board, and OpIQ/NarcSafe are already held from P2, so
 * they are never listed there).
 *
 * The DB stores only per-person progress (pipeline_gate_progress rows
 * keyed by transition + gate_key); definitions live here so thresholds
 * read as policy, not data entry.
 */

export type PetitionRole = 'FTO' | 'Supervisor' | 'CDO' | 'Asst Chief'

export interface GateDef {
  key: string
  label: string
  /** Target shown next to the label (e.g. "10 required"). */
  hint?: string
  /** metric gates get a free-text value input ("3.7 / 3.5");
   *  date gates get a date picker (value = YYYY-MM-DD). */
  kind: 'metric' | 'checkoff' | 'exam' | 'date'
}

export interface TransitionDef {
  transition: PipelineTransition
  label: string
  /** Advancement target used in the "N gaps → X" pill. */
  toLabel: string
  gates: GateDef[]
  /** Signature chain rendered as petition blocks; stored as gate rows
   *  with key `petition_<role>`. Empty = no petition step. */
  petitionChain: PetitionRole[]
  /** Whether OpIQ/NarcSafe access (record date columns) belong on this
   *  transition's checklist. Held from P2 onward — never re-listed. */
  includesAccess: boolean
}

const exam = (key: string, label: string): GateDef => ({ key, label, kind: 'exam' })
const check = (key: string, label: string, hint?: string): GateDef => ({ key, label, hint, kind: 'checkoff' })
const metric = (key: string, label: string, hint?: string): GateDef => ({ key, label, hint, kind: 'metric' })
const dateGate = (key: string, label: string, hint?: string): GateDef => ({ key, label, hint, kind: 'date' })

/* Credential sign-off package — the paperwork that closes a
   credentialing transition (Justin, 2026-09-01). Letters of
   recommendation apply to the in-charge (P2) credential only. */
const SIGNOFF_GATES = (withLetters: boolean): GateDef[] => [
  ...(withLetters
    ? [metric('rec_letters', 'Letters of recommendation', '2 required')]
    : []),
  dateGate('credential_effective', 'New credential effective'),
  check('form_filed', 'Credentialing form signed & filed'),
  check('badge_issued', 'New badge issued'),
]

export const TRANSITIONS: Record<PipelineTransition, TransitionDef> = {
  NEOP: {
    transition: 'NEOP',
    label: 'NEOP Academy',
    toLabel: 'FTR',
    gates: [
      check('clearance_to_start', 'Clearance to start'),
      check('neop_signoffs', 'NEOP week sign-offs'),
      exam('protocol_exam', 'Protocol exam'),
      check('workbook', 'Workbook'),
    ],
    petitionChain: [],
    includesAccess: false,
  },
  P1C_P1: {
    transition: 'P1C_P1',
    label: 'P1C → P1',
    toLabel: 'P1',
    gates: [
      metric('dor_avg', 'DOR average (final four)', '≥3.5, no category below 3'),
      metric('scored_icrs', 'Scored ICRs', '10 required'),
      check('workbook', 'Workbook sign-offs'),
      exam('protocol_exam', 'Protocol exam'),
      exam('oral_board', 'Oral board'),
      exam('mega_code', 'Mega code'),
      ...SIGNOFF_GATES(false),
    ],
    petitionChain: ['FTO', 'Supervisor', 'CDO', 'Asst Chief'],
    includesAccess: true,
  },
  P1_P2: {
    transition: 'P1_P2',
    label: 'P1 → P2',
    toLabel: 'P2',
    gates: [
      metric('dor_avg', 'DOR average (final four)', '≥4.0'),
      metric('incharge_icrs', 'In-charge ICRs'),
      check('p2_workbook', 'P2 workbook sign-offs'),
      exam('protocol_exam', 'Protocol exam'),
      exam('oral_board', 'Oral board'),
      exam('mega_code', 'Mega code'),
      ...SIGNOFF_GATES(true),
    ],
    petitionChain: ['Supervisor', 'CDO', 'Asst Chief'],
    includesAccess: true,
  },
  /* Pre-rebuild requirement sets for people already mid-track when the
     new FTEP program landed — call evals are narrative, not numerically
     graded, so the gate is a count, and there are no DORs/ICRs/oral
     board. Flagged per person via pipeline_records.legacy_track. The
     legacy program has TWO credentialing rungs, each needing its OWN
     10 ALS call evals + protocol test + mega code (Justin, 2026-08-25):
     P1_LEGACY (working toward the P1 credential — today's P1C
     equivalent) then P1_P2_LEGACY (credentialed P1 → P2/in-charge). */
  P1_LEGACY: {
    transition: 'P1_LEGACY',
    label: 'Credentialing as P1 (legacy program)',
    toLabel: 'P1',
    gates: [
      metric('call_evals', 'Call evaluations', '10 required, narrative format'),
      exam('mega_code', 'Mega code'),
      exam('protocol_test', 'Protocol test'),
      ...SIGNOFF_GATES(false),
    ],
    petitionChain: [],
    includesAccess: true,
  },
  P1_P2_LEGACY: {
    transition: 'P1_P2_LEGACY',
    label: 'P1 → P2 (legacy program)',
    toLabel: 'P2',
    gates: [
      metric('call_evals', 'Call evaluations', '10 required, narrative format'),
      exam('mega_code', 'Mega code'),
      exam('protocol_test', 'Protocol test'),
      ...SIGNOFF_GATES(true),
    ],
    petitionChain: [],
    includesAccess: true,
  },
  P2_P3: {
    transition: 'P2_P3',
    label: 'P2 → P3 (FTO track)',
    toLabel: 'P3',
    gates: [
      check('workbook', 'Workbook complete'),
      check('skills_checkoffs', 'Skills check-offs'),
      metric('supervisor_rideouts', 'Supervisor rideouts', '4 × 12 hr'),
      exam('protocol_test', 'Protocol test'),
    ],
    petitionChain: [],
    includesAccess: false,
  },
  AEMT: {
    transition: 'AEMT',
    label: 'AEMT upgrade',
    toLabel: 'AEMT',
    gates: [
      check('skills_checklists', 'AEMT skills checklists'),
      check('med_admin_signoff', 'Medication administration sign-off'),
      exam('protocol_exam', 'Protocol exam'),
      ...SIGNOFF_GATES(false),
    ],
    petitionChain: [],
    includesAccess: true,
  },
}

/* ── Ladder ─────────────────────────────────────────────────────────── */

export const PHASE_LADDER: PipelinePhase[] = ['NEOP', 'FTR', 'P1', 'P2', 'FinalRelease']

export const PHASE_LABELS: Record<PipelinePhase, string> = {
  NEOP: 'NEOP Academy',
  FTR: 'Field Training Rotation',
  P1: 'P1 — Attendant',
  P2: 'P2 — In-Charge',
  P3: 'P3 — FTO',
  FinalRelease: 'Final Release',
}

export function phaseLabel(phase: PipelinePhase | null): string {
  return phase ? (PHASE_LABELS[phase] ?? phase) : '—'
}

/** The enrollment menu — named program tracks instead of raw ladder
 *  phases (Justin, 2026-08-24: "Field Training Rotation" meant nothing
 *  to anyone). Each carries the record fields it sets and the standard
 *  window (days) from the FTEP Program Guide used to auto-fill the
 *  target date — always editable for extensions. EMT/AEMT new-hire
 *  FTEP programs aren't written yet; those tracks run the generic
 *  NEOP gate set until they are. */
export interface EnrollmentTrack {
  key: string
  label: string
  hint: string
  days: number
  patch: {
    workingPhase?: PipelinePhase
    legacyTrack?: boolean
    inP3Process?: boolean
    inAemtUpgrade?: boolean
  }
}

export const ENROLLMENT_TRACKS: EnrollmentTrack[] = [
  {
    key: 'neop_medic',
    label: 'New hire — Paramedic (NEOP · starts the P1C ladder)',
    hint: 'NEOP Academy ≈ 2 weeks, then P1C → P1 field training',
    days: 14,
    patch: { workingPhase: 'NEOP' },
  },
  {
    key: 'neop_emt',
    label: 'New hire — EMT orientation (NEOP)',
    hint: 'EMT FTEP program to be built — tracks the NEOP gate set for now',
    days: 14,
    patch: { workingPhase: 'NEOP' },
  },
  {
    key: 'neop_aemt',
    label: 'New hire — AEMT orientation (NEOP)',
    hint: 'AEMT FTEP program to be built — tracks the NEOP gate set for now',
    days: 14,
    patch: { workingPhase: 'NEOP' },
  },
  {
    key: 'p1c_p1',
    label: 'Paramedic FTEP — P1C → P1 field training',
    hint: '90-day cap · phases 1–4',
    days: 90,
    patch: { workingPhase: 'P1' },
  },
  {
    key: 'p1_p2',
    label: 'Paramedic FTEP — P1 → P2',
    hint: 'six-month cap · phases 5–7',
    days: 180,
    patch: { workingPhase: 'P2', legacyTrack: false },
  },
  {
    key: 'p1_legacy',
    label: 'Legacy program — credentialing as P1',
    hint: '10 call evaluations (Jotform) + protocol test + mega code',
    days: 180,
    patch: { workingPhase: 'P1', legacyTrack: true },
  },
  {
    key: 'p1_p2_legacy',
    label: 'Legacy program — P1 → P2',
    hint: '10 call evaluations (Jotform) + protocol test + mega code',
    days: 180,
    patch: { workingPhase: 'P2', legacyTrack: true },
  },
  {
    key: 'p2_p3',
    label: 'P3 ride-up — supervisor rideouts',
    hint: '4 × 12 hr rideouts + skills check-offs + protocol test',
    days: 60,
    patch: { workingPhase: 'P3', inP3Process: true },
  },
  {
    key: 'aemt_upgrade',
    label: 'AEMT upgrade (EMT → AEMT)',
    hint: 'skills checklists · medication sign-off · protocol exam',
    days: 90,
    patch: { inAemtUpgrade: true },
  },
]

/** Which transition a record is actively working, if any. */
export function activeTransitionFor(r: PipelineRecord): PipelineTransition | null {
  if (r.pending) return 'NEOP'
  if (r.inAemtUpgrade) return 'AEMT'
  if (r.inP3Process) return 'P2_P3'
  if (!r.workingPhase) return null
  /* FinalRelease is a CLEARED status, never something you work toward —
     guard it so a stray record can't fall into the P1C_P1 catch-all
     (Perry got shown "enrolled in P1C -> P1" after a P2 promotion). */
  if (r.workingPhase === 'FinalRelease') return null
  if (r.workingPhase === 'NEOP') return 'NEOP'
  if (r.workingPhase === 'P2') return r.legacyTrack ? 'P1_P2_LEGACY' : 'P1_P2'
  if (r.workingPhase === 'P3') return 'P2_P3'
  return r.legacyTrack ? 'P1_LEGACY' : 'P1C_P1'
}

/* ── Gate item resolution (defs ⋈ stored rows ⋈ record dates) ──────── */

export interface GateItem {
  key: string
  label: string
  hint?: string
  kind: GateDef['kind'] | 'access' | 'petition'
  /** 'untracked' = defined by policy but no stored row yet (dashed). */
  status: GateStatus | 'untracked'
  value: string | null
  completedAt: string | null
  completedByName: string | null
}

/** OpIQ and NarcSafe are paramedic-only systems — EMT-B and ADV EMT
 *  never receive access, so their pipelines must not show or require
 *  it (Justin, 2026-08-19). */
export function hasSystemAccess(certLevel: string | null): boolean {
  if (!certLevel) return true // unknown level: don't silently drop a gate
  return /emt-p|^lp$/i.test(certLevel.trim())
}

/** Live progress counts computed from ftep_reports — callers pass them
 *  so count-based metric gates self-complete instead of waiting on a
 *  manual check-off (Perry hit 15/10 call evals while the gate still
 *  read "10 required"). */
export interface GateStats {
  callEvals?: number
  scoredIcrs?: number
}

export function gateItemsFor(
  r: PipelineRecord,
  rows: PipelineGateProgress[],
  stats?: GateStats,
): GateItem[] {
  const transition = activeTransitionFor(r)
  if (!transition) return []
  return gateItemsForTransition(r, rows, transition, stats)
}

/** Canonical career order for rendering credentialing history. */
const TRANSITION_ORDER: PipelineTransition[] = [
  'NEOP', 'P1C_P1', 'P1_LEGACY', 'P1_P2', 'P1_P2_LEGACY', 'AEMT', 'P2_P3',
]

/** Transitions with recorded gate rows that are NOT the active one —
 *  the completed (or paused) credentialing steps, so promotion never
 *  erases the visual history of mega codes, protocol tests, and
 *  sign-off paperwork (Justin, 2026-09-01). */
export function completedTransitionsFor(
  r: PipelineRecord,
  rows: PipelineGateProgress[],
): PipelineTransition[] {
  const active = activeTransitionFor(r)
  const seen = new Set(rows.map((g) => g.transition))
  return TRANSITION_ORDER.filter((t) => seen.has(t) && t !== active)
}

export function gateItemsForTransition(
  r: PipelineRecord,
  rows: PipelineGateProgress[],
  transition: PipelineTransition,
  stats?: GateStats,
): GateItem[] {
  const def = TRANSITIONS[transition]
  const byKey = new Map(rows.filter((g) => g.transition === transition).map((g) => [g.gateKey, g]))

  const items: GateItem[] = def.gates.map((g) => {
    const row = byKey.get(g.key)
    let status: GateItem['status'] = row ? row.status : 'untracked'
    /* The rideout count self-completes at the 4-rideout target —
       typing "4" into Edit record checks the gate off without a
       second tap (Justin, 2026-08-24). */
    if (g.key === 'supervisor_rideouts' && status === 'pending') {
      const n = row?.value?.match(/\d+/)
      if (n && parseInt(n[0], 10) >= 4) status = 'complete'
    }
    /* A date gate with a date filled in is complete. */
    if (g.kind === 'date' && status === 'pending' && row?.value) status = 'complete'
    /* Letters of recommendation: typing "2" (or more) checks it off. */
    if (g.key === 'rec_letters' && status === 'pending') {
      const n = row?.value?.match(/\d+/)
      if (n && parseInt(n[0], 10) >= 2) status = 'complete'
    }
    /* Call-eval / ICR gates self-complete from the live report counts. */
    if (g.key === 'call_evals' && status === 'pending' && (stats?.callEvals ?? 0) >= 10)
      status = 'complete'
    if (g.key === 'scored_icrs' && status === 'pending' && (stats?.scoredIcrs ?? 0) >= 10)
      status = 'complete'
    return {
      key: g.key,
      label: g.label,
      hint: g.hint,
      kind: g.kind,
      status,
      value:
        row?.value ??
        (g.key === 'call_evals' && stats?.callEvals != null
          ? `${stats.callEvals}/10`
          : g.key === 'scored_icrs' && stats?.scoredIcrs != null
            ? `${stats.scoredIcrs}/10`
            : null),
      completedAt: row?.completedAt ?? null,
      completedByName: row?.completedByName ?? null,
    }
  })

  if (def.includesAccess && hasSystemAccess(r.certLevel)) {
    /* Access is the held/not-held boolean; a grant date is optional
       detail shown when known. */
    items.push(
      {
        key: 'op_iq',
        label: 'Operative IQ access',
        kind: 'access',
        status: r.opIqAccess || r.opIqGrantedAt ? 'complete' : 'pending',
        value: r.opIqGrantedAt ?? (r.opIqAccess ? 'held' : null),
        completedAt: r.opIqGrantedAt,
        completedByName: null,
      },
      {
        key: 'narc_safe',
        label: 'NarcSafe',
        kind: 'access',
        status: r.narcSafeAccess || r.narcSafeGrantedAt ? 'complete' : 'pending',
        value: r.narcSafeGrantedAt ?? (r.narcSafeAccess ? 'held' : null),
        completedAt: r.narcSafeGrantedAt,
        completedByName: null,
      },
    )
  }
  return items
}

export function petitionItemsFor(r: PipelineRecord, rows: PipelineGateProgress[]): GateItem[] {
  const transition = activeTransitionFor(r)
  if (!transition) return []
  const def = TRANSITIONS[transition]
  const byKey = new Map(rows.filter((g) => g.transition === transition).map((g) => [g.gateKey, g]))
  return def.petitionChain.map((role) => {
    const key = `petition_${role.toLowerCase().replace(/\s+/g, '_')}`
    const row = byKey.get(key)
    return {
      key,
      label: role,
      kind: 'petition',
      status: row ? row.status : 'untracked',
      value: row?.value ?? null,
      completedAt: row?.completedAt ?? null,
      completedByName: row?.completedByName ?? null,
    }
  })
}

const isDone = (s: GateItem['status']) => s === 'complete' || s === 'na'

export function openGapCount(r: PipelineRecord, rows: PipelineGateProgress[]): number {
  return gateItemsFor(r, rows).filter((i) => !isDone(i.status)).length
}

/** Ladder position 0..1, mirroring the static board's ladderPos(). */
export function ladderPos(r: PipelineRecord): number {
  const n = PHASE_LADDER.length
  if (r.workingPhase) {
    const i = PHASE_LADDER.indexOf(r.workingPhase === 'P3' ? 'P2' : r.workingPhase)
    return i < 0 ? 0 : (i + 0.5) / n
  }
  if (r.clearedPhase) {
    const i = PHASE_LADDER.indexOf(r.clearedPhase === 'P3' ? 'P2' : r.clearedPhase)
    return i < 0 ? 0 : (i + 1) / n
  }
  return 0
}

/** Progress %: gate completion once anything is tracked for the active
 *  transition, ladder position otherwise. */
export function progressPct(r: PipelineRecord, rows: PipelineGateProgress[]): number {
  const items = gateItemsFor(r, rows)
  const tracked = items.some((i) => i.status !== 'untracked')
  if (tracked && items.length) {
    return Math.round((items.filter((i) => isDone(i.status)).length / items.length) * 100)
  }
  return Math.round(ladderPos(r) * 100)
}

/* ── Pills + warning chips ─────────────────────────────────────────── */

export interface PipelinePill {
  text: string
  variant: 'open' | 'ready' | 'hold' | 'credentialed' | 'none'
}

export function pillFor(r: PipelineRecord, rows: PipelineGateProgress[]): PipelinePill {
  if (r.pending) return { text: 'Awaiting clearance', variant: 'hold' }
  const transition = activeTransitionFor(r)
  if (!transition) {
    return r.clearedPhase === 'FinalRelease'
      ? { text: 'Credentialed', variant: 'credentialed' }
      : { text: '—', variant: 'none' }
  }
  const def = TRANSITIONS[transition]
  const gaps = openGapCount(r, rows)
  if (gaps === 0) {
    const petitions = petitionItemsFor(r, rows)
    const boardPending = petitions.length > 0 && petitions.some((p) => !isDone(p.status))
    return boardPending
      ? { text: '✓ Board pending', variant: 'ready' }
      : { text: `✓ Ready → ${def.toLabel}`, variant: 'ready' }
  }
  return { text: `${gaps} gap${gaps === 1 ? '' : 's'} → ${def.toLabel}`, variant: 'open' }
}

export interface WarningChip {
  text: string
  severity: 'warn' | 'bad'
}

function daysUntil(iso: string | null, today: Date): number | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000)
}

export function warningChips(r: PipelineRecord, today = new Date()): WarningChip[] {
  const chips: WarningChip[] = []
  const lic = daysUntil(r.txLicenseExpiresAt, today)
  if (lic !== null && lic < 0) chips.push({ text: 'Lic expired', severity: 'bad' })
  else if (lic !== null && lic <= 90) chips.push({ text: `Lic ${lic}d`, severity: 'warn' })
  if (r.pipActive) chips.push({ text: 'PIP', severity: 'bad' })
  const tgt = daysUntil(r.workingTargetAt, today)
  if (r.workingPhase && tgt !== null && tgt < 0) chips.push({ text: `+${-tgt}d over`, severity: 'bad' })
  return chips
}

/* ── Compliance due logic ──────────────────────────────────────────── */

/** Once-per-licensure-cycle items (TX jurisprudence, HEART, …). The
 *  current cycle runs from (license expiry − 4 yr) to expiry. An
 *  out-of-cycle completion is NOT an alarm for the whole 4 years —
 *  it renders as a "required before <license expiry>" tag for both
 *  the CDO and the employee, and flips to DUE only inside the final
 *  6 months of the license (Justin, 2026-08-24). Unknown license
 *  expiry → no cycle to compute; a recorded completion counts, a
 *  missing one surfaces as due. */
export interface CycleStatus {
  state: 'ok' | 'required' | 'due'
  /** The cycle deadline (= TX license expiry), when known. */
  requiredBefore: string | null
}

const DUE_WINDOW_DAYS = 183 // ~6 months before license expiry

export function cycleItemStatus(
  completedAt: string | null,
  record: PipelineRecord | null,
  today = new Date(),
): CycleStatus {
  const exp = record?.txLicenseExpiresAt ?? null
  if (!exp) return { state: completedAt ? 'ok' : 'due', requiredBefore: null }
  const expDate = new Date(`${exp}T00:00:00`)
  const cycleStart = new Date(expDate)
  cycleStart.setFullYear(cycleStart.getFullYear() - 4)
  const done = completedAt ? new Date(`${completedAt}T00:00:00`).getTime() : null
  if (done !== null && done >= cycleStart.getTime()) return { state: 'ok', requiredBefore: exp }
  const days = Math.ceil((expDate.getTime() - today.getTime()) / 86_400_000)
  /* A completion inside the due-window run-up to the renewal that
   *  started this cycle was done FOR that renewal — it satisfies the
   *  cycle. (People complete jurisprudence just before renewing; the
   *  new expiry then pushes the computed cycle start past the date.)
   *  It stops counting once the NEXT renewal's due window opens. */
  const renewalRunUp = cycleStart.getTime() - DUE_WINDOW_DAYS * 86_400_000
  if (done !== null && done >= renewalRunUp && days > DUE_WINDOW_DAYS)
    return { state: 'ok', requiredBefore: exp }
  return { state: days <= DUE_WINDOW_DAYS ? 'due' : 'required', requiredBefore: exp }
}

export function jurisprudenceStatus(r: PipelineRecord, today = new Date()): CycleStatus {
  return cycleItemStatus(r.txJurisprudenceAt, r, today)
}

/** Inside the 6-month window (or no way to compute one) — the LMS
 *  reassignment signal. */
export function jurisprudenceDue(r: PipelineRecord): boolean {
  return jurisprudenceStatus(r).state === 'due'
}

export interface RequirementStatus {
  /** 'required' = per-cycle item not yet done this cycle, but the
   *  6-month due window hasn't opened — render as a deadline tag. */
  state: 'ok' | 'expiring' | 'due' | 'required'
  /** When action is needed (expiry / recompute date), if known. */
  dueAt: string | null
  latest: PipelineRequirementCompletion | null
}

/** Due-ness of one requirement for one person.
 *  annual         — due 365 days after the last completion
 *  per_cert_cycle — completion must fall inside the current 4-yr
 *                   licensure cycle (same rule as jurisprudence);
 *                   out-of-cycle shows 'required' until 6 months
 *                   before license expiry, then 'due'
 *  certification  — the completion's own expires_at governs; expiring
 *                   = within 60 days
 *  one_time       — any completion ever satisfies it */
export function requirementStatus(
  req: PipelineRequirement,
  completions: PipelineRequirementCompletion[],
  record: PipelineRecord | null,
  today = new Date(),
): RequirementStatus {
  const mine = completions
    .filter((c) => c.requirementId === req.id)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  const latest = mine[0] ?? null

  if (req.cycle === 'per_cert_cycle') {
    const cs = cycleItemStatus(latest?.completedAt ?? null, record, today)
    return { state: cs.state, dueAt: cs.requiredBefore, latest }
  }

  if (!latest) return { state: 'due', dueAt: null, latest: null }

  const day = 86_400_000
  if (req.cycle === 'one_time') return { state: 'ok', dueAt: null, latest }

  if (req.cycle === 'annual') {
    const due = new Date(`${latest.completedAt}T00:00:00`)
    due.setFullYear(due.getFullYear() + 1)
    const dueAt = due.toISOString().slice(0, 10)
    const days = Math.ceil((due.getTime() - today.getTime()) / day)
    return { state: days < 0 ? 'due' : days <= 60 ? 'expiring' : 'ok', dueAt, latest }
  }

  /* certification */
  if (!latest.expiresAt) return { state: 'ok', dueAt: null, latest }
  const days = Math.ceil((new Date(`${latest.expiresAt}T00:00:00`).getTime() - today.getTime()) / day)
  return { state: days < 0 ? 'due' : days <= 60 ? 'expiring' : 'ok', dueAt: latest.expiresAt, latest }
}

/** Badge class key from the credential level ("EMT - FTO?" → neutral). */
export function badgeKeyFor(level: string | null): 'P1C' | 'P1' | 'P2' | 'FTO' | 'other' {
  const l = level ?? ''
  if (l.includes('?')) return 'other'
  if (l.startsWith('P1C')) return 'P1C'
  if (l.startsWith('P1')) return 'P1'
  if (l.startsWith('P2')) return 'P2'
  if (l.includes('FTO')) return 'FTO'
  return 'other'
}
