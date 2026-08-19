-- Proxy sign-off: when the instructor who ran a station leaves before
-- signing candidates off in the app (e.g. Dr. Buzzard teaching the
-- Z Vent), an evaluator records the results on their behalf.
-- evaluator_id stays the actual instructor; recorded_by is who entered
-- it; evaluator_signature stays NULL and the PDF renders an
-- attestation line instead of a signature image.
ALTER TABLE public.skills_evaluations
  ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL;
