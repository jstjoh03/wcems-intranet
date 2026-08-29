-- Per-day phase scheduling (Justin, 2026-08-29): editors load the
-- specific shift dates for each FTEP phase (e.g. Partner Phase = 4
-- dates). The portal matches each scheduled day against submitted
-- DORs (by eval_date) so "was the DOR done for that training day"
-- is automatic, and a phase auto-completes once all its days have
-- passed AND each day has its DOR (no-FTO phases like NEOP Academy
-- need only the dates to pass). Future dates render as "scheduled",
-- never as complete.
ALTER TABLE public.ftep_phase_progress
  ADD COLUMN IF NOT EXISTS scheduled_days jsonb NOT NULL DEFAULT '[]'::jsonb;
