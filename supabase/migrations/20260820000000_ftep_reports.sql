-- ─────────────────────────────────────────────────────────────────────
-- ftep_reports
--
-- Native FTEP paperwork: Daily Observation Reports and Individual
-- Call Reports, replacing the Jotform forms. One row per report;
-- drafts save server-side (status 'draft', payload updated in place)
-- so a DOR started mid-shift can be finished at the station from any
-- device. Submitting stamps both signatures and freezes the row for
-- the author (clinical editors can still correct).
--
-- payload is the whole form (ratings, shift/call data, narratives,
-- NRT flags) — the category definitions live in code
-- (src/constants/ftepForms.ts) and labels are stamped into the
-- payload at submit so records survive future form revisions, same
-- rule as skills evaluations.
--
-- Visibility: evaluators (supervisors/FTOs/editors + grants — the
-- same is_skills_evaluator() population) see all reports; a trainee
-- sees their own SUBMITTED reports (every DOR is reviewed with them
-- before signing anyway) but never drafts.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ftep_reports (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('dor','icr')),
  trainee_id           uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  evaluator_id         uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  eval_date            date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  trainee_signature    text,
  evaluator_signature  text,
  submitted_at         timestamptz,
  /* CDO acknowledgement — the in-portal notification loop. */
  reviewed_by          uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ftep_reports_trainee_idx ON public.ftep_reports (trainee_id);
CREATE INDEX IF NOT EXISTS ftep_reports_evaluator_idx ON public.ftep_reports (evaluator_id);
CREATE INDEX IF NOT EXISTS ftep_reports_status_idx ON public.ftep_reports (status);

DROP TRIGGER IF EXISTS ftep_reports_touch_updated_at ON public.ftep_reports;
CREATE TRIGGER ftep_reports_touch_updated_at
  BEFORE UPDATE ON public.ftep_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ftep_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep select" ON public.ftep_reports;
CREATE POLICY "ftep select"
  ON public.ftep_reports FOR SELECT
  TO authenticated
  USING (
    public.is_skills_evaluator()
    OR (trainee_id = public.current_app_user_id() AND status = 'submitted')
  );

DROP POLICY IF EXISTS "ftep author insert" ON public.ftep_reports;
CREATE POLICY "ftep author insert"
  ON public.ftep_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_skills_evaluator()
    AND evaluator_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
  );

-- Author edits their own drafts (including the draft→submitted flip);
-- editors can correct anything (e.g. reviewed_* stamps, fixes).
DROP POLICY IF EXISTS "ftep author or editor update" ON public.ftep_reports;
CREATE POLICY "ftep author or editor update"
  ON public.ftep_reports FOR UPDATE
  TO authenticated
  USING (
    (evaluator_id = public.current_app_user_id() AND status = 'draft')
    OR public.is_pipeline_editor()
  )
  WITH CHECK (
    evaluator_id = public.current_app_user_id()
    OR public.is_pipeline_editor()
  );

DROP POLICY IF EXISTS "ftep author draft delete" ON public.ftep_reports;
CREATE POLICY "ftep author draft delete"
  ON public.ftep_reports FOR DELETE
  TO authenticated
  USING (
    (evaluator_id = public.current_app_user_id() AND status = 'draft')
    OR public.is_pipeline_editor()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_reports TO authenticated;
GRANT ALL ON public.ftep_reports TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ftep_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ftep_reports;
  END IF;
END $$;
