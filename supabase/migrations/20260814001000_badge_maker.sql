-- ─────────────────────────────────────────────────────────────────────
-- 20260814001000_badge_maker
--
-- ID Badge Maker (absorbed from Justin's standalone WCEMS-Badge-Maker
-- HTML tool): CR80 card designer that prints direct to the Badgy.
-- The roster used to live in a JSON file on the share drive; it now
-- lives here so any admin can reprint a badge from any machine.
--
--   • badge_agency — singleton row of card-wide settings (accent,
--     back style, medical director, return address).
--   • badge_people — one row per badge; `data` is the full person
--     object the tool works with (name/title/badge#/level/licenses +
--     base64 headshot + crop). jsonb because the shape belongs to the
--     tool, not the schema.
--
-- ADMIN-ONLY both ways: cards carry license numbers and headshots.
-- Seed data (Justin + Erica Torr, photos downsized to 800×1000) was
-- inserted directly after this migration ran — not in the migration
-- file to keep base64 blobs out of the repo.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.badge_agency (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  accent     text NOT NULL DEFAULT 'rule',
  back_style text NOT NULL DEFAULT 'light',
  med_dir    text NOT NULL DEFAULT '',
  addr       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS badge_agency_touch_updated_at ON public.badge_agency;
CREATE TRIGGER badge_agency_touch_updated_at
  BEFORE UPDATE ON public.badge_agency
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.badge_people (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS badge_people_touch_updated_at ON public.badge_people;
CREATE TRIGGER badge_people_touch_updated_at
  BEFORE UPDATE ON public.badge_people
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.badge_agency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badge_agency admin all" ON public.badge_agency;
CREATE POLICY "badge_agency admin all"
  ON public.badge_agency FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "badge_people admin all" ON public.badge_people;
CREATE POLICY "badge_people admin all"
  ON public.badge_people FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.badge_agency TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.badge_people TO authenticated;
GRANT ALL ON public.badge_agency TO service_role;
GRANT ALL ON public.badge_people TO service_role;
