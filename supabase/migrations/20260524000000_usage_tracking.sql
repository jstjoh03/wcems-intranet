-- ─────────────────────────────────────────────────────────────────────
-- 0044_usage_tracking
--
-- Real engagement metrics for the admin "Usage" page. Cloudflare can
-- only see initial page loads (the SPA does in-app routing client-
-- side), so we log route changes to `usage_events` from a router
-- watcher. Same hook bumps `app_users.last_seen_at` so we get a true
-- weekly-active count independent of sign-in timestamps.
--
-- The write path is a SECURITY DEFINER function (log_route_view) —
-- the client doesn't get direct INSERT on usage_events, and the
-- function looks up the caller's app_user via auth.uid() so the
-- client can't spoof user_id.
--
-- Read path: usage_events is admin-only via RLS. last_seen_at lives
-- on app_users which is already readable by all signed-in users
-- (existing policy).
-- ─────────────────────────────────────────────────────────────────────

-- 1) last_seen_at on app_users ──────────────────────────────────────
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS app_users_last_seen_at_idx
  ON public.app_users (last_seen_at DESC NULLS LAST);

-- 2) usage_events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  route       text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_occurred_at_idx
  ON public.usage_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_user_id_idx
  ON public.usage_events (user_id);
CREATE INDEX IF NOT EXISTS usage_events_route_idx
  ON public.usage_events (route);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- Admins read all events. Crew can't browse other people's activity.
DROP POLICY IF EXISTS "usage_events admin select" ON public.usage_events;
CREATE POLICY "usage_events admin select"
  ON public.usage_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- No direct INSERT policy — writes go through log_route_view() only.
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;

-- 3) Write path RPC ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_route_view(route_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  /* Resolve the caller's app_user. If they're not signed in or not
     linked to an app_user row, silently no-op — usage tracking isn't
     worth surfacing as an error. */
  SELECT id INTO v_user_id
    FROM public.app_users
    WHERE auth_user_id = auth.uid();

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.app_users
     SET last_seen_at = now()
   WHERE id = v_user_id;

  /* Cap the route to 200 chars so a malicious / bugged client can't
     bloat the table. Coalesce nulls to '/' for robustness. */
  INSERT INTO public.usage_events (user_id, route)
  VALUES (v_user_id, left(COALESCE(NULLIF(trim(route_path), ''), '/'), 200));
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_route_view(text) TO authenticated;

-- 4) Read helpers (admin-gated SECURITY DEFINER) ────────────────────
-- These bundle the aggregations the /admin/usage page needs into a
-- single RPC call each, keeping the client simple and the queries
-- index-friendly.

CREATE OR REPLACE FUNCTION public.admin_usage_top_routes(days integer DEFAULT 7, max_rows integer DEFAULT 25)
RETURNS TABLE(route text, views bigint, unique_users bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT e.route,
           count(*)::bigint AS views,
           count(DISTINCT e.user_id)::bigint AS unique_users
      FROM public.usage_events e
     WHERE e.occurred_at >= now() - make_interval(days => days)
     GROUP BY e.route
     ORDER BY views DESC
     LIMIT max_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_top_routes(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_usage_top_users(days integer DEFAULT 30, max_rows integer DEFAULT 15)
RETURNS TABLE(user_id uuid, full_name text, role app_role, views bigint, last_seen_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT u.id, u.full_name, u.role,
           count(e.id)::bigint AS views,
           u.last_seen_at
      FROM public.app_users u
      LEFT JOIN public.usage_events e
        ON e.user_id = u.id
       AND e.occurred_at >= now() - make_interval(days => days)
     WHERE u.active = true
     GROUP BY u.id, u.full_name, u.role, u.last_seen_at
     ORDER BY views DESC NULLS LAST, u.last_seen_at DESC NULLS LAST
     LIMIT max_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_top_users(integer, integer) TO authenticated;
