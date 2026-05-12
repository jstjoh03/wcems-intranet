-- ─────────────────────────────────────────────────────────────────────
-- 0024_call_volume_v2_ems_fields
--
-- Reshape call_volume to match the actual monthly run-report PDF
-- (EMS side only — Fires column is tracked by the fire department,
-- not us):
--
--   • Summaries gain four EMS-specific fields:
--       calls_in_district          int
--       calls_out_of_district      int
--       unit_hour_utilization      numeric(5,3)   -- e.g. 0.091
--       air_transports             int
--
--   • Per-unit `avg_response_seconds` is removed — we don't collect
--     that data per unit. The view (`/insights`) now shows just runs
--     and a computed percentage in the per-unit table.
--
-- Backfill Jan/Feb/Mar 2026 from the run report (page 3 of
-- run-report-example.pdf) so the live insights match the PDF the day
-- this lands.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Summaries: new columns ─────────────────────────────────────────
ALTER TABLE public.call_volume_summaries
  ADD COLUMN IF NOT EXISTS calls_in_district      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calls_out_of_district  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_hour_utilization  numeric(5,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS air_transports         integer NOT NULL DEFAULT 0;

-- 2) Units: drop avg_response_seconds ────────────────────────────────
ALTER TABLE public.call_volume_units
  DROP COLUMN IF EXISTS avg_response_seconds;

-- 3) Backfill from the March 2026 run report (page 3 totals row) ─────
UPDATE public.call_volume_summaries SET
  calls_in_district     = 676,
  calls_out_of_district = 4,
  unit_hour_utilization = 0.084,
  air_transports        = 2
WHERE report_month = '2026-01-01';

UPDATE public.call_volume_summaries SET
  calls_in_district     = 716,
  calls_out_of_district = 3,
  unit_hour_utilization = 0.094,
  air_transports        = 1
WHERE report_month = '2026-02-01';

UPDATE public.call_volume_summaries SET
  calls_in_district     = 857,
  calls_out_of_district = 9,
  unit_hour_utilization = 0.091,
  air_transports        = 1
WHERE report_month = '2026-03-01';
