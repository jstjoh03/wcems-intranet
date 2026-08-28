-- ─────────────────────────────────────────────────────────────────────
-- Protocol examinations (Justin, 2026-08-25). Locked decisions:
--   • proctor release required — a candidate can't start until a
--     clinical editor releases the assignment
--   • answers NEVER reach the candidate's browser: exam_definitions
--     holds questions only; keys live in exam_answer_keys (editors +
--     service role); grading happens in the exam_submit RPC
--   • a clean pass (>= passing_pct AND no critical-item misses)
--     auto-checks the protocol gate on the candidate's active
--     transition; critical misses require targeted retest per policy
-- Exam CONTENT is inserted directly in the DB (controlled testing
-- material — deliberately not in the repo).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exam_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  slug               text UNIQUE,
  time_limit_minutes integer NOT NULL DEFAULT 120,
  passing_pct        integer NOT NULL DEFAULT 85,
  instructions       text,
  /* [{no, section, text, options{A..D}, critical}] — NO answers. */
  questions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS exam_definitions_touch_updated_at ON public.exam_definitions;
CREATE TRIGGER exam_definitions_touch_updated_at
  BEFORE UPDATE ON public.exam_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.exam_answer_keys (
  exam_id uuid PRIMARY KEY REFERENCES public.exam_definitions(id) ON DELETE CASCADE,
  answers jsonb NOT NULL,
  refs    jsonb
);

CREATE TABLE IF NOT EXISTS public.exam_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       uuid NOT NULL REFERENCES public.exam_definitions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned','released','in_progress','submitted','cancelled')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  started_at    timestamptz,
  submitted_at  timestamptz,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_pct     numeric,
  passed        boolean,
  critical_missed jsonb,
  note          text
);

CREATE INDEX IF NOT EXISTS exam_assignments_user_idx ON public.exam_assignments (user_id);

ALTER TABLE public.exam_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_assignments ENABLE ROW LEVEL SECURITY;

/* Questions are visible to editors, and to a candidate ONLY once their
   assignment is released (or later, for the results view). */
DROP POLICY IF EXISTS "exam_definitions select" ON public.exam_definitions;
CREATE POLICY "exam_definitions select"
  ON public.exam_definitions FOR SELECT
  TO authenticated
  USING (
    public.is_pipeline_editor()
    OR EXISTS (
      SELECT 1 FROM public.exam_assignments a
      WHERE a.exam_id = exam_definitions.id
        AND a.user_id = public.current_app_user_id()
        AND a.status IN ('released','in_progress','submitted')
    )
  );

DROP POLICY IF EXISTS "exam_definitions editor all" ON public.exam_definitions;
CREATE POLICY "exam_definitions editor all"
  ON public.exam_definitions FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

DROP POLICY IF EXISTS "exam_answer_keys editor all" ON public.exam_answer_keys;
CREATE POLICY "exam_answer_keys editor all"
  ON public.exam_answer_keys FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

DROP POLICY IF EXISTS "exam_assignments editor or own select" ON public.exam_assignments;
CREATE POLICY "exam_assignments editor or own select"
  ON public.exam_assignments FOR SELECT
  TO authenticated
  USING (public.is_pipeline_editor() OR user_id = public.current_app_user_id());

DROP POLICY IF EXISTS "exam_assignments editor all" ON public.exam_assignments;
CREATE POLICY "exam_assignments editor all"
  ON public.exam_assignments FOR ALL
  TO authenticated
  USING (public.is_pipeline_editor())
  WITH CHECK (public.is_pipeline_editor());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_answer_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_assignments TO authenticated;
GRANT ALL ON public.exam_definitions TO service_role;
GRANT ALL ON public.exam_answer_keys TO service_role;
GRANT ALL ON public.exam_assignments TO service_role;

/* ── Candidate flow RPCs (the only write path for candidates) ─────── */

CREATE OR REPLACE FUNCTION public.exam_start(p_assignment uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_started timestamptz;
BEGIN
  UPDATE public.exam_assignments
  SET status = 'in_progress', started_at = COALESCE(started_at, now())
  WHERE id = p_assignment
    AND user_id = public.current_app_user_id()
    AND status IN ('released','in_progress')
  RETURNING started_at INTO v_started;
  RETURN v_started;
END;
$$;

CREATE OR REPLACE FUNCTION public.exam_save(p_assignment uuid, p_answers jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.exam_assignments
  SET answers = p_answers
  WHERE id = p_assignment
    AND user_id = public.current_app_user_id()
    AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

/* Grades server-side (key never leaves the DB) and, on a clean pass,
   auto-checks the protocol gate on the candidate's active transition. */
CREATE OR REPLACE FUNCTION public.exam_submit(p_assignment uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a public.exam_assignments%ROWTYPE;
  v_def public.exam_definitions%ROWTYPE;
  v_key jsonb;
  v_q jsonb;
  v_no text;
  v_total int := 0;
  v_correct int := 0;
  v_crit_missed jsonb := '[]'::jsonb;
  v_score numeric;
  v_passed boolean;
  v_rec public.pipeline_records%ROWTYPE;
  v_transition text;
  v_gate text;
BEGIN
  SELECT * INTO v_a FROM public.exam_assignments
  WHERE id = p_assignment AND user_id = public.current_app_user_id() AND status = 'in_progress';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Assignment is not in progress.');
  END IF;

  SELECT * INTO v_def FROM public.exam_definitions WHERE id = v_a.exam_id;
  SELECT answers INTO v_key FROM public.exam_answer_keys WHERE exam_id = v_a.exam_id;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No answer key on file.');
  END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(v_def.questions) LOOP
    v_no := v_q->>'no';
    v_total := v_total + 1;
    IF (p_answers->>v_no) IS NOT NULL AND (p_answers->>v_no) = (v_key->>v_no) THEN
      v_correct := v_correct + 1;
    ELSIF COALESCE((v_q->>'critical')::boolean, false) THEN
      v_crit_missed := v_crit_missed || to_jsonb((v_no)::int);
    END IF;
  END LOOP;

  v_score := round((v_correct::numeric / GREATEST(v_total, 1)) * 100, 1);
  v_passed := v_score >= v_def.passing_pct;

  UPDATE public.exam_assignments
  SET status = 'submitted',
      submitted_at = now(),
      answers = p_answers,
      score_pct = v_score,
      passed = v_passed,
      critical_missed = v_crit_missed
  WHERE id = p_assignment;

  /* Clean pass → auto-check the protocol gate (Justin's decision #1). */
  IF v_passed AND jsonb_array_length(v_crit_missed) = 0 THEN
    SELECT * INTO v_rec FROM public.pipeline_records WHERE user_id = v_a.user_id;
    IF FOUND THEN
      v_transition := CASE
        WHEN v_rec.pending THEN 'NEOP'
        WHEN v_rec.in_aemt_upgrade THEN 'AEMT'
        WHEN v_rec.in_p3_process THEN 'P2_P3'
        WHEN v_rec.working_phase = 'NEOP' THEN 'NEOP'
        WHEN v_rec.working_phase = 'P2' AND v_rec.legacy_track THEN 'P1_P2_LEGACY'
        WHEN v_rec.working_phase = 'P2' THEN 'P1_P2'
        WHEN v_rec.working_phase = 'P3' THEN 'P2_P3'
        WHEN v_rec.working_phase IS NOT NULL AND v_rec.legacy_track THEN 'P1_LEGACY'
        WHEN v_rec.working_phase IS NOT NULL THEN 'P1C_P1'
        ELSE NULL
      END;
      IF v_transition IS NOT NULL THEN
        v_gate := CASE WHEN v_transition IN ('P1_LEGACY','P1_P2_LEGACY','P2_P3')
                       THEN 'protocol_test' ELSE 'protocol_exam' END;
        INSERT INTO public.pipeline_gate_progress
          (record_id, transition, gate_key, status, value, completed_at, note)
        VALUES
          (v_rec.id, v_transition, v_gate, 'complete', v_score || '%', CURRENT_DATE,
           'Auto-checked — portal exam clean pass (' || v_def.title || ')')
        ON CONFLICT (record_id, transition, gate_key) DO UPDATE
        SET status = 'complete',
            value = EXCLUDED.value,
            completed_at = EXCLUDED.completed_at,
            note = EXCLUDED.note;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'score_pct', v_score,
    'passed', v_passed,
    'passing_pct', v_def.passing_pct,
    'critical_missed', v_crit_missed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.exam_start(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exam_save(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exam_submit(uuid, jsonb) TO authenticated;

/* Realtime: candidates wait on My Progress for the proctor release. */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'exam_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_assignments;
  END IF;
END $$;
