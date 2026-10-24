-- app_users.shift AND app_users.station are DERIVED from the scheduling
-- module (Justin, 2026-10-24): a member's shift = the platoon of their
-- rotation assignment active today, their station = that seat's unit
-- (Medic units by label, supervisor units by code — S201/S202 are
-- physical locations). No assignment (part-time, admin, off the
-- rotation) = no shift, and a rotation-owned station value is cleared;
-- hand-set stations like 'EMS Admin' are left alone. Kept current three
-- ways: a trigger on rotation-assignment changes, a nightly cron
-- (effective-dated moves roll over at midnight without any row
-- changing), and a one-time backfill. Manual edits get overwritten —
-- the schedule is the system of record. (Applied live as two
-- migrations, app_users_shift_from_schedule +
-- app_users_station_from_schedule; this file is the combined record.)

create or replace function public.app_users_sync_shifts()
returns void
language sql
security definer
set search_path to 'public'
as $$
  with derived as (
    select distinct on (ra.user_id)
      ra.user_id,
      ra.platoon,
      case when un.code like 'S%' then un.code else un.label end as station
    from sched_rotation_assignments ra
    join sched_seats s on s.id = ra.seat_id
    join sched_units un on un.id = s.unit_id
    where ra.effective_from <= current_date
      and (ra.effective_to is null or ra.effective_to >= current_date)
    order by ra.user_id, ra.effective_from desc
  ),
  rotation_stations as (
    select label as v from sched_units
    union
    select code from sched_units
  )
  update app_users u
  set shift = (d.platoon)::shift_letter,
      station = d.station
  from (
    select au.id,
           dv.platoon,
           case
             when dv.user_id is not null then dv.station
             when au.station in (select v from rotation_stations) then null
             else au.station
           end as station
    from app_users au
    left join derived dv on dv.user_id = au.id
    where au.active and au.account_type = 'person'
  ) d
  where u.id = d.id
    and (u.shift::text is distinct from d.platoon
         or u.station is distinct from d.station);
$$;

create or replace function public.app_users_sync_shifts_tg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_users_sync_shifts();
  return null;
end;
$$;

drop trigger if exists rotation_assignments_sync_shifts on public.sched_rotation_assignments;
create trigger rotation_assignments_sync_shifts
  after insert or update or delete on public.sched_rotation_assignments
  for each statement execute function public.app_users_sync_shifts_tg();

-- Nightly rollover for effective-dated moves (06:15 UTC ≈ just after
-- midnight Central, before the 11:30 UTC GAL assignments sync).
-- (cron.schedule was run on the live DB; guarded here for replays.)
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'app-users-shift-sync-daily') then
    perform cron.schedule('app-users-shift-sync-daily', '15 6 * * *', 'select public.app_users_sync_shifts();');
  end if;
end;
$$;

select public.app_users_sync_shifts();
