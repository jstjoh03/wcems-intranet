-- ─────────────────────────────────────────────────────────────────────
-- 0049_required_training_overrides_grants
--
-- The 0048 migration set up RLS policies that let admins do all
-- operations on required_training_user_overrides, but only granted
-- SELECT to the `authenticated` role at the table level. RLS allows;
-- table-level GRANT denies. Result: admins clicking the "Required?"
-- toggle got 403 / 42501 (permission denied for table).
--
-- Same family of bug as the original push_subscriptions migration.
-- Grant the missing INSERT/UPDATE/DELETE so authenticated users with
-- the admin RLS predicate satisfied can actually write.
-- ─────────────────────────────────────────────────────────────────────

GRANT INSERT, UPDATE, DELETE
  ON public.required_training_user_overrides TO authenticated;
