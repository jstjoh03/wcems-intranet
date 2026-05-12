-- ─────────────────────────────────────────────────────────────────────
-- 0022_call_volume
--
-- Replaces the static `data/call-volume.json` fixture with three DB
-- tables admins can edit through a new `/admin/call-volume` page.
-- Crews read the same data on `/insights` (visible to everyone signed
-- in — per the Round-2 decision).
--
-- Schema:
--   call_volume_summaries  : one row per report month (the headline
--     numbers — total calls, patients, transports, avg response).
--   call_volume_units      : per-unit runs and response time, keyed
--     by (month, unit_name). Percentages are NOT stored — derived
--     client-side from runs / sum(runs) so they stay consistent if a
--     unit row is added or removed.
--   call_volume_zones      : per-zone call counts, keyed by
--     (month, zone_name). Same rule on percentages.
--
-- `report_month` is a date stored as the first day of the month
-- (matches the existing JSON convention). The list of units / zones
-- is intentionally not its own table — admins can type new names
-- directly in the form and rows roll forward month-to-month.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Summaries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_volume_summaries (
  report_month          date PRIMARY KEY,
  total_calls           integer NOT NULL DEFAULT 0,
  total_patients        integer NOT NULL DEFAULT 0,
  total_transports      integer NOT NULL DEFAULT 0,
  avg_response_seconds  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS call_volume_summaries_touch_updated_at
  ON public.call_volume_summaries;
CREATE TRIGGER call_volume_summaries_touch_updated_at
  BEFORE UPDATE ON public.call_volume_summaries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.call_volume_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_volume_summaries select for authenticated"
  ON public.call_volume_summaries;
CREATE POLICY "call_volume_summaries select for authenticated"
  ON public.call_volume_summaries FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "call_volume_summaries admin all"
  ON public.call_volume_summaries;
CREATE POLICY "call_volume_summaries admin all"
  ON public.call_volume_summaries FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.call_volume_summaries TO authenticated;

-- 2) Units ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_volume_units (
  report_month          date NOT NULL,
  unit_name             text NOT NULL,
  runs                  integer NOT NULL DEFAULT 0,
  avg_response_seconds  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (report_month, unit_name)
);

CREATE INDEX IF NOT EXISTS call_volume_units_month_idx
  ON public.call_volume_units (report_month);

ALTER TABLE public.call_volume_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_volume_units select for authenticated"
  ON public.call_volume_units;
CREATE POLICY "call_volume_units select for authenticated"
  ON public.call_volume_units FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "call_volume_units admin all"
  ON public.call_volume_units;
CREATE POLICY "call_volume_units admin all"
  ON public.call_volume_units FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.call_volume_units TO authenticated;

-- 3) Zones ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_volume_zones (
  report_month  date NOT NULL,
  zone_name     text NOT NULL,
  calls         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (report_month, zone_name)
);

CREATE INDEX IF NOT EXISTS call_volume_zones_month_idx
  ON public.call_volume_zones (report_month);

ALTER TABLE public.call_volume_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_volume_zones select for authenticated"
  ON public.call_volume_zones;
CREATE POLICY "call_volume_zones select for authenticated"
  ON public.call_volume_zones FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "call_volume_zones admin all"
  ON public.call_volume_zones;
CREATE POLICY "call_volume_zones admin all"
  ON public.call_volume_zones FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.call_volume_zones TO authenticated;
