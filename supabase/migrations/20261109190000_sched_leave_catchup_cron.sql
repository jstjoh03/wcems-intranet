-- Post leave accruals from cron, not from client page loads (2026-11-09).
-- sched_leave_catchup loops every full-timer with two sched_entries
-- scans each (anniversary caps); as the schedule grew it crossed the
-- authenticated role's 8s statement_timeout, so every fire-and-forget
-- call from loadCore was canceled and rolled back whole — accruals
-- silently stopped after 2026-09-26. pg_cron runs the job as postgres
-- (no timeout). The loadCore call is removed in the same commit.
select cron.schedule(
  'sched-leave-catchup-daily',
  '20 6 * * *',
  $$select public.sched_leave_catchup();$$
);
