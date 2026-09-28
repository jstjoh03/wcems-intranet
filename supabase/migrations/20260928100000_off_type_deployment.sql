-- Deployment joins the time-off types (Justin, 2026-09-28) — recorded
-- on the calendar like any off day. No balance impact: sched_leave_used
-- still counts only vacation + sick.
alter table public.sched_entries drop constraint sched_entries_off_type_check;
alter table public.sched_entries add constraint sched_entries_off_type_check
  check (off_type = any (array['vacation'::text,'sick'::text,'unpaid'::text,'bereavement'::text,'deployment'::text,'other'::text]));
alter table public.sched_requests drop constraint sched_requests_off_type_check;
alter table public.sched_requests add constraint sched_requests_off_type_check
  check (off_type = any (array['vacation'::text,'sick'::text,'unpaid'::text,'bereavement'::text,'deployment'::text,'other'::text]));
