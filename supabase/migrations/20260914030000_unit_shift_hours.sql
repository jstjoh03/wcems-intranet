-- Per-unit daily shift window for rotation-generated coverage. Null =
-- the standard 0600 -> 0600 24-hour shift. A part-time truck keeps the
-- same A/B/C pattern letters but runs e.g. 08:00-20:00; the window must
-- sit inside the 0600-anchored work date (ends past 0600 next morning
-- are clamped to 0600).
alter table public.sched_units
  add column shift_start time,
  add column shift_end time;
