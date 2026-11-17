-- ─────────────────────────────────────────────────────────────────────
-- Question of the Week (Justin, 2026-11-17)
--
-- Engagement: admins stock a queue of questions (open-text or 2–4
-- option polls); one auto-publishes every Monday 7am Central via
-- pg_cron and a pg_net trigger fans a push out to everyone (same
-- shape as announcements). Crews answer in a comment thread and/or
-- vote; both realtime.
--
-- RLS follows the canonical engagement pattern (birthday/photo
-- tables, as tightened by the kiosk migration): current_app_user_id()
-- ownership + NOT is_kiosk_user() on writes. announcement_comments'
-- auth.uid() deviation is deliberately NOT copied.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.qotw_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt        text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 300),
  kind          text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','poll')),
  /* Poll options: jsonb array of 2–4 strings; NULL for text questions. */
  options       jsonb CHECK (
    (kind = 'text' AND options IS NULL)
    OR (kind = 'poll' AND jsonb_typeof(options) = 'array'
        AND jsonb_array_length(options) BETWEEN 2 AND 4)
  ),
  position      int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','published','archived')),
  published_at  timestamptz,
  week_of       date,
  created_by    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qotw_questions_status_idx ON public.qotw_questions (status, position);

CREATE TABLE IF NOT EXISTS public.qotw_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES public.qotw_questions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qotw_comments_question_idx ON public.qotw_comments (question_id, created_at);

CREATE TABLE IF NOT EXISTS public.qotw_votes (
  question_id  uuid NOT NULL REFERENCES public.qotw_questions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  option_index int NOT NULL CHECK (option_index BETWEEN 0 AND 3),
  voted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.qotw_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qotw_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qotw_votes     ENABLE ROW LEVEL SECURITY;

-- The queue stays private to admins; everyone sees what has published.
DROP POLICY IF EXISTS "qotw questions select" ON public.qotw_questions;
CREATE POLICY "qotw questions select"
  ON public.qotw_questions FOR SELECT
  TO authenticated
  USING (status IN ('published','archived') OR public.is_admin());

DROP POLICY IF EXISTS "qotw questions admin write" ON public.qotw_questions;
CREATE POLICY "qotw questions admin write"
  ON public.qotw_questions FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "qotw comments select" ON public.qotw_comments;
CREATE POLICY "qotw comments select"
  ON public.qotw_comments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "qotw comments insert" ON public.qotw_comments;
CREATE POLICY "qotw comments insert"
  ON public.qotw_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
    AND EXISTS (
      SELECT 1 FROM public.qotw_questions q
      WHERE q.id = question_id AND q.status = 'published'
    )
  );

DROP POLICY IF EXISTS "qotw comments delete" ON public.qotw_comments;
CREATE POLICY "qotw comments delete"
  ON public.qotw_comments FOR DELETE
  TO authenticated
  USING (public.current_app_user_id() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "qotw votes select" ON public.qotw_votes;
CREATE POLICY "qotw votes select"
  ON public.qotw_votes FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "qotw votes insert" ON public.qotw_votes;
CREATE POLICY "qotw votes insert"
  ON public.qotw_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_app_user_id() = user_id
    AND NOT public.is_kiosk_user()
    AND EXISTS (
      SELECT 1 FROM public.qotw_questions q
      WHERE q.id = question_id AND q.status = 'published'
    )
  );

-- Changing your vote updates the row in place.
DROP POLICY IF EXISTS "qotw votes update" ON public.qotw_votes;
CREATE POLICY "qotw votes update"
  ON public.qotw_votes FOR UPDATE
  TO authenticated
  USING (public.current_app_user_id() = user_id AND NOT public.is_kiosk_user())
  WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "qotw votes delete" ON public.qotw_votes;
CREATE POLICY "qotw votes delete"
  ON public.qotw_votes FOR DELETE
  TO authenticated
  USING (public.current_app_user_id() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qotw_questions TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.qotw_comments  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qotw_votes     TO authenticated;
GRANT ALL ON public.qotw_questions, public.qotw_comments, public.qotw_votes TO service_role;

-- ── Realtime (same guard as 0020_realtime_engagement) ────────────────

ALTER TABLE public.qotw_questions REPLICA IDENTITY FULL;
ALTER TABLE public.qotw_comments  REPLICA IDENTITY FULL;
ALTER TABLE public.qotw_votes     REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qotw_questions','qotw_comments','qotw_votes']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END$$;

-- ── Publishing ───────────────────────────────────────────────────────

/* Archive the current question and promote the lowest-position queued
   one. No-op when the queue is empty (the old question stays up rather
   than leaving the card blank). Runs as postgres from cron; the
   admin-facing RPC below wraps it. */
CREATE OR REPLACE FUNCTION public.qotw_publish_next()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_id uuid;
  monday date;
BEGIN
  SELECT id INTO next_id
  FROM public.qotw_questions
  WHERE status = 'queued'
  ORDER BY position, created_at
  LIMIT 1;
  IF next_id IS NULL THEN
    RETURN;
  END IF;

  monday := (now() AT TIME ZONE 'America/Chicago')::date
            - (EXTRACT(isodow FROM (now() AT TIME ZONE 'America/Chicago'))::int - 1);

  UPDATE public.qotw_questions
  SET status = 'archived'
  WHERE status = 'published';

  UPDATE public.qotw_questions
  SET status = 'published', published_at = now(), week_of = monday
  WHERE id = next_id;
END;
$$;

/* "Publish now" from /admin/qotw. */
CREATE OR REPLACE FUNCTION public.qotw_publish_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only';
  END IF;
  PERFORM public.qotw_publish_next();
END;
$$;

GRANT EXECUTE ON FUNCTION public.qotw_publish_now() TO authenticated;

-- ── Push on publish (mirrors notify_new_announcement) ────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_qotw_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/send-qotw-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'id', NEW.id,
      'prompt', NEW.prompt,
      'kind', NEW.kind
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qotw_notify_published ON public.qotw_questions;
CREATE TRIGGER qotw_notify_published
  AFTER UPDATE ON public.qotw_questions
  FOR EACH ROW
  WHEN (OLD.status = 'queued' AND NEW.status = 'published')
  EXECUTE FUNCTION public.notify_qotw_published();

-- ── Weekly cron (guarded against migration replays) ──────────────────
-- 13:00 UTC Monday = 7am America/Chicago during CST.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qotw-publish-weekly') THEN
    PERFORM cron.schedule(
      'qotw-publish-weekly',
      '0 13 * * 1',
      $job$ SELECT public.qotw_publish_next(); $job$
    );
  END IF;
END$$;
