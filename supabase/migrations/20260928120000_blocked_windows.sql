-- 'blocked' seat windows (Rhonda, 2026-09-28): an open seat covered by
-- someone already punched elsewhere (S201 rides the open seat). No
-- person entry — no duplicate punches — but the board shows the window
-- as covered instead of a gap. user_id stays null; status 'off' keeps
-- these out of coverage, hours, reminders and payroll everywhere.
alter table public.sched_entries drop constraint sched_entries_kind_check;
alter table public.sched_entries add constraint sched_entries_kind_check
  check (kind = any (array['rotation'::text,'pickup'::text,'trade'::text,'giveaway_cover'::text,'extra'::text,'event'::text,'student'::text,'timeoff'::text,'rider'::text,'blocked'::text]));
