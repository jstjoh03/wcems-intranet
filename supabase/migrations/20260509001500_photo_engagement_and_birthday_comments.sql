-- ─────────────────────────────────────────────────────────────────────
-- 0016_photo_engagement_and_birthday_comments
--
-- Three tables, all using the engagement pattern already established
-- by `birthday_reactions` (migration 0008):
--   • photo_reactions      — heart toggles on gallery photos
--   • photo_comments       — threaded comments on gallery photos
--   • birthday_comments    — threaded comments on each daily birthday
--
-- All user_id columns reference `app_users.id` (the internal uuid,
-- decoupled from auth.uid() by migration 0012). RLS resolves the
-- signed-in user via `current_app_user_id()`.
--
-- Comment policy:
--   • Everyone signed-in can read.
--   • Self insert (your own user_id only).
--   • Self delete OR admin delete (basic moderation).
--   • No update — delete-and-repost is simpler than tracking edits.
-- ─────────────────────────────────────────────────────────────────────

-- 1) photo_reactions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.photo_reactions (
  photo_id    uuid NOT NULL REFERENCES public.gallery_photos(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  reacted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, user_id)
);

CREATE INDEX IF NOT EXISTS photo_reactions_user_id_idx
  ON public.photo_reactions (user_id);

ALTER TABLE public.photo_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photo_reactions select for authenticated"
  ON public.photo_reactions;
CREATE POLICY "photo_reactions select for authenticated"
  ON public.photo_reactions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "photo_reactions self insert" ON public.photo_reactions;
CREATE POLICY "photo_reactions self insert"
  ON public.photo_reactions FOR INSERT
  TO authenticated WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "photo_reactions self delete" ON public.photo_reactions;
CREATE POLICY "photo_reactions self delete"
  ON public.photo_reactions FOR DELETE
  TO authenticated USING (public.current_app_user_id() = user_id);

GRANT SELECT, INSERT, DELETE ON public.photo_reactions TO authenticated;

-- 2) photo_comments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.photo_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id    uuid NOT NULL REFERENCES public.gallery_photos(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_comments_photo_created_idx
  ON public.photo_comments (photo_id, created_at ASC);
CREATE INDEX IF NOT EXISTS photo_comments_user_idx
  ON public.photo_comments (user_id);

ALTER TABLE public.photo_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photo_comments select for authenticated"
  ON public.photo_comments;
CREATE POLICY "photo_comments select for authenticated"
  ON public.photo_comments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "photo_comments self insert" ON public.photo_comments;
CREATE POLICY "photo_comments self insert"
  ON public.photo_comments FOR INSERT
  TO authenticated WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "photo_comments self or admin delete" ON public.photo_comments;
CREATE POLICY "photo_comments self or admin delete"
  ON public.photo_comments FOR DELETE
  TO authenticated USING (
    public.current_app_user_id() = user_id OR public.is_admin()
  );

GRANT SELECT, INSERT, DELETE ON public.photo_comments TO authenticated;

-- 3) birthday_comments ──────────────────────────────────────────────
-- Same compound key as birthday_reactions (date + person_key) so the
-- thread naturally rolls over each year — last year's comments stay in
-- the DB but they're keyed to a different `birthday_date` so they
-- won't show up on tomorrow's celebration of the same person.
CREATE TABLE IF NOT EXISTS public.birthday_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  birthday_date   date NOT NULL,
  person_key      text NOT NULL,
  user_id         uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 500),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS birthday_comments_target_created_idx
  ON public.birthday_comments (birthday_date, person_key, created_at ASC);
CREATE INDEX IF NOT EXISTS birthday_comments_user_idx
  ON public.birthday_comments (user_id);

ALTER TABLE public.birthday_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "birthday_comments select for authenticated"
  ON public.birthday_comments;
CREATE POLICY "birthday_comments select for authenticated"
  ON public.birthday_comments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "birthday_comments self insert" ON public.birthday_comments;
CREATE POLICY "birthday_comments self insert"
  ON public.birthday_comments FOR INSERT
  TO authenticated WITH CHECK (public.current_app_user_id() = user_id);

DROP POLICY IF EXISTS "birthday_comments self or admin delete" ON public.birthday_comments;
CREATE POLICY "birthday_comments self or admin delete"
  ON public.birthday_comments FOR DELETE
  TO authenticated USING (
    public.current_app_user_id() = user_id OR public.is_admin()
  );

GRANT SELECT, INSERT, DELETE ON public.birthday_comments TO authenticated;
