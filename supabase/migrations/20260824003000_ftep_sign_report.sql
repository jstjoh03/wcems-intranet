-- Deferred trainee signatures (Justin, 2026-08-24): the default stays
-- sign-together-at-review, but an FTO leaving at shift change can
-- submit with their signature alone; the trainee is then prompted on
-- My Progress to review and sign (view-only — no edit path). Trainees
-- have no UPDATE right on ftep_reports, so this SECURITY DEFINER RPC
-- is the ONLY way in: it can set exactly one column (trainee_signature)
-- on exactly their own submitted, still-unsigned report.
CREATE OR REPLACE FUNCTION public.ftep_sign_report(p_report_id uuid, p_signature text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_signature IS NULL OR length(p_signature) < 10 THEN
    RETURN false;
  END IF;
  UPDATE public.ftep_reports
  SET trainee_signature = p_signature
  WHERE id = p_report_id
    AND trainee_id = public.current_app_user_id()
    AND status = 'submitted'
    AND trainee_signature IS NULL;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ftep_sign_report(uuid, text) TO authenticated;
