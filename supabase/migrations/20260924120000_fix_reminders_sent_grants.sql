-- sched-notify (service role) claims reminders in sched_reminders_sent
-- before sending; the table was created without service_role grants, so
-- every cron sweep died with "permission denied" and nobody ever got a
-- shift reminder (found 2026-09-24 — cron green, claims table empty).
grant select, insert, update, delete on table public.sched_reminders_sent to service_role;
