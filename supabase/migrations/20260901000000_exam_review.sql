-- Missed-question review (Perry's ask, 2026-09-01): after submitting,
-- a candidate can review the questions they missed — stem, options,
-- their own answer, the section, and the protocol reference to study.
-- The CORRECT answer is deliberately never returned: exams are reused
-- for retests, so the key stays server-side. Editors can review any
-- submitted assignment; candidates only their own.
CREATE OR REPLACE FUNCTION public.exam_review(p_assignment uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a public.exam_assignments%ROWTYPE;
  v_def public.exam_definitions%ROWTYPE;
  v_key jsonb;
  v_refs jsonb;
  v_q jsonb;
  v_no text;
  v_is_right boolean;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_a FROM public.exam_assignments
  WHERE id = p_assignment
    AND status = 'submitted'
    AND (user_id = public.current_app_user_id() OR public.is_pipeline_editor());
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_def FROM public.exam_definitions WHERE id = v_a.exam_id;
  SELECT answers, refs INTO v_key, v_refs
  FROM public.exam_answer_keys WHERE exam_id = v_a.exam_id;
  IF v_key IS NULL THEN RETURN NULL; END IF;

  FOR v_q IN SELECT * FROM jsonb_array_elements(v_def.questions) LOOP
    v_no := v_q->>'no';
    IF jsonb_typeof(v_key->v_no) = 'array' THEN
      v_is_right := jsonb_typeof(v_a.answers->v_no) = 'array' AND (
        SELECT COALESCE(array_agg(x ORDER BY x), '{}')
        FROM jsonb_array_elements_text(v_a.answers->v_no) x
      ) = (
        SELECT COALESCE(array_agg(y ORDER BY y), '{}')
        FROM jsonb_array_elements_text(v_key->v_no) y
      );
    ELSE
      v_is_right := (v_a.answers->>v_no) IS NOT NULL
        AND (v_a.answers->>v_no) = (v_key->>v_no);
    END IF;

    IF NOT v_is_right THEN
      v_out := v_out || jsonb_build_object(
        'no', (v_no)::int,
        'section', v_q->'section',
        'text', v_q->'text',
        'options', v_q->'options',
        'type', v_q->'type',
        'image', v_q->'image',
        'your', v_a.answers->v_no,
        'critical', COALESCE((v_q->>'critical')::boolean, false),
        'ref', v_refs->>v_no
      );
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.exam_review(uuid) TO authenticated;
