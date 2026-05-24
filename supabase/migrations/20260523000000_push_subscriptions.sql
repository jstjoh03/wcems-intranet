-- ─────────────────────────────────────────────────────────────────────
-- 0041_push_subscriptions
--
-- Web Push subscription registry. One row per (user, browser/device)
-- — endpoint is unique because the browser issues a different one per
-- subscription. p256dh + auth are the encryption keys the server needs
-- to deliver an encrypted payload to that specific endpoint.
--
-- RLS: each user manages their own subscriptions only. The service
-- role (used by the send-announcement-push Edge Function) reads all.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions self select"
  ON public.push_subscriptions;
CREATE POLICY "push_subscriptions self select"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "push_subscriptions self insert"
  ON public.push_subscriptions;
CREATE POLICY "push_subscriptions self insert"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "push_subscriptions self delete"
  ON public.push_subscriptions;
CREATE POLICY "push_subscriptions self delete"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

GRANT SELECT, INSERT, DELETE
  ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
