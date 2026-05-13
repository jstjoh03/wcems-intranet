-- ─────────────────────────────────────────────────────────────────────
-- Rename station values FLOAT and PRN → "Part-Time".
--
-- "FLOAT" and "PRN" are nursing-industry terms that day-to-day EMS ops
-- don't use. Both functionally describe part-time floater staff who go
-- wherever needed, so we collapse them into a single user-facing label
-- that matches how crews talk.
--
-- The station column is plain text (not an enum) so we can just UPDATE
-- in place. The closed station-options list in the Vue self-edit UIs
-- ships in a follow-up commit (constants/stations.ts) and drops the
-- two old options in favor of "Part-Time".
--
-- Idempotent: re-running matches zero rows once the migration has been
-- applied.
-- ─────────────────────────────────────────────────────────────────────

update public.app_users
  set station = 'Part-Time'
  where station in ('FLOAT', 'PRN');
