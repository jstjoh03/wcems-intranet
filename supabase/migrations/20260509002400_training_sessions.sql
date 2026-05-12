-- ─────────────────────────────────────────────────────────────────────
-- 0025_training_sessions
--
-- Cache of Wix Bookings time slots, populated by the
-- `sync-wix-training` Supabase Edge Function on a 15-min cron. Replaces
-- the SP CourseSessions list as the source of truth on the new app —
-- Power Automate (Wix → SP) is no longer in the loop.
--
-- The Vue composable (`useTraining`) reads from this table and merges
-- with the M365 Group calendar's "blue"-tagged events live from Graph.
--
-- Schema mirrors the fields exposed by Wix's
-- `/_api/service-availability/v2/time-slots/event` endpoint, mapped to
-- snake_case columns:
--
--   id                    Wix `eventInfo.eventId` (stable PK)
--   service_id            Wix `serviceId` — the parent course
--   title                 `eventInfo.eventTitle`
--   local_start           `localStartDate` parsed as a timestamp;
--                         stored without TZ because Wix sends the
--                         site's local clock (America/Chicago).
--   total_capacity        seat cap
--   remaining_capacity    open seats — `filled = total - remaining`
--                         is computed in the client
--   location              `location.formattedAddress`
--   instructor            first resource name (PrimaryInstructorName
--                         equivalent)
--   synced_at             when the Edge Function last touched the row
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.training_sessions (
  id                  text PRIMARY KEY,
  service_id          text,
  title               text NOT NULL DEFAULT '',
  local_start         timestamp NOT NULL,
  total_capacity      integer NOT NULL DEFAULT 0,
  remaining_capacity  integer NOT NULL DEFAULT 0,
  location            text NOT NULL DEFAULT '',
  instructor          text NOT NULL DEFAULT '',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_sessions_start_idx
  ON public.training_sessions (local_start);

ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

-- All signed-in crew can read; only the Edge Function (service_role)
-- writes. No admin-write policy needed — the function bypasses RLS
-- via its service role and clients should never INSERT/UPDATE here.
DROP POLICY IF EXISTS "training_sessions select for authenticated"
  ON public.training_sessions;
CREATE POLICY "training_sessions select for authenticated"
  ON public.training_sessions FOR SELECT
  TO authenticated USING (true);

GRANT SELECT ON public.training_sessions TO authenticated;

-- Add to realtime publication so the client picks up new sessions
-- pushed by the Edge Function without polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'training_sessions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.training_sessions';
  END IF;
END$$;

-- REPLICA IDENTITY FULL is overkill here — id (PK) is sufficient to
-- locate rows in the client cache on DELETE. Left at the default.
