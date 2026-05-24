-- ─────────────────────────────────────────────────────────────────────
-- 0042_announcements_push_trigger
--
-- Fire a Web Push fan-out whenever an announcement is INSERTed with
-- active=true. Mirrors the sync-wix-training cron pattern: pg_net
-- posts to the Edge Function URL with no auth (function deployed
-- with --no-verify-jwt and uses service-role internally).
--
-- UPDATEs and DELETEs don't trigger pushes — only fresh inserts.
-- Editing the headline or archiving shouldn't re-buzz everyone.
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_new_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active IS TRUE THEN
    PERFORM net.http_post(
      url     := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/send-announcement-push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
        'id', NEW.id,
        'tag', NEW.tag,
        'title', NEW.title,
        'body', NEW.body,
        'image_url', NEW.image_url,
        'author_name', NEW.author_name,
        'published_at', NEW.published_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcements_notify_new
  ON public.announcements;

CREATE TRIGGER announcements_notify_new
  AFTER INSERT ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_announcement();
