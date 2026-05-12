-- ─────────────────────────────────────────────────────────────────────
-- 0015_gallery_photos
--
-- Backs the "Around the County" photo tiles on the dashboard. Replaces
-- the static photos.json placeholder gradients with admin-uploaded
-- imagery stored in a public Storage bucket.
--
-- Bucket strategy mirrors newsletter-hero-images (migration 0011):
-- public bucket so the dashboard renders without a per-tile signed-URL
-- round-trip. Gallery photos are intentionally non-sensitive — the
-- whole point is community-facing visibility. Writes are admin-only.
--
-- The `sort_order` column lets us pin a featured photo to the top
-- without inventing a separate "featured" table. Default 0, lower
-- numbers float to the top; tie-break by uploaded_at DESC.
-- ─────────────────────────────────────────────────────────────────────

-- Table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gallery_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caption       text NOT NULL DEFAULT '',
  tag           text NOT NULL DEFAULT 'WCEMS',
  image_path    text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  uploaded_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gallery_photos_active_sort_idx
  ON public.gallery_photos (active, sort_order ASC, uploaded_at DESC);

DROP TRIGGER IF EXISTS gallery_photos_touch_updated_at ON public.gallery_photos;
CREATE TRIGGER gallery_photos_touch_updated_at
  BEFORE UPDATE ON public.gallery_photos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery_photos select for authenticated" ON public.gallery_photos;
CREATE POLICY "gallery_photos select for authenticated"
  ON public.gallery_photos FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "gallery_photos admin all" ON public.gallery_photos;
CREATE POLICY "gallery_photos admin all"
  ON public.gallery_photos FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gallery_photos TO authenticated;

-- Storage bucket ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('gallery-photos', 'gallery-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gallery-photos public read" ON storage.objects;
CREATE POLICY "gallery-photos public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'gallery-photos');

DROP POLICY IF EXISTS "gallery-photos admin write" ON storage.objects;
CREATE POLICY "gallery-photos admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'gallery-photos' AND public.is_admin());

DROP POLICY IF EXISTS "gallery-photos admin update" ON storage.objects;
CREATE POLICY "gallery-photos admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'gallery-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'gallery-photos' AND public.is_admin());

DROP POLICY IF EXISTS "gallery-photos admin delete" ON storage.objects;
CREATE POLICY "gallery-photos admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'gallery-photos' AND public.is_admin());
