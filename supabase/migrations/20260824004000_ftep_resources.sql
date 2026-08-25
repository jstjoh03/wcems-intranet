-- ─────────────────────────────────────────────────────────────────────
-- FTEP Resources library (Justin, 2026-08-24): handbooks, program
-- guides, workbooks, blank forms — editor-uploaded, audience-scoped:
--   • trainees   — visible to every signed-in employee (workbooks,
--                  program guide — nothing sensitive)
--   • evaluators — supervisors + FTOs + clinical editors (FTO handbook,
--                  expectations agreement)
--   • editors    — clinical department only (protocol exams when ready,
--                  PIP templates)
-- Objects live in a private bucket; access resolves through the table
-- row, mirroring the clinical-docs pattern.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ftep_resources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  category     text NOT NULL DEFAULT 'other'
               CHECK (category IN ('guide','handbook','workbook','form','exam','other')),
  audience     text NOT NULL DEFAULT 'evaluators'
               CHECK (audience IN ('trainees','evaluators','editors')),
  storage_path text NOT NULL,
  content_type text,
  size_bytes   bigint,
  note         text,
  sort         integer NOT NULL DEFAULT 100,
  uploaded_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ftep_resources_touch_updated_at ON public.ftep_resources;
CREATE TRIGGER ftep_resources_touch_updated_at
  BEFORE UPDATE ON public.ftep_resources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ftep_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_resources audience select" ON public.ftep_resources;
CREATE POLICY "ftep_resources audience select"
  ON public.ftep_resources FOR SELECT
  TO authenticated
  USING (
    public.is_pipeline_editor()
    OR (audience = 'evaluators' AND (public.is_supervisor() OR public.is_fto_viewer()))
    OR audience = 'trainees'
  );

DROP POLICY IF EXISTS "ftep_resources editor all" ON public.ftep_resources;
CREATE POLICY "ftep_resources editor all"
  ON public.ftep_resources FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_resources TO authenticated;
GRANT ALL ON public.ftep_resources TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('ftep-resources', 'ftep-resources', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ftep-resources read" ON storage.objects;
CREATE POLICY "ftep-resources read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ftep-resources'
    AND EXISTS (
      SELECT 1 FROM public.ftep_resources r
      WHERE r.storage_path = storage.objects.name
        AND (
          public.is_pipeline_editor()
          OR (r.audience = 'evaluators' AND (public.is_supervisor() OR public.is_fto_viewer()))
          OR r.audience = 'trainees'
        )
    )
  );

DROP POLICY IF EXISTS "ftep-resources editor write" ON storage.objects;
CREATE POLICY "ftep-resources editor write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ftep-resources' AND public.is_pipeline_editor());

DROP POLICY IF EXISTS "ftep-resources editor delete" ON storage.objects;
CREATE POLICY "ftep-resources editor delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'ftep-resources' AND public.is_pipeline_editor());
