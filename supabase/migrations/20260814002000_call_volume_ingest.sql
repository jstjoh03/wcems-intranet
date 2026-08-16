-- ─────────────────────────────────────────────────────────────────────
-- 20260814002000_call_volume_ingest
--
-- Ingest log for the call-volume-sync edge function (reads Rhonda's
-- monthly PDF report out of Justin's "Call Volume" mail folder and
-- upserts call_volume_summaries/_units/_zones). One row per processed
-- email so re-runs skip it; a corrected re-send (new message id, same
-- month) re-ingests and replaces the month.
--
-- Also schedules the daily cron (11:10 UTC ≈ 6:10 AM Central) by
-- cloning the roster-sync job's command — same secret header, same
-- {"apply":true} body, different function URL.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.call_volume_ingest (
  internet_message_id text PRIMARY KEY,
  report_month        date NOT NULL,
  subject             text,
  attachment_name     text,
  warnings            text,
  processed_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_volume_ingest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_volume_ingest admin select" ON public.call_volume_ingest;
CREATE POLICY "call_volume_ingest admin select"
  ON public.call_volume_ingest FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.call_volume_ingest TO authenticated;
GRANT ALL ON public.call_volume_ingest TO service_role;

-- Daily cron: reuse the proven roster-sync command (pg_net POST with
-- the x-sync-secret header + {"apply":true}) pointed at this function.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'call-volume-sync-daily') THEN
    PERFORM cron.schedule(
      'call-volume-sync-daily',
      '10 11 * * *',
      replace(
        (SELECT command FROM cron.job WHERE jobname = 'roster-sync-hourly'),
        'roster-sync',
        'call-volume-sync'
      )
    );
  END IF;
END$$;
