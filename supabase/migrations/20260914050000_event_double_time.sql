-- Per-event double-time flag. Staffed special events default to double
-- time (agency practice); the checkbox on event creation / the event
-- manager can mark an event as regular pay instead, and the Paycom
-- export classifies its hours accordingly.
alter table public.sched_events
  add column double_time boolean not null default true;
