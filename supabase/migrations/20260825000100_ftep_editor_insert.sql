-- The Jotform review queue's Accept action files a report ON BEHALF of
-- the original evaluator (evaluator_id = whoever ran the call, not the
-- editor clicking Accept). The insert policy required
-- evaluator_id = self, so editors couldn't do that — widen it.
DROP POLICY IF EXISTS "ftep author insert" ON public.ftep_reports;
CREATE POLICY "ftep author insert"
  ON public.ftep_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_skills_evaluator() AND evaluator_id = public.current_app_user_id() AND NOT public.is_kiosk_user())
    OR public.is_pipeline_editor()
  );
