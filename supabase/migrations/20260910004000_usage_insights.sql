-- Usage insights for the revamped /admin/usage page: daily activity
-- series, hour-of-day pattern, and per-user engagement depth. All
-- admin-gated SECURITY DEFINER, all bucketed in America/Chicago so
-- "a day" matches the crew's day, not UTC's.

CREATE OR REPLACE FUNCTION public.admin_usage_daily(days integer DEFAULT 30)
RETURNS TABLE(day date, views bigint, unique_users bigint)
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
           count(*)::bigint AS views,
           count(DISTINCT e.user_id)::bigint AS unique_users
      FROM public.usage_events e
     WHERE e.occurred_at >= now() - make_interval(days => days)
     GROUP BY 1
     ORDER BY 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_daily(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_usage_hourly(days integer DEFAULT 30)
RETURNS TABLE(hour integer, views bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT extract(hour FROM e.occurred_at AT TIME ZONE 'America/Chicago')::integer AS hour,
           count(*)::bigint AS views
      FROM public.usage_events e
     WHERE e.occurred_at >= now() - make_interval(days => days)
     GROUP BY 1
     ORDER BY 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_hourly(integer) TO authenticated;

-- Distinct Central-time days each active person opened the app in the
-- window (0 for signed-up-but-quiet people); the page buckets these
-- into power / regular / occasional / dormant.
CREATE OR REPLACE FUNCTION public.admin_usage_engagement(days integer DEFAULT 30)
RETURNS TABLE(user_id uuid, full_name text, days_active bigint, ever_signed_in boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
    SELECT u.id,
           u.full_name,
           count(DISTINCT (e.occurred_at AT TIME ZONE 'America/Chicago')::date)::bigint AS days_active,
           (u.auth_user_id IS NOT NULL) AS ever_signed_in
      FROM public.app_users u
      LEFT JOIN public.usage_events e
        ON e.user_id = u.id
       AND e.occurred_at >= now() - make_interval(days => days)
     WHERE u.active = true AND u.account_type = 'person'
     GROUP BY u.id, u.full_name, u.auth_user_id
     ORDER BY days_active DESC, u.full_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_usage_engagement(integer) TO authenticated;
