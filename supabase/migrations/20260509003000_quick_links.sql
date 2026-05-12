-- ─────────────────────────────────────────────────────────────────────
-- 0031_quick_links
--
-- Admin-curated catalog of Quick Links. Replaces the static JSON
-- (`src/data/quicklinks.json`) so admins can add / edit / remove
-- entries from the UI without a code deploy.
--
-- Per-user pinning continues to live in `user_link_preferences`
-- (migration 0009) — that part of the model isn't changing.
--
-- Schema mirrors the legacy JSON shape (label/sub/url/icon/category/
-- visibleTo/defaultSort), translated to snake_case columns. The
-- `visible_to` column is a text[] of role strings ('crew',
-- 'supervisor', 'admin'); empty array means visible to everyone.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quick_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  sub           text NOT NULL DEFAULT '',
  url           text NOT NULL,
  icon_name     text NOT NULL DEFAULT 'Link2',
  category      text NOT NULL DEFAULT '',
  visible_to    text[] NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS quick_links_category_sort_idx
  ON public.quick_links (category, sort_order);

DROP TRIGGER IF EXISTS quick_links_touch_updated_at ON public.quick_links;
CREATE TRIGGER quick_links_touch_updated_at
  BEFORE UPDATE ON public.quick_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.quick_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quick_links select for authenticated" ON public.quick_links;
CREATE POLICY "quick_links select for authenticated"
  ON public.quick_links FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "quick_links admin all" ON public.quick_links;
CREATE POLICY "quick_links admin all"
  ON public.quick_links FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_links TO authenticated;
GRANT ALL ON public.quick_links TO service_role;

-- Realtime so admin edits propagate to every crew dashboard live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'quick_links'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.quick_links';
  END IF;
END$$;
