-- Extra-hours requests can be worked special events (double time via the
-- 'event' Paycom category). Directed trades need no schema change:
-- counterparty_id set while status='pending' = sent to that person.
alter table sched_entries drop constraint sched_entries_time_type_check;
alter table sched_entries add constraint sched_entries_time_type_check
  check (time_type in ('regular','instructor','meeting','event'));
alter table sched_requests drop constraint sched_requests_time_type_check;
alter table sched_requests add constraint sched_requests_time_type_check
  check (time_type in ('regular','instructor','meeting','event'));
