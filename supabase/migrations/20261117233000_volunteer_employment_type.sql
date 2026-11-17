-- ─────────────────────────────────────────────────────────────────────
-- Volunteers (Justin, 2026-11-17)
--
-- The cert wallet is for VOLUNTEERS ONLY — paid staff keep their certs
-- in Paycom, and two places to upload would breed confusion. The
-- portal had no volunteer marker (everyone was full_time/part_time),
-- so employment_type gains 'volunteer', editable in /admin/employees.
--
-- Enforcement is layered: the UI hides the wallet from paid staff,
-- and RLS refuses wallet INSERTs (rows and files) from non-volunteers.
-- Existing rows stay readable/deletable by their owners if someone
-- converts from volunteer to paid; the reminder sweep skips them.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_employment_type_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_employment_type_check
  CHECK (employment_type IN ('full_time', 'part_time', 'volunteer'));

/* Wallet rows: volunteers only. */
DROP POLICY IF EXISTS "emp certs own insert" ON public.employee_certs;
CREATE POLICY "emp certs own insert"
  ON public.employee_certs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
    AND EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = user_id AND u.employment_type = 'volunteer'
    )
  );

/* Wallet files: volunteers only. */
DROP POLICY IF EXISTS "employee-certs own write" ON storage.objects;
CREATE POLICY "employee-certs own write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-certs'
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
    AND NOT public.is_kiosk_user()
    AND EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = public.current_app_user_id() AND u.employment_type = 'volunteer'
    )
  );

/* Reminders go only to volunteers — someone converted to paid moves to
   Paycom and stops getting portal cert reminders. */
CREATE OR REPLACE FUNCTION public.employee_cert_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  today date := (now() AT TIME ZONE 'America/Chicago')::date;
  days int;
  stage int;
BEGIN
  FOR r IN
    SELECT c.id, c.user_id, c.name, c.expires_on, c.last_reminder_stage
    FROM public.employee_certs c
    JOIN public.app_users u
      ON u.id = c.user_id AND u.active AND u.employment_type = 'volunteer'
    WHERE c.expires_on IS NOT NULL
      AND c.expires_on <= today + 60
      AND c.last_reminder_stage < 4
  LOOP
    days := r.expires_on - today;
    stage := CASE
      WHEN days < 0 THEN 4
      WHEN days <= 7 THEN 3
      WHEN days <= 30 THEN 2
      ELSE 1
    END;
    IF stage > r.last_reminder_stage THEN
      PERFORM net.http_post(
        url     := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/cert-expiry-push',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := jsonb_build_object(
          'user_id', r.user_id,
          'cert_name', r.name,
          'expires_on', r.expires_on,
          'days', days
        )
      );
      UPDATE public.employee_certs
      SET last_reminder_stage = stage
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
