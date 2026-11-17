-- ─────────────────────────────────────────────────────────────────────
-- EC_EMT in the gate-progress transition check (Justin, 2026-11-17)
--
-- The EC (EMT Candidate) track shipped with its own gate set in code,
-- but pipeline_gate_progress_transition_check was last rebuilt for
-- P1_LEGACY (migration 20260825002000) and never learned 'EC_EMT' —
-- so the FIRST manual check-off on any EC trainee failed with
-- "violates check constraint" (hit on Aslan Sukolics' card).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipeline_gate_progress
  DROP CONSTRAINT IF EXISTS pipeline_gate_progress_transition_check;

ALTER TABLE public.pipeline_gate_progress
  ADD CONSTRAINT pipeline_gate_progress_transition_check
  CHECK (transition IN ('NEOP','EC_EMT','P1C_P1','P1_P2','P1_LEGACY','P1_P2_LEGACY','P2_P3','AEMT'));
