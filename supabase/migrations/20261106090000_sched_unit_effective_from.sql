-- Unit opening day (2026-11-06). A future-dated unit stays fully
-- plannable in Setup's rotation template, but every live surface —
-- boards, open-seat feeds, page-outs, shift reminders — ignores it
-- until the date arrives. Null = open since forever (all existing
-- units keep today's behavior).
alter table public.sched_units
  add column if not exists effective_from date;
