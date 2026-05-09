-- ─────────────────────────────────────────────────────────────────────
-- 0010_newsletters
--
-- Replaces the localStorage + base64 data URL hack from `useNewsletter`.
-- The 3 MB cap goes away — PDFs live in Supabase Storage and are
-- delivered to clients via short-lived signed URLs.
--
-- Schema captures the historical record of every newsletter published.
-- The dashboard shows the most recent row where `active = true`. When an
-- admin "publishes" a new one, the previous row is flipped to inactive,
-- so cardinality of active rows is at most 1 — but past issues are
-- preserved for a future "back issues" view.
--
-- The hero_image_path column is intentionally added now though no UI
-- consumes it yet — Phase 3 will plumb the upload path. Adding the
-- column today saves a future no-op migration.
-- ─────────────────────────────────────────────────────────────────────

-- Newsletters table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.newsletters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  blurb             text NOT NULL DEFAULT '',
  pdf_path          text,
  pdf_filename      text,
  hero_image_path   text,
  published_at      timestamptz NOT NULL DEFAULT now(),
  published_by      uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletters_active_published_at_idx
  ON public.newsletters (active, published_at DESC);

DROP TRIGGER IF EXISTS newsletters_touch_updated_at ON public.newsletters;
CREATE TRIGGER newsletters_touch_updated_at
  BEFORE UPDATE ON public.newsletters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.newsletters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletters select for authenticated" ON public.newsletters;
CREATE POLICY "newsletters select for authenticated"
  ON public.newsletters FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "newsletters admin all" ON public.newsletters;
CREATE POLICY "newsletters admin all"
  ON public.newsletters FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.newsletters TO authenticated;

-- Storage bucket ────────────────────────────────────────────────────
-- Private bucket — clients receive PDFs via short-lived signed URLs
-- generated on demand at click time. Newsletters can contain crew-only
-- info (HR notes, accolades, internal recognitions); we don't want them
-- exposed to anyone with the URL forever.
INSERT INTO storage.buckets (id, name, public)
VALUES ('newsletter-pdfs', 'newsletter-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (live on storage.objects, scoped to this bucket) ──
DROP POLICY IF EXISTS "newsletter-pdfs auth read" ON storage.objects;
CREATE POLICY "newsletter-pdfs auth read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'newsletter-pdfs');

DROP POLICY IF EXISTS "newsletter-pdfs admin write" ON storage.objects;
CREATE POLICY "newsletter-pdfs admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'newsletter-pdfs' AND public.is_admin());

DROP POLICY IF EXISTS "newsletter-pdfs admin update" ON storage.objects;
CREATE POLICY "newsletter-pdfs admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'newsletter-pdfs' AND public.is_admin())
  WITH CHECK (bucket_id = 'newsletter-pdfs' AND public.is_admin());

DROP POLICY IF EXISTS "newsletter-pdfs admin delete" ON storage.objects;
CREATE POLICY "newsletter-pdfs admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'newsletter-pdfs' AND public.is_admin());
