-- ─────────────────────────────────────────────────────────────────────
-- Notify the CDO office when an advancement recommendation files
-- (Justin, 2026-11-17: "Heather and I need to be notified when an
-- advancement record is submitted").
--
-- AFTER INSERT on ftep_recommendations → pg_net → rec-filed-notify
-- edge function (verify_jwt OFF — pg_net sends no JWT), which pushes
-- and emails every pipeline editor. Recipients resolve server-side
-- from pipeline_editors, so the circle maintains itself.
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_rec_filed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/rec-filed-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object('id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ftep_recommendations_notify ON public.ftep_recommendations;
CREATE TRIGGER ftep_recommendations_notify
  AFTER INSERT ON public.ftep_recommendations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_rec_filed();
