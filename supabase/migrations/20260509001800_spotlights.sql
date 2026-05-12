-- ─────────────────────────────────────────────────────────────────────
-- 0019_spotlights
--
-- "Person in the spotlight" — admin-curated recognition slot on the
-- dashboard People row. Pattern mirrors `newsletters` (migration 0010):
-- one active row at a time, historical rows preserved with active=false
-- so a future "past spotlights" view doesn't need archival logic.
--
-- The optional photo is stored in a public bucket (no signed-URL
-- round-trip on render). Spotlight photos are intentionally
-- community-facing.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spotlights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_name   text NOT NULL,
  role          text NOT NULL DEFAULT '',
  tenure        text NOT NULL DEFAULT '',
  blurb         text NOT NULL DEFAULT '',
  photo_path    text,
  active        boolean NOT NULL DEFAULT true,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS spotlights_active_published_at_idx
  ON public.spotlights (active, published_at DESC);

DROP TRIGGER IF EXISTS spotlights_touch_updated_at ON public.spotlights;
CREATE TRIGGER spotlights_touch_updated_at
  BEFORE UPDATE ON public.spotlights
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.spotlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spotlights select for authenticated" ON public.spotlights;
CREATE POLICY "spotlights select for authenticated"
  ON public.spotlights FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "spotlights admin all" ON public.spotlights;
CREATE POLICY "spotlights admin all"
  ON public.spotlights FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spotlights TO authenticated;

-- Storage bucket ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('spotlight-photos', 'spotlight-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "spotlight-photos public read" ON storage.objects;
CREATE POLICY "spotlight-photos public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'spotlight-photos');

DROP POLICY IF EXISTS "spotlight-photos admin write" ON storage.objects;
CREATE POLICY "spotlight-photos admin write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'spotlight-photos' AND public.is_admin());

DROP POLICY IF EXISTS "spotlight-photos admin update" ON storage.objects;
CREATE POLICY "spotlight-photos admin update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'spotlight-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'spotlight-photos' AND public.is_admin());

DROP POLICY IF EXISTS "spotlight-photos admin delete" ON storage.objects;
CREATE POLICY "spotlight-photos admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'spotlight-photos' AND public.is_admin());
