-- ─────────────────────────────────────────────────────────────────────
-- skills_days_sessions
--
-- Skills Days as first-class sessions. The CDO splits the check-offs
-- across multiple days (e.g. a two-session NEOP week), schedules which
-- stations run on which day, and assigns the trainees attending each
-- day — optionally scoped to specific stations (an EMT cohort member
-- may skip ALS-only stations). The live board then reflects exactly
-- the stations and trainees scheduled for the selected day.
--
-- With no days defined the module behaves as before: every active
-- check-off × the pending pipeline cohort.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  on_date     date NOT NULL,
  label       text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS skills_days_touch_updated_at ON public.skills_days;
CREATE TRIGGER skills_days_touch_updated_at
  BEFORE UPDATE ON public.skills_days
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Stations scheduled on a day ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_day_stations (
  day_id      uuid NOT NULL REFERENCES public.skills_days(id) ON DELETE CASCADE,
  checkoff_id uuid NOT NULL REFERENCES public.skills_checkoffs(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day_id, checkoff_id)
);

-- 3) Trainees assigned to a day ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills_day_candidates (
  day_id      uuid NOT NULL REFERENCES public.skills_days(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  /* NULL = every station scheduled that day; otherwise only these
     check-offs apply to this trainee on this day. */
  station_ids uuid[],
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day_id, user_id)
);

-- 4) RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.skills_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills_day_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills_day_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills_days select" ON public.skills_days;
CREATE POLICY "skills_days select"
  ON public.skills_days FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "skills_days admin write" ON public.skills_days;
CREATE POLICY "skills_days admin write"
  ON public.skills_days FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "skills_day_stations select" ON public.skills_day_stations;
CREATE POLICY "skills_day_stations select"
  ON public.skills_day_stations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "skills_day_stations admin write" ON public.skills_day_stations;
CREATE POLICY "skills_day_stations admin write"
  ON public.skills_day_stations FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "skills_day_candidates select" ON public.skills_day_candidates;
CREATE POLICY "skills_day_candidates select"
  ON public.skills_day_candidates FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "skills_day_candidates admin write" ON public.skills_day_candidates;
CREATE POLICY "skills_day_candidates admin write"
  ON public.skills_day_candidates FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_days TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_day_stations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skills_day_candidates TO authenticated;
GRANT ALL ON public.skills_days TO service_role;
GRANT ALL ON public.skills_day_stations TO service_role;
GRANT ALL ON public.skills_day_candidates TO service_role;
