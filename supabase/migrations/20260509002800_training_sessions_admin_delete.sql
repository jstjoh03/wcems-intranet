-- ─────────────────────────────────────────────────────────────────────
-- 0029_training_sessions_admin_delete
--
-- Admins can already UPDATE training_sessions (instructor edits via
-- /admin/training, added in migration 0028). They also need DELETE so
-- the "Exclude service" flow can clean up existing sessions of that
-- service immediately — otherwise the rows linger until the next
-- 15-min sync cron and the page shows a stale group.
--
-- Migration 0028's GRANT only covered UPDATE; this adds DELETE.
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "training_sessions admin delete" ON public.training_sessions;
CREATE POLICY "training_sessions admin delete"
  ON public.training_sessions FOR DELETE
  TO authenticated
  USING (public.is_admin());

GRANT DELETE ON public.training_sessions TO authenticated;
