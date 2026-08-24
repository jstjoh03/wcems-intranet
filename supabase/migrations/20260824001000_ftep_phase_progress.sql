-- Per-phase FTEP tracking (Justin, 2026-08-24): which Program Guide
-- phase a trainee is working, who their FTO is FOR THAT PHASE (each
-- phase can have a different FTO; Final Evaluation MUST), and when it
-- started/finished. Phase DEFINITIONS (numbers, names, tour counts)
-- live in src/constants/ftepForms.ts — this table stores only
-- per-person state, mirroring pipeline_gate_progress.
CREATE TABLE IF NOT EXISTS public.ftep_phase_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  phase_key    text NOT NULL,
  fto_user_id  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  fto_name     text,
  started_at   date,
  completed_at date,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, phase_key)
);

CREATE INDEX IF NOT EXISTS ftep_phase_progress_record_idx
  ON public.ftep_phase_progress (record_id);

DROP TRIGGER IF EXISTS ftep_phase_progress_touch_updated_at
  ON public.ftep_phase_progress;
CREATE TRIGGER ftep_phase_progress_touch_updated_at
  BEFORE UPDATE ON public.ftep_phase_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ftep_phase_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_phase_progress board or self select"
  ON public.ftep_phase_progress;
CREATE POLICY "ftep_phase_progress board or self select"
  ON public.ftep_phase_progress FOR SELECT
  TO authenticated
  USING (
    public.is_supervisor()
    OR public.is_pipeline_editor()
    OR public.is_fto_viewer()
    OR EXISTS (
      SELECT 1 FROM public.pipeline_records r
      WHERE r.id = record_id
        AND r.user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "ftep_phase_progress editor all"
  ON public.ftep_phase_progress;
CREATE POLICY "ftep_phase_progress editor all"
  ON public.ftep_phase_progress FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_phase_progress TO authenticated;
GRANT ALL ON public.ftep_phase_progress TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ftep_phase_progress'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ftep_phase_progress;
  END IF;
END $$;
