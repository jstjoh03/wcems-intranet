-- Trainee comments on DOR/ICRs (Justin, 2026-11-11): every report gets
-- a "Trainee comments" section in the trainee's own words. At a live
-- review they type it on the FTO's device and it rides the submit
-- payload; on the deferred path this RPC stamps it into the payload
-- alongside their signature. Dropped + recreated (not overloaded) so
-- PostgREST never sees an ambiguous 2-arg call; p_comment defaults to
-- NULL, so stale clients still signing with two args keep working.
DROP FUNCTION IF EXISTS public.ftep_sign_report(uuid, text);

CREATE OR REPLACE FUNCTION public.ftep_sign_report(
  p_report_id uuid,
  p_signature text,
  p_comment text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_signature IS NULL OR length(p_signature) < 10 THEN
    RETURN false;
  END IF;
  UPDATE public.ftep_reports
  SET trainee_signature = p_signature,
      payload = CASE
        WHEN p_comment IS NOT NULL AND length(btrim(p_comment)) > 0
          THEN jsonb_set(coalesce(payload, '{}'::jsonb), '{traineeComment}',
                         to_jsonb(left(btrim(p_comment), 2000)))
        ELSE payload
      END
  WHERE id = p_report_id
    AND trainee_id = public.current_app_user_id()
    AND status = 'submitted'
    AND trainee_signature IS NULL;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ftep_sign_report(uuid, text, text) TO authenticated;
