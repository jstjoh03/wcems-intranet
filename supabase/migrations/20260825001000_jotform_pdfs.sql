-- Signed Jotform submission PDFs (Justin, 2026-08-25): with a Jotform
-- API key the webhook pulls each submission's actual PDF — evaluator
-- and employee signatures included — into a private bucket. Reviewers
-- see it in the queue; accepting copies it into the employee's
-- Documents as the signed original.
ALTER TABLE public.jotform_inbox
  ADD COLUMN IF NOT EXISTS pdf_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('jotform-pdfs', 'jotform-pdfs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "jotform-pdfs editor read" ON storage.objects;
CREATE POLICY "jotform-pdfs editor read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'jotform-pdfs' AND public.is_pipeline_editor());
