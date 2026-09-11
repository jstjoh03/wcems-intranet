-- Per-person usage drill-down for /admin/usage: which pages one
-- employee actually uses, and their daily activity. Admin-gated,
-- Central-time buckets like the rest of the usage RPCs.

CREATE OR REPLACE FUNCTION public.admin_usage_user_routes(p_user uuid, days integer DEFAULT 30, max_rows integer DEFAULT 20)
RETURNS TABLE(route text, views bigint, last_at timestamptz)
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
           max(e.occurred_at) AS last_at
      FROM public.usage_events e
     WHERE e.user_id = p_user
       AND e.occurred_at >= now() - make_interval(days => days)
     GROUP BY e.route
     ORDER BY views DESC, last_at DESC
     LIMIT max_rows;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_user_routes(uuid, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_usage_user_daily(p_user uuid, days integer DEFAULT 30)
RETURNS TABLE(day date, views bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT (e.occurred_at AT TIME ZONE 'America/Chicago')::date AS day,
           count(*)::bigint AS views
      FROM public.usage_events e
     WHERE e.user_id = p_user
       AND e.occurred_at >= now() - make_interval(days => days)
     GROUP BY 1
     ORDER BY 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_user_daily(uuid, integer) TO authenticated;
