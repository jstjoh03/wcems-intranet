-- ─────────────────────────────────────────────────────────────────────
-- cert_import
--
-- Prep for the Paycom certification import + required-certs audit.
--
-- required_levels: which pipeline_records.cert_level values a
-- requirement is REQUIRED for (empty array = tracked-only, shown but
-- never flagged missing). Justin's rule: EMTs need BLS, HandTevy,
-- EVOC, TX DSHS; Paramedics all of those plus ACLS and PALS. TX DSHS
-- itself stays on pipeline_records (roster-synced) — not a
-- requirement row.
--
-- UNIQUE (requirement_id, user_id, completed_at) makes weekly Paycom
-- re-imports idempotent: same card, same date → no duplicate; a
-- renewed card (new date) inserts a fresh row and history stays.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipeline_requirements
  ADD COLUMN IF NOT EXISTS required_levels text[] NOT NULL DEFAULT '{}';

UPDATE public.pipeline_requirements
  SET required_levels = ARRAY['EMT-B','ADV EMT','EMT-P','LP']
  WHERE name = 'BLS Provider';
UPDATE public.pipeline_requirements
  SET required_levels = ARRAY['EMT-P','LP']
  WHERE name IN ('ACLS Provider','PALS Provider');

INSERT INTO public.pipeline_requirements (name, cycle, active, sort, notes, required_levels)
SELECT 'HandTevy Pediatric', 'certification', true, 15,
       'Pediatric emergency certification (Paycom: HandTevy Pediatric Emergency).',
       ARRAY['EMT-B','ADV EMT','EMT-P','LP']
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_requirements WHERE name = 'HandTevy Pediatric');

INSERT INTO public.pipeline_requirements (name, cycle, active, sort, notes, required_levels)
SELECT 'EVOC', 'certification', true, 35,
       'Emergency Vehicle Operations Course (2-year renewal).',
       ARRAY['EMT-B','ADV EMT','EMT-P','LP']
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_requirements WHERE name = 'EVOC');

INSERT INTO public.pipeline_requirements (name, cycle, active, sort, notes, required_levels)
SELECT 'National Registry', 'certification', true, 60,
       'Tracked for anyone who keeps it current — not required by the agency.',
       '{}'::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_requirements WHERE name = 'National Registry');

-- Idempotent import upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_req_completions_unique'
  ) THEN
    ALTER TABLE public.pipeline_requirement_completions
      ADD CONSTRAINT pipeline_req_completions_unique
      UNIQUE (requirement_id, user_id, completed_at);
  END IF;
END $$;
