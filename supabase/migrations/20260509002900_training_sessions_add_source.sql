-- ─────────────────────────────────────────────────────────────────────
-- 0030_training_sessions_add_source
--
-- Make `training_sessions` hold both Wix-booking sessions AND
-- Education-group calendar events (previously the calendar half was
-- fetched client-side via MSAL — that flow is being killed in favor
-- of an Edge-Function-side fetch using app-only Graph auth, same
-- pattern as Wix).
--
--   • New `source` column distinguishes 'wix' vs 'calendar' rows.
--   • Existing rows are wiped — the Edge Function will re-sync them
--     in the next 15-min tick (or immediately if you click Sync now)
--     with prefixed IDs so the two sources can't collide.
--   • CHECK constraint locks the source domain so a typo can't
--     introduce a third value silently.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.training_sessions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'wix';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'training_sessions_source_check'
  ) THEN
    ALTER TABLE public.training_sessions
      ADD CONSTRAINT training_sessions_source_check
      CHECK (source IN ('wix', 'calendar'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS training_sessions_source_idx
  ON public.training_sessions (source);

/* Wipe existing rows so the next sync run repopulates with the new
   `wix:` / `cal:` prefixed IDs and the correct source value. The
   table is cache-only — no human-entered data is lost here. */
TRUNCATE public.training_sessions;
