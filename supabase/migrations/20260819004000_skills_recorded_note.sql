-- Optional context on proxy sign-offs (why the evaluator couldn't
-- sign, when the training happened, etc.). Printed on the packet PDF
-- beneath the recorded-on-behalf attestation.
ALTER TABLE public.skills_evaluations
  ADD COLUMN IF NOT EXISTS recorded_note text;
