-- ─────────────────────────────────────────────────────────────────────
-- 0009_user_link_preferences
--
-- Per-user pin / hide / sort overrides for Quick Links. Replaces the
-- localStorage stub from `useUserLinkPreferences`.
--
-- RLS scopes everything to `auth.uid() = user_id` — preferences are
-- personal, no admin override needed and no cross-user reads.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_link_preferences (
  user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  link_id      text NOT NULL,
  pinned       boolean NOT NULL DEFAULT false,
  hidden       boolean NOT NULL DEFAULT false,
  custom_sort  integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, link_id)
);

DROP TRIGGER IF EXISTS user_link_preferences_touch_updated_at ON public.user_link_preferences;
CREATE TRIGGER user_link_preferences_touch_updated_at
  BEFORE UPDATE ON public.user_link_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_link_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_link_preferences self all" ON public.user_link_preferences;
CREATE POLICY "user_link_preferences self all"
  ON public.user_link_preferences FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_link_preferences TO authenticated;
