-- Comment notifications for announcements (Justin, 2026-08-29):
-- admins pick WHO gets a push when someone comments (first case: Ben
-- Egert on the remission post). Recipient list lives on the
-- announcement; the AFTER INSERT trigger mirrors the spotlight /
-- birthday comment pushes through the same send-comment-push edge fn.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS comment_notify_user_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.notify_announcement_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/send-comment-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'kind', 'announcement',
      'announcement_id', NEW.announcement_id,
      'user_id', NEW.user_id,
      'body', NEW.body
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcement_comments_notify ON public.announcement_comments;
CREATE TRIGGER announcement_comments_notify
  AFTER INSERT ON public.announcement_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_announcement_comment();
