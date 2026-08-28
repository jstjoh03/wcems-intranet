-- Exam upgrades for the ported original P1 test (Justin, 2026-08-26):
--   • exam-assets bucket: rhythm strips / reference charts embedded in
--     questions (authenticated read — the images alone reveal nothing;
--     writes via service role only, through exam-import)
--   • exam_submit learns multi-select ("circle all that apply"): the
--     key stores an ARRAY for those questions and the candidate's
--     selection must match the full set exactly
ALTER TABLE public.exam_definitions
  ADD COLUMN IF NOT EXISTS assets_prefix text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('exam-assets', 'exam-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "exam-assets read" ON storage.objects;
CREATE POLICY "exam-assets read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'exam-assets');

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
  v_is_right boolean;
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
    IF jsonb_typeof(v_key->v_no) = 'array' THEN
      /* Multi-select: exact set match. */
      v_is_right := jsonb_typeof(p_answers->v_no) = 'array' AND (
        SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_answers->v_no) x
      ) = (
        SELECT COALESCE(array_agg(y ORDER BY y), '{}') FROM jsonb_array_elements_text(v_key->v_no) y
      );
    ELSE
      v_is_right := (p_answers->>v_no) IS NOT NULL AND (p_answers->>v_no) = (v_key->>v_no);
    END IF;
    IF v_is_right THEN
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
           'Auto-checked - portal exam clean pass (' || v_def.title || ')')
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
