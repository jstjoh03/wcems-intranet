-- ─────────────────────────────────────────────────────────────────────
-- 0043_push_subscriptions_self_update
--
-- The client subscribes via PostgREST upsert (INSERT ON CONFLICT DO
-- UPDATE on the unique `endpoint`). The original migration granted
-- INSERT/SELECT/DELETE but not UPDATE, so upsert failed with
-- "permission denied for table push_subscriptions" — surfaced to
-- users as the "Turn on" banner error.
--
-- Add UPDATE grant + a matching self-only RLS policy so a user can
-- only re-bind / refresh their own subscription rows. Other users'
-- rows still fail the RLS check on UPDATE.
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS "push_subscriptions self update"
  ON public.push_subscriptions;
CREATE POLICY "push_subscriptions self update"
  ON public.push_subscriptions FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );
