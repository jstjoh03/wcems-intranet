-- ─────────────────────────────────────────────────────────────────────
-- 0008_birthday_reactions
--
-- Heart-reaction state for the daily birthday list, replacing the
-- localStorage stub from `useBirthdayReactions`. Keyed by the day the
-- birthday is celebrated + a slugified person_key + the reacting user,
-- so reactions naturally roll over each year — same person on the same
-- date next year is a fresh row.
--
-- RLS:
--   • All authenticated users can SELECT every row — counts aggregate
--     across the whole crew.
--   • A user can INSERT/DELETE only rows where user_id = auth.uid().
--   • No UPDATE policy — toggle is insert-or-delete; there's nothing
--     to mutate on an existing reaction.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.birthday_reactions (
  birthday_date  date NOT NULL,
  person_key     text NOT NULL,
  user_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  reacted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (birthday_date, person_key, user_id)
);

CREATE INDEX IF NOT EXISTS birthday_reactions_user_id_idx
  ON public.birthday_reactions (user_id);

ALTER TABLE public.birthday_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "birthday_reactions select for authenticated"
  ON public.birthday_reactions;
CREATE POLICY "birthday_reactions select for authenticated"
  ON public.birthday_reactions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "birthday_reactions self insert"
  ON public.birthday_reactions;
CREATE POLICY "birthday_reactions self insert"
  ON public.birthday_reactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "birthday_reactions self delete"
  ON public.birthday_reactions;
CREATE POLICY "birthday_reactions self delete"
  ON public.birthday_reactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.birthday_reactions TO authenticated;
