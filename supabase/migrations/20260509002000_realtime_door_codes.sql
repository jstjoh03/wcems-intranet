-- ─────────────────────────────────────────────────────────────────────
-- 0021_realtime_door_codes
--
-- Extend realtime to the door-code surfaces: stations, hospitals,
-- code_edit_history. Crews working in the field benefit from seeing a
-- new code propagate immediately when admin updates it.
--
-- REPLICA IDENTITY is left at the default (PRIMARY KEY) for these
-- tables — unlike the engagement comments tables, we only ever need
-- the row id from DELETE payloads to splice the local cache, which
-- the PK provides natively. UPDATE events already carry the full new
-- tuple regardless of REPLICA IDENTITY.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stations',
    'hospitals',
    'code_edit_history'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        t
      );
    END IF;
  END LOOP;
END$$;
