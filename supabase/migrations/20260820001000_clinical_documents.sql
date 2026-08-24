-- ─────────────────────────────────────────────────────────────────────
-- clinical_documents
--
-- The employee file's document cabinet: scanned signed forms, cert
-- card copies, counseling records, and generated PDFs, organized in
-- folders per employee. Private storage bucket (clinical-docs) —
-- never public; access resolves through the table's row.
--
-- Visibility rules (Justin, 2026-08-20 redesign decisions):
--   default = clinical editors only; per-document "employee_visible"
--   toggle can share a doc with its employee; the counseling folder
--   is ALWAYS staff-only regardless of the flag.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clinical_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  folder            text NOT NULL DEFAULT 'signed_forms'
                    CHECK (folder IN ('signed_forms','certs','counseling','generated','other')),
  name              text NOT NULL,
  storage_path      text NOT NULL UNIQUE,
  content_type      text,
  size_bytes        bigint,
  employee_visible  boolean NOT NULL DEFAULT false,
  note              text,
  uploaded_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_documents_user_idx ON public.clinical_documents (user_id);

DROP TRIGGER IF EXISTS clinical_documents_touch_updated_at ON public.clinical_documents;
CREATE TRIGGER clinical_documents_touch_updated_at
  BEFORE UPDATE ON public.clinical_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.clinical_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clindocs select" ON public.clinical_documents;
CREATE POLICY "clindocs select"
  ON public.clinical_documents FOR SELECT
  TO authenticated
  USING (
    public.is_pipeline_editor()
    OR (
      user_id = public.current_app_user_id()
      AND employee_visible
      AND folder <> 'counseling'
    )
  );

DROP POLICY IF EXISTS "clindocs editor all" ON public.clinical_documents;
CREATE POLICY "clindocs editor all"
  ON public.clinical_documents FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_documents TO authenticated;
GRANT ALL ON public.clinical_documents TO service_role;

-- Private bucket; object access resolves through the table row so the
-- per-document visibility toggle governs downloads too.
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinical-docs', 'clinical-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "clinical-docs read" ON storage.objects;
CREATE POLICY "clinical-docs read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'clinical-docs'
    AND EXISTS (
      SELECT 1 FROM public.clinical_documents d
      WHERE d.storage_path = storage.objects.name
        AND (
          public.is_pipeline_editor()
          OR (
            d.user_id = public.current_app_user_id()
            AND d.employee_visible
            AND d.folder <> 'counseling'
          )
        )
    )
  );

DROP POLICY IF EXISTS "clinical-docs editor write" ON storage.objects;
CREATE POLICY "clinical-docs editor write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'clinical-docs' AND public.is_pipeline_editor());

DROP POLICY IF EXISTS "clinical-docs editor delete" ON storage.objects;
CREATE POLICY "clinical-docs editor delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'clinical-docs' AND public.is_pipeline_editor());
