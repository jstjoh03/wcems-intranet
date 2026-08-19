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
  /** metric gates get a free-text value input ("3.7 / 3.5"). */
  kind: 'metric' | 'checkoff' | 'exam'
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
    ],
    petitionChain: ['Supervisor', 'CDO', 'Asst Chief'],
    includesAccess: true,
  },
  /* Pre-rebuild requirement set for P1s already mid-track when the new
     FTEP program landed — call evals are narrative, not numerically
     graded, so the gate is a count, and there are no DORs/ICRs/oral
     board. Flagged per person via pipeline_records.legacy_track. */
  P1_P2_LEGACY: {
    transition: 'P1_P2_LEGACY',
    label: 'P1 → P2 (legacy program)',
    toLabel: 'P2',
    gates: [
      metric('call_evals', 'Call evaluations', '10 required, narrative format'),
      exam('mega_code', 'Mega code'),
      exam('protocol_test', 'Protocol test'),
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

/** Which transition a record is actively working, if any. */
export function activeTransitionFor(r: PipelineRecord): PipelineTransition | null {
  if (r.pending) return 'NEOP'
  if (r.inAemtUpgrade) return 'AEMT'
  if (r.inP3Process) return 'P2_P3'
  if (!r.workingPhase) return null
  if (r.workingPhase === 'P2') return r.legacyTrack ? 'P1_P2_LEGACY' : 'P1_P2'
  if (r.workingPhase === 'P3') return 'P2_P3'
  return 'P1C_P1'
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

export function gateItemsFor(r: PipelineRecord, rows: PipelineGateProgress[]): GateItem[] {
  const transition = activeTransitionFor(r)
  if (!transition) return []
  const def = TRANSITIONS[transition]
  const byKey = new Map(rows.filter((g) => g.transition === transition).map((g) => [g.gateKey, g]))

  const items: GateItem[] = def.gates.map((g) => {
    const row = byKey.get(g.key)
    return {
      key: g.key,
      label: g.label,
      hint: g.hint,
      kind: g.kind,
      status: row ? row.status : 'untracked',
      value: row?.value ?? null,
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

/** TX jurisprudence is required once per 4-year licensure cycle. The
 *  current cycle runs from (license expiry − 4 yr) to expiry, so a
 *  completion OLDER than the cycle start no longer counts — that's the
 *  signal to reassign it in the LMS. Unknown license expiry → can't
 *  compute a cycle; treat a recorded completion as good. */
export function jurisprudenceDue(r: PipelineRecord): boolean {
  if (!r.txJurisprudenceAt) return true
  if (!r.txLicenseExpiresAt) return false
  const cycleStart = new Date(`${r.txLicenseExpiresAt}T00:00:00`)
  cycleStart.setFullYear(cycleStart.getFullYear() - 4)
  return new Date(`${r.txJurisprudenceAt}T00:00:00`).getTime() < cycleStart.getTime()
}

export interface RequirementStatus {
  state: 'ok' | 'expiring' | 'due'
  /** When action is needed (expiry / recompute date), if known. */
  dueAt: string | null
  latest: PipelineRequirementCompletion | null
}

/** Due-ness of one requirement for one person.
 *  annual         — due 365 days after the last completion
 *  per_cert_cycle — completion must fall inside the current 4-yr
 *                   licensure cycle (same rule as jurisprudence)
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

  if (req.cycle === 'certification') {
    if (!latest.expiresAt) return { state: 'ok', dueAt: null, latest }
    const days = Math.ceil((new Date(`${latest.expiresAt}T00:00:00`).getTime() - today.getTime()) / day)
    return { state: days < 0 ? 'due' : days <= 60 ? 'expiring' : 'ok', dueAt: latest.expiresAt, latest }
  }

  /* per_cert_cycle */
  if (!record?.txLicenseExpiresAt) return { state: 'ok', dueAt: null, latest }
  const cycleStart = new Date(`${record.txLicenseExpiresAt}T00:00:00`)
  cycleStart.setFullYear(cycleStart.getFullYear() - 4)
  const inCycle = new Date(`${latest.completedAt}T00:00:00`).getTime() >= cycleStart.getTime()
  return { state: inCycle ? 'ok' : 'due', dueAt: record.txLicenseExpiresAt, latest }
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
