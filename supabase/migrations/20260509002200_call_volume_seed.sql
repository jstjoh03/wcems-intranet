-- ─────────────────────────────────────────────────────────────────────
-- 0023_call_volume_seed
--
-- One-off backfill of call_volume_summaries / units / zones from the
-- legacy `data/call-volume.json` fixture (Jan / Feb / Mar 2026 actuals).
-- Idempotent — `ON CONFLICT … DO UPDATE` so re-running converges each
-- row to the seed values; benign once admins start entering fresh data.
--
-- Notes:
--   • Units no longer store avg_response_seconds (dropped in migration
--     0024). This seed inserts only `runs`, matching the post-0024 shape.
--   • EMS-specific summary fields (calls_in_district, etc.) are added
--     and backfilled by migration 0024 — this seed leaves them at their
--     column defaults (0) so it stays runnable in either order.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.call_volume_summaries
  (report_month, total_calls, total_patients, total_transports, avg_response_seconds)
VALUES
  ('2026-01-01', 680, 599, 437, 603),
  ('2026-02-01', 719, 624, 444, 647),
  ('2026-03-01', 866, 708, 472, 631)
ON CONFLICT (report_month) DO UPDATE SET
  total_calls = EXCLUDED.total_calls,
  total_patients = EXCLUDED.total_patients,
  total_transports = EXCLUDED.total_transports,
  avg_response_seconds = EXCLUDED.avg_response_seconds;

INSERT INTO public.call_volume_units
  (report_month, unit_name, runs)
VALUES
  ('2026-01-01', 'Medic 211', 116),
  ('2026-01-01', 'Medic 221', 100),
  ('2026-01-01', 'Medic 231', 47),
  ('2026-01-01', 'Medic 242', 75),
  ('2026-01-01', 'Medic 271', 96),
  ('2026-01-01', 'Medic 206', 136),
  ('2026-01-01', 'Medic 281', 101),
  ('2026-01-01', 'Supervisor', 9),
  ('2026-02-01', 'Medic 211', 134),
  ('2026-02-01', 'Medic 221', 103),
  ('2026-02-01', 'Medic 231', 47),
  ('2026-02-01', 'Medic 242', 70),
  ('2026-02-01', 'Medic 271', 110),
  ('2026-02-01', 'Medic 206', 150),
  ('2026-02-01', 'Medic 281', 98),
  ('2026-02-01', 'Supervisor', 7),
  ('2026-03-01', 'Medic 211', 146),
  ('2026-03-01', 'Medic 221', 122),
  ('2026-03-01', 'Medic 231', 61),
  ('2026-03-01', 'Medic 242', 87),
  ('2026-03-01', 'Medic 271', 135),
  ('2026-03-01', 'Medic 206', 178),
  ('2026-03-01', 'Medic 281', 96),
  ('2026-03-01', 'Supervisor', 41)
ON CONFLICT (report_month, unit_name) DO UPDATE SET
  runs = EXCLUDED.runs;

INSERT INTO public.call_volume_zones
  (report_month, zone_name, calls)
VALUES
  ('2026-01-01', 'City of Brookshire', 53),
  ('2026-01-01', 'City of Hempstead', 105),
  ('2026-01-01', 'City of Pattison', 0),
  ('2026-01-01', 'City of Prairie View', 35),
  ('2026-01-01', 'City of Waller', 28),
  ('2026-01-01', 'Daikin', 8),
  ('2026-01-01', 'Dist 1', 33),
  ('2026-01-01', 'Dist 2', 71),
  ('2026-01-01', 'Dist 3', 20),
  ('2026-01-01', 'Dist 4', 59),
  ('2026-01-01', 'Dist 5', 46),
  ('2026-01-01', 'Dist 6', 160),
  ('2026-01-01', 'Dist 8', 29),
  ('2026-01-01', 'PVAMU', 8),
  ('2026-01-01', 'Out of District', 4),
  ('2026-01-01', 'Posting Assignment', 21),
  ('2026-02-01', 'City of Brookshire', 68),
  ('2026-02-01', 'City of Hempstead', 93),
  ('2026-02-01', 'City of Pattison', 2),
  ('2026-02-01', 'City of Prairie View', 9),
  ('2026-02-01', 'City of Waller', 30),
  ('2026-02-01', 'Daikin', 6),
  ('2026-02-01', 'Dist 1', 35),
  ('2026-02-01', 'Dist 2', 88),
  ('2026-02-01', 'Dist 3', 19),
  ('2026-02-01', 'Dist 4', 66),
  ('2026-02-01', 'Dist 5', 45),
  ('2026-02-01', 'Dist 6', 170),
  ('2026-02-01', 'Dist 8', 46),
  ('2026-02-01', 'PVAMU', 6),
  ('2026-02-01', 'Out of District', 3),
  ('2026-02-01', 'Posting Assignment', 33),
  ('2026-03-01', 'City of Brookshire', 83),
  ('2026-03-01', 'City of Hempstead', 106),
  ('2026-03-01', 'City of Pattison', 0),
  ('2026-03-01', 'City of Prairie View', 21),
  ('2026-03-01', 'City of Waller', 22),
  ('2026-03-01', 'Daikin', 13),
  ('2026-03-01', 'Dist 1', 58),
  ('2026-03-01', 'Dist 2', 101),
  ('2026-03-01', 'Dist 3', 24),
  ('2026-03-01', 'Dist 4', 72),
  ('2026-03-01', 'Dist 5', 48),
  ('2026-03-01', 'Dist 6', 211),
  ('2026-03-01', 'Dist 8', 45),
  ('2026-03-01', 'PVAMU', 11),
  ('2026-03-01', 'Out of District', 9),
  ('2026-03-01', 'Posting Assignment', 42)
ON CONFLICT (report_month, zone_name) DO UPDATE SET
  calls = EXCLUDED.calls;
