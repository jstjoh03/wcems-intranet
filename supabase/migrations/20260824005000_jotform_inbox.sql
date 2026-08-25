-- Jotform webhook holding pen: call-eval submissions the webhook could
-- not auto-file (unmatched name/email, employee not on the legacy
-- track, …) land here instead of vanishing, with the reason. Clinical
-- editors review and clear them from the Submissions inbox.
CREATE TABLE IF NOT EXISTS public.jotform_inbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id text UNIQUE,
  form_title    text,
  employee_name text,
  evaluator_name text,
  reason        text NOT NULL,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jotform_inbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jotform_inbox editor all" ON public.jotform_inbox;
CREATE POLICY "jotform_inbox editor all"
  ON public.jotform_inbox FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jotform_inbox TO authenticated;
GRANT ALL ON public.jotform_inbox TO service_role;
