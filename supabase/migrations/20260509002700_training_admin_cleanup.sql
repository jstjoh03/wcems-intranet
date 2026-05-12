-- ─────────────────────────────────────────────────────────────────────
-- 0028_training_admin_cleanup
--
-- Two changes:
--
--   1. New `training_excluded_services` table — admin-managed list of
--      Wix service IDs to skip during sync. CPR-Public and any other
--      public-facing courses go here so they don't clutter the
--      internal training card.
--
--   2. Allow admins to UPDATE `training_sessions.instructor`. Wix's
--      "default instructor" field isn't trustworthy (it pulls a stock
--      name when the actual instructor isn't set on the session), so
--      the sync function stops writing instructor entirely from this
--      migration forward. Admins enter it manually via the new
--      /admin/training page.
--
-- Existing instructor data is wiped so the table starts clean — no
-- stale "default instructor" values mixed in with admin entries.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Excluded services table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_excluded_services (
  service_id   text PRIMARY KEY,
  name         text NOT NULL DEFAULT '',
  excluded_at  timestamptz NOT NULL DEFAULT now(),
  excluded_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

ALTER TABLE public.training_excluded_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_excluded_services select for authenticated"
  ON public.training_excluded_services;
CREATE POLICY "training_excluded_services select for authenticated"
  ON public.training_excluded_services FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "training_excluded_services admin all"
  ON public.training_excluded_services;
CREATE POLICY "training_excluded_services admin all"
  ON public.training_excluded_services FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.training_excluded_services TO authenticated;
GRANT ALL ON public.training_excluded_services TO service_role;

-- Realtime so admin edits propagate across open tabs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'training_excluded_services'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.training_excluded_services';
  END IF;
END$$;

-- 2) Allow admins to UPDATE training_sessions.instructor ─────────────
-- Migration 0025 only granted SELECT to authenticated; admins need
-- UPDATE to edit the instructor field via the new admin page.
DROP POLICY IF EXISTS "training_sessions admin update" ON public.training_sessions;
CREATE POLICY "training_sessions admin update"
  ON public.training_sessions FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT UPDATE ON public.training_sessions TO authenticated;

-- 3) Wipe stale instructor data ──────────────────────────────────────
UPDATE public.training_sessions
SET instructor = ''
WHERE instructor <> '';
