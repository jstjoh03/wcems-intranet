-- ─────────────────────────────────────────────────────────────────────
-- 0003_fix_s201_s202_station_format
--
-- S201 and S202 are physical station buildings only — their crews are
-- not assigned to a fixed medic unit, so the `station` field for those
-- users should be just `S201` or `S202`, never combined with a medic
-- number. Other stations DO have crew/unit pairing and keep the
-- combined `S### / M###` format.
--
-- The initial migration seeded Justin (and any other backfilled S201/
-- S202 user) with `S202 / M271`-style values; this migration normalizes
-- those rows. Strips a trailing ` / M###` token only when the station
-- starts with `S201` or `S202`, leaving every other station alone.
-- ─────────────────────────────────────────────────────────────────────

UPDATE public.app_users
SET station = regexp_replace(station, '\s*/\s*M\d+\s*$', '')
WHERE station ~ '^S20[12]\s*/\s*M\d+';
