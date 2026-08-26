-- The legacy program has TWO credentialing phases (Justin, 2026-08-25):
-- working toward the P1 credential (current equivalent: P1C), then
-- credentialed P1 working toward P2/in-charge. Each phase requires 10
-- ALS call evaluations + protocol test + mega code. P1_LEGACY is the
-- pre-P1 rung; P1_P2_LEGACY stays the P1→P2 rung.
ALTER TABLE public.pipeline_gate_progress
  DROP CONSTRAINT IF EXISTS pipeline_gate_progress_transition_check;
ALTER TABLE public.pipeline_gate_progress
  ADD CONSTRAINT pipeline_gate_progress_transition_check
  CHECK (transition IN ('NEOP','P1C_P1','P1_P2','P1_LEGACY','P1_P2_LEGACY','P2_P3','AEMT'));
