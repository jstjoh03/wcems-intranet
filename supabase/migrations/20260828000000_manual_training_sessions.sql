-- Manually added classes in the Upcoming Classes list (Justin, 2026-08-28):
-- one-off classes that live in neither Wix Bookings nor the Internal
-- Education calendar (first case: Cardiology & 12-Lead, registration via
-- Jotform). New source 'manual'; sync-wix-training's prune now only
-- reconciles the rows it owns ('wix'/'calendar') so manual rows survive
-- the 15-minute sync. 'lecture' is also admitted — the client union has
-- carried it since the training-PWA wiring but the CHECK never did.
ALTER TABLE public.training_sessions
  DROP CONSTRAINT IF EXISTS training_sessions_source_check;
ALTER TABLE public.training_sessions
  ADD CONSTRAINT training_sessions_source_check
  CHECK (source IN ('wix', 'calendar', 'lecture', 'manual'));
