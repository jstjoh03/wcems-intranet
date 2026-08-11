-- Applied 2026-08-11 via Supabase MCP (comment_push_triggers).
-- Targeted Web Push to the subject of spotlight/birthday comments,
-- via the send-comment-push edge function (pg_net, --no-verify-jwt).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_spotlight_comment()
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
      'kind', 'spotlight',
      'spotlight_id', NEW.spotlight_id,
      'user_id', NEW.user_id,
      'body', NEW.body
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spotlight_comments_notify ON public.spotlight_comments;
CREATE TRIGGER spotlight_comments_notify
  AFTER INSERT ON public.spotlight_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_spotlight_comment();

CREATE OR REPLACE FUNCTION public.notify_birthday_comment()
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
      'kind', 'birthday',
      'person_key', NEW.person_key,
      'user_id', NEW.user_id,
      'body', NEW.body
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS birthday_comments_notify ON public.birthday_comments;
CREATE TRIGGER birthday_comments_notify
  AFTER INSERT ON public.birthday_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_birthday_comment();
