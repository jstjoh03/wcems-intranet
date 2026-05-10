-- ─────────────────────────────────────────────────────────────────────
-- 0011_newsletter_hero_images
--
-- Storage bucket for the newsletter card's featured-photo treatment.
-- The `newsletters.hero_image_path` column was added in migration 0010
-- as forward-compat; this migration creates the bucket + policies that
-- back it.
--
-- Public bucket — cover images aren't sensitive and we'd rather not
-- pay a signed-URL round-trip every time the dashboard renders. PDFs
-- stay private (newsletter-pdfs bucket from 0010) because their
-- contents can be more sensitive (HR notes, internal recognitions).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('newsletter-hero-images', 'newsletter-hero-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "newsletter-hero-images public read" ON storage.objects;
CREATE POLICY "newsletter-hero-images public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'newsletter-hero-images');

DROP POLICY IF EXISTS "newsletter-hero-images admin write" ON storage.objects;
CREATE POLICY "newsletter-hero-images admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'newsletter-hero-images' AND public.is_admin());

DROP POLICY IF EXISTS "newsletter-hero-images admin update" ON storage.objects;
CREATE POLICY "newsletter-hero-images admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'newsletter-hero-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'newsletter-hero-images' AND public.is_admin());

DROP POLICY IF EXISTS "newsletter-hero-images admin delete" ON storage.objects;
CREATE POLICY "newsletter-hero-images admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'newsletter-hero-images' AND public.is_admin());
