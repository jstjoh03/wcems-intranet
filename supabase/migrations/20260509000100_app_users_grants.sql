-- ─────────────────────────────────────────────────────────────────────
-- 0002_app_users_grants — explicit table grants.
--
-- The Supabase project has "Automatically expose new tables" turned off,
-- so new tables don't auto-grant SELECT/INSERT/UPDATE/DELETE to the
-- `authenticated` role. Without that grant, every API call gets a
-- Postgres "permission denied for table app_users" error before RLS
-- has a chance to evaluate. RLS is what gates *which rows* are
-- accessible; GRANTs are what permit the role to attempt the operation
-- in the first place. Both are required.
--
-- We're intentionally NOT granting to `anon` — the app_users table
-- should never be readable by an unauthenticated client.
-- ─────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
