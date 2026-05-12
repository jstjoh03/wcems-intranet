-- ─────────────────────────────────────────────────────────────────────
-- 0027_schedule_sync_wix_training
--
-- Schedule the `sync-wix-training` Edge Function on a 15-minute cron
-- using `pg_cron` (driver) + `pg_net` (HTTP). This replaces the
-- per-function Schedules tab in the Supabase Dashboard, which is a
-- paid-plan-only feature — pg_cron works on all tiers.
--
-- The job posts to the function URL with no auth — that's safe because
-- the function was deployed with `--no-verify-jwt` and uses the
-- service-role key internally for DB writes. The cron job re-runs
-- every 15 minutes regardless of who's signed in.
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $outer$
DECLARE
  v_existing_jobid bigint;
BEGIN
  /* Idempotent: drop any prior schedule with this name before
     creating a fresh one. */
  SELECT jobid INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'sync-wix-training-15min';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'sync-wix-training-15min',
    '*/15 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://orywxdbusnhsrkopmtme.supabase.co/functions/v1/sync-wix-training',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $cmd$
  );
END
$outer$;
