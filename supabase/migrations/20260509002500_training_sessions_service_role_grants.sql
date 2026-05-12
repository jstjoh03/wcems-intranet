-- ─────────────────────────────────────────────────────────────────────
-- 0026_training_sessions_service_role_grants
--
-- Grant write privileges on `training_sessions` to `service_role` so
-- the `sync-wix-training` Edge Function can upsert + delete rows.
-- Migration 0025 only granted SELECT to `authenticated` and relied on
-- Supabase's project-level defaults to cover service_role — which
-- didn't fire for this table.
-- ─────────────────────────────────────────────────────────────────────

GRANT ALL ON public.training_sessions TO service_role;
