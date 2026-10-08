-- sched_entries.event_id was created without a foreign key, so
-- PostgREST cannot resolve the `event:sched_events(label)` embed the
-- event-audience Required Training queries use (client loadEventRosters
-- / loadEventGroups + sched-notify rt_event sweep all got a
-- relationship error and read as empty). Data verified clean first
-- (zero orphan event_ids). ON DELETE SET NULL: deleting an event must
-- never take schedule history with it.

alter table public.sched_entries
  add constraint sched_entries_event_id_fkey
  foreign key (event_id) references public.sched_events(id)
  on delete set null;
