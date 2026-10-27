-- Hourly uniforms-sync cron (2026-10-27): keeps the Uniforms PWA
-- (separate Supabase account) in step with the roster — email linking,
-- new-hire onboarding rows (PT $150 / FT $250), offboarding, and the
-- January 1st allowance reset from 2027 onward.
--
-- Clones the proven roster-sync command (pg_net POST with the
-- x-sync-secret header + {"apply":true}) pointed at uniforms-sync, so
-- the secret never lives in this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'uniforms-sync-hourly') THEN
    PERFORM cron.schedule(
      'uniforms-sync-hourly',
      '7 * * * *',
      replace(
        (SELECT command FROM cron.job WHERE jobname = 'roster-sync-hourly'),
        'roster-sync',
        'uniforms-sync'
      )
    );
  END IF;
END$$;
