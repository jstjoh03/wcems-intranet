-- PTO charges schedule-NOMINAL hours across DST (2026-11-02, applied live).
-- Justin: "vacation should only account for the standard 24 hours. Only
-- time worked needs to be affected."
--
-- The fall-back shift (0600 Oct 31 → 0600 Nov 1, 2026) is 25 real
-- elapsed hours; spring-forward days are 23. Worked time keeps real
-- elapsed hours everywhere (the extra hour is paid when worked), but a
-- paid time-off record charges the Chicago WALL-CLOCK difference — a
-- full 0600→0600 off day is always 24 — so leave balances never over-
-- or under-charge on a DST day.
--
-- Client twin: nominalHours() in useSchedule.ts (fetchTimeSegments
-- timeoff rows, fetchLeaveTaken, pendingLeaveHours, createTimeOffRequests
-- balance gate). Keep both in lockstep.
create or replace view sched_leave_used
with (security_invoker = true) as
select user_id,
       off_type as kind,
       round(sum(extract(epoch from (
         (end_at at time zone 'America/Chicago')
         - (start_at at time zone 'America/Chicago')
       )) / 3600.0), 2) as used_hours
from sched_entries e
where kind = 'timeoff'
  and off_type in ('vacation', 'sick')
  and user_id is not null
  and work_date > sched_leave_opening_asof()
group by user_id, off_type;
