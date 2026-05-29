-- ─────────────────────────────────────────────────────────────────────
-- 0045_profile_prompt_dismissed
--
-- Backs the "complete your profile" onboarding nudge. New users sign
-- in but often don't realize they should add a photo / set station +
-- shift. A first-run modal prompts them; this column remembers when
-- they've tapped "Don't show again" so it persists across devices
-- (not just localStorage on one browser).
--
-- "Remind me later" is session-only and handled client-side — it
-- doesn't touch this column.
--
-- Write path is a SECURITY DEFINER RPC so we don't have to reason
-- about the app_users self-update column-lock trigger; the function
-- resolves the caller via auth.uid() and can only flip their own row.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS profile_prompt_dismissed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.dismiss_profile_prompt()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
    FROM public.app_users
    WHERE auth_user_id = auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.app_users
     SET profile_prompt_dismissed = true
   WHERE id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_profile_prompt() TO authenticated;
