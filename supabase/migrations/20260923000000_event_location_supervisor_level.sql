-- Two Aladtec-parity items (Justin, 2026-09-23):
--
-- 1. Events get a Location field, separate from the description note —
--    Aladtec showed Title / Location / Date-Time / Description on click
--    and in the hover snippet, and crews expect the same here.
--
-- 2. 'supervisor' becomes a STORABLE access level. It has always been
--    the derived default for app_users.role in ('admin','supervisor'),
--    and sched_pages' insert policy already honors it — but the check
--    constraint made it impossible to grant to a crew member who rides
--    up as supervisor and needs to send page-outs.

alter table public.sched_events add column if not exists location text;

alter table public.sched_access drop constraint sched_access_level_check;
alter table public.sched_access add constraint sched_access_level_check
  check (level in ('global_admin', 'scheduler', 'supervisor', 'hr', 'view_only', 'none'));
