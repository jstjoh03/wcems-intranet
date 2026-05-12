-- ─────────────────────────────────────────────────────────────────────
-- 0020_realtime_engagement
--
-- Add the four engagement tables (reactions + comments × birthday +
-- photo) to Supabase's realtime publication so postgres_changes events
-- broadcast to subscribed clients.
--
-- REPLICA IDENTITY FULL is required so DELETE events include the full
-- OLD row — without it, the payload only contains the PK columns and
-- our client-side handlers can't dedupe or locate the deleted row in
-- the per-photo / per-birthday cache (photo_reactions and
-- birthday_reactions use composite PKs; comments use a single uuid
-- but we still need photo_id / birthday_date / person_key off the
-- OLD row to find the cache bucket).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.photo_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.photo_comments REPLICA IDENTITY FULL;
ALTER TABLE public.birthday_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.birthday_comments REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'photo_reactions',
    'photo_comments',
    'birthday_reactions',
    'birthday_comments'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    END IF;
  END LOOP;
END$$;
