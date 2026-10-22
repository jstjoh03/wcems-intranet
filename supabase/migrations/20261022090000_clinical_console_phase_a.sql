-- ─────────────────────────────────────────────────────────────────────
-- clinical_console_phase_a
--
-- Connective schema for the Clinical Development rebuild ("one system,
-- one file, one queue"). Everything here is additive — the legacy
-- screens keep working untouched while the console grows around them.
--
--  1. DORs/ICRs carry the phase they were filed under (stamped by the
--     runner from the trainee's active phase; existing reports are
--     backfilled from the phase windows where they fit).
--  2. ftep_messages — the per-trainee message thread. Visible to
--     clinical editors, admins, supervisors, the trainee, and any FTO
--     who has held one of their phases; the same circle may post.
--     New posts fan out push + email via sched-notify (clinical kind).
--  3. ftep_day_overrides — per-date corrections to the schedule-derived
--     training-day ledger (force-count an edge case / exclude a ride).
--  4. ftep_rule_waivers — one-time, documented exceptions to a program
--     rule for one trainee (e.g. final phase without a different FTO);
--     prints on the Advancement Record. Rules themselves stay in Setup.
--  5. clinical_events — the per-person activity timeline every console
--     write (manual or automated) appends to.
--  6. training_attendance.user_id — links a card-class attendee to the
--     employee so a closed class can write the card to their file.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Phase stamped on reports ────────────────────────────────────────
ALTER TABLE public.ftep_reports ADD COLUMN IF NOT EXISTS phase_key text;

UPDATE public.ftep_reports r
SET phase_key = sub.phase_key
FROM (
  SELECT r2.id,
         (
           SELECT pp.phase_key
           FROM public.ftep_phase_progress pp
           JOIN public.pipeline_records pr ON pr.id = pp.record_id
           WHERE pr.user_id = r2.trainee_id
             AND pp.started_at IS NOT NULL
             AND pp.started_at <= r2.eval_date
             AND (pp.completed_at IS NULL OR pp.completed_at >= r2.eval_date)
           ORDER BY pp.started_at DESC
           LIMIT 1
         ) AS phase_key
  FROM public.ftep_reports r2
) sub
WHERE sub.id = r.id
  AND r.phase_key IS NULL
  AND sub.phase_key IS NOT NULL;

-- 2) Trainee message threads ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftep_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id   uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ftep_messages_record_idx
  ON public.ftep_messages (record_id, created_at);

/* The visibility circle for a trainee's thread. */
CREATE OR REPLACE FUNCTION public.ftep_thread_member(rec uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.is_admin()
      OR public.is_supervisor()
      OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                 WHERE pe.user_id = public.current_app_user_id())
      OR EXISTS (SELECT 1 FROM public.pipeline_records pr
                 WHERE pr.id = rec AND pr.user_id = public.current_app_user_id())
      OR EXISTS (SELECT 1 FROM public.ftep_phase_progress pp
                 WHERE pp.record_id = rec
                   AND pp.fto_user_id = public.current_app_user_id());
$$;

GRANT EXECUTE ON FUNCTION public.ftep_thread_member(uuid) TO authenticated;

ALTER TABLE public.ftep_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_messages select" ON public.ftep_messages;
CREATE POLICY "ftep_messages select"
  ON public.ftep_messages FOR SELECT
  TO authenticated
  USING (public.ftep_thread_member(record_id));

DROP POLICY IF EXISTS "ftep_messages insert" ON public.ftep_messages;
CREATE POLICY "ftep_messages insert"
  ON public.ftep_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = public.current_app_user_id()
    AND public.ftep_thread_member(record_id)
  );

DROP POLICY IF EXISTS "ftep_messages delete" ON public.ftep_messages;
CREATE POLICY "ftep_messages delete"
  ON public.ftep_messages FOR DELETE
  TO authenticated
  USING (
    author_id = public.current_app_user_id() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
               WHERE pe.user_id = public.current_app_user_id())
  );

-- 3) Training-day overrides ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftep_day_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id   uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  counts      boolean NOT NULL,
  reason      text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, on_date)
);

ALTER TABLE public.ftep_day_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_day_overrides select" ON public.ftep_day_overrides;
CREATE POLICY "ftep_day_overrides select"
  ON public.ftep_day_overrides FOR SELECT
  TO authenticated
  USING (public.ftep_thread_member(record_id));

DROP POLICY IF EXISTS "ftep_day_overrides editor write" ON public.ftep_day_overrides;
CREATE POLICY "ftep_day_overrides editor write"
  ON public.ftep_day_overrides FOR ALL
  TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- 4) One-time rule waivers ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftep_rule_waivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id   uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  rule_key    text NOT NULL,
  reason      text NOT NULL,
  waived_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ftep_rule_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_rule_waivers select" ON public.ftep_rule_waivers;
CREATE POLICY "ftep_rule_waivers select"
  ON public.ftep_rule_waivers FOR SELECT
  TO authenticated
  USING (public.ftep_thread_member(record_id));

DROP POLICY IF EXISTS "ftep_rule_waivers editor write" ON public.ftep_rule_waivers;
CREATE POLICY "ftep_rule_waivers editor write"
  ON public.ftep_rule_waivers FOR ALL
  TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- 5) Per-person activity timeline ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  summary     text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinical_events_user_idx
  ON public.clinical_events (user_id, created_at DESC);

ALTER TABLE public.clinical_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinical_events select" ON public.clinical_events;
CREATE POLICY "clinical_events select"
  ON public.clinical_events FOR SELECT
  TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
               WHERE pe.user_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS "clinical_events editor insert" ON public.clinical_events;
CREATE POLICY "clinical_events editor insert"
  ON public.clinical_events FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- 6) Card-class attendee → employee link ─────────────────────────────
ALTER TABLE public.training_attendance
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL;

-- Grants (house rule: RLS + explicit grants) ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_day_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_rule_waivers TO authenticated;
GRANT SELECT, INSERT ON public.clinical_events TO authenticated;
GRANT ALL ON public.ftep_messages TO service_role;
GRANT ALL ON public.ftep_day_overrides TO service_role;
GRANT ALL ON public.ftep_rule_waivers TO service_role;
GRANT ALL ON public.clinical_events TO service_role;

-- Realtime: the thread updates live wherever it is open ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ftep_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ftep_messages;
  END IF;
END $$;
