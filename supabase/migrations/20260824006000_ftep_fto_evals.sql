-- Trainee Evaluation of FTO (paper form v1.0, portal-native): completed
-- by the trainee at each phase transition, submitted to the Clinical
-- Development Officer — NOT the FTO. RLS is the point here:
--   • trainees INSERT their own and can re-read what they submitted
--   • ONLY clinical editors read the rest — supervisors and FTOs have
--     no access of any kind (the evaluated FTO must never see it)
--   • nobody updates; editors may delete (mis-submissions)
CREATE TABLE IF NOT EXISTS public.ftep_fto_evals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id   uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  fto_name     text NOT NULL,
  phase        text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature    text,
  reviewed_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ftep_fto_evals_trainee_idx
  ON public.ftep_fto_evals (trainee_id);

ALTER TABLE public.ftep_fto_evals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_fto_evals editor or own select" ON public.ftep_fto_evals;
CREATE POLICY "ftep_fto_evals editor or own select"
  ON public.ftep_fto_evals FOR SELECT
  TO authenticated
  USING (
    public.is_pipeline_editor()
    OR trainee_id = public.current_app_user_id()
  );

DROP POLICY IF EXISTS "ftep_fto_evals trainee insert" ON public.ftep_fto_evals;
CREATE POLICY "ftep_fto_evals trainee insert"
  ON public.ftep_fto_evals FOR INSERT
  TO authenticated
  WITH CHECK (trainee_id = public.current_app_user_id());

DROP POLICY IF EXISTS "ftep_fto_evals editor update" ON public.ftep_fto_evals;
CREATE POLICY "ftep_fto_evals editor update"
  ON public.ftep_fto_evals FOR UPDATE
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

DROP POLICY IF EXISTS "ftep_fto_evals editor delete" ON public.ftep_fto_evals;
CREATE POLICY "ftep_fto_evals editor delete"
  ON public.ftep_fto_evals FOR DELETE
  TO authenticated
  USING (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_fto_evals TO authenticated;
GRANT ALL ON public.ftep_fto_evals TO service_role;
