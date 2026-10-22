-- ─────────────────────────────────────────────────────────────────────
-- Clinical console rebuild — PHASE B (2026-10-22)
--
--  1. ftep_advancement_records — the Program Guide's Phase Advancement
--     Record, digitized: four certifications of completion, next-phase
--     start + FTO, optional rule waiver, employee + FTO signatures
--     (CDO signs by saving). One row per phase move; the PDF files to
--     the employee's documents.
--  2. megacode_runs — digital Megacode Evaluation (Skills-Day-style):
--     examiner picks a scenario, checks tasks off on their own device,
--     auto-scored (every critical action must pass), dual signatures.
--  3. ftep_fto_eval_requests — "you owe a Trainee Evaluation of FTO"
--     queue. Auto-created on a protocol-test pass and on any FTO
--     change; the trainee's submission closes it. dedup_key keeps the
--     auto-triggers idempotent across sessions.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Phase Advancement Records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftep_advancement_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id          uuid NOT NULL REFERENCES public.pipeline_records(id) ON DELETE CASCADE,
  from_phase_key     text NOT NULL,
  -- null = the program's final phase closed (credentialing step follows)
  to_phase_key       text,
  effective_date     date NOT NULL,
  next_start_date    date,
  next_fto_user_id   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  next_fto_name      text,
  -- snapshot of the four certifications + their evidence lines
  certs              jsonb NOT NULL DEFAULT '{}'::jsonb,
  waiver_id          uuid REFERENCES public.ftep_rule_waivers(id) ON DELETE SET NULL,
  employee_signature text,
  fto_signature      text,
  cdo_user_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ftep_advancement_records_record_idx
  ON public.ftep_advancement_records (record_id, created_at DESC);

ALTER TABLE public.ftep_advancement_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ftep_advancements select" ON public.ftep_advancement_records;
CREATE POLICY "ftep_advancements select"
  ON public.ftep_advancement_records FOR SELECT
  TO authenticated
  USING (public.ftep_thread_member(record_id));

DROP POLICY IF EXISTS "ftep_advancements editor write" ON public.ftep_advancement_records;
CREATE POLICY "ftep_advancements editor write"
  ON public.ftep_advancement_records FOR ALL
  TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- 2) Megacode runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.megacode_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  record_id           uuid REFERENCES public.pipeline_records(id) ON DELETE SET NULL,
  transition          text,
  scenario_key        text NOT NULL,
  scenario_title      text NOT NULL,
  examiner_id         uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  -- { "<taskKey>": { done: bool, at: "HH:MM"|null } } — labels/critical
  -- flags are stamped into the PDF from the scenario bank at completion
  checks              jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed              boolean,
  summary_note        text,
  examiner_signature  text,
  candidate_signature text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS megacode_runs_user_idx
  ON public.megacode_runs (user_id, started_at DESC);

ALTER TABLE public.megacode_runs ENABLE ROW LEVEL SECURITY;

-- Examiner view only while running; the candidate receives the signed
-- PDF in their documents instead of raw rows.
DROP POLICY IF EXISTS "megacode_runs editor all" ON public.megacode_runs;
CREATE POLICY "megacode_runs editor all"
  ON public.megacode_runs FOR ALL
  TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- 3) Trainee-Evaluation-of-FTO requests ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ftep_fto_eval_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_user_id  uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  fto_name         text NOT NULL DEFAULT '',
  phase_label      text NOT NULL DEFAULT '',
  reason           text NOT NULL DEFAULT 'manual',
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'done', 'dismissed')),
  eval_id          uuid REFERENCES public.ftep_fto_evals(id) ON DELETE SET NULL,
  dedup_key        text UNIQUE,
  created_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS ftep_fto_eval_requests_trainee_idx
  ON public.ftep_fto_eval_requests (trainee_user_id, status);

ALTER TABLE public.ftep_fto_eval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fto_eval_requests select" ON public.ftep_fto_eval_requests;
CREATE POLICY "fto_eval_requests select"
  ON public.ftep_fto_eval_requests FOR SELECT
  TO authenticated
  USING (
    trainee_user_id = public.current_app_user_id()
    OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
               WHERE pe.user_id = public.current_app_user_id())
  );

DROP POLICY IF EXISTS "fto_eval_requests editor write" ON public.ftep_fto_eval_requests;
CREATE POLICY "fto_eval_requests editor write"
  ON public.ftep_fto_eval_requests FOR ALL
  TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                      WHERE pe.user_id = public.current_app_user_id()))
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.pipeline_editors pe
                                           WHERE pe.user_id = public.current_app_user_id()));

-- The trainee closes their own request when they submit the eval.
DROP POLICY IF EXISTS "fto_eval_requests trainee complete" ON public.ftep_fto_eval_requests;
CREATE POLICY "fto_eval_requests trainee complete"
  ON public.ftep_fto_eval_requests FOR UPDATE
  TO authenticated
  USING (trainee_user_id = public.current_app_user_id())
  WITH CHECK (trainee_user_id = public.current_app_user_id());

-- Grants (house rule: RLS + explicit GRANTs) ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_advancement_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.megacode_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ftep_fto_eval_requests TO authenticated;
