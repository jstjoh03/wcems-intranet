-- ─────────────────────────────────────────────────────────────────────
-- employee_certs — self-service certification wallet (Justin, 2026-11-17)
--
-- Admin staff (Christina & Michael Mathes were the trigger — they were
-- about to be set up in Paycom just to have somewhere to put cards)
-- and any employee can upload their own cert images, track issue and
-- expiration dates, and get expiration reminders — no Paycom, no
-- waiting on an editor. Lives beside the clinical cabinet, not inside
-- it: these are the employee's OWN records, self-managed.
--
-- Reminders: a daily pg_cron sweep stages each expiring cert through
-- 60 → 30 → 7 days → expired, firing cert-expiry-push (web push +
-- email via Graph) once per stage. Renewing a cert (changing its
-- expiration) resets the stages.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_certs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  cert_number          text,
  issued_on            date,
  expires_on           date,
  storage_path         text UNIQUE,
  content_type         text,
  size_bytes           bigint,
  note                 text,
  /* Reminder ladder: 0 none sent · 1 ≤60d · 2 ≤30d · 3 ≤7d · 4 expired. */
  last_reminder_stage  int NOT NULL DEFAULT 0 CHECK (last_reminder_stage BETWEEN 0 AND 4),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_certs_user_idx ON public.employee_certs (user_id);
CREATE INDEX IF NOT EXISTS employee_certs_expiry_idx ON public.employee_certs (expires_on)
  WHERE expires_on IS NOT NULL;

DROP TRIGGER IF EXISTS employee_certs_touch_updated_at ON public.employee_certs;
CREATE TRIGGER employee_certs_touch_updated_at
  BEFORE UPDATE ON public.employee_certs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

/* A renewal (new expiration date) starts the reminder ladder over. */
CREATE OR REPLACE FUNCTION public.employee_certs_reset_reminders()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expires_on IS DISTINCT FROM OLD.expires_on THEN
    NEW.last_reminder_stage := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_certs_reset_reminders ON public.employee_certs;
CREATE TRIGGER employee_certs_reset_reminders
  BEFORE UPDATE ON public.employee_certs
  FOR EACH ROW EXECUTE FUNCTION public.employee_certs_reset_reminders();

ALTER TABLE public.employee_certs ENABLE ROW LEVEL SECURITY;

-- Your own wallet; admins and pipeline editors can see everyone's
-- (verification, compliance spot-checks).
DROP POLICY IF EXISTS "emp certs select" ON public.employee_certs;
CREATE POLICY "emp certs select"
  ON public.employee_certs FOR SELECT
  TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_admin()
    OR public.is_pipeline_editor()
  );

DROP POLICY IF EXISTS "emp certs own insert" ON public.employee_certs;
CREATE POLICY "emp certs own insert"
  ON public.employee_certs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.current_app_user_id()
    AND NOT public.is_kiosk_user()
  );

DROP POLICY IF EXISTS "emp certs own update" ON public.employee_certs;
CREATE POLICY "emp certs own update"
  ON public.employee_certs FOR UPDATE
  TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "emp certs own delete" ON public.employee_certs;
CREATE POLICY "emp certs own delete"
  ON public.employee_certs FOR DELETE
  TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_certs TO authenticated;
GRANT ALL ON public.employee_certs TO service_role;

-- ── Private storage bucket; paths are <app_user_id>/<file> ──────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-certs', 'employee-certs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "employee-certs read" ON storage.objects;
CREATE POLICY "employee-certs read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'employee-certs'
    AND (
      (storage.foldername(name))[1] = public.current_app_user_id()::text
      OR public.is_admin()
      OR public.is_pipeline_editor()
    )
  );

DROP POLICY IF EXISTS "employee-certs own write" ON storage.objects;
CREATE POLICY "employee-certs own write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-certs'
    AND (storage.foldername(name))[1] = public.current_app_user_id()::text
    AND NOT public.is_kiosk_user()
  );

DROP POLICY IF EXISTS "employee-certs own delete" ON storage.objects;
CREATE POLICY "employee-certs own delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-certs'
    AND (
      (storage.foldername(name))[1] = public.current_app_user_id()::text
      OR public.is_admin()
    )
  );

-- ── Daily reminder sweep (7:30am Central = 13:30 UTC in CST) ────────

CREATE EXTENSION IF NOT EXISTS pg_net;

/* Walk every dated cert through the 60/30/7/expired ladder, firing
   cert-expiry-push once per stage. Runs as postgres from cron. */
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
    JOIN public.app_users u ON u.id = c.user_id AND u.active
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'employee-cert-reminders-daily') THEN
    PERFORM cron.schedule(
      'employee-cert-reminders-daily',
      '30 13 * * *',
      'SELECT public.employee_cert_reminders();'
    );
  END IF;
END$$;
